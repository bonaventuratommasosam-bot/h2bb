#!/usr/bin/env node
/**
 * Apply profit-first mode. Run with engine STOPPED.
 *   systemctl stop hermes-client-trade-1
 *   node apply-profit-mode.js /path/to/profile
 *   systemctl start hermes-client-trade-1
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const profile = process.argv[2] || process.cwd();
const stratPath = path.join(profile, 'strategy.json');
const walletPath = path.join(profile, 'wallet.json');

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
  const s = JSON.parse(fs.readFileSync(stratPath, 'utf8'));
  let entry = null;
  let coin = s.pair || 'BTC';
  let size = 0;
  try {
    const w = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    if (w.address) {
      const state = await hlPost({ type: 'clearinghouseState', user: w.address });
      for (const ap of state.assetPositions || []) {
        const pos = ap.position || {};
        const szi = parseFloat(pos.szi || 0);
        if (Math.abs(szi) > 1e-12) {
          coin = pos.coin || coin;
          size = szi;
          entry = parseFloat(pos.entryPx || 0) || null;
          break;
        }
      }
    }
  } catch (e) {
    console.warn('HL lookup:', e.message);
  }

  const tpPct = 2.5;
  const takeProfit = entry > 0 ? Math.round(entry * (1 + tpPct / 100) * 100) / 100 : (s.takeProfit || null);

  Object.assign(s, {
    pair: coin,
    aiMode: 'profit',
    profitPriority: true,
    aiForceEntryEnabled: false,
    scaleInEnabled: false,
    scaleInOnlyInProfit: true,
    scaleInPending: false,
    softMacroBlock: true,
    degenTradeInBear: false,
    skipConservativeSelfLearn: false,
    takeProfitPercent: tpPct,
    takeProfit,
    minConfidenceScore: 55,
    operatorMinConfidenceScore: 55,
    riskPerTradePercent: 1.0,
    maxPositionPercent: 25,
    cashReservePercent: 5,
    consecutiveLossLimit: 3,
    lossCooldownMinutes: 60,
    atrStopMultiplier: 1.5,
    atrTrailMultiplier: 0.8,
    atrTp1Multiplier: 1.2,
    atrTp2Multiplier: 2.5,
    partialTakeProfitPercent: 50,
    checkIntervalSeconds: 30,
    intervalMinutes: 15,
    aiSignalEnabled: true,
    aiDynamicThreshold: true,
    aiExitEnabled: true,
    aiTakeProfitEnabled: true,
    active: true,
    updatedAt: new Date().toISOString(),
  });

  fs.writeFileSync(stratPath + '.tmp', JSON.stringify(s, null, 2) + '\n');
  fs.renameSync(stratPath + '.tmp', stratPath);
  console.log(JSON.stringify({
    ok: true,
    aiMode: s.aiMode,
    pair: s.pair,
    size,
    entry,
    takeProfit: s.takeProfit,
    takeProfitPercent: s.takeProfitPercent,
    profitPriority: true,
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
