// Express app — vetrina pubblica (GET) + controlli solo localhost

const path = require('path');
const express = require('express');
const chatRoutes = require('./routes/chat');
const walletRoutes = require('./routes/wallet');
const statusRoutes = require('./routes/status');
const dashboardApi = require('./routes/dashboard-api');
const { router: configureRoutes, setConfigureFns } = require('./routes/configure');
const { localOnly } = require('./middleware/local-only');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp() {
  const app = express();
  app.set('trust proxy', 1); // dietro nginx/caddy: IP reale via X-Forwarded-For
  app.use(express.json({ limit: '256kb' }));

  // --- Pubblico: solo lettura ---
  app.use(dashboardApi); // GET /api/dashboard, /api/ping, trades, events…
  app.use(express.static(PUBLIC_DIR, {
    index: 'index.html',
    maxAge: process.env.STATIC_MAX_AGE || '5m',
    setHeaders(res, filePath) {
      // HTML sempre fresco; asset con cache breve
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  app.get('/dashboard', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
  app.use(statusRoutes); // GET /status /health

  // --- Controlli bot: SOLO localhost ---
  app.use(localOnly);
  app.use(chatRoutes);
  app.use(walletRoutes);
  app.use(configureRoutes);

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: `Endpoint ${req.method} ${req.path} non trovato` });
  });

  return app;
}

module.exports = { createApp, setConfigureFns };
