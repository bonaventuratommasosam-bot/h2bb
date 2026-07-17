// sanitize-strategy.js — layer di sicurezza per i parametri di strategia.
// Garantisce che nessun valore non-finito (NaN/Infinity) o fuori range
// possa mai essere promosso o persistito su strategy.json.
// Applica anche hard-caps risk-first (lib/hard-caps.js).

const { applyHardCaps, HARD_CAPS } = require('./hard-caps');

// Range autorevole dei parametri testabili (allineati a hard caps dove rilevante).
const PARAM_RANGES = {
  minConfidenceScore: { min: 30, max: 85 },
  atrStopMultiplier:  { min: 1,  max: 4 },
  atrTp1Multiplier:   { min: 1,  max: 5 },
  atrTp2Multiplier:   { min: 1,  max: 5 },
  intervalMinutes:    { min: 15, max: 120 },
  maxDrawdownPercent: { min: 3,  max: HARD_CAPS.maxDrawdownPercent },
  maxDailyLossPercent: { min: 0, max: Math.max(HARD_CAPS.maxDailyLossPercent, 100) },
  riskPerTradePercent: { min: 0.1, max: HARD_CAPS.riskPerTradePercent },
  maxPositionPercent: { min: 5,  max: HARD_CAPS.maxPositionPercent },
  consecutiveLossLimit: { min: 1, max: HARD_CAPS.consecutiveLossLimit },
  takeProfitPercent:  { min: 1,  max: 50 },
  stopLossPercent:     { min: 1,  max: 50 },
};

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// Se v è valido e nel range, lo ritorna. Altrimenti clamp o fallback.
function sanitizeParam(key, v, fallback) {
  const range = PARAM_RANGES[key];
  if (!isFiniteNumber(v)) {
    return fallback != null ? fallback : (range ? range.min : 0);
  }
  if (range) {
    if (v < range.min || v > range.max) {
      return Math.max(range.min, Math.min(range.max, v));
    }
    return v;
  }
  return v;
}

// Sanitizza un intero oggetto strategia + hard caps.
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
  applyHardCaps(out);
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
