// Indicatori tecnici — EMA, RSI, MACD, ATR, Bollinger, ADX

function emaSeries(values, period) {
  if (!values || values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function ema(values, period) {
  const s = emaSeries(values, period);
  return s.length ? s[s.length - 1] : null;
}

function sma(values, period) {
  if (!values || values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function rsi(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function rsiPrev(closes, period = 14) {
  if (!closes || closes.length < period + 2) return null;
  return rsi(closes.slice(0, -1), period);
}

function macd(closes, fast = 12, slow = 26, signal = 9) {
  if (!closes || closes.length < slow + signal) return null;
  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);
  const macdLine = [];
  for (let i = 0; i < closes.length; i += 1) {
    if (fastEma[i] != null && slowEma[i] != null) macdLine[i] = fastEma[i] - slowEma[i];
  }
  const validMacd = macdLine.filter((v) => v != null);
  if (validMacd.length < signal) return null;
  const signalSeries = emaSeries(validMacd, signal);
  const lastMacd = validMacd[validMacd.length - 1];
  const prevMacd = validMacd[validMacd.length - 2];
  const lastSignal = signalSeries[signalSeries.length - 1];
  const prevSignal = signalSeries[signalSeries.length - 2];
  const histogram = lastMacd - lastSignal;
  const prevHistogram = prevMacd - prevSignal;
  return { macd: lastMacd, signal: lastSignal, histogram, prevHistogram };
}

function atr(highs, lows, closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < closes.length; i += 1) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trs.push(tr);
  }
  if (trs.length < period) return null;
  let val = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i += 1) {
    val = (val * (period - 1) + trs[i]) / period;
  }
  return val;
}

function bollinger(closes, period = 20, stdDev = 2) {
  if (!closes || closes.length < period) return null;
  const mid = sma(closes, period);
  const slice = closes.slice(-period);
  const variance = slice.reduce((s, v) => s + (v - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mid + stdDev * sd, mid, lower: mid - stdDev * sd, bandwidth: (2 * stdDev * sd) / mid };
}

function adx(highs, lows, closes, period = 14) {
  if (!closes || closes.length < period * 2) return null;
  const plusDM = [];
  const minusDM = [];
  const tr = [];
  for (let i = 1; i < closes.length; i += 1) {
    const up = highs[i] - highs[i - 1];
    const down = lows[i - 1] - lows[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const smooth = (arr, p) => {
    let s = arr.slice(0, p).reduce((a, b) => a + b, 0);
    const out = [s];
    for (let i = p; i < arr.length; i += 1) {
      s = s - s / p + arr[i];
      out.push(s);
    }
    return out;
  };
  const trS = smooth(tr, period);
  const plusS = smooth(plusDM, period);
  const minusS = smooth(minusDM, period);
  const dx = [];
  for (let i = 0; i < trS.length; i += 1) {
    const pdi = trS[i] ? (100 * plusS[i]) / trS[i] : 0;
    const mdi = trS[i] ? (100 * minusS[i]) / trS[i] : 0;
    const sum = pdi + mdi;
    dx.push(sum ? (100 * Math.abs(pdi - mdi)) / sum : 0);
  }
  if (dx.length < period) return null;
  return dx.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function pctBB(price, bands) {
  if (!bands || bands.upper === bands.lower) return 0.5;
  return (price - bands.lower) / (bands.upper - bands.lower);
}

function stochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
  if (!closes || closes.length < kPeriod) return null;
  const kValues = [];
  for (let i = kPeriod - 1; i < closes.length; i += 1) {
    const h = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const l = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    const k = h === l ? 50 : ((closes[i] - l) / (h - l)) * 100;
    kValues.push(k);
  }
  if (kValues.length < dPeriod) return null;
  const k = kValues[kValues.length - 1];
  const d = kValues.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod;
  const prevK = kValues.length > 1 ? kValues[kValues.length - 2] : k;
  return { k, d, prevK, rising: k > prevK };
}

function volumeRatio(volumes, period = 20) {
  if (!volumes || volumes.length < period + 1) return null;
  const current = volumes[volumes.length - 1];
  const avg = volumes.slice(-period - 1, -1).reduce((a, b) => a + b, 0) / period;
  return avg > 0 ? current / avg : 1;
}

function detectRegime(adx, bbBandwidth) {
  if (adx != null && adx > 25) return 'trending';
  if (bbBandwidth != null && bbBandwidth < 0.04) return 'ranging';
  if (adx != null && adx < 18) return 'ranging';
  return 'mixed';
}

/**
 * Dynamic entry threshold. floor defaults 55 (balanced); pass lower floor for super_degen.
 * @param {number} baseScore
 * @param {string} regime
 * @param {string} macroTrend
 * @param {{ floor?: number, ceil?: number, rangingBoost?: number }} [opts]
 */
function dynamicMinScore(baseScore, regime, macroTrend, opts = {}) {
  let adj = baseScore;
  const rangingBoost = opts.rangingBoost != null ? opts.rangingBoost : 5;
  if (regime === 'trending' && macroTrend === 'bullish') adj -= 3;
  if (regime === 'ranging') adj += rangingBoost;
  if (regime === 'mixed') adj += 2;
  const floor = opts.floor != null ? opts.floor : 55;
  const ceil = opts.ceil != null ? opts.ceil : 80;
  return Math.max(floor, Math.min(ceil, adj));
}

module.exports = {
  ema, emaSeries, sma, rsi, rsiPrev, macd, atr, bollinger, adx, pctBB,
  stochastic, volumeRatio, detectRegime, dynamicMinScore,
};