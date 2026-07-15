// Client HTTP Hyperliquid unificato
// EXTRACTED FROM index.js:155-180 (hlRequest)

const https = require('https');
const { HL_API_HOST, HL_TIMEOUT_MS } = require('../config/default');

function hlRequest(endpoint, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const opts = {
      hostname: HL_API_HOST,
      path: '/' + endpoint,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: HL_TIMEOUT_MS,
    };
    const req = https.request(opts, (res) => {
      let d = '';
      if (res.statusCode >= 400) {
        res.on('data', () => {});
        res.on('end', () => reject(new Error(`Hyperliquid HTTP ${res.statusCode}`)));
        return;
      }
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error('Hyperliquid parse error')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Hyperliquid timeout')); });
    req.write(body);
    req.end();
  });
}

module.exports = { hlRequest };
