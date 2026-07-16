// Hyperliquid live trading — perps + spot (HyperCore) + HyperEVM
const https = require('https');

const WALLET_FILE = 'wallet.json';
const HYPEREVM_RPC = process.env.HYPEREVM_RPC || 'https://rpc.hyperliquid.xyz/evm';
const HL_INFO_URL = 'https://api.hyperliquid.xyz/info';

let sdkCache = null;
let sdkKey = '';
let sdkTs = 0;
const SDK_TTL_MS = 5 * 60 * 1000;

function normalizePrivateKey(key) {
  const k = (key || '').trim();
  if (!k) return '';
  return k.startsWith('0x') ? k : `0x${k}`;
}

function coinSymbol(pair) {
  const p = (pair || 'ETH').toUpperCase().replace(/-PERP|USDC|USD|\//g, '');
  return `${p}-PERP`;
}

const SIZE_DECIMALS = {
  BTC: 5,
  ETH: 4,
  SOL: 2,
};

function roundSizeToWire(pair, size) {
  const coin = (pair || 'ETH').toUpperCase().replace(/-PERP|USDC|USD|\//g, '');
  const decimals = SIZE_DECIMALS[coin] ?? 4;
  const factor = 10 ** decimals;
  const rounded = Math.floor(parseFloat(size) * factor) / factor;
  const min = 1 / factor;
  return rounded >= min ? rounded : 0;
}

function formatLimitPrice(pair, price) {
  const coin = (pair || 'ETH').toUpperCase().replace(/-PERP|USDC|USD|\//g, '');
  const szDecimals = SIZE_DECIMALS[coin] ?? 4;
  const maxPxDecimals = 6 - szDecimals;
  const px = parseFloat(price);
  if (!px || px <= 0) return '0';
  if (px > 100000) return String(Math.round(px));
  const sig5 = parseFloat(px.toPrecision(5));
  const factor = 10 ** maxPxDecimals;
  return String(Math.round(sig5 * factor) / factor);
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 12000,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { reject(new Error('Hyperliquid parse error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Hyperliquid timeout')); });
    req.write(data);
    req.end();
  });
}

function jsonRpc(method, params) {
  return httpPost(HYPEREVM_RPC, { jsonrpc: '2.0', id: 1, method, params });
}

async function hlInfo(type, extra = {}) {
  return httpPost(HL_INFO_URL, { type, ...extra });
}

async function getSdk(walletAddress, privateKey) {
  const pk = normalizePrivateKey(privateKey);
  const cacheId = `${walletAddress}:${pk.slice(0, 10)}`;
  if (sdkCache && sdkKey === cacheId && Date.now() - sdkTs < SDK_TTL_MS) return sdkCache;

  const { Hyperliquid } = require('hyperliquid');
  const sdk = new Hyperliquid({
    privateKey: pk,
    walletAddress: walletAddress.toLowerCase(),
    testnet: false,
    enableWs: false,
    disableAssetMapRefresh: true,
  });
  await sdk.connect();
  sdkCache = sdk;
  sdkKey = cacheId;
  sdkTs = Date.now();
  return sdk;
}

async function getPerpsState(walletAddress) {
  const addr = walletAddress.toLowerCase();
  const state = await hlInfo('clearinghouseState', { user: addr });
  const accountValue = parseFloat(state?.marginSummary?.accountValue || '0');
  const withdrawable = parseFloat(state?.withdrawable || '0');
  return { accountValue, withdrawable, raw: state };
}

async function getSpotBalances(walletAddress) {
  const addr = walletAddress.toLowerCase();
  const state = await hlInfo('spotClearinghouseState', { user: addr });
  const balances = {};
  for (const b of state?.balances || []) {
    balances[b.coin] = parseFloat(b.total || '0');
  }
  const usdc = balances.USDC || 0;
  return { usdc, balances, raw: state };
}

async function getHyperEvmHype(walletAddress) {
  try {
    const res = await jsonRpc('eth_getBalance', [walletAddress.toLowerCase(), 'latest']);
    const wei = parseInt(res?.result || '0x0', 16);
    return wei / 1e18;
  } catch {
    return 0;
  }
}

async function getUnifiedBalance(walletAddress, privateKey) {
  const addr = (walletAddress || '').trim().toLowerCase();
  const pk = normalizePrivateKey(privateKey);

  if (!/^0x[a-f0-9]{40}$/.test(addr)) {
    return { ok: false, error: 'Indirizzo wallet non valido (formato 0x...)' };
  }
  if (privateKey && !/^0x[a-f0-9]{64}$/i.test(pk)) {
    return { ok: false, error: 'Private key API non valida' };
  }

  try {
    const [perps, spot, hypeEvm] = await Promise.all([
      getPerpsState(addr),
      getSpotBalances(addr),
      getHyperEvmHype(addr),
    ]);

    const usdcPerp = perps.withdrawable;
    const usdcSpot = spot.usdc;
    const usdc = usdcPerp + usdcSpot;
    const accountValue = perps.accountValue + usdcSpot;

    return {
      ok: true,
      usdc,
      usdcPerp,
      usdcSpot,
      hypeEvm,
      accountValue,
      withdrawable: usdcPerp,
      spotBalances: spot.balances,
      source: 'hyperliquid-unified',
    };
  } catch (err) {
    return { ok: false, error: `Lettura saldo Hyperliquid fallita: ${err.message}` };
  }
}

