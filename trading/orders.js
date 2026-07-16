// Esecuzione ordini market buy/sell + resume after close
// EXTRACTED FROM index.js:197-260 (executeMarketBuy), 270-350 (executeMarketSell),
//   260-268 (unblockRiskBaseline, resumeTradingAfterEngineClose)

const fs = require('fs');
const { TRADES_FILE, DATA_DIR } = require('../config/default');
const { isLiveMode, loadWallet, walletKey, liveSlippage } = require('../state/wallet');
const { saveBalance } = require('./balance');
const { getPrice } = require('./price');
const { getPositionSize, getEntryPrice } = require('./positions');
const { loadRecentTrades } = require('./pnl');
const { getEquity } = require('./balance');
const { saveRiskState, riskManager } = require('../state/risk');
const shared = require('../state/shared');

const hlLive = require('../hyperliquid-live');
const gbrainMemory = require('../gbrain-memory');
const alerts = require('../alerts');
const executionFill = require('../execution-fill');
const eventLog = require('../event-log');

function appendTrade(trade) {
  const logged = { ...trade, loggedAt: new Date().toISOString() };
  fs.appendFileSync(TRADES_FILE, JSON.stringify(logged) + '\n', 'utf-8');
  gbrainMemory.rememberTrade(logged, {
    mode: isLiveMode() ? 'live' : 'demo',
    pair: shared.strategy.pair,
  });
  // FAILURE MEMORY: solo trade LIVE in perdita — mai demo/simulati (altrimenti drift)
  if (isLiveMode() && trade && typeof trade.pnl === 'number' && trade.pnl < 0) {
    try {
      const path = require('path');
      const memDir = path.join(DATA_DIR, 'memory');
      if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
      const fFile = path.join(memDir, 'failures.md');
      const strat = shared.strategy || {};
      const pnlPct = typeof trade.pnlPercent === 'number' ? trade.pnlPercent.toFixed(2) : 'n/d';
      const entry = [
        '',
        '## ' + new Date().toISOString().slice(0, 10) + ' ' + (trade.timestamp ? trade.timestamp.slice(11, 19) : '') + ' - LOSS ' + (trade.pair || strat.pair || 'ETH'),
        '- **Trade:** ' + (trade.type || 'n/d') + ' ' + (trade.pair || strat.pair || 'ETH') + ' @ $' + (trade.price != null ? trade.price : 'n/d'),
        '- **PnL:** $' + trade.pnl.toFixed(2) + ' (' + pnlPct + '%)',
        '- **Size:** ' + (trade.amount != null ? trade.amount : 'n/d') + ' | Value: $' + (trade.value != null ? trade.value.toFixed(2) : 'n/d'),
        '- **Regime/RSI contesto:** minConfidence=' + (strat.minConfidenceScore || 'n/d') + ' atrStop=' + (strat.atrStopMultiplier || 'n/d') + ' atrTp1=' + (strat.atrTp1Multiplier || 'n/d'),
        '- **Motivo (se noto):** ' + (trade.note || trade.reason || trade.signal || 'non specificato'),
        '- **Mode:** ' + (isLiveMode() ? 'live' : 'demo'),
        '',
      ].join(String.fromCharCode(10));
      fs.appendFileSync(fFile, entry, 'utf-8');
    } catch (e) {
      console.error('[FAIL-MEM] scrittura failures.md:', e.message);
    }
  }
}

function notifyOwner(title, detail, trade, signal) {
  const w = loadWallet();
  const chatId = w?.ownerChatId;
  if (!chatId) return;
  if (trade) alerts.notifyTrade(chatId, trade, signal);
  else if (title) alerts.notifyAlert(chatId, title, detail);
}

async function unblockRiskBaseline({ forceClearSticky = false } = {}) {
  const equity = await getEquity();
  shared.riskState = riskManager.resetRiskForResume(shared.riskState, equity, {
    forceClearSticky,
  });
  return shared.riskState;
}

// forward declaration — risolta in tick-runner.js via setter
let _resumeTradingAfterEngineClose = null;
function setResumeFn(fn) { _resumeTradingAfterEngineClose = fn; }
function getResumeFn() { return _resumeTradingAfterEngineClose; }

// forward declaration — restartAutonomousLoop risolta in engine/loops.js
let _restartLoop = null;
function setRestartLoopFn(fn) { _restartLoop = fn; }

// forward declaration — runAutonomousTick risolta in engine/tick-runner.js
let _runTick = null;
function setRunTickFn(fn) { _runTick = fn; }

