#!/usr/bin/env node
/**
 * Adopt HL open position for bot management.
 * - Aligns pair + TP from real entry
 * - Clears sticky CB so exits/management run operational
 * - Keeps degen+capitale (scale-in only in profit)
 *
 * Prefer engine stopped, then restart after.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const profile = process.argv[2] || process.cwd();
const tpPct = parseFloat(process.argv[3] || '2.5') || 2.5;

function hlPost(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.hyperliquid.xyz',
      path: '/info',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 15000,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const stratPath = path.join(profile, 'strategy.json');
  const riskPath = path.join(profile, 'risk-state.json');
  const balPath = path.join(profile, 'balance.json');
  const walletPath = path.join(profile, 'wallet.json');

  const w = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const state = await hlPost({ type: 'clearinghouseState', user: w.address });
  const positions = [];
  for (const ap of state.assetPositions || []) {
    const pos = ap.position || {};
    const szi = parseFloat(pos.szi || 0);
    if (Math.abs(szi) > 1e-12) {
      positions.push({
        coin: pos.coin,
        szi,
        entryPx: parseFloat(pos.entryPx || 0),
        uPnl: parseFloat(pos.unrealizedPnl || 0),
        lev: pos.leverage?.value || 20,
      });
    }
  }
  if (!positions.length) {
    console.error('No open perp positions on HL');
    process.exit(2);
  }
  // Manage the largest notional position
  const mids = await hlPost({ type: 'allMids' });
  for (const p of positions) {
    const mid = parseFloat(mids[p.coin] || 0);
    p.notional = Math.abs(p.szi) * (mid || p.entryPx);
  }
  positions.sort((a, b) => b.notional - a.notional);
  const pos = positions[0];

  const s = JSON.parse(fs.readFileSync(stratPath, 'utf8'));
  const takeProfit = Math.round(pos.entryPx * (1 + tpPct / 100) * 100) / 100;
  // soft stop ~ -1.5% from entry (capital protection)
  const stopLoss = Math.round(pos.entryPx * (1 - 1.5 / 100) * 100) / 100;

  Object.assign(s, {
    pair: pos.coin,
    active: true,
    aiMode: 'degen',
    profitPriority: true,
    aiForceEntryEnabled: true,
    scaleInEnabled: true,
    scaleInOnlyInProfit: true,
    scaleInPending: false,
    softMacroBlock: true,
    degenTradeInBear: true,
    takeProfitPercent: tpPct,
    takeProfit,
    stopLoss, // absolute — tick-runner hard SL
    stopLossPercent: 1.5,
    minConfidenceScore: 48,
    operatorMinConfidenceScore: 48,
    riskPerTradePercent: 1.2,
    maxPositionPercent: 40,
    cashReservePercent: 5,
    consecutiveLossLimit: 3,
    lossCooldownMinutes: 60,
    atrStopMultiplier: 1.6,
    atrTrailMultiplier: 0.9,
    atrTp1Multiplier: 1.3,
    atrTp2Multiplier: 2.8,
    partialTakeProfitPercent: 40,
    trailingPeak: null,
    tp1Taken: false,
    positionLeg: 'full',
    checkIntervalSeconds: 30,
    aiSignalEnabled: true,
    aiExitEnabled: true,
    aiTakeProfitEnabled: true,
    updatedAt: new Date().toISOString(),
  });

  fs.writeFileSync(stratPath + '.tmp', JSON.stringify(s, null, 2) + '\n');
  fs.renameSync(stratPath + '.tmp', stratPath);

  // Reset sticky CB so engine is operational for management
  let equity = 0;
  try {
    const bal = JSON.parse(fs.readFileSync(balPath, 'utf8'));
    equity = Number(bal.accountValue || bal.amount || 0);
  } catch { /* ignore */ }
  const av = parseFloat((state.marginSummary || {}).accountValue || 0);
  const spot = 0; // keep day baseline at current equity if known
  // Prefer sum from last known if available
  if (!equity && av) equity = av;

  const today = new Date().toISOString().slice(0, 10);
  const risk = {
    dayKey: today,
    dayStartEquity: equity > 0 ? equity : (av || 0),
    dayPnl: 0,
    peakEquity: equity > 0 ? equity : (av || 0),
    consecutiveLosses: 0,
    cooldownUntil: null,
    circuitBreaker: false,
    circuitReason: null,
    stickyKind: null,
    lastUpdated: new Date().toISOString(),
    adoptedPosition: {
      coin: pos.coin,
      szi: pos.szi,
      entryPx: pos.entryPx,
      at: new Date().toISOString(),
    },
  };
  // If equity still tiny, use a sensible floor from position
  if (!(risk.dayStartEquity > 1)) {
    risk.dayStartEquity = Math.max(av, 30);
    risk.peakEquity = risk.dayStartEquity;
  }
  fs.writeFileSync(riskPath, JSON.stringify(risk, null, 2) + '\n');

  console.log(JSON.stringify({
    ok: true,
    managing: pos,
    pair: s.pair,
    takeProfit: s.takeProfit,
    stopLoss: s.stopLoss,
    takeProfitPercent: s.takeProfitPercent,
    aiMode: s.aiMode,
    scaleInOnlyInProfit: s.scaleInOnlyInProfit,
    cbCleared: true,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
