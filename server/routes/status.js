// Routes: /status, /health
// EXTRACTED FROM index.js:870-920

const express = require('express');
const { isLiveMode, loadWallet } = require('../../state/wallet');
const { getPrice } = require('../../trading/price');
const { getPositionSize, getEntryPrice } = require('../../trading/positions');
const { syncLiveBalance } = require('../../trading/balance');
const { calcPnL } = require('../../trading/pnl');
const { getRiskBlocked } = require('../../state/risk');
const { PORT } = require('../../config/default');
const shared = require('../../state/shared');
const { isLoopbackIp, clientIp } = require('../middleware/local-only');

const router = express.Router();

function shortAddress(addr) {
  if (!addr || typeof addr !== 'string' || addr.length < 12) return null;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

router.get('/status', async (req, res) => {
  try {
    if (isLiveMode()) await syncLiveBalance();
    const price = await getPrice(shared.strategy.pair);
    const position = await getPositionSize(shared.strategy.pair);
    const entryPrice = await getEntryPrice(shared.strategy.pair);
    const p = isLiveMode() ? { heldAmount: Math.abs(position), avgBuyPrice: entryPrice, totalInvested: Math.abs(position) * entryPrice } : calcPnL();
    const pnlDollari = p.heldAmount > 0 ? (p.heldAmount * price) - (p.heldAmount * p.avgBuyPrice) : 0;
    const pnlPerc = p.avgBuyPrice > 0 ? ((price - p.avgBuyPrice) / p.avgBuyPrice * 100) : 0;
    const local = isLoopbackIp(clientIp(req));
    const w = loadWallet();
    const walletView = w
      ? {
          mode: w.mode || 'demo',
          live: isLiveMode(),
          // full address only from localhost; public clients get short form
          address: local ? w.address : undefined,
          addressShort: shortAddress(w.address),
        }
      : null;
    res.json({
      ok: true,
      readOnly: !local,
      strategy: { pair: shared.strategy.pair, amountPerTrade: shared.strategy.amountPerTrade, intervalMinutes: shared.strategy.intervalMinutes, stopLoss: shared.strategy.stopLoss, takeProfit: shared.strategy.takeProfit, active: shared.strategy.active },
      market: { currentPrice: price, avgBuyPrice: p.avgBuyPrice, heldAmount: p.heldAmount, totalInvested: p.totalInvested },
      pnl: { unrealized: pnlDollari, unrealizedPercent: pnlPerc },
      balance: { usdc: shared.balance.amount, usdcPerp: shared.balance.usdcPerp ?? null, usdcSpot: shared.balance.usdcSpot ?? null, hypeEvm: shared.balance.hypeEvm ?? null, source: shared.balance.source || null },
      wallet: walletView,
      lastTrade: shared.lastTrade,
      lastDecision: shared.strategy.lastDecision || null,
      lastSignal: shared.strategy.lastSignal || null,
    });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.get('/health', async (req, res) => {
  try {
    const operational = shared.strategy.active && !getRiskBlocked();
    res.json({
      ok: true, engine: 'running', active: shared.strategy.active, operational,
      pair: shared.strategy.pair, mode: isLiveMode() ? 'live' : 'demo',
      riskBlocked: getRiskBlocked(), circuitBreaker: !!shared.riskState.circuitBreaker,
      circuitReason: shared.riskState.circuitReason || null,
      balance: shared.balance.amount, lastTradeAt: shared.strategy.lastTradeAt || null,
      lastDecision: shared.strategy.lastDecision || null,
      lastSignal: shared.strategy.lastSignal || null,
      uptime: process.uptime(), port: PORT,
    });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

module.exports = router;
