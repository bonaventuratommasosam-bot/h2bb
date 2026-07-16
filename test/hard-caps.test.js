const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { applyHardCaps, HARD_CAPS, clampRiskAdjustment } = require('../lib/hard-caps');
const { sanitizeStrategy } = require('../lib/sanitize-strategy');

describe('hard-caps', () => {
  it('clamps risk and position above ceiling', () => {
    const s = applyHardCaps({
      riskPerTradePercent: 5,
      maxPositionPercent: 90,
      maxDailyLossPercent: 10,
      maxDrawdownPercent: 25,
      consecutiveLossLimit: 10,
    });
    assert.equal(s.riskPerTradePercent, HARD_CAPS.riskPerTradePercent);
    assert.equal(s.maxPositionPercent, HARD_CAPS.maxPositionPercent);
    assert.equal(s.maxDailyLossPercent, HARD_CAPS.maxDailyLossPercent);
    assert.equal(s.maxDrawdownPercent, HARD_CAPS.maxDrawdownPercent);
    assert.equal(s.consecutiveLossLimit, HARD_CAPS.consecutiveLossLimit);
  });

  it('sanitizeStrategy applies hard caps', () => {
    const s = sanitizeStrategy({
      riskPerTradePercent: 4,
      maxPositionPercent: 100,
      minConfidenceScore: 40,
    });
    assert.ok(s.riskPerTradePercent <= HARD_CAPS.riskPerTradePercent);
    assert.ok(s.maxPositionPercent <= HARD_CAPS.maxPositionPercent);
    assert.ok(s.minConfidenceScore >= HARD_CAPS.minConfidenceScoreMin);
  });

  it('clampRiskAdjustment stays in band', () => {
    const c = clampRiskAdjustment({ risk: 9, pos: 200, lossLimit: 99 });
    assert.equal(c.risk, HARD_CAPS.riskPerTradePercent);
    assert.equal(c.pos, HARD_CAPS.maxPositionPercent);
    assert.equal(c.lossLimit, HARD_CAPS.consecutiveLossLimit);
  });
});
