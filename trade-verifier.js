// Loop 2 — Post-Trade Verification
// Verifica slippage dopo ogni trade, analizza cause perdite, detect pattern ricorrenti
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const REVIEW_FILE = path.join(DATA_DIR, 'trade-review.jsonl');

function logReview(entry) {
  try {
    fs.appendFileSync(REVIEW_FILE, JSON.stringify(entry) + '\n');
  } catch { /* non blocca */ }
}

function loadReviews(limit = 100) {
  try {
    if (!fs.existsSync(REVIEW_FILE)) return [];
    const raw = fs.readFileSync(REVIEW_FILE, 'utf-8').trim();
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).slice(-limit).map(l => JSON.parse(l));
  } catch { return []; }
}

/**
 * Verifica un trade appena eseguito.
 * @param {Object} trade - il trade eseguito (da executeMarketSell)
 * @param {Object} signal - il segnale che ha triggerato il trade
 * @param {Object} analysis - analisi di mercato al momento del trade
 * @param {Object} strategy - strategy corrente
 * @returns {Object|null} review entry o null
 */
function verifyTrade(trade, signal, analysis, strategy) {
  if (!trade || !signal) return null;

  const entry = {
    ts: new Date().toISOString(),
    tradeId: trade.id || null,
    pair: strategy.pair,
    action: signal.action,
    reason: signal.reason || '',
    score: signal.score || 0,
    urgency: signal.urgency || 0,
  };

  // Slippage check
  if (trade.expectedPrice && trade.price) {
    const slippagePct = Math.abs((trade.price - trade.expectedPrice) / trade.expectedPrice * 100);
    entry.slippagePct = Math.round(slippagePct * 100) / 100;
    entry.slippageOk = slippagePct <= 0.5;
    if (slippagePct > 0.5) {
      entry.alert = `⚠️ Slippage ${entry.slippagePct}% su ${strategy.pair}`;
    }
  }

  // P&L check
  if (trade.pnl != null) {
    entry.pnl = Math.round(trade.pnl * 100) / 100;
    entry.pnlPercent = trade.pnlPercent != null ? Math.round(trade.pnlPercent * 100) / 100 : null;
    entry.profitable = trade.pnl > 0;
  }

  // Losing trade analysis
  if (trade.pnl != null && trade.pnl <= 0 && analysis) {
    entry.losingAnalysis = analyzeLoss(trade, signal, analysis, strategy);
  }

  // AI decision audit (se il segnale è stato influenzato da AI)
  if (signal.reason && signal.reason.startsWith('AI-')) {
    entry.aiDecision = {
      type: signal.reason.startsWith('AI-EXIT') ? 'exit' : 'entry',
      reason: signal.reason,
    };
  }

  logReview(entry);
  return entry;
}

/**
 * Analizza una perdita: cosa è andato storto?
 */
function analyzeLoss(trade, signal, analysis, strategy) {
  const reasons = [];
  const macroTrend = analysis.macro?.trend || 'unknown';
  const trend1h = analysis.trend?.trend || 'unknown';
  const rsi = analysis.entry?.rsi;
  const macd = analysis.entry?.macd;
  const regime = analysis.entry?.regime || 'unknown';

  // Trend contro la posizione
  if (macroTrend === 'bearish') reasons.push('macro bearish');
  if (trend1h === 'bearish') reasons.push('trend 1h bearish contra trade');

  // RSI overbought all'entrata
  if (rsi != null && rsi > 60) reasons.push(`RSI ${rsi.toFixed(0)} — entrata troppo tardi?`);

  // MACD già ribassista
  if (macd && macd.histogram < 0) reasons.push('MACD già bearish all\'entrata');

  // Funding sfavorevole
  if (analysis.context?.funding > 0.00005) reasons.push('funding elevato (costo hold)');

  // Score all'entrata troppo basso
  if (signal.score < (strategy.minConfidenceScore || 65)) reasons.push('score entrata sotto soglia');

  return {
    reasons: reasons.length ? reasons : ['nessun pattern identificato'],
    regime,
    entryScore: signal.score || 0,
    minScore: strategy.minConfidenceScore || 65,
    rsi: rsi?.toFixed(1) || 'n/d',
    macroTrend,
    trend1h,
  };
}

/**
 * Cerca pattern ricorrenti nelle ultime perdite.
 * @returns {Array} pattern trovati con conteggio
 */
function detectRecurringPatterns() {
  const reviews = loadReviews(50).filter(r => r.pnl != null && r.pnl <= 0);
  if (reviews.length < 3) return [];

  const patterns = {};
  for (const r of reviews) {
    const losingAnalysis = r.losingAnalysis;
    if (!losingAnalysis?.reasons) continue;
    for (const reason of losingAnalysis.reasons) {
      patterns[reason] = (patterns[reason] || 0) + 1;
    }
  }

  // Ritorna solo pattern con 3+ occorrenze
  return Object.entries(patterns)
    .filter(([, count]) => count >= 3)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Genera alert se ci sono pattern ricorrenti.
 */
function getPatternAlert() {
  const patterns = detectRecurringPatterns();
  if (patterns.length === 0) return null;
  const top = patterns[0];
  return {
    alert: true,
    level: 'warning',
    message: `🔍 Pattern rilevato: "${top.reason}" — ${top.count} occorrenze nelle ultime perdite. Ultimi pattern: ${patterns.map(p => p.reason).slice(0, 3).join(', ')}`,
    patterns,
  };
}

module.exports = {
  verifyTrade,
  detectRecurringPatterns,
  getPatternAlert,
  loadReviews,
};
