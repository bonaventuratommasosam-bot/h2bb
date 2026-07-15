// Test rapido runShadowTick senza ordini reali
process.env.DATA_DIR = __dirname;
const { runShadowTick, loadState } = require('./shadow-engine');

const mockStrategy = {
  pair: 'ETH',
  mode: 'pro',
  active: true,
  minConfidenceScore: 52,
  atrStopMultiplier: 2,
  atrTp1Multiplier: 2,
  atrTp2Multiplier: 3,
  atrTrailMultiplier: 1,
  intervalMinutes: 30,
  minVolumeRatio: 0.8,
  maxFundingRate: 0.00005,
  scaleInEnabled: false,
  partialTakeProfitPercent: 50,
  maxPositionPercent: 90,
  cashReservePercent: 8,
};

const analysis = {
  macro: { ok: true, trend: 'bullish', adx: 20, regime: 'trending' },
  trend: { ok: true, trend: 'bullish', ema20: 100, ema50: 99, adx: 25, regime: 'trending' },
  entry: {
    ok: true, price: 2500, rsi: 38, rsiRising: true, regime: 'mixed',
    volRatio: 1.2, adx: 22,
    macd: { histogram: 1, prevHistogram: -0.5 },
    stoch: { k: 25, d: 20, rising: true },
    bb: { upper: 2600, lower: 2400 }, bbPos: 0.2,
    atr: 50,
  },
  context: { funding: 0.00001, openInterest: 100000 },
};

const ctx = {
  strategy: mockStrategy,
  balance: { amount: 38 },
  getPrice: async () => 2500,
  getEquity: async () => 38,
};

runShadowTick(ctx, { analysis, signal: { action: 'hold' } }, 2500)
  .then((r) => {
    console.log('shadow tick:', JSON.stringify(r));
    console.log('state keys:', Object.keys(loadState()));
    process.exit(0);
  })
  .catch((e) => {
    console.error('FAIL', e);
    process.exit(1);
  });