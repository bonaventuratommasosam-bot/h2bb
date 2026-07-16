// Motore PRO v2 — regime, volume, funding, scale-in, soglia dinamica
// Loop 1 (Performance Feedback) e Loop 2 (Trade Verification) integrati
const market = require('./market-data');
const ind = require('./indicators');
const risk = require('./risk-manager');
const aiSignal = require('./ai-signal');
const scanner = require('./scanner');
const feedback = require('./performance-feedback');
const tradeVerifier = require('./trade-verifier');
const regimeRouter = require('./regime-router');
const metaController = require('./meta-controller');
const eventLog = require('./event-log');
const { REASON, inferReasonCode } = require('./lib/reason-codes');
const { MIN_NOTIONAL_USD } = require('./config/default');

function recordDecision(strategy, signal, extras = {}) {
  const reasonCode = signal.reasonCode
    || inferReasonCode({
      action: signal.action,
      reason: signal.reason,
      bias: signal.bias,
      riskReasons: extras.riskReasons,
    });
  const decision = {
    action: signal.action,
    reason: signal.reason,
    reasonCode,
    score: signal.score ?? null,
    minScore: extras.minScore ?? null,
    pair: strategy.pair,
    regime: signal.regime || extras.regime || null,
    at: new Date().toISOString(),
  };
  signal.reasonCode = reasonCode;
  strategy.lastSignal = signal;
  strategy.lastDecision = decision;
  return decision;
}

// Stato tick per AI ricorrenti
const tickState = {
  count: 0,
  lastThresholdTick: 0,
  lastTpTick: 0,
  aiTp: null,
  // Loop 1: ultimo tick in cui abbiamo aggiornato il feedback
  lastFeedbackTick: 0,
};

// Helper: stima regime (usa entry.regime dall'analisi)
function guessRegime(entryAnalysis) {
  if (!entryAnalysis) return 'mixed';
  return entryAnalysis.regime || 'mixed';
}

// NOTE: pctMove e toTs sono duplicati in autonomous-engine.js.
// Nel refactor completo dovrebbero essere estratti in lib/math.js.
function toTs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  const p = Date.parse(v);
  return Number.isFinite(p) ? p : 0;
}

function pctMove(price, entry, isLong = true) {
  if (!entry || entry <= 0) return 0;
  return isLong ? ((price - entry) / entry) * 100 : ((entry - price) / entry) * 100;
}

function analyzeCandles(candles, label) {
  if (!candles || candles.length < 30) return { ok: false, label };
  const closes = candles.map((c) => c.c);
  const highs = candles.map((c) => c.h);
  const lows = candles.map((c) => c.l);
  const volumes = candles.map((c) => c.v);
  const price = closes[closes.length - 1];

  const ema20 = ind.ema(closes, 20);
  const ema50 = ind.ema(closes, 50);
  const ema200 = ind.ema(closes, 200);
  const rsiVal = ind.rsi(closes, 14);
  const rsiPrev = ind.rsiPrev(closes, 14);
  const macdVal = ind.macd(closes);
  const atrVal = ind.atr(highs, lows, closes, 14);
  const bb = ind.bollinger(closes, 20, 2);
  const adxVal = ind.adx(highs, lows, closes, 14);
  const bbPos = bb ? ind.pctBB(price, bb) : 0.5;
  const stoch = ind.stochastic(highs, lows, closes);
  const volRatio = ind.volumeRatio(volumes);
  const regime = ind.detectRegime(adxVal, bb?.bandwidth);

  let trend = 'neutral';
  if (ema50 && ema200) {
    if (price > ema50 && ema50 > ema200) trend = 'bullish';
    else if (price < ema50 && ema50 < ema200) trend = 'bearish';
  } else if (ema20 && price > ema20) trend = 'bullish';
  else if (ema20 && price < ema20) trend = 'bearish';

  return {
    ok: true,
    label,
    price,
    ema20,
    ema50,
    ema200,
    rsi: rsiVal,
    rsiRising: rsiVal != null && rsiPrev != null && rsiVal > rsiPrev,
    macd: macdVal,
    atr: atrVal,
    bb,
    bbPos,
    adx: adxVal,
    stoch,
    volRatio,
    regime,
    trend,
  };
}

