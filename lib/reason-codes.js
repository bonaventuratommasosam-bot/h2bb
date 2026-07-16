// Codici decisione stabili — usati da pro-engine, /status e chat "perché".

const REASON = {
  STRATEGY_INACTIVE: 'strategy_inactive',
  RISK_CIRCUIT_BREAKER: 'risk_circuit_breaker',
  RISK_COOLDOWN: 'risk_cooldown',
  RISK_DAILY_LOSS: 'risk_daily_loss',
  RISK_DRAWDOWN: 'risk_drawdown',
  RISK_BLOCKED: 'risk_blocked',
  REGIME_FLAT: 'regime_flat',
  TRADE_INTERVAL: 'trade_interval_cooldown',
  BLOCKED_MACRO_BEAR: 'blocked_macro_bearish',
  BLOCKED_FUNDING: 'blocked_funding',
  SCORE_BELOW: 'score_below_threshold',
  SCORE_WATCH: 'score_watch_zone',
  BUY_CONFLUENCE: 'buy_confluence',
  SCALE_IN: 'scale_in',
  SELL_EXIT: 'sell_exit',
  HOLD_POSITION: 'hold_position',
  PARTIAL_TP: 'partial_take_profit',
  UNKNOWN: 'unknown',
};

/**
 * Inferisce un reasonCode da testo motivo / bias (fallback se non esplicito).
 */
function inferReasonCode({ action, reason, bias, riskReasons }) {
  const r = String(reason || '').toLowerCase();
  const risk = (riskReasons || []).join(' ').toLowerCase();

  if (action === 'blocked' || risk.includes('circuit')) {
    if (risk.includes('giornalier') || r.includes('giornalier')) return REASON.RISK_DAILY_LOSS;
    if (risk.includes('drawdown') || r.includes('drawdown')) return REASON.RISK_DRAWDOWN;
    if (risk.includes('cooldown') || r.includes('cooldown')) return REASON.RISK_COOLDOWN;
    if (risk.includes('circuit') || r.includes('circuit')) return REASON.RISK_CIRCUIT_BREAKER;
    return REASON.RISK_BLOCKED;
  }
  if (r.includes('funding')) return REASON.BLOCKED_FUNDING;
  if (r.includes('macro bear') || r.includes('macro bearish')) return REASON.BLOCKED_MACRO_BEAR;
  if (r.includes('cooldown tra trade') || r.includes('interval')) return REASON.TRADE_INTERVAL;
  if (r.includes('flat') || r.includes('regime')) {
    if (action === 'hold' && (r.includes('flat') || r.includes('ranging'))) return REASON.REGIME_FLAT;
  }
  if (action === 'buy') return REASON.BUY_CONFLUENCE;
  if (action === 'add') return REASON.SCALE_IN;
  if (action === 'sell') {
    if (r.includes('partial') || r.includes('tp1')) return REASON.PARTIAL_TP;
    return REASON.SELL_EXIT;
  }
  if (bias === 'blocked') {
    if (r.includes('funding')) return REASON.BLOCKED_FUNDING;
    return REASON.BLOCKED_MACRO_BEAR;
  }
  if (bias === 'watch') return REASON.SCORE_WATCH;
  if (action === 'hold') {
    if (r.includes('score')) return REASON.SCORE_BELOW;
    return REASON.HOLD_POSITION;
  }
  return REASON.UNKNOWN;
}

function formatDecisionLine(decision) {
  if (!decision) return 'Nessuna decisione recente.';
  const code = decision.reasonCode || REASON.UNKNOWN;
  const action = decision.action || '?';
  const reason = decision.reason || '';
  const score = decision.score != null ? ` score=${decision.score}` : '';
  const min = decision.minScore != null ? `/${decision.minScore}` : '';
  const ts = decision.at ? ` (${decision.at})` : '';
  return `\`[${code}]\` ${action}${score}${min} — ${reason}${ts}`;
}

module.exports = { REASON, inferReasonCode, formatDecisionLine };
