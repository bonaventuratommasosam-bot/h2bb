// runAutonomousTick + runProactiveCheck
// EXTRACTED FROM index.js:720-760, 680-695
// QW1: heartbeat file dopo ogni tick riuscito
// QW2: timeout 40s sul singolo tick (Promise.race)
// QW3: lock anti-reentrancy (_tickRunning)

const fs = require('fs');
const path = require('path');
const autonomous = require('../autonomous-engine');
const proEngine = require('../pro-engine');
const proactive = require('../proactive-agent');
const shadowEngine = require('../shadow-engine');
const metaController = require('../meta-controller');
const conversationAgent = require('../conversation-agent');
const selfLearning = require('../self-learning');
const experiment = require('../strategy-experiment');
const eventLog = require('../event-log');
const { DATA_DIR } = require('../config/default');
const { getPrice } = require('../trading/price');
const { getPositionSize, getEntryPrice } = require('../trading/positions');
const { executeMarketBuy, executeMarketSell, resumeTradingAfterEngineClose, notifyOwner } = require('../trading/orders');
const { unblockRiskBaseline } = require('../trading/orders');
const { saveRiskState, riskManager } = require('../state/risk');
const { saveStrategy } = require('../state/strategy');
const { updateTickSnapshot, buildProactiveContext } = require('./context-cache');
const shared = require('../state/shared');

// QW1: percorso heartbeat in cache/
const CACHE_DIR = path.join(DATA_DIR, 'cache');
const HEARTBEAT_FILE = path.join(CACHE_DIR, 'heartbeat.json');

// QW2: timeout massimo per un singolo tick
const TICK_TIMEOUT_MS = parseInt(process.env.TICK_TIMEOUT_MS, 10) || 40000;

// QW3: lock anti-reentrancy a livello modulo
let _tickRunning = false;
let _tickCount = 0;
let _consecutiveTimeouts = 0;
const MAX_CONSECUTIVE_TIMEOUTS = 3;

function onAutonomousLog(msg) { console.log(msg); }

// QW1: scrive heartbeat con atomic rename (tmp + renameSync)
function writeHeartbeat(patch) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    _tickCount++;
    const payload = {
      ts: Date.now(),
      lastTickAt: Date.now(),
      tickCount: _tickCount,
      pair: shared.strategy.pair,
      active: shared.strategy.active,
      mode: shared.strategy.mode || 'unknown',
      lastSignal: shared.strategy.lastSignal?.reason || null,
      consecutiveTimeouts: _consecutiveTimeouts,
      ...patch,
    };
    const tmp = HEARTBEAT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, HEARTBEAT_FILE);
    _consecutiveTimeouts = 0; // reset su tick riuscito
  } catch (e) {
    console.error('[HEARTBEAT] Scrittura fallita:', e.message);
  }
}

async function runProactiveCheck() {
  try {
    const result = await proactive.evaluate(await buildProactiveContext());
    if (result.sent > 0) console.log(`[PROACTIVE] Inviati ${result.sent} messaggi`);
    // Meta-Controller: valuta se cambiare policy
    try {
      const mcResult = metaController.evaluate(shared.strategy, shared.balance);
      if (mcResult.changed) {
        console.log(`[META] ${mcResult.modeChanged ? 'Mode change' : 'Adjust'}: ${mcResult.reason}`);
        saveStrategy();  // P0: persisti le modifiche del meta-controller
        if (mcResult.adjustments?.message) {
          notifyOwner('Meta-Controller', mcResult.adjustments.message);
        }
      }
    } catch (e) {
      console.error('[META] Errore:', e.message);
    }

    // Loop 3: strategy-experiment ogni 7 giorni
    try {
      if (experiment.shouldRun()) {
        console.log('[EXPERIMENT] Avvio esperimento strategia (paper only — no live promote)...');
        const expResult = await experiment.runExperiment(shared.strategy);
        if (expResult.ok) {
          // Never auto-apply challenger to live strategy (statistical toy)
          console.log(`[EXPERIMENT] ${expResult.message}`);
          eventLog.strategyChange({
            source: 'experiment',
            param: expResult.param,
            champion: expResult.championValue,
            challenger: expResult.challengerValue,
            promoted: false,
            suggested: !!expResult.promoted,
            paperOnly: true,
          });
        }
      }
    } catch (e) {
      console.error('[EXPERIMENT] Errore:', e.message);
    }

    // Loop 1: performance alert
    try {
      const feedback = require('../performance-feedback');
      const fb = feedback.buildFeedbackContext(shared.strategy);
      const perfAlert = feedback.evaluatePerformanceAlert(fb, shared.strategy);
      if (perfAlert?.alert) {
        console.log(`[PERF-ALERT] ${perfAlert.message}`);
        notifyOwner('Performance Alert', perfAlert.message);
      }
    } catch (e) {
      console.error('[PERF-ALERT] Errore:', e.message);
    }
    return result;
  } catch (e) {
    console.error('[PROACTIVE] Errore:', e.message);
    return { sent: 0, error: e.message };
  }
}

