// Loop 3 — Strategy Experiment (backtest con champion/challenger)
// Ogni 7 giorni: snapshot strategy, testa 1 parametro, promuovi se profit factor +10%
const fs = require('fs');
const { sanitizeParam } = require('./lib/sanitize-strategy');
const path = require('path');
const market = require('./market-data');
const ind = require('./indicators');
const perf = require('./performance');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const EXPERIMENT_FILE = path.join(DATA_DIR, 'strategy-experiments.json');
const SNAPSHOTS_DIR = path.join(DATA_DIR, 'strategy-snapshots');

// Parametri testabili con range
const TUNABLE_PARAMS = [
  { key: 'minConfidenceScore', min: 55, max: 80, step: 5, label: 'Soglia confidenza' },
  { key: 'riskPerTradePercent', min: 0.5, max: 4.0, step: 0.5, label: 'Rischio per trade %' },
  { key: 'maxPositionPercent', min: 30, max: 100, step: 10, label: 'Max posizione %' },
  { key: 'atrStopMultiplier', min: 1.5, max: 3.0, step: 0.5, label: 'ATR Stop Multiplier' },
  { key: 'atrTp1Multiplier', min: 1.5, max: 3.0, step: 0.5, label: 'ATR TP1 Multiplier' },
  { key: 'intervalMinutes', min: 15, max: 60, step: 15, label: 'Intervallo trade (min)' },
  { key: 'maxDrawdownPercent', min: 5, max: 12, step: 1, label: 'Max drawdown %' },
  { key: 'maxDailyLossPercent', min: 1, max: 4, step: 0.5, label: 'Max daily loss %' },
];

function loadExperiments() {
  try {
    if (fs.existsSync(EXPERIMENT_FILE)) return JSON.parse(fs.readFileSync(EXPERIMENT_FILE, 'utf-8'));
  } catch {}
  return { experiments: [], lastRunAt: null };
}

function saveExperiments(data) {
  if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  fs.writeFileSync(EXPERIMENT_FILE, JSON.stringify(data, null, 2));
}

