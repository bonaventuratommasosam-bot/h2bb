#!/usr/bin/env node
const fs = require('fs');
const p = process.argv[2] || 'strategy.json';
const s = JSON.parse(fs.readFileSync(p, 'utf8'));
s.maxPositionPercent = 80;
s.scaleInEnabled = true;
s.scaleInPending = true;
s.updatedAt = new Date().toISOString();
fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
console.log({ maxPositionPercent: s.maxPositionPercent, scaleInEnabled: s.scaleInEnabled, aiMode: s.aiMode });
