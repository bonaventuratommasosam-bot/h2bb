// AI autonomy — when the LLM layer may influence entry/exit/threshold.
// Hard caps always win. Set AI_AUTONOMY=0 to force off.

const llmProvider = require('../llm-provider');

function hasLlmCredentials() {
  if (process.env.DEEPSEEK_API_KEY) return true;
  try {
    const cfg = llmProvider.resolveConfig?.();
    return !!(cfg && cfg.enabled && cfg.key);
  } catch {
    return false;
  }
}

/**
 * Master switch for AI decision hooks in pro-engine.
 * Priority: AI_AUTONOMY env → strategy.aiSignalEnabled → auto if API key present.
 */
function isAiAutonomyEnabled(strategy = {}) {
  if (process.env.AI_AUTONOMY === '0' || process.env.AI_AUTONOMY === 'false') {
    return false;
  }
  if (process.env.AI_AUTONOMY === '1' || process.env.AI_AUTONOMY === 'true') {
    return hasLlmCredentials();
  }
  if (strategy.aiSignalEnabled === false) {
    // Explicit off on strategy, but still allow if operator set AI_AUTONOMY=1 (handled above)
    return false;
  }
  if (strategy.aiSignalEnabled === true) {
    return hasLlmCredentials();
  }
  // Default: autonomous ON when any LLM key is configured
  return hasLlmCredentials();
}

/** Max points AI/self-learn may raise minConfidenceScore above operator base. */
const AI_MIN_SCORE_MAX_LIFT = parseInt(process.env.AI_MIN_SCORE_MAX_LIFT || '10', 10);
/** Max points they may lower it below operator base. */
const AI_MIN_SCORE_MAX_DROP = parseInt(process.env.AI_MIN_SCORE_MAX_DROP || '5', 10);

/**
 * Lock operator baseline once (so AI cannot ratchet min score to 85 forever).
 * Call on strategy load and before AI threshold patches.
 */
function lockOperatorMinScore(strategy) {
  if (!strategy || typeof strategy !== 'object') return strategy;
  if (strategy.operatorMinConfidenceScore == null) {
    const base = Number(strategy.minConfidenceScore);
    strategy.operatorMinConfidenceScore = Number.isFinite(base) ? base : 65;
  }
  return strategy;
}

/**
 * Clamp a proposed minConfidenceScore to [base-DROP, base+LIFT] ∩ [30, 85].
 */
function clampAiMinScore(proposed, strategy) {
  lockOperatorMinScore(strategy);
  const base = Number(strategy.operatorMinConfidenceScore) || 65;
  const lo = Math.max(30, base - AI_MIN_SCORE_MAX_DROP);
  const hi = Math.min(85, base + AI_MIN_SCORE_MAX_LIFT);
  const n = Math.round(Number(proposed));
  if (!Number.isFinite(n)) return base;
  return Math.max(lo, Math.min(hi, n));
}

/** Ensure strategy has AI feature flags for full autonomy loop. */
function ensureAiStrategyFlags(strategy) {
  if (!strategy || typeof strategy !== 'object') return strategy;
  lockOperatorMinScore(strategy);
  const on = isAiAutonomyEnabled(strategy) || strategy.aiSignalEnabled !== false;
  if (on && hasLlmCredentials()) {
    strategy.aiSignalEnabled = true;
    // Entry judge is evaluateDecision in tick-runner (single path).
    // Keep threshold + exit + TP in pro-engine; no duplicate entry veto.
    if (strategy.aiDynamicThreshold == null) strategy.aiDynamicThreshold = true;
    if (strategy.aiExitEnabled == null) strategy.aiExitEnabled = true;
    if (strategy.aiTakeProfitEnabled == null) strategy.aiTakeProfitEnabled = true;
    if (strategy.aiEntrySecondOpinion == null) strategy.aiEntrySecondOpinion = false;
  }
  return strategy;
}

function aiStatusLine(strategy) {
  const enabled = isAiAutonomyEnabled(strategy);
  const hasKey = hasLlmCredentials();
  if (!hasKey) return '[AI] autonomy idle — no LLM API key';
  if (!enabled) return '[AI] autonomy OFF (AI_AUTONOMY=0 or aiSignalEnabled=false)';
  const base = strategy?.operatorMinConfidenceScore ?? strategy?.minConfidenceScore ?? 65;
  return `[AI] autonomy ON — entry judge=evaluateDecision · exit/TP/threshold · minScore base ${base} ±${AI_MIN_SCORE_MAX_LIFT}/${AI_MIN_SCORE_MAX_DROP}`;
}

module.exports = {
  isAiAutonomyEnabled,
  ensureAiStrategyFlags,
  hasLlmCredentials,
  aiStatusLine,
  lockOperatorMinScore,
  clampAiMinScore,
  AI_MIN_SCORE_MAX_LIFT,
  AI_MIN_SCORE_MAX_DROP,
};
