// Layer dati reali Hyperliquid — prezzi, portfolio pubblico, analisi multi-TF
// Funziona in sola lettura con solo address (senza private key).
// LIVE trading richiede ancora mode=live + API key cifrata.

const proEngine = require('../pro-engine');
const { getPrice } = require('../trading/price');
const { isLiveMode, loadWallet, walletKey, saveWallet } = require('../state/wallet');
const { updateTickSnapshot } = require('../engine/context-cache');
const shared = require('../state/shared');
const hlLive = require('../hyperliquid-live');

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

let marketCache = { at: 0, data: null };
let portfolioCache = { at: 0, data: null, address: null };
let watchlistCache = { at: 0, data: null };

const MARKET_TTL_MS = 12_000;
const PORTFOLIO_TTL_MS = 8_000;
const WATCHLIST_TTL_MS = 5_000;

function isPlaceholderAddress(addr) {
  const a = String(addr || '');
  return !a || /YOUR|EXAMPLE|XXX|0x0{40}/i.test(a);
}

function hasValidAddress(wallet) {
  const w = wallet || loadWallet();
  const addr = (w?.address || '').trim();
  return ADDR_RE.test(addr) && !isPlaceholderAddress(addr);
}

function dataMode() {
  if (isLiveMode()) return 'live';
  if (hasValidAddress()) return 'observe'; // portfolio reale, ordini no
  return 'demo';
}

/**
 * Sincronizza saldo/equity da Hyperliquid (info pubblica).
 * Private key non necessaria per la lettura.
 */
async function syncPortfolio(force = false) {
  const w = loadWallet();
  if (!hasValidAddress(w)) {
    return { ok: false, error: 'Indirizzo wallet non configurato', mode: 'demo' };
  }
  const addr = w.address.trim().toLowerCase();
  const now = Date.now();
  if (
    !force &&
    portfolioCache.data &&
    portfolioCache.address === addr &&
    now - portfolioCache.at < PORTFOLIO_TTL_MS
  ) {
    return portfolioCache.data;
  }

  const pk = walletKey(w); // può essere null in observe
  const b = await hlLive.getUnifiedBalance(addr, pk || undefined);
  if (!b.ok) {
    return { ok: false, error: b.error || 'lettura fallita', mode: dataMode() };
  }

  shared.balance.amount = b.usdc;
  shared.balance.usdcPerp = b.usdcPerp ?? 0;
  shared.balance.usdcSpot = b.usdcSpot ?? 0;
  shared.balance.usdcSpotAvailable = b.usdcSpotAvailable ?? null;
  shared.balance.usdcSpotHold = b.usdcSpotHold ?? null;
  shared.balance.hypeEvm = b.hypeEvm ?? 0;
  shared.balance.accountValue = b.accountValue;
  shared.balance.accountValuePerp = b.accountValuePerp ?? null;
  shared.balance.totalNtlPos = b.totalNtlPos ?? null;
  shared.balance.totalMarginUsed = b.totalMarginUsed ?? null;
  shared.balance.lastUpdated = b.fetchedAt || new Date().toISOString();
  shared.balance.source = b.source || 'hyperliquid-api';

  try {
    const { saveBalance } = require('../trading/balance');
    saveBalance();
  } catch {}

  const result = {
    ok: true,
    mode: dataMode(),
    address: addr,
    usdc: b.usdc,
    usdcPerp: b.usdcPerp,
    usdcSpot: b.usdcSpot,
    usdcSpotAvailable: b.usdcSpotAvailable,
    usdcSpotHold: b.usdcSpotHold,
    accountValuePerp: b.accountValuePerp,
    hypeEvm: b.hypeEvm,
    accountValue: b.accountValue,
    totalNtlPos: b.totalNtlPos,
    totalMarginUsed: b.totalMarginUsed,
    source: shared.balance.source,
    fetchedAt: shared.balance.lastUpdated,
  };
  portfolioCache = { at: now, data: result, address: addr };
  return result;
}

/**
 * Posizioni perps aperte (tutte) da clearinghouse pubblico.
 */
