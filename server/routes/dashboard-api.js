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
const marketData = require('../../market-data');
const { buildTrustReport } = require('../../lib/trust-report');
const {
  renderTrustBadgeSvg,
  trustBadgeMarkdown,
  trustBadgeHtml,
} = require('../../lib/trust-badge');

const router = express.Router();

const HEARTBEAT_FILE = path.join(DATA_DIR, 'cache', 'heartbeat.json');

/** Cache price chart so 5s dashboard poll does not hammer HL candles. */
let priceChartCache = { key: null, at: 0, data: null };
const PRICE_CHART_TTL_MS = 45_000;

/** Last trust report for /api/trust + /badge.svg (avoid HL hammer). */
let trustCache = { at: 0, trust: null, meta: null };
const TRUST_CACHE_TTL_MS = 20_000;

function publicBaseUrl(req) {
  const envBase = process.env.PUBLIC_BASE_URL || process.env.SHOWCASE_URL;
  if (envBase) return String(envBase).replace(/\/$/, '');
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}

/**
 * Lightweight trust from in-memory shared state (no HL round-trip).
 * Used by badge/api when dashboard cache is cold/stale.
 */
function buildTrustFromShared() {
  const dataMode = realData.dataMode();
  const pair = shared.strategy?.pair || 'ETH';
  const riskState = shared.riskState || {};
  const bal = shared.balance || {};
  const snap = shared.lastTickSnapshot || {};
  const marketSnap = shared.marketSnapshot || snap.market || null;
  const entryScore = marketSnap?.entryScore || snap.entryScore || null;
  const riskBlocked = getRiskBlocked();

  const equity = bal.accountValue ?? bal.amount ?? null;
  const perpAV = bal.accountValuePerp ?? null;
  const spotAvail = bal.usdcSpotAvailable ?? null;
  let equityCheck = null;
  if (perpAV != null && spotAvail != null && equity != null) {
    const expected = Number(perpAV) + Number(spotAvail);
    const delta = Number(equity) - expected;
    equityCheck = {
      expected: Math.round(expected * 100) / 100,
      actual: Math.round(Number(equity) * 100) / 100,
      delta: Math.round(delta * 100) / 100,
      ok: Math.abs(delta) < 0.05,
      formula: 'equity = perp accountValue + spot USDC available',
    };
  }

  const price = marketSnap?.price
    ?? snap.price
    ?? entryScore?.price
    ?? null;
  const pos = Number(snap.position ?? marketSnap?.positionSigned ?? 0);
  const held = Math.abs(pos);
  const liveScore = entryScore?.score ?? marketSnap?.score ?? null;
  const liveMin = entryScore?.effectiveMin
    ?? marketSnap?.effectiveMin
    ?? shared.strategy?.minConfidenceScore
    ?? 65;
  const liveBias = entryScore?.bias ?? marketSnap?.bias ?? null;
  const liveSignals = entryScore?.signals ?? marketSnap?.signals ?? [];
  const liveReasonCode = marketSnap?.reasonCode || entryScore?.reasonCode || null;

  let signalAction = 'wait';
  let signalReason = (liveSignals || []).slice(0, 2).join(' · ') || 'Evaluating';
  if (riskBlocked || riskState.circuitBreaker) {
    signalAction = 'blocked';
    signalReason = riskState.circuitReason || 'risk block';
  } else if (!shared.strategy?.active) {
    signalAction = 'idle';
    signalReason = 'Engine paused';
  } else if (held > 1e-9) {
    signalAction = 'in_position';
    signalReason = `Holding ${held} ${pair}`;
  } else if (liveBias === 'blocked') {
    signalAction = 'blocked';
    signalReason = liveSignals[0] || 'setup blocked';
  }

  const lastDec = shared.strategy?.lastDecision || null;
  let decisionAgeSec = null;
  if (lastDec?.at) {
    const t = Date.parse(lastDec.at);
    if (Number.isFinite(t)) decisionAgeSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  }

  const signalLive = {
    action: signalAction,
    reasonCode: liveReasonCode || signalAction,
    reason: signalReason,
    score: liveScore,
    minScore: liveMin,
    at: marketSnap?.at || snap.at || new Date().toISOString(),
    source: 'shared_snapshot',
  };

  const trust = buildTrustReport({
    dataMode,
    readOnly: true,
    showcase: true,
    price,
    priceSource: price != null ? 'shared-snapshot' : null,
    portfolioOk: bal.source === 'hyperliquid-api' || equity != null,
    equityCheck,
    decisionAgeSec,
    signalLive,
    position: {
      side: pos > 0 ? 'long' : pos < 0 ? 'short' : 'flat',
      size: held,
      entryPx: null,
      markPx: price,
    },
    engine: {
      active: !!shared.strategy?.active,
      operational: !!shared.strategy?.active && !riskBlocked,
      circuitBreaker: !!riskState.circuitBreaker,
      riskBlocked,
    },
    risk: {
      circuitBreaker: !!riskState.circuitBreaker,
      circuitReason: riskState.circuitReason || null,
      stickyKind: riskState.stickyKind || null,
    },
    sources: {
      price: price != null ? 'shared-snapshot' : 'unavailable',
      portfolio: bal.source || 'shared',
    },
    hardCaps: HARD_CAPS,
    hardFloors: HARD_FLOORS,
  });

  return {
    trust,
    meta: {
      pair,
      dataMode,
      active: !!shared.strategy?.active,
      source: 'shared',
    },
  };
}

