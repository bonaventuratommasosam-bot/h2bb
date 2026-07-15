// Dispatcher handler — switch su action
// EXTRACTED FROM index.js:412-620 (handleMessage)

const { parseMessage } = require('../parser');
const trading = require('./trading');
const info = require('./info');
const control = require('./control');
const wallet = require('./wallet');
const misc = require('./misc');

async function handleMessage(text) {
  try {
    const cmd = parseMessage(text);
    switch (cmd.action) {
      case 'buy':         return await trading.handleBuy(cmd);
      case 'sell':        return await trading.handleSell(cmd);
      case 'stopLoss':    return trading.handleStopLoss(cmd);
      case 'takeProfit':  return trading.handleTakeProfit(cmd);
      case 'configure':   return control.handleConfigure();
      case 'analysis':    return await info.handleAnalysis();
      case 'scanner':     return await info.handleScanner();
      case 'performance': return info.handlePerformance();
      case 'risk':        return await info.handleRisk();
      case 'resetRisk':   return await control.handleResetRisk();
      case 'kill':        return await control.handleKill();
      case 'interval':    return control.handleInterval(cmd);
      case 'pause':       return control.handlePause();
      case 'resume':      return await control.handleResume();
      case 'liveHelp':    return wallet.handleLiveHelp();
      case 'liveStatus':  return await wallet.handleLiveStatus();
      case 'demoMode':    return wallet.handleDemoMode();
      case 'revokeLive':  return wallet.handleRevokeLive();
      case 'status':      return await info.handleStatus();
      case 'balance':     return info.handleBalance();
      case 'help':        return misc.handleHelp();
      default:            return misc.handleDefault(cmd);
    }
  } catch (e) {
    console.error('[CHAT] Errore handleMessage:', e.message, e.stack);
    return `⚠️ Errore interno: ${e.message}. Riprova tra poco.`;
  }
}

module.exports = { handleMessage, parseMessage, setControlFns: control.setControlFns };
