// Express app + middleware + route wiring
// EXTRACTED FROM index.js:775-970

const express = require('express');
const chatRoutes = require('./routes/chat');
const walletRoutes = require('./routes/wallet');
const statusRoutes = require('./routes/status');
const { router: configureRoutes, setConfigureFns } = require('./routes/configure');

function createApp() {
  const app = express();
  app.use(express.json());

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
