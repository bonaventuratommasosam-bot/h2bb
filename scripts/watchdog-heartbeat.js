#!/usr/bin/env node
// Loop 4 — Watchdog heartbeat monitor
// Chiamato da cron ogni 5 minuti. Se heartbeat è stale, manda alert Telegram.
const fs = require('fs');
const path = require('path');
const https = require('https');

const DATA_DIR = process.env.DATA_DIR || './data';
const HEARTBEAT_FILE = path.join(DATA_DIR, 'cache', 'heartbeat.json');
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const STALE_MS = 3 * 60 * 1000; // 3 minuti max tra heartbeat
const MAX_TIMEOUTS = 3; // max tick timeout consecutivi prima di alert

function sendTelegram(message) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('[WATCHDOG] Telegram non configurato, skip alert');
    return;
  }
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const body = JSON.stringify({
    chat_id: CHAT_ID,
    text: message,
    parse_mode: 'Markdown',
  });
  const req = https.request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });
  req.on('error', () => { /* best effort */ });
  req.write(body);
  req.end();
}

function main() {
  const now = Date.now();

  if (!fs.existsSync(HEARTBEAT_FILE)) {
    console.log('[WATCHDOG] Heartbeat file non trovato');
    sendTelegram('⚠️ *H2BB Watchdog*: heartbeat file non trovato. Engine potrebbe essere spento.');
    process.exit(1);
  }

  let hb;
  try {
    hb = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf-8'));
  } catch (e) {
    sendTelegram('⚠️ *H2BB Watchdog*: heartbeat file corrotto.');
    process.exit(1);
  }

  const age = now - (hb.lastTickAt || 0);

  if (age > STALE_MS * 3) {
    // Heartbeat molto vecchio — engine probabilmente morto
    const minutes = Math.round(age / 60000);
    sendTelegram(`🚨 *H2BB Watchdog CRITICO*: nessun heartbeat da ${minutes} minuti. Engine potrebbe essere crashato.`);
    process.exit(2);
  }

  if (age > STALE_MS) {
    const seconds = Math.round(age / 1000);
    console.log(`[WATCHDOG] Heartbeat stale: ${seconds}s`);
    sendTelegram(`⚠️ *H2BB Watchdog*: heartbeat stale (${seconds}s). Ultimo tick: ${hb.lastTickAt ? new Date(hb.lastTickAt).toISOString() : 'n/d'}`);
    process.exit(0);
  }

  // Check tick timeout count
  const timeoutCount = hb.consecutiveTimeouts || 0;
  if (timeoutCount >= MAX_TIMEOUTS) {
    sendTelegram(`⚠️ *H2BB Watchdog*: ${timeoutCount} tick timeout consecutivi. Engine potrebbe essere bloccato.`);
  }

  // Check engine mode
  if (hb.mode === 'demo') {
    // Non alertare — il proactive agent già fa il nudge
    console.log(`[WATCHDOG] Engine in DEMO mode, no alert`);
  }

  console.log(`[WATCHDOG] OK — heartbeat ${Math.round(age / 1000)}s fa, tick #${hb.tickCount || '?'}, mode=${hb.mode || '?'}`);
  process.exit(0);
}

main();