async function resumeTradingAfterEngineClose() {
  const { canAutoResumeTrading } = require('../risk-manager');
  if (!canAutoResumeTrading(shared.riskState)) {
    console.warn('[AUTO-RESUME] Bloccato: circuit breaker sticky/attivo — serve resume operatore');
    notifyOwner(
      'Auto-resume bloccato',
      `Posizione chiusa ma CB attivo (${shared.riskState?.circuitReason || 'n/d'}). Nessuna riapertura automatica.`
    );
    return { ok: false, blocked: true, reason: shared.riskState?.circuitReason };
  }
  // Soft baseline only if no sticky CB (canAutoResume already false when CB on)
  await unblockRiskBaseline();
  if (!canAutoResumeTrading(shared.riskState)) {
    return { ok: false, blocked: true };
  }
  shared.strategy.active = true;
  if (_restartLoop) _restartLoop();
  if (_runTick) setTimeout(_runTick, 1000);
  console.log('[AUTO-RESUME] Trading ripreso dopo chiusura posizione (no sticky CB)');
  notifyOwner('Auto-resume', `Trading ripreso dopo chiusura. ${shared.strategy.pair} monitorato.`);
  return { ok: true };
}

async function executeMarketBuy(pairOverride, amountOverride) {
  const orderJournal = require('../lib/order-journal');
  try {
    const p = pairOverride || shared.strategy.pair;
    const a = amountOverride || shared.strategy.amountPerTrade;

    if (!shared.strategy.active && !amountOverride) {
      return { ok: false, error: 'Strategia in pausa. Usa /resume o chiama POST /resume' };
    }

    // Sticky CB: block new risk-taking (manual override amount still blocked if CB sticky)
    if (!riskManager.canAutoResumeTrading(shared.riskState) && !amountOverride) {
      return {
        ok: false,
        error: `Circuit breaker attivo: ${shared.riskState?.circuitReason || 'risk blocked'}`,
      };
    }

    if (isLiveMode()) {
      const w = loadWallet();
      const mid = await getPrice(p);
      const maxSlipBps = Math.round((shared.strategy.maxSlippageBps
        ?? (shared.strategy.maxSlippage != null ? shared.strategy.maxSlippage * 100 : 15)));
      const clientOid = `buy-${p}-${Date.now().toString(36)}`;
      orderJournal.intent({
        side: 'buy', pair: p, size: a, mid, maxSlippageBps: maxSlipBps,
        source: amountOverride ? 'manual' : 'engine', clientOid,
      });

      // Soft pre-trade: if recent avg slip exceeds cap, reject new entries
      try {
        const execSummary = executionFill.getExecutionSummary?.() || {};
        if (
          execSummary.avgSlippageBps != null
          && execSummary.sampleSize >= 3
          && execSummary.avgSlippageBps > maxSlipBps
        ) {
          orderJournal.rejected(clientOid, `avg slip ${execSummary.avgSlippageBps}bps > max ${maxSlipBps}`);
          return {
            ok: false,
            error: `Slippage medio ${execSummary.avgSlippageBps} bps > max ${maxSlipBps} — entry bloccata`,
          };
        }
      } catch { /* optional guard */ }

      orderJournal.sent(clientOid, { mid });
      const live = await hlLive.placeMarketOrder({
        walletAddress: w.address, privateKey: walletKey(w), pair: p,
        isBuy: true, size: a, slippage: liveSlippage(), reduceOnly: false,
      });
      if (!live.ok) {
        orderJournal.rejected(clientOid, live.error || 'hl reject');
        return live;
      }
      // Post-fill slip check (alert, trade already happened)
      const fillPx = parseFloat(live.trade?.price || 0);
      if (mid > 0 && fillPx > 0) {
        const slipBps = Math.round(Math.abs(fillPx - mid) / mid * 10000);
        if (slipBps > maxSlipBps * 2) {
          console.warn(`[EXEC] Extreme fill slip ${slipBps} bps (max ${maxSlipBps})`);
        }
      }
      const trade = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        timestamp: new Date().toISOString(),
        ...live.trade,
        clientOid,
        note: amountOverride ? 'ordine manuale cliente (LIVE)' : 'DCA automatico (LIVE)',
      };
      appendTrade(trade);
      shared.lastTrade = trade;
      if (trade.mode === 'live') executionFill.logExecution(trade);
      orderJournal.filled(clientOid, {
        price: trade.price, amount: trade.amount, hlOid: trade.hlOid, slipBps: trade.slippageBps,
      });
      eventLog.orderFill({ id: trade.id, type: 'buy', pair: p, amount: trade.amount, price: trade.price, value: trade.value, mode: trade.mode, hlOid: trade.hlOid });
      const { syncLiveBalance } = require('./balance');
      await syncLiveBalance();
      console.log(`[TRADE LIVE] BUY ${trade.amount} ${p} @ ${trade.price}`);
      return { ok: true, trade };
    }

    const price = await getPrice(p);
    const value = a * price;
    if (shared.balance.amount < value) {
      return { ok: false, error: `Saldo insufficiente: hai ${shared.balance.amount.toFixed(2)}, servono ${value.toFixed(2)}` };
    }

    const trade = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      type: 'buy', pair: p, amount: a, price, value,
      status: 'executed', mode: 'demo',
      note: amountOverride ? 'ordine manuale cliente' : 'DCA automatico',
    };

    shared.balance.amount -= value;
    saveBalance();
    appendTrade(trade);
    shared.lastTrade = trade;
    console.log(`[TRADE DEMO] BUY ${a} ${p} @ ${price.toFixed(2)} = ${value.toFixed(2)} | Saldo: ${shared.balance.amount.toFixed(2)}`);
    return { ok: true, trade };
  } catch (e) {
    console.error('[BUY] Errore:', e.message);
    return { ok: false, error: e.message };
  }
}