async function verifyCredentials(walletAddress, privateKey) {
  const b = await getUnifiedBalance(walletAddress, privateKey);
  if (!b.ok) return b;
  return {
    ok: true,
    accountValue: b.accountValue,
    withdrawable: b.usdcPerp,
    usdc: b.usdc,
    usdcSpot: b.usdcSpot,
    hypeEvm: b.hypeEvm,
    raw: b,
  };
}

async function getLiveBalance(walletAddress, privateKey) {
  return getUnifiedBalance(walletAddress, privateKey);
}

async function ensurePerpCollateral(walletAddress, privateKey, minUsd = 5) {
  const addr = walletAddress.toLowerCase();
  const spot = await getSpotBalances(addr);
  const perps = await getPerpsState(addr);

  if (spot.usdc <= 0) {
    return { ok: true, transferred: 0, usdcPerp: perps.withdrawable, usdcSpot: 0 };
  }

  const need = Math.max(0, minUsd - perps.withdrawable);
  const amount = need > 0 ? Math.min(spot.usdc, need) : spot.usdc;

  if (amount < 0.01) {
    return { ok: true, transferred: 0, usdcPerp: perps.withdrawable, usdcSpot: spot.usdc };
  }

  const sdk = await getSdk(addr, privateKey);
  const result = await sdk.exchange.transferBetweenSpotAndPerp(amount, true);
  const after = await getPerpsState(addr);
  const spotAfter = await getSpotBalances(addr);

  return {
    ok: true,
    transferred: amount,
    usdcPerp: after.withdrawable,
    usdcSpot: spotAfter.usdc,
    raw: result,
  };
}

function findPerpPosition(state, pair) {
  const coin = pair.replace(/-PERP|USDC|USD|\//g, '').toUpperCase();
  return (state?.assetPositions || []).find((p) => p?.position?.coin === coin);
}

async function getSignedPosition(walletAddress, _privateKey, pair) {
  const addr = walletAddress.toLowerCase();
  const state = await hlInfo('clearinghouseState', { user: addr });
  const pos = findPerpPosition(state, pair);
  if (!pos) return 0;
  return parseFloat(pos.position.szi || '0');
}

async function getPositionSize(walletAddress, privateKey, pair) {
  return getSignedPosition(walletAddress, privateKey, pair);
}

async function getEntryPrice(walletAddress, _privateKey, pair) {
  const addr = walletAddress.toLowerCase();
  const state = await hlInfo('clearinghouseState', { user: addr });
  const pos = findPerpPosition(state, pair);
  const entry = parseFloat(pos?.position?.entryPx || '0');
  return entry > 0 ? entry : 0;
}

async function placeMarketOrder({ walletAddress, privateKey, pair, isBuy, size, slippage = 0.02, reduceOnly = false }) {
  const addr = walletAddress.toLowerCase();
  const sdk = await getSdk(addr, privateKey);

  if (isBuy && !reduceOnly) {
    const priceEst = await sdk.info.getAllMids().then((m) => {
      const coin = pair.replace(/-PERP|USDC|USD|\//g, '').toUpperCase();
      return parseFloat(m[coin] || m[`${coin}-PERP`] || '0');
    }).catch(() => 0);
    const minUsd = Math.max(5, parseFloat(size) * (priceEst || 2000) * 0.1);
    await ensurePerpCollateral(addr, privateKey, minUsd);
  }

  const symbol = coinSymbol(pair);
  const mids = await sdk.info.getAllMids();
  const midKey = symbol.replace('-PERP', '');
  const mid = parseFloat(mids[midKey] || mids[symbol] || '0');
  if (!mid) return { ok: false, error: `Prezzo non disponibile per ${pair}` };

  const sz = roundSizeToWire(pair, size);
  if (!sz) return { ok: false, error: `Size troppo piccola per ${pair}: ${size}` };
  const rawPx = isBuy ? mid * (1 + slippage) : mid * (1 - slippage);
  const limitPx = formatLimitPrice(pair, rawPx);

  const result = await sdk.exchange.placeOrder({
    coin: symbol,
    is_buy: isBuy,
    sz,
    limit_px: limitPx,
    order_type: { limit: { tif: 'Ioc' } },
    reduce_only: reduceOnly,
  });

  const status = result?.response?.data?.statuses?.[0];
  if (status?.error) {
    return { ok: false, error: status.error };
  }

  const filled = status?.filled || {};
  const fillPx = parseFloat(filled.avgPx || limitPx);
  const fillSz = parseFloat(filled.totalSz || sz);
  const slippageBps = mid > 0 ? Math.round((fillPx - mid) / mid * 10000) : null;
  return {
    ok: true,
    trade: {
      type: isBuy ? 'buy' : 'sell',
      pair: pair.replace(/-PERP/g, ''),
      amount: fillSz,
      price: fillPx,
      value: fillSz * fillPx,
      status: 'executed',
      mode: 'live',
      hlOid: filled.oid || null,
      mid,
      fillRatio: sz > 0 ? Math.round(fillSz / sz * 100) / 100 : 1,
      slippageBps,
    },
    raw: result,
  };
}

module.exports = {
  WALLET_FILE,
  verifyCredentials,
  getLiveBalance,
  getUnifiedBalance,
  ensurePerpCollateral,
  getSpotBalances,
  getPerpsState,
  getHyperEvmHype,
  getPositionSize,
  getSignedPosition,
  getEntryPrice,
  placeMarketOrder,
  coinSymbol,
};