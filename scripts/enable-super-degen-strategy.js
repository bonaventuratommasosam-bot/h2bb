#!/usr/bin/env node
// Force SUPER DEGEN strategy.json (stop bot first — shutdown save can clobber).
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
  macroSoftPenalty: 6,
  bearSizeMultiplier: 0.85,
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
  updatedAt: new Date().toISOString(),
});
const tmp = p + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
fs.renameSync(tmp, p);
console.log('SUPER DEGEN written', p);
console.log({
  aiMode: s.aiMode,
  minConfidenceScore: s.minConfidenceScore,
  riskPerTradePercent: s.riskPerTradePercent,
  maxPositionPercent: s.maxPositionPercent,
  enterNote: 'code enter conf ~42',
});
