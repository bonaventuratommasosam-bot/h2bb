// Meta-Controller v1 — Decide la policy di trading in autonomia
// Osserva performance, regime, esecuzione. Decide trade/reduce/flat/recover.
// Mai chiedere input umano. Solo notificare azioni prese.
const fs = require('fs');
const path = require('path');
const performance = require('./performance');
const feedback = require('./performance-feedback');
const tradeVerifier = require('./trade-verifier');
const executionFill = require('./execution-fill');
const regimeRouter = require('./regime-router');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const STATE_FILE = path.join(DATA_DIR, 'meta-controller-state.json');
const CHANGELOG = path.join(DATA_DIR, 'strategy-changelog.jsonl');

// Hard limit — il meta-controller può stringere, mai allentare oltre questi
const HARD_LIMITS = {
  minScoreMin: 45,
  minScoreMax: 80,
  sizeMinPercent: 0.2,    // 20% della size normale
  sizeMaxPercent: 1.0,    // 100%
  maxDrawdownAlert: -8,   // %
  maxDailyLossAlert: -2,  // %
};

// Modalità operative
const MODES = {
  trade:   { label: 'trade',   desc: 'Trading normale',       sizePct: 1.0,  scoreBoost: 0 },
  reduce:  { label: 'reduce',  desc: 'Ridotta aggressività',  sizePct: 0.5,  scoreBoost: 10 },
  recover: { label: 'recover', desc: 'Recupero drawdown',     sizePct: 0.3,  scoreBoost: 15 },
  flat:    { label: 'flat',    desc: 'Stop trading',          sizePct: 0,    scoreBoost: 0 },
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {}
  return {
    currentMode: 'trade',
    modeSince: null,
    decisions: [],
    lastEvaluationAt: null,
    tradesSinceChange: 0,
    preChangeStats: null,      // snapshot KPI prima del cambio
  };
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

function logChangelog(entry) {
  try {
    fs.appendFileSync(CHANGELOG, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n');
  } catch {}
}

/**
 * Entry point — chiamato dal proactive loop ogni 20 min.
 * Osserva tutti gli input e decide se cambiare policy.
 * @returns {Object} decisione presa
 */
function evaluate(strategy, balance) {
  const state = loadState();
  const now = Date.now();

  // Input #1: performance
  const stats = performance.computeStats(strategy.pair);
  const fb = feedback.buildFeedbackContext(strategy);

  // Input #2: pattern ricorrenti nelle perdite
  const patternAlert = tradeVerifier.getPatternAlert();

  // Input #3: qualità esecuzione
  const execSummary = executionFill.getExecutionSummary();

  // Input #4: regime corrente
  const regimeState = regimeRouter.getState();

  // Input #5: salute capitale
  const balanceAmount = balance?.amount || strategy.balance?.amount || 0;
  const totalPnl = stats.totalPnl || 0;

  // ─── DECISIONE ───

  let newMode = state.currentMode;
  let reason = '';
  let adjustments = {};

  // RECOVER: drawdown significativo con basso win rate
  if (totalPnl < -3.0 && fb.rollingWinRate < 40 && state.currentMode !== 'recover') {
    newMode = 'recover';
    reason = `Drawdown $${Math.abs(totalPnl).toFixed(2)} con WR ${fb.rollingWinRate}% — Recovery mode`;
    adjustments = {
      minScore: Math.min(HARD_LIMITS.minScoreMax, (strategy.minConfidenceScore || 55) + MODES.recover.scoreBoost),
      sizeMultiplier: MODES.recover.sizePct,
      message: `Recovery attivato: size 30%, soglia +15. Uscita dopo 3 trade vincenti.`,
    };
  }

  // REDUCE: profit factor negativo sulle ultime
  else if (fb.profitFactor < 0.8 && fb.closedTrades >= 5 && state.currentMode === 'trade') {
    newMode = 'reduce';
    reason = `Profit factor ${fb.profitFactor} — Riduco aggressività`;
    adjustments = {
      minScore: Math.min(HARD_LIMITS.minScoreMax, (strategy.minConfidenceScore || 55) + MODES.reduce.scoreBoost),
      sizeMultiplier: MODES.reduce.sizePct,
      message: `Aggressività ridotta: size 50%, soglia +10. Profit factor rolling: ${fb.profitFactor}.`,
    };
  }

  // Pattern alert: riduci se ci sono errori sistematici
  else if (patternAlert && patternAlert.patterns?.length > 0 && state.currentMode === 'trade') {
    newMode = 'reduce';
    reason = `Pattern rilevato: ${patternAlert.patterns[0].reason} (${patternAlert.patterns[0].count}x)`;
    adjustments = {
      minScore: Math.min(HARD_LIMITS.minScoreMax, (strategy.minConfidenceScore || 55) + 5),
      sizeMultiplier: 0.7,
      message: `Pattern loss rilevato: ${patternAlert.message}`,
    };
  }

  // RECOVERY EXIT: 3 trade vincenti consecutivi → torna a trade
  else if (state.currentMode === 'recover' && fb.consecutiveWins >= 3) {
    newMode = 'trade';
    reason = `Recovery completato: ${fb.consecutiveWins} win consecutivi, WR ${fb.rollingWinRate}%`;
    adjustments = {
      minScore: strategy.minConfidenceScore || 55,
      sizeMultiplier: 1.0,
      message: `Recovery mode disattivato. Trading normale ripreso.`,
    };
  }

  // REDUCE EXIT: profit factor > 1.2 per 10+ trade → torna a trade
  else if (state.currentMode === 'reduce' && fb.profitFactor > 1.2 && fb.closedTrades >= 10) {
    newMode = 'trade';
    reason = `Performance recuperata: PF ${fb.profitFactor}, WR ${fb.rollingWinRate}%`;
    adjustments = {
      minScore: strategy.minConfidenceScore || 55,
      sizeMultiplier: 1.0,
      message: `Riduzione aggressività revocata. Profit factor: ${fb.profitFactor}.`,
    };
  }

  // Slippage alert: se slippage > 15 bps, segnala (non cambia mode)
  if (execSummary.avgSlippageBps > 15 && state.currentMode === 'trade') {
    if (!adjustments.message) adjustments.message = '';
    adjustments.message += ` ⚠️ Slippage medio ${execSummary.avgSlippageBps} bps.`;
  }

  // ─── APPLICA ───

  if (newMode !== state.currentMode || Object.keys(adjustments).length > 0) {
    const modeChanged = newMode !== state.currentMode;
    const prevMode = state.currentMode;

    // Snapshot KPI pre-change per rollback
    if (modeChanged) {
      state.preChangeStats = {
        mode: prevMode,
        winRate: fb.rollingWinRate,
        profitFactor: fb.profitFactor,
        totalPnl: stats.totalPnl,
        trades: fb.closedTrades,
        ts: new Date().toISOString(),
      };
    }

    // Applica a strategy
    if (adjustments.minScore != null) {
      strategy.minConfidenceScore = adjustments.minScore;
    }

    // Se mode = flat, disattiva strategy
    if (newMode === 'flat') {
      strategy.active = false;
    } else if (prevMode === 'flat' && newMode !== 'flat') {
      strategy.active = true;
    }

    // Aggiorna stato
    state.currentMode = newMode;
    state.modeSince = newMode !== prevMode ? now : state.modeSince;
    state.tradesSinceChange = 0;
    state.lastEvaluationAt = now;

    // Log changelog
    const entry = {
      type: modeChanged ? 'mode_change' : 'param_adjustment',
      from: prevMode,
      to: newMode,
      reason,
      adjustments,
      stats: {
        winRate: fb.rollingWinRate,
        profitFactor: fb.profitFactor,
        totalPnl: stats.totalPnl,
        closedTrades: fb.closedTrades,
      },
      regime: regimeState.currentRegime,
      execSlippageBps: execSummary.avgSlippageBps,
    };
    logChangelog(entry);

    // Aggiungi alla history
    state.decisions.push({
      ts: new Date().toISOString(),
      ...entry,
    });
    if (state.decisions.length > 20) state.decisions.shift();

    saveState(state);

    return {
      changed: true,
      modeChanged,
      mode: newMode,
      reason,
      adjustments,
    };
  }

  // No change — aggiorna contatore trade
  state.tradesSinceChange++;
  state.lastEvaluationAt = now;
  saveState(state);

  return { changed: false, mode: state.currentMode };
}

/**
 * Chiamato dopo ogni trade chiuso per tracciare performance post-change.
 */
function afterTrade(strategy) {
  const state = loadState();
  state.tradesSinceChange = (state.tradesSinceChange || 0) + 1;

  // Rollback check: dopo 5 trade post-change, verifica se siamo peggiorati
  if (state.tradesSinceChange >= 5 && state.preChangeStats) {
    const fb = feedback.buildFeedbackContext(strategy);
    const prePf = state.preChangeStats.profitFactor || 1;
    const postPf = fb.profitFactor || 0;

    if (postPf < prePf * 0.7 && fb.closedTrades >= 5) {
      const alert = {
        type: 'rollback_alert',
        message: `⚠️ Performance peggiorata dopo cambio a ${state.currentMode}: PF ${prePf} → ${postPf}, WR ${fb.rollingWinRate}%`,
        previousMode: state.preChangeStats.mode,
        currentMode: state.currentMode,
        tradesSinceChange: state.tradesSinceChange,
      };
      logChangelog(alert);
      state.preChangeStats = null; // resetta per evitare alert ripetuti
    } else if (postPf >= prePf) {
      // Sta funzionando: conferma il cambio
      state.preChangeStats = null;
    }
  }

  saveState(state);
}

/**
 * Ritorna lo stato attuale del meta-controller (per dashboard).
 */
function getStatus() {
  const state = loadState();
  return {
    mode: state.currentMode,
    modeSince: state.modeSince,
    decisionsCount: state.decisions.length,
    tradesSinceChange: state.tradesSinceChange,
    lastEvaluation: state.lastEvaluationAt,
  };
}

module.exports = { evaluate, afterTrade, getStatus };
