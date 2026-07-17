// Gestione rischio per capitale reale — limiti, sizing, circuit breaker
const fs = require('fs');
const path = require('path');
const { DATA_DIR, MIN_NOTIONAL_USD: MIN_NOTIONAL_CFG } = require('./config/default');
const { HARD_CAPS } = require('./lib/hard-caps');

const RISK_FILE = path.join(DATA_DIR, 'risk-state.json');
const MIN_NOTIONAL_USD = MIN_NOTIONAL_CFG || 10;

const DEFAULT_RISK_STATE = {
  dayKey: null,
  dayStartEquity: null,
  dayPnl: 0,
  peakEquity: null,
  consecutiveLosses: 0,
  cooldownUntil: null,
  circuitBreaker: false,
  circuitReason: null,
  /** stickyKind: 'daily' | 'drawdown' | null — daily clears only on new day; drawdown needs operator */
  stickyKind: null,
  lastUpdated: null,
};

function isDailyLossReason(reason) {
  return /giornalier|daily\s*loss|perdita\s*giornal/i.test(String(reason || ''));
}

function isDrawdownReason(reason) {
  return /drawdown|picco/i.test(String(reason || ''));
}

/**
 * Auto-resume / baseline reset are forbidden while sticky CB is active.
 * Daily sticky expires on calendar day roll (handled in resetDayIfNeeded).
 * Drawdown sticky requires explicit operator clear (forceClearSticky).
 */
function canAutoResumeTrading(state) {
  if (!state) return true;
  if (!state.circuitBreaker) return true;
  // Any active CB blocks auto-resume of new risk-taking
  return false;
}

function isStickyCircuitBreaker(state) {
  return !!(state && state.circuitBreaker && state.stickyKind);
}

function loadRiskState() {
  try {
    if (fs.existsSync(RISK_FILE)) {
      return { ...DEFAULT_RISK_STATE, ...JSON.parse(fs.readFileSync(RISK_FILE, 'utf-8')) };
    }
  } catch {}
  return { ...DEFAULT_RISK_STATE };
}

function saveRiskState(state) {
  state.lastUpdated = new Date().toISOString();
  // FIX RACE: write su tmp + rename atomico (POSIX) per evitare file
  // parzialmente scritto se il processo muore a metà writeFileSync.
  const tmp = RISK_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, RISK_FILE);
}

function dayKeyNow() {
  return new Date().toISOString().slice(0, 10);
}

function resetDayIfNeeded(state, equity) {
  const dk = dayKeyNow();
  if (state.dayKey !== dk) {
    const prevKey = state.dayKey;
    state.dayKey = dk;
    state.dayStartEquity = equity;
    state.dayPnl = 0;
    // New calendar day: clear *daily* sticky CB only (not drawdown sticky)
    if (
      state.circuitBreaker
      && (state.stickyKind === 'daily' || isDailyLossReason(state.circuitReason))
    ) {
      console.log(`[RISK] New day ${dk} (was ${prevKey}) — clearing daily circuit breaker`);
      state.circuitBreaker = false;
      state.circuitReason = null;
      state.stickyKind = null;
    }
  }
  if (state.peakEquity == null || equity > state.peakEquity) {
    state.peakEquity = equity;
  }
  return state;
}

function checkCanTrade(strategy, state, equity) {
  const s = resetDayIfNeeded({ ...state }, equity);
  const reasons = [];

  if (s.circuitBreaker) {
    return { allowed: false, state: s, reasons: [s.circuitReason || 'circuit breaker attivo'] };
  }

  if (s.cooldownUntil && Date.now() < s.cooldownUntil) {
    const mins = Math.ceil((s.cooldownUntil - Date.now()) / 60000);
    return { allowed: false, state: s, reasons: [`cooldown dopo perdite (${mins} min rimasti)`] };
  }

  // Hard caps: non superare mai i ceiling di sicurezza anche se strategy è più larga
  const maxDaily = Math.min(strategy.maxDailyLossPercent ?? 2, HARD_CAPS.maxDailyLossPercent);
  if (s.dayStartEquity > 0) {
    const dayLossPct = ((equity - s.dayStartEquity) / s.dayStartEquity) * 100;
    s.dayPnl = equity - s.dayStartEquity;
    if (dayLossPct <= -maxDaily) {
      s.circuitBreaker = true;
      s.stickyKind = 'daily';
      s.circuitReason = `perdita giornaliera ${dayLossPct.toFixed(2)}% (limite -${maxDaily}%)`;
      // FIX BUG1: NON salvare qui — lo stato è ritornato e il chiamante
      // (pro-engine/autonomous-engine) fa saveRiskState. Evita doppia write.
      return { allowed: false, state: s, reasons: [s.circuitReason] };
    }
  }

  const maxDd = Math.min(strategy.maxDrawdownPercent ?? 8, HARD_CAPS.maxDrawdownPercent);
  if (s.peakEquity > 0) {
    const dd = ((equity - s.peakEquity) / s.peakEquity) * 100;
    if (dd <= -maxDd) {
      s.circuitBreaker = true;
      s.stickyKind = 'drawdown';
      s.circuitReason = `drawdown ${dd.toFixed(2)}% dal picco (limite -${maxDd}%)`;
      // FIX BUG1: idem, niente save interno
      return { allowed: false, state: s, reasons: [s.circuitReason] };
    }
  }

  return { allowed: true, state: s, reasons };
}

