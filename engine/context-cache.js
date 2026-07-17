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
  const rs = shared.riskState || {};
  const strat = shared.strategy || {};
  const dec = strat.lastDecision || {};

  let aiAutonomy = false;
  try {
    const { isAiAutonomyEnabled } = require('../lib/ai-autonomy');
    aiAutonomy = isAiAutonomyEnabled(strat);
  } catch {
    aiAutonomy = !!strat.aiSignalEnabled;
  }

  let metaMode = null;
  try {
    const path = require('path');
    const fs = require('fs');
    const { DATA_DIR } = require('../config/default');
    const f = path.join(DATA_DIR, 'meta-controller-state.json');
    if (fs.existsSync(f)) {
      metaMode = JSON.parse(fs.readFileSync(f, 'utf-8')).currentMode || null;
    }
  } catch { /* optional */ }

  const aiBlock = dec.ai || null;
  const reasonCode = dec.reasonCode || strat.lastSignal?.reasonCode || null;

  return {
    pair: strat.pair,
    mode: isLiveMode() ? 'live' : 'demo',
    live: isLiveMode(),
    active: !!strat.active,
    operational: !!strat.active && !riskBlocked,
    riskBlocked,
    circuitBreaker: !!rs.circuitBreaker,
    circuitReason: rs.circuitReason || null,
    stickyKind: rs.stickyKind || null,
    lastSignal: strat.lastSignal?.reason || dec.reason || null,
    lastReasonCode: reasonCode,
    lastDecisionAction: dec.action || strat.lastSignal?.action || null,
    balance: shared.balance.amount,
    price: snap.price ?? null,
    score: entryScore?.score ?? strat.lastSignal?.score ?? dec.score ?? null,
    effectiveMin: entryScore?.effectiveMin ?? strat.minConfidenceScore ?? 65,
    baseMinScore: strat.minConfidenceScore ?? null,
    regime: entryScore?.regime ?? dec.regime ?? null,
    rsi: snap.analysis?.entry?.rsi ?? null,
    hasPosition: snap.hasPosition ?? false,
    // AI / autonomy awareness for Telegram
    aiAutonomy,
    aiFlags: {
      signal: !!strat.aiSignalEnabled,
      threshold: strat.aiDynamicThreshold !== false,
      exit: strat.aiExitEnabled !== false,
      takeProfit: strat.aiTakeProfitEnabled !== false,
    },
    lastAi: aiBlock
      ? {
          bias: aiBlock.bias,
          confidence: aiBlock.confidence,
          reasoning: aiBlock.reasoning,
        }
      : null,
    metaMode,
    riskPerTradePercent: strat.riskPerTradePercent ?? null,
    maxPositionPercent: strat.maxPositionPercent ?? null,
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
