#!/usr/bin/env node
// Force SUPER / MEGA SUPER DEGEN strategy.json (stop bot first — shutdown save can clobber).
const fs = require('fs');
const path = require('path');

const p = process.argv[2] || path.join(process.env.DATA_DIR || process.cwd(), 'strategy.json');
if (!fs.existsSync(p)) {
  console.error('missing', p);
  process.exit(1);
}
fs.copyFileSync(p, p + '.bak-pre-super-degen');
const s = JSON.parse(fs.readFileSync(p, 'utf8'));
Object.assign(s, {
  aiMode: 'super_degen',
  softMacroBlock: true,
  degenTradeInBear: true,
  aiForceEntryEnabled: true,
  skipConservativeSelfLearn: true,
  macroSoftPenalty: 4,
  bearSizeMultiplier: 0.9,
  minConfidenceScore: 35,
  operatorMinConfidenceScore: 35,
  riskPerTradePercent: 2.5,
  maxPositionPercent: 80,
  consecutiveLossLimit: 8,
  lossCooldownMinutes: 10,
  cashReservePercent: 0,
  scaleInEnabled: true,
  scaleInOnlyInProfit: false,
  profitPriority: false,
  intervalMinutes: 8,
  checkIntervalSeconds: 25,
  takeProfitPercent: 3.5,
  stopLossPercent: 2.5,
  maxFundingRate: 0.00035,
  minVolumeRatio: 0.4,
  scannerEnabled: true,
  aiSignalEnabled: true,
  aiDynamicThreshold: true,
  aiExitEnabled: true,
  aiTakeProfitEnabled: true,
  aiEntrySecondOpinion: false,
  notifyTradesOnly: true,
  maxDailyLossPercent: 0,
  disableDailyLossLimit: true,
  active: true,
  stopLoss: null,
  takeProfit: null,
  updatedAt: new Date().toISOString(),
});
const tmp = p + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
fs.renameSync(tmp, p);
console.log('MEGA SUPER DEGEN written', p);
console.log({
  aiMode: s.aiMode,
  minConfidenceScore: s.minConfidenceScore,
  riskPerTradePercent: s.riskPerTradePercent,
  maxPositionPercent: s.maxPositionPercent,
  notifyTradesOnly: s.notifyTradesOnly,
  enterNote: 'AI enter conf ~35 (env AI_SUPER_DEGEN_ENTER_CONF)',
});
