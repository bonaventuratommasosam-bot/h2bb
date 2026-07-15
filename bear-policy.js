// Bear Policy — Infrastruttura per operatività in regime bearish
// Oggi: traccia setup short ipotetici. Domani: esegue short quando il motore lo supporta.
const fs = require('fs');
const path = require('path');
const ind = require('./indicators');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const BEAR_LOG = path.join(DATA_DIR, 'bear-signals.jsonl');
const BEAR_STATE = path.join(DATA_DIR, 'bear-state.json');

let bearState = {
  enabled: false,              // short non ancora attivo
  hypotheticalMode: true,      // logga ma non esegue
  signals: [],
  lastEvaluationAt: null,
};

function loadState() {
  try {
    if (fs.existsSync(BEAR_STATE)) bearState = JSON.parse(fs.readFileSync(BEAR_STATE, 'utf-8'));
  } catch {}
}

function saveState() {
  try {
    fs.writeFileSync(BEAR_STATE, JSON.stringify(bearState, null, 2));
  } catch {}
}

/**
 * Valuta setup short ipotetico.
 * Mirror della logica long: cerca ipercomprato, MACD cross ribassista, resistenze.
 */
function evaluateShortSetup(analysis, strategy) {
  const macro = analysis.macro;
  const trend = analysis.trend;
  const entry = analysis.entry;
  if (!entry?.ok) return null;

  let score = 0;
  const signals = [];

  // Mirror dei segnali long
  if (macro?.ok && macro.trend === 'bearish') { score += 18; signals.push('macro bearish'); }
  if (trend?.ok && trend.trend === 'bearish') { score += 18; signals.push('trend 1h bearish'); }
  if (trend?.ok && trend.ema20 < trend.ema50) { score += 8; signals.push('EMA20<EMA50'); }

  // RSI ipercomprato → setup short
  if (entry.rsi != null && entry.rsi > 60) {
    score += 12;
    signals.push(`RSI ${entry.rsi.toFixed(1)} ipercomprato`);
    if (!entry.rsiRising) { score += 10; signals.push('RSI in calo'); }
  }

  // Stoch ipercomprato
  if (entry.stoch?.k > 70 && !entry.stoch.rising) {
    score += 12;
    signals.push(`Stoch ${entry.stoch.k.toFixed(0)} ipercomprato`);
  }

  // MACD cross ribassista
  if (entry.macd?.histogram < 0 && entry.macd.prevHistogram >= 0) {
    score += 18;
    signals.push('MACD cross ribassista');
  }

  // Bollinger upper band
  if (entry.bb && entry.bbPos > 0.75) {
    score += 12;
    signals.push('Bollinger upper');
  }

  // Funding elevato (sfavorevole per short)
  if (analysis.context?.funding != null && analysis.context.funding > 0.0001) {
    score -= 5;
    signals.push('funding alto (costo short)');
  }

  score = Math.max(0, Math.min(100, score));
  const minScore = strategy.minConfidenceScore || 65;
  const actionable = score >= minScore;

  return {
    score,
    minScore,
    actionable,
    signals,
    regime: entry.regime || 'mixed',
    price: entry.price,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Chiamato dal regime router quando il regime è bear.
 * Se hypotheticalMode, logga il setup. Se enabled, esegue short.
 */
function onBearRegime(analysis, strategy) {
  loadState();
  const setup = evaluateShortSetup(analysis, strategy);

  if (!setup) return null;

  bearState.lastEvaluationAt = Date.now();

  if (bearState.hypotheticalMode) {
    // Logga il setup ipotetico per analisi
    const entry = {
      ts: new Date().toISOString(),
      mode: 'hypothetical',
      pair: strategy.pair,
      score: setup.score,
      minScore: setup.minScore,
      actionable: setup.actionable,
      signals: setup.signals,
      price: setup.price,
    };
    try {
      fs.appendFileSync(BEAR_LOG, JSON.stringify(entry) + '\n');
    } catch {}
    bearState.signals.push(entry);
    if (bearState.signals.length > 50) bearState.signals.shift();
    saveState();
    return { hypothetical: true, ...setup };
  }

  // TODO: quando enabled=true, esegue executeMarketSell con reduce_only=false
  // per aprire posizione short. Richiede modifiche a orders.js e pro-engine.js.

  return null;
}

/**
 * Statistiche sui setup short ipotetici.
 */
function getBearStats() {
  loadState();
  const signals = bearState.signals;
  if (signals.length === 0) return null;

  const actionable = signals.filter(s => s.actionable);
  return {
    total: signals.length,
    actionable: actionable.length,
    actionabilityRate: signals.length > 0
      ? Math.round((actionable.length / signals.length) * 100)
      : 0,
    avgScore: Math.round(signals.reduce((s, x) => s + x.score, 0) / signals.length),
    lastSignal: signals[signals.length - 1],
    mode: bearState.hypotheticalMode ? 'hypothetical' : 'live',
  };
}

module.exports = { onBearRegime, evaluateShortSetup, getBearStats };
