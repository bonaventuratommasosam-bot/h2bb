#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const profile = process.argv[2] || process.cwd();
const p = path.join(profile, 'strategy.json');
const s = JSON.parse(fs.readFileSync(p, 'utf8'));
Object.assign(s, {
  active: true,
  pair: s.pair || 'BTC',
  aiMode: 'degen',
  profitPriority: true,
  scaleInOnlyInProfit: true,
  scaleInEnabled: true,
  aiForceEntryEnabled: true,
  aiExitEnabled: true,
  aiTakeProfitEnabled: true,
  takeProfitPercent: 2.5,
  stopLossPercent: 1.5,
  minConfidenceScore: 48,
  operatorMinConfidenceScore: 48,
  riskPerTradePercent: 1.2,
  maxPositionPercent: 40,
  cashReservePercent: 5,
  consecutiveLossLimit: 3,
  updatedAt: new Date().toISOString(),
});
fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
console.log('ready', { aiMode: s.aiMode, pair: s.pair, active: s.active, tpPct: s.takeProfitPercent, slPct: s.stopLossPercent });
