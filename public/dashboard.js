/* Hermes Terminal — professional read-only showcase */
(() => {
  const REFRESH_MS = 5000;
  let world = null;
  let lastPrice = null;
  let flashTimer = null;
  /** @type {{ pad: object, t0: number, t1: number, min: number, max: number, w: number, h: number, cssW: number, cssH: number, markers: Array } | null} */
  let tradeChartGeom = null;

  /** TradingView widget state */
  let tvWidget = null;
  let tvSymbolCurrent = null;
  let tvInterval = '15';
  let tvReady = false;
  let tvLoadPromise = null;

  const $ = (id) => document.getElementById(id);

  /** Map bot pair → TradingView symbol (ETHUSD-style spot charts). */
  function pairToTvSymbol(pair) {
    const p = String(pair || 'ETH')
      .toUpperCase()
      .replace(/-PERP|\/|USDC|USDT|USD/g, '')
      .replace(/[^A-Z0-9]/g, '');
    // Prefer COINBASE:*USD (real ETHUSD etc.) — HYPERLIQUID:*USD often missing on TV free widget
    const usd = {
      ETH: 'COINBASE:ETHUSD',
      BTC: 'COINBASE:BTCUSD',
      SOL: 'COINBASE:SOLUSD',
      ARB: 'COINBASE:ARBUSD',
      DOGE: 'COINBASE:DOGEUSD',
      AVAX: 'COINBASE:AVAXUSD',
      LINK: 'COINBASE:LINKUSD',
      OP: 'COINBASE:OPUSD',
      SUI: 'COINBASE:SUIUSD',
      NEAR: 'COINBASE:NEARUSD',
      TIA: 'COINBASE:TIAUSD',
      PEPE: 'COINBASE:PEPEUSD',
      WIF: 'COINBASE:WIFUSD',
      SEI: 'COINBASE:SEIUSD',
    };
    if (usd[p]) return usd[p];
    // Default: PAIRUSD on Coinbase search format; USDT fallback for obscure alts
    if (['HYPE'].includes(p)) return `BINANCE:${p}USDT`;
    return `COINBASE:${p}USD`;
  }

  function loadTvScript() {
    if (window.TradingView) return Promise.resolve();
    if (tvLoadPromise) return tvLoadPromise;
    tvLoadPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="tradingview.com/tv.js"]');
      if (existing && window.TradingView) {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://s3.tradingview.com/tv.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('TradingView script failed'));
      document.head.appendChild(s);
      // if already in HTML, wait a bit
      let n = 0;
      const poll = setInterval(() => {
        if (window.TradingView) {
          clearInterval(poll);
          resolve();
        } else if (++n > 80) {
          clearInterval(poll);
          if (!window.TradingView) reject(new Error('TradingView timeout'));
        }
      }, 50);
    });
    return tvLoadPromise;
  }

  function setTvMeta(symbol) {
    if ($('tv-symbol-pill')) $('tv-symbol-pill').textContent = symbol || '—';
    if ($('tv-bar-src')) $('tv-bar-src').textContent = symbol ? `TradingView · ${symbol}` : 'TradingView';
    const link = $('tv-fallback-link');
    if (link && symbol) {
      link.href = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`;
    }
  }

  function showTvFallback(show) {
    const el = $('tv-fallback');
    if (el) el.hidden = !show;
  }

  function mountTradingView(symbol, interval) {
    const container = $('tv-chart');
    if (!container) return;
    if (!window.TradingView || typeof window.TradingView.widget !== 'function') {
      showTvFallback(true);
      return;
    }

    const sym = symbol || tvSymbolCurrent || 'COINBASE:ETHUSD';
    const iv = interval || tvInterval || '15';
    tvSymbolCurrent = sym;
    tvInterval = iv;
    setTvMeta(sym);
    showTvFallback(false);

    // recreate container (TV widget owns the node)
    container.innerHTML = '';
    const id = 'tv-chart-host';
    const host = document.createElement('div');
    host.id = id;
    host.style.width = '100%';
    host.style.height = '100%';
    host.style.minHeight = '320px';
    container.appendChild(host);

    try {
      // Free Advanced Chart widget options only (not Charting Library)
      tvWidget = new window.TradingView.widget({
        autosize: true,
        symbol: sym,
        interval: iv,
        timezone: 'Etc/UTC',
        theme: 'dark',
        style: '1',
        locale: 'en',
        toolbar_bg: '#0a0e16',
        enable_publishing: false,
        hide_top_toolbar: false,
        hide_legend: false,
        hide_side_toolbar: false,
        allow_symbol_change: true,
        save_image: false,
        withdateranges: true,
        details: false,
        hotlist: false,
        calendar: false,
        studies: ['MASimple@tv-basicstudies'],
        container_id: id,
      });
      tvReady = true;
    } catch (e) {
      console.error('[TV]', e);
      showTvFallback(true);
    }
  }

  async function ensureTradingView(pair) {
    const symbol = pairToTvSymbol(pair);
    try {
      await loadTvScript();
    } catch (e) {
      console.error('[TV] load', e);
      setTvMeta(symbol);
      showTvFallback(true);
      return;
    }
    // only remount if symbol changed (avoid destroy on every poll)
    if (tvReady && tvSymbolCurrent === symbol) {
      setTvMeta(symbol);
      return;
    }
    mountTradingView(symbol, tvInterval);
  }

  function bindTvTimeframes() {
    document.querySelectorAll('.tv-btn[data-tv-tf]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tf = btn.getAttribute('data-tv-tf');
        if (!tf) return;
        document.querySelectorAll('.tv-btn[data-tv-tf]').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        tvInterval = tf;
        if (tvSymbolCurrent) mountTradingView(tvSymbolCurrent, tvInterval);
      });
    });
  }

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

  function renderTrust(data) {
    const t = data.trust;
    const gradeEl = $('trust-grade');
    const scoreEl = $('trust-score');
    const headEl = $('trust-headline');
    const whyEl = $('trust-why');
    const listEl = $('trust-checks');
    const footEl = $('trust-foot');
    if (!gradeEl && !headEl) return;

    if (!t) {
      if (headEl) headEl.textContent = 'Trust report unavailable';
      if (listEl) listEl.innerHTML = '';
      return;
    }

    const status = t.status || 'degraded';
    if (gradeEl) {
      gradeEl.textContent = t.grade || '—';
      gradeEl.className = 'trust-grade ' + status;
      gradeEl.title = `Trust ${status} · grade ${t.grade}`;
    }
    if (scoreEl) {
      scoreEl.textContent = t.score != null ? `${t.score}/100` : '—';
    }
    if (headEl) headEl.textContent = t.headline || '—';
    if (whyEl) {
      whyEl.textContent = t.whyFlat || t.whyNotTrading || '';
      whyEl.hidden = !whyEl.textContent;
    }
    if (listEl) {
      const rows = t.checks || [];
      listEl.innerHTML = rows.map((c) => {
        const st = c.status === 'pass' || c.status === 'warn' || c.status === 'fail' ? c.status : 'warn';
        return `<li class="trust-check ${st}">
          <span class="dot" aria-hidden="true"></span>
          <span class="lbl">${c.label || c.id || 'check'}</span>
          <span class="det">${c.detail || ''}</span>
        </li>`;
      }).join('');
    }
    if (footEl) {
      const parts = [
        t.posture ? `posture ${t.posture}` : null,
        t.signalAgeSec != null ? `signal ${t.signalAgeSec}s` : null,
        t.summary ? `${t.summary.pass}✓ ${t.summary.warns}! ${t.summary.fails}✗` : null,
        'no remote control',
      ].filter(Boolean);
      footEl.textContent = parts.join(' · ');
    }

    // Align quality pill with trust status when present
    const qp = $('quality-pill');
    if (qp && t.status) {
      if (t.status === 'verified') {
        qp.textContent = `TRUST ${t.grade}`;
        qp.className = 'quality-pill ok';
      } else if (t.status === 'degraded') {
        qp.textContent = `TRUST ${t.grade}`;
        qp.className = 'quality-pill warn';
      } else {
        qp.textContent = `TRUST ${t.grade}`;
        qp.className = 'quality-pill bad';
      }
    }
  }

  function renderSignal(data) {
    const eng = data.engine || {};
    const mkt = data.market || {};
    // Prefer live score-based signal (honest). Fallback to lastDecision only if missing.
    const live = data.signalLive;
    const dec = live || data.strategy?.lastDecision || data.strategy?.lastSignal;
    if (dec) {
      const action = (dec.action || '—').toString();
      const label = ({
        buy: 'Buy',
        buy_ready: 'Buy ready',
        add: 'Add',
        sell: 'Sell',
        blocked: 'Blocked',
        wait: 'Wait',
        hold: 'Hold',
        holding: 'In position',
        in_position: 'In position',
        idle: 'Idle',
        scanning: 'Scanning',
      })[action] || action.replace(/_/g, ' ');

      $('thought-code').textContent = dec.reasonCode || '—';
      $('thought-action').textContent = label;
      $('thought-action').className = 'signal-action ' + (
        action === 'buy' || action === 'buy_ready' || action === 'add' ? 'good'
          : action === 'sell' || action === 'blocked' ? 'bad' : ''
      );
      const sc = dec.score != null
        ? `score ${dec.score}${dec.minScore != null ? '/' + dec.minScore : ''}`
        : (mkt.score != null ? `score ${mkt.score}/${mkt.effectiveMin ?? '—'}` : '');
      const stale = data.dataQuality?.signalStale
        ? ` · lastDecision ${data.dataQuality.decisionAgeSec}s ago (not used)`
        : '';
      $('thought-reason').textContent = [dec.reason, sc].filter(Boolean).join(' · ') + (live ? '' : stale);
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
    const pos = data.position || {};
    const pnl = data.pnl || {};
    const q = data.dataQuality || {};

    if ($('orb-equity-val')) {
      $('orb-equity-val').textContent = bal.equity != null ? usd(bal.equity) : '—';
    }
    if ($('panel-mid')) {
      $('panel-mid').textContent = mkt.price != null ? usd(mkt.price, 2) : '—';
    }
    const up = $('panel-upnl');
    if (up) {
      const u = pnl.unrealized != null ? pnl.unrealized : mkt.pnlUnrealized;
      const upct = pnl.unrealizedPct != null ? pnl.unrealizedPct : mkt.pnlPercent;
      up.textContent = u != null
        ? `uPnL ${money(u)}${upct != null ? ` (${fmtPct(upct)})` : ''}`
        : 'uPnL —';
      up.className = 'mono ' + pnlClass(u);
    }
    const dayEl = $('panel-day-pnl');
    if (dayEl) {
      const dUsd = pnl.dayUsd != null ? pnl.dayUsd : data.risk?.dayPnlUsd;
      const dPct = pnl.dayPct != null ? pnl.dayPct : data.risk?.dayPnlPct;
      if (dUsd != null || dPct != null) {
        dayEl.textContent = `day ${dUsd != null ? money(dUsd) : '—'}${dPct != null ? ` (${fmtPct(dPct)})` : ''}`;
        dayEl.className = 'mono ' + pnlClass(dUsd != null ? dUsd : dPct);
      } else {
        dayEl.textContent = 'day —';
        dayEl.className = 'mono';
      }
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
    if ($('panel-rsi')) {
      $('panel-rsi').textContent = mkt.rsi != null ? fmtNum(mkt.rsi, 1) : '—';
    }
    if ($('panel-funding')) {
      $('panel-funding').textContent = mkt.fundingPct != null
        ? `${mkt.fundingPct}%`
        : (mkt.funding != null ? `${(mkt.funding * 100).toFixed(4)}%` : '—');
    }
    if ($('panel-bias')) $('panel-bias').textContent = mkt.bias || data.signalLive?.bias || '—';

    // Position detail
    if ($('pos-side-size')) {
      if (pos.side && pos.side !== 'flat' && pos.size) {
        $('pos-side-size').textContent = `${String(pos.side).toUpperCase()} ${fmtNum(pos.size, 4)}`;
        $('pos-side-size').className = 'metric-value mono ' + (pos.side === 'long' ? 'good' : 'bad');
      } else {
        $('pos-side-size').textContent = 'FLAT';
        $('pos-side-size').className = 'metric-value mono';
      }
    }
    if ($('pos-entry')) $('pos-entry').textContent = pos.entryPx != null ? usd(pos.entryPx, 2) : '—';
    if ($('pos-mark')) $('pos-mark').textContent = pos.markPx != null ? usd(pos.markPx, 2) : (mkt.price != null ? usd(mkt.price, 2) : '—');
    if ($('pos-dist')) {
      if (pos.distanceToEntryPct != null) {
        $('pos-dist').textContent = fmtPct(pos.distanceToEntryPct);
        $('pos-dist').className = 'metric-value mono ' + pnlClass(pos.distanceToEntryPct);
      } else {
        $('pos-dist').textContent = '—';
        $('pos-dist').className = 'metric-value mono';
      }
    }
    if ($('pos-notional')) $('pos-notional').textContent = pos.notional != null ? usd(pos.notional) : '—';
    if ($('pos-lev')) $('pos-lev').textContent = pos.leverage != null ? `${pos.leverage}x` : '—';

    const eqLine = $('equity-check-line');
    if (eqLine) {
      const ec = bal.equityCheck || q.equityCheck;
      if (ec) {
        eqLine.textContent = ec.ok
          ? `Equity check OK · perp+spotAvail = ${usd(ec.expected)}`
          : `Equity check Δ ${money(ec.delta)} · expected ${usd(ec.expected)} vs ${usd(ec.actual)}`;
        eqLine.className = 'truth-line mono ' + (ec.ok ? '' : 'bad');
      } else {
        eqLine.textContent = bal.formula || '';
      }
    }

    const notes = $('market-notes');
    if (notes) {
      notes.textContent = [
        mkt.venue ? `venue ${mkt.venue}` : null,
        mkt.chartRef ? `TV ref ${mkt.chartRef}` : null,
        mkt.baseMinScore != null && mkt.effectiveMin != null && mkt.baseMinScore !== mkt.effectiveMin
          ? `min ${mkt.effectiveMin} (base ${mkt.baseMinScore})`
          : null,
      ].filter(Boolean).join(' · ');
    }

    // quality-pill: prefer trust status (set in renderTrust); fallback if no trust
    const qp = $('quality-pill');
    if (qp && !data.trust) {
      if (q.ok === false) {
        qp.textContent = 'DATA WEAK';
        qp.className = 'quality-pill bad';
      } else if (q.equityCheck && q.equityCheck.ok === false) {
        qp.textContent = 'EQUITY Δ';
        qp.className = 'quality-pill warn';
      } else if (q.ok) {
        qp.textContent = 'HL LIVE';
        qp.className = 'quality-pill ok';
      } else {
        qp.textContent = '—';
        qp.className = 'quality-pill';
      }
    }

    const tick = $('live-ticker');
    if (tick) {
      const parts = [
        `${(mkt.pair || 'ETH').toUpperCase()} mid ${mkt.price != null ? usd(mkt.price) : '—'}`,
        bal.equity != null ? `equity ${usd(bal.equity)}` : null,
        pos.side && pos.side !== 'flat' ? `${pos.side} ${fmtNum(pos.size, 4)} @ ${pos.entryPx != null ? usd(pos.entryPx) : '—'}` : 'flat',
        pnl.unrealized != null ? `uPnL ${money(pnl.unrealized)}` : null,
        pnl.dayUsd != null ? `day ${money(pnl.dayUsd)}` : null,
        mkt.score != null ? `score ${fmtNum(mkt.score, 0)}/${mkt.effectiveMin ?? '—'}` : null,
        mkt.rsi != null ? `RSI ${fmtNum(mkt.rsi, 1)}` : null,
        data.wallet?.addressShort || null,
      ].filter(Boolean);
      tick.textContent = parts.join('   ·   ');
    }
  }

  function renderRiskKv(data) {
    const eng = data.engine || {};
    const mkt = data.market || {};
    const risk = data.risk || {};
    const pnl = data.pnl || {};
    const perf = data.performance || {};
    const q = data.dataQuality || {};
    const kv = $('world-kv');
    if (!kv) return;
    const rows = [
      ['Engine', eng.active ? (eng.operational ? 'running' : 'blocked') : 'paused'],
      ['Mode', data.dataMode || eng.mode || '—'],
      ['Pair', (mkt.pair || eng.pair || '—').toString().toUpperCase()],
      ['Day PnL $', pnl.dayUsd != null ? money(pnl.dayUsd) : (risk.dayPnlUsd != null ? money(risk.dayPnlUsd) : '—')],
      ['Day PnL %', risk.dayPnlPct != null ? fmtPct(risk.dayPnlPct) : '—'],
      ['Drawdown', risk.drawdownPct != null ? fmtPct(risk.drawdownPct) : '—'],
      ['Closed PnL', perf.totalPnl != null ? money(perf.totalPnl) : '—'],
      ['Win rate', perf.closedTrades ? `${perf.winRate}% (n=${perf.closedTrades})` : '—'],
      ['Expectancy', perf.expectancy != null ? money(perf.expectancy) : '—'],
      ['Loss streak', `${risk.consecutiveLosses ?? 0}`],
      ['Uptime', fmtUptime(eng.uptime)],
      ['Decision age', q.decisionAgeSec != null ? `${q.decisionAgeSec}s` : '—'],
    ];
    kv.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v ?? '—'}</dd>`).join('');

    const line = $('hl-truth-line');
    if (line) {
      const hl = data.hlTruth;
      const note = (q.notes && q.notes[0]) || '';
      line.textContent = hl
        ? `HL · mid ${usd(hl.midPrice)} · perp ${usd(hl.perpsAccountValue)} · spot ${usd(hl.spotUsdcAvailable)} · ${note}`
        : (note || 'Live feed from Hyperliquid public API');
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

  function drawTriangle(ctx, x, y, dir, color) {
    const s = 6;
    ctx.beginPath();
    if (dir === 'up') {
      ctx.moveTo(x, y - s);
      ctx.lineTo(x - s * 0.85, y + s * 0.55);
      ctx.lineTo(x + s * 0.85, y + s * 0.55);
    } else {
      ctx.moveTo(x, y + s);
      ctx.lineTo(x - s * 0.85, y - s * 0.55);
      ctx.lineTo(x + s * 0.85, y - s * 0.55);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function renderTradeChart(chart) {
    const canvas = $('trade-chart');
    const empty = $('trade-chart-empty');
    const meta = $('trade-chart-meta');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 360;
    const cssH = 200;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    tradeChartGeom = null;

    const candles = chart?.candles || [];
    const markers = chart?.markers || [];

    if (meta) {
      if (chart?.pair) {
        meta.textContent = `${chart.pair} · ${chart.interval || '—'} · ${chart.buys || 0}B / ${chart.sells || 0}S`;
      } else {
        meta.textContent = '—';
      }
    }

    if (!candles.length) {
      empty?.classList.remove('hidden');
      if (empty) empty.textContent = markers.length
        ? 'Price history unavailable (markers loaded)'
        : 'No price history yet';
      return;
    }
    empty?.classList.add('hidden');

    const pad = { t: 14, r: 12, b: 22, l: 46 };
    const w = cssW - pad.l - pad.r;
    const h = cssH - pad.t - pad.b;
    const t0 = candles[0].t;
    const t1 = candles[candles.length - 1].t || t0 + 1;
    const span = Math.max(1, t1 - t0);

    const prices = candles.flatMap((c) => [c.c, c.h, c.l].filter((v) => Number.isFinite(v)));
    markers.forEach((m) => {
      if (Number.isFinite(m.price)) prices.push(m.price);
    });
    let min = Math.min(...prices);
    let max = Math.max(...prices);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
      min = (min || 0) - 1;
      max = (max || 0) + 1;
    }
    const padY = (max - min) * 0.06;
    min -= padY;
    max += padY;
    const range = max - min;

    const xOf = (t) => pad.l + ((t - t0) / span) * w;
    const yOf = (p) => pad.t + h - ((p - min) / range) * h;

    // grid
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = pad.t + (h * i) / 3;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + w, y);
      ctx.stroke();
    }

    // y labels
    ctx.fillStyle = 'rgba(125,135,153,0.75)';
    ctx.font = '10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(max.toLocaleString('en-US', { maximumFractionDigits: 0 }), pad.l - 6, pad.t + 2);
    ctx.fillText(min.toLocaleString('en-US', { maximumFractionDigits: 0 }), pad.l - 6, pad.t + h);
    ctx.fillText(
      ((min + max) / 2).toLocaleString('en-US', { maximumFractionDigits: 0 }),
      pad.l - 6,
      pad.t + h / 2
    );

    // price line + soft fill
    const pts = candles.map((c) => ({ x: xOf(c.t), y: yOf(c.c), c: c.c, t: c.t }));
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.lineTo(pts[pts.length - 1].x, pad.t + h);
    ctx.lineTo(pts[0].x, pad.t + h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
    grad.addColorStop(0, 'rgba(106,159,212,0.16)');
    grad.addColorStop(1, 'rgba(106,159,212,0)');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.strokeStyle = 'rgba(106, 159, 212, 0.95)';
    ctx.lineWidth = 1.6;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // time labels
    ctx.fillStyle = 'rgba(125,135,153,0.7)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const midT = t0 + span / 2;
    const fmtD = (ms) => {
      try {
        return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      } catch {
        return '';
      }
    };
    ctx.fillText(fmtD(t0), pad.l + 8, pad.t + h + 4);
    ctx.fillText(fmtD(midT), pad.l + w / 2, pad.t + h + 4);
    ctx.fillText(fmtD(t1), pad.l + w - 8, pad.t + h + 4);

    // markers
    const hitMarkers = [];
    markers.forEach((m) => {
      const x = xOf(m.t);
      const y = yOf(m.price);
      if (x < pad.l - 4 || x > pad.l + w + 4) return;
      const isBuy = m.type === 'buy';
      drawTriangle(ctx, x, y, isBuy ? 'up' : 'down', isBuy ? '#2fd48a' : '#f06570');
      hitMarkers.push({ ...m, x, y });
    });

    tradeChartGeom = { pad, t0, t1, min, max, w, h, cssW, cssH, markers: hitMarkers, xOf, yOf };
  }

  function onTradeChartMove(ev) {
    const canvas = $('trade-chart');
    const tip = $('trade-chart-tip');
    if (!canvas || !tip || !tradeChartGeom) {
      if (tip) tip.hidden = true;
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const { markers } = tradeChartGeom;
    let best = null;
    let bestD = 14;
    for (const m of markers) {
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    if (!best) {
      tip.hidden = true;
      return;
    }
    const when = fmtTime(best.t);
    const lines = [
      `${best.type.toUpperCase()} ${best.pair || ''}`.trim(),
      usd(best.price, 2),
      when,
    ];
    if (best.amount != null) lines.push(`qty ${fmtNum(best.amount, 4)}`);
    if (best.pnl != null) lines.push(`pnl ${money(best.pnl)}`);
    tip.textContent = lines.join('\n');
    tip.hidden = false;
    const tw = tip.offsetWidth || 120;
    const th = tip.offsetHeight || 60;
    let left = best.x + 10;
    let top = best.y - th - 8;
    if (left + tw > rect.width - 4) left = best.x - tw - 10;
    if (top < 4) top = best.y + 10;
    tip.style.left = `${Math.max(4, left)}px`;
    tip.style.top = `${Math.max(4, top)}px`;
  }

  function onTradeChartLeave() {
    const tip = $('trade-chart-tip');
    if (tip) tip.hidden = true;
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
    renderTrust(data);
    renderSignal(data);
    renderQuote(data);
    renderMeta(data);
    renderAccount(data);
    renderRiskKv(data);
    renderWatchlist(data.watchlist);
    renderTradeChart(data.priceChart);
    renderPositions(data.openPositions);
    renderTrades(data.trades);
    renderEquity(data.equityCurve || []);
    renderStats(data.performance);
    // Live TradingView follows bot pair
    const pair = data.market?.pair || data.engine?.pair || 'ETH';
    ensureTradingView(pair);
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
    const tradeCanvas = $('trade-chart');
    if (tradeCanvas) {
      tradeCanvas.addEventListener('mousemove', onTradeChartMove);
      tradeCanvas.addEventListener('mouseleave', onTradeChartLeave);
    }
    bindTvTimeframes();
    // mount TV immediately with ETH, then pair sync from API
    ensureTradingView('ETH');
    tickClock();
    setInterval(tickClock, 1000);
    fetchDashboard();
    setInterval(fetchDashboard, REFRESH_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