async function _runTickInternal() {
  if (!shared.strategy.active) return;

  const position = await getPositionSize(shared.strategy.pair);
  // REMOVED: auto-unblock when flat + daily/drawdown CB.
  // Sticky CB stays until new day (daily) or explicit operator resume (drawdown).

  const price = await getPrice(shared.strategy.pair);
  if (shared.strategy.stopLoss && price < shared.strategy.stopLoss) {
    console.log(`[STOP-LOSS] ${shared.strategy.pair} @ ${price} < ${shared.strategy.stopLoss}`);
    const slRes = await executeMarketSell(shared.strategy.pair, 1);
    // Only re-arm entries if risk allows auto-resume (never with sticky CB)
    if (slRes.ok && riskManager.canAutoResumeTrading(shared.riskState)) {
      await resumeTradingAfterEngineClose();
    } else if (slRes.ok) {
      console.log('[RISK] Position closed — sticky CB prevents auto re-entry');
    }
    writeHeartbeat({ price });
    return;
  }
  if (shared.strategy.takeProfit && price > shared.strategy.takeProfit) {
    console.log(`[TAKE-PROFIT] ${shared.strategy.pair} @ ${price} > ${shared.strategy.takeProfit}`);
    const tpRes = await executeMarketSell(shared.strategy.pair, 1);
    if (tpRes.ok && riskManager.canAutoResumeTrading(shared.riskState)) {
      await resumeTradingAfterEngineClose();
    } else if (tpRes.ok) {
      console.log('[RISK] Position closed — sticky CB prevents auto re-entry');
    }
    writeHeartbeat({ price });
    return;
  }

  const tickCtx = {
    strategy: shared.strategy, balance: shared.balance,
    getPrice, getPosition: getPositionSize, getEntryPrice,
    getAllocated: require('../state/wallet').getAllocated,
    getEquity: require('../trading/balance').getEquity,
    executeMarketBuy, executeMarketSell,
    resumeAfterClose: resumeTradingAfterEngineClose,
    onLog: onAutonomousLog,
    onTrade: (trade, sig) => notifyOwner(null, null, trade, sig),
    onAlert: (title, detail) => notifyOwner(title, detail),
    riskState: shared.riskState, saveRiskState,
    deferExecution: true,
  };

  const out = shared.strategy.mode === 'pro'
    ? await proEngine.runTick(tickCtx)
    : await autonomous.runTick(tickCtx);

  if (out?.blocked) shared.riskState = riskManager.loadRiskState();

  // ── AI decision layer (after TA signal, before buy execution) ──
  if (
    shared.strategy.mode === 'pro'
    && shared.strategy.active
    && out?.deferred
    && out?.sizing
  ) {
    const signal = out.signal;
    const analysis = out.analysis;
    const entryScore = out.entryScore
      || (analysis ? proEngine.scoreEntry(analysis, shared.strategy) : null);

    // Self-learning pre-tune
    try {
      if (analysis && entryScore) {
        const tune = selfLearning.suggestTuning(analysis, entryScore, shared.strategy);
        if (tune.suggestions && Object.keys(tune.suggestions).length) {
          const ch = selfLearning.applySuggestions(shared.strategy, tune.suggestions, {
            hardCapRisk: parseFloat(process.env.HARD_CAP_RISK_PER_TRADE) || 1.0,
          });
          if (ch.length) {
            console.log(`[SELF-LEARN] ${tune.reason} → ${ch.join(', ')}`);
          }
        }
      }
    } catch (e) {
      console.error('[SELF-LEARN]', e.message);
    }

    const equityNow = await require('../trading/balance').getEquity();
    const posNow = await getPositionSize(shared.strategy.pair);
    const report = proEngine.getContextReport(
      analysis, entryScore, shared.strategy, shared.riskState,
      equityNow, shared.balance, out.price ?? price, posNow
    );

    const aiDecision = await conversationAgent.evaluateDecision(report);

    // Apply strategyChanges (null = skip) — clamp min score to operator base ± lift
    if (aiDecision.strategyChanges) {
      const { clampAiMinScore, lockOperatorMinScore } = require('../lib/ai-autonomy');
      lockOperatorMinScore(shared.strategy);
      let patched = false;
      for (const [k, v] of Object.entries(aiDecision.strategyChanges)) {
        if (v == null || shared.strategy[k] === undefined) continue;
        let val = Number(v);
        if (!Number.isFinite(val)) continue;
        if (k === 'riskPerTradePercent') {
          val = Math.max(0.1, Math.min(parseFloat(process.env.HARD_CAP_RISK_PER_TRADE) || 1.0, val));
        }
        if (k === 'minConfidenceScore') {
          val = clampAiMinScore(val, shared.strategy);
        }
        if (shared.strategy[k] !== val) {
          shared.strategy[k] = val;
          patched = true;
        }
      }
      if (patched) {
        console.log(`[AI-DECISION] strategy patched — ${aiDecision.reason}`);
      }
    }

    // Force exit
    if (aiDecision.decision === 'exit' || aiDecision.exitOverride?.force) {
      if (Math.abs(posNow) > 1e-9) {
        console.log(`[AI-DECISION] FORCE EXIT conf=${aiDecision.confidence} — ${aiDecision.reason}`);
        const sellRes = await executeMarketSell(shared.strategy.pair, 1);
        if (sellRes.ok) {
          shared.strategy.lastTradeAt = Date.now();
          shared.strategy.lastSignal = { action: 'sell', reason: `AI: ${aiDecision.reason}`, score: aiDecision.confidence };
          if (sellRes.trade) notifyOwner(null, null, sellRes.trade, shared.strategy.lastSignal);
        }
      }
    } else if (signal.action === 'buy' || signal.action === 'add') {
      const conf = aiDecision.confidence ?? 0;
      const approved = aiDecision.entryOverride?.approved !== false;
      const enterOk = aiDecision.decision === 'enter' && conf >= 80 && approved;

      if (aiDecision.decision === 'ta_fallback') {
        console.log(`[AI-DECISION] ta_fallback — eseguo buy TA`);
        const res = await executeMarketBuy(shared.strategy.pair, out.sizing.amount);
        if (res.ok) {
          shared.strategy.lastTradeAt = Date.now();
          shared.strategy.lastSignal = signal;
          shared.strategy.tp1Taken = false;
          shared.strategy.trailingPeak = out.price ?? price;
          shared.strategy.positionLeg = 'full';
          shared.strategy.scaleInPending = false;
          if (res.trade) notifyOwner(null, null, res.trade, signal);
        }
      } else if (enterOk) {
        console.log(`[AI-DECISION] ENTER conf=${conf} — ${aiDecision.reason}`);
        const res = await executeMarketBuy(shared.strategy.pair, out.sizing.amount);
        if (res.ok) {
          shared.strategy.lastTradeAt = Date.now();
          shared.strategy.lastSignal = { ...signal, reason: `${signal.reason} | AI:${aiDecision.reason}`, aiConfidence: conf };
          shared.strategy.tp1Taken = false;
          shared.strategy.trailingPeak = out.price ?? price;
          shared.strategy.positionLeg = 'full';
          shared.strategy.scaleInPending = false;
          if (res.trade) notifyOwner(null, null, res.trade, shared.strategy.lastSignal);
        } else {
          console.log(`[AI-DECISION] Buy fallito: ${res.error}`);
        }
      } else {
        console.log(`[AI-DECISION] SKIP buy decision=${aiDecision.decision} conf=${conf} — ${aiDecision.reason}`);
        shared.strategy.lastSignal = { action: 'hold', reason: `AI ${aiDecision.decision}: ${aiDecision.reason}`, score: conf };
      }
    } else if (aiDecision.decision === 'adapt' || aiDecision.decision === 'hold') {
      console.log(`[AI-DECISION] ${aiDecision.decision} — ${aiDecision.reason}`);
    }
  }

  // AUTONOMY: persisti SEMPRE le modifiche autonome della strategia (meta-controller,
  // shadow-engine, risk) — non solo sui segnali. Il bot e' padrone della sua config.
  saveStrategy();

  // Shadow champion/challenger — riusa analysis del tick live, nessun ordine reale
  if (shared.strategy.mode === 'pro') {
    try {
      const shadowOut = await shadowEngine.runShadowTick(tickCtx, out, price);
      if (shadowOut?.promoted) saveStrategy();
      if (shadowOut?.latencyMs != null && shadowOut.latencyMs > 50) {
        console.warn(`[SHADOW] Overhead ${shadowOut.latencyMs}ms (>50ms)`);
      }
    } catch (e) {
      console.error('[SHADOW] Errore:', e.message);
    }
  }

  const positionAfter = await getPositionSize(shared.strategy.pair);
  const entryPrice = await getEntryPrice(shared.strategy.pair);
  const entryScore = out?.analysis && shared.strategy.mode === 'pro' ? proEngine.scoreEntry(out.analysis, shared.strategy) : null;
  updateTickSnapshot({
    price, position: positionAfter, entryPrice,
    hasPosition: Math.abs(positionAfter) > 1e-9,
    analysis: out?.analysis || shared.lastTickSnapshot?.analysis,
    entryScore: entryScore || shared.lastTickSnapshot?.entryScore,
  });

  writeHeartbeat({ price });
  await runProactiveCheck();
}

