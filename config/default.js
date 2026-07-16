// Configurazione centralizzata — strategia default + costanti
// EXTRACTED FROM index.js:30-60 (DEFAULT_STRATEGY)

const path = require('path');

// Root del repo (parent di config/), non la cartella config/
const PROJECT_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || PROJECT_ROOT);
const STRATEGY_FILE = path.join(DATA_DIR, 'strategy.json');
const TRADES_FILE   = path.join(DATA_DIR, 'trades.jsonl');
const BALANCE_FILE  = path.join(DATA_DIR, 'balance.json');

const HL_API_HOST = 'api.hyperliquid.xyz';
const HL_TIMEOUT_MS = parseInt(process.env.HL_TIMEOUT_MS, 10) || 10000;
const MIN_NOTIONAL_USD = parseFloat(process.env.MIN_NOTIONAL_USD) || 10;
const PORT = parseInt(process.env.PORT, 10) || 40001;
const PROACTIVE_INTERVAL_MS = (parseInt(process.env.PROACTIVE_CHECK_MINUTES, 10) || 20) * 60_000;

const DEFAULT_STRATEGY = {
  pair: 'ETH',
  mode: 'pro',
  amountPerTrade: 0.001,
  intervalMinutes: 30,
  maxSlippage: 1.5,
  stopLoss: null,
  takeProfit: null,
  stopLossPercent: 3,
  takeProfitPercent: 5,
  rsiPeriod: 14,
  rsiOversold: 35,
  rsiOverbought: 65,
  tradePercent: 1,
  checkIntervalSeconds: 45,
  candleInterval: '15m',
  timeframes: { macro: '4h', trend: '1h', entry: '15m' },
  riskPerTradePercent: 0.5,
  maxPositionPercent: 20,
  maxDailyLossPercent: 2,
  maxDrawdownPercent: 8,
  consecutiveLossLimit: 3,
  lossCooldownMinutes: 240,
  minConfidenceScore: 65,
  atrStopMultiplier: 2,
  atrTrailMultiplier: 1,
  atrTp1Multiplier: 2,
  atrTp2Multiplier: 3,
  partialTakeProfitPercent: 50,
  scaleInEnabled: true,
  maxFundingRate: 0.00005,
  minVolumeRatio: 1.1,
  watchlist: ['ETH', 'BTC', 'SOL'],
  scannerEnabled: false,
  aiSignalEnabled: false,
  active: false,
  lastTradeAt: null,
  lastSignal: null,
  lastDecision: null,
  trailingPeak: null,
  tp1Taken: false,
  scaleInPending: false,
  positionLeg: null,
  createdAt: null,
  updatedAt: null,
};

const DEFAULT_BALANCE = {
  asset: 'USDC',
  amount: 1000,
  lastUpdated: null,
};

module.exports = {
  PROJECT_ROOT, DATA_DIR, STRATEGY_FILE, TRADES_FILE, BALANCE_FILE,
  HL_API_HOST, HL_TIMEOUT_MS, MIN_NOTIONAL_USD, PORT, PROACTIVE_INTERVAL_MS,
  DEFAULT_STRATEGY, DEFAULT_BALANCE,
};
