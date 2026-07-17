const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isDegenMode,
  getAiEnterMinConfidence,
  getAiScoreBand,
  applyAiModeProfile,
  normalizeAiMode,
} = require('../lib/ai-mode');
const { clampAiMinScore } = require('../lib/ai-autonomy');
const { scoreEntry } = require('../pro-engine');

describe('ai-mode degen', () => {
  it('normalizes degen aliases', () => {
    assert.equal(normalizeAiMode({ aiMode: 'degen' }), 'degen');
    assert.equal(normalizeAiMode({ aiMode: 'aggressive' }), 'degen');
    assert.equal(isDegenMode({ aiMode: 'balanced' }), false);
  });

  it('degen enter conf is lower than balanced', () => {
    assert.ok(getAiEnterMinConfidence({ aiMode: 'degen' }) < getAiEnterMinConfidence({ aiMode: 'balanced' }));
  });

  it('degen score band is wider', () => {
    const d = getAiScoreBand({ aiMode: 'degen' });
    const b = getAiScoreBand({ aiMode: 'balanced' });
    assert.ok(d.drop > b.drop);
    assert.ok(d.lift >= b.lift);
  });

  it('applyAiModeProfile upgrades conservative params', () => {
    const s = applyAiModeProfile({
      aiMode: 'degen',
      minConfidenceScore: 70,
      operatorMinConfidenceScore: 70,
      riskPerTradePercent: 0.1,
      maxPositionPercent: 5,
      consecutiveLossLimit: 1,
      lossCooldownMinutes: 240,
    });
    assert.equal(s.aiMode, 'degen');
    assert.ok(s.minConfidenceScore <= 50);
    assert.ok(s.riskPerTradePercent >= 0.5);
    assert.ok(s.maxPositionPercent >= 15);
    assert.equal(s.softMacroBlock, true);
    assert.equal(s.degenTradeInBear, true);
  });

  it('clampAiMinScore allows deeper drop in degen', () => {
    const s = {
      aiMode: 'degen',
      minConfidenceScore: 50,
      operatorMinConfidenceScore: 50,
    };
    const low = clampAiMinScore(35, s);
    assert.ok(low <= 40, `expected low clamp around 35-40 got ${low}`);
  });

  it('soft macro does not hard-block scoreEntry', () => {
    const analysis = {
      macro: { ok: true, trend: 'bearish', adx: 40 },
      trend: { ok: true, trend: 'bullish', ema20: 2, ema50: 1, adx: 25 },
      entry: {
        ok: true,
        regime: 'trending',
        rsi: 32,
        rsiRising: true,
        stoch: { k: 20, rising: true },
        macd: { histogram: 0.1, prevHistogram: -0.1 },
        bb: { },
        bbPos: 0.1,
        volRatio: 1.5,
        atr: 10,
        price: 1800,
      },
      context: { funding: 0 },
    };
    const hard = scoreEntry(analysis, { minConfidenceScore: 50, aiMode: 'balanced' });
    assert.equal(hard.bias, 'blocked');
    assert.equal(hard.score, 0);

    const soft = scoreEntry(analysis, {
      minConfidenceScore: 50,
      aiMode: 'degen',
      softMacroBlock: true,
    });
    assert.notEqual(soft.bias, 'blocked');
    assert.ok(soft.score > 0, `soft score should be >0 got ${soft.score}`);
  });
});