function saveSnapshot(strategy, label) {
  if (!fs.existsSync(SNAPSHOTS_DIR)) fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const file = path.join(SNAPSHOTS_DIR, `strategy-${label}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(strategy, null, 2));
  return file;
}

/**
 * Backtest leggero: simula la entry logic su candele storiche.
 * Non simula execution reale — valuta solo la qualità dei segnali entry.
 */
async function backtestStrategy(strategy, pair, days = 7) {
  // Fetch candele 15m degli ultimi N giorni
  const since = Date.now() - days * 86400_000;
  const candles = await market.fetchCandles(pair, '15m', Math.min(days * 96, 1000));

  if (!candles || candles.length < 50) {
    return { ok: false, error: 'Dati insufficienti per backtest' };
  }

  const results = {
    signals: [],
    buySignals: 0,
    avgScore: 0,
    totalScore: 0,
  };

  // Simula entry ogni 4 candele (1h)
  const lookback = 60; // candele per calcolo indicatori
  for (let i = lookback; i < candles.length - 1; i += 4) {
    const slice = candles.slice(0, i + 1);
    const closes = slice.map(c => c.c);
    const highs = slice.map(c => c.h);
    const lows = slice.map(c => c.l);
    const volumes = slice.map(c => c.v);
    const price = closes[closes.length - 1];

    const rsi = ind.rsi(closes.slice(-20), 14);
    const macd = ind.macd(closes.slice(-40));
    const ema20 = ind.ema(closes, 20);
    const ema50 = ind.ema(closes, 50);
    const adx = ind.adx(highs.slice(-20), lows.slice(-20), closes.slice(-20), 14);
    const bb = ind.bollinger(closes.slice(-20), 20, 2);
    const regime = ind.detectRegime(adx, bb?.bandwidth);
    const minScore = ind.dynamicMinScore(
      strategy.minConfidenceScore || 65, regime,
      (price > ema50 && ema50 > (ind.ema(closes, 200) || ema50)) ? 'bullish' : 'neutral'
    );

    let score = 0;
    if (rsi && rsi < 42) score += 12;
    if (macd && macd.histogram > 0 && macd.prevHistogram <= 0) score += 18;
    if (bb && (price - bb.lower) / (bb.upper - bb.lower) < 0.25) score += 12;
    if (rsi && rsi < 42) score += 12;
    score = Math.min(100, Math.max(0, score));

    const signal = score >= minScore ? 'buy' : 'hold';
    results.signals.push({ ts: candles[i].t, price, score, minScore, signal, regime });
    if (signal === 'buy') results.buySignals++;
    results.totalScore += score;
  }

  results.avgScore = results.signals.length > 0
    ? Math.round(results.totalScore / results.signals.length)
    : 0;

  // Calcola "quality score" — quanti buy signals e score medio
  results.qualityScore = results.buySignals > 0
    ? Math.round((results.avgScore / 100) * (results.buySignals / results.signals.length) * 100)
    : 0;

  return { ok: true, ...results };
}

/**
 * Esegui un round di esperimento.
 * Testa 1 parametro, confronta con champion.
 */
async function runExperiment(strategy) {
  const pair = strategy.pair || 'ETH';
  const data = loadExperiments();
  const now = Date.now();

  // Determina quale parametro testare (round-robin)
  const lastIdx = data.experiments.length;
  const paramIdx = lastIdx % TUNABLE_PARAMS.length;
  const param = TUNABLE_PARAMS[paramIdx];

  // Champion = strategy attuale
  const championFile = saveSnapshot(strategy, 'champion');
  const championResult = await backtestStrategy(strategy, pair);

  if (!championResult.ok) {
    return { ok: false, error: championResult.error };
  }

  // Challenger = strategy con parametro modificato
  const challenger = JSON.parse(JSON.stringify(strategy));
  // SANITIZE: il valore champion deve essere finito e nel range, altrimenti fallback a 0
  const currentVal = sanitizeParam(param.key, challenger[param.key], 0);
  // Alterna tra +step e -step
  const direction = lastIdx % 2 === 0 ? 1 : -1;
  let newVal = currentVal + direction * param.step;
  newVal = Math.max(param.min, Math.min(param.max, newVal));
  // Se siamo ai limiti, inverti
  if (newVal === currentVal) newVal = currentVal - direction * param.step;
  newVal = Math.max(param.min, Math.min(param.max, newVal));
  challenger[param.key] = newVal;

  const challengerFile = saveSnapshot(challenger, 'challenger');
  const challengerResult = await backtestStrategy(challenger, pair);

  if (!challengerResult.ok) {
    return { ok: false, error: challengerResult.error };
  }

  // Confronto
  const championQuality = championResult.qualityScore || 0;
  const challengerQuality = challengerResult.qualityScore || 0;
  const improvement = championQuality > 0
    ? ((challengerQuality - championQuality) / championQuality) * 100
    : 0;

  const promoted = improvement >= 10; // +10% minimum improvement

  const entry = {
    ts: new Date().toISOString(),
    param: param.key,
    paramLabel: param.label,
    championValue: currentVal,
    challengerValue: newVal,
    championQuality,
    challengerQuality,
    improvement: Math.round(improvement * 10) / 10,
    promoted,
    championSignals: championResult.buySignals,
    challengerSignals: challengerResult.buySignals,
    pair,
  };

  data.experiments.push(entry);
  data.lastRunAt = now;
  saveExperiments(data);

  return {
    ok: true,
    ...entry,
    message: promoted
      ? `✅ PROMOSSO: ${param.label} ${currentVal}→${newVal} (+${Math.round(improvement)}% quality). Applica?`
      : `❌ NON promosso: ${param.label} ${currentVal}→${newVal} (${Math.round(improvement)}% improvement, soglia 10%)`,
  };
}

/**
 * Check se è ora di eseguire l'esperimento (ogni 7 giorni)
 */
function shouldRun() {
  const data = loadExperiments();
  if (!data.lastRunAt) return true;
  const elapsed = Date.now() - data.lastRunAt;
  return elapsed > 7 * 86400_000;
}

module.exports = { runExperiment, shouldRun, loadExperiments };
