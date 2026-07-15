// Stato mutabile condiviso tra moduli
// EXTRACTED FROM index.js:62-72 (variabili globali)

const { DEFAULT_STRATEGY, DEFAULT_BALANCE } = require('../config/default');

const shared = {
  strategy: { ...DEFAULT_STRATEGY },
  balance: { ...DEFAULT_BALANCE },
  riskState: null,
  lastTrade: null,
  lastTickSnapshot: null,
  autonomousTimer: null,
  proactiveTimer: null,
};

module.exports = shared;
