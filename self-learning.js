// Self-learning — procedural (rule-based) pre-tune of strategy params by regime.
// Does NOT place orders. AI decision layer may override after this.

const PARAM_BOUNDS = {
  minConfidenceScore: { min: 40, max: 80 },
  rsiOversold: { min: 25, max: 45 },
  rsiOverbought: { min: 55, max: 80 },
  atrStopMultiplier: { min: 1.2, max: 3.5 },
  riskPerTradePercent: { min: 0.1, max: 1.0 },
};

function clamp(key, v) {
  const b = PARAM_BOUNDS[key];
  if (!b || v == null || !Number.isFinite(Number(v))) return null;
  return Math.max(b.min, Math.min(b.max, Number(v)));
}

/**
 * Suggest small param drifts from multi-TF analysis + entry score.
 * @returns {{ suggestions: object, regime: string, reason: string }}
 */
function suggestTuning(analysis, entryScore, strategy = {}) {
  const entry = analysis?.entry || {};
  const macro = analysis?.macro || {};
  const regime = entryScore?.regime || entry.regime || 'mixed';
  const adx = entry.adx ?? macro.adx ?? 0;
  const suggestions = {};
  const notes = [];

  // Use operator base so self-learn cannot ratchet score forever
  let baseMin = strategy.operatorMinConfidenceScore ?? strategy.minConfidenceScore ?? 65;
  try {
    const { clampAiMinScore, lockOperatorMinScore } = require('./lib/ai-autonomy');
    lockOperatorMinScore(strategy);
    baseMin = strategy.operatorMinConfidenceScore ?? baseMin;
    if (regime === 'trending' || (adx > 25 && (macro.trend === 'bullish' || entry.trend === 'bullish'))) {
      suggestions.minConfidenceScore = clampAiMinScore(baseMin - 3, strategy);
      suggestions.atrStopMultiplier = clamp(
        'atrStopMultiplier',
        (strategy.atrStopMultiplier ?? 2) + 0.2
      );
      notes.push('regime trending → soglia -3 (capped), stop ATR +0.2');
    } else if (regime === 'ranging' || regime === 'mean-reversion' || adx < 18) {
      suggestions.minConfidenceScore = clampAiMinScore(baseMin + 5, strategy);
      suggestions.rsiOversold = clamp('rsiOversold', Math.min(strategy.rsiOversold ?? 35, 32));
      notes.push('regime ranging → soglia +5 (capped), RSI oversold più stretto');
    } else {
      notes.push('regime mixed → nessun tune aggressivo');
    }
  } catch {
    if (regime === 'trending' || (adx > 25 && (macro.trend === 'bullish' || entry.trend === 'bullish'))) {
      suggestions.minConfidenceScore = clamp('minConfidenceScore', baseMin - 3);
      suggestions.atrStopMultiplier = clamp('atrStopMultiplier', (strategy.atrStopMultiplier ?? 2) + 0.2);
      notes.push('regime trending → soglia -3, stop ATR +0.2');
    } else if (regime === 'ranging' || regime === 'mean-reversion' || adx < 18) {
      suggestions.minConfidenceScore = clamp('minConfidenceScore', baseMin + 5);
      suggestions.rsiOversold = clamp('rsiOversold', Math.min(strategy.rsiOversold ?? 35, 32));
      notes.push('regime ranging → soglia +5, RSI oversold più stretto');
    } else {
      notes.push('regime mixed → nessun tune aggressivo');
    }
  }

  if (entryScore?.score != null && entryScore.score < 40) {
    suggestions.riskPerTradePercent = clamp(
      'riskPerTradePercent',
      Math.max(0.2, (strategy.riskPerTradePercent ?? 0.5) - 0.1)
    );
    notes.push('score debole → risk -0.1%');
  }

  // Drop nulls / no-ops
  for (const k of Object.keys(suggestions)) {
    if (suggestions[k] == null || suggestions[k] === strategy[k]) delete suggestions[k];
  }

  return {
    suggestions,
    regime,
    reason: notes.join('; ') || 'no change',
  };
}

/**
 * Apply suggestions onto strategy object (mutates), returns list of changed keys.
 */
function applySuggestions(strategy, suggestions, { hardCapRisk = 1.0 } = {}) {
  if (!strategy || !suggestions) return [];
  const changed = [];
  for (const [k, v] of Object.entries(suggestions)) {
    if (v == null || strategy[k] === undefined) continue;
    let val = v;
    if (k === 'riskPerTradePercent') val = Math.min(hardCapRisk, val);
    if (strategy[k] !== val) {
      strategy[k] = val;
      changed.push(k);
    }
  }
  return changed;
}

module.exports = {
  suggestTuning,
  applySuggestions,
  PARAM_BOUNDS,
};
