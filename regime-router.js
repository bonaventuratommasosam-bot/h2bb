// Regime Router — classifica regime e adatta policy
// Output: mode (trade/reduce/flat) + parametri aggiustati per regime
const ind = require('./indicators');
const bearPolicy = require('./bear-policy');

// Soglie di classificazione
const THRESHOLDS = {
  bearishAdx: 25,        // ADX sopra = trend forte
  bullishAdx: 22,        // ADX minima per trend rialzista
  lowAdx: 18,            // ADX sotto = ranging
  shockAtrPct: 3.0,      // ATR > 3% del prezzo = shock
  shockVolRatio: 3.0,    // volume > 3x medio = shock
  highFunding: 0.0001,   // funding > 0.01% = allarme
  extremeFunding: 0.0003,// funding > 0.03% = blocco
  cooldownShockMs: 2 * 3600_000, // 2h dopo shock
};

// Stato persistente del router
let routerState = {
  currentRegime: 'unknown',
  lastRegimeChangeAt: null,
  shockDetectedAt: null,
  flatReason: null,
  consecutiveFlatTicks: 0,
};

/**
 * Classifica il regime corrente dai dati di mercato.
 * @param {Object} analysis - output di analyzeMarket()
 * @param {Object} strategy - strategy corrente
 * @returns {Object} { regime, confidence, reasons[] }
 */
function classifyRegime(analysis, strategy) {
  const macro = analysis.macro;
  const trend = analysis.trend;
  const entry = analysis.entry;
  const ctx = analysis.context;
  const price = entry?.price || 0;
  const reasons = [];

  if (!entry?.ok) {
    return { regime: 'unknown', confidence: 0, reasons: ['dati insufficienti'] };
  }

  const adx = entry.adx || 0;
  const atr = entry.atr || 0;
  const atrPct = price > 0 ? (atr / price) * 100 : 0;
  const volRatio = entry.volRatio || 1;
  const macroTrend = macro?.ok ? macro.trend : 'neutral';
  const trend1h = trend?.ok ? trend.trend : 'neutral';
  const funding = ctx?.funding || 0;
  const regime = entry.regime || 'mixed';

  // SHOCK: volatilità esplosiva
  if (atrPct >= THRESHOLDS.shockAtrPct || volRatio >= THRESHOLDS.shockVolRatio) {
    reasons.push(`ATR ${atrPct.toFixed(1)}%`, `vol x${volRatio.toFixed(1)}`);
    return { regime: 'shock', confidence: 95, reasons };
  }

  // BEAR: macro e/o 1h bearish con ADX forte
  if (macroTrend === 'bearish' && adx >= THRESHOLDS.bearishAdx) {
    reasons.push('macro bearish forte');
    return { regime: 'bear', confidence: 90, reasons };
  }
  if (trend1h === 'bearish' && adx >= THRESHOLDS.bearishAdx && macroTrend !== 'bullish') {
    reasons.push('trend 1h bearish');
    return { regime: 'bear', confidence: 75, reasons };
  }

  // BULL: trend bullish con ADX sufficiente
  if (macroTrend === 'bullish' && adx >= THRESHOLDS.bullishAdx) {
    reasons.push('macro bullish');
    return { regime: 'bull', confidence: 85, reasons };
  }
  if (trend1h === 'bullish' && adx >= THRESHOLDS.bullishAdx && macroTrend !== 'bearish') {
    reasons.push('trend 1h bullish');
    return { regime: 'bull', confidence: 70, reasons };
  }

  // RANGING: ADX basso o regime ranging
  if (adx < THRESHOLDS.lowAdx || regime === 'ranging') {
    reasons.push(adx < THRESHOLDS.lowAdx ? `ADX ${adx.toFixed(0)} basso` : 'regime ranging');
    return { regime: 'ranging', confidence: 70, reasons };
  }

  // Default: mixed / trend debole
  if (macroTrend === 'bullish') reasons.push('macro bullish debole');
  else if (macroTrend === 'bearish') reasons.push('macro bearish debole');
  else reasons.push('trend neutro');

  return { regime: 'mixed', confidence: 55, reasons };
}

/**
 * Mappa regime → aggiustamenti strategia.
 * Ritorna { mode, adjustments } da applicare.
 */