async function executeMarketSell(pair, percent = 1) {
  try {
    const p = pair || shared.strategy.pair;
    const fraction = Math.min(1, Math.max(0.01, percent));

    if (isLiveMode()) {
      const w = loadWallet();
      const pk = walletKey(w);
      const pos = await hlLive.getSignedPosition(w.address, pk, p);
      if (!pos || Math.abs(pos) < 1e-9) {
        return { ok: false, error: `Nessuna posizione aperta su ${p} su Hyperliquid.` };
      }
      const isShort = pos < 0;
      const sellSize = Math.abs(pos) * fraction;
      const entryPrice = await hlLive.getEntryPrice(w.address, pk, p);
      const live = await hlLive.placeMarketOrder({
        walletAddress: w.address, privateKey: pk, pair: p,
        isBuy: isShort, size: sellSize, slippage: liveSlippage(), reduceOnly: true,
      });
      if (!live.ok) return live;
      const fillPrice = parseFloat(live.trade?.price || 0);
      const fillAmount = parseFloat(live.trade?.amount || sellSize);
      const pnl = entryPrice > 0 ? (fillPrice - entryPrice) * fillAmount * (isShort ? -1 : 1) : null;
      const pnlPercent = entryPrice > 0 ? ((fillPrice - entryPrice) / entryPrice * 100) * (isShort ? -1 : 1) : null;
      const trade = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        timestamp: new Date().toISOString(),
        ...live.trade, pnl, pnlPercent, avgBuyPrice: entryPrice,
        note: fraction < 1 ? `vendita parziale ${(fraction * 100).toFixed(0)}% (LIVE)` : 'vendita totale (LIVE)',
      };
      appendTrade(trade);
      shared.lastTrade = trade;
      if (trade.mode === 'live') executionFill.logExecution(trade);
      eventLog.orderFill({ id: trade.id, type: 'sell', pair: p, amount: trade.amount, price: trade.price, value: trade.value, mode: trade.mode, hlOid: trade.hlOid, pnl: trade.pnl });
      const { syncLiveBalance } = require('./balance');
      await syncLiveBalance();
      console.log(`[TRADE LIVE] SELL ${trade.amount} ${p} @ ${trade.price}`);
      return { ok: true, trade, closedFraction: fraction };
    }

    const trades = loadRecentTrades(500);
    const buys = trades.filter((t) => t.type === 'buy' && t.pair === p);
    const sells = trades.filter((t) => t.type === 'sell' && t.pair === p);
    if (buys.length === 0) return { ok: false, error: `Nessun acquisto trovato per ${p} da vendere.` };

    const totalBought = buys.reduce((s, t) => s + t.amount, 0);
    const totalSold = sells.reduce((s, t) => s + t.amount, 0);
    const totalAmount = Math.max(0, totalBought - totalSold);
    if (totalAmount < 1e-9) return { ok: false, error: `Nessuna posizione aperta su ${p}.` };

    const totalCost = buys.reduce((s, t) => s + t.value, 0);
    const avgPrice = totalCost / totalBought;
    const currentPrice = await getPrice(p);
    const sellAmount = totalAmount * fraction;
    const value = sellAmount * currentPrice;
    const costBasis = sellAmount * avgPrice;

    const trade = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      timestamp: new Date().toISOString(),
      type: 'sell', pair: p, amount: sellAmount, price: currentPrice, value,
      avgBuyPrice: avgPrice, pnl: value - costBasis,
      pnlPercent: ((currentPrice - avgPrice) / avgPrice * 100),
      status: 'executed', mode: 'demo',
      note: fraction < 1 ? `vendita parziale ${(fraction * 100).toFixed(0)}%` : 'vendita totale',
    };

    shared.balance.amount += value;
    saveBalance();
    appendTrade(trade);
    shared.lastTrade = trade;
    console.log(`[TRADE DEMO] SELL ${sellAmount} ${p} @ ${currentPrice.toFixed(2)} = ${value.toFixed(2)} | P&L: ${(value - costBasis).toFixed(2)}`);
    return { ok: true, trade, closedFraction: fraction };
  } catch (e) {
    console.error('[SELL] Errore:', e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  executeMarketBuy, executeMarketSell, resumeTradingAfterEngineClose,
  unblockRiskBaseline, notifyOwner,
  setResumeFn, getResumeFn, setRestartLoopFn, setRunTickFn,
};
