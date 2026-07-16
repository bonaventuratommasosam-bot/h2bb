// Express app + middleware + route wiring
// EXTRACTED FROM index.js:775-970

const path = require('path');
const express = require('express');
const chatRoutes = require('./routes/chat');
const walletRoutes = require('./routes/wallet');
const statusRoutes = require('./routes/status');
const dashboardApi = require('./routes/dashboard-api');
const { router: configureRoutes, setConfigureFns } = require('./routes/configure');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function createApp() {
  const app = express();
  app.use(express.json());

  // Dashboard web (static) + API aggregate
  app.use(dashboardApi);
  app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: 0 }));
  app.get('/dashboard', (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  app.use(chatRoutes);
  app.use(walletRoutes);
  app.use(statusRoutes);
  app.use(configureRoutes);

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: `Endpoint ${req.method} ${req.path} non trovato` });
  });

  return app;
}

module.exports = { createApp, setConfigureFns };
