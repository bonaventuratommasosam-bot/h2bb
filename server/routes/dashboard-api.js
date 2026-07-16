// API aggregate per la dashboard web
const express = require('express');
const fs = require('fs');
const path = require('path');
const { isLiveMode, loadWallet } = require('../../state/wallet');
const { getPrice } = require('../../trading/price');
const { getPositionSize, getEntryPrice } = require('../../trading/positions');
const { syncLiveBalance, getEquity } = require('../../trading/balance');
const { calcPnL } = require('../../trading/pnl');
const { getRiskBlocked, riskManager } = require('../../state/risk');
const { DATA_DIR, PORT, DEFAULT_STRATEGY } = require('../../config/default');
const { HARD_CAPS, HARD_FLOORS } = require('../../lib/hard-caps');
const performance = require('../../performance');
const eventLog = require('../../event-log');
const shared = require('../../state/shared');

const router = express.Router();

const HEARTBEAT_FILE = path.join(DATA_DIR, 'cache', 'heartbeat.json');

function readHeartbeat() {
  try {
    if (fs.existsSync(HEARTBEAT_FILE)) {
      return JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

function readJsonlTail(file, limit = 50) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf-8').trim();
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).slice(-limit).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function safeStrategyView(s) {
  if (!s) return null;
  return {
    pair: s.pair,
    mode: s.mode,
    active: s.active,
    intervalMinutes: s.intervalMinutes,
    checkIntervalSeconds: s.checkIntervalSeconds,
    minConfidenceScore: s.minConfidenceScore,
    riskPerTradePercent: s.riskPerTradePercent,
    maxPositionPercent: s.maxPositionPercent,
    maxDailyLossPercent: s.maxDailyLossPercent,
    maxDrawdownPercent: s.maxDrawdownPercent,
    consecutiveLossLimit: s.consecutiveLossLimit,
    lossCooldownMinutes: s.lossCooldownMinutes,
    atrStopMultiplier: s.atrStopMultiplier,
    atrTp1Multiplier: s.atrTp1Multiplier,
    atrTp2Multiplier: s.atrTp2Multiplier,
    watchlist: s.watchlist,
    lastTradeAt: s.lastTradeAt,
    lastDecision: s.lastDecision || null,
    lastSignal: s.lastSignal
      ? {
          action: s.lastSignal.action,
          reason: s.lastSignal.reason,
          reasonCode: s.lastSignal.reasonCode,
          score: s.lastSignal.score,
        }
      : null,
  };
}

function buildEquityCurve(trades, limit = 100) {
  const sells = trades
    .filter((t) => t.type === 'sell' && t.pnl != null)
    .slice(-limit);
  let cum = 0;
  return sells.map((t) => {
    cum += Number(t.pnl) || 0;
    return {
      t: t.ts || t.time || t.at || null,
      pnl: Number(t.pnl) || 0,
      cum: Math.round(cum * 100) / 100,
      pair: t.pair || null,
    };
  });
}

router.get('/api/dashboard', async (req, res) => {
  try {
    if (isLiveMode()) {
      try { await syncLiveBalance(); } catch {}
    }

    const pair = shared.strategy.pair;
    let price = null;
    let position = 0;
    let entryPrice = 0;
    let equity = shared.balance?.amount ?? 0;

    try { price = await getPrice(pair); } catch {}
    try { position = await getPositionSize(pair); } catch {}
    try { entryPrice = await getEntryPrice(pair); } catch {}
    try { equity = await getEquity(); } catch {}

    let p = {
      heldAmount: Math.abs(position),
      avgBuyPrice: entryPrice,
      totalInvested: Math.abs(position) * (entryPrice || 0),
    };
    if (!isLiveMode()) {
      try { p = calcPnL(); } catch { /* keep position-based fallback */ }
    }

    const held = p.heldAmount || 0;
    const avg = p.avgBuyPrice || 0;
    const pnlUnrealized = held > 0 && price ? (held * price) - (held * avg) : 0;
    const pnlPerc = avg > 0 && price ? ((price - avg) / avg) * 100 : 0;

    const riskState = shared.riskState || {};
    let stats = {};
    let trades = [];
    let events = [];
    try { stats = performance.computeStats(pair); } catch { stats = {}; }
    try { trades = performance.loadTrades(80); } catch { trades = []; }
    try { events = eventLog.query({ limit: 40 }); } catch { events = []; }
    const heartbeat = readHeartbeat();
    const snap = shared.lastTickSnapshot || {};

    const dayStart = riskState.dayStartEquity;
    const peak = riskState.peakEquity;
    const dayPnlPct = dayStart > 0 && equity != null
      ? ((equity - dayStart) / dayStart) * 100
      : null;
    const drawdownPct = peak > 0 && equity != null
      ? ((equity - peak) / peak) * 100
      : null;

    let wallet = null;
    try { wallet = loadWallet(); } catch {}

    const riskBlocked = getRiskBlocked();

    res.json({
      ok: true,
      ts: new Date().toISOString(),
      engine: {
        running: true,
        active: !!shared.strategy.active,
        operational: !!shared.strategy.active && !riskBlocked,
        mode: isLiveMode() ? 'live' : 'demo',
        pair,
        uptime: process.uptime(),
        port: PORT,
        riskBlocked,
        circuitBreaker: !!riskState.circuitBreaker,
        circuitReason: riskState.circuitReason || null,
      },
      market: {
        pair,
        price,
        heldAmount: held,
        avgBuyPrice: avg,
        totalInvested: p.totalInvested || held * avg,
        pnlUnrealized: Math.round(pnlUnrealized * 100) / 100,
        pnlPercent: Math.round(pnlPerc * 100) / 100,
        score: snap.entryScore?.score ?? shared.strategy.lastSignal?.score ?? null,
        effectiveMin: snap.entryScore?.effectiveMin ?? shared.strategy.minConfidenceScore ?? 65,
        regime: snap.entryScore?.regime ?? shared.strategy.lastDecision?.regime ?? null,
        rsi: snap.analysis?.entry?.rsi ?? null,
      },
      balance: {
        usdc: shared.balance?.amount ?? null,
        usdcPerp: shared.balance?.usdcPerp ?? null,
        usdcSpot: shared.balance?.usdcSpot ?? null,
        equity,
        source: shared.balance?.source || null,
      },
      risk: {
        ...riskState,
        dayPnlPct: dayPnlPct != null ? Math.round(dayPnlPct * 100) / 100 : null,
        drawdownPct: drawdownPct != null ? Math.round(drawdownPct * 100) / 100 : null,
        blocked: riskBlocked,
        statusText: riskManager.formatRiskStatus(riskState, shared.strategy, equity),
      },
      strategy: safeStrategyView(shared.strategy),
      hardCaps: HARD_CAPS,
      hardFloors: HARD_FLOORS,
      performance: stats,
      equityCurve: buildEquityCurve(trades, 100),
      trades: trades.slice(-30).reverse(),
      events: events.slice().reverse(),
      heartbeat,
      lastTrade: shared.lastTrade,
      wallet: wallet
        ? {
            mode: wallet.mode || 'demo',
            address: wallet.address
              ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
              : null,
            live: isLiveMode(),
          }
        : null,
      defaults: {
        minConfidenceScore: DEFAULT_STRATEGY.minConfidenceScore,
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/api/trades', (req, res) => {
  const limit = Math.min(500, parseInt(req.query.limit, 10) || 50);
  const trades = performance.loadTrades(limit).reverse();
  res.json({ ok: true, trades, count: trades.length });
});

router.get('/api/events', (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
  const type = req.query.type || undefined;
  const events = eventLog.query({ type, limit }).reverse();
  res.json({ ok: true, events, count: events.length });
});

router.get('/api/performance', (req, res) => {
  const pair = req.query.pair || shared.strategy.pair;
  res.json({ ok: true, pair, stats: performance.computeStats(pair) });
});

module.exports = router;
