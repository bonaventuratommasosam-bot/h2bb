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

/**
 * If user opened a position manually (or pair drifted), sync strategy to manage it:
 * pair, absolute TP/SL from entry, trailing reset.
 */
async function adoptOpenPositionIfNeeded(position, price) {
  try {
    if (!position || Math.abs(position) < 1e-9) return;
    const entryPx = await getEntryPrice(shared.strategy.pair);
    if (!(entryPx > 0) || !(price > 0)) return;

    const tpPct = Number(shared.strategy.takeProfitPercent) || 2.5;
    const slPct = Number(shared.strategy.stopLossPercent) || 1.5;
    const wantTp = Math.round(entryPx * (1 + tpPct / 100) * 100) / 100;
    const wantSl = Math.round(entryPx * (1 - slPct / 100) * 100) / 100;
    let patched = false;

    // Refresh TP/SL if missing or far from this entry (manual open / re-entry)
    const tp = Number(shared.strategy.takeProfit);
    if (!tp || Math.abs(tp - wantTp) / wantTp > 0.01) {
      shared.strategy.takeProfit = wantTp;
      shared.strategy.takeProfitPercent = tpPct;
      patched = true;
    }
    const sl = Number(shared.strategy.stopLoss);
    if (!sl || Math.abs(sl - wantSl) / wantSl > 0.01) {
      shared.strategy.stopLoss = wantSl;
      shared.strategy.stopLossPercent = slPct;
      patched = true;
    }
    if (shared.strategy.positionLeg == null) {
      shared.strategy.positionLeg = 'full';
      patched = true;
    }
    // Ensure exit AI on for management
    if (shared.strategy.aiExitEnabled === false) {
      shared.strategy.aiExitEnabled = true;
      patched = true;
    }
    if (patched) {
      console.log(
        `[ADOPT] Managing open ${shared.strategy.pair} size=${position} entry=${entryPx} `
        + `TP=${shared.strategy.takeProfit} SL=${shared.strategy.stopLoss}`
      );
      try { require('../state/strategy').saveStrategy(); } catch { /* ignore */ }
    }
  } catch (e) {
    console.error('[ADOPT]', e.message);
  }
}

