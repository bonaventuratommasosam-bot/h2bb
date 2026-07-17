const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computePositionRoom, computeExitLevels } = require('../lib/position-room');

describe('position-room', () => {
  it('levered room allows scale-in after small BTC long', () => {
    // equity $35, maxPos 25% (hard-cap default), lev 20 → max notional $175
    // current 0.00087 BTC @ 64000 ≈ $55.7 → room ~$119 (can add)
    // (vs old formula equity*maxPos = $8.75 room which blocked wrongly)
    const r = computePositionRoom({
      equity: 35,
      price: 64000,
      positionSize: 0.00087,
      strategy: { maxPositionPercent: 25, defaultLeverage: 20 },
    });
    assert.ok(r.maxNotionalUsd >= 170, `maxNotional ${r.maxNotionalUsd}`);
    assert.ok(r.currentNotionalUsd > 50 && r.currentNotionalUsd < 60);
    assert.ok(r.roomNotionalUsd > 100, `room ${r.roomNotionalUsd}`);
    assert.equal(r.canAdd, true);
  });

  it('unlevered-style small max blocks large notional', () => {
    const r = computePositionRoom({
      equity: 35,
      price: 64000,
      positionSize: 0.00087,
      strategy: { maxPositionPercent: 5, defaultLeverage: 1 },
    });
    assert.ok(r.roomNotionalUsd < 11 || r.canAdd === false);
  });

  it('exit levels for long stop below entry', () => {
    const lv = computeExitLevels({
      entryPrice: 64000,
      price: 63900,
      atr: 500,
      strategy: { atrStopMultiplier: 2, atrTp1Multiplier: 1.5, atrTp2Multiplier: 3 },
      positionSign: 1,
    });
    assert.equal(lv.ok, true);
    assert.ok(lv.stopPx < 64000);
    assert.ok(lv.tp1Px > 64000);
    assert.ok(lv.movePct < 0);
  });
});