function timeoutAfter(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('[TICK-TIMEOUT]')), ms).unref?.();
  });
}

async function runAutonomousTick() {
  if (!shared.strategy.active) return;

  if (_tickRunning) {
    console.warn('[TICK] Tick già in esecuzione — salto questo ciclo (anti-reentrancy)');
    return;
  }
  _tickRunning = true;

  try {
    await Promise.race([
      _runTickInternal(),
      timeoutAfter(TICK_TIMEOUT_MS),
    ]);
  } catch (e) {
    if (e.message === '[TICK-TIMEOUT]') {
      _consecutiveTimeouts++;
      eventLog.error({ source: 'tick-runner', message: `tick timeout #${_consecutiveTimeouts}`, pair: shared.strategy.pair });
      console.error(`[TICK-TIMEOUT] Tick superati ${TICK_TIMEOUT_MS}ms (${_consecutiveTimeouts}/${MAX_CONSECUTIVE_TIMEOUTS} consecutivi) — abortito`);
      if (_consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
        notifyOwner('Tick bloccati', `${_consecutiveTimeouts} timeout consecutivi. Engine potrebbe essere in stallo.`);
      }
    } else {
      eventLog.error({ source: 'tick-runner', message: e.message, pair: shared.strategy.pair });
      console.error(`[${shared.strategy.mode === 'pro' ? 'PRO' : 'AUTO'}] Errore: ${e.message}`);
    }
  } finally {
    _tickRunning = false;
  }
}

module.exports = { runAutonomousTick, runProactiveCheck, writeHeartbeat, HEARTBEAT_FILE, isTickRunning: () => _tickRunning };