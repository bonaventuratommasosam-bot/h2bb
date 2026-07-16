#!/usr/bin/env node
const http = require('http');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 25000 }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(b)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function issues(d) {
  const out = [];
  const m = d.market || {};
  const b = d.balance || {};
  const hl = d.hlTruth || {};
  const perf = d.performance || {};
  const risk = d.risk || {};

  // 1) Price consistency
  if (m.price != null && hl.midPrice != null && Math.abs(m.price - hl.midPrice) > 0.05) {
    out.push({ sev: 'med', id: 'price_diverge', msg: `market.price ${m.price} vs hlTruth.mid ${hl.midPrice}` });
  }

  // 2) Equity formula check
  if (b.accountValuePerp != null && b.usdcSpotAvailable != null && b.equity != null) {
    const expected = Number(b.accountValuePerp) + Number(b.usdcSpotAvailable);
    const delta = Math.abs(expected - Number(b.equity));
    if (delta > 0.05) {
      out.push({ sev: 'high', id: 'equity_formula', msg: `equity ${b.equity} != perp+spotAvail ${expected.toFixed(4)} (Δ${delta.toFixed(4)})` });
    }
  }

  // 3) uPnL consistency
  if (m.heldAmount > 0 && m.avgBuyPrice > 0 && m.price > 0) {
    const calc = m.heldAmount * (m.price - m.avgBuyPrice);
    if (Math.abs(calc - (m.pnlUnrealized || 0)) > 0.15) {
      out.push({ sev: 'med', id: 'upnl_diverge', msg: `uPnL mark ${m.pnlUnrealized} vs mid calc ${calc.toFixed(4)}` });
    }
  }

  // 4) Score threshold confusion (UI showed 60 vs 55)
  if (m.effectiveMin != null && d.strategy?.minConfidenceScore != null
      && m.effectiveMin !== d.strategy.minConfidenceScore) {
    out.push({ sev: 'low', id: 'min_score_dual', msg: `effectiveMin ${m.effectiveMin} vs strategy.min ${d.strategy.minConfidenceScore}` });
  }

  // 5) Missing enrichment
  if (m.rsi == null) out.push({ sev: 'low', id: 'no_rsi', msg: 'RSI missing in market' });
  if (m.funding == null) out.push({ sev: 'low', id: 'no_funding', msg: 'funding missing' });
  if (!perf.closedTrades) out.push({ sev: 'info', id: 'no_closed', msg: 'no closed trades in performance stats for pair filter?' });

  // 6) Day PnL uses equity snapshot quality
  if (risk.dayStartEquity != null && b.equity != null) {
    const dayUsd = Number(b.equity) - Number(risk.dayStartEquity);
    out.push({ sev: 'info', id: 'day_pnl_usd', msg: `day PnL ≈ $${dayUsd.toFixed(3)} (${risk.dayPnlPct}%) from dayStart ${risk.dayStartEquity}` });
  }

  // 7) TV vs HL venue mismatch note
  out.push({ sev: 'info', id: 'tv_venue', msg: 'TV chart is COINBASE:ETHUSD (spot ref); bot trades HL ETH perp mid' });

  // 8) Open positions vs market position
  const ops = d.openPositions || [];
  if (ops.length && m.heldAmount > 0) {
    const op = ops.find((p) => String(p.coin).toUpperCase() === String(m.pair).toUpperCase());
    if (op && Math.abs(Math.abs(op.size) - m.heldAmount) > 1e-6) {
      out.push({ sev: 'high', id: 'pos_size', msg: `openPos ${op.size} vs market.held ${m.heldAmount}` });
    }
    if (op && op.entryPx != null && m.avgBuyPrice != null && Math.abs(op.entryPx - m.avgBuyPrice) > 0.01) {
      out.push({ sev: 'med', id: 'entry_diverge', msg: `entry ${op.entryPx} vs avgBuy ${m.avgBuyPrice}` });
    }
  }

  // 9) Trades field timestamps
  const t0 = (d.trades || [])[0];
  if (t0 && !t0.ts && t0.timestamp) {
    out.push({ sev: 'low', id: 'trade_ts_field', msg: 'trades use timestamp not ts — UI fmtTime should handle both' });
  }

  // 10) Performance may filter by pair only
  out.push({ sev: 'info', id: 'perf_scope', msg: `performance stats for pair=${m.pair}: closed=${perf.closedTrades} WR=${perf.winRate}` });

  return out;
}

(async () => {
  const d = await get(process.argv[2] || 'http://127.0.0.1:40001/api/dashboard');
  const m = d.market || {};
  const b = d.balance || {};
  console.log('=== SNAPSHOT ===');
  console.log(JSON.stringify({
    ts: d.ts,
    mode: d.dataMode,
    sources: d.sources,
    price: m.price,
    entry: m.avgBuyPrice,
    size: m.heldAmount,
    uPnL: m.pnlUnrealized,
    uPnLpct: m.pnlPercent,
    score: `${m.score}/${m.effectiveMin}`,
    regime: m.regime,
    rsi: m.rsi,
    funding: m.funding,
    equity: b.equity,
    perpAV: b.accountValuePerp,
    spotAvail: b.usdcSpotAvailable,
    spotHold: b.usdcSpotHold,
    margin: b.totalMarginUsed,
    dayPnlPct: d.risk?.dayPnlPct,
    dd: d.risk?.drawdownPct,
    perf: d.performance,
    positions: d.openPositions,
    chart: d.priceChart && {
      pair: d.priceChart.pair,
      interval: d.priceChart.interval,
      candles: (d.priceChart.candles || []).length,
      markers: (d.priceChart.markers || []).length,
    },
    decision: d.strategy?.lastDecision,
  }, null, 2));
  console.log('=== ISSUES ===');
  for (const i of issues(d)) {
    console.log(`[${i.sev}] ${i.id}: ${i.msg}`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
