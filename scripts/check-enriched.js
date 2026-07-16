#!/usr/bin/env node
const http = require('http');
http.get('http://127.0.0.1:40001/api/dashboard', { timeout: 25000 }, (res) => {
  let b = '';
  res.on('data', (c) => { b += c; });
  res.on('end', () => {
    const d = JSON.parse(b);
    console.log(JSON.stringify({
      signalLive: d.signalLive,
      position: d.position,
      pnl: d.pnl,
      dataQuality: d.dataQuality,
      market: {
        score: d.market?.score,
        effectiveMin: d.market?.effectiveMin,
        baseMinScore: d.market?.baseMinScore,
        rsi: d.market?.rsi,
        fundingPct: d.market?.fundingPct,
        venue: d.market?.venue,
        chartRef: d.market?.chartRef,
      },
      lastDecision: d.strategy?.lastDecision,
    }, null, 2));
  });
}).on('error', (e) => {
  console.error(e);
  process.exit(1);
});