function recordTradeResult(state, pnl, strategy) {
  const s = { ...state };
  if (pnl < 0) {
    s.consecutiveLosses = (s.consecutiveLosses || 0) + 1;
    const limit = strategy.consecutiveLossLimit ?? 3;
    if (s.consecutiveLosses >= limit) {
      const mins = strategy.lossCooldownMinutes ?? 240;
      s.cooldownUntil = Date.now() + mins * 60_000;
      s.consecutiveLosses = 0;
    }
  } else if (pnl > 0) {
    s.consecutiveLosses = 0;
  }
  // NOTE: pnl === 0 (break-even) non tocca consecutiveLosses — intenzionale.
  saveRiskState(s);
  return s;
}

function computeBudgetOrderSize({
  equity, cash, price, strategy, entryScore,
  positionSize = 0, leverage = null,
}) {
  // FIX: usa costante condivisa invece di MIN_NOTIONAL = 10 hardcoded
  const reservePct = strategy.cashReservePercent ?? 8;
  const budget = Math.min(equity || cash || 0, cash || equity || 0);
  const available = budget * (1 - reservePct / 100);
  if (!price || available < MIN_NOTIONAL_USD) {
    return { amount: 0, usd: 0, deployFraction: 0, reason: 'budget insufficiente' };
  }

  const minScore = strategy.minConfidenceScore ?? 52;
  const score = entryScore?.score ?? minScore;
  let deployFraction;
  if (strategy.budgetDeployPercent != null) {
    deployFraction = Math.min(0.95, strategy.budgetDeployPercent / 100);
  } else {
    const extra = Math.max(0, score - minScore);
    deployFraction = Math.min(0.92, 0.55 + extra * 0.02);
  }

  // Risk $ for this clip (notional of order, pre-leverage semantics for HL market size)
  const riskPct = Math.min(strategy.riskPerTradePercent ?? 0.5, HARD_CAPS.riskPerTradePercent) / 100;
  let usd = Math.min(available * deployFraction, budget * Math.max(riskPct * 4, 0.15));

  // Cap by remaining room under maxPosition (margin-aware, levered notional)
  try {
    const { computePositionRoom } = require('./lib/position-room');
    const room = computePositionRoom({
      equity: budget,
      price,
      positionSize,
      strategy,
      leverage,
    });
    if (room.roomNotionalUsd + 1e-9 < MIN_NOTIONAL_USD && Math.abs(positionSize) > 1e-12) {
      return {
        amount: 0,
        usd: 0,
        deployFraction,
        budget,
        available,
        room,
        reason: `no room (notional $${room.currentNotionalUsd} / max $${room.maxNotionalUsd} @ ${room.leverage}x)`,
      };
    }
    if (room.roomNotionalUsd > 0) {
      usd = Math.min(usd, room.roomNotionalUsd);
    } else {
      // flat: first entry limited by max notional
      usd = Math.min(usd, room.maxNotionalUsd || usd);
    }
  } catch {
    const maxPosPct = Math.min(strategy.maxPositionPercent ?? 20, HARD_CAPS.maxPositionPercent) / 100;
    usd = Math.min(usd, budget * maxPosPct);
  }

  // Always try to meet exchange min notional with buffer (MIN_NOTIONAL_USD default 11)
  if (usd < MIN_NOTIONAL_USD) {
    usd = Math.min(MIN_NOTIONAL_USD, available);
  }
  // Round down to cents then ensure still >= min after float noise
  usd = Math.floor(usd * 100) / 100;
  if (usd + 1e-9 < MIN_NOTIONAL_USD) {
    if (available >= MIN_NOTIONAL_USD) {
      usd = MIN_NOTIONAL_USD;
    } else {
      return {
        amount: 0,
        usd: 0,
        deployFraction,
        budget,
        available,
        reason: `sotto minimo exchange $${MIN_NOTIONAL_USD} (avail $${available.toFixed(2)})`,
      };
    }
  }

  return {
    usd: Math.round(usd * 100) / 100,
    amount: usd / price,
    deployFraction,
    budget,
    available,
  };
}

