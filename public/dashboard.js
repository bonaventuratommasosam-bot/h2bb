/* H2BB Dashboard — client */
(() => {
  const REFRESH_MS = 5000;
  let timer = null;
  let lastOk = false;
  let failCount = 0;

  const $ = (id) => document.getElementById(id);

  function showBanner(html, kind = 'bad') {
    let el = document.getElementById('error-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'error-banner';
      el.className = 'error-banner';
      document.body.prepend(el);
    }
    el.className = `error-banner ${kind}`;
    el.innerHTML = html;
    el.hidden = !html;
  }

  function hideBanner() {
    const el = document.getElementById('error-banner');
    if (el) el.hidden = true;
  }

  function fmtMoney(n, digits = 2) {
    if (n == null || Number.isNaN(n)) return '—';
    const sign = n > 0 ? '+' : '';
    return `${sign}$${Number(n).toFixed(digits)}`;
  }

  function fmtNum(n, digits = 2) {
    if (n == null || Number.isNaN(n)) return '—';
    return Number(n).toFixed(digits);
  }

  function fmtPct(n, digits = 2) {
    if (n == null || Number.isNaN(n)) return '—';
    const sign = n > 0 ? '+' : '';
    return `${sign}${Number(n).toFixed(digits)}%`;
  }

  function fmtUptime(sec) {
    if (sec == null) return '—';
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${r}s`;
    return `${r}s`;
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
    } catch {
      return '—';
    }
  }

  function setPill(el, text, cls) {
    el.textContent = text;
    el.className = 'pill' + (cls ? ` ${cls}` : '');
  }

  function pnlClass(n) {
    if (n == null || Number.isNaN(n) || n === 0) return '';
    return n > 0 ? 'good' : 'bad';
  }

  function clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  function setMeter(fillId, valId, value, limitAbs, invert = true) {
    const fill = $(fillId);
    const label = $(valId);
    if (value == null) {
      fill.style.width = '0%';
      label.textContent = '—';
      fill.className = 'meter-fill';
      return;
    }
    const used = invert ? Math.max(0, -value) : Math.max(0, value);
    const pct = limitAbs > 0 ? clamp((used / limitAbs) * 100, 0, 100) : 0;
    fill.style.width = `${pct}%`;
    label.textContent = fmtPct(value);
    fill.className = 'meter-fill' + (pct >= 85 ? ' bad' : pct >= 55 ? ' warn' : '');
  }

  function renderEquity(curve) {
    const canvas = $('equity-chart');
    const empty = $('chart-empty');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600;
    const cssH = 160;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (!curve || curve.length < 1) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    const pad = { t: 12, r: 12, b: 18, l: 40 };
    const w = cssW - pad.l - pad.r;
    const h = cssH - pad.t - pad.b;
    const vals = curve.map((p) => p.cum);
    let min = Math.min(...vals, 0);
    let max = Math.max(...vals, 0);
    if (min === max) { min -= 1; max += 1; }
    const range = max - min;

    // grid
    ctx.strokeStyle = 'rgba(30,42,58,0.9)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (h * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
    }

    // zero line
    const zeroY = pad.t + h - ((0 - min) / range) * h;
    ctx.strokeStyle = 'rgba(139,155,176,0.35)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pad.l, zeroY);
    ctx.lineTo(pad.l + w, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // area + line
    const pts = curve.map((p, i) => {
      const x = pad.l + (curve.length === 1 ? w / 2 : (i / (curve.length - 1)) * w);
      const y = pad.t + h - ((p.cum - min) / range) * h;
      return { x, y, cum: p.cum };
    });

    const last = pts[pts.length - 1];
    const good = last.cum >= 0;
    const stroke = good ? '#34d399' : '#f87171';
    const fillTop = good ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.22)';

    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.lineTo(pts[pts.length - 1].x, zeroY);
    ctx.lineTo(pts[0].x, zeroY);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
    grad.addColorStop(0, fillTop);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    // labels
    ctx.fillStyle = '#8b9bb0';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(max.toFixed(1), pad.l - 4, pad.t + 8);
    ctx.fillText(min.toFixed(1), pad.l - 4, pad.t + h);
  }

  function renderTrades(trades) {
    const body = $('trades-body');
    $('trades-count').textContent = trades?.length ? `${trades.length} mostrati` : '0';
    if (!trades || !trades.length) {
      body.innerHTML = '<tr><td colspan="6" class="muted">Nessun trade registrato</td></tr>';
      return;
    }
    body.innerHTML = trades.map((t) => {
      const type = (t.type || t.side || '—').toLowerCase();
      const cls = type.includes('buy') || type === 'long' ? 'badge-buy' : type.includes('sell') ? 'badge-sell' : '';
      const pnl = t.pnl != null ? `<span class="${pnlClass(t.pnl)}">${fmtMoney(t.pnl)}</span>` : '—';
      const qty = t.amount ?? t.size ?? t.qty ?? '—';
      const price = t.price != null ? fmtNum(t.price, 2) : '—';
      return `<tr>
        <td class="mono">${fmtTime(t.ts || t.time || t.at)}</td>
        <td class="${cls}">${type}</td>
        <td>${t.pair || '—'}</td>
        <td class="mono">${typeof qty === 'number' ? qty.toFixed(5) : qty}</td>
        <td class="mono">${price}</td>
        <td class="mono">${pnl}</td>
      </tr>`;
    }).join('');
  }

  function eventDetail(e) {
    const skip = new Set(['ts', 'type']);
    const parts = [];
    for (const [k, v] of Object.entries(e || {})) {
      if (skip.has(k) || v == null) continue;
      if (typeof v === 'object') {
        try { parts.push(`${k}=${JSON.stringify(v).slice(0, 80)}`); } catch { /* ignore */ }
      } else {
        parts.push(`${k}=${String(v).slice(0, 60)}`);
      }
      if (parts.length >= 4) break;
    }
    return parts.join(' · ') || '—';
  }

  function renderEvents(events) {
    const body = $('events-body');
    $('events-count').textContent = events?.length ? `${events.length} mostrati` : '0';
    if (!events || !events.length) {
      body.innerHTML = '<tr><td colspan="3" class="muted">Nessun evento in events.jsonl</td></tr>';
      return;
    }
    body.innerHTML = events.map((e) => `<tr>
      <td class="mono">${fmtTime(e.ts)}</td>
      <td><span class="event-type">${e.type || '—'}</span></td>
      <td class="muted">${eventDetail(e)}</td>
    </tr>`).join('');
  }

  function renderStrategy(data) {
    const s = data.strategy || {};
    const kv = $('strategy-kv');
    const rows = [
      ['Pair', s.pair],
      ['Mode', s.mode],
      ['Active', s.active ? 'sì' : 'no'],
      ['Min score', s.minConfidenceScore],
      ['Risk/trade', s.riskPerTradePercent != null ? `${s.riskPerTradePercent}%` : '—'],
      ['Max pos', s.maxPositionPercent != null ? `${s.maxPositionPercent}%` : '—'],
      ['Day loss max', s.maxDailyLossPercent != null ? `${s.maxDailyLossPercent}%` : '—'],
      ['Max DD', s.maxDrawdownPercent != null ? `${s.maxDrawdownPercent}%` : '—'],
      ['Interval', s.intervalMinutes != null ? `${s.intervalMinutes}m` : '—'],
      ['Tick', s.checkIntervalSeconds != null ? `${s.checkIntervalSeconds}s` : '—'],
      ['ATR SL', s.atrStopMultiplier],
      ['ATR TP1/2', `${s.atrTp1Multiplier ?? '—'} / ${s.atrTp2Multiplier ?? '—'}`],
    ];
    kv.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v ?? '—'}</dd>`).join('');
    setPill($('strat-mode'), s.mode || '—', s.active ? 'pill-ok' : 'pill-warn');

    const m = data.market || {};
    const pos = $('position-kv');
    pos.innerHTML = [
      ['Held', m.heldAmount != null ? Number(m.heldAmount).toFixed(6) : '—'],
      ['Entry avg', m.avgBuyPrice != null ? `$${fmtNum(m.avgBuyPrice)}` : '—'],
      ['Invested', m.totalInvested != null ? `$${fmtNum(m.totalInvested)}` : '—'],
      ['Regime', m.regime || '—'],
      ['RSI', m.rsi != null ? fmtNum(m.rsi, 1) : '—'],
      ['Wallet', data.wallet ? `${data.wallet.mode} ${data.wallet.address || ''}` : '—'],
    ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
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
      const ok = v && v !== 'none' && v !== 'unavailable' && v !== 'error' && v !== 'simulated';
      const soft = v === 'simulated';
      return `<span class="source-chip ${ok ? 'ok' : soft ? '' : 'bad'}">${k}: ${v || '—'}</span>`;
    }).join('');
  }

  function renderWatchlist(list) {
    const el = $('watchlist');
    if (!el) return;
    if (!list || !list.length) {
      el.innerHTML = '<span class="muted small">Nessun prezzo</span>';
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
    if (!positions || !positions.length) {
      body.innerHTML = '<tr><td colspan="5" class="muted">Nessuna posizione aperta su HL</td></tr>';
      return;
    }
    body.innerHTML = positions.map((p) => {
      const sideCls = p.side === 'long' ? 'badge-buy' : 'badge-sell';
      return `<tr>
        <td>${p.coin || '—'}</td>
        <td class="${sideCls}">${p.side || '—'}</td>
        <td class="mono">${fmtNum(Math.abs(p.size), 5)}</td>
        <td class="mono">${p.entryPx != null ? fmtNum(p.entryPx, 2) : '—'}</td>
        <td class="mono ${pnlClass(p.unrealizedPnl)}">${fmtMoney(p.unrealizedPnl)}</td>
      </tr>`;
    }).join('');
  }

  function renderConnect(data) {
    const mode = data.dataMode || data.engine?.mode || 'demo';
    const pill = $('data-mode-pill');
    if (mode === 'live') setPill(pill, 'LIVE', 'pill-live');
    else if (mode === 'observe') setPill(pill, 'OBSERVE · real data', 'pill-observe');
    else setPill(pill, 'DEMO · sim balance', 'pill-demo');

    const help = $('connect-help');
    if (data.connectHint) {
      help.textContent = data.connectHint;
    } else if (mode === 'observe') {
      help.textContent = 'Wallet in sola lettura: saldo e posizioni da Hyperliquid. Gli ordini restano disattivati finché non attivi LIVE con API key.';
    } else if (mode === 'live') {
      help.textContent = 'Modalità LIVE: portfolio e trading collegati a Hyperliquid.';
    } else {
      help.textContent = 'Prezzi di mercato già reali. Collega un address 0x… per equity e posizioni vere (sola lettura).';
    }

    const status = $('connect-status');
    if (data.wallet?.addressShort || data.wallet?.address) {
      status.innerHTML = `Collegato: <code>${data.wallet.addressShort || data.wallet.address}</code> · source <code>${data.balance?.source || '—'}</code>`;
    } else {
      status.textContent = 'Nessun address configurato — balance simulato ($1000).';
    }

    // prefill input if we have full address
    const input = $('wallet-address');
    if (input && data.wallet?.address && data.wallet.address.startsWith('0x') && data.wallet.address.length === 42) {
      if (!input.dataset.touched) input.value = data.wallet.address;
    }

    renderSources(data);
  }

  function render(data) {
    const eng = data.engine || {};
    const mkt = data.market || {};
    const bal = data.balance || {};
    const risk = data.risk || {};
    const perf = data.performance || {};
    const dec = data.strategy?.lastDecision || data.strategy?.lastSignal || null;

    // connection
    setPill($('conn'), 'online', 'pill-ok');
    lastOk = true;
    const mode = data.dataMode || eng.mode || 'demo';
    if (mode === 'live') setPill($('mode-pill'), 'LIVE', 'pill-live');
    else if (mode === 'observe') setPill($('mode-pill'), 'OBSERVE', 'pill-observe');
    else setPill($('mode-pill'), 'DEMO', 'pill-demo');

    renderConnect(data);
    renderWatchlist(data.watchlist);
    renderOpenPositions(data.openPositions);

    // KPIs
    const engLabel = !eng.active ? 'PAUSA' : eng.operational ? 'OPERATIVO' : 'BLOCCATO';
    $('kpi-engine').textContent = engLabel;
    $('kpi-engine').className = 'kpi-value ' + (!eng.active ? 'warn' : eng.operational ? 'good' : 'bad');
    $('kpi-engine-sub').textContent = eng.circuitBreaker
      ? (eng.circuitReason || 'circuit breaker')
      : eng.riskBlocked ? 'risk blocked' : `${eng.pair || '—'} · ${eng.mode || '—'}`;

    $('kpi-price').textContent = mkt.price != null ? `$${fmtNum(mkt.price)}` : '—';
    $('kpi-pair-sub').textContent = `${mkt.pair || eng.pair || '—'} · regime ${mkt.regime || 'n/d'}`;

    $('kpi-equity').textContent = bal.equity != null ? `$${fmtNum(bal.equity)}` : '—';
    const eqBits = [];
    if (bal.usdc != null) eqBits.push(`USDC ${fmtNum(bal.usdc)}`);
    if (bal.usdcPerp != null) eqBits.push(`perp ${fmtNum(bal.usdcPerp)}`);
    if (bal.usdcSpot != null) eqBits.push(`spot ${fmtNum(bal.usdcSpot)}`);
    if (bal.source) eqBits.push(bal.source);
    $('kpi-equity-sub').textContent = eqBits.join(' · ') || '—';

    $('kpi-pnl').textContent = fmtMoney(mkt.pnlUnrealized);
    $('kpi-pnl').className = 'kpi-value mono ' + pnlClass(mkt.pnlUnrealized);
    $('kpi-pnl-sub').textContent = mkt.heldAmount
      ? `${fmtNum(mkt.heldAmount, 5)} · ${fmtPct(mkt.pnlPercent)}`
      : 'flat';

    const score = mkt.score;
    const min = mkt.effectiveMin;
    $('kpi-score').textContent = score != null ? `${fmtNum(score, 0)}` : '—';
    $('kpi-score-sub').textContent = min != null ? `soglia ${min}` : '—';
    if (score != null && min != null) {
      $('kpi-score').className = 'kpi-value mono ' + (score >= min ? 'good' : score >= min - 8 ? 'warn' : '');
    }

    $('kpi-uptime').textContent = fmtUptime(eng.uptime);
    const hb = data.heartbeat;
    if (hb?.lastTickAt) {
      const age = Math.round((Date.now() - hb.lastTickAt) / 1000);
      $('kpi-uptime-sub').textContent = `tick ${age}s fa · #${hb.tickCount ?? '—'}`;
    } else {
      $('kpi-uptime-sub').textContent = 'no heartbeat';
    }

    // Decision
    if (dec) {
      $('decision-code').textContent = dec.reasonCode || 'unknown';
      $('decision-action').textContent = dec.action || '—';
      $('decision-action').className = 'decision-action ' + (
        dec.action === 'buy' || dec.action === 'add' ? 'good'
          : dec.action === 'sell' ? 'bad'
            : dec.action === 'blocked' ? 'bad' : ''
      );
      const sc = dec.score != null ? ` · score ${dec.score}${dec.minScore != null ? '/' + dec.minScore : ''}` : '';
      $('decision-reason').textContent = (dec.reason || '—') + sc;
      $('decision-time').textContent = fmtTime(dec.at);
    } else {
      $('decision-code').textContent = '—';
      $('decision-action').textContent = '—';
      $('decision-reason').textContent = 'In attesa del primo tick…';
      $('decision-time').textContent = '—';
    }

    // Risk
    if (risk.circuitBreaker || risk.blocked) {
      setPill($('risk-badge'), risk.circuitBreaker ? 'CB ON' : 'BLOCKED', 'pill-bad');
    } else {
      setPill($('risk-badge'), 'OK', 'pill-ok');
    }
    const dayLim = data.strategy?.maxDailyLossPercent ?? data.hardCaps?.maxDailyLossPercent ?? 2;
    const ddLim = data.strategy?.maxDrawdownPercent ?? data.hardCaps?.maxDrawdownPercent ?? 8;
    const lossLim = data.strategy?.consecutiveLossLimit ?? data.hardCaps?.consecutiveLossLimit ?? 3;
    setMeter('meter-day', 'meter-day-val', risk.dayPnlPct, dayLim, true);
    setMeter('meter-dd', 'meter-dd-val', risk.drawdownPct, ddLim, true);
    const losses = risk.consecutiveLosses || 0;
    const lossPct = lossLim > 0 ? (losses / lossLim) * 100 : 0;
    $('meter-loss').style.width = `${clamp(lossPct, 0, 100)}%`;
    $('meter-loss').className = 'meter-fill' + (lossPct >= 85 ? ' bad' : lossPct >= 50 ? ' warn' : '');
    $('meter-loss-val').textContent = `${losses}/${lossLim}`;
    $('risk-text').textContent = risk.statusText || '—';

    const caps = data.hardCaps || {};
    $('caps-row').innerHTML = [
      [`risk≤${caps.riskPerTradePercent}%`, caps.riskPerTradePercent],
      [`pos≤${caps.maxPositionPercent}%`, caps.maxPositionPercent],
      [`day−${caps.maxDailyLossPercent}%`, caps.maxDailyLossPercent],
      [`DD−${caps.maxDrawdownPercent}%`, caps.maxDrawdownPercent],
    ].filter(([, v]) => v != null).map(([t]) => `<span class="cap-chip">${t}</span>`).join('');

    // Performance
    $('perf-pair').textContent = mkt.pair || eng.pair || '—';
    $('st-wr').textContent = perf.closedTrades ? `${perf.winRate}%` : '—';
    $('st-pnl').textContent = perf.closedTrades ? fmtMoney(perf.totalPnl) : '—';
    $('st-pnl').className = pnlClass(perf.totalPnl);
    $('st-pf').textContent = perf.closedTrades ? fmtNum(perf.profitFactor) : '—';
    $('st-closed').textContent = `${perf.closedTrades ?? 0} / ${perf.totalTrades ?? 0}`;
    $('st-exp').textContent = perf.closedTrades ? fmtMoney(perf.expectancy) : '—';
    $('st-bw').textContent = perf.closedTrades
      ? `${fmtMoney(perf.bestTrade)} / ${fmtMoney(perf.worstTrade)}`
      : '—';

    renderEquity(data.equityCurve || []);
    renderStrategy(data);
    renderTrades(data.trades || []);
    renderEvents(data.events || []);

    $('last-fetch').textContent = `agg. ${fmtTime(data.ts || Date.now())}`;
    $('refresh-sec').textContent = String(REFRESH_MS / 1000);
  }

  function renderError(err) {
    setPill($('conn'), 'offline', 'pill-bad');
    lastOk = false;
    failCount += 1;
    $('kpi-engine').textContent = 'OFFLINE';
    $('kpi-engine').className = 'kpi-value bad';
    $('kpi-engine-sub').textContent = err || 'API non raggiungibile';
    $('last-fetch').textContent = `errore · ${fmtTime(Date.now())}`;

    const port = location.port || '40001';
    showBanner(
      `<strong>Bot non raggiungibile</strong> — ${err || 'fetch failed'}<br/>
       1. Avvia il bot: <code>cd h2bb && npm start</code><br/>
       2. Apri <code>http://127.0.0.1:${port}/</code> (meglio di <code>localhost</code> su Windows)<br/>
       3. Non aprire il file HTML da disco (<code>file://</code>) — serve il server Node<br/>
       4. Verifica: <code>http://127.0.0.1:${port}/api/ping</code>`,
      'bad'
    );
  }

  async function fetchDashboard() {
    // file:// non può chiamare l'API
    if (location.protocol === 'file:') {
      renderError('pagina aperta come file://');
      showBanner(
        `<strong>Apri la dashboard dal bot, non dal file.</strong><br/>
         Esegui <code>npm start</code> nella cartella h2bb, poi vai su
         <code>http://127.0.0.1:40001/</code>`,
        'bad'
      );
      return;
    }

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch('/api/dashboard', { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'payload not ok');
      failCount = 0;
      hideBanner();
      render(data);
    } catch (e) {
      const msg = e.name === 'AbortError' ? 'timeout API (8s)' : (e.message || String(e));
      renderError(msg);
    }
  }

  function tickClock() {
    $('clock').textContent = new Date().toLocaleTimeString('it-IT');
  }

  async function connectWallet(ev) {
    ev.preventDefault();
    const input = $('wallet-address');
    const status = $('connect-status');
    const address = (input?.value || '').trim();
    if (!address) {
      status.textContent = 'Inserisci un address 0x…';
      return;
    }
    status.textContent = 'Connessione…';
    try {
      const res = await fetch('/api/wallet/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'connect failed');
      status.innerHTML = `OK — observe su <code>${data.address.slice(0, 6)}…${data.address.slice(-4)}</code>`;
      await fetchDashboard();
    } catch (e) {
      status.textContent = `Errore: ${e.message}`;
    }
  }

  async function refreshMarket() {
    const status = $('connect-status');
    status.textContent = 'Aggiorno mercato HL…';
    try {
      await fetch('/api/market/refresh', { method: 'POST' });
      await fetchDashboard();
      status.textContent = 'Mercato aggiornato.';
    } catch (e) {
      status.textContent = `Refresh fallito: ${e.message}`;
    }
  }

  function start() {
    $('btn-refresh').addEventListener('click', () => fetchDashboard());
    const form = $('connect-form');
    if (form) form.addEventListener('submit', connectWallet);
    const input = $('wallet-address');
    if (input) input.addEventListener('input', () => { input.dataset.touched = '1'; });
    const btnM = $('btn-refresh-market');
    if (btnM) btnM.addEventListener('click', refreshMarket);
    tickClock();
    setInterval(tickClock, 1000);
    fetchDashboard();
    timer = setInterval(fetchDashboard, REFRESH_MS);
    window.addEventListener('resize', () => {
      if (lastOk) fetchDashboard();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
