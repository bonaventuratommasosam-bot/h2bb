// Handler: analysis, scanner, performance, risk, status, balance
// EXTRACTED FROM index.js:445-480, 500-540

const proEngine = require('../../pro-engine');
const scanner = require('../../scanner');
const performance = require('../../performance');
const { riskManager, getRiskBlocked } = require('../../state/risk');
const { getEquity } = require('../../trading/balance');
const { getPrice } = require('../../trading/price');
const { calcPnL } = require('../../trading/pnl');
const { getPositionSize } = require('../../trading/positions');
const { isLiveMode, loadWallet, walletKey } = require('../../state/wallet');
const { syncLiveBalance } = require('../../trading/balance');
const { formatPosition } = require('../../lib/format');
const shared = require('../../state/shared');

const hlLive = require('../../hyperliquid-live');

async function handleAnalysis() {
  const analysis = await proEngine.analyzeMarket(shared.strategy.pair, shared.strategy);
  const entryScore = proEngine.scoreEntry(analysis, shared.strategy);
  const signal = {
    action: entryScore.bias === 'long' ? 'buy' : entryScore.bias === 'watch' ? 'watch' : 'hold',
    score: entryScore.score, effectiveMin: entryScore.effectiveMin,
    reason: entryScore.signals.join(', '),
  };
  return proEngine.formatAnalysisReport(analysis, signal, shared.strategy);
}

async function handleScanner() {
  const pairs = shared.strategy.watchlist || ['ETH', 'BTC', 'SOL'];
  const results = await scanner.scanWatchlist(pairs, shared.strategy);
  return scanner.formatScanReport(results, shared.strategy.minConfidenceScore ?? 65);
}

function handlePerformance() {
  const stats = performance.computeStats(shared.strategy.pair);
  return performance.formatReport(stats, shared.strategy.pair);
}

async function handleRisk() {
  const equity = await getEquity();
  return `🛡️ *Gestione rischio*\n\n${riskManager.formatRiskStatus(shared.riskState, shared.strategy, equity)}`;
}

async function handleStatus() {
  const price = await getPrice(shared.strategy.pair);
  const mode = isLiveMode() ? 'LIVE' : 'DEMO';
  if (isLiveMode()) await syncLiveBalance();
  const p = calcPnL();
  const pnlDollari = p.heldAmount > 0 ? (p.heldAmount * price) - (p.heldAmount * p.avgBuyPrice) : 0;
  const pnlPerc = p.avgBuyPrice > 0 ? ((price - p.avgBuyPrice) / p.avgBuyPrice * 100) : 0;
  let msg = `📊 *Performance ${shared.strategy.pair}* (${mode})\n`;
  msg += `Prezzo attuale: ${price.toFixed(2)}\n`;
  if (!isLiveMode()) {
    msg += `Prezzo medio acquisto: ${p.avgBuyPrice.toFixed(2)}\n`;
    msg += `In portafoglio: ${p.heldAmount.toFixed(6)} ${shared.strategy.pair}\n`;
    msg += `Totale investito: ${p.totalInvested.toFixed(2)}\n`;
    if (p.heldAmount > 0) msg += `P&L non realizzato: ${pnlDollari >= 0 ? '📈' : '📉'} ${pnlDollari.toFixed(2)} (${pnlPerc.toFixed(2)}%)\n`;
  } else {
    const w = loadWallet();
    const pos = await hlLive.getSignedPosition(w.address, walletKey(w), shared.strategy.pair);
    msg += `Posizione HL: ${formatPosition(pos, shared.strategy.pair)}\n`;
  }
  msg += `Saldo USDC: ${shared.balance.amount.toFixed(2)}\n`;
  const modeLabel = shared.strategy.mode === 'pro' ? 'PRO' : 'autonomo';
  msg += `${modeLabel}: ${shared.strategy.active ? '✅ attivo' : '⏸ in pausa'} | check ${shared.strategy.checkIntervalSeconds}s\n`;
  if (shared.strategy.mode === 'pro') {
    msg += `Score: ${shared.strategy.lastSignal?.score ?? 'n/d'}/${shared.strategy.minConfidenceScore ?? 65} · Rischio ${shared.strategy.riskPerTradePercent ?? 0.5}%/trade\n`;
    if (shared.riskState.circuitBreaker) msg += `🛑 Circuit breaker: ${shared.riskState.circuitReason}\n`;
  } else {
    msg += `SL: -${shared.strategy.stopLossPercent}% · TP: +${shared.strategy.takeProfitPercent}%\n`;
  }
  if (shared.strategy.lastSignal?.reason) msg += `Ultimo segnale: ${shared.strategy.lastSignal.reason}\n`;
  if (shared.strategy.stopLoss) msg += `Stop loss fisso: ${shared.strategy.stopLoss}\n`;
  if (shared.strategy.takeProfit) msg += `Take profit fisso: ${shared.strategy.takeProfit}\n`;
  if (shared.lastTrade) msg += `Ultimo trade: ${shared.lastTrade.type.toUpperCase()} ${shared.lastTrade.amount} ${shared.lastTrade.pair} @ ${shared.lastTrade.price.toFixed(2)}`;
  return msg;
}

function handleBalance() {
  return `💰 *Saldo*\nUSDC: ${shared.balance.amount.toFixed(2)}\n${shared.strategy.pair} in portafoglio: ~${calcPnL().heldAmount.toFixed(6)}`;
}

module.exports = { handleAnalysis, handleScanner, handlePerformance, handleRisk, handleStatus, handleBalance };
