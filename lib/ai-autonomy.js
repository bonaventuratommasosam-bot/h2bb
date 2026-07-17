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

/** Ensure strategy has AI feature flags for full autonomy loop. */
function ensureAiStrategyFlags(strategy) {
  if (!strategy || typeof strategy !== 'object') return strategy;
  const on = isAiAutonomyEnabled(strategy) || strategy.aiSignalEnabled !== false;
  if (on && hasLlmCredentials()) {
    strategy.aiSignalEnabled = true;
    if (strategy.aiDynamicThreshold == null) strategy.aiDynamicThreshold = true;
    if (strategy.aiExitEnabled == null) strategy.aiExitEnabled = true;
    if (strategy.aiTakeProfitEnabled == null) strategy.aiTakeProfitEnabled = true;
  }
  return strategy;
}

function aiStatusLine(strategy) {
  const enabled = isAiAutonomyEnabled(strategy);
  const hasKey = hasLlmCredentials();
  if (!hasKey) return '[AI] autonomy idle — no LLM API key';
  if (!enabled) return '[AI] autonomy OFF (AI_AUTONOMY=0 or aiSignalEnabled=false)';
  return '[AI] autonomy ON — entry veto/boost · exit · threshold · TP (hard caps enforced)';
}

module.exports = {
  isAiAutonomyEnabled,
  ensureAiStrategyFlags,
  hasLlmCredentials,
  aiStatusLine,
};
