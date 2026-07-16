// Single write-path for strategy mutations (audit + hard caps).
// Prefer applyStrategyPatch over ad-hoc shared.strategy.x = ...

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/default');
const { applyHardCaps } = require('./hard-caps');
const { sanitizeStrategy } = require('./sanitize-strategy');
const { saveStrategy } = require('../state/strategy');
const shared = require('../state/shared');

const AUDIT_FILE = path.join(DATA_DIR, 'strategy-patch-audit.jsonl');

function appendAudit(entry) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (e) {
    console.error('[STRATEGY-STORE] audit write:', e.message);
  }
}

/**
 * @param {object} patch - shallow fields to merge into strategy
 * @param {{ source: string, reason?: string, persist?: boolean }} meta
 */
function applyStrategyPatch(patch, meta = {}) {
  const source = meta.source || 'unknown';
  const reason = meta.reason || '';
  const persist = meta.persist !== false;
  if (!patch || typeof patch !== 'object') {
    return { ok: false, error: 'invalid patch' };
  }

  const before = {};
  const keys = Object.keys(patch);
  for (const k of keys) {
    before[k] = shared.strategy[k];
    shared.strategy[k] = patch[k];
  }

  applyHardCaps(shared.strategy);
  Object.assign(shared.strategy, sanitizeStrategy(shared.strategy));

  const after = {};
  for (const k of keys) after[k] = shared.strategy[k];

  const audit = {
    ts: new Date().toISOString(),
    source,
    reason,
    keys,
    before,
    after,
  };
  appendAudit(audit);

  if (persist) saveStrategy();

  return { ok: true, strategy: shared.strategy, audit };
}

module.exports = { applyStrategyPatch, AUDIT_FILE };
