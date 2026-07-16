/**
 * Hermes Live — professional data overlay (no character on stage)
 * Video provides brand context; canvas draws clean market HUD only.
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
      };
      this._videoA = document.getElementById('bg-video');
      this._videoB = document.getElementById('bg-video-b');
      this._scrim = document.getElementById('bg-scrim');
      this._ensureVideos();
      this._resize();
      window.addEventListener('resize', () => this._resize());
      this._last = performance.now();
      this._raf = null;
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
      this._syncVideo(s.mood);
    }

    _syncVideo(mood) {
      if (!this._videoA || !this._videoB) return;
      const hangar = mood === 'paused' || mood === 'bear';
      if (hangar) {
        this._videoB.hidden = false;
        this._videoB.classList.add('visible');
        this._videoA.classList.add('dimmed');
        this._videoB.play?.().catch(() => {});
      } else {
        this._videoB.classList.remove('visible');
        this._videoA.classList.remove('dimmed');
      }
      if (this._scrim) this._scrim.dataset.mood = mood;
    }

    start() {
      if (this._raf) return;
      const loop = (now) => {
        this.t += Math.min(0.05, (now - this._last) / 1000);
        this._last = now;
        this.draw();
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    }

    _resize() {
      const parent = this.canvas.parentElement || this.canvas;
      const rect = parent.getBoundingClientRect();
      this.dpr = Math.min((window.devicePixelRatio || 1) * 1.25, 2.5);
      this.w = Math.max(320, rect.width || window.innerWidth);
      this.h = Math.max(280, rect.height || window.innerHeight);
      this.canvas.width = Math.floor(this.w * this.dpr);
      this.canvas.height = Math.floor(this.h * this.dpr);
      this.canvas.style.width = `${this.w}px`;
      this.canvas.style.height = `${this.h}px`;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.ctx.imageSmoothingEnabled = true;
    }

    draw() {
      const ctx = this.ctx;
      const { w, h } = this;
      ctx.clearRect(0, 0, w, h);

      // subtle professional frame lines only — no cartoon world
      this._frame(ctx, w, h);
      this._statusDot(ctx, w, h);
    }

    _frame(ctx, w, h) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      // corner marks
      const L = 18;
      const m = 16;
      const corners = [
        [m, m, 1, 1],
        [w - m, m, -1, 1],
        [m, h - m - 28, 1, -1],
        [w - m, h - m - 28, -1, -1],
      ];
      corners.forEach(([x, y, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x, y + sy * L);
        ctx.lineTo(x, y);
        ctx.lineTo(x + sx * L, y);
        ctx.stroke();
      });
      ctx.restore();
    }

    _statusDot(ctx, w, h) {
      const s = this.state;
      const x = w - 28;
      const y = 88;
      const pulse = 0.55 + 0.45 * Math.sin(this.t * 2.5);
      let col = 'rgba(230,184,77,';
      if (s.active && !s.blocked) col = 'rgba(61,214,140,';
      if (s.blocked) col = 'rgba(240,113,120,';
      ctx.fillStyle = col + (0.25 + pulse * 0.35) + ')';
      ctx.beginPath();
      ctx.arc(x, y, 5 + pulse * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = col + '0.95)';
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  global.H2BBMiniWorld = MiniWorld;
})(typeof window !== 'undefined' ? window : globalThis);
