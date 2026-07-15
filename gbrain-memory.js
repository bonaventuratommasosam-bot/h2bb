// Memoria trade via gbrain (Garry Tan) — ogni trade → pagina searchable
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ENABLED = process.env.GBRAIN_ENABLED !== 'false';
const GBRAIN_BIN = process.env.GBRAIN_BIN || 'gbrain';
const MEMORY_DIR = process.env.GBRAIN_TRADES_DIR
  || path.join(process.env.HERMES_PROFILE_DIR || '', 'memory', 'trades');
const PROFILE = process.env.GBRAIN_PROFILE || process.env.HERMES_PROFILE_NAME || 'trade';

function slugFor(trade) {
  const id = (trade.id || Date.now().toString(36)).replace(/[^a-zA-Z0-9_-]/g, '-');
  const day = (trade.timestamp || trade.loggedAt || new Date().toISOString()).slice(0, 10);
  return `${PROFILE}-trade-${day}-${id}`.toLowerCase();
}

function tradeToMarkdown(trade, ctx = {}) {
  const t = trade.timestamp || trade.loggedAt || new Date().toISOString();
  const mode = ctx.mode || trade.mode || 'demo';
  const pair = trade.pair || ctx.pair || 'ETH';
  const pnl = trade.pnl != null ? `\n- PnL: $${Number(trade.pnl).toFixed(2)}` : '';
  const reason = trade.reason || trade.signal || trade.note || '';
  return [
    `# Trade ${trade.type?.toUpperCase() || 'EVENT'} ${pair}`,
    '',
    `**Data:** ${t}`,
    `**Modalità:** ${mode}`,
    `**Pair:** ${pair}`,
    `**Tipo:** ${trade.type || 'n/d'}`,
    `**Quantità:** ${trade.amount ?? 'n/d'}`,
    `**Prezzo:** $${trade.price ?? 'n/d'}`,
    `**Valore:** $${trade.value ?? (trade.amount && trade.price ? (trade.amount * trade.price).toFixed(2) : 'n/d')}`,
    pnl,
    reason ? `**Motivo:** ${reason}` : '',
    '',
    `tags: #trade #hermesbro #${PROFILE} #trading-memory`,
    `source: hermesbro-trading-engine`,
  ].filter(Boolean).join('\n');
}

function writeLocalCopy(slug, content) {
  if (!MEMORY_DIR) return;
  try {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
    const file = path.join(MEMORY_DIR, `${slug}.md`);
    fs.writeFileSync(file, content, 'utf-8');
    fs.chmodSync(file, 0o600);
  } catch (e) {
    console.error('[GBRAIN] local copy:', e.message);
  }
}

function gbrainPut(slug, content) {
  if (!ENABLED) return;
  writeLocalCopy(slug, content);
  const env = {
    ...process.env,
    HOME: process.env.HOME,
    HERMES_HOME: process.env.HERMES_HOME,
  };
  const child = spawn(GBRAIN_BIN, ['put', slug], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let errOut = '';
  child.stderr.on('data', (d) => { errOut += d; });
  child.on('error', (err) => console.error('[GBRAIN] spawn:', err.message));
  child.on('close', (code) => {
    if (code !== 0) console.error('[GBRAIN] put failed:', errOut.slice(0, 200) || `exit ${code}`);
  });
  child.stdin.write(content);
  child.stdin.end();
}

function rememberTrade(trade, ctx = {}) {
  if (!trade || !ENABLED) return null;
  const slug = slugFor(trade);
  const md = tradeToMarkdown(trade, ctx);
  gbrainPut(slug, md);
  return slug;
}

function searchTrades(query, limit = 8) {
  return new Promise((resolve) => {
    if (!ENABLED) return resolve({ ok: false, error: 'gbrain disabled' });
    const env = {
      ...process.env,
      HOME: process.env.HOME,
      HERMES_HOME: process.env.HERMES_HOME,
    };
    execFile(GBRAIN_BIN, ['search', query, '--limit', String(limit)], { env, timeout: 20000, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return resolve({ ok: false, error: err.message, stderr: stderr?.slice(0, 300) });
        resolve({ ok: true, results: stdout });
      });
  });
}

module.exports = { rememberTrade, searchTrades, tradeToMarkdown, slugFor };