// Routes: /wallet/*
// EXTRACTED FROM index.js:825-870

const express = require('express');
const { isLiveMode, loadWallet, walletKey, saveWallet } = require('../../state/wallet');
const { syncLiveBalance } = require('../../trading/balance');
const { saveStrategy } = require('../../state/strategy');
const shared = require('../../state/shared');

const hlLive = require('../../hyperliquid-live');

const router = express.Router();

router.get('/wallet/status', async (req, res) => {
  try {
    const w = loadWallet();
    if (!w) return res.json({ ok: true, configured: false });
    const out = { ok: true, configured: true, address: w.address, mode: w.mode || 'demo', allocated: w.allocated || null, live: isLiveMode() };
    if (isLiveMode()) {
      const b = await syncLiveBalance();
      out.balance = b?.ok ? { usdc: b.usdc, usdcPerp: b.usdcPerp, usdcSpot: b.usdcSpot, hypeEvm: b.hypeEvm, accountValue: b.accountValue, source: b.source } : null;
      out.position = await hlLive.getSignedPosition(w.address, walletKey(w), shared.strategy.pair);
    }
    res.json(out);
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/wallet/activate-live', async (req, res) => {
  try {
    const { apiPrivateKey } = req.body || {};
    const w = loadWallet();
    if (!w || !w.address) return res.json({ ok: false, error: 'Completa prima il setup wallet con /start' });
    const verified = await hlLive.verifyCredentials(w.address, apiPrivateKey);
    if (!verified.ok) return res.json({ ok: false, error: verified.error });
    w.mode = 'live';
    w.apiPrivateKey = (apiPrivateKey || '').trim();
    w.liveActivatedAt = new Date().toISOString();
    saveWallet(w);
    await syncLiveBalance();
    res.json({ ok: true, mode: 'live', address: w.address, balance: { usdc: verified.withdrawable, accountValue: verified.accountValue } });
  } catch (e) { res.json({ ok: false, error: e.message }); }
});

router.post('/wallet/demo', (req, res) => {
  const w = loadWallet() || {};
  delete w.apiPrivateKey;
  delete w.apiPrivateKeyEnc;
  w.mode = 'demo';
  saveWallet(w);
  shared.strategy.active = false;
  saveStrategy();
  res.json({ ok: true, mode: 'demo' });
});

module.exports = router;
