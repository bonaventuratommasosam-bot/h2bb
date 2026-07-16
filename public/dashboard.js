/* Hermes Terminal — professional read-only showcase */
(() => {
  const REFRESH_MS = 5000;
  let world = null;
  let lastPrice = null;
  let flashTimer = null;

  const $ = (id) => document.getElementById(id);

  function showBanner(html) {
    const el = $('error-banner');
    if (!el) return;
    el.className = 'error-banner';
    el.innerHTML = html;
    el.hidden = !html;
  }
  function hideBanner() {
    const el = $('error-banner');
    if (el) el.hidden = true;
  }

  /** +$1,234.56 / −$1,234.56 / $0.00 */
  function money(n, d = 2) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    const abs = Math.abs(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
    if (v > 0) return `+$${abs}`;
    if (v < 0) return `−$${abs}`;
    return `$${abs}`;
  }

  function usd(n, d = 2) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return `$${Number(n).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })}`;
  }

  function fmtNum(n, d = 2) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return Number(n).toFixed(d);
  }

  function fmtPct(n, d = 2) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    const abs = Math.abs(v).toFixed(d);
    if (v > 0) return `+${abs}%`;
    if (v < 0) return `−${abs}%`;
    return `${abs}%`;
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
      if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16);
      return d.toLocaleString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '—';
    }
  }

  function setPill(el, text, cls) {
    if (!el) return;
    const pulse = cls === 'pill-ok' ? '<span class="pulse"></span>' : '';
    el.innerHTML = pulse + text;
    el.className = 'pill' + (cls ? ` ${cls}` : '');
  }

  function pnlClass(n) {
    if (n == null || Number.isNaN(Number(n)) || Number(n) === 0) return '';
    return Number(n) > 0 ? 'good' : 'bad';
  }

  function flashPrice(price) {
    const el = $('quote-price');
    if (!el || price == null) return;
    if (lastPrice != null && price !== lastPrice) {
      el.classList.remove('flash-up', 'flash-down');
      void el.offsetWidth;
      el.classList.add(price > lastPrice ? 'flash-up' : 'flash-down');
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        el.classList.remove('flash-up', 'flash-down');
      }, 600);
    }
    lastPrice = price;
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
      watchlist: data.watchlist || [],
      openPositions: data.openPositions || [],
    });
  }

  function renderSignal(data) {
    const eng = data.engine || {};
    const mkt = data.market || {};
    const dec = data.strategy?.lastDecision || data.strategy?.lastSignal;
    if (dec) {
      $('thought-code').textContent = dec.reasonCode || '—';
      $('thought-action').textContent = (dec.action || '—').toString();
      $('thought-action').className = 'signal-action ' + (
        dec.action === 'buy' || dec.action === 'add' ? 'good'
          : dec.action === 'sell' || dec.action === 'blocked' ? 'bad' : ''
      );
      const sc = dec.score != null
        ? `score ${dec.score}${dec.minScore != null ? '/' + dec.minScore : ''}`
        : '';
      $('thought-reason').textContent = [dec.reason, sc].filter(Boolean).join(' · ');
    } else {
      $('thought-code').textContent = eng.active ? 'SCANNING' : 'IDLE';
      $('thought-action').textContent = eng.active ? 'Evaluating setup' : 'Engine paused';
      $('thought-action').className = 'signal-action';
      $('thought-reason').textContent =
        (mkt.signals || []).slice(0, 2).join(' · ') || 'Streaming Hyperliquid market data';
    }
  }

  function renderQuote(data) {
    const mkt = data.market || {};
    const pair = (mkt.pair || data.engine?.pair || 'ETH').toUpperCase();
    if ($('quote-pair')) $('quote-pair').textContent = `${pair}-PERP`;
    if ($('quote-regime')) $('quote-regime').textContent = (mkt.regime || '—').toString();

    if ($('quote-price')) {
      if (mkt.price != null) {
        flashPrice(Number(mkt.price));
        $('quote-price').textContent = usd(mkt.price, 2);
      } else {
        $('quote-price').textContent = '—';
      }
    }

    const ch = $('quote-change');
    if (ch) {
      if (mkt.pnlUnrealized != null && Math.abs(mkt.positionSigned || mkt.heldAmount || 0) > 1e-9) {
        ch.textContent = `pos ${money(mkt.pnlUnrealized)}`;
        ch.className = 'mono ' + pnlClass(mkt.pnlUnrealized);
      } else {
        ch.textContent = mkt.rsi != null ? `RSI ${fmtNum(mkt.rsi, 1)}` : 'flat';
        ch.className = 'mono';
      }
    }
    if ($('quote-funding')) {
      $('quote-funding').textContent = mkt.funding != null
        ? `funding ${(mkt.funding * 100).toFixed(4)}%`
        : 'funding —';
    }
    if ($('quote-score')) {
      $('quote-score').textContent = mkt.score != null
        ? `score ${fmtNum(mkt.score, 0)}/${mkt.effectiveMin ?? '—'}`
        : 'score —';
    }
  }

  function renderSources(data) {
    const src = data.sources || {};
    const row = $('sources-row');
    if (!row) return;
    row.innerHTML = [
      ['price', src.price],
      ['portfolio', src.portfolio],
      ['market', src.market],
    ].map(([k, v]) => {
      const ok = v && !['none', 'unavailable', 'error', 'simulated'].includes(String(v));
      return `<span class="source-chip ${ok ? 'ok' : 'bad'}">${k}: ${v || '—'}</span>`;
    }).join('');
  }

  function renderMeta(data) {
    const mode = data.dataMode || data.engine?.mode || 'demo';
    const eng = data.engine || {};
    if (mode === 'live') setPill($('mode-pill'), 'LIVE', 'pill-live');
    else if (mode === 'observe') setPill($('mode-pill'), 'OBSERVE', 'pill-observe');
    else setPill($('mode-pill'), 'DEMO', 'pill-demo');

    const badge = $('engine-badge');
    if (badge) {
      if (!eng.active) {
        badge.textContent = 'PAUSED';
        badge.className = 'section-badge off';
      } else if (eng.circuitBreaker || eng.riskBlocked) {
        badge.textContent = 'BLOCKED';
        badge.className = 'section-badge blocked';
      } else {
        badge.textContent = 'RUNNING';
        badge.className = 'section-badge on';
      }
    }

    const status = $('connect-status');
    if (status) {
      status.textContent = data.wallet?.addressShort
        ? `Wallet ${data.wallet.addressShort} · ${data.balance?.source || 'hyperliquid'}`
        : `Source ${data.balance?.source || data.sources?.price || '—'}`;
    }
    renderSources(data);
  }

  function renderAccount(data) {
    const mkt = data.market || {};
    const bal = data.balance || {};

    if ($('orb-equity-val')) {
      $('orb-equity-val').textContent = bal.equity != null ? usd(bal.equity) : '—';
    }
    if ($('panel-mid')) {
      $('panel-mid').textContent = mkt.price != null ? usd(mkt.price, 2) : '—';
    }
    const up = $('panel-upnl');
    if (up) {
      up.textContent = money(mkt.pnlUnrealized);
      up.className = 'mono ' + pnlClass(mkt.pnlUnrealized);
    }
    if ($('panel-perp')) {
      $('panel-perp').textContent = bal.accountValuePerp != null ? usd(bal.accountValuePerp) : '—';
    }
    if ($('panel-spot')) {
      $('panel-spot').textContent = bal.usdcSpotAvailable != null ? usd(bal.usdcSpotAvailable) : '—';
    }
    if ($('panel-margin')) {
      $('panel-margin').textContent = bal.totalMarginUsed != null ? usd(bal.totalMarginUsed) : '—';
    }
    if ($('panel-hold')) {
      $('panel-hold').textContent = bal.usdcSpotHold != null ? usd(bal.usdcSpotHold) : '—';
    }
    if ($('panel-score')) {
      $('panel-score').textContent = mkt.score != null
        ? `${fmtNum(mkt.score, 0)} / ${mkt.effectiveMin ?? '—'}`
        : '—';
    }
    if ($('panel-regime')) $('panel-regime').textContent = mkt.regime || '—';

    const tick = $('live-ticker');
    if (tick) {
      const parts = [
        `${(mkt.pair || 'ETH').toUpperCase()} ${mkt.price != null ? usd(mkt.price) : '—'}`,
        bal.equity != null ? `equity ${usd(bal.equity)}` : null,
        bal.accountValuePerp != null ? `perp ${usd(bal.accountValuePerp)}` : null,
        bal.usdcSpotAvailable != null ? `spot ${usd(bal.usdcSpotAvailable)}` : null,
        mkt.pnlUnrealized != null ? `uPnL ${money(mkt.pnlUnrealized)}` : null,
        mkt.funding != null ? `fund ${(mkt.funding * 100).toFixed(4)}%` : null,
        data.wallet?.addressShort || null,
      ].filter(Boolean);
      tick.textContent = parts.join('   ·   ');
    }
  }

  function renderRiskKv(data) {
    const eng = data.engine || {};
    const mkt = data.market || {};
    const bal = data.balance || {};
    const risk = data.risk || {};
    const kv = $('world-kv');
    if (!kv) return;
    const rows = [
      ['Engine', eng.active ? (eng.operational ? 'running' : 'blocked') : 'paused'],
      ['Mode', data.dataMode || eng.mode || '—'],
      ['Pair', (mkt.pair || eng.pair || '—').toString().toUpperCase()],
      ['RSI', mkt.rsi != null ? fmtNum(mkt.rsi, 1) : '—'],
      ['Day PnL', risk.dayPnlPct != null ? fmtPct(risk.dayPnlPct) : '—'],
      ['Drawdown', risk.drawdownPct != null ? fmtPct(risk.drawdownPct) : '—'],
      ['Loss streak', `${risk.consecutiveLosses ?? 0}`],
      ['Uptime', fmtUptime(eng.uptime)],
    ];
    kv.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v ?? '—'}</dd>`).join('');

    const line = $('hl-truth-line');
    if (line) {
      const hl = data.hlTruth;
      line.textContent = hl
        ? `HL truth · mid ${usd(hl.midPrice)} · perp ${usd(hl.perpsAccountValue)} · spot avail ${usd(hl.spotUsdcAvailable)}`
        : 'Live feed from Hyperliquid public API · equity = perp AV + spot USDC available';
    }
  }

  function renderWatchlist(list) {
    const el = $('watchlist');
    if (!el) return;
    if (!list?.length) {
      el.innerHTML = '<span class="muted small">—</span>';
      return;
    }
    el.innerHTML = list.map((w) => {
      const dig = w.pair === 'BTC' ? 0 : 2;
      return `
      <div class="watch-item">
        <div class="pair">${w.pair || '—'}</div>
        <div class="px">${w.price != null ? usd(w.price, dig) : '—'}</div>
      </div>`;
    }).join('');
  }

  function renderPositions(positions) {
    const body = $('positions-body');
    if (!body) return;
    if (!positions?.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty">Flat — no open positions</td></tr>';
      return;
    }
    body.innerHTML = positions.map((p) => {
      const sideCls = p.side === 'long' ? 'badge-buy' : 'badge-sell';
      return `<tr>
        <td>${p.coin || '—'}</td>
        <td class="${sideCls}">${(p.side || '—').toUpperCase()}</td>
        <td class="mono num">${fmtNum(Math.abs(p.size), 5)}</td>
        <td class="mono num ${pnlClass(p.unrealizedPnl)}">${money(p.unrealizedPnl)}</td>
      </tr>`;
    }).join('');
  }

  function renderTrades(trades) {
    const body = $('trades-body');
    if (!body) return;
    if (!trades?.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty">No closed trades yet</td></tr>';
      return;
    }
    body.innerHTML = trades.slice(0, 15).map((t) => {
      const type = (t.type || t.side || '—').toLowerCase();
      const cls = type.includes('buy') ? 'badge-buy' : type.includes('sell') ? 'badge-sell' : '';
      const pnl = t.pnl != null
        ? `<span class="${pnlClass(t.pnl)}">${money(t.pnl)}</span>`
        : '—';
      return `<tr>
        <td class="mono">${fmtTime(t.ts || t.time || t.at || t.timestamp)}</td>
        <td class="${cls}">${type}</td>
        <td>${t.pair || '—'}</td>
        <td class="mono num">${pnl}</td>
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
    const cssH = 140;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (!curve?.length) {
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');

    const pad = { t: 12, r: 10, b: 16, l: 40 };
    const w = cssW - pad.l - pad.r;
    const h = cssH - pad.t - pad.b;
    const vals = curve.map((p) => p.cum);
    let min = Math.min(...vals, 0);
    let max = Math.max(...vals, 0);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const range = max - min;
    const zeroY = pad.t + h - ((0 - min) / range) * h;

    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + (h * i) / 3;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
    }

    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(pad.l, zeroY);
    ctx.lineTo(pad.l + w, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // y labels
    ctx.fillStyle = 'rgba(125,135,153,0.7)';
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(max.toFixed(0), pad.l - 6, pad.t + 4);
    ctx.fillText(min.toFixed(0), pad.l - 6, pad.t + h);

    const pts = curve.map((p, i) => ({
      x: pad.l + (curve.length === 1 ? w / 2 : (i / (curve.length - 1)) * w),
      y: pad.t + h - ((p.cum - min) / range) * h,
      cum: p.cum,
    }));
    const good = pts[pts.length - 1].cum >= 0;
    const stroke = good ? '#2fd48a' : '#f06570';

    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.lineTo(pts[pts.length - 1].x, zeroY);
    ctx.lineTo(pts[0].x, zeroY);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
    grad.addColorStop(0, good ? 'rgba(47,212,138,0.22)' : 'rgba(240,101,112,0.2)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.75;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // endpoint
    const last = pts[pts.length - 1];
    ctx.fillStyle = stroke;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function renderStats(perf) {
    const el = $('stats-mini');
    if (!el) return;
    if (!perf?.closedTrades) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = [
      `WR ${perf.winRate}%`,
      `PnL ${money(perf.totalPnl)}`,
      `PF ${fmtNum(perf.profitFactor)}`,
      `n=${perf.closedTrades}`,
    ].map((t) => `<span>${t}</span>`).join('');
  }

  function setFootLive(ok) {
    const d = $('foot-dot');
    if (!d) return;
    d.className = 'foot-dot' + (ok ? ' live' : ' err');
  }

  function render(data, latencyMs) {
    setPill($('conn'), 'online', 'pill-ok');
    setFootLive(true);
    if ($('latency') && latencyMs != null) {
      $('latency').textContent = `${latencyMs} ms`;
    }
    pushWorld(data);
    renderSignal(data);
    renderQuote(data);
    renderMeta(data);
    renderAccount(data);
    renderRiskKv(data);
    renderWatchlist(data.watchlist);
    renderPositions(data.openPositions);
    renderTrades(data.trades);
    renderEquity(data.equityCurve || []);
    renderStats(data.performance);
    if ($('last-fetch')) $('last-fetch').textContent = fmtTime(data.ts || Date.now());
    if ($('refresh-sec')) $('refresh-sec').textContent = String(REFRESH_MS / 1000);
  }

  function renderError(err) {
    setPill($('conn'), 'offline', 'pill-bad');
    setFootLive(false);
    showBanner(`Showcase offline — ${err || 'API unreachable'}`);
    if ($('thought-action')) {
      $('thought-action').textContent = 'Feed unavailable';
      $('thought-action').className = 'signal-action bad';
    }
    if ($('thought-reason')) $('thought-reason').textContent = err || '';
    if ($('latency')) $('latency').textContent = '—';
  }

  async function fetchDashboard() {
    const t0 = performance.now();
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch('/api/dashboard', { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'bad payload');
      const ms = Math.round(performance.now() - t0);
      hideBanner();
      render(data, ms);
    } catch (e) {
      renderError(e.name === 'AbortError' ? 'timeout' : (e.message || String(e)));
    }
  }

  function tickClock() {
    const el = $('clock');
    if (el) {
      el.textContent = new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    }
  }

  function start() {
    const canvas = $('world-canvas');
    if (canvas && window.H2BBMiniWorld) world = new window.H2BBMiniWorld(canvas);
    tickClock();
    setInterval(tickClock, 1000);
    fetchDashboard();
    setInterval(fetchDashboard, REFRESH_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
