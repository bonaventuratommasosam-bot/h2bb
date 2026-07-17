/**
 * Trust Terminal — public honesty report for the read-only showcase.
 * Pure function: no I/O. Builds human-readable checks + score from dashboard snapshot.
 */

function check(id, label, status, detail) {
  return { id, label, status, detail: detail || '' };
}

/**
 * @param {object} input
 * @returns {object} trust report
 */
function buildTrustReport(input = {}) {
  const {
    dataMode = 'demo',
    readOnly = true,
    showcase = true,
    price = null,
    priceSource = null,
    portfolioOk = null,
    equityCheck = null,
    decisionAgeSec = null,
    signalLive = null,
    position = null,
    engine = null,
    risk = null,
    sources = null,
    hardCaps = null,
    hardFloors = null,
    nowMs = Date.now(),
  } = input;

  const checks = [];
  let score = 100;

  // 1) Live market feed
  const livePrice = price != null && Number.isFinite(Number(price));
  const srcPrice = sources?.price || priceSource;
  if (livePrice && dataMode === 'live') {
    checks.push(check(
      'live_feed',
      'Live HL mid',
      'pass',
      `Mark mid from ${srcPrice || 'hyperliquid-allMids'} · $${Number(price).toFixed(2)}`
    ));
  } else if (livePrice) {
    score -= 10;
    checks.push(check('live_feed', 'Live HL mid', 'warn', `Price present but mode=${dataMode}`));
  } else {
    score -= 35;
    checks.push(check('live_feed', 'Live HL mid', 'fail', 'No mark price from Hyperliquid'));
  }

  // 2) Portfolio / equity recon
  if (equityCheck && equityCheck.ok === true) {
    checks.push(check(
      'equity',
      'Equity recon',
      'pass',
      `perp + spotAvail = $${Number(equityCheck.expected).toFixed(2)} (Δ $${Number(equityCheck.delta || 0).toFixed(2)})`
    ));
  } else if (equityCheck && equityCheck.ok === false) {
    score -= 40;
    checks.push(check(
      'equity',
      'Equity recon',
      'fail',
      `Mismatch Δ $${Number(equityCheck.delta).toFixed(2)} · expected $${equityCheck.expected} vs actual $${equityCheck.actual}`
    ));
  } else if (portfolioOk === false) {
    score -= 25;
    checks.push(check('equity', 'Equity recon', 'fail', 'Portfolio API unavailable'));
  } else {
    score -= 8;
    checks.push(check('equity', 'Equity recon', 'warn', 'Equity check not computed'));
  }

  // 3) Signal freshness (live score preferred)
  const liveAt = signalLive?.at ? Date.parse(signalLive.at) : NaN;
  let signalAgeSec = null;
  if (Number.isFinite(liveAt)) {
    signalAgeSec = Math.max(0, Math.round((nowMs - liveAt) / 1000));
  } else if (decisionAgeSec != null) {
    signalAgeSec = decisionAgeSec;
  }

  if (signalAgeSec == null) {
    score -= 12;
    checks.push(check('signal_fresh', 'Signal freshness', 'warn', 'No timestamp on live signal'));
  } else if (signalAgeSec <= 90) {
    checks.push(check('signal_fresh', 'Signal freshness', 'pass', `Live score age ${signalAgeSec}s`));
  } else if (signalAgeSec <= 180) {
    score -= 8;
    checks.push(check('signal_fresh', 'Signal freshness', 'warn', `Live score age ${signalAgeSec}s (getting stale)`));
  } else {
    score -= 20;
    checks.push(check('signal_fresh', 'Signal freshness', 'fail', `Live score age ${signalAgeSec}s (>3 min)`));
  }

  // 4) Position truth
  const side = position?.side || 'flat';
  const size = Number(position?.size || 0);
  const isFlat = side === 'flat' || Math.abs(size) < 1e-9;
  if (isFlat) {
    checks.push(check(
      'position',
      'Position truth',
      'pass',
      'Flat — size 0 on HL clearinghouse (no open perp)'
    ));
  } else {
    checks.push(check(
      'position',
      'Position truth',
      'pass',
      `${String(side).toUpperCase()} ${Math.abs(size)} · entry ${position.entryPx ?? '—'} · mark ${position.markPx ?? '—'}`
    ));
  }

  // 5) Risk guardrails armed (trust ↑ when caps exist — CB trip is still honest)
  const capsOk = hardCaps && (
    hardCaps.maxDailyLossPercent != null || hardCaps.maxDrawdownPercent != null
  );
  if (risk?.circuitBreaker) {
    // Not a trust failure — risk system is working
    checks.push(check(
      'risk_caps',
      'Risk guardrails',
      'warn',
      `Circuit breaker ON · ${risk.circuitReason || 'tripped'} (sticky ${risk.stickyKind || '—'})`
    ));
  } else if (capsOk) {
    checks.push(check(
      'risk_caps',
      'Risk guardrails',
      'pass',
      `Day loss ≤${hardCaps.maxDailyLossPercent}% · DD ≤${hardCaps.maxDrawdownPercent}% · floors active`
    ));
  } else {
    score -= 10;
    checks.push(check('risk_caps', 'Risk guardrails', 'warn', 'Hard caps not reported'));
  }

  // 6) Public view-only
  if (readOnly && showcase) {
    checks.push(check(
      'readonly',
      'Public view-only',
      'pass',
      'No remote trade controls on this surface'
    ));
  } else if (readOnly) {
    checks.push(check('readonly', 'Public view-only', 'pass', 'Read-only API'));
  } else {
    score -= 25;
    checks.push(check('readonly', 'Public view-only', 'fail', 'Surface is not marked read-only'));
  }

  // 7) Engine posture
  const active = !!engine?.active;
  if (!active) {
    checks.push(check('engine', 'Engine', 'warn', 'Engine paused (not trading)'));
  } else if (engine?.riskBlocked || engine?.circuitBreaker) {
    checks.push(check('engine', 'Engine', 'warn', 'Engine up · risk blocked new entries'));
  } else {
    checks.push(check('engine', 'Engine', 'pass', 'Engine active · evaluating live'));
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;

  let grade = 'A';
  let status = 'verified';
  if (fails > 0 || score < 55) {
    grade = score < 40 ? 'D' : 'C';
    status = 'untrusted';
  } else if (warns > 0 || score < 85) {
    grade = score < 70 ? 'C' : 'B';
    status = 'degraded';
  }

  // Posture + plain-language headlines
  let posture = 'flat';
  if (!active) posture = 'paused';
  else if (risk?.circuitBreaker || engine?.circuitBreaker) posture = 'risk_halt';
  else if (!isFlat && side === 'long') posture = 'long';
  else if (!isFlat && side === 'short') posture = 'short';
  else posture = 'flat';

  const action = signalLive?.action || '—';
  const reason = signalLive?.reason || signalLive?.reasonCode || 'no reason';
  const sc = signalLive?.score;
  const min = signalLive?.minScore;
  const scoreTxt = sc != null
    ? `score ${sc}${min != null ? `/${min}` : ''}`
    : null;

  let whyFlat = null;
  if (isFlat) {
    if (posture === 'paused') {
      whyFlat = 'Flat because the engine is paused — not evaluating new entries.';
    } else if (posture === 'risk_halt') {
      whyFlat = `Flat · risk halt — ${risk?.circuitReason || engine?.circuitReason || 'circuit breaker'}.`;
    } else if (action === 'blocked') {
      whyFlat = `Flat by design — entry blocked: ${reason}${scoreTxt ? ` (${scoreTxt})` : ''}.`;
    } else if (action === 'wait' || action === 'hold') {
      whyFlat = `Flat — waiting: ${reason}${scoreTxt ? ` (${scoreTxt})` : ''}.`;
    } else {
      whyFlat = `No open position on Hyperliquid.${reason ? ` Signal: ${reason}.` : ''}`;
    }
  }

  let whyNotTrading = whyFlat;
  if (!isFlat) {
    whyNotTrading = `In ${side}: managing open risk · signal ${action} · ${reason}`;
  } else if (action === 'buy_ready') {
    whyNotTrading = `Setup ready (${scoreTxt || 'score met'}) but order may still be gated by AI/risk/interval.`;
  }

  let headline;
  if (status === 'untrusted') {
    headline = 'Data integrity issues — do not treat numbers as ground truth until green.';
  } else if (posture === 'risk_halt') {
    headline = 'Risk system holding the book — circuit breaker engaged.';
  } else if (posture === 'paused') {
    headline = 'Engine paused · public feed still live.';
  } else if (isFlat && action === 'blocked') {
    headline = `Holding cash · blocked (${signalLive?.reasonCode || 'guardrail'})`;
  } else if (isFlat) {
    headline = 'Holding cash · no open perp · live evaluation on';
  } else {
    headline = `${String(side).toUpperCase()} open · live mark from Hyperliquid`;
  }

  return {
    version: 1,
    score,
    grade,
    status,
    posture,
    headline,
    whyFlat,
    whyNotTrading,
    signalAgeSec,
    decisionAgeSec: decisionAgeSec ?? null,
    checks,
    summary: {
      fails,
      warns,
      pass: checks.filter((c) => c.status === 'pass').length,
    },
    floors: hardFloors || null,
    caps: hardCaps
      ? {
          maxDailyLossPercent: hardCaps.maxDailyLossPercent,
          maxDrawdownPercent: hardCaps.maxDrawdownPercent,
          consecutiveLossLimit: hardCaps.consecutiveLossLimit,
        }
      : null,
    at: new Date(nowMs).toISOString(),
  };
}

module.exports = { buildTrustReport };
