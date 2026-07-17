const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildTrustReport } = require('../lib/trust-report');

describe('trust-report', () => {
  const base = {
    dataMode: 'live',
    readOnly: true,
    showcase: true,
    price: 1800,
    priceSource: 'hyperliquid-allMids',
    portfolioOk: true,
    equityCheck: { expected: 35.87, actual: 35.87, delta: 0, ok: true },
    decisionAgeSec: 5,
    signalLive: {
      action: 'blocked',
      reasonCode: 'blocked_macro_bearish',
      reason: 'macro bearish forte',
      score: 0,
      minScore: 75,
      at: new Date().toISOString(),
    },
    position: { side: 'flat', size: 0, entryPx: null, markPx: 1800 },
    engine: { active: true, operational: true, circuitBreaker: false, riskBlocked: false },
    risk: { circuitBreaker: false },
    sources: { price: 'hyperliquid-allMids', portfolio: 'hyperliquid-api' },
    hardCaps: { maxDailyLossPercent: 2, maxDrawdownPercent: 8, consecutiveLossLimit: 1 },
    hardFloors: { riskPerTradePercent: 0.1 },
  };

  it('verified flat with macro block explains why', () => {
    const t = buildTrustReport(base);
    assert.equal(t.status, 'verified');
    assert.ok(t.score >= 85);
    assert.equal(t.posture, 'flat');
    assert.match(t.whyFlat || '', /blocked|bearish|Flat/i);
    assert.ok(t.checks.some((c) => c.id === 'equity' && c.status === 'pass'));
    assert.ok(t.checks.some((c) => c.id === 'readonly' && c.status === 'pass'));
  });

  it('equity mismatch lowers trust', () => {
    const t = buildTrustReport({
      ...base,
      equityCheck: { expected: 40, actual: 35, delta: -5, ok: false },
    });
    assert.equal(t.status, 'untrusted');
    assert.ok(t.score < 70);
    assert.ok(t.checks.some((c) => c.id === 'equity' && c.status === 'fail'));
  });

  it('stale signal warns', () => {
    const old = new Date(Date.now() - 250_000).toISOString();
    const t = buildTrustReport({
      ...base,
      signalLive: { ...base.signalLive, at: old },
    });
    const fresh = t.checks.find((c) => c.id === 'signal_fresh');
    assert.equal(fresh.status, 'fail');
    assert.ok(t.score < 100);
  });

  it('circuit breaker is warn not fail', () => {
    const t = buildTrustReport({
      ...base,
      risk: { circuitBreaker: true, circuitReason: 'daily loss', stickyKind: 'daily' },
      engine: { ...base.engine, circuitBreaker: true },
    });
    assert.equal(t.posture, 'risk_halt');
    const risk = t.checks.find((c) => c.id === 'risk_caps');
    assert.equal(risk.status, 'warn');
    assert.notEqual(t.status, 'untrusted');
  });
});