function getCachedOrSharedTrust() {
  const age = Date.now() - (trustCache.at || 0);
  if (trustCache.trust && age < TRUST_CACHE_TTL_MS) {
    return {
      trust: trustCache.trust,
      meta: { ...(trustCache.meta || {}), cacheAgeMs: age, source: trustCache.meta?.source || 'cache' },
    };
  }
  const fresh = buildTrustFromShared();
  trustCache = { at: Date.now(), trust: fresh.trust, meta: { ...fresh.meta, source: 'shared' } };
  return {
    trust: trustCache.trust,
    meta: { ...trustCache.meta, cacheAgeMs: 0 },
  };
}

function tradeTimestampMs(t) {
  const raw = t.timestamp ?? t.ts ?? t.time ?? t.at ?? t.loggedAt;
  if (raw == null) return null;
  if (typeof raw === 'number') return raw < 1e12 ? raw * 1000 : raw;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/** Map dashboard / TradingView-style TF → HL interval */
function normalizeChartInterval(raw) {
  const s = String(raw || '').toLowerCase().trim();
  const map = {
    '5': '5m',
    '5m': '5m',
    '15': '15m',
    '15m': '15m',
    '60': '1h',
    '1h': '1h',
    '240': '4h',
    '4h': '4h',
    d: '1d',
    '1d': '1d',
    day: '1d',
  };
  return map[s] || null;
}

/**
 * OHLCV series + bot buy/sell markers for the active pair.
 * @param {string} pair
 * @param {Array} trades
 * @param {{ interval?: string }} [opts] preferred HL interval (5m/15m/1h/4h/1d)
 */
async function buildPriceChart(pair, trades, opts = {}) {
  const p = String(pair || 'ETH').toUpperCase();
  const markers = (trades || [])
    .filter((t) => String(t.pair || '').toUpperCase() === p)
    .filter((t) => {
      const ty = String(t.type || t.side || '').toLowerCase();
      return ty === 'buy' || ty === 'sell';
    })
    .map((t) => {
      const tms = tradeTimestampMs(t);
      const price = Number(t.price ?? t.mid);
      if (tms == null || !Number.isFinite(price) || price <= 0) return null;
      const ty = String(t.type || t.side || '').toLowerCase();
      return {
        t: tms,
        type: ty === 'sell' ? 'sell' : 'buy',
        price,
        amount: t.amount != null ? Number(t.amount) : null,
        pnl: t.pnl != null ? Number(t.pnl) : null,
        pair: p,
        mode: t.mode || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);

  const now = Date.now();
  let start = now - 7 * 86_400_000;
  if (markers.length) {
    start = Math.min(...markers.map((m) => m.t)) - 12 * 3_600_000;
  }
  // Cap lookback (HL candleSnapshot has practical limits)
  const maxLookback = 45 * 86_400_000;
  if (now - start > maxLookback) start = now - maxLookback;

  const span = now - start;
  let interval = normalizeChartInterval(opts.interval);
  if (!interval) {
    interval = '1h';
    if (span > 21 * 86_400_000) interval = '4h';
    else if (span > 5 * 86_400_000) interval = '1h';
    else if (span > 2 * 86_400_000) interval = '15m';
    else interval = '5m';
  }

  // Wider window for coarser TF so chart is not empty
  const step = marketData.INTERVAL_MS[interval] || 3_600_000;
  const minBars = 80;
  if (now - start < minBars * step) {
    start = now - minBars * step;
  }

  const cacheKey = `${p}:${interval}:${Math.floor(start / 3_600_000)}:${markers.length}`;
  if (
    priceChartCache.data &&
    priceChartCache.key === cacheKey &&
    now - priceChartCache.at < PRICE_CHART_TTL_MS
  ) {
    return priceChartCache.data;
  }

  let candles = null;
  try {
    candles = await marketData.fetchCandles(p, interval, 500, {
      startTime: start,
      endTime: now,
    });
  } catch (e) {
    console.error('[DASHBOARD] price chart candles:', e.message);
  }

  const series = (candles || []).map((c) => ({
    t: c.t,
    o: c.o,
    h: c.h,
    l: c.l,
    c: c.c,
  }));

  const t0 = series.length ? series[0].t : start;
  const t1 = series.length ? series[series.length - 1].t + step : now;
  const visible = markers.filter((m) => m.t >= t0 - step && m.t <= t1 + step);

  const payload = {
    pair: p,
    interval,
    from: t0,
    to: t1,
    candles: series,
    markers: visible,
    buys: visible.filter((m) => m.type === 'buy').length,
    sells: visible.filter((m) => m.type === 'sell').length,
  };
  priceChartCache = { key: cacheKey, at: now, data: payload };
  return payload;
}

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

/** Spot TV reference for the bot pair (perp mid is always HL allMids). */
function chartRefForPair(pair) {
  const p = String(pair || 'ETH').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const map = {
    ETH: 'COINBASE:ETHUSD',
    BTC: 'COINBASE:BTCUSD',
    SOL: 'COINBASE:SOLUSD',
    ARB: 'COINBASE:ARBUSD',
    DOGE: 'COINBASE:DOGEUSD',
    AVAX: 'COINBASE:AVAXUSD',
    LINK: 'COINBASE:LINKUSD',
    HYPE: 'BINANCE:HYPEUSDT',
  };
  return map[p] || `COINBASE:${p}USD`;
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
    try { trades = performance.loadTrades(300); } catch { trades = []; }
    try { events = eventLog.query({ limit: 40 }); } catch { events = []; }

    const chartTf = normalizeChartInterval(req.query.chartTf || req.query.tf || req.query.interval);
    const priceChart = await withTimeout(
      buildPriceChart(pair, trades, { interval: chartTf || undefined }),
      8000,
      null
    );
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

    const r2 = (n) => (n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 100) / 100);
    const r4 = (n) => (n == null || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 10000) / 10000);

    // --- Live score (authoritative for showcase signal; not stale lastDecision) ---
    const liveScore = entryScore?.score ?? marketSnap?.score ?? null;
    const liveMin = entryScore?.effectiveMin
      ?? marketSnap?.effectiveMin
      ?? shared.strategy.minConfidenceScore
      ?? 65;
    const baseMin = shared.strategy.minConfidenceScore ?? DEFAULT_STRATEGY.minConfidenceScore ?? 65;
    const liveBias = entryScore?.bias ?? marketSnap?.bias ?? null;
    const liveSignals = entryScore?.signals ?? marketSnap?.signals ?? [];
    const liveRegime = entryScore?.regime ?? marketSnap?.regime ?? null;
    const liveReasonCode = marketSnap?.reasonCode || entryScore?.reasonCode || null;

    let signalAction = 'wait';
    let signalCode = liveReasonCode || 'score_below_threshold';
    let signalReason = (liveSignals || []).slice(0, 2).join(' · ') || 'Evaluating market';
    if (riskBlocked || riskState.circuitBreaker) {
      signalAction = 'blocked';
      signalCode = 'risk_block';
      signalReason = riskState.circuitReason || 'risk blocked';
    } else if (!shared.strategy.active) {
      signalAction = 'idle';
      signalCode = 'engine_paused';
      signalReason = 'Engine paused';
    } else if (held > 1e-9) {
      signalAction = 'in_position';
      signalCode = 'holding';
      signalReason = `Holding ${held} ${pair} · entry ${avg || '—'} · uPnL ${r2(pnlUnrealized)}`;
    } else if (
      liveScore != null
      && liveMin != null
      && liveScore >= liveMin
      && (liveBias === 'long' || liveBias === 'buy')
    ) {
      signalAction = 'buy_ready';
      signalCode = liveReasonCode || 'buy_confluence';
      signalReason = liveSignals[0] || 'confluence met';
    } else if (liveBias === 'blocked') {
      signalAction = 'blocked';
      signalCode = liveReasonCode || 'blocked';
      signalReason = liveSignals[0] || 'setup blocked';
    } else {
      signalAction = 'wait';
      signalCode = liveReasonCode || 'score_below_threshold';
      signalReason = liveSignals.length
        ? liveSignals.slice(0, 2).join(' · ')
        : `score ${liveScore ?? '—'}/${liveMin} (need ≥ min)`;
    }

    const signalLive = {
      action: signalAction,
      reasonCode: signalCode,
      reason: signalReason,
      score: liveScore,
      minScore: liveMin,
      baseMinScore: baseMin,
      regime: liveRegime,
      bias: liveBias,
      signals: liveSignals,
      at: marketSnap?.at || new Date().toISOString(),
      source: 'live_score',
    };

    // Stale lastDecision (often written by market_snapshot — do not treat as live intent)
    const lastDec = shared.strategy.lastDecision || null;
    let decisionAgeSec = null;
    if (lastDec?.at) {
      const t = Date.parse(lastDec.at);
      if (Number.isFinite(t)) decisionAgeSec = Math.max(0, Math.round((Date.now() - t) / 1000));
    }

    const perpAV = shared.balance?.accountValuePerp ?? null;
    const spotAvail = shared.balance?.usdcSpotAvailable ?? null;
    let equityCheck = null;
    if (perpAV != null && spotAvail != null && equity != null) {
      const expected = Number(perpAV) + Number(spotAvail);
      const delta = Number(equity) - expected;
      equityCheck = {
        expected: r2(expected),
        actual: r2(equity),
        delta: r2(delta),
        ok: Math.abs(delta) < 0.05,
        formula: 'equity = perp accountValue + spot USDC available',
      };
    }

    const dayPnlUsd = dayStart > 0 && equity != null ? r2(equity - dayStart) : null;
    const notional = held > 0 && price != null ? r2(held * price) : 0;
    const distanceToEntryPct = avg > 0 && price != null
      ? r2(((price - avg) / avg) * 100 * (position < 0 ? -1 : 1))
      : null;

    const positionView = {
      coin: pair,
      size: held,
      side: position > 0 ? 'long' : position < 0 ? 'short' : 'flat',
      entryPx: avg || null,
      markPx: price,
      notional,
      invested: r2(held * avg),
      uPnL: r2(pnlUnrealized),
      uPnLpct: r2(pnlPerc),
      distanceToEntryPct,
      leverage: posRow?.leverage ?? null,
      marginUsed: posRow?.marginUsed ?? shared.balance?.totalMarginUsed ?? null,
      liquidationPx: posRow?.liquidationPx ?? null,
      positionValue: posRow?.positionValue != null ? r2(posRow.positionValue) : notional,
    };

    const pnlView = {
      unrealized: r2(pnlUnrealized),
      unrealizedPct: r2(pnlPerc),
      dayUsd: dayPnlUsd,
      dayPct: dayPnlPct != null ? r2(dayPnlPct) : null,
      closedTotal: stats.totalPnl != null ? r2(stats.totalPnl) : null,
      winRate: stats.winRate ?? null,
      closedTrades: stats.closedTrades ?? 0,
      expectancy: stats.expectancy ?? null,
      profitFactor: stats.profitFactor ?? null,
    };

    const dataQuality = {
      ok: price != null && (portfolio?.ok !== false || dataMode === 'demo'),
      equityCheck,
      decisionAgeSec,
      signalStale: decisionAgeSec != null && decisionAgeSec > 180,
      scoreVsLastDecision: lastDec?.score != null && liveScore != null
        ? {
            live: liveScore,
            lastDecision: lastDec.score,
            diverge: Math.abs(Number(liveScore) - Number(lastDec.score)) >= 10,
          }
        : null,
      notes: [
        `Mark mid = Hyperliquid allMids (perp ${pair}). TradingView chart = ${chartRefForPair(pair)} spot reference.`,
        'RSI/score derived from HL candleSnapshot (computed, not exchange-native fields).',
        'signalLive is current score/bias; strategy.lastDecision may be stale history.',
      ],
    };

    const trust = buildTrustReport({
      dataMode,
      readOnly: true,
      showcase: true,
      price,
      priceSource: price != null ? 'hyperliquid-allMids' : null,
      portfolioOk: portfolio?.ok !== false,
      equityCheck,
      decisionAgeSec,
      signalLive,
      position: positionView,
      engine: {
        active: !!shared.strategy.active,
        operational: !!shared.strategy.active && !riskBlocked,
        circuitBreaker: !!riskState.circuitBreaker,
        riskBlocked,
      },
      risk: {
        circuitBreaker: !!riskState.circuitBreaker,
        circuitReason: riskState.circuitReason || null,
        stickyKind: riskState.stickyKind || null,
      },
      sources: {
        price: priceSource,
        balance: balanceSource,
        market: marketSnap?.ok ? 'hyperliquid-candles' : 'unavailable',
        portfolio: portfolio?.ok ? 'hyperliquid-api' : (dataMode === 'demo' ? 'none' : 'error'),
      },
      hardCaps: HARD_CAPS,
      hardFloors: HARD_FLOORS,
    });
    trustCache = {
      at: Date.now(),
      trust,
      meta: {
        pair,
        dataMode,
        active: !!shared.strategy.active,
        source: 'dashboard',
      },
    };

    // Normalize trade timestamps for UI
    const tradesOut = trades.slice(-30).reverse().map((t) => ({
      ...t,
      ts: t.timestamp || t.ts || t.time || t.at || t.loggedAt || null,
      type: t.type || t.side || null,
      pair: t.pair || pair,
      price: t.price != null ? Number(t.price) : null,
      pnl: t.pnl != null ? Number(t.pnl) : null,
    }));

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
      dataQuality,
      trust,
      signalLive,
      position: positionView,
      pnl: pnlView,
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
        pnlUnrealized: r2(pnlUnrealized),
        pnlPercent: r2(pnlPerc),
        // Live score from candles — never substitute stale lastSignal score
        score: liveScore,
        effectiveMin: liveMin,
        baseMinScore: baseMin,
        regime: liveRegime,
        rsi: marketSnap?.rsi ?? snap.analysis?.entry?.rsi ?? null,
        bias: liveBias,
        signals: liveSignals,
        funding: marketSnap?.funding ?? null,
        fundingPct: marketSnap?.funding != null ? r4(marketSnap.funding * 100) : null,
        openInterest: marketSnap?.openInterest ?? null,
        reasonCode: liveReasonCode,
        priceSource: price != null ? 'hyperliquid-allMids' : 'unavailable',
        venue: 'hyperliquid-perp',
        chartRef: chartRefForPair(pair),
        indicatorsNote: 'RSI/score da candele HL (candleSnapshot), non numeri inventati',
        snapshotAt: marketSnap?.at || null,
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
        equity: r2(equity),
        accountValue: shared.balance?.accountValue ?? equity,
        accountValuePerp: shared.balance?.accountValuePerp ?? null,
        totalNtlPos: shared.balance?.totalNtlPos ?? null,
        totalMarginUsed: shared.balance?.totalMarginUsed ?? null,
        source: balanceSource,
        lastUpdated: shared.balance?.lastUpdated || null,
        formula: realData.hasValidAddress()
          ? 'equity = HL perps accountValue + spot USDC available (total − hold)'
          : null,
        equityCheck,
      },
      hlTruth: realData.hasValidAddress()
        ? {
            note: 'Valori grezzi API Hyperliquid (info clearinghouse + spot + allMids)',
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
        dayPnlPct: dayPnlPct != null ? r2(dayPnlPct) : null,
        dayPnlUsd,
        dayStartEquity: dayStart ?? null,
        drawdownPct: drawdownPct != null ? r2(drawdownPct) : null,
        peakEquity: peak ?? null,
        blocked: riskBlocked,
        statusText: riskManager.formatRiskStatus(riskState, shared.strategy, equity),
      },
      strategy: safeStrategyView(shared.strategy),
      hardCaps: HARD_CAPS,
      hardFloors: HARD_FLOORS,
      performance: stats,
      priceChart: priceChart || null,
      equityCurve: buildEquityCurve(trades, 100),
      trades: tradesOut,
      events: events.slice().reverse(),
      heartbeat,
      lastTrade: shared.lastTrade,
      wallet: wallet
        ? {
            mode: wallet.mode || 'demo',
            dataMode,
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

/** Lightweight public trust report (cached / shared snapshot). */
router.get('/api/trust', (req, res) => {
  try {
    const { trust, meta } = getCachedOrSharedTrust();
    const base = publicBaseUrl(req);
    res.setHeader('Cache-Control', 'public, max-age=15');
    res.json({
      ok: true,
      readOnly: true,
      showcase: true,
      ts: new Date().toISOString(),
      trust,
      meta,
      links: {
        terminal: `${base}/?trust=1`,
        badge: `${base}/badge.svg`,
        dashboard: `${base}/api/dashboard`,
        markdown: trustBadgeMarkdown(base, trust),
        html: trustBadgeHtml(base),
      },
    });
  } catch (e) {
    console.error('[TRUST]', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/** Embeddable SVG badge — also at /api/trust/badge.svg */
function sendTrustBadge(req, res) {
  try {
    const { trust } = getCachedOrSharedTrust();
    const svg = renderTrustBadgeSvg(trust);
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=30');
    res.setHeader('X-Trust-Grade', String(trust.grade || ''));
    res.setHeader('X-Trust-Score', String(trust.score ?? ''));
    res.setHeader('X-Trust-Status', String(trust.status || ''));
    res.send(svg);
  } catch (e) {
    console.error('[BADGE]', e);
    res.status(500).type('text/plain').send('badge error');
  }
}
router.get('/badge.svg', sendTrustBadge);
router.get('/api/trust/badge.svg', sendTrustBadge);

module.exports = router;
