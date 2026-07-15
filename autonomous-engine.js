// Motore trading autonomo — segnali RSI + SL/TP percentuale
const https = require('https');
const risk = require('./risk-manager');

// IMPROVEMENT: costanti estratte da magic numbers
const HL_API_HOST = 'api.hyperliquid.xyz';
const HL_TIMEOUT_MS = parseInt(process.env.HL_TIMEOUT_MS, 10) || 12000;
const MIN_CANDLES = 5;
const MIN_NOTIONAL_USD = parseFloat(process.env.MIN_NOTIONAL_USD) || 10;

// FIX: client HTTP allineato con index.js — controlla HTTP status code
// prima di tentare il parse JSON. Prima accettava qualsiasi risposta.
function hlInfo(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: HL_API_HOST,
      path: '/info',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: HL_TIMEOUT_MS,
    }, (res) => {
      let data = '';
      // FIX: controlla HTTP status code prima di parsare
      if (res.statusCode >= 400) {
        res.on('data', () => {});
        res.on('end', () => reject(new Error(`Hyperliquid HTTP ${res.statusCode}`)));
        return;
      }
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Hyperliquid parse error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Hyperliquid timeout')); });
    req.write(payload);
    req.end();
  });
}

async function fetchCloses(pair, interval = '15m', limit = 40) {
  const coin = (pair || 'ETH').replace(/-PERP|USDC|USD|\//g, '').toUpperCase();
  const endTime = Date.now();
  const startTime = endTime - limit * 15 * 60 * 1000;
  const data = await hlInfo({
    type: 'candleSnapshot',
    req: { coin, interval, startTime, endTime },
  });
  if (!Array.isArray(data) || data.length < MIN_CANDLES) return null;
  return data.map((c) => parseFloat(c.c)).filter((n) => Number.isFinite(n));
}

function computeRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// NOTE: pctMove e toTimestamp sono duplicati con pro-engine.js (pctMove, toTs).
// Nel refactor completo, estrarre in lib/math.js.
function pctMove(current, entry, isLong = true) {
  if (!entry || entry <= 0) return 0;
  return isLong ? ((current - entry) / entry) * 100 : ((entry - current) / entry) * 100;
}

function toTimestamp(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function evaluate({ strategy, price, rsi, hasPosition, entryPrice, lastTradeAt }) {
  const sl = strategy.stopLossPercent ?? 3;
  const tp = strategy.takeProfitPercent ?? 5;
  const oversold = strategy.rsiOversold ?? 35;
  const overbought = strategy.rsiOverbought ?? 65;
  const intervalMs = (strategy.intervalMinutes || 60) * 60 * 1000;
  const canTrade = Date.now() - toTimestamp(lastTradeAt) >= intervalMs;

  if (hasPosition && entryPrice > 0) {
    const move = pctMove(price, entryPrice, true);
    if (move <= -sl) return { action: 'sell', reason: `stop-loss ${move.toFixed(2)}%` };
    if (move >= tp) return { action: 'sell', reason: `take-profit +${move.toFixed(2)}%` };
    if (rsi != null && rsi >= overbought) return { action: 'sell', reason: `RSI ${rsi.toFixed(1)} ipercomprato` };
    return { action: 'hold', reason: `in posizione P&L ${move.toFixed(2)}% RSI ${rsi?.toFixed(1) ?? 'n/d'}` };
  }

  if (!canTrade) {
    return { action: 'hold', reason: 'attesa intervallo minimo tra trade' };
  }

  if (rsi != null && rsi <= oversold) {
    return { action: 'buy', reason: `RSI ${rsi.toFixed(1)} ipervenduto` };
  }

  if (rsi == null && strategy.mode === 'autonomous') {
    return { action: 'buy', reason: 'DCA autonomo (RSI non disponibile)' };
  }

  return { action: 'hold', reason: `RSI ${rsi?.toFixed(1) ?? 'n/d'} — nessun segnale` };
}

async function resolveOrderSize(ctx, price, rsi) {
  const { strategy, getAllocated, getEquity, balance } = ctx;

  if (strategy.autoSize !== false) {
    const equity = getEquity ? await getEquity() : (balance?.accountValue ?? balance?.amount ?? 0);
    const cash = balance?.amount ?? equity;
    const entryScore = rsi != null
      ? { score: Math.max(strategy.minConfidenceScore ?? 52, Math.round(52 + (strategy.rsiOversold ?? 35) - rsi)) }
      : null;
    const sizing = risk.computeBudgetOrderSize({ equity, cash, price, strategy, entryScore });
    return { ...sizing, mode: 'budget' };
  }

  const allocated = getAllocated();
  const tradeUsd = allocated * ((strategy.tradePercent || 1) / 100);
  return {
    amount: Math.max(0.0001, tradeUsd / price),
    usd: tradeUsd,
    budget: allocated,
    mode: 'percent',
  };
}

async function runTick(ctx) {
  const {
    strategy,
    getPrice,
    getPosition,
    getEntryPrice,
    getAllocated,
    getEquity,
    balance,
    executeMarketBuy,
    executeMarketSell,
    resumeAfterClose,
    onLog,
    riskState,
    saveRiskState,
    onAlert,
  } = ctx;

  if (!strategy.active) return { skipped: true };

  // FIX: try/catch globale. Prima, se fetchCloses o executeMarketBuy
  // lanciavano, l'eccezione propagava a runAutonomousTick e poteva
  // lasciare strategy in stato inconsistente.
  try {
    const pair = strategy.pair;
    const price = await getPrice(pair);
    const position = await getPosition(pair);
    const hasPosition = Math.abs(position) > 1e-9;
    const entryPrice = await getEntryPrice(pair);
    const closes = await fetchCloses(pair, strategy.candleInterval || '15m');
    const rsi = closes ? computeRSI(closes, strategy.rsiPeriod || 14) : null;

    const equity = getEquity ? await getEquity() : (balance?.accountValue ?? balance?.amount ?? 0);
    // NOTE: blocco risk-check duplicato con pro-engine.js.
    // Nel refactor completo, estrarre in risk.checkAndLog(ctx).
    const riskCheck = risk.checkCanTrade(strategy, riskState, equity);
    if (!riskCheck.allowed && !hasPosition) {
      onLog(`[AUTO] Bloccato: ${riskCheck.reasons.join('; ')}`);
      strategy.lastSignal = { action: 'blocked', reason: riskCheck.reasons[0], score: 0 };
      if (saveRiskState) saveRiskState(riskCheck.state);
      if (onAlert) onAlert('Circuit breaker', riskCheck.reasons[0]);
      return { signal: strategy.lastSignal, blocked: true };
    }
    if (saveRiskState) saveRiskState(riskCheck.state);

    const signal = await evaluate({
      strategy,
      price,
      rsi,
      hasPosition,
      entryPrice,
      lastTradeAt: strategy.lastTradeAt,
    });

    onLog(`[AUTO] ${pair} $${price.toFixed(2)} RSI=${rsi?.toFixed(1) ?? 'n/d'} → ${signal.action} (${signal.reason})`);

    if (signal.action === 'sell' && hasPosition) {
      const res = await executeMarketSell(pair, 1);
      if (res.ok) {
        strategy.lastTradeAt = Date.now();
        strategy.lastSignal = signal;
        if (res.trade?.pnl != null && saveRiskState) {
          saveRiskState(risk.recordTradeResult(riskCheck.state, res.trade.pnl, strategy));
        }
        if (resumeAfterClose) await resumeAfterClose();
      }
      return { signal, result: res };
    }

    if (signal.action === 'buy' && !hasPosition) {
      const sizing = await resolveOrderSize(ctx, price, rsi);
      const orderAmount = sizing.amount;
      const notional = sizing.usd || orderAmount * price;

      // IMPROVEMENT: usa costante MIN_NOTIONAL_USD invece di magic number 10
      if (!orderAmount || notional < MIN_NOTIONAL_USD) {
        onLog(`[AUTO] Skip buy: ${sizing.reason || 'size insufficiente'} (budget $${(sizing.budget ?? balance?.amount ?? 0).toFixed(2)})`);
        strategy.lastSignal = { action: 'hold', reason: sizing.reason || 'budget insufficiente', score: 0 };
        return { signal: strategy.lastSignal, result: null, sizing };
      }

      onLog(`[AUTO] Size ${sizing.mode}: ${orderAmount.toFixed(4)} ${pair} (~$${notional.toFixed(2)}, budget $${(sizing.budget ?? balance?.amount ?? 0).toFixed(2)})`);
      const res = await executeMarketBuy(pair, orderAmount);
      if (!res.ok) {
        onLog(`[AUTO] Buy fallito: ${res.error || 'errore sconosciuto'}`);
      }
      if (res.ok) {
        strategy.lastTradeAt = Date.now();
        strategy.lastSignal = signal;
      }
      return { signal, result: res, sizing };
    }

    strategy.lastSignal = signal;
    return { signal, result: null };
  } catch (e) {
    // FIX: catch globale — prima un'eccezione non catturata poteva crashare
    // il tick e lasciare strategy in stato inconsistente.
    console.error('[AUTO] Errore runTick:', e.message, e.stack);
    strategy.lastSignal = { action: 'hold', reason: `errore interno: ${e.message}`, score: 0 };
    return { signal: strategy.lastSignal, error: e.message };
  }
}

module.exports = {
  fetchCloses,
  computeRSI,
  evaluate,
  runTick,
};
