/**
 * Position room / max exposure for leveraged perps.
 *
 * maxPositionPercent is treated as max **margin** vs equity.
 * Max notional ≈ equity × maxPos% × leverage.
 * (Previously we compared notional to equity×maxPos% — with 20x that
 * wrongly reported "full" after a tiny BTC long.)
 */

const { HARD_CAPS } = require('./hard-caps');

function resolveLeverage(strategy = {}, explicit = null) {
  const n = Number(explicit);
  if (Number.isFinite(n) && n > 0) return n;
  const s = Number(strategy.leverage ?? strategy.defaultLeverage);
  if (Number.isFinite(s) && s > 0) return s;
  const env = parseFloat(process.env.DEFAULT_LEVERAGE || '20');
  return Number.isFinite(env) && env > 0 ? env : 20;
}

/**
 * @param {object} opts
 * @param {number} opts.equity
 * @param {number} opts.price
 * @param {number} [opts.positionSize] signed or abs coin size
 * @param {object} [opts.strategy]
 * @param {number} [opts.leverage]
 */
function computePositionRoom({
  equity,
  price,
  positionSize = 0,
  strategy = {},
  leverage = null,
} = {}) {
  const eq = Number(equity) || 0;
  const px = Number(price) || 0;
  const size = Math.abs(Number(positionSize) || 0);
  const lev = resolveLeverage(strategy, leverage);
  const maxPosPct = Math.min(
    Number(strategy.maxPositionPercent) || 20,
    HARD_CAPS.maxPositionPercent || 100
  ) / 100;

  const maxMarginUsd = eq * maxPosPct;
  const maxNotionalUsd = maxMarginUsd * lev;
  const currentNotionalUsd = size > 0 && px > 0 ? size * px : 0;
  const currentMarginUsd = lev > 0 ? currentNotionalUsd / lev : currentNotionalUsd;
  const roomNotionalUsd = Math.max(0, maxNotionalUsd - currentNotionalUsd);
  const roomMarginUsd = Math.max(0, maxMarginUsd - currentMarginUsd);

  return {
    leverage: lev,
    maxPosPct: maxPosPct * 100,
    maxMarginUsd: round2(maxMarginUsd),
    maxNotionalUsd: round2(maxNotionalUsd),
    currentNotionalUsd: round2(currentNotionalUsd),
    currentMarginUsd: round2(currentMarginUsd),
    roomNotionalUsd: round2(roomNotionalUsd),
    roomMarginUsd: round2(roomMarginUsd),
    canAdd: roomNotionalUsd >= (parseFloat(process.env.MIN_NOTIONAL_USD) || 11),
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Exit levels preview for logging / AI context (ATR-based).
 */
function computeExitLevels({
  entryPrice,
  price,
  atr,
  strategy = {},
  positionSign = 1,
} = {}) {
  const ep = Number(entryPrice) || 0;
  const px = Number(price) || 0;
  const a = Number(atr) > 0 ? Number(atr) : (ep > 0 ? ep * 0.02 : 0);
  if (!ep || !a) {
    return { ok: false, movePct: null, stopPx: null, tp1Px: null, tp2Px: null };
  }
  const long = positionSign >= 0;
  const slMult = strategy.atrStopMultiplier ?? 2;
  const tp1Mult = strategy.atrTp1Multiplier ?? 2;
  const tp2Mult = strategy.atrTp2Multiplier ?? 3;
  const stopDist = a * slMult;
  const move = long
    ? ((px - ep) / ep) * 100
    : ((ep - px) / ep) * 100;
  const stopPx = long ? ep - stopDist : ep + stopDist;
  const tp1Px = long ? ep + a * tp1Mult : ep - a * tp1Mult;
  const tp2Px = long ? ep + a * tp2Mult : ep - a * tp2Mult;
  const stopPct = (stopDist / ep) * 100;
  return {
    ok: true,
    movePct: Math.round(move * 100) / 100,
    stopPct: Math.round(stopPct * 100) / 100,
    stopPx: Math.round(stopPx * 100) / 100,
    tp1Px: Math.round(tp1Px * 100) / 100,
    tp2Px: Math.round(tp2Px * 100) / 100,
    trailingPeak: strategy.trailingPeak ?? null,
  };
}

module.exports = {
  resolveLeverage,
  computePositionRoom,
  computeExitLevels,
};
