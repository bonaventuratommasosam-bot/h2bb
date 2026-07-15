// Loop 1 — Performance Feedback Module
// Legge trades.jsonl, computa performance reale, la passa ad ai-signal
const fs = require('fs');
const path = require('path');
const perf = require('./performance');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const TRADES_FILE = path.join(DATA_DIR, 'trades.jsonl');
const FEEDBACK_STATE_FILE = path.join(DATA_DIR, 'performance-feedback-state.json');

function loadRecentTrades(pair, lookbackHours = 48) {
  const cutoff = Date.now() - lookbackHours * 3600_000;
  const trades = perf.loadTrades(500)
    .filter(t => (!pair || t.pair === pair) && t.type === 'sell' && t.pnl != null)
    .filter(t => new Date(t.timestamp).getTime() > cutoff);
  return trades;
}

function buildFeedbackContext(strategy) {
  const pair = strategy.pair || 'ETH';
  const allTrades = perf.loadTrades(500).filter(t => t.type === 'sell' && t.pnl != null);
  const recentTrades = allTrades.filter(
    t => new Date(t.timestamp).getTime() > Date.now() - 72 * 3600_000
  );
  const stats = perf.computeStats(pair);

  // Ultimi 20 trade (già chiusi) per analisi pattern
  const lastClosed = recentTrades.slice(-20).map(t => ({
    pnl: Math.round(t.pnl * 100) / 100,
    pnlPercent: t.pnlPercent != null ? Math.round(t.pnlPercent * 100) / 100 : null,
    ts: t.timestamp,
  }));

  // Calcolo win rate su finestra rolling 20 trade
  const rolling = recentTrades.slice(-20);
  const rollingWins = rolling.filter(t => t.pnl > 0).length;
  const rollingWinRate = rolling.length > 0
    ? Math.round((rollingWins / rolling.length) * 100)
    : 0;

  // Consecutive wins/losses
  let consecutiveWins = 0, consecutiveLosses = 0;
  for (let i = recentTrades.length - 1; i >= 0; i--) {
    if (recentTrades[i].pnl > 0) consecutiveWins++;
    else break;
  }
  for (let i = recentTrades.length - 1; i >= 0; i--) {
    if (recentTrades[i].pnl <= 0) consecutiveLosses++;
    else break;
  }

  return {
    winRate: rollingWinRate,
    totalWinRate: stats.winRate,
    profitFactor: stats.profitFactor,
    expectancy: stats.expectancy,
    closedTrades: stats.closedTrades,
    totalPnl: stats.totalPnl,
    lastTrades: lastClosed,
    consecutiveWins,
    consecutiveLosses,
    rollingWinRate,
    avgWin: stats.avgWin,
    avgLoss: stats.avgLoss,
    bestTrade: stats.bestTrade,
    worstTrade: stats.worstTrade,
    pair,
  };
}

function saveFeedbackState(state) {
  try {
    fs.writeFileSync(FEEDBACK_STATE_FILE, JSON.stringify({
      ...state,
      updatedAt: new Date().toISOString(),
    }, null, 2));
  } catch { /* non blocca */ }
}

function loadFeedbackState() {
  try {
    if (fs.existsSync(FEEDBACK_STATE_FILE)) {
      return JSON.parse(fs.readFileSync(FEEDBACK_STATE_FILE, 'utf-8'));
    }
  } catch { /* non blocca */ }
  return {};
}

/**
 * Valuta se è necessario un alert sulla performance.
 * Ritorna { alert: true/false, message: string }.
 */
function evaluatePerformanceAlert(feedback, strategy) {
  const state = loadFeedbackState();
  const now = Date.now();
  const ALERT_COOLDOWN = 4 * 3600_000; // 4 ore tra alert

  // Alert: profit factor < 1.0 su 20 trade rolling
  if (feedback.profitFactor < 1.0 && feedback.closedTrades >= 5) {
    if (!state.lastPfAlertAt || now - state.lastPfAlertAt > ALERT_COOLDOWN) {
      state.lastPfAlertAt = now;
      saveFeedbackState(state);
      return {
        alert: true,
        level: 'warning',
        message: `⚠️ Profit factor ${feedback.profitFactor} su ${feedback.closedTrades} trade. Rolling WR: ${feedback.rollingWinRate}%. Valuta strategia.`,
      };
    }
  }

  // Alert: 3+ perdite consecutive
  if (feedback.consecutiveLosses >= 3) {
    if (!state.lastConsecutiveAlertAt || now - state.lastConsecutiveAlertAt > ALERT_COOLDOWN) {
      state.lastConsecutiveAlertAt = now;
      saveFeedbackState(state);
      return {
        alert: true,
        level: 'danger',
        message: `🔴 ${feedback.consecutiveLosses} perdite consecutive. Ultimo P&L: $${feedback.totalPnl}. Circuit breaker?`,
      };
    }
  }

  // Alert: drawdown significativo (>$3 su balance ~$38 = ~8%)
  if (feedback.totalPnl < -3.0 && feedback.closedTrades >= 3) {
    if (!state.lastDrawdownAlertAt || now - state.lastDrawdownAlertAt > ALERT_COOLDOWN) {
      state.lastDrawdownAlertAt = now;
      saveFeedbackState(state);
      return {
        alert: true,
        level: 'danger',
        message: `🔴 Drawdown $${Math.abs(feedback.totalPnl)} (${Math.round(Math.abs(feedback.totalPnl) / 0.38)}% del balance).`,
      };
    }
  }

  return { alert: false };
}

module.exports = {
  buildFeedbackContext,
  evaluatePerformanceAlert,
  loadRecentTrades,
};
