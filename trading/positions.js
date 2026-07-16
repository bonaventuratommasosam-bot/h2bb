// Posizioni: size + entry price
// EXTRACTED FROM index.js:102-110 (getPositionSize), 112-120 (getEntryPrice)

const { isLiveMode, loadWallet, walletKey } = require('../state/wallet');
const { calcPnL } = require('./pnl');
const shared = require('../state/shared');

const hlLive = require('../hyperliquid-live');

function canReadHlPortfolio(w) {
  const addr = w?.address || '';
  return /^0x[a-fA-F0-9]{40}$/.test(addr) && !/YOUR|EXAMPLE/i.test(addr);
}

async function getPositionSize(pair) {
  const p = pair || shared.strategy.pair;
  const w = loadWallet();
  // live o observe (address reale): posizione da Hyperliquid pubblica
  if (isLiveMode() || canReadHlPortfolio(w)) {
    try {
      return await hlLive.getSignedPosition(w.address, walletKey(w), p);
    } catch {
      return 0;
    }
  }
  return calcPnL().heldAmount || 0;
}

async function getEntryPrice(pair) {
  const p = pair || shared.strategy.pair;
  const w = loadWallet();
  if (isLiveMode() || canReadHlPortfolio(w)) {
    try {
      return await hlLive.getEntryPrice(w.address, walletKey(w), p);
    } catch (_) {
      return 0;
    }
  }
  const avg = calcPnL().avgBuyPrice;
  return avg > 0 ? avg : 0;
}

module.exports = { getPositionSize, getEntryPrice, canReadHlPortfolio };
