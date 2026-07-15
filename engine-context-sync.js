// Scrive contesto live del motore per Hermes prefill (nessun terminale richiesto)
const fs = require('fs');
const path = require('path');

const CACHE_DIR = process.env.HERMES_CACHE_DIR
  || path.join(process.env.DATA_DIR || __dirname, 'cache');
const PREFILL_FILE = path.join(CACHE_DIR, 'engine-prefill.json');
const INTERVAL_MS = parseInt(process.env.ENGINE_CONTEXT_INTERVAL_MS, 10) || 30000;

let deps = null;

function setDeps(d) {
  deps = d;
}

function formatContext(status, wallet) {
  const s = status?.strategy || {};
  const m = status?.market || {};
  const b = status?.balance || {};
  const w = status?.wallet || {};
  const pnl = status?.pnl || {};

  return [
    'CONTESTO MOTORE TRADING (aggiornato automaticamente — USA QUESTI DATI, non inventare prezzi):',
    `Wallet: ${w.address || '?'} · Mode: ${w.mode || '?'} · Live: ${w.live ? 'sì' : 'no'}`,
    `USDC totale: $${(b.usdc ?? 0).toFixed(2)} (spot: $${(b.usdcSpot ?? 0).toFixed(2)}, perps: $${(b.usdcPerp ?? 0).toFixed(2)}) · Account value: $${(b.accountValue ?? b.usdc ?? 0).toFixed(2)}`,
    `HYPE HyperEVM: ${(b.hypeEvm ?? 0).toFixed(4)}`,
    `Strategia: ${s.pair || 'ETH'} · attiva: ${s.active ? 'SÌ' : 'NO'} · size: auto (budget ~$${(b.accountValue ?? b.usdc ?? 0).toFixed(2)})`,
    `Prezzo ${s.pair || 'ETH'}: $${(m.currentPrice ?? 0).toFixed(2)}`,
    `Posizione: ${m.heldAmount ?? 0} ${s.pair || 'ETH'} · PnL: $${(pnl.unrealized ?? 0).toFixed(2)} (${(pnl.unrealizedPercent ?? 0).toFixed(2)}%)`,
    'REGOLE: NON chiedere SSH/curl all\'utente. NON inventare prezzi. Rispondi con questi dati.',
  ].join('\n');
}

async function buildSnapshot() {
  if (!deps) return null;
  const {
    strategy, balance, isLiveMode, loadWallet, getPrice, calcPnL,
    hlLive, walletKey, syncLiveBalance,
  } = deps;

  if (isLiveMode()) await syncLiveBalance();

  const price = await getPrice(strategy.pair);
  const w = loadWallet();
  let position = 0;
  let entryPrice = 0;
  if (isLiveMode() && w?.address) {
    try {
      position = await hlLive.getSignedPosition(w.address, walletKey(w), strategy.pair);
      entryPrice = await hlLive.getEntryPrice(w.address, walletKey(w), strategy.pair);
    } catch (_) {}
  }
  const p = calcPnL();
  const held = isLiveMode() ? Math.abs(position) : p.heldAmount;
  const avgEntry = isLiveMode() && entryPrice > 0 ? entryPrice : p.avgBuyPrice;
  const pnlDollari = held > 0 ? (held * price) - (held * avgEntry) : 0;
  const pnlPerc = avgEntry > 0 ? ((price - avgEntry) / avgEntry * 100) : 0;

  const status = {
    strategy: {
      pair: strategy.pair,
      amountPerTrade: strategy.amountPerTrade,
      active: strategy.active,
      intervalMinutes: strategy.intervalMinutes,
    },
    market: {
      currentPrice: price,
      heldAmount: isLiveMode() ? Math.abs(position) : p.heldAmount,
      avgBuyPrice: avgEntry,
    },
    pnl: { unrealized: pnlDollari, unrealizedPercent: pnlPerc },
    balance: {
      usdc: balance.amount,
      usdcPerp: balance.usdcPerp,
      usdcSpot: balance.usdcSpot,
      hypeEvm: balance.hypeEvm,
      accountValue: (balance.usdcSpot ?? balance.amount) + (held * price),
      source: balance.source,
    },
    wallet: w ? { mode: w.mode, address: w.address, live: isLiveMode() } : null,
  };

  return status;
}

async function writePrefill() {
  try {
    const status = await buildSnapshot();
    if (!status) return;
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const content = formatContext(status, status.wallet);
    const payload = [{ role: 'system', content: content }];
    fs.writeFileSync(PREFILL_FILE, JSON.stringify(payload, null, 2));
    fs.chmodSync(PREFILL_FILE, 0o600);
  } catch (e) {
    console.error('[ENGINE-CONTEXT]', e.message);
  }
}

let timer = null;

function startEngineContextSync(d) {
  setDeps(d);
  if (timer) clearInterval(timer);
  writePrefill().catch(() => {});
  timer = setInterval(() => writePrefill().catch(() => {}), INTERVAL_MS);
}

module.exports = { startEngineContextSync, writePrefill, PREFILL_FILE, formatContext };