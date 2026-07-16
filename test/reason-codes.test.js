const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { REASON, inferReasonCode, formatDecisionLine } = require('../lib/reason-codes');

describe('reason-codes', () => {
  it('infers daily loss from risk reasons', () => {
    const code = inferReasonCode({
      action: 'blocked',
      reason: 'x',
      riskReasons: ['perdita giornaliera -2.1% (limite -2%)'],
    });
    assert.equal(code, REASON.RISK_DAILY_LOSS);
  });

  it('infers buy confluence', () => {
    assert.equal(
      inferReasonCode({ action: 'buy', reason: 'confluenza 70/65' }),
      REASON.BUY_CONFLUENCE
    );
  });

  it('formats decision line', () => {
    const line = formatDecisionLine({
      reasonCode: REASON.SCORE_BELOW,
      action: 'hold',
      reason: 'score 40/65',
      score: 40,
      minScore: 65,
      at: '2026-01-01T00:00:00.000Z',
    });
    assert.match(line, /score_below_threshold/);
    assert.match(line, /hold/);
  });
});
