// Handler: pause, resume, kill, interval, configure, resetRisk
// EXTRACTED FROM index.js:480-500, 540-560

const { saveStrategy } = require('../../state/strategy');
const { unblockRiskBaseline, executeMarketSell, resumeTradingAfterEngineClose, notifyOwner } = require('../../trading/orders');
const { getPositionSize } = require('../../trading/positions');
const { riskManager, saveRiskState } = require('../../state/risk');
const shared = require('../../state/shared');

// forward declarations risolte da index.js wiring
let _restartLoop = null;
let _runTick = null;
function setControlFns(restartLoop, runTick) { _restartLoop = restartLoop; _runTick = runTick; }

function handlePause() {
  shared.strategy.active = false;
  saveStrategy();
  return `⏸ Trading in pausa. Nessun ordine automatico finché non scrivi *resume*.`;
}

async function handleResume() {
  // Operator explicit: force clear sticky daily/drawdown CB
  await unblockRiskBaseline({ forceClearSticky: true });
  shared.strategy.active = true;
  saveStrategy();
  if (_restartLoop) _restartLoop();
  if (_runTick) setTimeout(_runTick, 1000);
  const label = shared.strategy.mode === 'pro' ? 'PRO' : 'autonomo';
  return `▶️ *Trading ${label} ripreso!*\nCB sticky azzerato da operatore.\nAnalisi ogni ${shared.strategy.checkIntervalSeconds}s · score min ${shared.strategy.minConfidenceScore ?? 65}`;
}

async function handleKill() {
  shared.strategy.active = false;
  saveStrategy();
  const pos = await getPositionSize(shared.strategy.pair);
  if (Math.abs(pos) > 1e-9) {
    const res = await executeMarketSell(shared.strategy.pair, 1);
    if (res.ok) {
      shared.riskState = riskManager.resetCircuitBreaker(shared.riskState, { force: true });
      saveRiskState(shared.riskState);
      return `🛑 *KILL SWITCH* — trading fermato e posizione chiusa.\nVenduti ${res.trade.amount.toFixed(6)} ${shared.strategy.pair} @ ${res.trade.price.toFixed(2)}`;
    }
    return `🛑 Trading fermato. Errore chiusura: ${res.error}`;
  }
  shared.riskState = riskManager.resetCircuitBreaker(shared.riskState, { force: true });
  saveRiskState(shared.riskState);
  return '🛑 *KILL SWITCH* — trading fermato. Nessuna posizione aperta.';
}

function handleInterval(cmd) {
  shared.strategy.intervalMinutes = cmd.minutes;
  saveStrategy();
  if (_restartLoop) _restartLoop();
  const label = cmd.minutes >= 60 ? `${cmd.minutes / 60} ore` : `${cmd.minutes} minuti`;
  return `⏱ Intervallo minimo tra trade: ${label}.`;
}

function handleConfigure() {
  const isPro = shared.strategy.mode === 'pro';
  return `⚙️ *Strategia ${isPro ? 'PRO' : 'autonoma'}*\n\n` +
    (isPro
      ? `Multi-TF · RSI+MACD+Stoch+Bollinger · Volume · Funding\n` +
        `Score dinamico ~${shared.strategy.minConfidenceScore} · Scale-in · ATR stops\n` +
        `Rischio ${shared.strategy.riskPerTradePercent}%/trade · -${shared.strategy.maxDailyLossPercent}%/giorno`
      : `RSI + SL/TP · RSI ${shared.strategy.rsiOversold}/${shared.strategy.rsiOverbought}`) +
    `\n• \`analisi\` · \`scanner\` · \`performance\` · \`rischio\`\n` +
    `• \`pausa\` / \`resume\` · \`ferma tutto\``;
}

async function handleResetRisk() {
  await unblockRiskBaseline({ forceClearSticky: true });
  if (!shared.strategy.active) {
    shared.strategy.active = true;
    saveStrategy();
    if (_restartLoop) _restartLoop();
    if (_runTick) setTimeout(_runTick, 1000);
  }
  return '✅ Risk manager resettato da operatore (sticky CB cleared, baseline aggiornata). Trading ripreso.';
}

module.exports = { handlePause, handleResume, handleKill, handleInterval, handleConfigure, handleResetRisk, setControlFns };
