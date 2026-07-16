// Wallet persistence with encrypted API keys and owner chat binding
const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./crypto');

const { DATA_DIR } = require('./config/default');
const { hasEncryptionKey } = require('./crypto');
const WALLET_FILE = path.join(DATA_DIR, 'wallet.json');

function loadJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {}
  return fallback;
}

function getPrivateKey(wallet) {
  if (!wallet) return null;
  if (wallet.apiPrivateKey) return wallet.apiPrivateKey;
  if (wallet.apiPrivateKeyEnc) return decrypt(wallet.apiPrivateKeyEnc);
  return null;
}

function stripSecrets(wallet) {
  if (!wallet) return null;
  const { apiPrivateKey, apiPrivateKeyEnc, ...safe } = wallet;
  return safe;
}

function normalizeForSave(wallet) {
  const data = { ...wallet };
  if (data.apiPrivateKey) {
    data.apiPrivateKeyEnc = encrypt(data.apiPrivateKey);
    delete data.apiPrivateKey;
  }
  return data;
}

function loadWallet() {
  const raw = loadJSON(WALLET_FILE, null);
  if (!raw) return null;
  const key = getPrivateKey(raw);
  if (key) raw.apiPrivateKey = key;
  return raw;
}

function saveWallet(data) {
  const toSave = normalizeForSave(data);
  fs.writeFileSync(WALLET_FILE, JSON.stringify(toSave, null, 2));
  try { fs.chmodSync(WALLET_FILE, 0o600); } catch {}
}

function isLiveWallet(wallet) {
  const w = wallet || loadWallet();
  if (!(w && w.mode === 'live' && w.address && getPrivateKey(w))) return false;
  if (!hasEncryptionKey()) {
    if (!isLiveWallet._warned) {
      console.error('[WALLET] LIVE bloccato: imposta WALLET_ENCRYPTION_KEY (min 16 char o 64 hex).');
      isLiveWallet._warned = true;
    }
    return false;
  }
  return true;
}

function bindOwnerChatId(chatId) {
  const w = loadWallet() || {};
  if (!w.ownerChatId) {
    w.ownerChatId = String(chatId);
    saveWallet(w);
  }
  return w.ownerChatId;
}

function isAuthorizedChat(chatId, isAdmin) {
  if (isAdmin) return true;
  const w = loadWallet();
  if (!w || !w.ownerChatId) return true;
  return String(chatId) === String(w.ownerChatId);
}

module.exports = {
  WALLET_FILE,
  loadWallet,
  saveWallet,
  getPrivateKey,
  stripSecrets,
  isLiveWallet,
  bindOwnerChatId,
  isAuthorizedChat,
};