async function fetchOpenPositions(address) {
  const addr = (address || loadWallet()?.address || '').toLowerCase();
  if (!ADDR_RE.test(addr)) return [];
  try {
    const perps = await hlLive.getPerpsState(addr);
    const raw = perps?.raw || perps;
    const out = [];
    for (const ap of raw?.assetPositions || []) {
      const p = ap?.position;
      if (!p) continue;
      const szi = parseFloat(p.szi || '0');
      if (Math.abs(szi) < 1e-12) continue;
      out.push({
        coin: p.coin,
        size: szi,
        side: szi > 0 ? 'long' : 'short',
        entryPx: parseFloat(p.entryPx || '0'),
        positionValue: parseFloat(p.positionValue || '0'),
        unrealizedPnl: parseFloat(p.unrealizedPnl || '0'),
        leverage: p.leverage?.value ?? p.leverage ?? null,
        liquidationPx: p.liquidationPx != null ? parseFloat(p.liquidationPx) : null,
        marginUsed: parseFloat(p.marginUsed || '0'),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Analisi multi-TF + score (cache 12s) — dati di mercato reali.
 */
async function refreshMarketSnapshot(force = false) {
  const now = Date.now();
  if (!force && marketCache.data && now - marketCache.at < MARKET_TTL_MS) {
    return marketCache.data;
  }
  const pair = shared.strategy?.pair || 'ETH';
  const strategy = shared.strategy || { pair, minConfidenceScore: 65 };

  try {
    const analysis = await proEngine.analyzeMarket(pair, strategy);
    const entryScore = proEngine.scoreEntry(analysis, strategy);
    const price = analysis?.entry?.price
      || analysis?.entry?.ok && analysis.entry.price
      || await getPrice(pair).catch(() => null);

    const ctx = analysis?.context || {};
    const snapshot = {
      ok: true,
      pair,
      price,
      analysis,
      entryScore,
      regime: entryScore.regime || analysis?.entry?.regime || null,
      rsi: analysis?.entry?.rsi ?? null,
      score: entryScore.score,
      effectiveMin: entryScore.effectiveMin ?? strategy.minConfidenceScore ?? 65,
      bias: entryScore.bias,
      signals: entryScore.signals || [],
      funding: ctx.funding ?? null,
      openInterest: ctx.openInterest ?? null,
      reasonCode: entryScore.reasonCode || null,
      at: new Date().toISOString(),
    };

    updateTickSnapshot({
      price,
      analysis,
      entryScore,
      hasPosition: false,
    });

    // lastDecision "osservata" anche se engine non trade-a (non sovrascrive se active ha già scritto di recente)
    if (!shared.strategy.active || !shared.strategy.lastDecision) {
      shared.strategy.lastDecision = {
        action: entryScore.bias === 'long' ? 'buy' : entryScore.bias === 'blocked' ? 'hold' : 'hold',
        reason: (entryScore.signals && entryScore.signals[0]) || entryScore.bias || 'market snapshot',
        reasonCode: entryScore.reasonCode || (entryScore.bias === 'long' ? 'buy_confluence' : 'score_below_threshold'),
        score: entryScore.score,
        minScore: entryScore.effectiveMin,
        pair,
        regime: entryScore.regime,
        at: snapshot.at,
        source: 'market_snapshot',
      };
    }

    marketCache = { at: now, data: snapshot };
    return snapshot;
  } catch (e) {
    return {
      ok: false,
      error: e.message,
      pair,
      at: new Date().toISOString(),
    };
  }
}

/**
 * Mid prices reali per watchlist.
 */
async function fetchWatchlistPrices(pairs) {
  const now = Date.now();
  if (watchlistCache.data && now - watchlistCache.at < WATCHLIST_TTL_MS) {
    return watchlistCache.data;
  }
  const list = pairs || shared.strategy?.watchlist || ['ETH', 'BTC', 'SOL'];
  const { getPrices } = require('../trading/price');
  const out = await getPrices(list);
  watchlistCache = { at: now, data: out };
  return out;
}

/**
 * Salva address in wallet.json per modalità observe (sola lettura).
 */
function connectAddress(address) {
  const addr = String(address || '').trim();
  if (!ADDR_RE.test(addr) || isPlaceholderAddress(addr)) {
    return { ok: false, error: 'Indirizzo non valido (atteso 0x + 40 hex)' };
  }
  const w = loadWallet() || {};
  w.address = addr;
  // non forziamo live — solo observe
  if (w.mode === 'live' && !walletKey(w)) w.mode = 'demo';
  if (!w.mode) w.mode = 'demo';
  w.observe = true;
  w.connectedAt = new Date().toISOString();
  saveWallet(w);
  portfolioCache = { at: 0, data: null, address: null };
  return { ok: true, address: addr, mode: dataMode() };
}

module.exports = {
  hasValidAddress,
  dataMode,
  isPlaceholderAddress,
  syncPortfolio,
  fetchOpenPositions,
  refreshMarketSnapshot,
  fetchWatchlistPrices,
  connectAddress,
  MARKET_TTL_MS,
};
