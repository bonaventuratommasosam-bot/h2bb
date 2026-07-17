#!/usr/bin/env node
/** Disable daily loss CB + clear sticky. Engine should be stopped. */
const fs = require('fs');
const path = require('path');
const profile = process.argv[2] || process.cwd();

const stratPath = path.join(profile, 'strategy.json');
const riskPath = path.join(profile, 'risk-state.json');
const balPath = path.join(profile, 'balance.json');

const s = JSON.parse(fs.readFileSync(stratPath, 'utf8'));
s.maxDailyLossPercent = 0;
s.disableDailyLossLimit = true;
s.active = true;
s.updatedAt = new Date().toISOString();
fs.writeFileSync(stratPath, JSON.stringify(s, null, 2) + '\n');

let equity = 0;
try {
  const bal = JSON.parse(fs.readFileSync(balPath, 'utf8'));
  equity = Number(bal.accountValue || bal.amount || 0);
} catch { /* ignore */ }

const today = new Date().toISOString().slice(0, 10);
const risk = {
  dayKey: today,
  dayStartEquity: equity > 0 ? equity : 30,
  dayPnl: 0,
  peakEquity: equity > 0 ? equity : 30,
  consecutiveLosses: 0,
  cooldownUntil: null,
  circuitBreaker: false,
  circuitReason: null,
  stickyKind: null,
  lastUpdated: new Date().toISOString(),
};
fs.writeFileSync(riskPath, JSON.stringify(risk, null, 2) + '\n');
console.log(JSON.stringify({
  ok: true,
  maxDailyLossPercent: 0,
  disableDailyLossLimit: true,
  circuitBreaker: false,
  note: 'daily loss CB disabled; drawdown CB still active unless also disabled',
}, null, 2));
