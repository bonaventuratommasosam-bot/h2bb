'use strict';

const fs = require('fs');
const path = require('path');

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const MODEL = 'deepseek-chat';
const TIMEOUT_MS = 5000;
const LOG_FILE = path.join(__dirname, 'ai-signals.jsonl');

const PROMPTS = {
  entry: `Sei un analista quantitativo di criptovalute. Valuta un setup LONG su perpetual futures.
Riceverai dati tecnici in JSON. Devi dare un secondo parere indipendente.
Rispondi SOLO con un oggetto JSON compatto, niente markdown, niente testo fuori dal JSON:
{"bias":"bullish|bearish|neutral","confidence":0-100,"reasoning":"motivo breve in italiano, max 120 caratteri"}
bias bearish = non entrare. bullish = conferma. neutral = indeciso.
Considera: allineamento multi-timeframe, momentum, volatilità, funding, volume.`,

  exit: `Sei un analista quantitativo di criptovalute. Valuta se chiudere o mantenere una posizione aperta su perpetual futures.
Riceverai dati tecnici in JSON. Devi decidere: vendere subito o tenere.
Rispondi SOLO con un oggetto JSON compatto, niente markdown, niente testo fuori dal JSON:
{"action":"sell|hold","confidence":0-100,"reasoning":"motivo breve in italiano, max 120 caratteri"}
action sell = chiudi posizione. hold = mantieni.
Considera: P&L attuale, momentum (MACD/RSI/stoch), trend 1h/15m, funding, volatilità.
Se il momentum si indebolisce o il trend si inverte, suggerisci sell. Se il trend è intatto e P&L positivo, hold.`,

  threshold: `Sei un analista quantitativo di criptovalute. Suggerisci la soglia minima di confidenza per entrare in trade.
Riceverai dati sul regime di mercato e performance recente in JSON.
Rispondi SOLO con un oggetto JSON compatto, niente markdown, niente testo fuori dal JSON:
{"threshold":30-75,"reasoning":"motivo breve in italiano, max 120 caratteri"}
Soglia più alta = più selettivo (meno trade, più qualità).
Soglia più bassa = più permissivo (più trade, più rischio).
In regime trending con buon win rate: puoi abbassare. In regime volatile o con win rate basso: alza.`,

  takeProfit: `Sei un analista quantitativo di criptovalute. Suggerisci livelli di take profit per una posizione LONG aperta.
Riceverai dati tecnici in JSON.
Rispondi SOLO con un oggetto JSON compatto, niente markdown, niente testo fuori dal JSON:
{"tp1Percent":0-100,"tp1Price":numero,"tp2Price":numero,"trailingActivate":numero,"reasoning":"motivo breve in italiano, max 120 caratteri"}
tp1Percent = percentuale di posizione da chiudere al tp1Price (take profit parziale).
tp2Price = target price per chiusura totale.
trailingActivate = percentuale di profitto a cui attivare trailing stop.
Considera: resistenze (Bollinger upper, massimi recenti), momentum (MACD/RSI), volatilità (ATR), trend multi-TF.
Non suggerire target irrealistici. Basati su livelli tecnici reali.`
};

// ─── Chiamata DeepSeek condivisa ───

function resolveLlmEndpoint() {
  // Prefer DeepSeek if key set (low latency for trading ticks)
  if (process.env.DEEPSEEK_API_KEY) {
    return {
      url: DEEPSEEK_URL,
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || MODEL,
      provider: 'deepseek',
    };
  }
  try {
    const llmProvider = require('./llm-provider');
    const cfg = llmProvider.resolveConfig?.();
    if (cfg?.enabled && cfg?.key && cfg?.url) {
      return {
        url: cfg.url,
        apiKey: cfg.key,
        model: cfg.model || MODEL,
        provider: cfg.provider || 'llm',
        headers: cfg.extraHeaders || {},
      };
    }
  } catch { /* optional */ }
  return null;
}

