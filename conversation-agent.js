// Agente conversazionale Hermes — profilo SOUL + NLU veloce + proattività
const fs = require('fs');
const path = require('path');
const https = require('https');
const hermesProfile = require('./hermes-profile');
const llmProvider = require('./llm-provider');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const HISTORY_FILE = path.join(DATA_DIR, 'conversation-history.json');
const MAX_TURNS = 20;

function getPersona() {
  return hermesProfile.tradingSystemPrompt(hermesProfile.loadSoul(DATA_DIR));
}

function loadHistories() {
  try {
    if (fs.existsSync(HISTORY_FILE)) return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
  } catch {}
  return {};
}

function saveHistories(histories) {
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(histories, null, 2)); }
  catch (e) { console.error('[AGENT] save history:', e.message); }
}

function getHistory(chatId) {
  return loadHistories()[String(chatId)] || [];
}

function appendHistory(chatId, role, content) {
  const all = loadHistories();
  const id = String(chatId);
  if (!all[id]) all[id] = [];
  all[id].push({ role, content, at: new Date().toISOString() });
  if (all[id].length > MAX_TURNS) all[id] = all[id].slice(-MAX_TURNS);
  saveHistories(all);
}

function normalize(text) {
  return (text || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.0-9$%?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const INTENT_RULES = [
  { intent: 'chat', freeform: true, re: /(solo comandi|non sei intelligen|sei intelligen|proattiv|menu di comandi|rispondi solo|devi scrivermi|devi avvisarmi|non aspettare comandi)/ },
  { intent: 'kill', cmd: 'ferma tutto', re: /(ferma tutto|kill switch|emergency|chiudi tutto|vendi tutto e ferma|stop totale)/ },
  { intent: 'pause', cmd: 'pausa', re: /(pausa|ferma|stop|blocca|sospendi|non tradare|aspetta)/ },
  { intent: 'resume', cmd: 'resume', re: /(riprendi|riparti|riattiva|continua|vai|attiva trad)/ },
  { intent: 'analysis', cmd: 'analisi', re: /(analisi|analizza|mercato|che ne pensi|buon momento|conviene entrare|setup|segnale|pensi di|cosa ne pensi)/ },
  { intent: 'scanner', cmd: 'scanner', re: /(scanner|scansiona|opportunita|cosa conviene|miglior pair|btc o eth|quale coin)/ },
  { intent: 'performance', cmd: 'performance', re: /(performance|statistiche|win rate|quanto ho guadagnato|quanto ho perso|risultati|profitto totale)/ },
  { intent: 'risk', cmd: 'rischio', re: /(rischio|protezione|drawdown|perdite|limiti|sicurezza|quanto posso perdere|nervos|paura|sicuro)/ },
  { intent: 'status', cmd: 'come sta andando?', re: /(come va|come sta|andamento|status|pnl|posizione|quanto vale|situazione|recap|va tutto|che fai|cosa fai|adesso|ora cosa)/ },
  { intent: 'balance', cmd: 'saldo', re: /(saldo|quanto ho|balance|wallet|capitale|usdc)/ },
  { intent: 'liveStatus', cmd: 'stato live', re: /(stato live|connessione|hyperliquid|live status)/ },
  { intent: 'liveHelp', cmd: 'attiva live', re: /(attiva live|trading live|passa a live|ordini reali|soldi veri|voglio live|passare a live)/ },
  { intent: 'demoMode', cmd: 'modalita demo', re: /(modalita demo|torna demo|simulazione|demo mode)/ },
  { intent: 'revokeLive', cmd: 'revoca live', re: /(revoca live|disconnetti|rimuovi api)/ },
  { intent: 'configure', cmd: 'cambia strategia', re: /(strategia|parametri|come funziona il bot|spiegami come|come trad)/ },
  { intent: 'resetRisk', cmd: 'reset rischio', re: /(reset\s*rischio|resetta\s*risk\s*manager|sblocca|riabilita trading)/ },
  { intent: 'help', cmd: 'aiuto', re: /(aiuto|help|comandi|cosa puoi|cosa sai fare)/ },
];

function extractBuy(text) {
  if (/conviene|buon momento|dovrei|pensi|meglio|analiz/i.test(text) && !/compr|buy|acquist/i.test(text)) return null;
  const m = text.match(/(\d+[.,]?\d*)\s*(eth|btc|sol|usdc)?/i);
  const pairM = text.match(/\b(eth|btc|sol)\b/i);
  if (/compr|buy|acquist|long/i.test(text) || (/\bentra\b/i.test(text) && m)) {
    const amount = m ? parseFloat(m[1].replace(',', '.')) : null;
    const pair = (pairM?.[1] || m?.[2] || 'ETH').toUpperCase();
    if (amount) return { intent: 'buy', cmd: `compra ${amount} ${pair}`, params: { amount, pair } };
    return { intent: 'buy_clarify', clarify: 'Quanto vuoi comprare? Dimmi liberamente, es: *0.01 ETH* o *50 dollari di ETH*.' };
  }
  return null;
}

function extractSell(text) {
  if (/vend|sell|esci|chiudi pos|short/i.test(text)) {
    const pairM = text.match(/\b(eth|btc|sol)\b/i);
    return { intent: 'sell', cmd: `vendi ${pairM ? pairM[1].toUpperCase() : 'ETH'}`, params: {} };
  }
  return null;
}

function ruleBasedResolve(text) {
  const norm = normalize(text);
  for (const rule of INTENT_RULES) {
    if (rule.re.test(norm) || rule.re.test(text)) {
      if (rule.freeform) return { intent: rule.intent, freeform: true, text };
      return { intent: rule.intent, cmd: rule.cmd };
    }
  }
  const buy = extractBuy(text);
  if (buy) return buy;
  const sell = extractSell(text);
  if (sell) return sell;
  if (/\b(ciao|buongiorno|buonasera|hey|salve|hello|ehi)\b/i.test(text)) return { intent: 'greet', direct: true };
  if (/\b(grazie|perfetto|ok capito|ottimo)\b/i.test(text)) return { intent: 'thanks', direct: true };
  return { intent: 'chat', freeform: true, text };
}

function httpsJson(url, options, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
      timeout: llmProvider.LLM_TIMEOUT_MS,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('LLM parse error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('LLM timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}

async function llmChat(text, history, context) {
  const cfg = llmProvider.resolveConfig();
  if (!cfg.enabled) return null;

  const system = `${getPersona()}

Contesto live:
- Pair: ${context.pair} @ $${context.price ?? '?'}
- Modalita: ${context.mode} | Bot: ${context.active ? 'attivo' : 'pausa'}
- Score: ${context.score ?? 'n/d'}/${context.effectiveMin ?? 65} | Regime: ${context.regime ?? 'n/d'}
- RSI: ${context.rsi ?? 'n/d'} | Ultimo segnale: ${context.lastSignal || 'nessuno'}
- Posizione: ${context.hasPosition ? 'aperta' : 'flat'} | Live: ${context.live ? 'si' : 'no'}
- Risk: ${context.circuitBreaker ? `CIRCUIT BREAKER — ${context.circuitReason || 'attivo'}` : (context.riskBlocked ? 'cooldown attivo' : 'ok')}
- Operativo: ${context.operational ? 'si (posso tradare)' : (context.active ? 'no (bloccato risk)' : 'no (pausa)')}

Se l'utente chiede un'azione (compra, vendi, pausa, analisi), rispondi in JSON:
{"intent":"...","cmd":"comando engine se serve","reply":"risposta naturale"}
Altrimenti rispondi solo con testo naturale in italiano, max 4 frasi, proattivo.`;

  const messages = [
    { role: 'system', content: system },
    ...history.slice(-6).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
    { role: 'user', content: text },
  ];

  try {
    const res = await httpsJson(cfg.url, {
      headers: { Authorization: `Bearer ${cfg.key}`, ...cfg.extraHeaders },
    }, {
      model: cfg.model, messages, temperature: 0.6, max_tokens: 400,
    });
    const raw = res?.choices?.[0]?.message?.content || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.intent && parsed.intent !== 'chat') return parsed;
      if (parsed.reply) return { intent: 'chat', reply: parsed.reply };
    }
    return { intent: 'chat', reply: raw.trim() };
  } catch (e) {
    console.error(`[AGENT] LLM ${cfg.provider}:`, e.message);
    return null;
  }
}

function intelligentReply(text, context) {
  const t = normalize(text);
  const {
    pair, price, score, effectiveMin, regime, active, operational, riskBlocked,
    circuitBreaker, circuitReason, mode, lastSignal, rsi, hasPosition,
  } = context;

  if (circuitBreaker || riskBlocked) {
    const why = circuitReason || 'cooldown risk manager';
    return `Ho attivato la protezione capitale: *${why}*.\n\n` +
      (active
        ? 'La strategia è attiva ma non posso aprire nuovi trade finché non si sblocca. ' +
          'Dopo una chiusura posizione riparto da solo; altrimenti scrivi *riprendi* o *reset rischio*.'
        : 'Sono anche in pausa — scrivi *riprendi* per riattivarmi.') +
      `\n\n${pair} @ $${price?.toFixed(2) ?? '?'}, score ${score ?? 'n/d'}/${effectiveMin ?? 65}.`;
  }

  if (/sal|pump|rialz|moon|bull/.test(t)) {
    return `Sì, ${pair} sta muovendo — $${price?.toFixed(2) ?? '?'}. ` +
      `Score ${score ?? 'n/d'}/${effectiveMin ?? 65}, regime ${regime || 'n/d'}. ` +
      (hasPosition ? 'Ho posizione aperta — monitoro trailing e target.' : 'Sto valutando l\'ingresso — aspetto conferma piena.');
  }
  if (/scend|dump|crash|bear|ribass/.test(t)) {
    return `Vedo pressione su ${pair} — $${price?.toFixed(2) ?? '?'}. ` +
      (active ? 'Resto prudente, i filtri macro proteggono da ingressi rischiosi.' : 'Sono fermo, nessun rischio esposto.') +
      ` ${lastSignal ? `Ultimo ragionamento: ${lastSignal}` : ''}`;
  }
  if (/nervos|paura|sicur|rischi|perd/.test(t)) {
    return `Capisco. In ${mode?.toUpperCase() || 'DEMO'} ho limiti chiari: ` +
      `max -2%/giorno, -8% drawdown, ogni trade rischia solo 0.5%.\n\n` +
      (hasPosition ? 'La posizione è monitorata con stop ATR e trailing.' : 'Non sono esposto adesso.') +
      `\nVuoi che mi fermi? Scrivi *pausa* — o *rischio* per i dettagli.`;
  }
  if (/intelligen|autonom|pens|decid|solo comandi/.test(t)) {
    return `Osservo ${pair} ogni 45 secondi su 3 timeframe (4h/1h/15m) — non sono un menu di comandi.\n\n` +
      `Adesso: $${price?.toFixed(2) ?? '?'}, score *${score ?? 'n/d'}*, regime *${regime || 'n/d'}*. ` +
      (operational ? 'Sono operativo — ti scrivo quando cambia qualcosa.' : (active ? 'Attivo ma bloccato dal risk manager.' : 'In pausa.'));
  }
  if (/live|veri|soldi/.test(t)) {
    return mode === 'live'
      ? 'Siamo già in LIVE — ordini reali su Hyperliquid. Vuoi lo stato? Chiedimi *stato live*.'
      : 'Per passare a soldi veri: *attiva live*. Ti guido in 2 minuti con l\'API wallet.';
  }
  if (/\?/.test(text) || /perche|perché|come mai/.test(t)) {
    return `Buona domanda. Al momento ${pair} @ $${price?.toFixed(2) ?? '?'}, RSI ${rsi?.toFixed(0) ?? 'n/d'}, score ${score ?? 'n/d'}. ` +
      `${lastSignal || 'Sto valutando multi-timeframe (4h/1h/15m) prima di muovermi.'} ` +
      `Vuoi l'analisi completa? Chiedimi *analisi*.`;
  }

  return `In questo momento monitoro *${pair}* a $${price?.toFixed(2) ?? '?'} ` +
    `(score ${score ?? 'n/d'}/${effectiveMin ?? 65}, ${regime || 'mercato misto'}).\n\n` +
    `${operational ? 'Sono operativo — ti aggiorno proattivamente su segnali e trade.' : (active ? 'Strategia attiva ma il risk manager blocca nuovi ingressi.' : 'Sono in pausa al momento.')} ` +
    `Dimmi cosa ti preoccupa o chiedimi *analisi*.`;
}

function greetReply(context) {
  const mode = context.live ? 'LIVE' : 'DEMO';
  let status = context.operational ? 'Sto operando' : (context.active ? 'Attivo ma bloccato dal risk manager' : 'Sono in pausa');
  return `Ciao! Sono *Hermes*, il tuo agente di trading.\n\n` +
    `${status} in *${mode}* su ${context.pair || 'ETH'} a *$${context.price?.toFixed(2) ?? '?'}*.\n` +
    `Score: *${context.score ?? 'n/d'}/${context.effectiveMin ?? 65}* · ${context.regime || 'analisi in corso'}\n\n` +
    `Non devi ricordare comandi — *ti scrivo io* quando c'è qualcosa di importante. ` +
    `Ma puoi chiedermi qualsiasi cosa, in linguaggio naturale.`;
}

function enrichReply(reply, context, intent) {
  if (!reply || reply.startsWith('❌') || ['pause', 'resume', 'kill', 'help', 'resetRisk'].includes(intent)) return reply;
  const tail = context.operational && intent !== 'analysis'
    ? `\n\n_${context.lastSignal ? `Sto osservando: ${context.lastSignal}` : 'Monitoraggio attivo — ti aggiorno se cambia il setup.'}_`
    : (context.circuitBreaker
      ? `\n\n_🛑 Circuit breaker: ${context.circuitReason || 'attivo'}_`
      : '');
  return reply + tail;
}

async function processMessage({ text, chatId, context, executeEngine }) {
  const history = getHistory(chatId);
  appendHistory(chatId, 'user', text);

  // Fast path: regole prima — LLM solo per chat libera (evita latenza su comandi)
  let resolved = ruleBasedResolve(text);
  if (resolved.intent === 'chat' && resolved.freeform) {
    const llm = await llmChat(text, history, context);
    if (llm) resolved = llm;
  }

  if (resolved.intent === 'greet' || (resolved.direct && resolved.intent === 'greet')) {
    const reply = greetReply(context);
    appendHistory(chatId, 'assistant', reply);
    return { ok: true, reply, intent: 'greet' };
  }

  if (resolved.intent === 'thanks') {
    const reply = 'Prego. Resto qui — se il mercato si muove, ti scrivo.';
    appendHistory(chatId, 'assistant', reply);
    return { ok: true, reply, intent: 'thanks' };
  }

  if (resolved.intent === 'buy_clarify' || resolved.intent === 'clarify') {
    const reply = resolved.clarify || resolved.reply || intelligentReply(text, context);
    appendHistory(chatId, 'assistant', reply);
    return { ok: true, reply, intent: 'clarify' };
  }

  if (resolved.intent === 'chat' || resolved.freeform) {
    const reply = resolved.reply || intelligentReply(text, context);
    appendHistory(chatId, 'assistant', reply);
    return { ok: true, reply, intent: 'chat' };
  }

  const cmd = resolved.cmd || text;
  const engineReply = await executeEngine(cmd);
  let reply = engineReply;

  if (resolved.reply) reply = `${resolved.reply}\n\n${engineReply}`;
  reply = enrichReply(reply, context, resolved.intent);

  appendHistory(chatId, 'assistant', reply);
  return { ok: true, reply, intent: resolved.intent || 'action', cmd };
}

module.exports = {
  processMessage,
  getHistory,
  appendHistory,
  ruleBasedResolve,
  intelligentReply,
  greetReply,
  llmChat,
  getPersona,
};