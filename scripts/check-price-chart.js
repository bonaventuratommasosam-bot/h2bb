#!/usr/bin/env node
const http = require('http');
const url = process.argv[2] || 'http://127.0.0.1:40001/api/dashboard';
http.get(url, { timeout: 25000 }, (res) => {
  let b = '';
  res.on('data', (c) => { b += c; });
  res.on('end', () => {
    try {
      const d = JSON.parse(b);
      const pc = d.priceChart || {};
      console.log(JSON.stringify({
        ok: d.ok,
        pair: pc.pair,
        interval: pc.interval,
        candles: (pc.candles || []).length,
        markers: (pc.markers || []).length,
        buys: pc.buys,
        sells: pc.sells,
        last: (pc.markers || []).slice(-5),
      }, null, 2));
    } catch (e) {
      console.error('parse fail', e.message, b.slice(0, 200));
      process.exit(1);
    }
  });
}).on('error', (e) => {
  console.error(e.message);
  process.exit(1);
});
