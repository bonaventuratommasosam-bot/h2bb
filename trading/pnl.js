// P&L calculation + trade history
// EXTRACTED FROM index.js:140-153 (loadRecentTrades), 310-340 (calcPnL)
// QW4: lettura solo della coda del file (no readFileSync totale) + rotazione >5MB

const fs = require('fs');
const path = require('path');
const { TRADES_FILE } = require('../config/default');

// QW4: leggiamo al massimo gli ultimi TAIL_BYTES del file invece di tutto.
const TAIL_BYTES = 256 * 1024;
const ROTATE_THRESHOLD = 5 * 1024 * 1024; // 5MB

function rotateIfNeeded() {
  try {
    if (!fs.existsSync(TRADES_FILE)) return;
    const { size } = fs.statSync(TRADES_FILE);
    if (size < ROTATE_THRESHOLD) return;
    const d = new Date();
    const ym = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0');
    const archive = path.join(path.dirname(TRADES_FILE), 'trades-' + ym + '.jsonl');
    let target = archive;
    let i = 1;
    while (fs.existsSync(target)) {
      target = path.join(path.dirname(TRADES_FILE), 'trades-' + ym + '-' + i + '.jsonl');
      i += 1;
    }
    fs.renameSync(TRADES_FILE, target);
    console.log('[TRADES] Rotazione: ' + size + ' byte archiviati in ' + path.basename(target));
  } catch (e) {
    console.error('[TRADES] Rotazione fallita:', e.message);
  }
}

function readTailLines() {
  if (!fs.existsSync(TRADES_FILE)) return [];
  let fd;
  try {
    const { size } = fs.statSync(TRADES_FILE);
    if (size === 0) return [];
    const readSize = Math.min(size, TAIL_BYTES);
    const startPos = size - readSize;
    const buf = Buffer.alloc(readSize);
    fd = fs.openSync(TRADES_FILE, 'r');
    fs.readSync(fd, buf, 0, readSize, startPos);
    let text = buf.toString('utf-8');
    if (startPos > 0) {
      const nl = text.indexOf('\n');
      text = nl >= 0 ? text.slice(nl + 1) : '';
    }
    return text.split('\n').filter(Boolean);
  } catch (e) {
    console.error('[TRADES] Lettura coda fallita:', e.message);
    return [];
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

function loadRecentTrades(n = 50) {
  rotateIfNeeded();
  const lines = readTailLines();
  const slice = lines.slice(-n);
  const out = [];
  for (const l of slice) {
    try { out.push(JSON.parse(l)); }
    catch (_) { /* riga corrotta/parziale: scartata */ }
  }
  return out;
}

function calcPnL() {
  const trades = loadRecentTrades(500);
  const buys = trades.filter((t) => t.type === 'buy');
  const sells = trades.filter((t) => t.type === 'sell');
  if (buys.length === 0) {
    return {
      totalInvested: 0, currentValue: 0, pnl: 0, pnlPercent: 0,
      avgBuyPrice: 0, currentPrice: 0, totalBought: 0, totalSold: 0,
      heldAmount: 0, totalSoldAmt: 0, totalSoldVal: 0,
    };
  }
  const totalBought = buys.reduce((s, t) => s + t.amount, 0);
  const totalInvested = buys.reduce((s, t) => s + t.value, 0);
  const totalSoldAmt = sells.reduce((s, t) => s + t.amount, 0);
  const totalSoldVal = sells.reduce((s, t) => s + t.value, 0);
  const heldAmount = totalBought - totalSoldAmt;
  const avgBuyPrice = totalBought > 0 ? totalInvested / totalBought : 0;
  return { totalInvested, totalBought, totalSoldAmt, totalSoldVal, heldAmount, avgBuyPrice };
}

module.exports = { loadRecentTrades, calcPnL };
