// Graceful Shutdown — gestisce SIGTERM/SIGINT, flush state, heartbeat draining
const fs = require('fs');
const path = require('path');
const eventLog = require('./event-log');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const HEARTBEAT_FILE = path.join(DATA_DIR, 'cache', 'heartbeat.json');
const SHUTDOWN_TIMEOUT_MS = 5000; // max attesa per completamento tick corrente

let _draining = false;
let _shutdownHandlers = [];
let _tickRunningFn = null;  // resolver per sapere se un tick è in corso

/**
 * Registra il flag isRunning del tick-runner.
 */
function setTickRunningFn(fn) {
  _tickRunningFn = fn;
}

/**
 * Aggiungi un handler chiamato durante lo shutdown (es. save strategy).
 * Gli handler sono chiamati in ordine, con un timeout di 2s ciascuno.
 */
function onShutdown(fn, label = 'handler') {
  _shutdownHandlers.push({ fn, label });
}

/**
 * Avvia il graceful shutdown.
 */
async function drain(reason = 'SIGTERM') {
  if (_draining) return;
  _draining = true;

  eventLog.shutdown({ reason, ts: new Date().toISOString() });
  console.log(`[SHUTDOWN] Graceful shutdown iniziato (${reason})...`);

  // 1. Scrivi heartbeat draining
  try {
    const hb = {
      ts: Date.now(),
      lastTickAt: Date.now(),
      mode: 'draining',
      active: false,
      reason,
    };
    const tmp = HEARTBEAT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(hb));
    fs.renameSync(tmp, HEARTBEAT_FILE);
  } catch (e) {
    console.error('[SHUTDOWN] Heartbeat draining fallito:', e.message);
  }

  // 2. Aspetta completamento tick corrente (max SHUTDOWN_TIMEOUT_MS)
  if (_tickRunningFn) {
    const startWait = Date.now();
    while (_tickRunningFn() && Date.now() - startWait < SHUTDOWN_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (_tickRunningFn()) {
      console.warn('[SHUTDOWN] Tick ancora in corso dopo timeout — forzo uscita');
    }
  }

  // 3. Esegui handler registrati (save state files)
  for (const { fn, label } of _shutdownHandlers) {
    try {
      console.log(`[SHUTDOWN] ${label}...`);
      const result = fn();
      if (result?.then) {
        await Promise.race([
          result,
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
        ]);
      }
    } catch (e) {
      console.error(`[SHUTDOWN] ${label} fallito:`, e.message);
    }
  }

  console.log('[SHUTDOWN] Completato. Uscita.');
  process.exit(0);
}

/**
 * Registra i signal handler. Chiamare all'avvio del processo.
 */
function install() {
  process.on('SIGTERM', () => drain('SIGTERM'));
  process.on('SIGINT', () => drain('SIGINT'));
  process.on('uncaughtException', (err) => {
    eventLog.error({ source: 'uncaughtException', message: err.message, stack: err.stack?.slice(0, 500) });
    console.error('[FATAL] Uncaught exception:', err.message);
    drain('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    eventLog.error({ source: 'unhandledRejection', message: String(reason) });
    console.error('[FATAL] Unhandled rejection:', reason);
  });
  console.log('[SHUTDOWN] Signal handler installati (SIGTERM, SIGINT, uncaughtException)');
}

function isDraining() { return _draining; }

module.exports = { install, drain, onShutdown, setTickRunningFn, isDraining };
