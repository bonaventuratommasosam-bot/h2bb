// Routes: /configure, /pause, /resume
// EXTRACTED FROM index.js:920-960

const express = require('express');
const { saveStrategy } = require('../../state/strategy');
const { unblockRiskBaseline } = require('../../trading/orders');
const shared = require('../../state/shared');

let _restartLoop = null;
let _runTick = null;
function setConfigureFns(restartLoop, runTick) { _restartLoop = restartLoop; _runTick = runTick; }

const router = express.Router();

const ALLOWED_KEYS = [
  'pair', 'mode', 'amountPerTrade', 'intervalMinutes', 'maxSlippage',
  'stopLoss', 'takeProfit', 'stopLossPercent', 'takeProfitPercent',
  'rsiOversold', 'rsiOverbought', 'tradePercent', 'checkIntervalSeconds', 'active',
  'riskPerTradePercent', 'maxPositionPercent', 'maxDailyLossPercent', 'maxDrawdownPercent',
  'consecutiveLossLimit', 'lossCooldownMinutes', 'minConfidenceScore',
  'atrStopMultiplier', 'atrTrailMultiplier', 'atrTp1Multiplier', 'atrTp2Multiplier',
  'partialTakeProfitPercent', 'timeframes', 'scaleInEnabled',
  'maxFundingRate', 'minVolumeRatio', 'watchlist',
];

router.post('/configure', (req, res) => {
  try {
    let changed = [];
    for (const key of ALLOWED_KEYS) {
      if (req.body[key] !== undefined) { shared.strategy[key] = req.body[key]; changed.push(key); }
    }
    saveStrategy();
    if (changed.some((k) => ['intervalMinutes', 'checkIntervalSeconds', 'active'].includes(k)) && _restartLoop) _restartLoop();
    res.json({ ok: true, changed, strategy: { pair: shared.strategy.pair, amountPerTrade: shared.strategy.amountPerTrade, intervalMinutes: shared.strategy.intervalMinutes, stopLoss: shared.strategy.stopLoss, takeProfit: shared.strategy.takeProfit, active: shared.strategy.active } });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/pause', (req, res) => {
  shared.strategy.active = false;
  saveStrategy();
  res.json({ ok: true, reply: 'Strategia in pausa.' });
});

router.post('/resume', async (req, res) => {
  try {
    await unblockRiskBaseline();
    shared.strategy.active = true;
    saveStrategy();
    if (_restartLoop) _restartLoop();
    if (_runTick) setTimeout(_runTick, 1000);
    res.json({ ok: true, reply: 'Trading autonomo ripreso.' });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

module.exports = { router, setConfigureFns };
