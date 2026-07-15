// Loop autonomo + proactive loop
// EXTRACTED FROM index.js:700-720, 760-770

const { PROACTIVE_INTERVAL_MS } = require('../config/default');
const shared = require('../state/shared');

let _runTick = null;
let _runProactive = null;

function setLoopFns(runTick, runProactive) { _runTick = runTick; _runProactive = runProactive; }

function restartAutonomousLoop() {
  if (shared.autonomousTimer) clearInterval(shared.autonomousTimer);
  const sec = shared.strategy.checkIntervalSeconds || 45;
  shared.autonomousTimer = setInterval(_runTick, sec * 1000);
  const label = shared.strategy.mode === 'pro' ? 'PRO' : 'AUTO';
  console.log(`[${label}] Loop avviato: ogni ${sec}s · score min ${shared.strategy.minConfidenceScore ?? 65}`);
}

function startProactiveLoop() {
  if (shared.proactiveTimer) clearInterval(shared.proactiveTimer);
  shared.proactiveTimer = setInterval(_runProactive, PROACTIVE_INTERVAL_MS);
  setTimeout(_runProactive, 15000);
  console.log(`[PROACTIVE] Loop avviato: ogni ${PROACTIVE_INTERVAL_MS / 60_000} min`);
}

module.exports = { setLoopFns, restartAutonomousLoop, startProactiveLoop };
