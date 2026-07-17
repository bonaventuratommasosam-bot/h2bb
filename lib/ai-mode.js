/**
 * AI trading personality modes.
 * - balanced: risk-first
 * - degen: aggressive AI-managed
 * - super_degen: max aggression within hard caps (AI owns strategy hard)
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
  aiForceEntryEnabled: true,
  softMacroBlock: true,
  degenTradeInBear: true,
  macroSoftPenalty: 18,
  bearSizeMultiplier: 0.55,
};

/** Super degen — force-apply these (not just "upgrade floors"). */
const SUPER_DEGEN_PROFILE = {
  aiMode: 'super_degen',
  minConfidenceScore: 40,
  operatorMinConfidenceScore: 40,
  riskPerTradePercent: 2.5,
  maxPositionPercent: 50,
  consecutiveLossLimit: 6,
  lossCooldownMinutes: 15,
  cashReservePercent: 0,
  scaleInEnabled: true,
  intervalMinutes: 10,
  checkIntervalSeconds: 30,
  maxFundingRate: 0.00025,
  minVolumeRatio: 0.5,
  scannerEnabled: true,
  aiSignalEnabled: true,
  aiDynamicThreshold: true,
  aiExitEnabled: true,
  aiTakeProfitEnabled: true,
  aiEntrySecondOpinion: false,
  aiForceEntryEnabled: true,
  softMacroBlock: true,
  degenTradeInBear: true,
  // Almost ignore macro for entries
  macroSoftPenalty: 6,
  // Nearly full size in bear
  bearSizeMultiplier: 0.85,
  // Self-learn must not defang
  skipConservativeSelfLearn: true,
};

const BALANCED_PROFILE = {
  aiMode: 'balanced',
  softMacroBlock: false,
  degenTradeInBear: false,
  aiForceEntryEnabled: false,
  skipConservativeSelfLearn: false,
};

function normalizeAiMode(strategy = {}) {
  const raw = String(
    strategy.aiMode
    || process.env.AI_MODE
    || 'balanced'
  ).toLowerCase().trim().replace(/-/g, '_');
  if (
    raw === 'super_degen'
    || raw === 'superdegen'
    || raw === 'super'
    || raw === 'yolo'
    || raw === 'max_degen'
  ) {
    return 'super_degen';
  }
  if (raw === 'degen' || raw === 'aggressive') return 'degen';
  return 'balanced';
}

function isDegenMode(strategy = {}) {
  const m = normalizeAiMode(strategy);
  return m === 'degen' || m === 'super_degen';
}

function isSuperDegenMode(strategy = {}) {
  return normalizeAiMode(strategy) === 'super_degen';
}

/** Min LLM confidence to approve a buy. */
function getAiEnterMinConfidence(strategy = {}) {
  if (isSuperDegenMode(strategy)) {
    return Math.max(35, parseInt(process.env.AI_SUPER_DEGEN_ENTER_CONF || '42', 10) || 42);
  }
  if (isDegenMode(strategy)) {
    return Math.max(40, parseInt(process.env.AI_DEGEN_ENTER_CONF || '55', 10) || 55);
  }
  return Math.max(50, parseInt(process.env.AI_ENTER_CONF || '80', 10) || 80);
}

