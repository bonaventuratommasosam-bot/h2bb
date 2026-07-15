// Champion/Challenger shadow mode — simula segnali senza ordini reali
const fs = require('fs');
const path = require('path');
const proEngine = require('./pro-engine');
const risk = require('./risk-manager');
const { DATA_DIR, STRATEGY_FILE } = require('./config/default');
const { sanitizeStrategy, sanitizeParam, isValidPromotionValue } = require('./lib/sanitize-strategy');

const STATE_FILE = path.join(DATA_DIR, 'shadow-state.json');
const SIGNALS_FILE = path.join(DATA_DIR, 'shadow-signals.jsonl');
const CHANGELOG_FILE = path.join(DATA_DIR, 'strategy-changelog.jsonl');

const TRADES_FOR_COMPARE = 5;
const PROMOTION_PF_MARGIN = 1.10;
const MIN_NOTIONAL_USD = parseFloat(process.env.MIN_NOTIONAL_USD) || 10;

// Parametri testati in rotazione (1 alla volta)
const PARAM_TESTS = [
  { key: 'minConfidenceScore', delta: 5, min: 30, max: 75 },
  { key: 'atrStopMultiplier', delta: 0.5, min: 1, max: 4 },
  { key: 'atrTp1Multiplier', delta: 0.5, min: 1, max: 5 },
  { key: 'intervalMinutes', delta: 15, min: 15, max: 120 },
];

const TRACKED_KEYS = PARAM_TESTS.map((p) => p.key);

const DEFAULT_STATE = {
  championParams: {},
  challengerParams: {},
  championTrades: [],
  challengerSignals: [],
  challengerClosedTrades: [],
  currentTestParam: null,
  testParamIndex: 0,
  testDirection: 1,
  promotionCount: 0,
  lastPromotionAt: null,
  promotionHistory: {},
  tradesSinceComparison: 0,
  virtualPosition: {
    amount: 0,
    entryPrice: 0,
    tp1Taken: false,
    trailingPeak: null,
    lastTradeAt: null,
    scaleInPending: false,
    positionLeg: null,
  },
  postPromotionTrades: [],
  postPromotionBaselinePF: null,
  lastPromotedParam: null,
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) };
    }
  } catch (e) {
    console.error('[SHADOW] load state:', e.message);
  }
  return { ...DEFAULT_STATE, virtualPosition: { ...DEFAULT_STATE.virtualPosition } };
}

function saveState(state) {
  try {
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    console.error('[SHADOW] save state:', e.message);
  }
}

function appendJsonl(file, entry) {
  try {
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (e) {
    console.error('[SHADOW] append jsonl:', e.message);
  }
}

function toTs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  const p = Date.parse(v);
  return Number.isFinite(p) ? p : 0;
}

function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

function snapshotParams(strategy) {
  const snap = {};
  for (const key of TRACKED_KEYS) {
    // SANITIZE: non fidarsi mai del valore su disco — se corrotto, usa il range minimo
    snap[key] = sanitizeParam(key, strategy[key]);
  }
  return snap;
}

function getCurrentTest(state) {
  const idx = state.testParamIndex % PARAM_TESTS.length;
  return { ...PARAM_TESTS[idx], index: idx };
}

function buildChallengerParams(championParams, state) {
  const test = getCurrentTest(state);
  const base = championParams[test.key];
  if (base == null) return { ...championParams };
  const dir = state.testDirection >= 0 ? 1 : -1;
  const next = { ...championParams };
  next[test.key] = clamp(base + test.delta * dir, test.min, test.max);
  return next;
}

function profitFactor(trades) {
  if (!trades?.length) return 0;
  const grossWin = trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
  if (grossLoss === 0) return grossWin > 0 ? 99 : 0;
  return grossWin / grossLoss;
}

function buildShadowStrategy(liveStrategy, challengerParams, virtual) {
  return {
    ...liveStrategy,
    ...challengerParams,
    trailingPeak: virtual.trailingPeak,
    tp1Taken: virtual.tp1Taken,
    lastTradeAt: virtual.lastTradeAt,
    scaleInPending: virtual.scaleInPending,
    positionLeg: virtual.positionLeg,
    active: true,
  };
}

