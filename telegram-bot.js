// HermesBro Trading Bot — Telegram Bridge + setup guidato Hyperliquid LIVE
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const walletStore = require('./wallet-store');

const ENGINE_PORT = parseInt(process.env.ENGINE_PORT, 10) || 3458;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '';
const DATA_DIR = process.env.DATA_DIR || __dirname;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const HL_API_URL = 'https://app.hyperliquid.xyz/API';
const SESSIONS_FILE = path.join(DATA_DIR, 'setup-sessions.json');

const sessions = loadSessions();

function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
    fs.chmodSync(SESSIONS_FILE, 0o600);
  } catch (e) {
    console.error('[BOT] saveSessions:', e.message);
  }
}

function sendTelegram(chatId, text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true });
    const req = https.request(`${TELEGRAM_API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 10000
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

function sendChatAction(chatId, action = 'typing') {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: chatId, action });
    const req = https.request(`${TELEGRAM_API}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 4000,
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(true));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(body);
    req.end();
  });
}

function keepTyping(chatId, ms = 12000) {
  sendChatAction(chatId, 'typing').catch(() => {});
  const timer = setInterval(() => sendChatAction(chatId, 'typing').catch(() => {}), 4000);
  return () => clearInterval(timer);
}

function engineRequest(method, reqPath, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: ENGINE_PORT,
      path: reqPath,
      method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 12000
    };
    const req = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('Engine parse error')); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Engine timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function isEthAddress(text) {
  return /^0x[a-fA-F0-9]{40}$/.test((text || '').trim());
}

function loadWalletFile() {
  return walletStore.loadWallet();
}

function saveWalletFile(data) {
  walletStore.saveWallet(data);
}

function persistSession(chatId) {
  if (sessions[chatId]) saveSessions();
}

function clearSession(chatId) {
  delete sessions[chatId];
  saveSessions();
}

function unauthorizedMessage() {
  return '🔒 Questo bot è già configurato da un altro account Telegram. Contatta il supporto HermesBro se serve assistenza.';
}

function autonomousConfigure(allocated) {
  return {
    active: true,
    mode: 'pro',
    amountPerTrade: Math.max(0.001, allocated * 0.005),
    tradePercent: 1,
    riskPerTradePercent: 0.5,
    maxPositionPercent: 20,
    maxDailyLossPercent: 2,
    maxDrawdownPercent: 8,
    minConfidenceScore: 65,
    checkIntervalSeconds: 45,
    intervalMinutes: 30,
    timeframes: { macro: '4h', trend: '1h', entry: '15m' },
    atrStopMultiplier: 2,
    atrTp1Multiplier: 2,
    atrTp2Multiplier: 3,
    partialTakeProfitPercent: 50,
    consecutiveLossLimit: 3,
    lossCooldownMinutes: 240,
    scaleInEnabled: true,
    maxFundingRate: 0.00005,
    minVolumeRatio: 1.1,
    watchlist: ['ETH', 'BTC', 'SOL'],
  };
}

// --- Setup iniziale: wallet + importo + scelta demo/live ---
async function handleSetup(chatId, text, session) {
  const lower = text.toLowerCase().trim();

  if (!session.step) {
    session.step = 'wallet';
    session.data = {};
    persistSession(chatId);
    return `👋 *Ciao! Sono Hermes*, il tuo agente di trading HermesBro.

Ti guido passo passo — rispondi come preferisci, in modo naturale.

*Prima cosa:* qual è l'indirizzo del tuo account *Hyperliquid*? (formato \`0x...\`)
È il wallet dove tieni USDC per tradare.`;
  }

  if (session.step === 'wallet') {
    const addr = text.trim();
    if (!isEthAddress(addr)) {
      return '❌ Indirizzo non valido. Deve essere formato `0x` + 40 caratteri hex.';
    }
    session.data.walletAddress = addr.toLowerCase();
    session.step = 'amount';
    persistSession(chatId);
    return `Perfetto, ho registrato \`${addr}\`.

*Quanto capitale* vuoi dedicare alla strategia? (in USDC)
Es: 100, 500, 1000 — dimmi solo il numero.`;
  }

  if (session.step === 'amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount < 10) {
      return '❌ Importo non valido. Inserisci un numero >= 10 (es. 100).';
    }
    session.data.amount = amount;
    session.step = 'mode';
    persistSession(chatId);
    return `Ok, budget *$${amount} USDC* — lo userò per calcolare rischio e sizing.

Vuoi partire subito con soldi *reali* su Hyperliquid, o preferisci la *demo* per provare?
Rispondi liberamente: *"si live"*, *"no demo"*, *"prima simulo"*...`;
  }

  if (session.step === 'mode') {
    if (/^(si|sì|yes|live|subito)$/i.test(lower)) {
      saveWalletFile({
        address: session.data.walletAddress,
        allocated: session.data.amount,
        mode: 'demo',
        ownerChatId: String(chatId),
        configuredAt: new Date().toISOString(),
      });
      session.step = 'hl_wait';
      session.flow = 'live';
      persistSession(chatId);
      return hlGuideMessage();
    }
    if (/^(no|demo|dopo|simul|prima|test|piu tardi|più tardi|non ancora)/i.test(lower) || /simul/i.test(lower)) {
      return await finishDemoSetup(chatId, session);
    }
    return 'Dimmi se vuoi *live* (soldi veri) o *demo* (simulazione) — come preferisci.';
  }

  return 'Qualcosa non va. Digita */start* per ricominciare.';
}

