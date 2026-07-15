// Cache contesto agente + proactive context
// EXTRACTED FROM index.js:625-680

const proEngine = require('../pro-engine');
const { getPrice } = require('../trading/price');
const { getPositionSize, getEntryPrice } = require('../trading/positions');
const { getEquity } = require('../trading/balance');
const { isLiveMode, loadWallet } = require('../state/wallet');
const { getRiskBlocked } = require('../state/risk');
const shared = require('../state/shared');

function updateTickSnapshot(patch) {
  shared.lastTickSnapshot = { ...(shared.lastTickSnapshot || {}), ...patch, updatedAt: Date.now() };
}

async function refreshAgentContextCache() {
  try {
    const price = await getPrice(shared.strategy.pair);
    const position = await getPositionSize(shared.strategy.pair);
    const entryPrice = await getEntryPrice(shared.strategy.pair);
    updateTickSnapshot({ price, position, entryPrice, hasPosition: Math.abs(position) > 1e-9 });
  } catch (e) {
    console.error('[AGENT] refresh context:', e.message);
  }
}

function getAgentContext() {
  const snap = shared.lastTickSnapshot || {};
  const entryScore = snap.entryScore;
  const riskBlocked = getRiskBlocked();
  return {
    pair: shared.strategy.pair,
    mode: isLiveMode() ? 'live' : 'demo',
    live: isLiveMode(),
    active: shared.strategy.active,
    operational: shared.strategy.active && !riskBlocked,
    riskBlocked,
    circuitBreaker: !!shared.riskState.circuitBreaker,
    circuitReason: shared.riskState.circuitReason || null,
    lastSignal: shared.strategy.lastSignal?.reason || null,
    balance: shared.balance.amount,
    price: snap.price ?? null,
    score: entryScore?.score ?? shared.strategy.lastSignal?.score ?? null,
    effectiveMin: entryScore?.effectiveMin ?? shared.strategy.minConfidenceScore ?? 65,
    regime: entryScore?.regime ?? null,
    rsi: snap.analysis?.entry?.rsi ?? null,
    hasPosition: snap.hasPosition ?? false,
  };
}

function snapPrice(p) {
  return typeof p === 'number' && !Number.isNaN(p) ? p : null;
}

async function buildProactiveContext() {
  const wallet = loadWallet();
  const price = snapPrice(await getPrice(shared.strategy.pair));
  const position = await getPositionSize(shared.strategy.pair);
  const entryPrice = await getEntryPrice(shared.strategy.pair);
  let analysis = shared.lastTickSnapshot?.analysis;
  let entryScore = shared.lastTickSnapshot?.entryScore;
  if (!analysis && shared.strategy.mode === 'pro') {
    try {
      analysis = await proEngine.analyzeMarket(shared.strategy.pair, shared.strategy);
      entryScore = proEngine.scoreEntry(analysis, shared.strategy);
      updateTickSnapshot({ analysis, entryScore, price, position, entryPrice });
    } catch (e) {
      console.error('[PROACTIVE] analyze:', e.message);
    }
  }
  return { wallet, strategy: shared.strategy, analysis, entryScore, price, position, entryPrice, mode: isLiveMode() ? 'live' : 'demo', equity: await getEquity(), riskState: shared.riskState };
}

module.exports = { updateTickSnapshot, refreshAgentContextCache, getAgentContext, buildProactiveContext };