async function analyzeMarket(pair, strategy) {
  const tf = strategy.timeframes || { macro: '4h', trend: '1h', entry: '15m' };
  const [data, ctx] = await Promise.all([
    market.fetchMultiTimeframe(pair, tf),
    market.fetchAssetContext(pair),
  ]);
  const macro = analyzeCandles(data.macro, '4h');
  const trend = analyzeCandles(data.trend, '1h');
  const entry = analyzeCandles(data.entry, '15m');
  return { macro, trend, entry, context: ctx, fetchedAt: Date.now() };
}

function scoreEntry(analysis, strategy = {}) {
  const { macro, trend, entry, context } = analysis;
  if (!entry.ok) return { score: 0, signals: [], bias: 'none', regime: 'unknown' };

  const signals = [];
  let score = 0;
  const regime = entry.regime || 'mixed';
  const baseMin = strategy.minConfidenceScore ?? 65;
  const effectiveMin = ind.dynamicMinScore(baseMin, regime, macro.ok ? macro.trend : 'neutral');

  if (macro.ok && macro.trend === 'bearish' && macro.adx > 25) {
    return {
      score: 0,
      signals: ['macro bearish forte'],
      bias: 'blocked',
      regime,
      effectiveMin,
      reasonCode: REASON.BLOCKED_MACRO_BEAR,
    };
  }

  const maxFunding = strategy.maxFundingRate ?? 0.00005;
  if (context?.funding > maxFunding) {
    return {
      score: 0,
      signals: [`funding alto ${(context.funding * 100).toFixed(4)}%`],
      bias: 'blocked',
      regime,
      effectiveMin,
      reasonCode: REASON.BLOCKED_FUNDING,
    };
  }

  if (macro.ok && macro.trend === 'bullish') { score += 18; signals.push('macro rialzista'); }
  if (trend.ok && trend.trend === 'bullish') { score += 18; signals.push('trend 1h rialzista'); }
  if (trend.ok && trend.ema20 > trend.ema50) { score += 8; signals.push('EMA20>EMA50'); }

  if (entry.rsi != null && entry.rsi < 42) {
    score += 12;
    signals.push(`RSI ${entry.rsi.toFixed(1)}`);
    if (entry.rsiRising) { score += 10; signals.push('RSI risalita'); }
  }

  if (entry.stoch && entry.stoch.k < 30 && entry.stoch.rising) {
    score += 12;
    signals.push(`Stoch ${entry.stoch.k.toFixed(0)} oversold`);
  }

  if (entry.macd?.histogram > 0 && entry.macd.prevHistogram <= 0) {
    score += 18;
    signals.push('MACD cross rialzista');
  } else if (entry.macd?.histogram > entry.macd.prevHistogram) {
    score += 6;
    signals.push('MACD momentum +');
  }

  if (entry.bb && entry.bbPos < 0.25) {
    score += 12;
    signals.push('Bollinger bassa');
  }

  const minVol = strategy.minVolumeRatio ?? 1.1;
  if (entry.volRatio != null && entry.volRatio >= minVol) {
    score += 8;
    signals.push(`volume x${entry.volRatio.toFixed(1)}`);
  } else if (entry.volRatio != null && entry.volRatio < 0.8) {
    score -= 8;
    signals.push('volume debole');
  }

  if (trend.ok && trend.adx > 22) {
    score += 6;
    signals.push(`ADX ${trend.adx.toFixed(0)}`);
  }

  if (context?.funding != null && context.funding < 0) {
    score += 5;
    signals.push('funding negativo (favorevole long)');
  }

  score = Math.max(0, Math.min(100, score));
  const bias = score >= effectiveMin ? 'long' : score >= effectiveMin - 8 ? 'watch' : 'wait';

  return { score, signals, bias, regime, effectiveMin };
}

