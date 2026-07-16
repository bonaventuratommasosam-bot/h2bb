// Saldo live + equity
// EXTRACTED FROM index.js:102-110 (getEquity), 130-152 (syncLiveBalance)
// QW5: atomic rename (tmp + renameSync) su saveBalance

const fs = require('fs');
const { BALANCE_FILE } = require('../config/default');
const { isLiveMode, loadWallet, walletKey, saveWallet, getAllocated } = require('../state/wallet');
const { calcPnL } = require('./pnl');
const { getPositionSize } = require('./positions');
const { getPrice } = require('./price');
const shared = require('../state/shared');

const hlLive = require('../hyperliquid-live');

function saveBalance() {
  shared.balance.lastUpdated = new Date().toISOString();
  const tmp = BALANCE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(shared.balance, null, 2));
  fs.renameSync(tmp, BALANCE_FILE);
}

function isValidHlAddress(addr) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(addr || '')) && !/YOUR|EXAMPLE/i.test(String(addr || ''));
}

/**
 * Sync saldo da Hyperliquid.
 * - live: richiede mode=live + key
 * - observe: solo address valido (lettura pubblica, no ordini)
 */
async function syncLiveBalance(opts = {}) {
  const w = loadWallet();
  if (!w || !isValidHlAddress(w.address)) return null;
  const pk = walletKey(w);
  const allowObserve = opts.observe !== false;
  if (w.mode !== 'live' && !allowObserve) return null;
  if (w.mode === 'live' && !pk) return null;

  const b = await hlLive.getLiveBalance(w.address, pk || undefined);
  if (b.ok) {
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
    saveBalance();
    if (pk && b.accountValue != null && (!w.allocated || w.allocated < b.accountValue)) {
      w.allocated = Math.floor(b.accountValue * 100) / 100;
      saveWallet(w);
    }
  }
  return b;
}

async function getEquity() {
  const w = loadWallet();
  if (isLiveMode() || isValidHlAddress(w?.address)) {
    await syncLiveBalance({ observe: true });
    // Solo equity da API HL — mai fallback inventati
    if (shared.balance.accountValue != null && Number.isFinite(shared.balance.accountValue)) {
      return shared.balance.accountValue;
    }
    if (shared.balance.accountValuePerp != null) {
      return shared.balance.accountValuePerp + (shared.balance.usdcSpotAvailable || 0);
    }
    return null;
  }
  // Demo senza address: paper equity da balance file + PnL locale (esplicito, non HL)
  const price = await getPrice(shared.strategy.pair);
  if (price == null) return shared.balance.amount || 0;
  const p = calcPnL();
  return (shared.balance.amount || 0) + (p.heldAmount || 0) * price;
}

module.exports = { saveBalance, syncLiveBalance, getEquity, isValidHlAddress };