function computePositionSize({ equity, price, atr, strategy }) {
  const riskPct = Math.min(strategy.riskPerTradePercent ?? 0.5, HARD_CAPS.riskPerTradePercent) / 100;
  const maxPosPct = Math.min(strategy.maxPositionPercent ?? 20, HARD_CAPS.maxPositionPercent) / 100;
  const atrMult = strategy.atrStopMultiplier ?? 2;
  const stopDistance = (atr || price * 0.02) * atrMult;
  if (!price || stopDistance <= 0) return { usd: 0, amount: 0, stopDistance };

  const riskUsd = equity * riskPct;
  let amount = riskUsd / stopDistance;
  let usd = amount * price;

  const maxUsd = equity * maxPosPct;
  if (usd > maxUsd) {
    usd = maxUsd;
    amount = usd / price;
  }

  const minUsd = Math.max(5, equity * 0.002);
  if (usd < minUsd) {
    usd = minUsd;
    amount = usd / price;
  }

  return {
    usd: Math.round(usd * 100) / 100,
    amount: Math.max(0.0001, amount),
    stopDistance,
    riskUsd,
  };
}

/**
 * Clear CB. By default refuses sticky daily/drawdown unless force=true (operator).
 */
function resetCircuitBreaker(state, { force = false } = {}) {
  const s = { ...state };
  if (s.circuitBreaker && s.stickyKind && !force) {
    console.warn(`[RISK] Refuse clear sticky CB (${s.stickyKind}): ${s.circuitReason}`);
    return s;
  }
  s.circuitBreaker = false;
  s.circuitReason = null;
  s.stickyKind = null;
  s.cooldownUntil = null;
  saveRiskState(s);
  return s;
}

/**
 * Operator / explicit resume only when forceClearSticky.
 * Auto paths must use canAutoResumeTrading first and never force.
 */
function resetRiskForResume(state, equity, { forceClearSticky = false } = {}) {
  if (state?.circuitBreaker && !forceClearSticky) {
    if (!canAutoResumeTrading(state)) {
      console.warn('[RISK] resetRiskForResume blocked — sticky/active circuit breaker');
      return state;
    }
  }
  const s = resetCircuitBreaker(state, { force: forceClearSticky });
  if (s.circuitBreaker) return s; // still stuck
  const eq = equity > 0 ? equity : (s.peakEquity || s.dayStartEquity || 0);
  if (eq > 0) {
    // Do NOT rewrite dayStartEquity mid-day on auto paths — only on force operator resume
    if (forceClearSticky) {
      s.peakEquity = eq;
      s.dayStartEquity = eq;
      s.dayPnl = 0;
      s.dayKey = dayKeyNow();
    } else if (s.peakEquity == null || eq > s.peakEquity) {
      s.peakEquity = eq;
    }
    s.consecutiveLosses = 0;
  }
  saveRiskState(s);
  return s;
}

function formatRiskStatus(state, strategy, equity) {
  const s = resetDayIfNeeded({ ...state }, equity);
  const lines = [];
  if (s.circuitBreaker) lines.push(`🛑 CIRCUIT BREAKER: ${s.circuitReason}`);
  if (s.cooldownUntil && Date.now() < s.cooldownUntil) {
    lines.push(`⏳ Cooldown: ${Math.ceil((s.cooldownUntil - Date.now()) / 60000)} min`);
  }
  if (s.dayStartEquity > 0) {
    const dayPct = ((equity - s.dayStartEquity) / s.dayStartEquity) * 100;
    lines.push(`Giorno: ${dayPct >= 0 ? '+' : ''}${dayPct.toFixed(2)}% (limite -${strategy.maxDailyLossPercent ?? 2}%)`);
  }
  if (s.peakEquity > 0) {
    const dd = ((equity - s.peakEquity) / s.peakEquity) * 100;
    lines.push(`Drawdown: ${dd.toFixed(2)}% (limite -${strategy.maxDrawdownPercent ?? 8}%)`);
  }
  lines.push(`Perdite consecutive: ${s.consecutiveLosses || 0}/${strategy.consecutiveLossLimit ?? 3}`);
  lines.push(`Rischio/trade: ${strategy.riskPerTradePercent ?? 0.5}% · Max posizione: ${strategy.maxPositionPercent ?? 20}%`);
  return lines.join('\n');
}

module.exports = {
  loadRiskState, saveRiskState, checkCanTrade, recordTradeResult,
  computePositionSize, computeBudgetOrderSize, resetCircuitBreaker,
  resetRiskForResume, formatRiskStatus, resetDayIfNeeded,
  canAutoResumeTrading, isStickyCircuitBreaker, isDailyLossReason, isDrawdownReason,
};
