#!/usr/bin/env node
// Monitor H2BB — alert Telegram solo su anomalie (con dedup 4h)
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const alerts = require('../alerts');

const DATA_DIR = process.env.DATA_DIR || './data';
const HEARTBEAT_FILE = path.join(DATA_DIR, 'cache', 'heartbeat.json');
const STATE_FILE = path.join(DATA_DIR, 'cache', 'health-monitor-state.json');
const WALLET_FILE = path.join(DATA_DIR, 'wallet.json');
const SERVICE = process.env.H2BB_SERVICE || 'hermes-client-trade-1';
const ENGINE_URL = process.env.ENGINE_URL || 'http://127.0.0.1:40001';
const ALERT_COOLDOWN_MS = (parseInt(process.env.ALERT_COOLDOWN_HOURS, 10) || 4) * 3600_000;
const HEARTBEAT_STALE_MS = parseInt(process.env.HEARTBEAT_STALE_MS, 10) || 180000; // 3 min
const HEARTBEAT_CRITICAL_MS = parseInt(process.env.HEARTBEAT_CRITICAL_MS, 10) || 600000; // 10 min

function loadJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error('[MONITOR] load', file, e.message);
  }
  return fallback;
}

function saveState(state) {
  try {
    const dir = path.dirname(STATE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    console.error('[MONITOR] save state:', e.message);
  }
}

function getChatId() {
  const w = loadJson(WALLET_FILE, {});
  return process.env.TELEGRAM_CHAT_ID
    || process.env.ADMIN_CHAT_ID
    || w.ownerChatId
    || '';
}

function fetchHealth() {
  return new Promise((resolve) => {
    const req = http.get(`${ENGINE_URL}/health`, { timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ ok: true, data: JSON.parse(body) }); }
        catch { resolve({ ok: false, error: 'parse error' }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

function serviceActive() {
  try {
    execSync(`systemctl is-active --quiet ${SERVICE}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function shouldAlert(state, key) {
  const last = state.lastAlerts?.[key] || 0;
  return Date.now() - last >= ALERT_COOLDOWN_MS;
}

function markAlert(state, key) {
  if (!state.lastAlerts) state.lastAlerts = {};
  state.lastAlerts[key] = Date.now();
}

async function sendAlert(state, key, title, detail) {
  const chatId = getChatId();
  if (!chatId) {
    console.error('[MONITOR] ownerChatId/TELEGRAM_CHAT_ID mancante — skip alert');
    return false;
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('[MONITOR] TELEGRAM_BOT_TOKEN mancante — skip alert');
    return false;
  }
  if (!shouldAlert(state, key)) {
    console.log(`[MONITOR] dedup ${key} — skip`);
    return false;
  }
  await alerts.notifyAlert(chatId, title, detail);
  markAlert(state, key);
  console.log(`[MONITOR] ALERT inviato: ${key}`);
  return true;
}

async function main() {
  const state = loadJson(STATE_FILE, { lastAlerts: {}, lastOkAt: null });
  const issues = [];
  const now = Date.now();

  // 1. Servizio systemd
  if (!serviceActive()) {
    issues.push({ key: 'service_down', title: 'H2BB — servizio spento', detail: `${SERVICE} non è active. Riavvia: systemctl restart ${SERVICE}` });
  }

  // 2. Health API
  const health = await fetchHealth();
  if (!health.ok) {
    issues.push({ key: 'health_unreachable', title: 'H2BB — engine non risponde', detail: `GET /health fallito: ${health.error}` });
  } else if (!health.data?.ok) {
    issues.push({ key: 'health_bad', title: 'H2BB — health non OK', detail: JSON.stringify(health.data) });
  } else {
    const h = health.data;
    if (h.active && !h.operational) {
      issues.push({
        key: 'not_operational',
        title: 'H2BB — trading bloccato',
        detail: `active=true ma operational=false. CB: ${h.circuitBreaker}. Motivo: ${h.circuitReason || 'n/d'}`,
      });
    }
    if (h.circuitBreaker) {
      issues.push({
        key: 'circuit_breaker',
        title: 'H2BB — Circuit Breaker ATTIVO',
        detail: h.circuitReason || 'Circuit breaker attivo — trading sospeso.',
      });
    }
    if (h.riskBlocked && !h.circuitBreaker) {
      issues.push({
        key: 'risk_blocked',
        title: 'H2BB — Risk manager blocca',
        detail: 'riskBlocked=true (cooldown o altro limite).',
      });
    }
  }

  // 3. Heartbeat
  const hb = loadJson(HEARTBEAT_FILE, null);
  if (!hb) {
    issues.push({ key: 'no_heartbeat', title: 'H2BB — heartbeat assente', detail: 'cache/heartbeat.json non trovato.' });
  } else {
    const age = now - (hb.lastTickAt || hb.ts || 0);
    if (age > HEARTBEAT_CRITICAL_MS) {
      issues.push({
        key: 'heartbeat_critical',
        title: 'H2BB — engine probabilmente morto',
        detail: `Nessun tick da ${Math.round(age / 60000)} min. Ultimo segnale: ${hb.lastSignal || 'n/d'}`,
      });
    } else if (age > HEARTBEAT_STALE_MS) {
      issues.push({
        key: 'heartbeat_stale',
        title: 'H2BB — heartbeat stale',
        detail: `Ultimo tick ${Math.round(age / 1000)}s fa (soglia ${HEARTBEAT_STALE_MS / 1000}s).`,
      });
    }
    const timeouts = hb.consecutiveTimeouts || 0;
    if (timeouts >= 2) {
      issues.push({
        key: 'tick_timeouts',
        title: 'H2BB — tick timeout',
        detail: `${timeouts} timeout consecutivi — engine potrebbe essere in stallo.`,
      });
    }
  }

  // Invia alert (max 1 per run, il più grave prima)
  const priority = ['service_down', 'heartbeat_critical', 'health_unreachable', 'circuit_breaker', 'not_operational', 'heartbeat_stale', 'tick_timeouts', 'risk_blocked', 'health_bad', 'no_heartbeat'];
  issues.sort((a, b) => priority.indexOf(a.key) - priority.indexOf(b.key));

  let sent = 0;
  for (const issue of issues) {
    if (await sendAlert(state, issue.key, issue.title, issue.detail)) sent++;
  }

  if (issues.length === 0) {
    state.lastOkAt = new Date().toISOString();
    console.log(`[MONITOR] OK — ${new Date().toISOString()}`);
  } else {
    console.log(`[MONITOR] ${issues.length} issue(s), ${sent} alert(s) inviati`);
  }

  saveState(state);
  process.exit(issues.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('[MONITOR] FATAL:', e.message);
  process.exit(2);
});