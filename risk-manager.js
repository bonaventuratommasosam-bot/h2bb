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
  lastUpdated: null,
};

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
    state.dayKey = dk;
    state.dayStartEquity = equity;
    state.dayPnl = 0;
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

function computeBudgetOrderSize({ equity, cash, price, strategy, entryScore }) {
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

  const maxPosPct = Math.min(strategy.maxPositionPercent ?? 20, HARD_CAPS.maxPositionPercent) / 100;
  let usd = Math.min(available * deployFraction, budget * maxPosPct);
  if (usd < MIN_NOTIONAL_USD) {
    usd = Math.min(MIN_NOTIONAL_USD, available);
  }
  if (usd < MIN_NOTIONAL_USD) {
    return { amount: 0, usd: 0, deployFraction, reason: `sotto minimo exchange $${MIN_NOTIONAL_USD}` };
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

function resetCircuitBreaker(state) {
  const s = { ...state, circuitBreaker: false, circuitReason: null, cooldownUntil: null };
  saveRiskState(s);
  return s;
}

function resetRiskForResume(state, equity) {
  const s = resetCircuitBreaker(state);
  const eq = equity > 0 ? equity : (s.peakEquity || s.dayStartEquity || 0);
  if (eq > 0) {
    s.peakEquity = eq;
    s.dayStartEquity = eq;
    s.dayPnl = 0;
    s.dayKey = dayKeyNow();
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
};
