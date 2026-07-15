// Notifiche Telegram su trade e circuit breaker
const https = require('https');

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

function notifyTrade(chatId, trade, signal) {
  if (!chatId || !trade) return;
  let msg;
  try {
    const { composeTradeCommentary } = require('./proactive-agent');
    msg = composeTradeCommentary(trade, signal);
  } catch {
    const emoji = trade.type === 'buy' ? '🟢' : '🔴';
    const mode = trade.mode === 'live' ? 'LIVE' : 'DEMO';
    msg = `${emoji} *${trade.type.toUpperCase()} ${mode}*\n` +
      `${trade.amount?.toFixed?.(6) ?? trade.amount} ${trade.pair} @ $${trade.price?.toFixed?.(2) ?? trade.price}`;
    if (trade.pnl != null) {
      msg += `\nP&L: ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)} (${trade.pnlPercent?.toFixed?.(2) ?? '?'}%)`;
    }
    if (signal?.reason) msg += `\n_${signal.reason}_`;
  }
  sendTelegram(chatId, msg).catch(() => {});
}

function notifyAlert(chatId, title, detail) {
  if (!chatId) return;
  sendTelegram(chatId, `⚠️ *${title}*\n${detail}`).catch(() => {});
}

module.exports = { notifyTrade, notifyAlert, sendTelegram };