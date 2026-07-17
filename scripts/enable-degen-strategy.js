#!/usr/bin/env node
// Patch live strategy.json to AI degen mode (does not touch secrets).
const fs = require('fs');
const path = require('path');

const p = process.argv[2] || path.join(process.env.DATA_DIR || process.cwd(), 'strategy.json');
if (!fs.existsSync(p)) {
  console.error('missing', p);
  process.exit(1);
}
const bak = p + '.bak-pre-degen';
fs.copyFileSync(p, bak);
const s = JSON.parse(fs.readFileSync(p, 'utf8'));
Object.assign(s, {
  aiMode: 'degen',
  softMacroBlock: true,
  degenTradeInBear: true,
  aiForceEntryEnabled: true,
  minConfidenceScore: 50,
  operatorMinConfidenceScore: 50,
  riskPerTradePercent: 1.0,
  maxPositionPercent: 25,
  consecutiveLossLimit: 4,
  lossCooldownMinutes: 45,
  cashReservePercent: 2,
  scaleInEnabled: true,
  intervalMinutes: 15,
  maxFundingRate: 0.00012,
  minVolumeRatio: 0.7,
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
console.log('degen strategy written', p);
console.log({
  aiMode: s.aiMode,
  minConfidenceScore: s.minConfidenceScore,
  riskPerTradePercent: s.riskPerTradePercent,
  maxPositionPercent: s.maxPositionPercent,
  consecutiveLossLimit: s.consecutiveLossLimit,
});
