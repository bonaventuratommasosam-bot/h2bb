// Agente proattivo — briefing, alert segnali, aggiornamenti posizione
const fs = require('fs');
const path = require('path');
const alerts = require('./alerts');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const STATE_FILE = path.join(DATA_DIR, 'proactive-state.json');
const MIN_GAP_MS = (parseInt(process.env.PROACTIVE_MIN_MINUTES, 10) || 25) * 60_000;
const BRIEFING_HOUR = parseInt(process.env.PROACTIVE_BRIEFING_HOUR, 10) || 8;

const DEFAULT_STATE = {
  lastProactiveAt: null,
  lastBriefingDay: null,
  lastSignalScore: null,
  lastPositionAlertAt: null,
  lastLiveNudgeAt: null,
  lastInsightAt: null,
  lastCircuitReason: null,
  lastBudgetAlertAt: null,
  messagesSent: 0,
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return { ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) };
  } catch {}
  return { ...DEFAULT_STATE };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function canSend(state, urgent = false) {
  if (urgent) return true;
  if (!state.lastProactiveAt) return true;
  return Date.now() - state.lastProactiveAt >= MIN_GAP_MS;
}

function markSent(state) {
  state.lastProactiveAt = Date.now();
  state.messagesSent = (state.messagesSent || 0) + 1;
  return state;
}

function composeBriefingFixed(ctx) {
  const { strategy, price, score, effectiveMin, regime, mode, active, operational, pair, signals, heldAmount, entryPrice, pnlPct, rsi } = ctx;
  const modeLabel = mode === 'live' ? 'LIVE' : 'DEMO';
  const status = operational ? 'operativo' : (active ? 'bloccato dal risk manager' : 'in pausa');
  let mood = 'Neutrale — aspetto un setup migliore.';
  if (score >= effectiveMin) mood = 'Confluenza sopra soglia — valuto ingresso.';
  else if (score >= effectiveMin - 8) mood = 'Vicino al segnale — monitoro da vicino.';
  const sig = signals?.slice(0, 3).join('\n• ') || 'nessun driver forte';

  const lines = [
    `☀️ *Briefing ${pair}* (${modeLabel})`,
    '',
    `Stato: *${status}*`,
    `Prezzo: *$${price?.toFixed(2) ?? '?'}* · regime: *${regime || 'n/d'}*`,
    `Score: *${score ?? 'n/d'}/${effectiveMin}* — ${mood}`,
    '',
    `Driver:`,
    `• ${sig}`,
  ];

  if (rsi != null) lines.push(`\nRSI: ${rsi.toFixed(1)}${rsi < 35 ? ' (oversold)' : rsi > 70 ? ' (overbought)' : ''}`);

  if (heldAmount && Math.abs(heldAmount) > 1e-9) {
    const pnl = pnlPct >= 0 ? `+${pnlPct?.toFixed(2)}%` : `${pnlPct?.toFixed(2)}%`;
    lines.push(`\nPosizione: ${heldAmount?.toFixed(6)} ${pair} · entrata ~$${entryPrice?.toFixed(2) ?? '?'} · P&L: *${pnl}*`);
  } else {
    lines.push(`\nNessuna posizione aperta.`);
  }

  lines.push(`\n_Resto attento — ti scrivo se cambia qualcosa._`);

  return lines.join('\n');
}

function composeSignalAlert(ctx) {
  const { pair, price, score, effectiveMin, prevScore, signals } = ctx;
  const dir = score > (prevScore || 0) ? 'in miglioramento' : 'in peggioramento';
  return `📡 *Segnale ${pair}* ${dir}\n\n` +
    `Score passato da *${prevScore}* a *${score}/${effectiveMin}* @ $${price?.toFixed(2)}.\n` +
    `${signals?.slice(0, 3).join(' · ') || ''}\n\n` +
    (score >= effectiveMin
      ? '_Condizioni vicine all\'ingresso — resto vigile._'
      : '_Nessun ingresso ancora — aspetto più confluenza._');
}

