/**
 * AI trading personality modes.
 * - balanced: risk-first (default legacy)
 * - degen: aggressive AI-managed strategy, more entries, AI owns params
 *
 * Hard caps in lib/hard-caps.js always win over AI proposals.
 */

const DEGEN_PROFILE = {
  aiMode: 'degen',
  minConfidenceScore: 50,
  operatorMinConfidenceScore: 50,
  riskPerTradePercent: 1.0,
  maxPositionPercent: 25,
  consecutiveLossLimit: 4,
  lossCooldownMinutes: 45,
  cashReservePercent: 2,
  scaleInEnabled: true,
  intervalMinutes: 15,
  checkIntervalSeconds: 45,
  maxFundingRate: 0.00012,
  minVolumeRatio: 0.7,
  scannerEnabled: true,
  aiSignalEnabled: true,
  aiDynamicThreshold: true,
  aiExitEnabled: true,
  aiTakeProfitEnabled: true,
  aiEntrySecondOpinion: false,
  // Degen: AI may force entry when TA is soft-blocked / near threshold
  aiForceEntryEnabled: true,
  // Soften hard macro block (penalty instead of score=0 block)
  softMacroBlock: true,
  // Bear regime: reduce size, do not hard-flat
  degenTradeInBear: true,
};

const BALANCED_PROFILE = {
  aiMode: 'balanced',
  softMacroBlock: false,
  degenTradeInBear: false,
  aiForceEntryEnabled: false,
};

function normalizeAiMode(strategy = {}) {
  const raw = String(
    strategy.aiMode
    || process.env.AI_MODE
    || 'balanced'
  ).toLowerCase().trim();
  if (raw === 'degen' || raw === 'aggressive' || raw === 'yolo') return 'degen';
  return 'balanced';
}

function isDegenMode(strategy = {}) {
  return normalizeAiMode(strategy) === 'degen';
}

/** Min LLM confidence to approve a buy (legacy was hard-coded 80). */
function getAiEnterMinConfidence(strategy = {}) {
  if (isDegenMode(strategy)) {
    return Math.max(40, parseInt(process.env.AI_DEGEN_ENTER_CONF || '55', 10) || 55);
  }
  return Math.max(50, parseInt(process.env.AI_ENTER_CONF || '80', 10) || 80);
}

/** Score clamp band around operator base. */
function getAiScoreBand(strategy = {}) {
  if (isDegenMode(strategy)) {
    return {
      lift: parseInt(process.env.AI_DEGEN_SCORE_LIFT || '15', 10) || 15,
      drop: parseInt(process.env.AI_DEGEN_SCORE_DROP || '20', 10) || 20,
    };
  }
  return {
    lift: parseInt(process.env.AI_MIN_SCORE_MAX_LIFT || '10', 10) || 10,
    drop: parseInt(process.env.AI_MIN_SCORE_MAX_DROP || '5', 10) || 5,
  };
}

/**
 * Apply degen baseline params once (only fills missing / upgrades from ultra-conservative).
 * Does not wipe operator-tuned values that are already aggressive enough.
 */
function applyAiModeProfile(strategy = {}) {
  if (!strategy || typeof strategy !== 'object') return strategy;
  const mode = normalizeAiMode(strategy);
  strategy.aiMode = mode;

  if (mode !== 'degen') {
    if (strategy.softMacroBlock == null) strategy.softMacroBlock = false;
    if (strategy.degenTradeInBear == null) strategy.degenTradeInBear = false;
    if (strategy.aiForceEntryEnabled == null) strategy.aiForceEntryEnabled = false;
    return strategy;
  }

  const p = DEGEN_PROFILE;
  strategy.softMacroBlock = true;
  strategy.degenTradeInBear = true;
  strategy.aiForceEntryEnabled = true;
  strategy.aiSignalEnabled = true;
  strategy.aiDynamicThreshold = true;
  strategy.aiExitEnabled = true;
  strategy.aiTakeProfitEnabled = true;

  // Pull ultra-conservative live settings up toward degen floor
  if (strategy.minConfidenceScore == null || strategy.minConfidenceScore > p.minConfidenceScore) {
    strategy.minConfidenceScore = p.minConfidenceScore;
  }
  // Reset operator base for degen so clamp is not stuck at 70
  if (
    strategy.operatorMinConfidenceScore == null
    || strategy.operatorMinConfidenceScore > p.operatorMinConfidenceScore
  ) {
    strategy.operatorMinConfidenceScore = p.operatorMinConfidenceScore;
  }
  if (strategy.riskPerTradePercent == null || strategy.riskPerTradePercent < 0.5) {
    strategy.riskPerTradePercent = p.riskPerTradePercent;
  }
  if (strategy.maxPositionPercent == null || strategy.maxPositionPercent < 15) {
    strategy.maxPositionPercent = p.maxPositionPercent;
  }
  if (strategy.consecutiveLossLimit == null || strategy.consecutiveLossLimit < 3) {
    strategy.consecutiveLossLimit = p.consecutiveLossLimit;
  }
  if (strategy.lossCooldownMinutes == null || strategy.lossCooldownMinutes > 90) {
    strategy.lossCooldownMinutes = p.lossCooldownMinutes;
  }
  if (strategy.cashReservePercent == null || strategy.cashReservePercent > 5) {
    strategy.cashReservePercent = p.cashReservePercent;
  }
  if (strategy.intervalMinutes == null || strategy.intervalMinutes > 20) {
    strategy.intervalMinutes = p.intervalMinutes;
  }
  if (strategy.scaleInEnabled == null) strategy.scaleInEnabled = true;
  if (strategy.scannerEnabled == null) strategy.scannerEnabled = true;
  if (strategy.maxFundingRate != null && strategy.maxFundingRate < p.maxFundingRate) {
    strategy.maxFundingRate = p.maxFundingRate;
  }

  return strategy;
}

function degenSystemPromptExtra() {
  return `MODALITÀ DEGEN ATTIVA — sei un trader AI aggressivo (non reckless suicida, ma bias long e size-up).
Regole degen:
- Preferisci decision=enter se c'è momentum, RSI non estremo overbought, o rimbalzo da oversold; confidenza 55+ basta per enter.
- Usa strategyChanges spesso: abbassa minConfidenceScore (anche 40-55), alza riskPerTradePercent (fino al hard cap), maxPosition se serve.
- Non restare in hold eterno per "macro bearish" se c'è setup 15m/1h di rimbalzo: entra con size ridotta o piena se confidente.
- decision=adapt quando non entri: sintonizza parametri verso più aggressività se win-rate ok, o stringi stop se in perdita.
- decision=exit solo se posizione aperta e setup si è rotto.
- Parla italiano corto, degen ma onesto sul rischio.
Hard caps exchange/server restano invalidabili: non inventare size infinite.`;
}

module.exports = {
  DEGEN_PROFILE,
  BALANCED_PROFILE,
  normalizeAiMode,
  isDegenMode,
  getAiEnterMinConfidence,
  getAiScoreBand,
  applyAiModeProfile,
  degenSystemPromptExtra,
};
