/**
 * AI trading personality modes.
 * - profit: PRIORITY = make money (bank gains, TP, no FOMO scale-in)
 * - balanced: risk-first
 * - degen / super_degen: aggressive (not default)
 *
 * Hard caps in lib/hard-caps.js always win over AI proposals.
 */

const PROFIT_PROFILE = {
  aiMode: 'profit',
  // Priority: realize gains, protect edge, selective entry
  minConfidenceScore: 55,
  operatorMinConfidenceScore: 55,
  riskPerTradePercent: 1.0,
  maxPositionPercent: 25,
  consecutiveLossLimit: 3,
  lossCooldownMinutes: 60,
  cashReservePercent: 5,
  scaleInEnabled: false, // only add when already green (enforced in tick)
  scaleInOnlyInProfit: true,
  intervalMinutes: 15,
  checkIntervalSeconds: 30,
  takeProfitPercent: 2.5,
  // tighter ATR targets to bank sooner
  atrStopMultiplier: 1.5,
  atrTrailMultiplier: 0.8,
  atrTp1Multiplier: 1.2,
  atrTp2Multiplier: 2.5,
  partialTakeProfitPercent: 50,
  maxFundingRate: 0.0001,
  minVolumeRatio: 0.8,
  scannerEnabled: true,
  aiSignalEnabled: true,
  aiDynamicThreshold: true,
  aiExitEnabled: true,
  aiTakeProfitEnabled: true,
  aiEntrySecondOpinion: false,
  aiForceEntryEnabled: false,
  softMacroBlock: true,
  degenTradeInBear: false,
  macroSoftPenalty: 12,
  bearSizeMultiplier: 0,
  skipConservativeSelfLearn: false,
  // AI: bank profits aggressively
  profitPriority: true,
};

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

const SUPER_DEGEN_PROFILE = {
  aiMode: 'super_degen',
  minConfidenceScore: 40,
  operatorMinConfidenceScore: 40,
  riskPerTradePercent: 2.5,
  maxPositionPercent: 80,
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
  macroSoftPenalty: 6,
  bearSizeMultiplier: 0.85,
  skipConservativeSelfLearn: true,
};

const BALANCED_PROFILE = {
  aiMode: 'balanced',
  softMacroBlock: false,
  degenTradeInBear: false,
  aiForceEntryEnabled: false,
  skipConservativeSelfLearn: false,
  profitPriority: false,
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
  if (
    raw === 'profit'
    || raw === 'money'
    || raw === 'profit_first'
    || raw === 'make_money'
    || raw === 'standard'
  ) {
    return 'profit';
  }
  return 'balanced';
}

function isDegenMode(strategy = {}) {
  const m = normalizeAiMode(strategy);
  return m === 'degen' || m === 'super_degen';
}

function isSuperDegenMode(strategy = {}) {
  return normalizeAiMode(strategy) === 'super_degen';
}

function isProfitMode(strategy = {}) {
  return normalizeAiMode(strategy) === 'profit' || strategy.profitPriority === true;
}

/** Min LLM confidence to approve a buy. */
function getAiEnterMinConfidence(strategy = {}) {
  if (isSuperDegenMode(strategy)) {
    return Math.max(35, parseInt(process.env.AI_SUPER_DEGEN_ENTER_CONF || '42', 10) || 42);
  }
  if (isDegenMode(strategy)) {
    return Math.max(40, parseInt(process.env.AI_DEGEN_ENTER_CONF || '55', 10) || 55);
  }
  if (isProfitMode(strategy)) {
    return Math.max(50, parseInt(process.env.AI_PROFIT_ENTER_CONF || '60', 10) || 60);
  }
  return Math.max(50, parseInt(process.env.AI_ENTER_CONF || '80', 10) || 80);
}

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
  if (isProfitMode(strategy)) {
    return { lift: 12, drop: 10 };
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
  if (isProfitMode(strategy)) return PROFIT_PROFILE.macroSoftPenalty;
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

function applyAiModeProfile(strategy = {}) {
  if (!strategy || typeof strategy !== 'object') return strategy;
  const mode = normalizeAiMode(strategy);
  strategy.aiMode = mode;

  if (mode === 'balanced') {
    if (strategy.softMacroBlock == null) strategy.softMacroBlock = false;
    if (strategy.degenTradeInBear == null) strategy.degenTradeInBear = false;
    if (strategy.aiForceEntryEnabled == null) strategy.aiForceEntryEnabled = false;
    strategy.skipConservativeSelfLearn = false;
    strategy.profitPriority = false;
    return strategy;
  }

  if (mode === 'profit') {
    const p = PROFIT_PROFILE;
    strategy.profitPriority = true;
    strategy.softMacroBlock = true;
    strategy.degenTradeInBear = false;
    strategy.aiForceEntryEnabled = false;
    strategy.scaleInEnabled = false;
    strategy.scaleInOnlyInProfit = true;
    strategy.scaleInPending = false;
    strategy.aiSignalEnabled = true;
    strategy.aiDynamicThreshold = true;
    strategy.aiExitEnabled = true;
    strategy.aiTakeProfitEnabled = true;
    strategy.skipConservativeSelfLearn = false;
    strategy.macroSoftPenalty = p.macroSoftPenalty;
    // Force profit knobs (operator intent: make money)
    for (const [k, v] of Object.entries(p)) {
      if (k === 'aiMode') continue;
      strategy[k] = v;
    }
    return strategy;
  }

  const p = mode === 'super_degen' ? SUPER_DEGEN_PROFILE : DEGEN_PROFILE;
  const force = mode === 'super_degen';

  strategy.profitPriority = false;
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
    return `MODALITÀ SUPER DEGEN — AI trader YOLO (size-up). enter conf≥${em}. Scale-in ok. Hard caps restano.`;
  }
  return `MODALITÀ DEGEN — bias long, conf≥55 enter/add. Hard caps restano.`;
}

function profitSystemPromptExtra(strategy = {}) {
  const em = getAiEnterMinConfidence(strategy);
  const tp = strategy.takeProfitPercent ?? 2.5;
  return `PRIORITÀ ASSOLUTA: FARE SOLDI (realized PnL), non massimizzare size.
Regole PROFIT:
1) In posizione con profitto: preferisci decision=exit se conf≥50 e il setup si indebolisce; NON aggiungere size in perdita.
2) Take profit ~${tp}% è un obiettivo: non aspettare il moon. decision=exit se PnL positivo e momentum inizia a girare.
3) Flat: enter solo se conf≥${em} e edge chiaro. Niente FOMO.
4) decision=add SOLO se già in profitto e room ok (scale-in only-in-profit).
5) Mai alzare maxPosition per "fare volume". Abbassa rischio se day PnL negativo.
6) hold va bene se stai aspettando TP; non hold infinito senza piano.`;
}

module.exports = {
  PROFIT_PROFILE,
  DEGEN_PROFILE,
  SUPER_DEGEN_PROFILE,
  BALANCED_PROFILE,
  normalizeAiMode,
  isDegenMode,
  isSuperDegenMode,
  isProfitMode,
  getAiEnterMinConfidence,
  getAiScoreBand,
  getMacroSoftPenalty,
  getBearSizeMultiplier,
  applyAiModeProfile,
  degenSystemPromptExtra,
  profitSystemPromptExtra,
};