function composePositionUpdate(ctx) {
  const { pair, price, pnlPct, heldAmount, entryPrice, regime } = ctx;
  const pnl = pnlPct >= 0 ? `+${pnlPct.toFixed(2)}%` : `${pnlPct.toFixed(2)}%`;
  return `📌 *Aggiornamento posizione ${pair}*\n\n` +
    `In portafoglio: ${heldAmount?.toFixed(6) ?? '?'} ${pair}\n` +
    `Prezzo: $${price?.toFixed(2)} · entrata ~$${entryPrice?.toFixed(2) ?? '?'}\n` +
    `P&L: *${pnl}* · regime ${regime || 'n/d'}\n\n` +
    `_Gestisco uscite con ATR e trailing — non serve che tu faccia nulla._`;
}

function composeMarketInsight(ctx) {
  const { pair, price, rsi, regime, score } = ctx;
  let note = 'Mercato in equilibrio.';
  if (rsi != null && rsi < 35) note = 'RSI basso — zona potenziale di interesse per i long.';
  else if (rsi != null && rsi > 70) note = 'RSI alto — cautela su nuovi ingressi.';
  else if (regime === 'trending') note = 'Trend definito — preferisco entrare su pullback.';
  return `💡 *${pair}* $${price?.toFixed(2)}\n${note}\nScore attuale: ${score ?? 'n/d'}.`;
}

function composeLiveNudge(ctx) {
  return `🔐 *Passo successivo*\n\n` +
    `Sei ancora in *DEMO*. Quando vuoi operare con capitale reale, scrivimi *attiva live*.\n` +
    `Ti guido nella creazione dell'API wallet su Hyperliquid — 2 minuti.`;
}

function composeTradeCommentary(trade, signal) {
  const mode = trade.mode === 'live' ? 'LIVE' : 'DEMO';
  if (trade.type === 'buy') {
    return `🟢 *Ho appena comprato* (${mode})\n` +
      `${trade.amount?.toFixed(6)} ${trade.pair} @ $${trade.price?.toFixed(2)}\n` +
      `_${signal?.reason || 'setup confermato'}_\n` +
      `Ti tengo aggiornato su stop e take-profit.`;
  }
  const pnl = trade.pnl != null ? `\nP&L: ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}` : '';
  return `🔴 *Ho chiuso / ridotto* (${mode})\n` +
    `${trade.amount?.toFixed(6)} ${trade.pair} @ $${trade.price?.toFixed(2)}${pnl}\n` +
    `_${signal?.reason || 'uscita strategica'}_`;
}

