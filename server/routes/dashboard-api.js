// API aggregate per la dashboard web — dati reali Hyperliquid
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
const realData = require('../../lib/real-data');

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

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

router.get('/api/ping', (_req, res) => {
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    uptime: process.uptime(),
    pair: shared.strategy?.pair || null,
    active: !!shared.strategy?.active,
    dataMode: realData.dataMode(),
    readOnly: true,
    showcase: true,
  });
});

// NOTA: POST connect / market refresh NON sono pubblici.
// Config wallet e controlli restano sul server (localhost / systemd).

router.get('/api/dashboard', async (req, res) => {
  try {
    const dataMode = realData.dataMode();
    const pair = shared.strategy?.pair || 'ETH';

    // 1) Portfolio reale se address valido (live o observe)
    let portfolio = null;
    if (realData.hasValidAddress()) {
      portfolio = await withTimeout(realData.syncPortfolio(false), 4000, null);
      if (!portfolio?.ok) {
        portfolio = await withTimeout(syncLiveBalance({ observe: true }), 4000, null);
      }
    } else if (isLiveMode()) {
      portfolio = await withTimeout(syncLiveBalance(), 4000, null);
    }

    // 2) Analisi mercato reale (candele multi-TF + score)
    const marketSnap = await withTimeout(realData.refreshMarketSnapshot(false), 10000, null);

    // 3) Prezzi watchlist
    const watchlist = await withTimeout(
      realData.fetchWatchlistPrices(shared.strategy?.watchlist),
      5000,
      []
    );

    // 4) Posizioni HL aperte
    let openPositions = [];
    if (realData.hasValidAddress()) {
      openPositions = await withTimeout(realData.fetchOpenPositions(), 4000, []);
    }

    let price = marketSnap?.price ?? null;
    if (price == null) price = await withTimeout(getPrice(pair), 3000, null);

    let position = 0;
    let entryPrice = 0;
    if (realData.hasValidAddress() || isLiveMode()) {
      position = await withTimeout(getPositionSize(pair), 3000, 0);
      entryPrice = await withTimeout(getEntryPrice(pair), 3000, 0);
    } else {
      try {
        const pDemo = calcPnL();
        position = pDemo.heldAmount || 0;
        entryPrice = pDemo.avgBuyPrice || 0;
      } catch {
        position = 0;
        entryPrice = 0;
      }
    }

    let equity = shared.balance?.accountValue ?? shared.balance?.amount ?? 0;
    if (realData.hasValidAddress() || isLiveMode()) {
      equity = await withTimeout(getEquity(), 4000, equity);
    }

    const held = Math.abs(position) || 0;
    const avg = entryPrice || 0;
    // Preferisci uPnL ufficiale se presente nella lista posizioni
    const posRow = openPositions.find(
      (p) => String(p.coin).toUpperCase() === String(pair).toUpperCase()
    );
    let pnlUnrealized = held > 0 && price && avg
      ? (held * price) - (held * avg)
      : 0;
    if (posRow && Number.isFinite(posRow.unrealizedPnl)) {
      pnlUnrealized = posRow.unrealizedPnl;
    }
    const pnlPerc = avg > 0 && price
      ? ((price - avg) / avg) * 100 * (position < 0 ? -1 : 1)
      : 0;

    const riskState = shared.riskState || {};
    let stats = {};
    let trades = [];
    let events = [];
    try { stats = performance.computeStats(pair); } catch { stats = {}; }
    try { trades = performance.loadTrades(80); } catch { trades = []; }
    try { events = eventLog.query({ limit: 40 }); } catch { events = []; }
    const heartbeat = readHeartbeat();
    const snap = shared.lastTickSnapshot || {};
    const entryScore = marketSnap?.entryScore || snap.entryScore;

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
    const priceSource = price != null ? 'hyperliquid-allMids' : 'unavailable';
    const balanceSource = shared.balance?.source
      || (portfolio?.ok ? 'hyperliquid-api' : (dataMode === 'demo' ? 'none' : 'error'));

    res.json({
      ok: true,
      ts: new Date().toISOString(),
      readOnly: true,
      showcase: true,
      dataMode,
      sources: {
        price: priceSource,
        balance: balanceSource,
        market: marketSnap?.ok ? 'hyperliquid-candles' : 'unavailable',
        portfolio: portfolio?.ok ? 'hyperliquid-api' : (dataMode === 'demo' ? 'none' : 'error'),
      },
      engine: {
        running: true,
        active: !!shared.strategy.active,
        operational: !!shared.strategy.active && !riskBlocked,
        mode: dataMode,
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
        positionSigned: position,
        avgBuyPrice: avg,
        totalInvested: held * avg,
        pnlUnrealized: Math.round(pnlUnrealized * 100) / 100,
        pnlPercent: Math.round(pnlPerc * 100) / 100,
        // Score/RSI: calcolati da candele HL reali (non inventati, ma non sono campi nativi HL)
        score: entryScore?.score ?? marketSnap?.score ?? shared.strategy.lastSignal?.score ?? null,
        effectiveMin: entryScore?.effectiveMin ?? marketSnap?.effectiveMin ?? shared.strategy.minConfidenceScore ?? 65,
        regime: entryScore?.regime ?? marketSnap?.regime ?? null,
        rsi: marketSnap?.rsi ?? snap.analysis?.entry?.rsi ?? null,
        bias: entryScore?.bias ?? marketSnap?.bias ?? null,
        signals: entryScore?.signals ?? marketSnap?.signals ?? [],
        funding: marketSnap?.funding ?? null,
        openInterest: marketSnap?.openInterest ?? null,
        reasonCode: marketSnap?.reasonCode || entryScore?.reasonCode || null,
        priceSource: price != null ? 'hyperliquid-allMids' : 'unavailable',
        indicatorsNote: 'RSI/score da candele HL (candleSnapshot), non numeri inventati',
      },
      watchlist: watchlist || [],
      openPositions: openPositions || [],
      balance: {
        usdc: shared.balance?.amount ?? null,
        usdcPerp: shared.balance?.usdcPerp ?? null,
        usdcSpot: shared.balance?.usdcSpot ?? null,
        usdcSpotAvailable: shared.balance?.usdcSpotAvailable ?? null,
        usdcSpotHold: shared.balance?.usdcSpotHold ?? null,
        hypeEvm: shared.balance?.hypeEvm ?? null,
        equity,
        accountValue: shared.balance?.accountValue ?? equity,
        accountValuePerp: shared.balance?.accountValuePerp ?? null,
        totalNtlPos: shared.balance?.totalNtlPos ?? null,
        totalMarginUsed: shared.balance?.totalMarginUsed ?? null,
        source: balanceSource,
        lastUpdated: shared.balance?.lastUpdated || null,
        formula: realData.hasValidAddress()
          ? 'equity = HL perps accountValue + spot USDC available (total − hold)'
          : null,
      },
      hlTruth: realData.hasValidAddress()
        ? {
            note: 'Valori grezzi API Hyperliquid (info clearinghouse + spot + allMids)',
            // mai address completo in vetrina pubblica
            addressShort: wallet?.address && realData.hasValidAddress(wallet)
              ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
              : null,
            midPrice: price,
            perpsAccountValue: shared.balance?.accountValuePerp ?? null,
            spotUsdcTotal: shared.balance?.usdcSpot ?? null,
            spotUsdcHold: shared.balance?.usdcSpotHold ?? null,
            spotUsdcAvailable: shared.balance?.usdcSpotAvailable ?? null,
            positionSize: position,
            entryPx: entryPrice,
            uPnL: posRow?.unrealizedPnl ?? pnlUnrealized,
          }
        : null,
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
            dataMode,
            // solo short — vetrina pubblica
            addressShort: wallet.address && realData.hasValidAddress(wallet)
              ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
              : null,
            live: isLiveMode(),
            observe: dataMode === 'observe',
          }
        : { dataMode: 'demo' },
      defaults: {
        minConfidenceScore: DEFAULT_STRATEGY.minConfidenceScore,
      },
    });
  } catch (e) {
    console.error('[DASHBOARD]', e);
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