// Replica la logica decisionale di pro-engine.runTick senza I/O di mercato
function computeShadowSignal(analysis, shadowStrategy, virtual, price, equity, cash) {
  const pair = shadowStrategy.pair;
  const position = virtual.amount || 0;
  const hasPosition = Math.abs(position) > 1e-9;
  const entryPrice = virtual.entryPrice || 0;
  const intervalMs = (shadowStrategy.intervalMinutes || 30) * 60_000;
  const canTrade = Date.now() - toTs(virtual.lastTradeAt) >= intervalMs;

  const entryScore = proEngine.scoreEntry(analysis, shadowStrategy);
  const minScore = entryScore.effectiveMin ?? shadowStrategy.minConfidenceScore ?? 65;

  let signal;
  if (hasPosition && entryPrice > 0) {
    const exit = proEngine.scoreExit(analysis, position, entryPrice, price, shadowStrategy);
    if (exit.updateTrailingPeak != null) virtual.trailingPeak = exit.updateTrailingPeak;
    else if (price > (virtual.trailingPeak || 0)) virtual.trailingPeak = price;

    if (shadowStrategy.scaleInPending && exit.action === 'hold' && entryScore.score >= minScore + 5) {
      signal = { action: 'add', reason: `scale-in ${entryScore.score}/${minScore}`, score: entryScore.score };
    } else {
      signal = {
        action: exit.action,
        reason: exit.reason,
        score: exit.urgency,
        partial: exit.partial,
        partialPercent: exit.partialPercent,
      };
    }
  } else if (!canTrade) {
    signal = { action: 'hold', reason: 'cooldown tra trade', score: entryScore.score };
  } else if (entryScore.bias === 'blocked') {
    signal = { action: 'hold', reason: entryScore.signals[0] || 'bloccato', score: 0 };
  } else if (entryScore.bias === 'long') {
    signal = {
      action: 'buy',
      reason: `confluenza ${entryScore.score}/${minScore} [${entryScore.regime}]: ${entryScore.signals.join(', ')}`,
      score: entryScore.score,
    };
  } else {
    signal = {
      action: 'hold',
      reason: `score ${entryScore.score}/${minScore} [${entryScore.regime}]`,
      score: entryScore.score,
    };
  }

  return { signal, entryScore, pair, hasPosition, entryPrice, position };
}

function applyVirtualSell(virtual, price, partial, partialPercent) {
  const fraction = partial ? (partialPercent ?? 50) / 100 : 1;
  const sellAmount = Math.abs(virtual.amount) * fraction;
  const entry = virtual.entryPrice || price;
  const pnl = (price - entry) * sellAmount;
  const pnlPercent = entry > 0 ? ((price - entry) / entry) * 100 : 0;

  virtual.amount = Math.max(0, Math.abs(virtual.amount) - sellAmount);
  if (virtual.amount < 1e-9) {
    virtual.amount = 0;
    virtual.entryPrice = 0;
    virtual.tp1Taken = false;
    virtual.trailingPeak = null;
    virtual.positionLeg = null;
    virtual.scaleInPending = false;
  } else if (partial) {
    virtual.tp1Taken = true;
  }

  virtual.lastTradeAt = Date.now();
  return {
    type: 'sell',
    amount: sellAmount,
    price,
    pnl,
    pnlPercent,
    partial,
    closed: virtual.amount < 1e-9,
  };
}

function applyVirtualBuy(virtual, price, amount) {
  virtual.amount = amount;
  virtual.entryPrice = price;
  virtual.tp1Taken = false;
  virtual.trailingPeak = price;
  virtual.positionLeg = 'full';
  virtual.scaleInPending = false;
  virtual.lastTradeAt = Date.now();
  return { type: 'buy', amount, price };
}

function recordChampionTrade(state, trade) {
  const entry = {
    id: trade.id || Date.now().toString(36),
    timestamp: trade.timestamp || new Date().toISOString(),
    pair: trade.pair,
    pnl: trade.pnl,
    pnlPercent: trade.pnlPercent,
    price: trade.price,
    amount: trade.amount,
  };
  state.championTrades.push(entry);
  if (state.championTrades.length > 20) state.championTrades = state.championTrades.slice(-20);

  state.tradesSinceComparison = (state.tradesSinceComparison || 0) + 1;

  // MODE-GATE: solo trade LIVE alimentano il rollback — demo/simulati non devono
  // mai innescare un revert dei parametri promossi (altrimenti drift da dati finti)
  const isLiveTrade = trade && trade.mode === 'live';
  if (state.postPromotionBaselinePF != null && isLiveTrade) {
    state.postPromotionTrades.push(entry);
    if (state.postPromotionTrades.length > TRADES_FOR_COMPARE) {
      state.postPromotionTrades = state.postPromotionTrades.slice(-TRADES_FOR_COMPARE);
    }
    checkPostPromotionAlert(state);
  }
}