async function evaluate(ctx) {
  const {
    wallet, strategy, analysis, entryScore, price, position, entryPrice,
    mode, equity, riskState,
  } = ctx;

  const chatId = wallet?.ownerChatId;
  if (!chatId) return { sent: 0 };

  const state = loadState();
  const outbox = [];
  const score = entryScore?.score ?? strategy?.lastSignal?.score ?? null;
  const effectiveMin = entryScore?.effectiveMin ?? strategy?.minConfidenceScore ?? 65;
  const regime = entryScore?.regime ?? analysis?.entry?.regime;
  const rsi = analysis?.entry?.rsi;
  const signals = entryScore?.signals || [];
  const pair = strategy?.pair || 'ETH';
  const hasPosition = Math.abs(position || 0) > 1e-9;
  const pnlPct = entryPrice > 0 ? ((price - entryPrice) / entryPrice) * 100 : 0;
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);

  const riskBlocked = !!(
    riskState?.circuitBreaker
    || (riskState?.cooldownUntil && Date.now() < riskState.cooldownUntil)
  );
  const operational = !!strategy?.active && !riskBlocked;

  const base = {
    strategy, price, score, effectiveMin, regime, mode,
    active: strategy?.active,
    operational,
    pair, signals, rsi,
    heldAmount: position, entryPrice, pnlPct,
  };

  // Briefing giornaliero
  if (state.lastBriefingDay !== dayKey && now.getUTCHours() >= BRIEFING_HOUR) {
    outbox.push({ type: 'briefing', text: composeBriefingFixed(base), urgent: false });
    state.lastBriefingDay = dayKey;
  }

  // Alert segnale — score attraversa soglia o salta ±12
  const prev = state.lastSignalScore;
  if (score != null && prev != null) {
    const crossedUp = prev < effectiveMin && score >= effectiveMin;
    const crossedWatch = prev < effectiveMin - 8 && score >= effectiveMin - 8;
    const bigMove = Math.abs(score - prev) >= 12;
    if (crossedUp || (crossedWatch && bigMove)) {
      outbox.push({
        type: 'signal',
        text: composeSignalAlert({ ...base, prevScore: prev }),
        urgent: crossedUp,
      });
    }
  }
  if (score != null) state.lastSignalScore = score;

  // Posizione aperta — update ogni 4h
  if (hasPosition) {
    const posGap = 4 * 60 * 60_000;
    if (!state.lastPositionAlertAt || Date.now() - state.lastPositionAlertAt >= posGap) {
      outbox.push({ type: 'position', text: composePositionUpdate(base), urgent: false });
      state.lastPositionAlertAt = Date.now();
    }
  }

  // Insight mercato — RSI estremi senza posizione
  if (!hasPosition && rsi != null && (rsi < 32 || rsi > 72)) {
    const insightGap = 2 * 60 * 60_000;
    if (!state.lastInsightAt || Date.now() - state.lastInsightAt >= insightGap) {
      outbox.push({ type: 'insight', text: composeMarketInsight(base), urgent: false });
      state.lastInsightAt = Date.now();
    }
  }

  // Alert budget insufficiente — non può comprare
  if (!hasPosition && operational) {
    const cash = (equity || 0) * (1 - ((strategy?.cashReservePercent ?? 8) / 100));
    if (cash < 10 && (!state.lastBudgetAlertAt || Date.now() - state.lastBudgetAlertAt > 24 * 60 * 60_000)) {
      outbox.push({
        type: 'budget',
        text: `⚠️ *Budget insufficiente*\n\nSaldo disponibile: ~$${cash.toFixed(2)} USDC\nMinimo Hyperliquid: $10\n\nNon posso aprire nuovi trade. Aggiungi USDC o attendi.`,
        urgent: false,
      });
      state.lastBudgetAlertAt = Date.now();
    }
  }

  // Nudge live — demo dopo 24h dal setup
  if (mode !== 'live' && wallet?.configuredAt) {
    const age = Date.now() - Date.parse(wallet.configuredAt);
    const nudgeGap = 24 * 60 * 60_000;
    if (age > nudgeGap && (!state.lastLiveNudgeAt || Date.now() - state.lastLiveNudgeAt > nudgeGap)) {
      outbox.push({ type: 'live_nudge', text: composeLiveNudge(base), urgent: false });
      state.lastLiveNudgeAt = Date.now();
    }
  }

  // Circuit breaker — alert solo al primo trigger o se cambia motivo
  const circuitKey = riskState?.circuitBreaker
    ? (riskState.circuitReason || 'circuit breaker attivo')
    : null;
  if (circuitKey && state.lastCircuitReason !== circuitKey) {
    outbox.push({
      type: 'risk',
      text: `🛑 *Protezione capitale*\n${circuitKey}\n` +
        (operational
          ? '_Anomalia risk state — sto correggendo al prossimo tick._'
          : '_Riprendo automaticamente dopo la chiusura posizione, oppure scrivi *riprendi*._'),
      urgent: true,
    });
    state.lastCircuitReason = circuitKey;
  } else if (!circuitKey && state.lastCircuitReason) {
    outbox.push({
      type: 'risk_clear',
      text: '✅ *Risk manager ok* — sono di nuovo operativo e monitoro il mercato.',
      urgent: true,
    });
    state.lastCircuitReason = null;
  }

  let sent = 0;
  for (const msg of outbox) {
    if (!canSend(state, msg.urgent) && sent > 0) break;
    if (!canSend(state, msg.urgent) && !msg.urgent) continue;
    const ok = await alerts.sendTelegram(chatId, msg.text);
    if (ok) {
      markSent(state);
      sent += 1;
      if (!msg.urgent) break; // max 1 non-urgent per ciclo
    }
  }

  saveState(state);
  return { sent, state };
}

module.exports = {
  loadState,
  saveState,
  evaluate,
  composeTradeCommentary,
  composeBriefing: composeBriefingFixed,
};