/* H2BB Minimondo — mondo vivo alimentato da /api/dashboard */
(() => {
  const REFRESH_MS = 5000;
  let timer = null;
  let lastOk = false;
  let failCount = 0;
  let waveT = 0;

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

  function fmtMoney(n, digits = 2) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    const sign = v > 0 ? '+' : '';
    return `${sign}$${v.toFixed(digits)}`;
  }
  function fmtNum(n, digits = 2) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return Number(n).toFixed(digits);
  }
  function fmtPct(n, digits = 2) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`;
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
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ----- Waves ----- */
  function setWave(id, amp, phase, yBase, h = 280) {
    const el = document.getElementById(id);
    if (!el) return;
    let d = `M0,${h} L0,${yBase}`;
    for (let x = 0; x <= 1200; x += 30) {
      const y = yBase
        + Math.sin((x / 1200) * Math.PI * 3.5 + phase) * amp
        + Math.sin((x / 1200) * Math.PI * 7 + phase * 1.3) * (amp * 0.25);
      d += ` L${x},${y.toFixed(2)}`;
    }
    d += ` L1200,${h} Z`;
    el.setAttribute('d', d);
  }
  function animateWaves() {
    waveT += 0.035;
    setWave('wave3', 14, waveT * 0.55, 48);
    setWave('wave1', 11, waveT, 58);
    setWave('wave2', 8, waveT * 1.15 + 1.2, 72);
    requestAnimationFrame(animateWaves);
  }

  function initSparkles() {
    const root = $('sparkles');
    if (!root || root.dataset.ready) return;
    root.dataset.ready = '1';
    for (let i = 0; i < 14; i++) {
      const s = document.createElement('span');
      s.className = 'spark';
      s.style.left = `${8 + Math.random() * 84}%`;
      s.style.top = `${10 + Math.random() * 55}%`;
      s.style.animationDelay = `${Math.random() * 3.5}s`;
      s.style.animationDuration = `${2.5 + Math.random() * 2}s`;
      root.appendChild(s);
    }
  }

  /* ----- World mood ----- */
  function applyWorldMood(data) {
    const sky = $('sky');
    const eng = data.engine || {};
    const mkt = data.market || {};
    const risk = data.risk || {};
    const beam = $('tower-beam');
    const storm = $('storm');
    const ship = $('ship');
    const island = $('island-main');

    sky.className = 'sky';
    if (!eng.active) sky.classList.add('paused');
    else if (risk.circuitBreaker || risk.blocked) sky.classList.add('storm');
    else if (mkt.regime === 'trending' && (mkt.bias === 'long' || (mkt.score != null && mkt.effectiveMin != null && mkt.score >= mkt.effectiveMin))) {
      sky.classList.add('bull');
    } else if (mkt.bias === 'blocked' || (mkt.pnlUnrealized != null && mkt.pnlUnrealized < 0)) {
      sky.classList.add('bear');
    }

    // Beacon = engine (SVG lamp on island)
    if (island) {
      island.classList.remove('lamp-on', 'lamp-off', 'lamp-blocked');
      if (!eng.active) island.classList.add('lamp-off');
      else if (eng.circuitBreaker || eng.riskBlocked) island.classList.add('lamp-blocked');
      else island.classList.add('lamp-on');
    }
    if (beam) {
      beam.className = 'tower-beam' + (eng.active && !eng.circuitBreaker && !eng.riskBlocked ? ' on' : '');
    }

    // Storm cloud on risk
    const dd = risk.drawdownPct;
    const day = risk.dayPnlPct;
    const stormy = !!(risk.circuitBreaker || risk.blocked
      || (dd != null && dd <= -3)
      || (day != null && day <= -1));
    if (storm) storm.hidden = !stormy;

    // Ship = open position on main pair
    const pos = mkt.positionSigned || mkt.heldAmount || 0;
    if (ship) {
      if (Math.abs(pos) > 1e-9) {
        ship.hidden = false;
        ship.className = 'ship ' + (pos > 0 ? 'long' : 'short');
        const lbl = $('ship-label');
        if (lbl) {
          lbl.textContent = `${pos > 0 ? 'LONG' : 'SHORT'} ${Math.abs(pos).toFixed(4)} · ${fmtMoney(mkt.pnlUnrealized)}`;
        }
      } else {
        ship.hidden = true;
      }
    }

    $('world-pair').textContent = mkt.pair || eng.pair || 'ETH';
    $('world-price').textContent = mkt.price != null ? `$${fmtNum(mkt.price)}` : '—';

    // Orbs
    const engLabel = !eng.active ? 'Faro spento' : eng.operational ? 'Faro acceso' : 'Tempesta';
    $('orb-engine-val').textContent = engLabel;
    $('orb-engine').className = 'orb' + (!eng.active ? ' warn' : eng.operational ? ' good' : ' bad');

    $('orb-equity-val').textContent = data.balance?.equity != null ? `$${fmtNum(data.balance.equity)}` : '—';
    $('orb-score-val').textContent = mkt.score != null
      ? `${fmtNum(mkt.score, 0)}/${mkt.effectiveMin ?? '—'}`
      : '—';
    $('orb-score').className = 'orb' + (
      mkt.score != null && mkt.effectiveMin != null && mkt.score >= mkt.effectiveMin ? ' good' : ''
    );

    let riskLabel = 'Calmo';
    let riskCls = 'orb good';
    if (risk.circuitBreaker) { riskLabel = 'CB'; riskCls = 'orb bad'; }
    else if (risk.blocked) { riskLabel = 'Blocco'; riskCls = 'orb bad'; }
    else if (dd != null && dd <= -2) { riskLabel = `DD ${fmtPct(dd)}`; riskCls = 'orb warn'; }
    else if (day != null) { riskLabel = `G ${fmtPct(day)}`; riskCls = day < 0 ? 'orb warn' : 'orb good'; }
    $('orb-risk-val').textContent = riskLabel;
    $('orb-risk').className = riskCls;

    // Thought bubble
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
      $('thought-action').textContent = eng.active ? 'scelgo la rotta…' : 'faro spento — osservo';
      $('thought-reason').textContent = mkt.signals?.slice?.(0, 2)?.join(' · ') || '';
    }
  }

  function renderArchipelago(watchlist, mainPair) {
    const root = $('archipelago');
    if (!root) return;
    const list = (watchlist || []).filter((w) => w.pair && String(w.pair).toUpperCase() !== String(mainPair || '').toUpperCase());
    const hues = ['#22c55e', '#14b8a6', '#38bdf8', '#a78bfa'];
    root.innerHTML = list.slice(0, 4).map((w, i) => {
      const h = hues[i % hues.length];
      return `
      <div class="sat-island i${i}" title="${w.pair}">
        <svg class="isle-art" viewBox="0 0 88 56" aria-hidden="true">
          <ellipse cx="44" cy="48" rx="36" ry="6" fill="#000" opacity="0.25"/>
          <ellipse cx="44" cy="40" rx="34" ry="10" fill="#78350f"/>
          <ellipse cx="44" cy="34" rx="28" ry="10" fill="${h}"/>
          <ellipse cx="44" cy="30" rx="20" ry="6" fill="#fff" opacity="0.12"/>
          <circle cx="30" cy="28" r="4" fill="#15803d"/>
          <circle cx="56" cy="29" r="3.5" fill="#166534"/>
        </svg>
        <div class="name">${w.pair}</div>
        <div class="px">${w.price != null ? '$' + fmtNum(w.price, w.pair === 'BTC' ? 0 : 2) : '—'}</div>
      </div>`;
    }).join('');
  }

  function renderSources(data) {
    const src = data.sources || {};
    const row = $('sources-row');
    if (!row) return;
    const items = [
      ['prezzo', src.price],
      ['mercato', src.market],
      ['portfolio', src.portfolio],
      ['balance', src.balance],
    ];
    row.innerHTML = items.map(([k, v]) => {
      const ok = v && !['none', 'unavailable', 'error', 'simulated'].includes(v);
      return `<span class="source-chip ${ok ? 'ok' : 'bad'}">${k}: ${v || '—'}</span>`;
    }).join('');
  }

  function renderWatchlist(list) {
    const el = $('watchlist');
    if (!el) return;
    if (!list?.length) {
      el.innerHTML = '<span class="muted small">Nessuna isola</span>';
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
      body.innerHTML = '<tr><td colspan="4" class="muted">Mare calmo — nessuna nave</td></tr>';
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
      body.innerHTML = '<tr><td colspan="4" class="muted">Nessuna traccia ancora</td></tr>';
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
      ['Posizione', mkt.positionSigned != null && Math.abs(mkt.positionSigned) > 1e-9
        ? `${fmtNum(mkt.positionSigned, 5)} @ ${fmtNum(mkt.avgBuyPrice)}`
        : 'flat'],
      ['uPnL', fmtMoney(mkt.pnlUnrealized)],
      ['Score', mkt.score != null ? `${fmtNum(mkt.score, 0)} / ${mkt.effectiveMin}` : '—'],
      ['Regime', mkt.regime || '—'],
      ['RSI', mkt.rsi != null ? fmtNum(mkt.rsi, 1) : '—'],
      ['Funding', mkt.funding != null ? (mkt.funding * 100).toFixed(4) + '%' : '—'],
      ['Uptime', fmtUptime(eng.uptime)],
      ['DD', risk.drawdownPct != null ? fmtPct(risk.drawdownPct) : '—'],
      ['Giorno', risk.dayPnlPct != null ? fmtPct(risk.dayPnlPct) : '—'],
    ];
    kv.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v ?? '—'}</dd>`).join('');

    const hl = data.hlTruth;
    const line = $('hl-truth-line');
    if (line) {
      if (hl) {
        line.innerHTML = `HL grezzo · mid <code>$${fmtNum(hl.midPrice)}</code> · perp <code>$${fmtNum(hl.perpsAccountValue)}</code> · spot avail <code>$${fmtNum(hl.spotUsdcAvailable)}</code>`;
      } else {
        line.textContent = data.connectHint || 'Senza address: solo mare (prezzi), niente tesoro (portfolio).';
      }
    }
  }

  function renderConnect(data) {
    const mode = data.dataMode || data.engine?.mode || 'demo';
    if (mode === 'live') setPill($('mode-pill'), 'LIVE', 'pill-live');
    else if (mode === 'observe') setPill($('mode-pill'), 'OBSERVE', 'pill-observe');
    else setPill($('mode-pill'), 'NO WALLET', 'pill-warn');

    const help = $('connect-help');
    if (help) {
      if (data.connectHint) help.textContent = data.connectHint;
      else if (mode === 'observe' || mode === 'live') {
        help.textContent = 'Minimondo su dati API Hyperliquid. Faro = engine trading.';
      } else {
        help.textContent = 'Collega 0x… per far comparire il tesoro (equity/posizioni).';
      }
    }
    const status = $('connect-status');
    if (status) {
      if (data.wallet?.addressShort || data.wallet?.address) {
        status.innerHTML = `Isola collegata: <code>${data.wallet.addressShort || data.wallet.address}</code> · ${data.balance?.source || '—'}`;
      } else {
        status.textContent = 'Nessun address — portfolio nascosto (niente numeri inventati).';
      }
    }
    const input = $('wallet-address');
    if (input && data.wallet?.address?.length === 42 && !input.dataset.touched) {
      input.value = data.wallet.address;
    }
    renderSources(data);
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

    ctx.strokeStyle = 'rgba(51,65,85,0.9)';
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + (h * i) / 3;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + w, y); ctx.stroke();
    }
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(148,163,184,0.35)';
    ctx.beginPath(); ctx.moveTo(pad.l, zeroY); ctx.lineTo(pad.l + w, zeroY); ctx.stroke();
    ctx.setLineDash([]);

    const pts = curve.map((p, i) => ({
      x: pad.l + (curve.length === 1 ? w / 2 : (i / (curve.length - 1)) * w),
      y: pad.t + h - ((p.cum - min) / range) * h,
      cum: p.cum,
    }));
    const good = pts[pts.length - 1].cum >= 0;
    const stroke = good ? '#4ade80' : '#f87171';

    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.lineTo(pts[pts.length - 1].x, zeroY);
    ctx.lineTo(pts[0].x, zeroY);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
    grad.addColorStop(0, good ? 'rgba(74,222,128,0.28)' : 'rgba(248,113,113,0.25)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
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

  function render(data) {
    setPill($('conn'), 'online', 'pill-ok');
    lastOk = true;
    applyWorldMood(data);
    renderConnect(data);
    renderArchipelago(data.watchlist, data.market?.pair || data.engine?.pair);
    renderWatchlist(data.watchlist);
    renderOpenPositions(data.openPositions);
    renderTrades(data.trades);
    renderWorldKv(data);
    renderEquity(data.equityCurve || []);
    renderStats(data.performance);
    $('last-fetch').textContent = `agg. ${fmtTime(data.ts || Date.now())}`;
    $('refresh-sec').textContent = String(REFRESH_MS / 1000);
  }

  function renderError(err) {
    setPill($('conn'), 'offline', 'pill-bad');
    lastOk = false;
    failCount += 1;
    const port = location.port || '40001';
    showBanner(
      `<strong>Minimondo offline</strong> — ${err || 'API non raggiungibile'}<br/>
       Avvia il bot: <code>npm start</code> · apri <code>http://127.0.0.1:${port}/</code> · non usare file://`,
      'bad'
    );
    $('thought-action').textContent = 'nebbia…';
    $('thought-reason').textContent = err || 'server assente';
    $('orb-engine-val').textContent = 'Offline';
  }

  async function fetchDashboard() {
    if (location.protocol === 'file:') {
      renderError('pagina aperta come file://');
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
      failCount = 0;
      hideBanner();
      render(data);
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'timeout API' : (e.message || String(e));
      renderError(msg);
    }
  }

  async function connectWallet(ev) {
    ev.preventDefault();
    const input = $('wallet-address');
    const status = $('connect-status');
    const address = (input?.value || '').trim();
    if (!address) { status.textContent = 'Inserisci un address 0x…'; return; }
    status.textContent = 'Ancoro l’isola…';
    try {
      const res = await fetch('/api/wallet/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'connect failed');
      status.innerHTML = `Isola ok: <code>${data.address.slice(0, 6)}…${data.address.slice(-4)}</code>`;
      await fetchDashboard();
    } catch (e) {
      status.textContent = `Errore: ${e.message}`;
    }
  }

  async function refreshMarket() {
    const status = $('connect-status');
    status.textContent = 'Vento di mercato…';
    try {
      await fetch('/api/market/refresh', { method: 'POST' });
      await fetchDashboard();
      status.textContent = 'Mare aggiornato.';
    } catch (e) {
      status.textContent = `Refresh fallito: ${e.message}`;
    }
  }

  async function setEngineActive(active) {
    const status = $('connect-status');
    if (active) {
      const ok = window.confirm(
        'Accendere il faro (trading automatico)?\n\n' +
        '• DEMO/OBSERVE → ordini paper\n' +
        '• LIVE → ordini reali su Hyperliquid'
      );
      if (!ok) return;
    }
    status.textContent = active ? 'Accendo il faro…' : 'Spengo il faro…';
    try {
      const res = await fetch(active ? '/resume' : '/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'comando fallito');
      status.textContent = active ? 'Faro acceso — Hermes naviga.' : 'Faro spento — solo osservazione.';
      await fetchDashboard();
    } catch (e) {
      status.textContent = `Errore: ${e.message}`;
    }
  }

  function tickClock() {
    const el = $('clock');
    if (el) el.textContent = new Date().toLocaleTimeString('it-IT');
  }

  function start() {
    $('btn-refresh')?.addEventListener('click', () => fetchDashboard());
    $('connect-form')?.addEventListener('submit', connectWallet);
    $('wallet-address')?.addEventListener('input', (e) => { e.target.dataset.touched = '1'; });
    $('btn-refresh-market')?.addEventListener('click', refreshMarket);
    $('btn-resume')?.addEventListener('click', () => setEngineActive(true));
    $('btn-pause')?.addEventListener('click', () => setEngineActive(false));
    tickClock();
    setInterval(tickClock, 1000);
    initSparkles();
    animateWaves();
    fetchDashboard();
    timer = setInterval(fetchDashboard, REFRESH_MS);
    window.addEventListener('resize', () => { if (lastOk) fetchDashboard(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
