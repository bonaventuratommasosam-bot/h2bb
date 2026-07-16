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

function onServerReady(boundHost) {
  const displayHost = boundHost === '0.0.0.0' || boundHost === '::'
    ? '127.0.0.1'
    : (boundHost === '::1' ? 'localhost' : boundHost);
  const base = `http://${displayHost}:${PORT}`;
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  H2BB / Hermes — VETRINA (read-only)   ║`);
  console.log(`║  Server: ${base.padEnd(32)}║`);
  console.log(`║  UI:     ${(base + '/').padEnd(32)}║`);
  console.log(`║  Pair: ${String(shared.strategy.pair).padEnd(35)}║`);
  console.log(`║  Mode: ${String(shared.strategy.mode || 'autonomous').padEnd(34)}║`);
  console.log(`║  Active: ${String(shared.strategy.active).padEnd(31)}║`);
  console.log(`╚══════════════════════════════════════════╝\n`);
  console.log(`  → Vetrina:   ${base}/  (sola lettura pubblica)`);
  console.log(`  → API:       ${base}/api/dashboard`);
  console.log(`  → Controlli: solo localhost (/resume /pause /chat /wallet)\n`);

  try {
    const { HARD_CAPS, HARD_FLOORS } = require('./lib/hard-caps');
    console.log('[RISK] Effective hard caps:', JSON.stringify(HARD_CAPS));
    console.log('[RISK] Floors:', JSON.stringify(HARD_FLOORS));
    console.log('[RISK] Sticky CB: daily clears on new day; drawdown needs operator resume');
  } catch { /* ignore */ }

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
}

/**
 * Avvia il server HTTP.
 * Default: 127.0.0.1 + tentativo ::1 (fix Windows: localhost → IPv6).
 * Override: HOST=0.0.0.0 per LAN.
 */
function startHttpServer() {
  const hosts = process.env.HOST
    ? [process.env.HOST]
    : ['127.0.0.1', '::1'];

  let readyLogged = false;
  let ok = 0;

  for (const host of hosts) {
    const server = app.listen(PORT, host, () => {
      ok += 1;
      if (!readyLogged) {
        readyLogged = true;
        onServerReady(host);
      } else {
        console.log(`[HTTP] anche in ascolto su [${host}]:${PORT}`);
      }
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        if (host === hosts[0]) {
          console.error(`\n[FATAL] Porta ${PORT} già in uso su ${host}.`);
          console.error(`  Chiudi l'altro processo o usa:  set PORT=40002 && node index.js\n`);
          process.exit(1);
        }
        // ::1 già coperta o non disponibile — ok
        return;
      }
      if (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL') {
        return; // IPv6 non supportato
      }
      console.error(`[HTTP] Errore listen ${host}:`, err.message);
    });
  }
}

startHttpServer();