function recordChallengerSignal(state, payload) {
  state.challengerSignals.push(payload);
  if (state.challengerSignals.length > 50) state.challengerSignals = state.challengerSignals.slice(-50);
}

function rotateTestParam(state) {
  const test = getCurrentTest(state);
  if (state.testDirection >= 0) {
    state.testDirection = -1;
  } else {
    state.testDirection = 1;
    state.testParamIndex = (state.testParamIndex + 1) % PARAM_TESTS.length;
  }
  state.tradesSinceComparison = 0;
  state.challengerClosedTrades = [];
  state.currentTestParam = getCurrentTest(state).key;
  state.championParams = state.championParams || {};
  state.challengerParams = buildChallengerParams(state.championParams, state);
}

function promoteParam(state, liveStrategy, testKey, newValue, championPF, challengerPF) {
  // SAFETY: rifiuta valori non-finiti o fuori range — mai persistere NaN/Inf su strategy.json
  if (!isValidPromotionValue(testKey, newValue)) {
    console.error('[SHADOW] promozione bloccata: ' + testKey + ' = ' + newValue + ' non valido');
    return false;
  }
  const oldValue = liveStrategy[testKey];
  // DECAY/FOGET: traccia il valore precedente per poter retrocedere se la promozione fallisce
  if (!(testKey in (state.promotionHistory || {}))) {
    state.promotionHistory = state.promotionHistory || {};
    state.promotionHistory[testKey] = oldValue;
  }
  liveStrategy[testKey] = newValue;
  liveStrategy.updatedAt = new Date().toISOString();

  try {
    const strategyOnDisk = JSON.parse(fs.readFileSync(STRATEGY_FILE, 'utf-8'));
    strategyOnDisk[testKey] = newValue;
    strategyOnDisk.updatedAt = liveStrategy.updatedAt;
    const tmp = STRATEGY_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(strategyOnDisk, null, 2));
    fs.renameSync(tmp, STRATEGY_FILE);
  } catch (e) {
    console.error('[SHADOW] aggiornamento strategy.json:', e.message);
  }

  appendJsonl(CHANGELOG_FILE, {
    type: 'promotion',
    at: new Date().toISOString(),
    param: testKey,
    oldValue,
    newValue,
    championPF: Math.round(championPF * 100) / 100,
    challengerPF: Math.round(challengerPF * 100) / 100,
    promotionCount: (state.promotionCount || 0) + 1,
    testDirection: state.testDirection,
  });

  // MEMORIA STRUTTURATA: annota il PERCHE della promozione in formato leggibile
  try {
    const fs = require('fs');
    const path = require('path');
    const learnDir = path.join(DATA_DIR, 'memory');
    if (!fs.existsSync(learnDir)) fs.mkdirSync(learnDir, { recursive: true });
    const learnFile = path.join(learnDir, 'learnings.md');
    const pct = championPF > 0 ? Math.round((challengerPF / championPF - 1) * 100) : 0;
    const entry = [
      '',
      '## ' + new Date().toISOString().slice(0, 10) + ' - Promozione: ' + testKey,
      '- **Parametro:** ' + testKey,
      '- **Valore:** ' + oldValue + ' -> ' + newValue,
      '- **Profit Factor:** champion ' + (Math.round(championPF * 100) / 100) + ' -> challenger ' + (Math.round(challengerPF * 100) / 100),
      '- **Miglioramento:** ' + pct + '%',
      '- **Pair:** ' + (liveStrategy.pair || 'ETH'),
      '- **Motivo:** il challenger ha battuto il champion di oltre il 10% sul profit factor su ' + TRADES_FOR_COMPARE + ' trade chiusi.',
      '- **Stato:** ATTIVO su strategy.json',
      '',
    ].join(String.fromCharCode(10));
    fs.appendFileSync(learnFile, entry, 'utf-8');
  } catch (e) {
    console.error('[SHADOW] scrittura memory/learnings.md:', e.message);
  }

  state.promotionCount = (state.promotionCount || 0) + 1;
  state.lastPromotionAt = new Date().toISOString();
  state.lastPromotedParam = testKey;
  state.postPromotionBaselinePF = championPF;
  state.postPromotionTrades = [];
  state.championParams = snapshotParams(liveStrategy);

  // Reset virtual challenger dopo promozione
  state.virtualPosition = { ...DEFAULT_STATE.virtualPosition };
  state.challengerClosedTrades = [];
  state.tradesSinceComparison = 0;
  rotateTestParam(state);

  console.log(`[SHADOW] PROMOZIONE ${testKey}: ${oldValue} → ${newValue} (PF ${championPF.toFixed(2)} → ${challengerPF.toFixed(2)})`);
}

