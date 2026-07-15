// Loop Execution — Execution Fill Quality Tracker
// Traccia slippage, fill ratio, costruisce profilo orario, genera alert
const fs = require('fs');
const path = require('path');
const perf = require('./performance');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const EXECUTION_LOG = path.join(DATA_DIR, 'execution-fill.jsonl');
const EXECUTION_PROFILE = path.join(DATA_DIR, 'execution-profile.json');

function loadTradesWithSlippage(limit = 100) {
  const trades = perf.loadTrades(limit);
  return trades.filter(t => t.mode === 'live' && t.slippageBps != null);
}

function logExecution(trade) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      tradeId: trade.id,
      pair: trade.pair,
      type: trade.type,
      price: trade.price,
      mid: trade.mid || trade.price,
      slippageBps: trade.slippageBps,
      fillRatio: trade.fillRatio || 1,
      amount: trade.amount,
      value: trade.value,
    };
    fs.appendFileSync(EXECUTION_LOG, JSON.stringify(entry) + '\n');
    updateProfile(entry);
  } catch { /* non blocca */ }
}

function updateProfile(entry) {
  let profile = loadProfile();
  
  // Rolling window ultime 50 esecuzioni
  if (!profile.executions) profile.executions = [];
  profile.executions.push(entry);
  if (profile.executions.length > 50) profile.executions.shift();

  // Statistiche rolling
  const execs = profile.executions;
  if (execs.length > 0) {
    profile.avgSlippageBps = Math.round(
      execs.reduce((s, e) => s + Math.abs(e.slippageBps || 0), 0) / execs.length
    );
    profile.maxSlippageBps = Math.max(...execs.map(e => Math.abs(e.slippageBps || 0)));
    profile.avgFillRatio = Math.round(
      execs.reduce((s, e) => s + (e.fillRatio || 1), 0) / execs.length * 100
    ) / 100;
    profile.totalExecutions = execs.length;

    // Per tipo (buy vs sell)
    const buys = execs.filter(e => e.type === 'buy');
    const sells = execs.filter(e => e.type === 'sell');
    if (buys.length > 0) {
      profile.buyAvgSlippageBps = Math.round(
        buys.reduce((s, e) => s + Math.abs(e.slippageBps || 0), 0) / buys.length
      );
    }
    if (sells.length > 0) {
      profile.sellAvgSlippageBps = Math.round(
        sells.reduce((s, e) => s + Math.abs(e.slippageBps || 0), 0) / sells.length
      );
    }

    // Profilo orario
    const hourProfile = {};
    for (const e of execs) {
      const hour = new Date(e.ts).getUTCHours();
      if (!hourProfile[hour]) hourProfile[hour] = { count: 0, totalSlippage: 0 };
      hourProfile[hour].count++;
      hourProfile[hour].totalSlippage += Math.abs(e.slippageBps || 0);
    }
    profile.hourlyProfile = Object.entries(hourProfile).map(([h, d]) => ({
      hour: parseInt(h),
      count: d.count,
      avgSlippageBps: Math.round(d.totalSlippage / d.count),
    })).sort((a, b) => b.avgSlippageBps - a.avgSlippageBps);
  }

  profile.updatedAt = new Date().toISOString();
  saveProfile(profile);
  return profile;
}

function loadProfile() {
  try {
    if (fs.existsSync(EXECUTION_PROFILE)) {
      return JSON.parse(fs.readFileSync(EXECUTION_PROFILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveProfile(profile) {
  try {
    fs.writeFileSync(EXECUTION_PROFILE, JSON.stringify(profile, null, 2));
  } catch {}
}

/**
 * Valuta qualità esecuzione e genera alert.
 */
function evaluateExecutionQuality() {
  const profile = loadProfile();
  if (!profile.executions || profile.executions.length < 3) return null;

  const alerts = [];

  // Alert: slippage medio > 10 bps
  if (profile.avgSlippageBps > 10) {
    alerts.push({
      level: 'warning',
      message: `⚠️ Slippage medio ${profile.avgSlippageBps} bps (${profile.totalExecutions} trade). Riduci size o evita orari peggiori.`,
    });
  }

  // Alert: slippage estremo (> 30 bps)
  if (profile.maxSlippageBps > 30) {
    alerts.push({
      level: 'danger',
      message: `🔴 Slippage massimo ${profile.maxSlippageBps} bps nell'ultimo periodo. Controlla esecuzione.`,
    });
  }

  // Alert: fill parziale
  if (profile.avgFillRatio < 0.95) {
    alerts.push({
      level: 'warning',
      message: `⚠️ Fill ratio medio ${(profile.avgFillRatio * 100).toFixed(0)}% — ordini non completamente eseguiti.`,
    });
  }

  // Alert: orari peggiori
  if (profile.hourlyProfile && profile.hourlyProfile.length > 0) {
    const worst = profile.hourlyProfile[0];
    if (worst.avgSlippageBps > 15) {
      alerts.push({
        level: 'info',
        message: `🕐 Orari peggiori per esecuzione: ${worst.hour}:00 UTC (${worst.avgSlippageBps} bps, ${worst.count} trade).`,
      });
    }
  }

  return alerts.length > 0 ? alerts : null;
}

/**
 * Ritorna un riepilogo esecuzione per il meta-controller.
 */
function getExecutionSummary() {
  const profile = loadProfile();
  return {
    avgSlippageBps: profile.avgSlippageBps || 0,
    buyAvgSlippageBps: profile.buyAvgSlippageBps || 0,
    sellAvgSlippageBps: profile.sellAvgSlippageBps || 0,
    maxSlippageBps: profile.maxSlippageBps || 0,
    avgFillRatio: profile.avgFillRatio || 1,
    totalExecutions: profile.totalExecutions || 0,
    worstHours: (profile.hourlyProfile || []).slice(0, 3).map(h => h.hour),
  };
}

module.exports = {
  logExecution,
  evaluateExecutionQuality,
  getExecutionSummary,
  loadProfile,
};
