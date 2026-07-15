// Load/save strategia
// EXTRACTED FROM index.js:120-128 (loadState, saveStrategy)
// QW5: atomic rename (tmp + renameSync) per evitare strategy.json troncato

const fs = require('fs');
const { sanitizeStrategy } = require('../lib/sanitize-strategy');
const { STRATEGY_FILE, DEFAULT_STRATEGY } = require('../config/default');
const shared = require('./shared');

function loadJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) { console.error('[LOAD] ' + file + ': ' + e.message); }
  return fallback;
}

function loadState() {
  shared.strategy = sanitizeStrategy({ ...DEFAULT_STRATEGY, ...loadJSON(STRATEGY_FILE, {}) });
  shared.strategy.createdAt = shared.strategy.createdAt || new Date().toISOString();
  shared.strategy.updatedAt = new Date().toISOString();
}

function saveStrategy() {
  shared.strategy.updatedAt = new Date().toISOString();
  const tmp = STRATEGY_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(shared.strategy, null, 2));
  fs.renameSync(tmp, STRATEGY_FILE);
}

module.exports = { loadJSON, loadState, saveStrategy };
