// Notifiche Telegram: di default solo entry/exit trade.
// Alert (meta/perf/risk chat) solo se NOTIFY_TRADES_ONLY=0.
const https = require('https');

function tradesOnlyMode() {
  const v = process.env.NOTIFY_TRADES_ONLY;
  if (v === '0' || v === 'false') return false;
  // default ON for live degen quiet mode; explicit 1/true also ON
  if (v === '1' || v === 'true' || v == null || v === '') return true;
  return true;
}

function sendTelegram(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return Promise.resolve(false);
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', disable_web_page_preview: true });
  return new Promise((resolve) => {
    const req = https.request(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 8000,
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.write(body);
    req.end();
  });
}

/** Solo segnale entrata (buy) o uscita (sell) — testo corto, niente meta. */
function notifyTrade(chatId, trade, signal) {
  if (!chatId || !trade) return;
  const t = String(trade.type || '').toLowerCase();
  if (t !== 'buy' && t !== 'sell') return;

  const isEntry = t === 'buy';
  const emoji = isEntry ? '🟢' : '🔴';
  const label = isEntry ? 'ENTRATA' : 'USCITA';
  const mode = trade.mode === 'live' ? 'LIVE' : 'DEMO';
  const amt = trade.amount?.toFixed?.(6) ?? trade.amount ?? '?';
  const px = trade.price?.toFixed?.(2) ?? trade.price ?? '?';
  const pair = trade.pair || '?';

  let msg = `${emoji} *${label} ${pair}* (${mode})\n${amt} @ $${px}`;
  if (trade.value != null && Number.isFinite(Number(trade.value))) {
    msg += `\nNotional: $${Number(trade.value).toFixed(2)}`;
  }
  if (!isEntry && trade.pnl != null && Number.isFinite(Number(trade.pnl))) {
    const pct = trade.pnlPercent != null ? ` (${Number(trade.pnlPercent).toFixed(2)}%)` : '';
    msg += `\nP&L: ${trade.pnl >= 0 ? '+' : ''}$${Number(trade.pnl).toFixed(2)}${pct}`;
  }
  // short reason only if present and short
  const reason = signal?.reason || trade.note;
  if (reason && String(reason).length <= 160) {
    msg += `\n_${String(reason).slice(0, 160)}_`;
  }

  sendTelegram(chatId, msg).catch(() => {});
}

/** Mai usato in trades-only: meta-controller, perf, auto-resume, ecc. */
function notifyAlert(chatId, title, detail) {
  if (!chatId) return;
  if (tradesOnlyMode()) {
    console.log(`[TG-MUTE] alert skipped (trades-only): ${title}`);
    return;
  }
  // Always mute Meta-Controller title even if trades-only off (user preference)
  if (/meta[- ]?controller/i.test(String(title || ''))) {
    console.log(`[TG-MUTE] meta-controller skipped: ${detail || ''}`);
    return;
  }
  sendTelegram(chatId, `⚠️ *${title}*\n${detail}`).catch(() => {});
}

module.exports = { notifyTrade, notifyAlert, sendTelegram, tradesOnlyMode };