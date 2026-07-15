// sanitize-strategy.js — layer di sicurezza per i parametri di strategia.
// Garantisce che nessun valore non-finito (NaN/Infinity) o fuori range
// possa mai essere promosso o persistito su strategy.json.
// Usato da shadow-engine.js e strategy-experiment.js.

// Range autorevole dei parametri testabili (specchio di PARAM_TESTS).
const PARAM_RANGES = {
  minConfidenceScore: { min: 30, max: 75 },
  atrStopMultiplier:  { min: 1,  max: 4 },
  atrTp1Multiplier:   { min: 1,  max: 5 },
  atrTp2Multiplier:   { min: 1,  max: 5 },
  intervalMinutes:    { min: 15, max: 120 },
  maxDrawdownPercent: { min: 5,  max: 30 },
  maxDailyLossPercent: { min: 1, max: 10 },
  riskPerTradePercent: { min: 0.1, max: 5 },
  maxPositionPercent: { min: 10, max: 100 },
  takeProfitPercent:  { min: 1,  max: 50 },
  stopLossPercent:     { min: 1,  max: 50 },
};

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// Se v è valido e nel range, lo ritorna. Altrimenti ritorna fallback (o il clamp del range).
function sanitizeParam(key, v, fallback) {
  const range = PARAM_RANGES[key];
  if (!isFiniteNumber(v)) {
    return fallback != null ? fallback : (range ? range.min : 0);
  }
  if (range) {
    if (v < range.min || v > range.max) {
      // fuori range: clamp al più vicino, ma se il fallback è sensato usalo
      return fallback != null ? fallback : Math.max(range.min, Math.min(range.max, v));
    }
    return v;
  }
  return v;
}

// Sanitizza un intero oggetto strategia: tutti i parametri noti vengono
// ripuliti. I campi non riconosciuti vengono lasciati intatti.
function sanitizeStrategy(strategy, defaults = {}) {
  if (!strategy || typeof strategy !== 'object') return strategy;
  const out = { ...strategy };
  for (const key of Object.keys(PARAM_RANGES)) {
    if (key in out) {
      const cleaned = sanitizeParam(key, out[key], defaults[key]);
      if (cleaned !== out[key]) {
        console.warn(`[SANITIZE] ${key}: ${out[key]} -> ${cleaned} (non-finito o fuori range)`);
        out[key] = cleaned;
      }
    }
  }
  return out;
}

// Valida un singolo valore prima di promuoverlo su disco. Ritorna true se sicuro.
function isValidPromotionValue(key, v) {
  if (!isFiniteNumber(v)) return false;
  const range = PARAM_RANGES[key];
  if (range && (v < range.min || v > range.max)) return false;
  return true;
}

module.exports = { sanitizeParam, sanitizeStrategy, isValidPromotionValue, PARAM_RANGES, isFiniteNumber };
