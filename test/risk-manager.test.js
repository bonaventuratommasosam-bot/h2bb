const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('risk-manager', () => {
  let tmpDir;
  let risk;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'h2bb-risk-'));
    process.env.DATA_DIR = tmpDir;
    // Re-require after DATA_DIR set — risk-manager binds DATA_DIR at load
    delete require.cache[require.resolve('../config/default')];
    delete require.cache[require.resolve('../risk-manager')];
    delete require.cache[require.resolve('../lib/hard-caps')];
    risk = require('../risk-manager');
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    delete process.env.DATA_DIR;
    delete require.cache[require.resolve('../config/default')];
    delete require.cache[require.resolve('../risk-manager')];
  });

  it('blocks when circuit breaker is on', () => {
    const strategy = { maxDailyLossPercent: 2, maxDrawdownPercent: 8 };
    const state = {
      dayKey: new Date().toISOString().slice(0, 10),
      dayStartEquity: 1000,
      dayPnl: 0,
      peakEquity: 1000,
      consecutiveLosses: 0,
      cooldownUntil: null,
      circuitBreaker: true,
      circuitReason: 'test',
    };
    const r = risk.checkCanTrade(strategy, state, 1000);
    assert.equal(r.allowed, false);
    assert.ok(r.reasons[0].includes('circuit') || r.reasons[0].includes('test'));
  });

  it('trips circuit on daily loss over hard cap', () => {
    const strategy = { maxDailyLossPercent: 2, maxDrawdownPercent: 8 };
    const state = {
      dayKey: new Date().toISOString().slice(0, 10),
      dayStartEquity: 1000,
      dayPnl: 0,
      peakEquity: 1000,
      consecutiveLosses: 0,
      cooldownUntil: null,
      circuitBreaker: false,
      circuitReason: null,
    };
    const r = risk.checkCanTrade(strategy, state, 970); // -3%
    assert.equal(r.allowed, false);
    assert.equal(r.state.circuitBreaker, true);
    assert.match(r.state.circuitReason, /giornalier/i);
  });

  it('computePositionSize respects hard cap on position', () => {
    const strategy = {
      riskPerTradePercent: 0.5,
      maxPositionPercent: 90, // request above hard cap
      atrStopMultiplier: 2,
    };
    const size = risk.computePositionSize({
      equity: 1000,
      price: 2000,
      atr: 20,
      strategy,
    });
    // max 25% of equity = $250
    assert.ok(size.usd <= 250.01, `usd ${size.usd} should be <= 250`);
  });

  it('recordTradeResult sets cooldown after consecutive losses', () => {
    const strategy = { consecutiveLossLimit: 3, lossCooldownMinutes: 60 };
    let state = {
      dayKey: null,
      dayStartEquity: null,
      dayPnl: 0,
      peakEquity: null,
      consecutiveLosses: 2,
      cooldownUntil: null,
      circuitBreaker: false,
      circuitReason: null,
    };
    state = risk.recordTradeResult(state, -1, strategy);
    assert.ok(state.cooldownUntil > Date.now());
    assert.equal(state.consecutiveLosses, 0);
  });
});