function checkPostPromotionAlert(state) {
  if (state.postPromotionTrades.length < TRADES_FOR_COMPARE) return;
  if (state.postPromotionBaselinePF == null) return;

  const postPF = profitFactor(state.postPromotionTrades);
  if (postPF >= state.postPromotionBaselinePF) return;

  const pKey = state.lastPromotedParam;
  appendJsonl(CHANGELOG_FILE, {
    type: 'rollback_alert',
    at: new Date().toISOString(),
    param: pKey,
    reason: 'PF peggiorato nei 5 trade post-promozione',
    baselinePF: Math.round(state.postPromotionBaselinePF * 100) / 100,
    postPromotionPF: Math.round(postPF * 100) / 100,
    trades: state.postPromotionTrades.length,
    note: 'Rollback AUTOMATICO eseguito',
  });

  // DECAY/FOGET: retrocedi il parametro al valore pre-promozione (se disponibile)
  try {
    const prev = state.promotionHistory ? state.promotionHistory[pKey] : undefined;
    if (prev !== undefined && isValidPromotionValue(pKey, prev)) {
      const strategyOnDisk = JSON.parse(fs.readFileSync(STRATEGY_FILE, 'utf-8'));
      const reverted = strategyOnDisk[pKey];
      strategyOnDisk[pKey] = prev;
      strategyOnDisk.updatedAt = new Date().toISOString();
      const tmp = STRATEGY_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(strategyOnDisk, null, 2));
      fs.renameSync(tmp, STRATEGY_FILE);
      console.warn(`[SHADOW] ROLLBACK ${pKey}: ${reverted} -> ${prev} (PF ${postPF.toFixed(2)} < baseline ${state.postPromotionBaselinePF.toFixed(2)})`);
      // annota il fallimento in memoria leggibile
      const path = require('path');
      const learnDir = path.join(DATA_DIR, 'memory');
      if (!fs.existsSync(learnDir)) fs.mkdirSync(learnDir, { recursive: true });
      const learnFile = path.join(learnDir, 'learnings.md');
      const rentry = [
        '',
        '## ' + new Date().toISOString().slice(0, 10) + ' - ROLLBACK: ' + pKey,
        '- **Parametro:** ' + pKey,
        '- **Valore ripristinato:** ' + reverted + ' -> ' + prev,
        '- **Motivo:** PF post-promozione ' + postPF.toFixed(2) + ' < baseline ' + (Math.round(state.postPromotionBaselinePF * 100) / 100),
        '- **Stato:** parametro retrocesso (forget del valore promosso)',
        '',
      ].join(String.fromCharCode(10));
      fs.appendFileSync(learnFile, rentry, 'utf-8');
      // pulisci la history per questo param cosi una futura promozione riparte da zero
      delete state.promotionHistory[pKey];
    } else {
      console.warn(`[SHADOW] ROLLBACK ${pKey}: nessun valore precedente valido, solo reset stato`);
    }
  } catch (e) {
    console.error('[SHADOW] rollback su strategy.json:', e.message);
  }

  state.postPromotionBaselinePF = null;
  state.postPromotionTrades = [];
}

function maybePromote(state, liveStrategy) {
  if ((state.tradesSinceComparison || 0) < TRADES_FOR_COMPARE) return false;
  if (state.championTrades.length < TRADES_FOR_COMPARE) return false;
  if (state.challengerClosedTrades.length < TRADES_FOR_COMPARE) return false;

  const champSlice = state.championTrades.slice(-TRADES_FOR_COMPARE);
  const challSlice = state.challengerClosedTrades.slice(-TRADES_FOR_COMPARE);
  const championPF = profitFactor(champSlice);
  const challengerPF = profitFactor(challSlice);

  const test = getCurrentTest(state);
  const testKey = test.key;
  const challengerValue = state.challengerParams[testKey];

  appendJsonl(CHANGELOG_FILE, {
    type: 'comparison',
    at: new Date().toISOString(),
    param: testKey,
    championPF: Math.round(championPF * 100) / 100,
    challengerPF: Math.round(challengerPF * 100) / 100,
    threshold: Math.round(championPF * PROMOTION_PF_MARGIN * 100) / 100,
    promoted: challengerPF > championPF * PROMOTION_PF_MARGIN,
  });

  if (challengerPF > championPF * PROMOTION_PF_MARGIN) {
    promoteParam(state, liveStrategy, testKey, challengerValue, championPF, challengerPF);
    return true;
  }

  console.log(`[SHADOW] Nessuna promozione ${testKey}: challenger PF ${challengerPF.toFixed(2)} vs champion ${championPF.toFixed(2)}`);
  rotateTestParam(state);
  return false;
}

