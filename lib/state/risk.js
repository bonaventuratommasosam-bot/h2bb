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
  return !!(
    shared.riskState.circuitBreaker
    || (shared.riskState.cooldownUntil && Date.now() < shared.riskState.cooldownUntil)
  );
}

module.exports = { loadRiskState, saveRiskState, getRiskBlocked, riskManager };
