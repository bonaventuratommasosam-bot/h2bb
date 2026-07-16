// Prezzi mid Hyperliquid — MAI numeri inventati.
// Se HL non risponde → null (la UI mostra "—").

const { hlRequest } = require('../hyperliquid/client');

let midsCache = { at: 0, data: null };
const MIDS_TTL_MS = 2000;

async function fetchAllMids(force = false) {
  const now = Date.now();
  if (!force && midsCache.data && now - midsCache.at < MIDS_TTL_MS) {
    return midsCache.data;
  }
  const data = await hlRequest('info', { type: 'allMids' });
  if (!data || typeof data !== 'object') {
    throw new Error('allMids vuoto');
  }
  midsCache = { at: now, data };
  return data;
}

function coinKey(pair) {
  return String(pair || 'ETH')
    .replace(/\//g, '')
    .replace(/-PERP/gi, '')
    .replace(/USDC|USD/gi, '')
    .toUpperCase();
}

/**
 * @returns {Promise<number|null>} mid reale o null (mai simulato)
 */
async function getPrice(pair) {
  const coin = coinKey(pair);
  try {
    const data = await fetchAllMids(false);
    const raw = data[coin] ?? data[`${coin}-PERP`];
    if (raw == null) return null;
    const px = parseFloat(raw);
    return Number.isFinite(px) && px > 0 ? px : null;
  } catch (e) {
    console.error('[PRICE] Hyperliquid mid non disponibile:', e.message);
    return null;
  }
}

async function getPrices(pairs) {
  const list = pairs || ['ETH', 'BTC', 'SOL'];
  try {
    const data = await fetchAllMids(false);
    return list.map((pair) => {
      const coin = coinKey(pair);
      const raw = data[coin] ?? data[`${coin}-PERP`];
      const px = raw != null ? parseFloat(raw) : NaN;
      return {
        pair: coin,
        price: Number.isFinite(px) && px > 0 ? px : null,
        ok: Number.isFinite(px) && px > 0,
        source: 'hyperliquid-allMids',
      };
    });
  } catch (e) {
    return list.map((pair) => ({
      pair: coinKey(pair),
      price: null,
      ok: false,
      error: e.message,
      source: null,
    }));
  }
}

module.exports = { getPrice, getPrices, fetchAllMids, coinKey };
