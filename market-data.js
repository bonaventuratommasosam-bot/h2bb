// Hyperliquid OHLCV — multi-timeframe
const https = require('https');

const INTERVAL_MS = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

function hlInfo(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.hyperliquid.xyz',
      path: '/info',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 10000,
    }, (res) => {
      let data = '';
      if (res.statusCode >= 400) {
        res.on('data', () => {});
        res.on('end', () => reject(new Error(`Hyperliquid HTTP ${res.statusCode}`)));
        return;
      }
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Hyperliquid parse error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Hyperliquid timeout')); });
    req.write(payload);
    req.end();
  });
}

function coinSymbol(pair) {
  return (pair || 'ETH').replace(/-PERP|USDC|USD|\//g, '').toUpperCase();
}

/**
 * @param {string} pair
 * @param {string} interval
 * @param {number} limit - used when startTime not provided
 * @param {{ startTime?: number, endTime?: number }} [opts]
 */
async function fetchCandles(pair, interval = '15m', limit = 120, opts = {}) {
  const coin = coinSymbol(pair);
  const step = INTERVAL_MS[interval] || INTERVAL_MS['15m'];
  const endTime = opts.endTime != null ? opts.endTime : Date.now();
  const startTime = opts.startTime != null
    ? opts.startTime
    : endTime - limit * step;
  const data = await hlInfo({
    type: 'candleSnapshot',
    req: { coin, interval, startTime, endTime },
  });
  if (!Array.isArray(data) || data.length < 2) return null;
  return data.map((c) => ({
    t: c.t,
    o: parseFloat(c.o),
    h: parseFloat(c.h),
    l: parseFloat(c.l),
    c: parseFloat(c.c),
    v: parseFloat(c.v || '0'),
  })).filter((c) => Number.isFinite(c.c));
}

// FIX (Opus 4.8): allSettled instead of all — one timeframe failing doesn't
// zero the others. Log which one failed instead of making the tick fail.
async function fetchMultiTimeframe(pair, timeframes) {
  const tf = timeframes || { macro: '4h', trend: '1h', entry: '15m' };
  const results = await Promise.allSettled([
    fetchCandles(pair, tf.macro, 80),
    fetchCandles(pair, tf.trend, 100),
    fetchCandles(pair, tf.entry, 120),
  ]);
  const [macro, trend, entry] = results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    console.error(`[MARKET] fetch ${['macro','trend','entry'][i]} fallito: ${r.reason?.message || ''}`);
    return null;
  });
  return { macro, trend, entry, timeframes: tf };
}

let metaCache = null;
let metaCacheAt = 0;

async function fetchAssetContext(pair) {
  const coin = coinSymbol(pair);
  if (!metaCache || Date.now() - metaCacheAt > 120_000) {
    metaCache = await hlInfo({ type: 'metaAndAssetCtxs' });
    metaCacheAt = Date.now();
  }
  const [meta, ctxs] = metaCache || [];
  const idx = (meta?.universe || []).findIndex((u) => u.name === coin);
  if (idx < 0 || !ctxs?.[idx]) return null;
  const c = ctxs[idx];
  return {
    funding: parseFloat(c.funding || '0'),
    openInterest: parseFloat(c.openInterest || '0'),
    markPx: parseFloat(c.markPx || '0'),
    dayNtlVlm: parseFloat(c.dayNtlVlm || '0'),
  };
}

module.exports = {
  INTERVAL_MS,
  fetchCandles,
  fetchMultiTimeframe,
  fetchAssetContext,
  coinSymbol,
  hlInfo,
};
