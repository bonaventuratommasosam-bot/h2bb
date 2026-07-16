// Lightweight order intent journal (append-only) — not a full OMS, but audit trail.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/default');

const JOURNAL = path.join(DATA_DIR, 'order-journal.jsonl');

function append(entry) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const row = {
      ts: new Date().toISOString(),
      ...entry,
    };
    fs.appendFileSync(JOURNAL, JSON.stringify(row) + '\n', 'utf-8');
    return row;
  } catch (e) {
    console.error('[ORDER-JOURNAL]', e.message);
    return null;
  }
}

function intent({ side, pair, size, mid, maxSlippageBps, source, clientOid }) {
  return append({
    state: 'INTENT',
    side,
    pair,
    size,
    mid,
    maxSlippageBps,
    source: source || 'engine',
    clientOid: clientOid || null,
  });
}

function sent(clientOid, patch = {}) {
  return append({ state: 'SENT', clientOid, ...patch });
}

function filled(clientOid, patch = {}) {
  return append({ state: 'FILLED', clientOid, ...patch });
}

function rejected(clientOid, reason, patch = {}) {
  return append({ state: 'REJECTED', clientOid, reason, ...patch });
}

module.exports = { intent, sent, filled, rejected, append, JOURNAL };