function hlGuideMessage() {
  return `🔐 *Passo 4/4 — API Wallet Hyperliquid*

1. Apri ${HL_API_URL}
2. Clicca *Generate* (nome suggerito: \`HermesBro\`)
3. *Approva* dalla tua wallet principale su Hyperliquid
4. Copia la *Private Key* mostrata (visibile una sola volta)

⚠️ La chiave dà accesso al trading: non condividerla.

Quando hai approvato l'API wallet, scrivi *pronto*`;
}

async function finishDemoSetup(chatId, session) {
  await engineRequest('POST', '/configure', autonomousConfigure(session.data.amount));

  saveWalletFile({
    address: session.data.walletAddress,
    allocated: session.data.amount,
    mode: 'demo',
    ownerChatId: String(chatId),
    configuredAt: new Date().toISOString(),
  });

  clearSession(chatId);
  sendTelegram(ADMIN_CHAT_ID, `🆕 Trading autonomo #demo\nWallet: \`${session.data.walletAddress}\`\nBudget: $${session.data.amount}`).catch(() => {});

  return `✅ *Tutto pronto!* Sto già operando in *DEMO*.

Wallet: \`${session.data.walletAddress}\` · Budget: $${session.data.amount}

*Non devi ricordare comandi* — ti scrivo io briefing, segnali e trade.
Ma puoi parlarmi *naturalmente* quando vuoi:
• *"Come va?"* · *"Analizza il mercato"* · *"Fermati"* / *"Riprendi"*
• *"Attiva live"* quando sei pronto per soldi veri`;
}

function liveActivatedMessage(w, result) {
  return `🟢 *Trading LIVE + motore PRO attivo!*

Account: \`${w.address}\`
Saldo Hyperliquid: *$${(result.balance?.usdc ?? 0).toFixed(2)} USDC*

Capitale *reale* con protezioni: max -2%/giorno, -8% drawdown, sizing ATR.
• \`analisi\` · \`rischio\` · \`ferma tutto\` (chiude tutto)
• \`pausa\` · \`stato live\` · \`modalità demo\``;
}

// --- Flusso attivazione LIVE (standalone o dopo setup) ---
async function handleLiveActivation(chatId, text, session) {
  const lower = text.toLowerCase().trim();

  if (session.step === 'hl_wait') {
    if (!/^(pronto|ok|fatto|done|ready)$/i.test(lower)) {
      return hlGuideMessage();
    }
    session.step = 'hl_key';
    persistSession(chatId);
    return `Incolla la *private key* del API wallet (inizia con \`0x\`).

⚠️ *Elimina il messaggio* da Telegram dopo l'invio — contiene dati sensibili.`;
  }

  if (session.step === 'hl_key') {
    const key = text.trim();
    const w = loadWalletFile();
    if (!w || !w.address) {
      clearSession(chatId);
      return '❌ Wallet non configurato. Usa */start* prima.';
    }

    const result = await engineRequest('POST', '/wallet/activate-live', { apiPrivateKey: key });
    if (!result.ok) {
      return `❌ ${result.error}\n\nRiprova con la private key corretta, oppure */start* per ricominciare.`;
    }

    await engineRequest('POST', '/configure', autonomousConfigure(w.allocated || 50));

    if (!w.ownerChatId) {
      w.ownerChatId = String(chatId);
      saveWalletFile(w);
    }

    clearSession(chatId);
    sendTelegram(ADMIN_CHAT_ID, `🟢 Trading LIVE #${w.address?.slice(0, 10)}…\nSaldo HL: $${result.balance?.usdc?.toFixed(2) || '?'}`).catch(() => {});

    return liveActivatedMessage(w, result);
  }

  return hlGuideMessage();
}

