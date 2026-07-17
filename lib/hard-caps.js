// Hard caps di sicurezza — inviolabili da meta-controller, shadow e AI.
// Allineati a GOAL.md: preservare capitale (risk-first).
// Override solo via env esplicito (operator intentional).

function envNum(name, fallback) {
  const v = parseFloat(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

/** Limiti massimi ammessi in produzione (ceiling). */
const HARD_CAPS = {
  riskPerTradePercent: envNum('HARD_CAP_RISK_PER_TRADE', 1.0),
  maxPositionPercent: envNum('HARD_CAP_MAX_POSITION', 25),
  maxDailyLossPercent: envNum('HARD_CAP_DAILY_LOSS', 2),
  maxDrawdownPercent: envNum('HARD_CAP_DRAWDOWN', 8),
  consecutiveLossLimit: envNum('HARD_CAP_CONSEC_LOSS', 3),
  minConfidenceScoreMin: envNum('HARD_CAP_MIN_SCORE_FLOOR', 50),
};

/** Floor minimi per parametri di protezione (non possono essere abbassati troppo). */
const HARD_FLOORS = {
  maxDailyLossPercent: 0.5,
  maxDrawdownPercent: 3,
  minConfidenceScore: 30,
  riskPerTradePercent: 0.1,
  maxPositionPercent: 5,
  consecutiveLossLimit: 1,
};

/**
 * Applica hard caps a un oggetto strategia (muta e ritorna).
 * Chiamare dopo ogni modifica autonoma e su load/save.
 */
function applyHardCaps(strategy) {
  if (!strategy || typeof strategy !== 'object') return strategy;

  if (strategy.riskPerTradePercent != null) {
    strategy.riskPerTradePercent = Math.min(
      HARD_CAPS.riskPerTradePercent,
      Math.max(HARD_FLOORS.riskPerTradePercent, strategy.riskPerTradePercent)
    );
  }
  if (strategy.maxPositionPercent != null) {
    strategy.maxPositionPercent = Math.min(
      HARD_CAPS.maxPositionPercent,
      Math.max(HARD_FLOORS.maxPositionPercent, strategy.maxPositionPercent)
    );
  }
  if (strategy.maxDailyLossPercent != null) {
    // 0 = disable daily loss circuit breaker (operator explicit)
    if (Number(strategy.maxDailyLossPercent) <= 0) {
      strategy.maxDailyLossPercent = 0;
    } else {
      strategy.maxDailyLossPercent = Math.min(
        HARD_CAPS.maxDailyLossPercent,
        Math.max(HARD_FLOORS.maxDailyLossPercent, strategy.maxDailyLossPercent)
      );
    }
  }
  if (strategy.maxDrawdownPercent != null) {
    strategy.maxDrawdownPercent = Math.min(
      HARD_CAPS.maxDrawdownPercent,
      Math.max(HARD_FLOORS.maxDrawdownPercent, strategy.maxDrawdownPercent)
    );
  }
  if (strategy.consecutiveLossLimit != null) {
    strategy.consecutiveLossLimit = Math.min(
      HARD_CAPS.consecutiveLossLimit,
      Math.max(HARD_FLOORS.consecutiveLossLimit, Math.round(strategy.consecutiveLossLimit))
    );
  }
  if (strategy.minConfidenceScore != null) {
    strategy.minConfidenceScore = Math.max(
      HARD_CAPS.minConfidenceScoreMin,
      Math.min(85, strategy.minConfidenceScore)
    );
  }

  return strategy;
}

function clampRiskAdjustment({ risk, pos, lossLimit }) {
  return {
    risk: Math.min(HARD_CAPS.riskPerTradePercent, Math.max(HARD_FLOORS.riskPerTradePercent, risk)),
    pos: Math.min(HARD_CAPS.maxPositionPercent, Math.max(HARD_FLOORS.maxPositionPercent, pos)),
    lossLimit: Math.min(
      HARD_CAPS.consecutiveLossLimit,
      Math.max(HARD_FLOORS.consecutiveLossLimit, Math.round(lossLimit))
    ),
  };
}

module.exports = { HARD_CAPS, HARD_FLOORS, applyHardCaps, clampRiskAdjustment };
