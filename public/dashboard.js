/* H2BB Minimondo — VETRINA pubblica (sola lettura, zero controlli) */
(() => {
  const REFRESH_MS = 5000;
  let timer = null;
  let lastOk = false;
  let world = null;

  const $ = (id) => document.getElementById(id);

  function showBanner(html, kind = 'bad') {
    const el = $('error-banner');
    if (!el) return;
    el.className = `error-banner ${kind}`;
    el.innerHTML = html;
    el.hidden = !html;
  }
  function hideBanner() {
    const el = $('error-banner');
    if (el) el.hidden = true;
  }

  function fmtMoney(n, d = 2) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    return `${v > 0 ? '+' : ''}$${v.toFixed(d)}`;
  }
  function fmtNum(n, d = 2) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return Number(n).toFixed(d);
  }
  function fmtPct(n, d = 2) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    return `${v > 0 ? '+' : ''}${v.toFixed(d)}%`;
  }
  function fmtUptime(sec) {
    if (sec == null) return '—';
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m ${s % 60}s`;
  }
  function fmtTime(ts) {
    if (!ts) return '—';
    try {
      const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
      if (Number.isNaN(d.getTime())) return String(ts).slice(0, 19);
      return d.toLocaleString('it-IT', {
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch { return '—'; }
  }
  function setPill(el, text, cls) {
    if (!el) return;
    el.textContent = text;
    el.className = 'pill' + (cls ? ` ${cls}` : '');
  }
  function pnlClass(n) {
    if (n == null || Number.isNaN(Number(n)) || Number(n) === 0) return '';
    return Number(n) > 0 ? 'good' : 'bad';
  }

  function pushWorld(data) {
    if (!world) return;
    const eng = data.engine || {};
    const mkt = data.market || {};
    world.setState({
      active: !!eng.active,
      operational: !!eng.operational,
      blocked: !!(eng.circuitBreaker || eng.riskBlocked || data.risk?.blocked),
      pair: mkt.pair || eng.pair || 'ETH',
      price: mkt.price,
      score: mkt.score,
      minScore: mkt.effectiveMin ?? 65,
      regime: mkt.regime,
      position: mkt.positionSigned ?? mkt.heldAmount ?? 0,
      pnl: mkt.pnlUnrealized,
      equity: data.balance?.equity,
      accountValuePerp: data.balance?.accountValuePerp,
      usdcSpotAvailable: data.balance?.usdcSpotAvailable,
      funding: mkt.funding,
      signals: mkt.signals || [],
      watchlist: data.watchlist || [],
      openPositions: data.openPositions || [],
    });
  }

  function renderThought(data) {
    const eng = data.engine || {};
    const mkt = data.market || {};
    const dec = data.strategy?.lastDecision || data.strategy?.lastSignal;
    if (dec) {
      $('thought-code').textContent = dec.reasonCode || dec.bias || 'decision';
      $('thought-action').textContent = dec.action || '—';
      $('thought-action').className = 'thought-action ' + (
        dec.action === 'buy' || dec.action === 'add' ? 'good'
          : dec.action === 'sell' || dec.action === 'blocked' ? 'bad' : ''
      );
      const sc = dec.score != null ? ` · score ${dec.score}${dec.minScore != null ? '/' + dec.minScore : ''}` : '';
      $('thought-reason').textContent = (dec.reason || '') + sc;
    } else {
      $('thought-code').textContent = 'listening';
      $('thought-action').textContent = eng.active ? 'traccio la rotta…' : 'in osservazione';
      $('thought-reason').textContent = (mkt.signals || []).slice(0, 2).join(' · ') || 'dati Hyperliquid in arrivo';
    }
  }

  function renderSources(data) {
    const src = data.sources || {};
    const row = $('sources-row');
    if (!row) return;
    row.innerHTML = [
      ['prezzo', src.price],
      ['mercato', src.market],
      ['portfolio', src.portfolio],
      ['balance', src.balance],
    ].map(([k, v]) => {
      const ok = v && !['none', 'unavailable', 'error', 'simulated'].includes(v);
      return `<span class="source-chip ${ok ? 'ok' : 'bad'}">${k}: ${v || '—'}</span>`;
    }).join('');
  }

  function renderMeta(data) {
    const mode = data.dataMode || data.engine?.mode || 'demo';
    if (mode === 'live') setPill($('mode-pill'), 'LIVE', 'pill-live');
    else if (mode === 'observe') setPill($('mode-pill'), 'OBSERVE', 'pill-observe');
    else setPill($('mode-pill'), 'DEMO', 'pill-demo');

    const status = $('connect-status');
    if (status) {
      if (data.wallet?.addressShort) {
        status.innerHTML = `Wallet in vetrina: <code>${data.wallet.addressShort}</code> · ${data.balance?.source || 'HL'}`;
      } else {
        status.textContent = 'Vetrina live del bot Hermes su Hyperliquid.';
      }
    }
    renderSources(data);
  }

  function renderWorldKv(data) {
    const eng = data.engine || {};
    const mkt = data.market || {};
    const bal = data.balance || {};
    const risk = data.risk || {};
    const kv = $('world-kv');
    if (!kv) return;
    const rows = [
      ['Engine', eng.active ? (eng.operational ? 'operativo' : 'bloccato') : 'pausa'],
      ['Mode', data.dataMode || eng.mode || '—'],
      ['Pair', mkt.pair || eng.pair],
      ['Mid HL', mkt.price != null ? `$${fmtNum(mkt.price)}` : '—'],
      ['Equity', bal.equity != null ? `$${fmtNum(bal.equity)}` : '—'],
      ['Perp AV', bal.accountValuePerp != null ? `$${fmtNum(bal.accountValuePerp)}` : '—'],
      ['Spot avail', bal.usdcSpotAvailable != null ? `$${fmtNum(bal.usdcSpotAvailable)}` : '—'],
      ['Posizione', Math.abs(mkt.positionSigned || 0) > 1e-9
        ? `${fmtNum(mkt.positionSigned, 5)} @ ${fmtNum(mkt.avgBuyPrice)}`
        : 'flat'],
      ['uPnL', fmtMoney(mkt.pnlUnrealized)],
      ['Score', mkt.score != null ? `${fmtNum(mkt.score, 0)} / ${mkt.effectiveMin}` : '—'],
      ['Regime', mkt.regime || '—'],
      ['RSI', mkt.rsi != null ? fmtNum(mkt.rsi, 1) : '—'],
      ['Funding', mkt.funding != null ? `${(mkt.funding * 100).toFixed(4)}%` : '—'],
      ['Uptime', fmtUptime(eng.uptime)],
      ['DD', risk.drawdownPct != null ? fmtPct(risk.drawdownPct) : '—'],
      ['Giorno', risk.dayPnlPct != null ? fmtPct(risk.dayPnlPct) : '—'],
    ];
    kv.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v ?? '—'}</dd>`).join('');

    const line = $('hl-truth-line');
    if (line) {
      const hl = data.hlTruth;
      line.innerHTML = hl
        ? `HL · mid <code>$${fmtNum(hl.midPrice)}</code> · perp <code>$${fmtNum(hl.perpsAccountValue)}</code> · spot <code>$${fmtNum(hl.spotUsdcAvailable)}</code>`
        : 'Dati di mercato Hyperliquid in tempo reale.';
    }
  }

  function renderWatchlist(list) {
    const el = $('watchlist');
    if (!el) return;
    if (!list?.length) {
      el.innerHTML = '<span class="muted small">—</span>';
      return;
    }
    el.innerHTML = list.map((w) => `
      <div class="watch-item">
        <div class="pair">${w.pair || '—'}</div>
        <div class="px">${w.price != null ? '$' + fmtNum(w.price, w.pair === 'BTC' ? 1 : 2) : '—'}</div>
      </div>
    `).join('');
  }

  function renderOpenPositions(positions) {
    const body = $('positions-body');
    if (!body) return;
    if (!positions?.length) {
      body.innerHTML = '<tr><td colspan="4" class="muted">Mare calmo</td></tr>';
      return;
    }
    body.innerHTML = positions.map((p) => {
      const sideCls = p.side === 'long' ? 'badge-buy' : 'badge-sell';
      return `<tr>
        <td>${p.coin || '—'}</td>
        <td class="${sideCls}">${p.side || '—'}</td>
        <td class="mono">${fmtNum(Math.abs(p.size), 5)}</td>
        <td class="mono ${pnlClass(p.unrealizedPnl)}">${fmtMoney(p.unrealizedPnl)}</td>
      </tr>`;
    }).join('');
  }

  function renderTrades(trades) {
    const body = $('trades-body');
    if (!body) return;
    if (!trades?.length) {
      body.innerHTML = '<tr><td colspan="4" class="muted">Nessuna traccia</td></tr>';
      return;
    }
    body.innerHTML = trades.slice(0, 12).map((t) => {
      const type = (t.type || t.side || '—').toLowerCase();
      const cls = type.includes('buy') ? 'badge-buy' : type.includes('sell') ? 'badge-sell' : '';
      const pnl = t.pnl != null ? `<span class="${pnlClass(t.pnl)}">${fmtMoney(t.pnl)}</span>` : '—';
      return `<tr>
        <td class="mono">${fmtTime(t.ts || t.time || t.at || t.timestamp)}</td>
        <td class="${cls}">${type}</td>
        <td>${t.pair || '—'}</td>
        <td class="mono">${pnl}</td>
      </tr>`;
    }).join('');
  }

  function renderEquity(curve) {
    const canvas = $('equity-chart');
    const empty = $('chart-empty');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 360;
    const cssH = 120;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (!curve?.length) {
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');

    const pad = { t: 10, r: 8, b: 14, l: 32 };
    const w = cssW - pad.l - pad.r;
    const h = cssH - pad.t - pad.b;
    const vals = curve.map((p) => p.cum);
    let min = Math.min(...vals, 0);
    let max = Math.max(...vals, 0);
    if (min === max) { min -= 1; max += 1; }
    const range = max - min;
    const zeroY = pad.t + h - ((0 - min) / range) * h;

    ctx.strokeStyle = 'rgba(51,65,85,0.85)';
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + (h * i) / 3;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + w, y); ctx.stroke();
    }
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(148,163,184,0.3)';
    ctx.beginPath(); ctx.moveTo(pad.l, zeroY); ctx.lineTo(pad.l + w, zeroY); ctx.stroke();
    ctx.setLineDash([]);

    const pts = curve.map((p, i) => ({
      x: pad.l + (curve.length === 1 ? w / 2 : (i / (curve.length - 1)) * w),
      y: pad.t + h - ((p.cum - min) / range) * h,
      cum: p.cum,
    }));
    const good = pts[pts.length - 1].cum >= 0;
    const stroke = good ? '#4ade80' : '#fb7185';

    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.lineTo(pts[pts.length - 1].x, zeroY);
    ctx.lineTo(pts[0].x, zeroY);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
    grad.addColorStop(0, good ? 'rgba(74,222,128,0.3)' : 'rgba(251,113,133,0.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function renderStats(perf) {
    const el = $('stats-mini');
    if (!el) return;
    if (!perf?.closedTrades) {
      el.innerHTML = '<span>nessun trade chiuso</span>';
      return;
    }
    el.innerHTML = [
      `WR ${perf.winRate}%`,
      `PnL ${fmtMoney(perf.totalPnl)}`,
      `PF ${fmtNum(perf.profitFactor)}`,
      `n=${perf.closedTrades}`,
    ].map((t) => `<span>${t}</span>`).join('');
  }

  function renderHero(data) {
    const mkt = data.market || {};
    const bal = data.balance || {};
    const eq = $('orb-equity-val');
    if (eq) eq.textContent = bal.equity != null ? `$${fmtNum(bal.equity)}` : '—';
    const mid = $('panel-mid');
    if (mid) mid.textContent = mkt.price != null ? `$${fmtNum(mkt.price)}` : '—';
    const up = $('panel-upnl');
    if (up) {
      up.textContent = fmtMoney(mkt.pnlUnrealized);
      up.className = 'hm-v mono ' + pnlClass(mkt.pnlUnrealized);
    }
    const perp = $('panel-perp');
    if (perp) perp.textContent = bal.accountValuePerp != null ? `$${fmtNum(bal.accountValuePerp)}` : '—';
    const spot = $('panel-spot');
    if (spot) spot.textContent = bal.usdcSpotAvailable != null ? `$${fmtNum(bal.usdcSpotAvailable)}` : '—';
    const sc = $('panel-score');
    if (sc) {
      sc.textContent = mkt.score != null ? `${fmtNum(mkt.score, 0)}/${mkt.effectiveMin ?? '—'}` : '—';
    }

    // bottom ticker with live HL facts
    const tick = $('live-ticker');
    if (tick) {
      const parts = [
        `HL ${mkt.pair || '—'} ${mkt.price != null ? '$' + fmtNum(mkt.price) : '—'}`,
        bal.equity != null ? `equity $${fmtNum(bal.equity)}` : null,
        bal.accountValuePerp != null ? `perp $${fmtNum(bal.accountValuePerp)}` : null,
        bal.usdcSpotAvailable != null ? `spot $${fmtNum(bal.usdcSpotAvailable)}` : null,
        mkt.pnlUnrealized != null ? `uPnL ${fmtMoney(mkt.pnlUnrealized)}` : null,
        mkt.funding != null ? `funding ${(mkt.funding * 100).toFixed(4)}%` : null,
        mkt.score != null ? `score ${fmtNum(mkt.score, 0)}/${mkt.effectiveMin}` : null,
        data.wallet?.addressShort ? `wallet ${data.wallet.addressShort}` : null,
        `src ${data.sources?.price || '—'}/${data.sources?.portfolio || '—'}`,
      ].filter(Boolean);
      tick.textContent = parts.join('   ·   ');
    }
  }

  function render(data) {
    setPill($('conn'), 'live', 'pill-ok');
    lastOk = true;
    pushWorld(data);
    renderThought(data);
    renderMeta(data);
    renderHero(data);
    renderWorldKv(data);
    renderWatchlist(data.watchlist);
    renderOpenPositions(data.openPositions);
    renderTrades(data.trades);
    renderEquity(data.equityCurve || []);
    renderStats(data.performance);
    $('last-fetch').textContent = `agg. ${fmtTime(data.ts || Date.now())}`;
    $('refresh-sec').textContent = String(REFRESH_MS / 1000);
  }

  function renderError(err) {
    setPill($('conn'), 'offline', 'pill-bad');
    lastOk = false;
    showBanner(
      `<strong>Vetrina offline</strong> — ${err || 'API non raggiungibile'}`,
      'bad'
    );
    if ($('thought-action')) $('thought-action').textContent = 'nebbia…';
    if ($('thought-reason')) $('thought-reason').textContent = err || 'server assente';
    if (world) world.setState({ active: false, blocked: false, operational: false });
  }

  async function fetchDashboard() {
    if (location.protocol === 'file:') {
      renderError('apri via HTTP del bot, non file://');
      return;
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch('/api/dashboard', { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'payload not ok');
      hideBanner();
      render(data);
    } catch (e) {
      renderError(e.name === 'AbortError' ? 'timeout API' : (e.message || String(e)));
    }
  }

  function tickClock() {
    const el = $('clock');
    if (el) el.textContent = new Date().toLocaleTimeString('it-IT');
  }

  function start() {
    const canvas = $('world-canvas');
    if (canvas && window.H2BBMiniWorld) {
      world = new window.H2BBMiniWorld(canvas);
    }
    tickClock();
    setInterval(tickClock, 1000);
    fetchDashboard();
    timer = setInterval(fetchDashboard, REFRESH_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