function regimeAdjustments(classification, strategy) {
  const now = Date.now();
  const prevRegime = routerState.currentRegime;

  switch (classification.regime) {
    case 'bull':
      return {
        mode: 'trade',
        flat: false,
        adjustments: {
          scoreBoost: 0,
          sizeMultiplier: 1.0,
          tpMultiplier: 1.0,
          reason: `Bull regime • ${classification.reasons.join(', ')}`,
        },
      };

    case 'bear':
      routerState.consecutiveFlatTicks++;
      return {
        mode: 'flat',
        flat: true,
        flatReason: `Bear regime • ${classification.reasons.join(', ')}`,
        adjustments: {
          scoreBoost: 0,
          sizeMultiplier: 0,
          tpMultiplier: 1.0,
          reason: `Bear — flat forzato`,
        },
      };

    case 'shock':
      routerState.shockDetectedAt = now;
      routerState.consecutiveFlatTicks = 0;
      return {
        mode: 'flat',
        flat: true,
        flatReason: `Shock rilevato • ${classification.reasons.join(', ')}`,
        cooldownUntil: now + THRESHOLDS.cooldownShockMs,
        adjustments: {
          scoreBoost: 0,
          sizeMultiplier: 0,
          tpMultiplier: 1.0,
          reason: `Shock — cooldown 2h`,
        },
      };

    case 'ranging':
      return {
        mode: 'reduce',
        flat: false,
        adjustments: {
          scoreBoost: 10,          // soglia più alta
          sizeMultiplier: 0.5,     // size dimezzata
          tpMultiplier: 1.5,       // TP più stretti
          reason: `Ranging • ${classification.reasons.join(', ')}`,
        },
      };

    default: // mixed / unknown
      return {
        mode: 'trade',
        flat: false,
        adjustments: {
          scoreBoost: 5,
          sizeMultiplier: 0.8,
          tpMultiplier: 1.0,
          reason: `Mixed • ${classification.reasons.join(', ')}`,
        },
      };
  }
}

/**
 * Entry point: classifica regime e ritorna decisione per il tick corrente.
 * Chiamato da pro-engine.js PRIMA della decisione di trade.
 */
function route(analysis, strategy) {
  // Always classify so callers can read .classification.regime even on cooldown
  const classification = classifyRegime(analysis, strategy);

  // Se c'è un cooldown attivo da shock, rispettalo (ma non omettere classification)
  if (routerState.shockDetectedAt) {
    const elapsed = Date.now() - routerState.shockDetectedAt;
    if (elapsed < THRESHOLDS.cooldownShockMs) {
      const remaining = Math.ceil((THRESHOLDS.cooldownShockMs - elapsed) / 60000);
      routerState.flatReason = `Cooldown shock: ${remaining}min rimanenti`;
      // Keep regime label as shock while cooling down
      if (routerState.currentRegime !== 'shock') {
        routerState.lastRegimeChangeAt = Date.now();
        routerState.currentRegime = 'shock';
      }
      return {
        mode: 'flat',
        flat: true,
        flatReason: routerState.flatReason,
        adjustments: { scoreBoost: 0, sizeMultiplier: 0, tpMultiplier: 1.0, reason: 'cooldown shock' },
        classification: {
          regime: 'shock',
          confidence: classification.confidence ?? 90,
          reasons: classification.reasons?.length
            ? classification.reasons
            : [`cooldown ${remaining}min`],
        },
        routerState: { ...routerState },
      };
    }
    // Cooldown scaduto
    routerState.shockDetectedAt = null;
  }

  const decision = regimeAdjustments(classification, strategy);

  // Bear regime: valuta setup short ipotetici
  if (classification.regime === 'bear') {
    try { bearPolicy.onBearRegime(analysis, strategy); } catch {}
  }

  // Traccia cambio regime
  if (classification.regime !== routerState.currentRegime) {
    routerState.lastRegimeChangeAt = Date.now();
    routerState.consecutiveFlatTicks = 0;
    routerState.currentRegime = classification.regime;
  }

  routerState.flatReason = decision.flatReason || null;

  return {
    ...decision,
    classification,
    routerState: { ...routerState },
  };
}

/**
 * Ritorna lo stato attuale del router (per log/telemetria).
 */
function getState() {
  return { ...routerState };
}

module.exports = { route, getState, classifyRegime };