async function _runTickInternal() {
  if (!shared.strategy.active) return;

  const position = await getPositionSize(shared.strategy.pair);
  // REMOVED: auto-unblock when flat + daily/drawdown CB.
  // Sticky CB stays until new day (daily) or explicit operator resume (drawdown).

  const price = await getPrice(shared.strategy.pair);
  // Always manage open HL positions (manual or bot) with TP/SL/exit AI
  if (Math.abs(position) > 1e-9) {
    await adoptOpenPositionIfNeeded(position, price);
  }
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
  // Fixed % TP even without absolute takeProfit price
  if (position && Math.abs(position) > 1e-9 && shared.strategy.takeProfitPercent) {
    try {
      const entryPx = await getEntryPrice(shared.strategy.pair);
      const tpPct = Number(shared.strategy.takeProfitPercent);
      if (entryPx > 0 && Number.isFinite(tpPct) && tpPct > 0) {
        const movePct = position > 0
          ? ((price - entryPx) / entryPx) * 100
          : ((entryPx - price) / entryPx) * 100;
        if (movePct >= tpPct) {
          console.log(`[TAKE-PROFIT %] ${shared.strategy.pair} +${movePct.toFixed(2)}% ≥ ${tpPct}%`);
          const tpRes = await executeMarketSell(shared.strategy.pair, 1);
          if (tpRes.ok && riskManager.canAutoResumeTrading(shared.riskState)) {
            await resumeTradingAfterEngineClose();
          }
          writeHeartbeat({ price });
          return;
        }
      }
    } catch (e) {
      console.error('[TAKE-PROFIT %]', e.message);
    }
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

  // ── AI decision layer: gestisce strategia ogni tick (degen) o solo su buy deferred ──
  const { isDegenMode, getAiEnterMinConfidence } = require('../lib/ai-mode');
  const degen = isDegenMode(shared.strategy);
  const enterMinConf = getAiEnterMinConfidence(shared.strategy);
  const wantAiLayer = shared.strategy.mode === 'pro'
    && shared.strategy.active
    && !out?.blocked
    && (
      (out?.deferred && out?.sizing)
      || (degen && out?.analysis) // degen: AI always steers strategy + may force entry
    );

  if (wantAiLayer) {
    const signal = out.signal || { action: 'hold' };
    const analysis = out.analysis;
    const entryScore = out.entryScore
      || (analysis ? proEngine.scoreEntry(analysis, shared.strategy) : null);

    // Self-learning pre-tune (skipped in super_degen — would defang aggression)
    try {
      if (
        analysis
        && entryScore
        && !shared.strategy.skipConservativeSelfLearn
        && shared.strategy.aiMode !== 'super_degen'
      ) {
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
    report.aiMode = shared.strategy.aiMode || (degen ? 'degen' : 'balanced');
    report.enterMinConfidence = enterMinConf;

    const aiDecision = await conversationAgent.evaluateDecision(report, shared.strategy);

    // Apply strategyChanges — AI owns params within hard caps + score clamp
    if (aiDecision.strategyChanges) {
      const { clampAiMinScore, lockOperatorMinScore } = require('../lib/ai-autonomy');
      const { sanitizeStrategy } = require('../lib/sanitize-strategy');
      lockOperatorMinScore(shared.strategy);
      let patched = false;
      const patchable = [
        'minConfidenceScore', 'rsiOversold', 'rsiOverbought',
        'atrStopMultiplier', 'riskPerTradePercent', 'maxPositionPercent',
      ];
      for (const [k, v] of Object.entries(aiDecision.strategyChanges)) {
        if (v == null) continue;
        if (!patchable.includes(k) && shared.strategy[k] === undefined) continue;
        let val = Number(v);
        if (!Number.isFinite(val)) continue;
        if (k === 'riskPerTradePercent') {
          val = Math.max(0.1, Math.min(parseFloat(process.env.HARD_CAP_RISK_PER_TRADE) || 1.0, val));
        }
        if (k === 'maxPositionPercent') {
          val = Math.max(5, Math.min(parseFloat(process.env.HARD_CAP_MAX_POSITION) || 25, val));
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
        shared.strategy = sanitizeStrategy(shared.strategy);
        console.log(`[AI-DECISION] strategy patched (mode=${shared.strategy.aiMode}) — ${aiDecision.reason}`);
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
      const wantsBuy = aiDecision.decision === 'enter' || aiDecision.decision === 'add'
        || (signal.action === 'add' && aiDecision.decision === 'enter');
      const enterOk = wantsBuy && conf >= enterMinConf && approved;

      if (aiDecision.decision === 'ta_fallback') {
        console.log(`[AI-DECISION] ta_fallback — eseguo buy TA`);
        const res = await executeMarketBuy(shared.strategy.pair, out.sizing.amount);
        if (res.ok) {
          shared.strategy.lastTradeAt = Date.now();
          shared.strategy.lastSignal = signal;
          shared.strategy.tp1Taken = false;
          shared.strategy.trailingPeak = out.price ?? price;
          shared.strategy.positionLeg = signal.action === 'add' ? 'add' : 'full';
          shared.strategy.scaleInPending = signal.action === 'buy';
          if (res.trade) notifyOwner(null, null, res.trade, signal);
        }
      } else if (enterOk && out.sizing?.amount) {
        console.log(`[AI-DECISION] ${signal.action.toUpperCase()} conf=${conf}≥${enterMinConf} — ${aiDecision.reason}`);
        const res = await executeMarketBuy(shared.strategy.pair, out.sizing.amount);
        if (res.ok) {
          shared.strategy.lastTradeAt = Date.now();
          shared.strategy.lastSignal = { ...signal, reason: `${signal.reason} | AI:${aiDecision.reason}`, aiConfidence: conf };
          shared.strategy.tp1Taken = false;
          shared.strategy.trailingPeak = out.price ?? price;
          shared.strategy.positionLeg = signal.action === 'add' ? 'add' : 'full';
          // After first entry, allow AI/TA scale-in later
          if (signal.action === 'buy') shared.strategy.scaleInPending = true;
          if (res.trade) notifyOwner(null, null, res.trade, shared.strategy.lastSignal);
        } else {
          console.log(`[AI-DECISION] Buy fallito: ${res.error}`);
        }
      } else {
        console.log(`[AI-DECISION] SKIP buy decision=${aiDecision.decision} conf=${conf} (need≥${enterMinConf}) — ${aiDecision.reason}`);
        shared.strategy.lastSignal = { action: 'hold', reason: `AI ${aiDecision.decision}: ${aiDecision.reason}`, score: conf };
      }
    } else if (
      // AI force: open (flat) OR scale-in (already long) when degen + conf ok
      degen
      && shared.strategy.aiForceEntryEnabled !== false
      && (aiDecision.decision === 'enter' || aiDecision.decision === 'add')
      && (aiDecision.confidence ?? 0) >= enterMinConf
      && aiDecision.entryOverride?.approved !== false
      && riskManager.checkCanTrade(shared.strategy, shared.riskState, equityNow).allowed
    ) {
      try {
        const px = out.price ?? price;
        const hasPos = Math.abs(posNow) > 1e-9;
        // add while flat → treat as open; enter while long → scale-in if enabled
        // Profit mode: never scale-in when underwater
        let allowAdd = shared.strategy.scaleInEnabled !== false
          || shared.strategy.scaleInOnlyInProfit === true;
        if (hasPos && posNow > 0 && (shared.strategy.profitPriority || shared.strategy.aiMode === 'profit' || shared.strategy.scaleInOnlyInProfit)) {
          try {
            const entryPx = await getEntryPrice(shared.strategy.pair);
            const pxNow = out.price ?? price;
            if (entryPx > 0 && pxNow > 0 && pxNow < entryPx) {
              allowAdd = false; // no add in loss
            } else if (entryPx > 0 && pxNow >= entryPx) {
              allowAdd = true; // only-in-profit scale-in ok
            }
          } catch { /* keep allowAdd */ }
        }
        const isAdd = hasPos && posNow > 0 && allowAdd && (
          aiDecision.decision === 'add'
          || (aiDecision.decision === 'enter' && shared.strategy.scaleInEnabled !== false)
        );
        const isOpen = !hasPos && (aiDecision.decision === 'enter' || aiDecision.decision === 'add');

        if (hasPos && posNow < 0) {
          console.log('[AI-DECISION] skip force buy — short position not supported for AI add');
        } else if (hasPos && !isAdd) {
          console.log(`[AI-DECISION] ${aiDecision.decision} conf=${aiDecision.confidence} — already in position, no add`);
        } else if (!isAdd && !isOpen) {
          console.log(`[AI-DECISION] skip force — flat and decision=${aiDecision.decision}`);
        } else {
          // Size: full budget when flat; fraction of room when scaling in (leverage-aware)
          let sizing = riskManager.computeBudgetOrderSize({
            equity: equityNow,
            cash: shared.balance?.amount ?? equityNow,
            price: px,
            strategy: shared.strategy,
            entryScore: entryScore || { score: aiDecision.confidence },
            positionSize: isAdd ? posNow : 0,
          });
          if (isAdd && sizing.amount > 0) {
            // Scale-in clip: 50–70% of allowed room size
            const frac = shared.strategy.aiMode === 'super_degen' ? 0.7 : 0.5;
            const usd = Math.floor((sizing.usd || 0) * frac * 100) / 100;
            const minN = parseFloat(process.env.MIN_NOTIONAL_USD) || 11;
            if (usd + 1e-9 < minN) {
              // keep full room size if fraction too small but room ok
              if ((sizing.usd || 0) >= minN) {
                /* keep sizing as-is */
              } else {
                sizing = { amount: 0, usd: 0, reason: sizing.reason || 'scale-in too small' };
              }
            } else {
              sizing = {
                usd,
                amount: usd / px,
                reason: 'ai_scale_in',
              };
            }
          }

          const minN = parseFloat(process.env.MIN_NOTIONAL_USD) || 11;
          if (sizing.amount > 0 && sizing.usd >= minN) {
            const tag = isAdd ? 'SCALE-IN' : 'FORCE ENTER';
            console.log(`[AI-DECISION] DEGEN ${tag} conf=${aiDecision.confidence} size=${sizing.amount.toFixed(4)} ($${sizing.usd}) — ${aiDecision.reason}`);
            const res = await executeMarketBuy(shared.strategy.pair, sizing.amount);
            if (res.ok) {
              shared.strategy.lastTradeAt = Date.now();
              shared.strategy.lastSignal = {
                action: isAdd ? 'add' : 'buy',
                reason: `AI degen ${isAdd ? 'scale-in' : 'force'}: ${aiDecision.reason}`,
                score: aiDecision.confidence,
                reasonCode: isAdd ? 'ai_degen_add' : 'ai_degen_enter',
              };
              shared.strategy.tp1Taken = false;
              shared.strategy.trailingPeak = px;
              shared.strategy.positionLeg = isAdd ? 'add' : 'full';
              shared.strategy.scaleInPending = true;
              shared.strategy.scaleInEnabled = true;
              if (res.trade) notifyOwner(null, null, res.trade, shared.strategy.lastSignal);
            } else {
              console.log(`[AI-DECISION] Degen ${tag} fallito: ${res.error}`);
            }
          } else {
            console.log(`[AI-DECISION] Degen ${isAdd ? 'add' : 'enter'} skip size: ${sizing.reason || 'insufficient'}`);
          }
        }
      } catch (e) {
        console.error('[AI-DECISION] degen force enter/add:', e.message);
      }
    } else if (aiDecision.decision === 'adapt' || aiDecision.decision === 'hold') {
      console.log(`[AI-DECISION] ${aiDecision.decision} conf=${aiDecision.confidence} — ${aiDecision.reason}`);
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