async function callDeepSeek(systemPrompt, userPrompt, parser, ctx, eventType) {
  const ep = resolveLlmEndpoint();
  if (!ep) {
    logEvent({ event: eventType, status: 'no_api_key', ...meta(ctx) });
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  let response;
  try {
    response = await fetch(ep.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ep.apiKey}`,
        ...(ep.headers || {}),
      },
      body: JSON.stringify({
        model: ep.model,
        temperature: 0.25,
        max_tokens: 180,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err?.name === 'AbortError';
    logEvent({
      event: eventType, status: isTimeout ? 'timeout' : 'fetch_error',
      provider: ep.provider,
      error: String(err?.message || err), ms: Date.now() - startedAt, ...meta(ctx),
    });
    return null;
  }
  clearTimeout(timer);

  if (!response.ok) {
    logEvent({ event: eventType, status: 'http_error', provider: ep.provider, code: response.status, ms: Date.now() - startedAt, ...meta(ctx) });
    return null;
  }

  let data;
  try { data = await response.json(); } catch (err) {
    logEvent({ event: eventType, status: 'parse_error', error: String(err?.message || err), ms: Date.now() - startedAt, ...meta(ctx) });
    return null;
  }

  const raw = data?.choices?.[0]?.message?.content || '';
  const parsed = parser(raw);
  if (!parsed) {
    logEvent({ event: eventType, status: 'unparseable', raw: String(raw).slice(0, 200), ms: Date.now() - startedAt, ...meta(ctx) });
    return null;
  }

  logEvent({ event: eventType, status: 'ok', provider: ep.provider, ...parsed, ms: Date.now() - startedAt, ...meta(ctx) });
  return parsed;
}

// ─── Costruttori prompt ───

function buildEntryPrompt(ctx) {
  const ind = ctx.indicators || {};
  const trends = ctx.trends || {};
  return JSON.stringify({
    pair: ctx.pair, timeframe_entry: ctx.candleInterval || '15m', entryScore: ctx.entryScore,
    trends: { macro_4h: trends.macro, trend_1h: trends.trend, entry_15m: trends.entry },
    indicators: { rsi: ind.rsi, macd: ind.macd, ema20: ind.ema20, ema50: ind.ema50, ema200: ind.ema200, adx: ind.adx, bb: ind.bb, bbPos: ind.bbPos, atr: ind.atr, volRatio: ind.volRatio, stoch: ind.stoch, regime: ind.regime, price: ind.price },
    fundingRate: ctx.fundingRate,
  });
}

function buildExitPrompt(ctx) {
  const ind = ctx.indicators || {};
  const trends = ctx.trends || {};
  return JSON.stringify({
    pair: ctx.pair, position: ctx.position, pnlPercent: ctx.pnlPercent,
    entryPrice: ctx.entryPrice, currentPrice: ctx.currentPrice,
    indicators: { rsi: ind.rsi, macd: ind.macd, stoch: ind.stoch, atr: ind.atr },
    trends: { trend_1h: trends.trend, entry_15m: trends.entry }, fundingRate: ctx.fundingRate,
  });
}

function buildThresholdPrompt(ctx) {
  return JSON.stringify({
    pair: ctx.pair || 'ETH', regime: ctx.regime, volatilityPct: ctx.volatilityPct,
    recentPerformance: {
      lastTrades: ctx.lastTrades || [],
      winRate: ctx.winRate,
      profitFactor: ctx.profitFactor,
    },
    adx: ctx.adx, emaDistance: ctx.emaDistance,
  });
}

function buildTakeProfitPrompt(ctx) {
  const ind = ctx.indicators || {};
  const trends = ctx.trends || {};
  return JSON.stringify({
    pair: ctx.pair, position: ctx.position, entryPrice: ctx.entryPrice,
    currentPrice: ctx.currentPrice, pnlPercent: ctx.pnlPercent,
    atr: ind.atr, bollinger: ind.bb, recentHighs: ctx.recentHighs,
    momentum: { macd: ind.macd, rsi: ind.rsi },
    trends: { macro_4h: trends.macro, trend_1h: trends.trend, entry_15m: trends.entry },
    volatilityPct: ctx.volatilityPct,
  });
}

// ─── Parser risposte ───

function extractJson(raw) {
  if (!raw) return null;
  let txt = raw.trim();
  const m = txt.match(/\{[\s\S]*\}/);
  if (m) txt = m[0];
  try { return JSON.parse(txt); } catch { return null; }
}

function parseEntry(raw) {
  const obj = extractJson(raw); if (!obj) return null;
  const bias = String(obj.bias || '').toLowerCase();
  if (!['bullish', 'bearish', 'neutral'].includes(bias)) return null;
  const c = Number(obj.confidence); if (!Number.isFinite(c)) return null;
  return { bias, confidence: Math.max(0, Math.min(100, c)), reasoning: String(obj.reasoning || '').slice(0, 160) };
}

function parseExit(raw) {
  const obj = extractJson(raw); if (!obj) return null;
  const action = String(obj.action || '').toLowerCase();
  if (!['sell', 'hold'].includes(action)) return null;
  const c = Number(obj.confidence); if (!Number.isFinite(c)) return null;
  return { action, confidence: Math.max(0, Math.min(100, c)), reasoning: String(obj.reasoning || '').slice(0, 160) };
}

function parseThreshold(raw) {
  const obj = extractJson(raw); if (!obj) return null;
  const t = Number(obj.threshold); if (!Number.isFinite(t)) return null;
  return { threshold: Math.max(30, Math.min(75, Math.round(t))), reasoning: String(obj.reasoning || '').slice(0, 160) };
}

function parseTakeProfit(raw) {
  const obj = extractJson(raw); if (!obj) return null;
  const tp1Price = Number(obj.tp1Price), tp2Price = Number(obj.tp2Price);
  if (!Number.isFinite(tp1Price) || !Number.isFinite(tp2Price)) return null;
  const tp1Percent = Number(obj.tp1Percent);
  const trailingActivate = Number(obj.trailingActivate);
  return {
    tp1Percent: Number.isFinite(tp1Percent) ? Math.max(0, Math.min(100, tp1Percent)) : 50,
    tp1Price, tp2Price,
    trailingActivate: Number.isFinite(trailingActivate) ? Math.max(0, trailingActivate) : null,
    reasoning: String(obj.reasoning || '').slice(0, 160),
  };
}

// ─── Helpers ───

function meta(ctx) { return { ts: Date.now(), pair: ctx.pair }; }

function logEvent(evt) {
  try { fs.appendFileSync(LOG_FILE, JSON.stringify(evt) + '\n'); } catch { /* non blocca */ }
}

// ─── API pubblica ───

async function evaluate(ctx) {
  return callDeepSeek(PROMPTS.entry, buildEntryPrompt(ctx), parseEntry, ctx, 'entry');
}
async function evaluateExit(ctx) {
  return callDeepSeek(PROMPTS.exit, buildExitPrompt(ctx), parseExit, ctx, 'exit');
}
async function evaluateThreshold(ctx) {
  return callDeepSeek(PROMPTS.threshold, buildThresholdPrompt(ctx), parseThreshold, ctx, 'threshold');
}
async function evaluateTakeProfit(ctx) {
  return callDeepSeek(PROMPTS.takeProfit, buildTakeProfitPrompt(ctx), parseTakeProfit, ctx, 'takeProfit');
}

module.exports = { evaluate, evaluateExit, evaluateThreshold, evaluateTakeProfit };
