// Event Log — Append-only, structured, source of truth per H2BB
// Ogni evento significativo (TICK, SIGNAL, ORDER, FILL, CHANGE, ERROR) viene loggato
// Sostituisce i console.log sparsi con una traccia strutturata e ricostruibile
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const EVENT_LOG = path.join(DATA_DIR, 'events.jsonl');

const EVENT_TYPES = {
  TICK:           'tick',
  SIGNAL:         'signal',
  ORDER_INTENT:   'order_intent',
  ORDER_FILL:     'order_fill',
  STRATEGY_CHANGE:'strategy_change',
  REGIME_CHANGE:  'regime_change',
  META_DECISION:  'meta_decision',
  ERROR:          'error',
  SHUTDOWN:       'shutdown',
  STARTUP:        'startup',
  HEARTBEAT:      'heartbeat',
};

/**
 * Logga un evento. Thread-safe via append (atomic su POSIX per write < PIPE_BUF).
 */
function log(type, data = {}) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      type,
      ...data,
    };
    fs.appendFileSync(EVENT_LOG, JSON.stringify(entry) + '\n');
  } catch {
    // Last resort — non possiamo loggare l'errore del logger
  }
}

/**
 * Query eventi recenti per tipo e finestra temporale.
 */
function query({ type, since, limit = 50 } = {}) {
  try {
    if (!fs.existsSync(EVENT_LOG)) return [];
    const raw = fs.readFileSync(EVENT_LOG, 'utf-8').trim();
    if (!raw) return [];
    let events = raw.split('\n').filter(Boolean).map(l => JSON.parse(l));
    if (type) events = events.filter(e => e.type === type);
    if (since) {
      const ts = typeof since === 'number' ? since : new Date(since).getTime();
      events = events.filter(e => new Date(e.ts).getTime() >= ts);
    }
    return events.slice(-limit);
  } catch {
    return [];
  }
}

/**
 * Eventi pre-formattati per i casi comuni.
 */
function tick(data)       { log(EVENT_TYPES.TICK, data); }
function signal(data)     { log(EVENT_TYPES.SIGNAL, data); }
function orderIntent(data){ log(EVENT_TYPES.ORDER_INTENT, data); }
function orderFill(data)  { log(EVENT_TYPES.ORDER_FILL, data); }
function strategyChange(data){ log(EVENT_TYPES.STRATEGY_CHANGE, data); }
function regimeChange(data)  { log(EVENT_TYPES.REGIME_CHANGE, data); }
function metaDecision(data)  { log(EVENT_TYPES.META_DECISION, data); }
function error(data)      { log(EVENT_TYPES.ERROR, data); }
function shutdown(data)   { log(EVENT_TYPES.SHUTDOWN, data); }
function startup(data)    { log(EVENT_TYPES.STARTUP, data); }
function heartbeat(data)  { log(EVENT_TYPES.HEARTBEAT, data); }

/**
 * Riepilogo ultimi N eventi per dashboard/telemetria.
 */
function summary(minutes = 60) {
  const since = Date.now() - minutes * 60_000;
  const events = query({ since });
  const counts = {};
  const errors = [];
  for (const e of events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
    if (e.type === 'error') errors.push(e.message || e.error);
  }
  return {
    period: `${minutes}min`,
    total: events.length,
    counts,
    lastErrors: errors.slice(-5),
  };
}

module.exports = {
  log,
  query,
  summary,
  tick,
  signal,
  orderIntent,
  orderFill,
  strategyChange,
  regimeChange,
  metaDecision,
  error,
  shutdown,
  startup,
  heartbeat,
  EVENT_TYPES,
};
