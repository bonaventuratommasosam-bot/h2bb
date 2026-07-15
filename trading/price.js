// getPrice con fallback simulato
// EXTRACTED FROM index.js:182-195

const { hlRequest } = require('../hyperliquid/client');
const { isLiveMode } = require('../state/wallet');
const shared = require('../state/shared');

async function getPrice(pair) {
  const coin = pair.replace(/\//g, '').replace(/USDC|USD/g, '');
  try {
    const data = await hlRequest('info', { type: 'allMids' });
    if (data && data[coin]) return parseFloat(data[coin]);
  } catch (e) {
    if (isLiveMode()) throw new Error('Prezzo Hyperliquid non disponibile — riprovo al prossimo tick');
  }
  if (isLiveMode()) throw new Error('Prezzo Hyperliquid non disponibile');
  const simPrices = { 'ETH': 1800 + Math.random() * 40, 'BTC': 42000 + Math.random() * 500, 'SOL': 145 + Math.random() * 5 };
  return simPrices[coin] || 100;
}

module.exports = { getPrice };
