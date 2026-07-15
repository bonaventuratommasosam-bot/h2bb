// Handler: liveHelp, liveStatus, demoMode, revokeLive
// EXTRACTED FROM index.js:560-600

const { isLiveMode, loadWallet, walletKey, saveWallet } = require('../../state/wallet');
const { syncLiveBalance } = require('../../trading/balance');
const { saveStrategy } = require('../../state/strategy');
const { formatPosition } = require('../../lib/format');
const shared = require('../../state/shared');

const hlLive = require('../../hyperliquid-live');

function handleLiveHelp() {
  if (isLiveMode()) return '✅ Trading LIVE già attivo. Usa *stato live* per i dettagli.';
  return `🔐 *Attiva trading LIVE su Hyperliquid*\n\n1. Completa prima il setup con */start* (wallet + importo)\n2. Poi scrivi *attiva live* e segui i passi per l'API wallet\n\nGuida: https://app.hyperliquid.xyz/API`;
}

async function handleLiveStatus() {
  const w = loadWallet();
  if (!w) return 'Nessun wallet configurato. Usa */start*.';
  if (!isLiveMode()) {
    return `📋 Modalità: *DEMO*\nWallet: \`${w.address}\`\nScrivi *attiva live* per ordini reali su Hyperliquid.`;
  }
  const b = await syncLiveBalance();
  const pos = await hlLive.getSignedPosition(w.address, walletKey(w), shared.strategy.pair);
  return `🟢 *Trading LIVE attivo*\nWallet: \`${w.address}\`\nSaldo HL: ${(b?.usdc ?? shared.balance.amount).toFixed(2)} USDC\nPosizione: ${formatPosition(pos, shared.strategy.pair)}\nStrategia: ${shared.strategy.active ? 'attiva' : 'in pausa'}`;
}

function handleDemoMode() {
  const w = loadWallet() || {};
  delete w.apiPrivateKey;
  delete w.apiPrivateKeyEnc;
  w.mode = 'demo';
  saveWallet(w);
  shared.strategy.active = false;
  saveStrategy();
  return '↩️ Modalità *DEMO* ripristinata. API key rimossa. Scrivi *attiva live* per ricollegare Hyperliquid.';
}

function handleRevokeLive() {
  const w = loadWallet() || {};
  delete w.apiPrivateKey;
  delete w.apiPrivateKeyEnc;
  w.mode = 'demo';
  saveWallet(w);
  shared.strategy.active = false;
  saveStrategy();
  return "🔒 Connessione LIVE revocata. Modalità demo. Revoca anche l'API wallet da app.hyperliquid.xyz/API.";
}

module.exports = { handleLiveHelp, handleLiveStatus, handleDemoMode, handleRevokeLive };