/** Score clamp band around operator base. */
function getAiScoreBand(strategy = {}) {
  if (isSuperDegenMode(strategy)) {
    return {
      lift: parseInt(process.env.AI_SUPER_DEGEN_SCORE_LIFT || '20', 10) || 20,
      drop: parseInt(process.env.AI_SUPER_DEGEN_SCORE_DROP || '25', 10) || 25,
    };
  }
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

function getMacroSoftPenalty(strategy = {}) {
  if (strategy.macroSoftPenalty != null && Number.isFinite(Number(strategy.macroSoftPenalty))) {
    return Number(strategy.macroSoftPenalty);
  }
  if (isSuperDegenMode(strategy)) return SUPER_DEGEN_PROFILE.macroSoftPenalty;
  if (isDegenMode(strategy)) return DEGEN_PROFILE.macroSoftPenalty;
  return 18;
}

function getBearSizeMultiplier(strategy = {}) {
  if (strategy.bearSizeMultiplier != null && Number.isFinite(Number(strategy.bearSizeMultiplier))) {
    return Number(strategy.bearSizeMultiplier);
  }
  if (isSuperDegenMode(strategy)) return SUPER_DEGEN_PROFILE.bearSizeMultiplier;
  if (isDegenMode(strategy)) return DEGEN_PROFILE.bearSizeMultiplier;
  return 0;
}

/**
 * Apply mode baseline. Super degen FORCE-overwrites key aggression knobs.
 */
function applyAiModeProfile(strategy = {}) {
  if (!strategy || typeof strategy !== 'object') return strategy;
  const mode = normalizeAiMode(strategy);
  strategy.aiMode = mode;

  if (mode === 'balanced') {
    if (strategy.softMacroBlock == null) strategy.softMacroBlock = false;
    if (strategy.degenTradeInBear == null) strategy.degenTradeInBear = false;
    if (strategy.aiForceEntryEnabled == null) strategy.aiForceEntryEnabled = false;
    strategy.skipConservativeSelfLearn = false;
    return strategy;
  }

  const p = mode === 'super_degen' ? SUPER_DEGEN_PROFILE : DEGEN_PROFILE;
  const force = mode === 'super_degen';

  strategy.softMacroBlock = true;
  strategy.degenTradeInBear = true;
  strategy.aiForceEntryEnabled = true;
  strategy.aiSignalEnabled = true;
  strategy.aiDynamicThreshold = true;
  strategy.aiExitEnabled = true;
  strategy.aiTakeProfitEnabled = true;
  strategy.macroSoftPenalty = p.macroSoftPenalty;
  strategy.bearSizeMultiplier = p.bearSizeMultiplier;
  strategy.skipConservativeSelfLearn = !!p.skipConservativeSelfLearn;

  const setIf = (key, val, cmp) => {
    if (force || strategy[key] == null || cmp(strategy[key], val)) {
      strategy[key] = val;
    }
  };

  setIf('minConfidenceScore', p.minConfidenceScore, (cur, v) => cur > v);
  setIf('operatorMinConfidenceScore', p.operatorMinConfidenceScore, (cur, v) => cur > v);
  setIf('riskPerTradePercent', p.riskPerTradePercent, (cur, v) => cur < v);
  setIf('maxPositionPercent', p.maxPositionPercent, (cur, v) => cur < v);
  setIf('consecutiveLossLimit', p.consecutiveLossLimit, (cur, v) => cur < v);
  setIf('lossCooldownMinutes', p.lossCooldownMinutes, (cur, v) => cur > v);
  setIf('cashReservePercent', p.cashReservePercent, (cur, v) => cur > v);
  setIf('intervalMinutes', p.intervalMinutes, (cur, v) => cur > v);
  if (p.checkIntervalSeconds) {
    setIf('checkIntervalSeconds', p.checkIntervalSeconds, (cur, v) => cur > v);
  }
  setIf('maxFundingRate', p.maxFundingRate, (cur, v) => cur < v);
  setIf('minVolumeRatio', p.minVolumeRatio, (cur, v) => cur > v);
  strategy.scaleInEnabled = true;
  strategy.scannerEnabled = true;
  strategy.aiEntrySecondOpinion = false;

  return strategy;
}

function degenSystemPromptExtra(strategy = {}) {
  if (isSuperDegenMode(strategy)) {
    const em = getAiEnterMinConfidence(strategy);
    return `MODALITÀ SUPER DEGEN — sei un AI trader YOLO aggressivo (size-up, bias long, zero FOMO-miss).
Regole SUPER DEGEN:
- Flat: decision=enter se momentum 15m/1h, RSI non >78, rebound; conf ≥${em}.
- GIÀ IN POSIZIONE: puoi decision=add per INCREMENTARE (scale-in) se momentum regge / PnL ok / vuoi più esposizione. Conf ≥${em}.
- hold è quasi vietato: se non tradei usa adapt e alza risk / maxPosition.
- Macro bearish? Quasi ignora. Entra/add se 1h non collassa.
- Non exit panico. Scale-in è uno strumento principale: usalo.
Hard caps server restano.`;
  }
  return `MODALITÀ DEGEN ATTIVA — trader AI aggressivo (bias long e size-up).
Regole degen:
- Flat: decision=enter su momentum/rimbalzo (conf 55+).
- GIÀ IN POSIZIONE: decision=add per incrementare size se setup regge (scale-in consentito e incoraggiato).
- Non restare in hold eterno per macro se c'è setup 15m/1h.
- adapt quando non tradei. exit solo se setup rotto.
Hard caps restano invalidabili.`;
}

module.exports = {
  DEGEN_PROFILE,
  SUPER_DEGEN_PROFILE,
  BALANCED_PROFILE,
  normalizeAiMode,
  isDegenMode,
  isSuperDegenMode,
  getAiEnterMinConfidence,
  getAiScoreBand,
  getMacroSoftPenalty,
  getBearSizeMultiplier,
  applyAiModeProfile,
  degenSystemPromptExtra,
};