function scoreExit(analysis, position, entryPrice, price, strategy) {
  const { entry, trend, context } = analysis;
  const signals = [];
  let urgency = 0;

  const move = pctMove(price, entryPrice, position > 0);
  const atr = entry.ok ? entry.atr : price * 0.02;
  const slMult = strategy.atrStopMultiplier ?? 2;
  const tp1Mult = strategy.atrTp1Multiplier ?? 2;
  const tp2Mult = strategy.atrTp2Multiplier ?? 3;
  const trailMult = strategy.atrTrailMultiplier ?? 1;

  const stopDist = atr * slMult;
  const stopPct = (stopDist / entryPrice) * 100;

  if (move <= -stopPct) {
    return { action: 'sell', partial: false, reason: `stop ATR -${Math.abs(move).toFixed(2)}%`, urgency: 100 };
  }

  const trailActivate = (atr * 1.5 / entryPrice) * 100;
  const trailDist = (atr * trailMult / entryPrice) * 100;
  if (move >= trailActivate && strategy.trailingPeak != null) {
    const dropFromPeak = strategy.trailingPeak - price;
    const trailPct = (dropFromPeak / strategy.trailingPeak) * 100;
    if (trailPct >= trailDist) {
      return { action: 'sell', partial: false, reason: `trailing stop ${strategy.trailingPeak.toFixed(2)}`, urgency: 90 };
    }
  }

  const tp1Pct = (atr * tp1Mult / entryPrice) * 100;
  const tp2Pct = (atr * tp2Mult / entryPrice) * 100;

  if (move >= tp2Pct) {
    return { action: 'sell', partial: false, reason: `TP2 +${move.toFixed(2)}%`, urgency: 85 };
  }
  if (move >= tp1Pct && !strategy.tp1Taken) {
    return { action: 'sell', partial: true, partialPercent: strategy.partialTakeProfitPercent ?? 50, reason: `TP1 +${move.toFixed(2)}%`, urgency: 70 };
  }

  if (entry.ok && entry.rsi > 72) { urgency += 22; signals.push(`RSI ${entry.rsi.toFixed(0)}`); }
  if (entry.stoch?.k > 80 && !entry.stoch.rising) { urgency += 15; signals.push('Stoch ipercomprato'); }
  if (entry.macd?.histogram < 0 && entry.macd.prevHistogram >= 0) {
    urgency += 28; signals.push('MACD cross ribassista');
  }
  if (trend.ok && trend.trend === 'bearish') { urgency += 18; signals.push('trend 1h ribassista'); }
  if (context?.funding > (strategy.maxFundingRate ?? 0.00005) * 2) {
    urgency += 12; signals.push('funding molto alto');
  }

  if (urgency >= 52) {
    return { action: 'sell', partial: false, reason: signals.join(', '), urgency };
  }

  return {
    action: 'hold',
    reason: `P&L ${move >= 0 ? '+' : ''}${move.toFixed(2)}% · ${entry.regime} · RSI ${entry.rsi?.toFixed(1) ?? 'n/d'}`,
    urgency: 0,
    updateTrailingPeak: move > 0 ? Math.max(strategy.trailingPeak || 0, price) : strategy.trailingPeak,
  };
}

// FIX: resolveEntrySize era CODICE MORTO — definita ma mai chiamata
// (il sizing in runTick usa risk.computeBudgetOrderSize inline) e non esportata.
// Rimossa. Se serve in futuro, va reintegrata e richiamata esplicitamente.

