// Parser messaggi conversazionali
// EXTRACTED FROM index.js:345-410

const shared = require('../state/shared');

function parseMessage(text) {
  const lower = text.toLowerCase().trim();

  let m = lower.match(/^(compra|buy|acquista)\s+([\d.]+)\s+(\w+)$/);
  if (m) return { action: 'buy', amount: parseFloat(m[2]), pair: m[3].toUpperCase() };

  m = lower.match(/^(vendi|sell|vendo)\s+(\w+)?$/);
  if (m) return { action: 'sell', pair: m[2] ? m[2].toUpperCase() : shared.strategy.pair };

  m = lower.match(/^cambia\s+strategia$/i);
  if (m) return { action: 'configure' };

  m = lower.match(/(?:metti|set|imposta)\s+stop\s*loss\s*(?:a|at)?\s*(\d+[\d.]*)/i);
  if (m) return { action: 'stopLoss', value: parseFloat(m[1]) };

  m = lower.match(/(?:metti|set|imposta)\s+take\s*profit\s*(?:a|at)?\s*(\d+[\d.]*)/i);
  if (m) return { action: 'takeProfit', value: parseFloat(m[1]) };

  m = lower.match(/(?:ogni|every)\s+(\d+)\s*(ora|ore|minuto|minuti|min|h|m)\b/i);
  if (m) {
    const unit = m[2][0];
    let minutes = parseInt(m[1]);
    if (unit === 'o' || unit === 'h') minutes *= 60;
    return { action: 'interval', minutes };
  }

  if (/^(ferma\s*tutto|kill|emergency)\b/i.test(lower)) return { action: 'kill' };
  if (/^(pausa|pause|stop|ferma)\b/i.test(lower)) return { action: 'pause' };
  if (/^(resume|riprendi|riattiva|riparti)\b/i.test(lower)) return { action: 'resume' };
  if (/^(analisi|analysis|mercato)\b/i.test(lower)) return { action: 'analysis' };
  if (/^(scanner|scan|opportunit[aà])\b/i.test(lower)) return { action: 'scanner' };
  if (/^(performance|statistiche|win\s*rate)\b/i.test(lower)) return { action: 'performance' };
  if (/^(rischio|risk|protezione)\b/i.test(lower)) return { action: 'risk' };
  if (/^(reset\s*rischio|resetta\s*risk\s*manager)\b/i.test(lower)) return { action: 'resetRisk' };
  if (/(?:come sta|status|performance|andamento|pnl|profit|loss)/i.test(lower)) return { action: 'status' };
  if (/^(saldo|balance|wallet|quanto)/i.test(lower)) return { action: 'balance' };
  if (/^(help|aiuto|comandi|cosa\s*p(uo|osso))/i.test(lower)) return { action: 'help' };
  if (/^(attiva\s*live|trading\s*live|passa\s*a\s*live)/i.test(lower)) return { action: 'liveHelp' };
  if (/^(modalit[aà]\s*demo|torna\s*demo|demo)/i.test(lower)) return { action: 'demoMode' };
  if (/^(stato\s*live|connessione|hyperliquid)/i.test(lower)) return { action: 'liveStatus' };
  if (/^(revoca\s*live|disconnetti)/i.test(lower)) return { action: 'revokeLive' };

  return { action: 'unknown', text };
}

module.exports = { parseMessage };
