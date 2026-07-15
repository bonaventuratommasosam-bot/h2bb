// Analytics trade — win rate, P&L, expectancy
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const TRADES_FILE = path.join(DATA_DIR, 'trades.jsonl');

function loadTrades(limit = 500) {
  if (!fs.existsSync(TRADES_FILE)) return [];
  const raw = fs.readFileSync(TRADES_FILE, 'utf-8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).slice(-limit).map((l) => JSON.parse(l));
}

function computeStats(pair) {
  const trades = loadTrades(1000).filter((t) => !pair || t.pair === pair);
  const sells = trades.filter((t) => t.type === 'sell' && t.pnl != null);
  const buys = trades.filter((t) => t.type === 'buy');

  if (sells.length === 0) {
    return {
      totalTrades: buys.length,
      closedTrades: 0,
      winRate: 0,
      totalPnl: 0,
      avgPnl: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      bestTrade: 0,
      worstTrade: 0,
      expectancy: 0,
    };
  }

  const wins = sells.filter((t) => t.pnl > 0);
  const losses = sells.filter((t) => t.pnl <= 0);
  const totalPnl = sells.reduce((s, t) => s + t.pnl, 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const winRate = (wins.length / sells.length) * 100;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
  const expectancy = (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLoss;

  return {
    totalTrades: buys.length,
    closedTrades: sells.length,
    winRate: Math.round(winRate * 10) / 10,
    totalPnl: Math.round(totalPnl * 100) / 100,
    avgPnl: Math.round((totalPnl / sells.length) * 100) / 100,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    bestTrade: Math.round(Math.max(...sells.map((t) => t.pnl)) * 100) / 100,
    worstTrade: Math.round(Math.min(...sells.map((t) => t.pnl)) * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
  };
}

function formatReport(stats, pair) {
  const label = pair || 'tutti';
  if (stats.closedTrades === 0) {
    return `📉 *Performance ${label}*\nNessun trade chiuso ancora.`;
  }
  return `📊 *Performance ${label}* (${stats.closedTrades} chiusi)\n` +
    `Win rate: *${stats.winRate}%*\n` +
    `P&L totale: ${stats.totalPnl >= 0 ? '+' : ''}$${stats.totalPnl}\n` +
    `Expectancy: $${stats.expectancy}/trade\n` +
    `Profit factor: ${stats.profitFactor}\n` +
    `Media win: +$${stats.avgWin} · Media loss: -$${stats.avgLoss}\n` +
    `Best: +$${stats.bestTrade} · Worst: $${stats.worstTrade}`;
}

module.exports = { loadTrades, computeStats, formatReport };