async function runTick(ctx) {
  const {
    strategy,
    getPrice,
    getPosition,
    getEntryPrice,
    getEquity,
    executeMarketBuy,
    executeMarketSell,
    resumeAfterClose,
    onLog,
    onTrade,
    riskState,
    saveRiskState,
  } = ctx;

  if (!strategy.active) {
    recordDecision(strategy, {
      action: 'hold',
      reason: 'strategia in pausa',
      reasonCode: REASON.STRATEGY_INACTIVE,
      score: 0,
    });
    return { skipped: true, signal: strategy.lastSignal };
  }

  // FIX: try/catch globale. Prima, se analyzeMarket o executeMarketSell
  // lanciavano, l'eccezione propagava a runAutonomousTick che poteva
  // lasciare strategy in stato inconsistente (es. lastTradeAt non aggiornato).
  try {
    const pair = strategy.pair;
    const price = await getPrice(pair);
    if (price == null || !(price > 0)) {
      onLog(`[PRO] Prezzo HL non disponibile per ${pair} — skip tick`);
      return { skipped: true, reason: 'no_price' };
    }
    const position = await getPosition(pair);
    const hasPosition = Math.abs(position) > 1e-9;
    const entryPrice = await getEntryPrice(pair);
    const equity = await getEquity();
    const intervalMs = (strategy.intervalMinutes || 30) * 60_000;
    const canTrade = Date.now() - toTs(strategy.lastTradeAt) >= intervalMs;

    // NOTE: blocco risk-check duplicato con autonomous-engine.js.
    // Nel refactor completo, estrarre in risk.checkAndLog(ctx).
    const riskCheck = risk.checkCanTrade(strategy, riskState, equity);
    if (!riskCheck.allowed && !hasPosition) {
      onLog(`[PRO] Bloccato: ${riskCheck.reasons.join('; ')}`);
      recordDecision(strategy, {
        action: 'blocked',
        reason: riskCheck.reasons[0],
        score: 0,
      }, { riskReasons: riskCheck.reasons });
      saveRiskState(riskCheck.state);
      if (ctx.onAlert) ctx.onAlert('Circuit breaker', riskCheck.reasons[0]);
      return { signal: strategy.lastSignal, blocked: true };
    }
    saveRiskState(riskCheck.state);

    const analysis = await analyzeMarket(pair, strategy);
    const entryScore = scoreEntry(analysis, strategy);
    let minScore = entryScore.effectiveMin ?? strategy.minConfidenceScore ?? 65;

    // Regime Router: adatta la strategia al regime di mercato
    const regimeDecision = regimeRouter.route(analysis, strategy);
    if (regimeDecision.classification.regime !== (tickState._lastRegime || 'unknown')) {
      onLog(`[REGIME] ${tickState._lastRegime || '?'} → ${regimeDecision.classification.regime} (${regimeDecision.classification.reasons.join(', ')})`);
      tickState._lastRegime = regimeDecision.classification.regime;
    }

    // Regime flat: blocca trading
    if (regimeDecision.flat && !hasPosition) {
      onLog(`[REGIME] FLAT — ${regimeDecision.flatReason}`);
      recordDecision(strategy, {
        action: 'hold',
        reason: regimeDecision.flatReason,
        reasonCode: REASON.REGIME_FLAT,
        score: 0,
        regime: regimeDecision.classification.regime,
      }, { minScore, regime: regimeDecision.classification.regime });
      return { signal: strategy.lastSignal, flat: true, regime: regimeDecision.classification.regime };
    }

    // Regime reduce: applica aggiustamenti
    if (regimeDecision.adjustments?.scoreBoost) {
      minScore = Math.min(85, minScore + regimeDecision.adjustments.scoreBoost);
    }
    const sizeMultiplier = regimeDecision.adjustments?.sizeMultiplier ?? 1.0;
    const tpMultiplier = regimeDecision.adjustments?.tpMultiplier ?? 1.0;

    // Incrementa contatore tick
    tickState.count++;

    // Scanner multi-pair (ogni 3 tick, solo se flat)
    if (
      strategy.scannerEnabled &&
      tickState.count % 3 === 0 &&
      !hasPosition
    ) {
      try {
        // Wrapper: analyzeMarket + scoreEntry per scanner
        const scanAnalyzer = async (scanPair) => {
          const a = await analyzeMarket(scanPair, strategy);
          const es = scoreEntry(a, strategy);
          return { ...a, entryScore: es };
        };
        const bestPair = await scanner.findBestPair(
          strategy.watchlist, strategy, scanAnalyzer
        );
        if (bestPair && bestPair.pair !== strategy.pair) {
          onLog(`[SCANNER] Switch a ${bestPair.pair} (score ${bestPair.score} vs ${strategy.pair})`);
          strategy.pair = bestPair.pair;
        }
      } catch (err) {
        // scanner error non blocca il tick — ma logga
        eventLog.error({ source: 'scanner', message: err.message, pair: pair });
      }
    }

    // Soglia dinamica AI (ogni 30 tick)
    if (
      strategy.aiDynamicThreshold &&
      strategy.aiSignalEnabled &&
      tickState.count - tickState.lastThresholdTick >= 30
    ) {
      tickState.lastThresholdTick = tickState.count;
      try {
        const regime = guessRegime(analysis.entry);
        const atrVal = analysis.entry.ok ? analysis.entry.atr : 0;
        const volPct = price > 0 ? (atrVal / price) * 100 : 0;
        const ema20 = analysis.entry.ema20;
        const ema50 = analysis.entry.ema50;
        const emaDist = (ema20 && ema50 && price > 0)
          ? Math.abs(ema20 - ema50) / price * 100 : 0;
        // Loop 1 — Performance Feedback: usa dati reali, non più hardcoded
        // Aggiorna il feedback ogni 30 tick (invece di costruirlo ogni volta)
        let fb;
        if (tickState.count - tickState.lastFeedbackTick >= 30) {
          fb = feedback.buildFeedbackContext(strategy);
          tickState.lastFeedbackTick = tickState.count;
          // Salva nel tickState per uso tra un aggiornamento e l'altro
          tickState._lastFeedback = fb;
        } else {
          fb = tickState._lastFeedback || { winRate: null, lastTrades: [], profitFactor: null };
        }
        const newThreshold = await aiSignal.evaluateThreshold({
          pair: strategy.pair,
          regime,
          volatilityPct: volPct,
          lastTrades: fb.lastTrades || [],
          winRate: fb.winRate ?? 50,  // fallback 50 solo se mai calcolato
          adx: analysis.entry.adx || 0,
          emaDistance: { ema20, ema50, distancePct: emaDist },
          profitFactor: fb.profitFactor,
        });
        if (newThreshold?.threshold) {
          strategy.minConfidenceScore = newThreshold.threshold;
          onLog(`[AI-THRESHOLD] Soglia: ${newThreshold.threshold} — ${newThreshold.reasoning}`);
        }
      } catch (err) {
        // error non blocca
      }
    }

    // AI second opinion — solo se segnale LONG e sopra soglia minima
    if (
      entryScore.bias === 'long' &&
      strategy.aiSignalEnabled &&
      entryScore.score >= (strategy.minConfidenceScore ?? 0)
    ) {
      try {
        const e = analysis.entry;
        const aiResult = await aiSignal.evaluate({
          pair: strategy.pair,
          candleInterval: strategy.candleInterval,
          indicators: {
            rsi: e.rsi,
            macd: e.macd,
            ema20: e.ema20,
            ema50: e.ema50,
            ema200: e.ema200,
            adx: e.adx,
            bb: e.bb,
            bbPos: e.bbPos,
            atr: e.atr,
            volRatio: e.volRatio,
            stoch: e.stoch,
            regime: e.regime,
            price: e.price,
          },
          trends: {
            macro: analysis.macro?.trend,
            trend: analysis.trend?.trend,
            entry: analysis.entry?.trend,
          },
          fundingRate: analysis.context?.funding,
          entryScore: entryScore.score,
        });
        if (aiResult?.bias === 'bearish') {
          entryScore.score -= aiResult.confidence * 0.3;
          entryScore.signals.push(`AI: ${aiResult.reasoning}`);
        }
      } catch (err) {
        console.error('[aiSignal] unexpected error:', err?.message || err);
      }
    }

    let signal;
    if (hasPosition && entryPrice > 0) {
      // AI Take Profit override: sostituisci ATR fissi con target AI
      const origTp1 = strategy.atrTp1Multiplier;
      const origTp2 = strategy.atrTp2Multiplier;
      const origPartial = strategy.partialTakeProfitPercent;
      // Regime Router: restringi TP in ranging
      if (tpMultiplier !== 1.0) {
        strategy.atrTp1Multiplier = (strategy.atrTp1Multiplier || 2) * tpMultiplier;
        strategy.atrTp2Multiplier = (strategy.atrTp2Multiplier || 3) * tpMultiplier;
      }
      if (tickState.aiTp && strategy.aiTakeProfitEnabled) {
        const atrVal = analysis.entry.ok ? analysis.entry.atr : price * 0.02;
        if (atrVal > 0 && tickState.aiTp.tp1Price > entryPrice) {
          strategy.atrTp1Multiplier = (tickState.aiTp.tp1Price - entryPrice) / atrVal;
          strategy.atrTp2Multiplier = (tickState.aiTp.tp2Price - entryPrice) / atrVal;
        }
        if (tickState.aiTp.tp1Percent != null) {
          strategy.partialTakeProfitPercent = tickState.aiTp.tp1Percent;
        }
      }
      const exit = scoreExit(analysis, position, entryPrice, price, strategy);
      // Ripristina valori originali
      if (tickState.aiTp && strategy.aiTakeProfitEnabled) {
        strategy.atrTp1Multiplier = origTp1;
        strategy.atrTp2Multiplier = origTp2;
        strategy.partialTakeProfitPercent = origPartial;
      }
      if (exit.updateTrailingPeak != null) strategy.trailingPeak = exit.updateTrailingPeak;
      else if (price > (strategy.trailingPeak || 0)) strategy.trailingPeak = price;

      // AI Exit (zona grigia: urgency 40-52)
      if (
        strategy.aiExitEnabled &&
        strategy.aiSignalEnabled &&
        exit.urgency >= 40 &&
        exit.urgency < 52 &&
        exit.action !== 'sell'
      ) {
        try {
          const move = pctMove(price, entryPrice, position > 0);
          const aiExit = await aiSignal.evaluateExit({
            pair: strategy.pair,
            position: position > 0 ? 'long' : 'short',
            pnlPercent: move,
            entryPrice,
            currentPrice: price,
            indicators: {
              rsi: analysis.entry.rsi,
              macd: analysis.entry.macd,
              stoch: analysis.entry.stoch,
              atr: analysis.entry.atr,
            },
            trends: {
              trend: analysis.trend?.trend,
              entry: analysis.entry?.trend,
            },
            fundingRate: analysis.context?.funding,
          });
          if (aiExit?.action === 'sell') {
            exit.urgency = 55;
            exit.action = 'sell';
            exit.reason = `AI-EXIT: ${aiExit.reasoning}`;
            onLog(`[AI-EXIT] Vendi (conf ${aiExit.confidence}) — ${aiExit.reasoning}`);
          }
        } catch (err) {
          // error non blocca
        }
      }

      // AI Take Profit (ogni 10 tick, se in profitto >1%)
      if (
        strategy.aiTakeProfitEnabled &&
        strategy.aiSignalEnabled &&
        tickState.count - tickState.lastTpTick >= 10
      ) {
        tickState.lastTpTick = tickState.count;
        const move = pctMove(price, entryPrice, position > 0);
        if (move > 1) {
          try {
            const atrVal = analysis.entry.ok ? analysis.entry.atr : price * 0.02;
            const aiTP = await aiSignal.evaluateTakeProfit({
              pair: strategy.pair,
              position: position > 0 ? 'long' : 'short',
              entryPrice,
              currentPrice: price,
              pnlPercent: move,
              indicators: {
                atr: atrVal,
                bb: analysis.entry.bb,
                macd: analysis.entry.macd,
                rsi: analysis.entry.rsi,
              },
              recentHighs: analysis.entry.bb ? [analysis.entry.bb.upper] : [price * 1.02],
              trends: {
                macro: analysis.macro?.trend,
                trend: analysis.trend?.trend,
                entry: analysis.entry?.trend,
              },
              volatilityPct: price > 0 ? (atrVal / price) * 100 : 0,
            });
            if (aiTP && aiTP.tp1Price > price && aiTP.tp2Price > aiTP.tp1Price) {
              tickState.aiTp = aiTP;
              onLog(`[AI-TP] tp1=$${aiTP.tp1Price} tp2=$${aiTP.tp2Price} — ${aiTP.reasoning}`);
            }
          } catch (err) {
            // error non blocca
          }
        }
      }

      if (strategy.scaleInPending && exit.action === 'hold' && entryScore.score >= minScore + 5) {
        signal = {
          action: 'add',
          reason: `scale-in ${entryScore.score}/${minScore}`,
          score: entryScore.score,
          leg: 'add',
          reasonCode: REASON.SCALE_IN,
        };
      } else {
        signal = {
          action: exit.action,
          reason: exit.reason,
          score: exit.urgency,
          partial: exit.partial,
          partialPercent: exit.partialPercent,
          analysis: entryScore.signals,
          reasonCode: exit.action === 'sell'
            ? (exit.partial ? REASON.PARTIAL_TP : REASON.SELL_EXIT)
            : REASON.HOLD_POSITION,
        };
      }
    } else if (!canTrade) {
      signal = {
        action: 'hold',
        reason: 'cooldown tra trade',
        score: entryScore.score,
        analysis: entryScore.signals,
        reasonCode: REASON.TRADE_INTERVAL,
      };
    } else if (entryScore.bias === 'blocked') {
      signal = {
        action: 'hold',
        reason: entryScore.signals[0] || 'bloccato',
        score: 0,
        analysis: entryScore.signals,
        reasonCode: entryScore.reasonCode || REASON.BLOCKED_MACRO_BEAR,
      };
    } else if (entryScore.bias === 'long' && riskCheck.allowed) {
      signal = {
        action: 'buy',
        reason: `confluenza ${entryScore.score}/${minScore} [${entryScore.regime}]: ${entryScore.signals.join(', ')}`,
        score: entryScore.score,
        analysis: entryScore.signals,
        reasonCode: REASON.BUY_CONFLUENCE,
      };
    } else {
      const watch = entryScore.bias === 'watch';
      signal = {
        action: 'hold',
        reason: `score ${entryScore.score}/${minScore} [${entryScore.regime}] — ${entryScore.signals.join(', ') || 'attesa'}`,
        score: entryScore.score,
        analysis: entryScore.signals,
        reasonCode: watch ? REASON.SCORE_WATCH : REASON.SCORE_BELOW,
      };
    }

    recordDecision(strategy, signal, {
      minScore,
      regime: entryScore.regime,
      riskReasons: riskCheck.reasons,
    });

    const rsi = analysis.entry.ok ? analysis.entry.rsi : null;
    onLog(`[PRO] ${pair} $${price.toFixed(2)} RSI=${rsi?.toFixed(1) ?? 'n/d'} score=${entryScore.score}/${minScore} ${entryScore.regime} → ${signal.action} [${signal.reasonCode}]`);

    if (signal.action === 'sell' && hasPosition) {
      const partial = signal.partial ? (signal.partialPercent ?? 50) / 100 : 1;
      const res = await executeMarketSell(pair, partial);
      if (res.ok) {
        strategy.lastTradeAt = Date.now();
        strategy.lastSignal = signal;
        strategy.scaleInPending = false;
        strategy.positionLeg = null;
        if (signal.partial) strategy.tp1Taken = true;
        else {
          strategy.tp1Taken = false;
          strategy.trailingPeak = null;
        }
        if (res.trade?.pnl != null) saveRiskState(risk.recordTradeResult(riskCheck.state, res.trade.pnl, strategy));
        // Loop 2: verifica post-trade (slippage, perdita analysis, pattern detection)
        try {
          const review = tradeVerifier.verifyTrade(res.trade, signal, analysis, strategy);
          if (review?.alert) onLog(`[TRADE-REVIEW] ${review.alert}`);
          const patternAlert = tradeVerifier.getPatternAlert();
          if (patternAlert) {
            onLog(`[PATTERN] ${patternAlert.message}`);
            if (ctx.onAlert) ctx.onAlert('Pattern ricorrente', patternAlert.message);
          }
        } catch (err) { /* non blocca */ }
        // Meta-Controller: notifica trade chiuso per tracking rollback
        try { metaController.afterTrade(strategy); } catch (err) { /* non blocca */ }
        if (!signal.partial && resumeAfterClose) await resumeAfterClose();
        if (onTrade) onTrade(res.trade, signal);
      }
      return { signal, result: res, analysis };
    }

    if ((signal.action === 'buy' || signal.action === 'add') && (signal.action === 'buy' ? !hasPosition : hasPosition)) {
      const cash = ctx.balance?.amount ?? equity;
      const sizing = risk.computeBudgetOrderSize({
        equity, cash, price, strategy, entryScore,
      });
      let orderAmount = sizing.amount;
      // Regime Router: applica size multiplier
      if (sizeMultiplier !== 1.0 && orderAmount > 0) {
        orderAmount = orderAmount * sizeMultiplier;
      }
      const notional = sizing.usd || orderAmount * price;

      // IMPROVEMENT: usa costante MIN_NOTIONAL_USD invece di magic number 10
      if (!orderAmount || notional < MIN_NOTIONAL_USD) {
        onLog(`[PRO] Skip buy: ${sizing.reason || 'size auto insufficiente'} (budget $${(sizing.budget ?? cash).toFixed(2)})`);
        recordDecision(strategy, {
          action: 'hold',
          reason: sizing.reason || 'budget insufficiente',
          score: entryScore.score,
          reasonCode: REASON.SCORE_BELOW,
        }, { minScore });
        return { signal: strategy.lastSignal, result: null, analysis };
      }

      onLog(`[PRO] Size auto: ${orderAmount.toFixed(4)} ETH (~$${notional.toFixed(2)}, ${Math.round((sizing.deployFraction || 0) * 100)}% del budget $${(sizing.budget ?? cash).toFixed(2)})`);
      const res = await executeMarketBuy(pair, orderAmount);
      if (!res.ok) {
        onLog(`[PRO] Buy fallito: ${res.error || 'errore sconosciuto'}`);
      }
      if (res.ok) {
        strategy.lastTradeAt = Date.now();
        strategy.lastSignal = signal;
        strategy.tp1Taken = false;
        strategy.trailingPeak = price;
        strategy.positionLeg = 'full';
        strategy.scaleInPending = false;
      }
      if (onTrade) onTrade(res.trade, signal);
      return { signal, result: res, analysis, sizing: { ...sizing, leg: 'full' } };
    }

    return { signal, result: null, analysis };
  } catch (e) {
    // FIX: catch globale — prima un'eccezione non catturata poteva crashare
    // il tick e lasciare strategy in stato inconsistente.
    console.error('[PRO] Errore runTick:', e.message, e.stack);
    recordDecision(strategy, {
      action: 'hold',
      reason: `errore interno: ${e.message}`,
      score: 0,
      reasonCode: REASON.UNKNOWN,
    });
    return { signal: strategy.lastSignal, error: e.message };
  }
}

