// =========================================================================
// HermesBro Conversational Trading Bot Engine v2 — Bootstrap + Wiring
// Server Express + DCA loop + Hyperliquid integration in Italiano
// =========================================================================

const { PORT, DATA_DIR } = require('./config/default');
const HOST = process.env.HOST || '127.0.0.1';
const { loadState } = require('./state/strategy');
const { loadRiskState } = require('./state/risk');
const { loadWallet } = require('./state/wallet');
const { createApp, setConfigureFns } = require('./server/app');
const { setControlFns } = require('./conversation/handlers');
const { setLoopFns, restartAutonomousLoop, startProactiveLoop } = require('./engine/loops');
const { runAutonomousTick, runProactiveCheck } = require('./engine/tick-runner');
const { refreshAgentContextCache } = require('./engine/context-cache');
const { setRestartLoopFn, setRunTickFn } = require('./trading/orders');
const shared = require('./state/shared');

const eventLog = require('./event-log');
const gracefulShutdown = require('./graceful-shutdown');

const hermesProfile = require('./hermes-profile');
const llmProvider = require('./llm-provider');
const engineContextSync = require('./engine-context-sync');

// --- Init state ---
loadState();
loadRiskState();

// --- Graceful shutdown ---
gracefulShutdown.install();
gracefulShutdown.onShutdown(() => {
  const { saveStrategy } = require('./state/strategy');
  const { saveRiskState } = require('./state/risk');
  saveStrategy();
  saveRiskState(shared.riskState);
}, 'save state files');
eventLog.startup({ pair: shared.strategy.pair, mode: shared.strategy.mode, active: shared.strategy.active });

// --- Wiring: collega forward declarations ---
setLoopFns(runAutonomousTick, runProactiveCheck);
setControlFns(restartAutonomousLoop, runAutonomousTick);
setConfigureFns(restartAutonomousLoop, runAutonomousTick);
setRestartLoopFn(restartAutonomousLoop);
setRunTickFn(runAutonomousTick);
gracefulShutdown.setTickRunningFn(() => _tickRunning_check());
// Forward declare _tickRunning check
const tickRunner = require('./engine/tick-runner');
function _tickRunning_check() { return tickRunner.isTickRunning(); }

// --- Express ---
const app = createApp();

app.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  H2BB / Hermes v4.6 — DASHBOARD         ║`);
  console.log(`║  Server: ${base.padEnd(32)}║`);
  console.log(`║  UI:     ${(base + '/').padEnd(32)}║`);
  console.log(`║  Pair: ${String(shared.strategy.pair).padEnd(35)}║`);
  console.log(`║  Mode: ${String(shared.strategy.mode || 'autonomous').padEnd(34)}║`);
  console.log(`║  Active: ${String(shared.strategy.active).padEnd(31)}║`);
  console.log(`╚══════════════════════════════════════════╝\n`);

  hermesProfile.ensureProfile(DATA_DIR, {
    agentName: `client-trade-${process.env.ORDER_ID || '1'}`,
    pair: shared.strategy.pair,
  });

  console.log(llmProvider.statusLine());

  restartAutonomousLoop();
  startProactiveLoop();

  engineContextSync.startEngineContextSync({
    strategy: shared.strategy, balance: shared.balance,
    isLiveMode: require('./state/wallet').isLiveMode,
    loadWallet, getPrice: require('./trading/price').getPrice,
    calcPnL: require('./trading/pnl').calcPnL,
    hlLive: require('./hyperliquid-live'),
    walletKey: require('./state/wallet').walletKey,
    syncLiveBalance: require('./trading/balance').syncLiveBalance,
  });

  refreshAgentContextCache().catch((e) => console.error('[CONTEXT] refresh failed:', e.message));

  if (shared.strategy.active) {
    setTimeout(runAutonomousTick, 3000);
  }
});
