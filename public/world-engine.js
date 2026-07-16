/**
 * H2BB Minimondo — video context + holographic data overlay
 * Background = compressed clips from _AI_Media (ops / hangar).
 * Canvas = transparent HUD only. NO PFP on island / scene.
 * Data = real Hyperliquid via setState from /api/dashboard.
 */
(function (global) {
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, rr);
    else {
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }
  }

  class MiniWorld {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
      this.w = 0;
      this.h = 0;
      this.dpr = 1;
      this.t = 0;
      this.state = {
        mood: 'calm',
        active: false,
        operational: false,
        blocked: false,
        pair: 'ETH',
        price: null,
        score: null,
        minScore: 65,
        regime: null,
        position: 0,
        pnl: null,
        equity: null,
        accountValuePerp: null,
        usdcSpotAvailable: null,
        funding: null,
        watchlist: [],
        openPositions: [],
        signals: [],
      };
      this.particles = [];
      this._resize();
      this._seed();
      window.addEventListener('resize', () => this._resize());
      this._last = performance.now();
      this._raf = null;
      this._videoA = document.getElementById('bg-video');
      this._videoB = document.getElementById('bg-video-b');
      this._scrim = document.getElementById('bg-scrim');
      this._ensureVideos();
      this.start();
    }

    _ensureVideos() {
      [this._videoA, this._videoB].forEach((v) => {
        if (!v) return;
        v.muted = true;
        v.playsInline = true;
        v.loop = true;
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      });
    }

    setState(partial) {
      Object.assign(this.state, partial || {});
      const s = this.state;
      if (s.blocked) s.mood = 'storm';
      else if (!s.active) s.mood = 'paused';
      else if (s.score != null && s.minScore != null && s.score >= s.minScore) s.mood = 'bull';
      else if (s.pnl != null && s.pnl < -0.5) s.mood = 'bear';
      else s.mood = 'calm';
      this._syncVideoMood(s.mood);
    }

    _syncVideoMood(mood) {
      // ops (cyber green) default; hangar (cinematic) when paused / bear
      const useHangar = mood === 'paused' || mood === 'bear';
      if (!this._videoA || !this._videoB) return;
      if (useHangar) {
        this._videoB.hidden = false;
        this._videoB.classList.add('visible');
        this._videoA.classList.add('dimmed');
        this._videoB.play?.().catch(() => {});
      } else {
        this._videoB.classList.remove('visible');
        this._videoA.classList.remove('dimmed');
      }
      if (this._scrim) {
        this._scrim.dataset.mood = mood;
      }
    }

    start() {
      if (this._raf) return;
      const loop = (now) => {
        const dt = Math.min(0.05, (now - this._last) / 1000);
        this._last = now;
        this.t += dt;
        this.draw();
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    }

    _resize() {
      const parent = this.canvas.parentElement || this.canvas;
      const rect = parent.getBoundingClientRect();
      this.dpr = Math.min((window.devicePixelRatio || 1) * 1.5, 3);
      this.w = Math.max(320, rect.width || window.innerWidth);
      this.h = Math.max(280, rect.height || window.innerHeight);
      const maxPix = 3840 * 2160;
      if (this.w * this.h * this.dpr * this.dpr > maxPix) {
        this.dpr = Math.sqrt(maxPix / (this.w * this.h));
      }
      this.canvas.width = Math.floor(this.w * this.dpr);
      this.canvas.height = Math.floor(this.h * this.dpr);
      this.canvas.style.width = `${this.w}px`;
      this.canvas.style.height = `${this.h}px`;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = true;
      try { this.ctx.imageSmoothingQuality = 'high'; } catch { /* */ }
      this._seed();
    }

    _seed() {
      this.particles = Array.from({ length: 48 }, () => ({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        r: Math.random() * 1.4 + 0.3,
        sp: 8 + Math.random() * 20,
        ph: Math.random() * 10,
      }));
    }

    draw() {
      const ctx = this.ctx;
      const { w, h, t } = this;
      const s = this.state;

      // transparent clear — video shows through
      ctx.clearRect(0, 0, w, h);

      // subtle cyber grid overlay (HermesBro ops vibe)
      this._grid(ctx, w, h, t);

      // floating particles
      this._particles(ctx, w, h, t);

      // market chips (real mids)
      this._marketChips(ctx, w, h, s, t);

      // position markers (no character PFP)
      this._positionMarkers(ctx, w, h, s, t);

      // main data hologram panel (center-left)
      this._holoPanel(ctx, w, h, s, t);

      // edge vignette so text stays readable
      this._vignette(ctx, w, h);
    }

    _grid(ctx, w, h, t) {
      ctx.save();
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.06)';
      ctx.lineWidth = 1;
      const step = 48;
      const off = (t * 12) % step;
      for (let x = -step + off; x < w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = -step + off * 0.5; y < h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      // scan line
      const sy = ((t * 40) % (h + 80)) - 40;
      const g = ctx.createLinearGradient(0, sy - 30, 0, sy + 30);
      g.addColorStop(0, 'transparent');
      g.addColorStop(0.5, 'rgba(34,197,94,0.07)');
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, sy - 30, w, 60);
      ctx.restore();
    }

    _particles(ctx, w, h, t) {
      ctx.save();
      for (const p of this.particles) {
        const x = (p.x + Math.sin(t * 0.4 + p.ph) * 30 + w) % w;
        const y = (p.y - t * p.sp * 0.2 + h * 4) % h;
        const a = 0.15 + 0.25 * (0.5 + 0.5 * Math.sin(t * 2 + p.ph));
        ctx.fillStyle = `rgba(74,222,128,${a})`;
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    _marketChips(ctx, w, h, s, t) {
      const list = s.watchlist || [];
      if (!list.length) return;
      const baseY = h * 0.14;
      list.slice(0, 6).forEach((item, i) => {
        const x = w * 0.12 + (i % 3) * Math.min(160, w * 0.18);
        const y = baseY + Math.floor(i / 3) * 58 + Math.sin(t * 1.2 + i) * 3;
        const pair = String(item.pair || '—');
        const price = item.price != null
          ? `$${Number(item.price).toLocaleString('en-US', { maximumFractionDigits: pair === 'BTC' ? 0 : 2 })}`
          : '—';
        ctx.save();
        ctx.fillStyle = 'rgba(2,12,8,0.72)';
        ctx.strokeStyle = 'rgba(74,222,128,0.35)';
        ctx.lineWidth = 1.2;
        roundRect(ctx, x, y, 140, 48, 12);
        ctx.fill();
        ctx.stroke();
        // accent bar
        ctx.fillStyle = 'rgba(34,197,94,0.85)';
        ctx.fillRect(x, y + 10, 3, 28);
        ctx.font = '700 10px "DM Sans", system-ui';
        ctx.fillStyle = '#86efac';
        ctx.textAlign = 'left';
        ctx.fillText(pair, x + 12, y + 18);
        ctx.font = '600 14px "JetBrains Mono", monospace';
        ctx.fillStyle = '#f0fdf4';
        ctx.fillText(price, x + 12, y + 36);
        ctx.restore();
      });
    }

    _positionMarkers(ctx, w, h, s, t) {
      const positions = s.openPositions?.length
        ? s.openPositions
        : (Math.abs(s.position) > 1e-9
          ? [{ coin: s.pair, size: s.position, side: s.position > 0 ? 'long' : 'short', unrealizedPnl: s.pnl }]
          : []);
      if (!positions.length) return;

      positions.slice(0, 4).forEach((p, i) => {
        const isLong = p.side === 'long' || p.size > 0;
        const x = w * 0.55 + i * 20 + Math.sin(t + i) * 6;
        const y = h * 0.62 + i * 28;
        const col = isLong ? '#4ade80' : '#fb7185';
        ctx.save();
        // marker
        ctx.fillStyle = 'rgba(2,12,8,0.75)';
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        roundRect(ctx, x, y, 168, 36, 10);
        ctx.fill();
        ctx.stroke();
        ctx.font = '700 11px "JetBrains Mono", monospace';
        ctx.fillStyle = col;
        ctx.textAlign = 'left';
        const pnl = p.unrealizedPnl != null
          ? `${p.unrealizedPnl >= 0 ? '+' : ''}${Number(p.unrealizedPnl).toFixed(2)}`
          : '—';
        ctx.fillText(`${p.coin || s.pair} ${isLong ? 'LONG' : 'SHORT'}  ${pnl}`, x + 12, y + 22);
        ctx.restore();
      });
    }

    _holoPanel(ctx, w, h, s, t) {
      const pw = Math.min(320, w * 0.34);
      const ph = 200;
      const x = 24;
      const y = h * 0.42;

      ctx.save();
      // glass
      ctx.fillStyle = 'rgba(2, 14, 10, 0.78)';
      ctx.strokeStyle = 'rgba(74,222,128,0.4)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, x, y, pw, ph, 16);
      ctx.fill();
      ctx.stroke();

      // top glow line
      const lg = ctx.createLinearGradient(x, y, x + pw, y);
      lg.addColorStop(0, 'transparent');
      lg.addColorStop(0.5, 'rgba(74,222,128,0.7)');
      lg.addColorStop(1, 'transparent');
      ctx.strokeStyle = lg;
      ctx.beginPath();
      ctx.moveTo(x + 16, y + 1);
      ctx.lineTo(x + pw - 16, y + 1);
      ctx.stroke();

      // title
      ctx.font = '700 11px "DM Sans", system-ui';
      ctx.fillStyle = '#86efac';
      ctx.textAlign = 'left';
      ctx.fillText('HYPERLIQUID · LIVE', x + 18, y + 26);

      const pair = s.pair || 'ETH';
      const price = s.price != null
        ? `$${Number(s.price).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
        : '—';
      ctx.font = '600 28px "JetBrains Mono", monospace';
      ctx.fillStyle = '#f0fdf4';
      ctx.fillText(`${pair}  ${price}`, x + 18, y + 62);

      const rows = [
        ['Equity', s.equity != null ? `$${Number(s.equity).toFixed(2)}` : '—'],
        ['Perp AV', s.accountValuePerp != null ? `$${Number(s.accountValuePerp).toFixed(2)}` : '—'],
        ['Spot avail', s.usdcSpotAvailable != null ? `$${Number(s.usdcSpotAvailable).toFixed(2)}` : '—'],
        ['uPnL', s.pnl != null ? `${s.pnl >= 0 ? '+' : ''}$${Number(s.pnl).toFixed(2)}` : '—'],
        ['Score', s.score != null ? `${Math.round(s.score)} / ${s.minScore ?? '—'}` : '—'],
        ['Funding', s.funding != null ? `${(s.funding * 100).toFixed(4)}%` : '—'],
      ];
      ctx.font = '500 12px "JetBrains Mono", monospace';
      rows.forEach((r, i) => {
        const yy = y + 88 + i * 16;
        ctx.fillStyle = '#64748b';
        ctx.fillText(r[0], x + 18, yy);
        ctx.fillStyle = r[0] === 'uPnL' && s.pnl != null
          ? (s.pnl >= 0 ? '#4ade80' : '#fb7185')
          : '#e2e8f0';
        ctx.textAlign = 'right';
        ctx.fillText(r[1], x + pw - 18, yy);
        ctx.textAlign = 'left';
      });

      // engine pulse
      const pulse = 0.5 + 0.5 * Math.sin(t * 3);
      ctx.fillStyle = !s.active
        ? `rgba(251,191,36,${0.4 + pulse * 0.2})`
        : s.blocked
          ? `rgba(251,113,133,${0.5 + pulse * 0.3})`
          : `rgba(74,222,128,${0.5 + pulse * 0.4})`;
      ctx.beginPath();
      ctx.arc(x + pw - 22, y + 22, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    _vignette(ctx, w, h) {
      const g = ctx.createRadialGradient(w * 0.45, h * 0.5, h * 0.2, w * 0.5, h * 0.5, h * 0.75);
      g.addColorStop(0, 'transparent');
      g.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // right fade for panel edge
      const rg = ctx.createLinearGradient(w * 0.75, 0, w, 0);
      rg.addColorStop(0, 'transparent');
      rg.addColorStop(1, 'rgba(2,6,23,0.55)');
      ctx.fillStyle = rg;
      ctx.fillRect(w * 0.75, 0, w * 0.25, h);
    }
  }

  global.H2BBMiniWorld = MiniWorld;
})(typeof window !== 'undefined' ? window : globalThis);
