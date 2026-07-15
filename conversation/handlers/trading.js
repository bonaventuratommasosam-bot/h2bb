// Handler: buy, sell, stopLoss, takeProfit
// EXTRACTED FROM index.js:415-440

const { executeMarketBuy, executeMarketSell } = require('../../trading/orders');
const { saveStrategy } = require('../../state/strategy');
const shared = require('../../state/shared');

async function handleBuy(cmd) {
  const res = await executeMarketBuy(cmd.pair, cmd.amount);
  if (!res.ok) return `❌ ${res.error}`;
  const t = res.trade;
  return `✅ *Ordine eseguito!*\nAcquistati ${t.amount} ${t.pair} @ ${t.price.toFixed(2)}\nTotale: ${t.value.toFixed(2)}\nSaldo residuo: ${shared.balance.amount.toFixed(2)} USDC`;
}

async function handleSell(cmd) {
  const res = await executeMarketSell(cmd.pair);
  if (!res.ok) return `❌ ${res.error}`;
  const t = res.trade;
  let msg = `✅ *Vendita completata!*${t.mode === 'live' ? ' (LIVE)' : ''}\nVenduti ${t.amount.toFixed(6)} ${t.pair} @ ${t.price.toFixed(2)}\nIncassato: ${t.value.toFixed(2)}`;
  if (t.pnl != null && t.pnlPercent != null) {
    msg += `\nP&L: ${t.pnl >= 0 ? '📈' : '📉'} ${t.pnl.toFixed(2)} (${t.pnlPercent.toFixed(2)}%)`;
  }
  msg += `\nSaldo: ${shared.balance.amount.toFixed(2)} USDC`;
  return msg;
}

function handleStopLoss(cmd) {
  shared.strategy.stopLoss = cmd.value;
  saveStrategy();
  return `🔒 Stop loss impostato a ${cmd.value} per ${shared.strategy.pair}. Se il prezzo scende sotto, vendo tutto.`;
}

function handleTakeProfit(cmd) {
  shared.strategy.takeProfit = cmd.value;
  saveStrategy();
  return `🎯 Take profit impostato a ${cmd.value} per ${shared.strategy.pair}. Se il prezzo sale sopra, incasso.`;
}

module.exports = { handleBuy, handleSell, handleStopLoss, handleTakeProfit };
