// Scrive contesto live del motore per Hermes prefill (Telegram gateway).
// File: $DATA_DIR/cache/engine-prefill.json — di solito symlink → profilo h2bb.
const fs = require('fs');
const path = require('path');

const CACHE_DIR = process.env.HERMES_CACHE_DIR
  || path.join(process.env.DATA_DIR || __dirname, 'cache');
const PREFILL_FILE = path.join(CACHE_DIR, 'engine-prefill.json');
const INTERVAL_MS = parseInt(process.env.ENGINE_CONTEXT_INTERVAL_MS, 10) || 30000;

let deps = null;

function setDeps(d) {
  deps = d;
}

function r2(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

function formatContext(status) {
  const s = status.strategy || {};
  const m = status.market || {};
  const b = status.balance || {};
  const w = status.wallet || {};
  const pnl = status.pnl || {};
  const risk = status.risk || {};
  const sig = status.signal || {};
  const ai = status.ai || {};

  const lines = [
    'CONTESTO MOTORE TRADING (live auto — USA QUESTI DATI, non inventare):',
    `Wallet: ${w.addressShort || w.address || '?'} · Mode: ${w.mode || '?'} · Live: ${w.live ? 'sì' : 'no'}`,
    `Equity: $${r2(b.equity) ?? '?'} · spot avail $${r2(b.usdcSpotAvailable ?? b.usdcSpot) ?? '?'} · perp AV $${r2(b.accountValuePerp) ?? 0}`,
    `HYPE HyperEVM: ${Number(b.hypeEvm || 0).toFixed(4)}`,
    `Pair: ${s.pair || 'ETH'} · engine active: ${s.active ? 'SÌ' : 'NO'} · aiMode: ${ai.mode || s.aiMode || 'balanced'}`,
    `Prezzo ${s.pair || 'ETH'}: $${r2(m.currentPrice) ?? '?'} (HL mid)`,
    `Posizione: ${m.side || 'flat'} ${m.heldAmount ?? 0} ${s.pair || ''} · entry $${r2(m.avgBuyPrice) ?? '—'} · uPnL $${r2(pnl.unrealized) ?? 0} (${r2(pnl.unrealizedPercent) ?? 0}%)`,
    `Day PnL: $${r2(pnl.dayUsd) ?? 0} (${r2(pnl.dayPct) ?? 0}%)`,
    `Risk: CB=${risk.circuitBreaker ? 'ON' : 'OFF'}${risk.circuitReason ? ` (${risk.circuitReason})` : ''}`
      + ` · sticky=${risk.stickyKind || 'none'} · canTrade=${risk.canTrade ? 'SÌ' : 'NO'}`,
    `Segnale: ${sig.action || '—'} · score ${sig.score ?? '—'}/${sig.minScore ?? '—'} · ${sig.reason || sig.reasonCode || ''}`,
    `Risk params: risk/trade ${s.riskPerTradePercent ?? '?'}% · maxPos ${s.maxPositionPercent ?? '?'}% · minScore ${s.minConfidenceScore ?? '?'}`,
    'REGOLE: NON chiedere SSH/curl. NON inventare prezzi. Se canTrade=NO spiega il risk CB. Se active=SÌ e canTrade=SÌ il motore può tradare.',
  ];
  return lines.join('\n');
}

async function buildSnapshot() {
  if (!deps) return null;
  const {
    strategy, balance, riskState, isLiveMode, loadWallet, getPrice, calcPnL,
    hlLive, walletKey, syncLiveBalance, getEquity, getPositionSize, getEntryPrice,
    getRiskBlocked,
  } = deps;

  if (isLiveMode()) {
    try { await syncLiveBalance(); } catch { /* ignore */ }
  }

  const pair = strategy.pair || 'ETH';
  const price = await getPrice(pair);
  const w = loadWallet();
  let position = 0;
  let entryPrice = 0;
  try {
    if (getPositionSize) position = await getPositionSize(pair);
    else if (isLiveMode() && w?.address && hlLive) {
      position = await hlLive.getSignedPosition(w.address, walletKey(w), pair);
    }
  } catch { /* ignore */ }
  try {
    if (getEntryPrice) entryPrice = await getEntryPrice(pair);
    else if (isLiveMode() && w?.address && hlLive) {
      entryPrice = await hlLive.getEntryPrice(w.address, walletKey(w), pair);
    }
  } catch { /* ignore */ }

  const held = Math.abs(position) || 0;
  const avgEntry = entryPrice > 0 ? entryPrice : (calcPnL?.()?.avgBuyPrice || 0);
  const pnlDollari = held > 0 && price && avgEntry
    ? (held * price) - (held * avgEntry)
    : 0;
  const pnlPerc = avgEntry > 0 && price
    ? ((price - avgEntry) / avgEntry) * 100 * (position < 0 ? -1 : 1)
    : 0;

  let equity = balance.accountValue ?? balance.amount ?? 0;
  try {
    if (getEquity) equity = await getEquity();
  } catch { /* ignore */ }

  const dayStart = riskState?.dayStartEquity;
  const dayUsd = dayStart > 0 && equity != null ? equity - dayStart : null;
  const dayPct = dayStart > 0 && equity != null ? ((equity - dayStart) / dayStart) * 100 : null;

  const riskBlocked = typeof getRiskBlocked === 'function'
    ? getRiskBlocked()
    : !!(riskState?.circuitBreaker);

  const lastDec = strategy.lastDecision || strategy.lastSignal || {};
  const snap = deps.shared?.lastTickSnapshot || {};
  const entryScore = snap.entryScore || {};

  return {
    strategy: {
      pair,
      active: !!strategy.active,
      intervalMinutes: strategy.intervalMinutes,
      checkIntervalSeconds: strategy.checkIntervalSeconds,
      minConfidenceScore: strategy.minConfidenceScore,
      riskPerTradePercent: strategy.riskPerTradePercent,
      maxPositionPercent: strategy.maxPositionPercent,
      aiMode: strategy.aiMode,
    },
    market: {
      currentPrice: price,
      heldAmount: held,
      avgBuyPrice: avgEntry,
      side: position > 0 ? 'long' : position < 0 ? 'short' : 'flat',
    },
    pnl: {
      unrealized: r2(pnlDollari),
      unrealizedPercent: r2(pnlPerc),
      dayUsd: r2(dayUsd),
      dayPct: r2(dayPct),
    },
    balance: {
      usdc: balance.amount,
      usdcPerp: balance.usdcPerp,
      usdcSpot: balance.usdcSpot,
      usdcSpotAvailable: balance.usdcSpotAvailable,
      accountValuePerp: balance.accountValuePerp,
      hypeEvm: balance.hypeEvm,
      equity: r2(equity),
      source: balance.source,
    },
    wallet: w
      ? {
          mode: w.mode,
          live: isLiveMode(),
          addressShort: w.address
            ? `${w.address.slice(0, 6)}…${w.address.slice(-4)}`
            : null,
        }
      : null,
    risk: {
      circuitBreaker: !!riskState?.circuitBreaker,
      circuitReason: riskState?.circuitReason || null,
      stickyKind: riskState?.stickyKind || null,
      canTrade: !!strategy.active && !riskBlocked,
    },
    signal: {
      action: lastDec.action || entryScore.bias || null,
      reason: lastDec.reason || null,
      reasonCode: lastDec.reasonCode || null,
      score: entryScore.score ?? lastDec.score ?? null,
      minScore: entryScore.effectiveMin ?? strategy.minConfidenceScore ?? null,
    },
    ai: {
      mode: strategy.aiMode || 'balanced',
    },
  };
}

async function writePrefill() {
  try {
    const status = await buildSnapshot();
    if (!status) return;
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const content = formatContext(status);
    const payload = [{ role: 'system', content }];
    const tmp = PREFILL_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.chmodSync(tmp, 0o644);
    fs.renameSync(tmp, PREFILL_FILE);
  } catch (e) {
    console.error('[ENGINE-CONTEXT]', e.message);
  }
}

let timer = null;

function startEngineContextSync(d) {
  setDeps(d);
  if (timer) clearInterval(timer);
  writePrefill().catch(() => {});
  timer = setInterval(() => writePrefill().catch(() => {}), INTERVAL_MS);
  // log once so ops can verify Telegram bridge path
  console.log(`[ENGINE-CONTEXT] prefill → ${PREFILL_FILE} ogni ${INTERVAL_MS / 1000}s`);
}

module.exports = { startEngineContextSync, writePrefill, PREFILL_FILE, formatContext };