function formatAnalysisReport(analysis, signal, strategy) {
  const lines = [`📈 *Analisi PRO ${strategy.pair}*`];
  if (analysis.context) {
    lines.push(`Funding: ${(analysis.context.funding * 100).toFixed(4)}% · OI: ${(analysis.context.openInterest / 1000).toFixed(0)}k`);
  }
  for (const key of ['macro', 'trend', 'entry']) {
    const a = analysis[key];
    if (!a?.ok) continue;
    lines.push(`\n*${a.label}* · ${a.trend} · ${a.regime} · RSI ${a.rsi?.toFixed(1) ?? 'n/d'}`);
    if (a.volRatio) lines.push(`Vol x${a.volRatio.toFixed(1)} · ADX ${a.adx?.toFixed(0) ?? 'n/d'}`);
    if (a.stoch) lines.push(`Stoch K=${a.stoch.k.toFixed(0)} D=${a.stoch.d.toFixed(0)}`);
  }
  if (signal) {
    const min = signal.effectiveMin ?? strategy.minConfidenceScore ?? 65;
    lines.push(`\n*Segnale:* ${signal.action?.toUpperCase() || 'HOLD'} (${signal.score ?? 0}/${min})`);
    lines.push(signal.reason || '');
  }
  return lines.join('\n');
}

module.exports = {
  analyzeMarket,
  scoreEntry,
  scoreExit,
  runTick,
  formatAnalysisReport,
};
