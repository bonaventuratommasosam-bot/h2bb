// Risk state management
// EXTRACTED FROM index.js:62, 112-116

const riskManager = require('../risk-manager');
const shared = require('./shared');

function loadRiskState() {
  shared.riskState = riskManager.loadRiskState();
}

function saveRiskState(state) {
  shared.riskState = state;
  riskManager.saveRiskState(state);
}

function getRiskBlocked() {
  const rs = shared.riskState;
  if (!rs) return false;
  return !!(
    rs.circuitBreaker
    || (rs.cooldownUntil && Date.now() < rs.cooldownUntil)
  );
}

module.exports = { loadRiskState, saveRiskState, getRiskBlocked, riskManager };