function startLiveFlow(chatId) {
  const w = loadWalletFile();
  if (!w || !w.address) {
    sessions[chatId] = { step: null, data: {}, flow: 'setup' };
    saveSessions();
    return handleSetup(chatId, '', sessions[chatId]);
  }
  sessions[chatId] = { step: 'hl_wait', data: {}, flow: 'live' };
  saveSessions();
  return Promise.resolve(hlGuideMessage());
}

async function handleTelegramUpdate(update) {
  if (!update.message || !update.message.text) return;
  const chatId = update.message.chat.id;
  const text = update.message.text.trim();
  const isAdmin = String(chatId) === ADMIN_CHAT_ID;
  const stopTyping = keepTyping(chatId);

  try {
  if (!walletStore.isAuthorizedChat(chatId, isAdmin) && text !== '/start') {
    return await sendTelegram(chatId, unauthorizedMessage());
  }

  if (text === '/start') {
    sessions[chatId] = { step: null, data: {}, flow: 'setup' };
    saveSessions();
    return sendTelegram(chatId, await handleSetup(chatId, '', sessions[chatId]));
  }

  if (isAdmin && text.toLowerCase() === '/reset') {
    try {
      await engineRequest('POST', '/configure', {
        active: false, stopLoss: null, takeProfit: null, intervalMinutes: 60, amountPerTrade: 0.001
      });
      await engineRequest('POST', '/wallet/demo', {});
      return sendTelegram(chatId, '🔄 Strategia e wallet resettati.');
    } catch (e) {
      return sendTelegram(chatId, `❌ Errore: ${e.message}`);
    }
  }

  if (/^(attiva\s*live|trading\s*live|passa\s*a\s*live)$/i.test(text)) {
    return sendTelegram(chatId, await startLiveFlow(chatId));
  }

  const session = sessions[chatId];
  if (session) {
    if (session.flow === 'live' || session.step === 'hl_wait' || session.step === 'hl_key') {
      return sendTelegram(chatId, await handleLiveActivation(chatId, text, session));
    }
    if (session.step === 'mode' && /^(si|sì|yes|live|subito)$/i.test(text.toLowerCase())) {
      session.step = 'hl_wait';
      session.flow = 'live';
      persistSession(chatId);
      return sendTelegram(chatId, await handleLiveActivation(chatId, text, session));
    }
    return sendTelegram(chatId, await handleSetup(chatId, text, session));
  }

  try {
    const r = await engineRequest('POST', '/chat', { text, chatId: String(chatId) });
    if (r.ok) return sendTelegram(chatId, r.reply);
    return sendTelegram(chatId, `❌ ${r.error || 'Errore engine'}`);
  } catch (e) {
    return await sendTelegram(chatId, `❌ Non riesco a raggiungere il motore. ${e.message}`);
  }
  } finally {
    stopTyping();
  }
}

function startBot() {
  const app = require('express')();
  app.use(require('express').json());

  app.post('/webhook', async (req, res) => {
    if (WEBHOOK_SECRET) {
      const token = req.get('X-Telegram-Bot-Api-Secret-Token') || '';
      if (token !== WEBHOOK_SECRET) {
        return res.status(403).json({ ok: false, error: 'invalid webhook secret' });
      }
    }
    res.json({ ok: true });
    try {
      await handleTelegramUpdate(req.body);
    } catch (e) {
      console.error('[BOT] Handler error:', e.message);
    }
  });

  app.get('/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

  const PORT = parseInt(process.env.BOT_PORT, 10) || 3459;
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[BOT] Telegram bridge on :${PORT}`);
    setTimeout(() => {
      engineRequest('POST', '/proactive/check', {}).catch((e) => {
        console.error('[BOT] Proactive kick:', e.message);
      });
    }, 8000);
    const webhookUrl = process.env.WEBHOOK_URL || '';
    if (webhookUrl) {
      const payload = { url: webhookUrl, allowed_updates: ['message'] };
      if (WEBHOOK_SECRET) payload.secret_token = WEBHOOK_SECRET;
      const body = JSON.stringify(payload);
      const req = https.request(`${TELEGRAM_API}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            if (j.ok) console.log('[BOT] Webhook set:', webhookUrl);
            else console.error('[BOT] Webhook error:', j);
          } catch { console.error('[BOT] Webhook parse error'); }
        });
      });
      req.on('error', e => console.error('[BOT] Webhook request error:', e.message));
      req.write(body);
      req.end();
    }
  });
}

const args = process.argv.slice(2);
if (args.includes('--bot-only')) {
  startBot();
} else {
  const { fork } = require('child_process');
  const engineProcess = fork('./index.js', [], { env: { ...process.env, PORT: ENGINE_PORT }, stdio: 'inherit' });
  engineProcess.on('exit', (code) => process.exit(code));
  setTimeout(startBot, 2000);
}