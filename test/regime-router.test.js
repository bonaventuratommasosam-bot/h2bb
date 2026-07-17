const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// Fresh module each time so routerState does not leak across tests
function loadRouter() {
  delete require.cache[require.resolve('../regime-router')];
  return require('../regime-router');
}

function sampleAnalysis(overrides = {}) {
  return {
    macro: { ok: true, trend: 'neutral' },
    trend: { ok: true, trend: 'neutral' },
    entry: {
      ok: true,
      price: 3000,
      adx: 20,
      atr: 10,
      volRatio: 1.0,
      regime: 'mixed',
      ...(overrides.entry || {}),
    },
    context: { funding: 0 },
    ...overrides,
  };
}

describe('regime-router', () => {
  it('shock cooldown returns include classification.regime', () => {
    const router = loadRouter();
    const shockAnalysis = sampleAnalysis({
      entry: { ok: true, price: 3000, adx: 20, atr: 10, volRatio: 7.2, regime: 'mixed' },
    });
    const first = router.route(shockAnalysis, {});
    assert.equal(first.classification.regime, 'shock');
    assert.equal(first.flat, true);

    // Second tick while cooldown active — previously omitted classification → crash
    const second = router.route(sampleAnalysis(), {});
    assert.ok(second.classification, 'classification must be present on cooldown path');
    assert.equal(typeof second.classification.regime, 'string');
    assert.ok(second.classification.regime.length > 0);
    assert.equal(second.flat, true);
    assert.match(String(second.flatReason || ''), /Cooldown shock/i);
  });

  it('mixed market returns trade mode with classification', () => {
    const router = loadRouter();
    const d = router.route(sampleAnalysis(), {});
    assert.ok(d.classification?.regime);
    assert.equal(d.flat, false);
  });
});
