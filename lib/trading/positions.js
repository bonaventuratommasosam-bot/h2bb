// Posizioni: size + entry price
// EXTRACTED FROM index.js:102-110 (getPositionSize), 112-120 (getEntryPrice)

const { isLiveMode, loadWallet, walletKey } = require('../state/wallet');
const { calcPnL } = require('./pnl');
const shared = require('../state/shared');

const hlLive = require('../hyperliquid-live');

async function getPositionSize(pair) {
  const p = pair || shared.strategy.pair;
  if (isLiveMode()) {
    const w = loadWallet();
    return hlLive.getSignedPosition(w.address, walletKey(w), p);
  }
  return calcPnL().heldAmount || 0;
}

async function getEntryPrice(pair) {
  const p = pair || shared.strategy.pair;
  if (isLiveMode()) {
    const w = loadWallet();
    try {
      return await hlLive.getEntryPrice(w.address, walletKey(w), p);
    } catch (_) {
      return 0;
    }
  }
  const avg = calcPnL().avgBuyPrice;
  return avg > 0 ? avg : 0;
}

module.exports = { getPositionSize, getEntryPrice };
