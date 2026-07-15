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

async function syncLiveBalance() {
  const w = loadWallet();
  const pk = walletKey(w);
  if (!w || w.mode !== 'live' || !pk) return null;
  const b = await hlLive.getLiveBalance(w.address, pk);
  if (b.ok) {
    shared.balance.amount = b.usdc;
    shared.balance.usdcPerp = b.usdcPerp ?? 0;
    shared.balance.usdcSpot = b.usdcSpot ?? 0;
    shared.balance.hypeEvm = b.hypeEvm ?? 0;
    shared.balance.accountValue = b.accountValue ?? b.usdc;
    shared.balance.lastUpdated = new Date().toISOString();
    shared.balance.source = b.source || 'hyperliquid-unified';
    saveBalance();
    if (!w.allocated || w.allocated < b.usdc) {
      w.allocated = Math.floor(b.usdc * 100) / 100;
      saveWallet(w);
    }
  }
  return b;
}

async function getEquity() {
  const price = await getPrice(shared.strategy.pair);
  if (isLiveMode()) {
    await syncLiveBalance();
    if (shared.balance.accountValue != null && shared.balance.accountValue > 0) {
      return shared.balance.accountValue;
    }
    const cash = shared.balance.amount || 0;
    const position = await getPositionSize(shared.strategy.pair);
    return cash + Math.abs(position) * price || getAllocated();
  }
  const p = calcPnL();
  return (shared.balance.amount || 0) + (p.heldAmount || 0) * price;
}

module.exports = { saveBalance, syncLiveBalance, getEquity };