/**
 * Esegue un tick shadow riusando l'analisi del champion (zero fetch aggiuntivi).
 * @param {object} ctx — stesso tickCtx del live (execute* ignorati)
 * @param {object} championOut — output di proEngine.runTick()
 * @param {number} [price] — prezzo già noto dal tick live
 */
async function runShadowTick(ctx, championOut, price) {
  const t0 = Date.now();
  const liveStrategy = ctx.strategy;
  if (!liveStrategy || liveStrategy.mode !== 'pro') return { skipped: true };
  if (!championOut?.analysis) return { skipped: true, reason: 'no analysis' };

  const state = loadState();
  state.championParams = snapshotParams(liveStrategy);
  if (!state.currentTestParam) state.currentTestParam = getCurrentTest(state).key;
  state.challengerParams = buildChallengerParams(state.championParams, state);

  const analysis = championOut.analysis;
  const pair = liveStrategy.pair;
  const px = price ?? analysis.entry?.price;
  if (!px) return { skipped: true, reason: 'no price' };

  // Registra trade champion chiuso
  const champTrade = championOut?.result?.trade;
  if (championOut?.result?.ok && champTrade?.type === 'sell' && champTrade.pnl != null) {
    recordChampionTrade(state, champTrade);
  }

  const virtual = { ...DEFAULT_STATE.virtualPosition, ...state.virtualPosition };
  // Usa saldo già in memoria — nessuna chiamata HL (overhead <50ms)
  const cash = ctx.balance?.amount ?? 0;
  const equity = cash;
  const shadowStrategy = buildShadowStrategy(liveStrategy, state.challengerParams, virtual);

  const { signal, entryScore, hasPosition } = computeShadowSignal(
    analysis, shadowStrategy, virtual, px, equity, cash,
  );

  let virtualTrade = null;
  let wouldDo = signal.action;

  if (signal.action === 'sell' && hasPosition) {
    virtualTrade = applyVirtualSell(virtual, px, signal.partial, signal.partialPercent);
    wouldDo = `sell ${virtualTrade.partial ? 'parziale' : 'totale'} @ $${px.toFixed(2)}`;
    if (virtualTrade.closed) {
      state.challengerClosedTrades.push({
        timestamp: new Date().toISOString(),
        pair,
        pnl: virtualTrade.pnl,
        pnlPercent: virtualTrade.pnlPercent,
        param: state.currentTestParam,
        challengerParams: { ...state.challengerParams },
      });
      if (state.challengerClosedTrades.length > 20) {
        state.challengerClosedTrades = state.challengerClosedTrades.slice(-20);
      }
    }
  } else if ((signal.action === 'buy' || signal.action === 'add') && (signal.action === 'buy' ? !hasPosition : hasPosition)) {
    const sizing = risk.computeBudgetOrderSize({
      equity, cash, price: px, strategy: shadowStrategy, entryScore,
    });
    const orderAmount = sizing.amount;
    const notional = sizing.usd || orderAmount * px;
    if (orderAmount && notional >= MIN_NOTIONAL_USD) {
      virtualTrade = applyVirtualBuy(virtual, px, orderAmount);
      wouldDo = `buy ${orderAmount.toFixed(4)} ${pair} @ $${px.toFixed(2)}`;
    } else {
      wouldDo = 'hold (size insufficiente)';
    }
  } else {
    wouldDo = `${signal.action}: ${signal.reason || 'n/d'}`;
  }

  const logEntry = {
    at: new Date().toISOString(),
    pair,
    price: px,
    wouldDo,
    signal: signal.action,
    reason: signal.reason,
    testParam: state.currentTestParam,
    challengerParams: state.challengerParams,
    virtualPosition: virtual.amount,
    latencyMs: Date.now() - t0,
  };
  appendJsonl(SIGNALS_FILE, logEntry);
  recordChallengerSignal(state, logEntry);

  state.virtualPosition = virtual;
  const promoted = maybePromote(state, liveStrategy);
  saveState(state);

  return {
    ok: true,
    wouldDo,
    testParam: state.currentTestParam,
    latencyMs: logEntry.latencyMs,
    promoted: !!promoted,
  };
}

module.exports = { runShadowTick, loadState, profitFactor, PARAM_TESTS };