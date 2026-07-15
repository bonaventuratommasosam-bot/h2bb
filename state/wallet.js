// Wrapper wallet store
// EXTRACTED FROM index.js:74-92

const walletStore = require('../wallet-store');
const shared = require('./shared');

function loadWallet() {
  return walletStore.loadWallet();
}

function saveWallet(data) {
  walletStore.saveWallet(data);
}

function walletKey(w) {
  return walletStore.getPrivateKey(w);
}

function isLiveMode() {
  return walletStore.isLiveWallet(loadWallet());
}

function liveSlippage() {
  return (shared.strategy.maxSlippage || 1.5) / 100;
}

function getAllocated() {
  const w = loadWallet();
  return w?.allocated || shared.balance.amount || 1000;
}

module.exports = { loadWallet, saveWallet, walletKey, isLiveMode, liveSlippage, getAllocated };
