const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { scoreEntry } = require('../pro-engine');
const { REASON } = require('../lib/reason-codes');

function baseAnalysis(overrides = {}) {
  return {
    macro: {
      ok: true,
      trend: 'bullish',
      adx: 20,
      ...overrides.macro,
    },
    trend: {
      ok: true,
      trend: 'bullish',
      ema20: 110,
      ema50: 100,
      adx: 25,
      ...overrides.trend,
    },
    entry: {
      ok: true,
      price: 100,
      rsi: 35,
      rsiRising: true,
      stoch: { k: 20, rising: true },
      macd: { histogram: 0.1, prevHistogram: -0.1 },
      bb: { bandwidth: 0.05 },
      bbPos: 0.2,
      adx: 20,
      volRatio: 1.5,
      regime: 'trending',
      atr: 2,
      ...overrides.entry,
    },
    context: {
      funding: 0,
      ...overrides.context,
    },
  };
}

describe('scoreEntry', () => {
  it('blocks on strong macro bearish', () => {
    const r = scoreEntry(baseAnalysis({
      macro: { ok: true, trend: 'bearish', adx: 30 },
    }), { minConfidenceScore: 65 });
    assert.equal(r.bias, 'blocked');
    assert.equal(r.reasonCode, REASON.BLOCKED_MACRO_BEAR);
    assert.equal(r.score, 0);
  });

  it('blocks on high funding', () => {
    const r = scoreEntry(baseAnalysis({
      context: { funding: 0.001 },
    }), { minConfidenceScore: 65, maxFundingRate: 0.00005 });
    assert.equal(r.bias, 'blocked');
    assert.equal(r.reasonCode, REASON.BLOCKED_FUNDING);
  });

  it('scores long confluence above threshold', () => {
    const r = scoreEntry(baseAnalysis(), { minConfidenceScore: 50 });
    assert.ok(r.score > 0);
    assert.ok(['long', 'watch', 'wait'].includes(r.bias));
  });

  it('returns none when entry not ok', () => {
    const r = scoreEntry({
      macro: { ok: false },
      trend: { ok: false },
      entry: { ok: false },
      context: {},
    }, {});
    assert.equal(r.score, 0);
    assert.equal(r.bias, 'none');
  });
});
