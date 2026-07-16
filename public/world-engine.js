/**
 * H2BB Minimondo v4 — cinematic canvas world (8K supersampled)
 * Renders at high internal resolution (up to 8K pixel budget) then scales crisp to display.
 * ?quality=8k|ultra|high|low
 */
(function (global) {
  const QUALITY_PRESETS = {
    // True "8K-class" supersampling: dense samples, high DPR, large pixel budget
    '8k': {
      label: '8K',
      ss: 2.5,
      maxDpr: 5,
      // ~16.5MP ≈ half of full 8K still; keeps 60fps on decent GPUs while looking ultra-sharp
      maxPixels: 7680 * 2160,
      waveStep: 1.5,
      starDiv: 2200,
      dustN: 90,
      foamN: 90,
      rainN: 140,
    },
    ultra: {
      label: 'ULTRA',
      ss: 2,
      maxDpr: 4,
      maxPixels: 3840 * 2160,
      waveStep: 2,
      starDiv: 2800,
      dustN: 70,
      foamN: 70,
      rainN: 110,
    },
    high: {
      label: 'HIGH',
      ss: 1.5,
      maxDpr: 3,
      maxPixels: 2560 * 1440,
      waveStep: 3,
      starDiv: 4500,
      dustN: 50,
      foamN: 50,
      rainN: 80,
    },
    low: {
      label: 'LOW',
      ss: 1,
      maxDpr: 1.5,
      maxPixels: 1280 * 720,
      waveStep: 6,
      starDiv: 9000,
      dustN: 25,
      foamN: 28,
      rainN: 40,
    },
  };

  function resolveQuality() {
    let key = '8k';
    try {
      const q = new URLSearchParams(location.search).get('quality');
      if (q && QUALITY_PRESETS[q.toLowerCase()]) key = q.toLowerCase();
    } catch { /* ignore */ }
    // Mobile: auto-downgrade unless forced
    try {
      const force = new URLSearchParams(location.search).get('quality');
      if (!force && (navigator.maxTouchPoints > 0 || window.innerWidth < 900)) {
        key = 'high';
      }
    } catch { /* ignore */ }
    return { key, ...QUALITY_PRESETS[key] };
  }

  class MiniWorld {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', {
        alpha: false,
        desynchronized: true,
        colorSpace: 'srgb',
      });
      this.w = 0;
      this.h = 0;
      this.dpr = 1;
      this.quality = resolveQuality();
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
        watchlist: [],
        openPositions: [],
      };
      this.stars = [];
      this.dust = [];
      this.foam = [];
      this.rain = [];
      this.hermesImg = null;
      this.hermesReady = false;
      this._flash = 0;
      this._loadHermes();
      this._resize();
      this._seed();
      window.addEventListener('resize', () => this._resize());
      this._last = performance.now();
      this._raf = null;
      this.start();
    }

    _loadHermes() {
      const img = new Image();
      img.decoding = 'async';
      // hint browser to decode at full res
      try { img.loading = 'eager'; } catch { /* ignore */ }
      img.onload = () => { this.hermesImg = img; this.hermesReady = true; };
      img.onerror = () => { this.hermesReady = false; };
      img.src = '/assets/hermes.jpg?v=3';
    }

    _applyCtxQuality(ctx) {
      ctx.imageSmoothingEnabled = true;
      try { ctx.imageSmoothingQuality = 'high'; } catch { /* ignore */ }
      try { ctx.textRendering = 'optimizeQuality'; } catch { /* ignore */ }
    }

    setState(partial) {
      Object.assign(this.state, partial || {});
      const s = this.state;
      if (s.blocked) s.mood = 'storm';
      else if (!s.active) s.mood = 'paused';
      else if (s.regime === 'trending' && s.score != null && s.minScore != null && s.score >= s.minScore) s.mood = 'bull';
      else if (s.pnl != null && s.pnl < -0.5) s.mood = 'bear';
      else s.mood = 'calm';
    }

    start() {
      if (this._raf) return;
      const loop = (now) => {
        const dt = Math.min(0.05, (now - this._last) / 1000);
        this._last = now;
        this.t += dt;
        if (this.state.mood === 'storm' && Math.random() < 0.008) this._flash = 1;
        this._flash *= 0.88;
        this.draw();
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    }

    _resize() {
      this.quality = resolveQuality();
      const parent = this.canvas.parentElement || this.canvas;
      const rect = parent.getBoundingClientRect();
      this.w = Math.max(320, rect.width || window.innerWidth);
      this.h = Math.max(280, rect.height || window.innerHeight);

      const native = window.devicePixelRatio || 1;
      let dpr = Math.min(native * this.quality.ss, this.quality.maxDpr);
      // Cap total backing-store pixels (8K budget class)
      const maxPix = this.quality.maxPixels;
      const need = this.w * this.h * dpr * dpr;
      if (need > maxPix) {
        dpr = Math.sqrt(maxPix / (this.w * this.h));
      }
      // Floor for retina readability
      dpr = Math.max(dpr, Math.min(native, 1.5));

      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.floor(this.w * dpr));
      this.canvas.height = Math.max(1, Math.floor(this.h * dpr));
      this.canvas.style.width = `${this.w}px`;
      this.canvas.style.height = `${this.h}px`;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._applyCtxQuality(this.ctx);
      this._seed();
    }

    _seed() {
      const area = this.w * this.h;
      const q = this.quality;
      const starN = Math.min(6000, Math.floor(area / q.starDiv));
      this.stars = Array.from({ length: starN }, () => ({
        x: Math.random() * this.w,
        y: Math.random() * this.h * 0.58,
        r: Math.random() * 1.6 + 0.2,
        a: Math.random() * Math.PI * 2,
        sp: 0.3 + Math.random() * 1.4,
        layer: Math.random(),
        cold: Math.random() > 0.65,
      }));
      this.dust = Array.from({ length: q.dustN }, () => ({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        r: Math.random() * 1.2 + 0.3,
        sp: 4 + Math.random() * 12,
        ph: Math.random() * 10,
      }));
      this.foam = Array.from({ length: q.foamN }, () => ({
        x: Math.random() * this.w,
        y: 0.58 + Math.random() * 0.35,
        s: 0.4 + Math.random() * 1.8,
        ph: Math.random() * 10,
        sp: 8 + Math.random() * 18,
      }));
      this.rain = Array.from({ length: q.rainN }, () => ({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        l: 8 + Math.random() * 14,
        sp: 280 + Math.random() * 220,
      }));
    }

    _palette() {
      const palettes = {
        calm: {
          top: '#050a16', mid: '#0c2340', bot: '#0b4f78',
          seaTop: '#0e7490', seaMid: '#0c4a6e', seaBot: '#020617',
          glow: 'rgba(56,189,248,0.18)',
          sun: ['#fffbeb', '#fcd34d', '#f59e0b'],
          fog: 'rgba(2,6,23,0.5)',
          accent: '#38bdf8',
        },
        paused: {
          top: '#0a0e16', mid: '#1a2332', bot: '#2d3a4d',
          seaTop: '#334155', seaMid: '#1e293b', seaBot: '#020617',
          glow: 'rgba(148,163,184,0.12)',
          sun: ['#f8fafc', '#94a3b8', '#64748b'],
          fog: 'rgba(2,6,23,0.55)',
          accent: '#94a3b8',
        },
        bull: {
          top: '#021412', mid: '#0a3d38', bot: '#0e7490',
          seaTop: '#14b8a6', seaMid: '#0f766e', seaBot: '#042f2e',
          glow: 'rgba(45,212,191,0.2)',
          sun: ['#ecfdf5', '#5eead4', '#14b8a6'],
          fog: 'rgba(2,20,18,0.45)',
          accent: '#2dd4bf',
        },
        bear: {
          top: '#1a080c', mid: '#6b1520', bot: '#1e293b',
          seaTop: '#9f1239', seaMid: '#4c0519', seaBot: '#0c0a09',
          glow: 'rgba(251,113,133,0.14)',
          sun: ['#fff1f2', '#fb7185', '#be123c'],
          fog: 'rgba(20,5,8,0.5)',
          accent: '#fb7185',
        },
        storm: {
          top: '#0c0818', mid: '#2a2460', bot: '#1e1b4b',
          seaTop: '#4338ca', seaMid: '#312e81', seaBot: '#020617',
          glow: 'rgba(165,180,252,0.16)',
          sun: ['#e0e7ff', '#a5b4fc', '#6366f1'],
          fog: 'rgba(5,5,20,0.55)',
          accent: '#a5b4fc',
        },
      };
      return palettes[this.state.mood] || palettes.calm;
    }

    draw() {
      const ctx = this.ctx;
      const { w, h, t } = this;
      const pal = this._palette();
      const seaY = h * 0.56;
      const camY = Math.sin(t * 0.35) * 2;

      ctx.save();
      ctx.translate(0, camY);

      // Sky
      this._sky(ctx, w, h, seaY, pal);
      this._stars(ctx, t);
      this._clouds(ctx, w, seaY, t);
      this._celestial(ctx, w * 0.76, h * 0.14, 32, pal, t);
      if (this.state.mood === 'bull') this._aurora(ctx, w, h * 0.1, t);
      if (this.state.mood === 'storm') this._rain(ctx, w, h, t);

      // Distant isles
      this._marketIsles(ctx, w, seaY, t);

      // Sea + reflection plate
      this._sea(ctx, w, h, seaY, pal, t);

      // Main island
      const ix = w * 0.48;
      const iy = seaY + 6;
      this._island(ctx, ix, iy, pal, t);

      // Ships
      this._ships(ctx, w, seaY, t);

      // Dust motes
      this._dust(ctx, w, h, t, pal);

      ctx.restore();

      // Post: vignette + film grain + flash
      this._post(ctx, w, h, pal);

      // HUD
      this._hud(ctx, w, h, seaY);
    }

    _sky(ctx, w, h, seaY, pal) {
      const g = ctx.createLinearGradient(0, 0, 0, seaY + 60);
      g.addColorStop(0, pal.top);
      g.addColorStop(0.4, pal.mid);
      g.addColorStop(0.85, pal.bot);
      g.addColorStop(1, pal.seaTop);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // horizon glow
      const hg = ctx.createRadialGradient(w * 0.5, seaY, 20, w * 0.5, seaY, w * 0.65);
      hg.addColorStop(0, pal.glow);
      hg.addColorStop(0.5, pal.glow.replace(/[\d.]+\)$/, '0.06)'));
      hg.addColorStop(1, 'transparent');
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, w, seaY + 80);
    }

    _stars(ctx, t) {
      for (const s of this.stars) {
        const tw = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * s.sp + s.a * 8));
        const px = s.x + Math.sin(t * 0.05 * s.layer) * s.layer * 8;
        ctx.beginPath();
        if (s.cold) ctx.fillStyle = `rgba(186,230,253,${tw * 0.85})`;
        else ctx.fillStyle = `rgba(255,255,255,${tw})`;
        ctx.arc(px, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        if (s.r > 1.2 && tw > 0.7) {
          ctx.strokeStyle = s.cold ? `rgba(186,230,253,${tw * 0.25})` : `rgba(255,255,255,${tw * 0.2})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(px - s.r * 2.5, s.y);
          ctx.lineTo(px + s.r * 2.5, s.y);
          ctx.moveTo(px, s.y - s.r * 2.5);
          ctx.lineTo(px, s.y + s.r * 2.5);
          ctx.stroke();
        }
      }
    }

    _clouds(ctx, w, seaY, t) {
      const draw = (x, y, sc, a) => {
        ctx.save();
        ctx.globalAlpha = a;
        const g = ctx.createRadialGradient(x, y, 2, x, y, 70 * sc);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(0.4, 'rgba(226,232,240,0.2)');
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, 60 * sc, 20 * sc, 0, 0, Math.PI * 2);
        ctx.ellipse(x - 34 * sc, y + 4, 40 * sc, 16 * sc, 0, 0, Math.PI * 2);
        ctx.ellipse(x + 32 * sc, y + 2, 42 * sc, 17 * sc, 0, 0, Math.PI * 2);
        ctx.ellipse(x + 8 * sc, y - 8, 28 * sc, 14 * sc, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };
      const speed = t * 10;
      draw(((speed * 2.2) % (w + 260)) - 120, seaY * 0.24, 1.25, 0.07);
      draw(((speed * 1.4 + 500) % (w + 300)) - 100, seaY * 0.34, 0.95, 0.055);
      draw(((speed * 0.9 + 1100) % (w + 340)) - 140, seaY * 0.2, 1.5, 0.045);
      draw(((speed * 1.8 + 200) % (w + 280)) - 90, seaY * 0.42, 0.75, 0.04);
    }

    _celestial(ctx, x, y, r, pal, t) {
      const [c0, c1, c2] = pal.sun;
      // outer corona
      const corona = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 3.2);
      corona.addColorStop(0, c1);
      corona.addColorStop(0.25, c2);
      corona.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = corona;
      ctx.beginPath();
      ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // rays
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * 0.05);
      ctx.strokeStyle = c1;
      ctx.globalAlpha = 0.12;
      for (let i = 0; i < 12; i++) {
        ctx.rotate(Math.PI / 6);
        ctx.beginPath();
        ctx.moveTo(r * 1.1, 0);
        ctx.lineTo(r * 2.4, 0);
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
      ctx.globalAlpha = 1;

      const core = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 1, x, y, r);
      core.addColorStop(0, c0);
      core.addColorStop(0.45, c1);
      core.addColorStop(1, c2);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();

      // sun path reflection strip on water later uses same x
      this._sunX = x;
      this._sunY = y;
      this._sunR = r;
      this._sunCols = pal.sun;
    }

    _aurora(ctx, w, y0, t) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      for (let band = 0; band < 4; band++) {
        ctx.beginPath();
        ctx.moveTo(0, y0 + 60);
        for (let x = 0; x <= w; x += 12) {
          const y = y0 + 18 + band * 10
            + Math.sin(x * 0.008 + t * 0.7 + band) * 16
            + Math.sin(x * 0.02 - t * 1.1 + band * 2) * 8;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, y0 + 90);
        ctx.lineTo(0, y0 + 90);
        ctx.closePath();
        const g = ctx.createLinearGradient(0, y0, w, y0 + 40);
        g.addColorStop(0, 'transparent');
        g.addColorStop(0.25, `rgba(45,212,191,${0.04 + band * 0.015})`);
        g.addColorStop(0.5, `rgba(56,189,248,${0.06 + band * 0.012})`);
        g.addColorStop(0.75, `rgba(167,139,250,${0.04})`);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.fill();
      }
      ctx.restore();
    }

    _rain(ctx, w, h, t) {
      ctx.save();
      ctx.strokeStyle = 'rgba(186,230,253,0.22)';
      ctx.lineWidth = 1;
      for (const r of this.rain) {
        const y = (r.y + t * r.sp) % (h + 40) - 20;
        const x = (r.x + t * 30) % w;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 2, y + r.l);
        ctx.stroke();
      }
      ctx.restore();
    }

    _sea(ctx, w, h, seaY, pal, t) {
      // base
      const g = ctx.createLinearGradient(0, seaY - 30, 0, h);
      g.addColorStop(0, pal.seaTop);
      g.addColorStop(0.35, pal.seaMid);
      g.addColorStop(1, pal.seaBot);
      ctx.fillStyle = g;
      ctx.fillRect(0, seaY - 20, w, h - seaY + 20);

      // sun pillar reflection
      if (this._sunX != null) {
        const sx = this._sunX;
        const pillar = ctx.createLinearGradient(sx, seaY, sx, h);
        const [c0, c1] = this._sunCols || ['#fff', '#38bdf8'];
        pillar.addColorStop(0, c0.replace(')', ',0.22)').replace('rgb', 'rgba').replace('#fffbeb', 'rgba(255,251,235,0.25)').replace('#ecfdf5', 'rgba(236,253,245,0.22)').replace('#f8fafc', 'rgba(248,250,252,0.2)').replace('#fff1f2', 'rgba(255,241,242,0.2)').replace('#e0e7ff', 'rgba(224,231,255,0.22)'));
        // simpler approach:
      }
      // soft light path
      if (this._sunX != null) {
        ctx.save();
        const sx = this._sunX;
        const pg = ctx.createLinearGradient(sx, seaY, sx, h * 0.95);
        pg.addColorStop(0, 'rgba(255,255,255,0.14)');
        pg.addColorStop(0.4, 'rgba(125,211,252,0.06)');
        pg.addColorStop(1, 'transparent');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.moveTo(sx - 8, seaY);
        ctx.lineTo(sx + 8, seaY);
        ctx.lineTo(sx + 55, h);
        ctx.lineTo(sx - 55, h);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // wave layers — step size from quality (1.5px ≈ 8K-class smoothness)
      const step = this.quality.waveStep || 3;
      const layers = [
        { amp: 5, k: 0.014, sp: 1.4, a: 0.1, y: 0, col: '255,255,255' },
        { amp: 9, k: 0.009, sp: 0.9, a: 0.14, y: 6, col: '125,211,252' },
        { amp: 14, k: 0.006, sp: 0.55, a: 0.2, y: 14, col: '8,47,73' },
        { amp: 20, k: 0.004, sp: 0.35, a: 0.35, y: 24, col: '2,6,23' },
      ];
      for (const L of layers) {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += step) {
          const y = seaY + L.y
            + Math.sin(x * L.k + t * L.sp) * L.amp
            + Math.sin(x * L.k * 2.4 - t * L.sp * 1.3) * L.amp * 0.35
            + Math.sin(x * L.k * 0.5 + t * 0.2) * L.amp * 0.2;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = `rgba(${L.col},${L.a})`;
        ctx.fill();
      }

      // foam crest highlights
      ctx.strokeStyle = 'rgba(224,242,254,0.18)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let x = 0; x <= w; x += Math.max(1, step)) {
        const y = seaY + Math.sin(x * 0.012 + t * 1.2) * 6 + Math.sin(x * 0.03 - t) * 2;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // sparkles
      for (const f of this.foam) {
        const x = (f.x + t * f.sp) % (w + 30) - 10;
        const y = seaY + (f.y - 0.56) * (h - seaY) * 1.1 + Math.sin(t * 2.5 + f.ph) * 2;
        const a = 0.1 + 0.35 * (0.5 + 0.5 * Math.sin(t * 4 + f.ph));
        ctx.fillStyle = `rgba(224,242,254,${a})`;
        ctx.beginPath();
        ctx.arc(x, y, f.s, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    _marketIsles(ctx, w, seaY, t) {
      const list = (this.state.watchlist || [])
        .filter((x) => x.pair && String(x.pair).toUpperCase() !== String(this.state.pair || '').toUpperCase())
        .slice(0, 4);
      const slots = [[0.12, 0.72], [0.88, 0.7], [0.2, 0.62], [0.82, 0.6]];
      const hues = [
        ['#4ade80', '#166534'],
        ['#2dd4bf', '#0f766e'],
        ['#38bdf8', '#075985'],
        ['#c084fc', '#6b21a8'],
      ];
      list.forEach((item, i) => {
        const [px, py] = slots[i];
        const x = w * px;
        const y = seaY * py + Math.sin(t * 1.1 + i * 1.7) * 5;
        this._miniIsle(ctx, x, y, item, hues[i % hues.length], t, i);
      });
    }

    _miniIsle(ctx, x, y, item, [c0, c1], t, i) {
      ctx.save();
      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.ellipse(x, y + 20, 38, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      // rock
      const rock = ctx.createLinearGradient(x, y, x, y + 18);
      rock.addColorStop(0, '#b45309');
      rock.addColorStop(1, '#451a03');
      ctx.fillStyle = rock;
      ctx.beginPath();
      ctx.ellipse(x, y + 12, 36, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      // grass
      const grass = ctx.createLinearGradient(x, y - 10, x, y + 10);
      grass.addColorStop(0, c0);
      grass.addColorStop(1, c1);
      ctx.fillStyle = grass;
      ctx.beginPath();
      ctx.ellipse(x, y, 28, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.beginPath();
      ctx.ellipse(x - 6, y - 3, 12, 4, -0.3, 0, Math.PI * 2);
      ctx.fill();
      // tiny palm
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + 10, y + 2);
      ctx.lineTo(x + 10, y - 12);
      ctx.stroke();
      ctx.fillStyle = c0;
      ctx.beginPath();
      ctx.arc(x + 10, y - 14, 5, 0, Math.PI * 2);
      ctx.fill();

      // labels with glass chip
      const pair = String(item.pair || '');
      const price = item.price != null
        ? `$${Number(item.price).toLocaleString('en-US', { maximumFractionDigits: pair === 'BTC' ? 0 : 2 })}`
        : '—';
      ctx.font = '700 11px "DM Sans", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(8,15,30,0.75)';
      const tw = Math.max(ctx.measureText(pair).width, 48);
      roundRect(ctx, x - tw / 2 - 10, y + 26, tw + 20, 34, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(125,211,252,0.2)';
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(pair, x, y + 40);
      ctx.font = '600 12px "JetBrains Mono", monospace';
      ctx.fillStyle = '#5eead4';
      ctx.fillText(price, x, y + 54);
      ctx.restore();
    }

    _island(ctx, x, y, pal, t) {
      const s = this.state;
      const scale = Math.min(1.25, Math.max(0.9, this.w / 1000));
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);

      // deep water shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(0, 28, 130, 18, 0, 0, Math.PI * 2);
      ctx.fill();

      // underwater shelf
      ctx.fillStyle = 'rgba(8,47,73,0.45)';
      ctx.beginPath();
      ctx.ellipse(0, 18, 125, 16, 0, 0, Math.PI * 2);
      ctx.fill();

      // cliff stack
      this._cliff(ctx, 0, 16, 122, 32, '#92400e', '#451a03');
      this._cliff(ctx, 0, 8, 108, 26, '#b45309', '#78350f');
      this._cliff(ctx, -8, 12, 40, 14, '#a16207', '#713f12'); // left rock
      this._cliff(ctx, 18, 14, 36, 12, '#a16207', '#713f12');

      // grass mesa
      const grass = ctx.createLinearGradient(0, -28, 0, 14);
      grass.addColorStop(0, '#86efac');
      grass.addColorStop(0.35, '#22c55e');
      grass.addColorStop(1, '#14532d');
      ctx.fillStyle = grass;
      ctx.beginPath();
      ctx.ellipse(0, -4, 88, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      // highlight
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.ellipse(-12, -12, 44, 10, -0.25, 0, Math.PI * 2);
      ctx.fill();

      // path
      ctx.strokeStyle = 'rgba(231,229,228,0.5)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(4, 10);
      ctx.quadraticCurveTo(16, -2, 20, -22);
      ctx.stroke();

      // vegetation
      this._tree(ctx, -62, -8, 1.05, t);
      this._tree(ctx, 58, -4, 0.9, t + 1);
      this._tree(ctx, -40, 0, 0.7, t + 2);
      this._bush(ctx, 40, 4, 0.8);
      this._bush(ctx, -20, 8, 0.6);

      // cabin
      this._cabin(ctx, -72, -10, s);

      // lighthouse
      this._lighthouse(ctx, -6, -10, s, t);

      // HERMES full-body mascot
      this._drawHermes(ctx, 52, 2, s, t);

      ctx.restore();
    }

    _cliff(ctx, x, y, rx, ry, c0, c1) {
      const g = ctx.createLinearGradient(x, y - ry, x, y + ry);
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      // edge light
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, y - 2, rx * 0.92, ry * 0.7, 0, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
    }

    _tree(ctx, x, y, sc, t) {
      ctx.save();
      ctx.translate(x, y);
      const sway = Math.sin(t * 1.5 + x) * 0.04;
      ctx.rotate(sway);
      ctx.scale(sc, sc);
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 10);
      ctx.quadraticCurveTo(2, -2, 0, -16);
      ctx.stroke();
      const leaf = (ox, oy, r, c) => {
        const g = ctx.createRadialGradient(ox - 2, oy - 2, 1, ox, oy, r);
        g.addColorStop(0, c);
        g.addColorStop(1, '#14532d');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
        ctx.fill();
      };
      leaf(0, -20, 11, '#4ade80');
      leaf(-9, -15, 8, '#22c55e');
      leaf(9, -16, 8, '#16a34a');
      leaf(3, -28, 7, '#86efac');
      ctx.restore();
    }

    _bush(ctx, x, y, sc) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sc, sc);
      ctx.fillStyle = '#15803d';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.arc(-7, 2, 6, 0, Math.PI * 2);
      ctx.arc(7, 2, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    _cabin(ctx, x, y, s) {
      ctx.save();
      ctx.translate(x, y);
      // body
      const wall = ctx.createLinearGradient(0, 0, 0, 16);
      wall.addColorStop(0, '#57534e');
      wall.addColorStop(1, '#292524');
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, 26, 16);
      // roof
      ctx.fillStyle = '#1c1917';
      ctx.beginPath();
      ctx.moveTo(-2, 0);
      ctx.lineTo(13, -12);
      ctx.lineTo(28, 0);
      ctx.closePath();
      ctx.fill();
      // window glow
      ctx.fillStyle = s.active ? '#fde047' : '#57534e';
      ctx.globalAlpha = s.active ? 0.95 : 0.4;
      ctx.fillRect(8, 5, 7, 6);
      if (s.active) {
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 10;
        ctx.fillRect(8, 5, 7, 6);
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    _lighthouse(ctx, x, y, s, t) {
      ctx.save();
      ctx.translate(x, y);

      // base plinth
      ctx.fillStyle = '#44403c';
      ctx.beginPath();
      ctx.ellipse(0, 22, 20, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // body
      const body = ctx.createLinearGradient(-16, 0, 16, 0);
      body.addColorStop(0, '#334155');
      body.addColorStop(0.4, '#f1f5f9');
      body.addColorStop(0.55, '#e2e8f0');
      body.addColorStop(1, '#1e293b');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(-14, 22);
      ctx.lineTo(-9, -52);
      ctx.lineTo(9, -52);
      ctx.lineTo(14, 22);
      ctx.closePath();
      ctx.fill();

      // stripes
      ctx.fillStyle = 'rgba(15,23,42,0.4)';
      for (let i = 0; i < 5; i++) {
        const yy = -46 + i * 13;
        ctx.beginPath();
        ctx.moveTo(-11 + i * 0.4, yy);
        ctx.lineTo(11 - i * 0.4, yy);
        ctx.lineTo(11 - i * 0.4, yy + 5);
        ctx.lineTo(-11 + i * 0.4, yy + 5);
        ctx.fill();
      }

      // balcony
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(-16, -58, 32, 9);
      ctx.fillStyle = '#334155';
      for (let i = -14; i <= 12; i += 5) {
        ctx.fillRect(i, -64, 2, 6);
      }

      // roof
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.moveTo(-18, -58);
      ctx.lineTo(0, -74);
      ctx.lineTo(18, -58);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#475569';
      ctx.fillRect(-2, -78, 4, 6);

      const on = s.active && !s.blocked;
      const blocked = s.active && s.blocked;

      // light beams
      if (on || blocked) {
        ctx.save();
        ctx.translate(0, -53);
        const ang = Math.sin(t * 0.85) * 0.55;
        ctx.rotate(ang);
        const beam = ctx.createRadialGradient(0, 0, 2, 0, 0, 200);
        if (blocked) {
          beam.addColorStop(0, 'rgba(251,113,133,0.6)');
          beam.addColorStop(0.2, 'rgba(251,113,133,0.15)');
          beam.addColorStop(1, 'transparent');
        } else {
          beam.addColorStop(0, 'rgba(254,243,199,0.75)');
          beam.addColorStop(0.15, 'rgba(250,204,21,0.25)');
          beam.addColorStop(0.45, 'rgba(250,204,21,0.06)');
          beam.addColorStop(1, 'transparent');
        }
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(190, -48);
        ctx.lineTo(190, 48);
        ctx.closePath();
        ctx.fill();
        // reverse
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-110, -28);
        ctx.lineTo(-110, 28);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // lamp
      const lg = ctx.createRadialGradient(-2, -54, 1, 0, -52, 10);
      if (on) {
        lg.addColorStop(0, '#fffbeb');
        lg.addColorStop(0.4, '#facc15');
        lg.addColorStop(1, '#ca8a04');
      } else if (blocked) {
        lg.addColorStop(0, '#ffe4e6');
        lg.addColorStop(1, '#e11d48');
      } else {
        lg.addColorStop(0, '#cbd5e1');
        lg.addColorStop(1, '#475569');
      }
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.arc(0, -52, 9, 0, Math.PI * 2);
      ctx.fill();
      if (on) {
        ctx.shadowColor = '#fde047';
        ctx.shadowBlur = 22;
        ctx.beginPath();
        ctx.arc(0, -52, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#fef9c3';
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      ctx.restore();
    }

    _drawHermes(ctx, x, y, s, t) {
      const bob = Math.sin(t * 2.1) * 3.5;
      ctx.save();
      ctx.translate(x, y + bob);

      // shadow
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(0, 34, 22, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // aura
      if (s.active) {
        const g = ctx.createRadialGradient(0, 0, 5, 0, 0, 55);
        g.addColorStop(0, s.blocked ? 'rgba(251,113,133,0.35)' : 'rgba(56,189,248,0.3)');
        g.addColorStop(0.5, s.blocked ? 'rgba(251,113,133,0.08)' : 'rgba(45,212,191,0.1)');
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 5, 55, 0, Math.PI * 2);
        ctx.fill();
      }

      if (this.hermesReady && this.hermesImg) {
        const img = this.hermesImg;
        // Larger mascot at 8K density
        const fw = this.quality.key === '8k' || this.quality.key === 'ultra' ? 92 : 70;
        const fh = this.quality.key === '8k' || this.quality.key === 'ultra' ? 120 : 92;
        // soft ground plate
        ctx.fillStyle = 'rgba(15,23,42,0.35)';
        ctx.beginPath();
        ctx.ellipse(0, 34, 32, 9, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(0, 32);
        this._applyCtxQuality(ctx);
        ctx.drawImage(img, -fw / 2, -fh, fw, fh);
        ctx.restore();

        // rim light on figure
        ctx.strokeStyle = s.active
          ? (s.blocked ? 'rgba(251,113,133,0.5)' : 'rgba(125,211,252,0.45)')
          : 'rgba(148,163,184,0.3)';
        ctx.lineWidth = 1.5;
        // nameplate
        ctx.font = '700 10px "DM Sans", system-ui, sans-serif';
        const label = 'HERMES';
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(6,10,22,0.88)';
        roundRect(ctx, -tw / 2 - 10, 38, tw + 20, 18, 9);
        ctx.fill();
        ctx.strokeStyle = 'rgba(56,189,248,0.4)';
        ctx.stroke();
        ctx.fillStyle = '#7dd3fc';
        ctx.textAlign = 'center';
        ctx.fillText(label, 0, 50);
      } else {
        ctx.font = '32px serif';
        ctx.fillStyle = '#fde68a';
        ctx.textAlign = 'center';
        ctx.fillText('☿', 0, 10);
      }

      ctx.restore();
    }

    _ships(ctx, w, seaY, t) {
      const s = this.state;
      const positions = s.openPositions?.length
        ? s.openPositions
        : (Math.abs(s.position) > 1e-9
          ? [{ coin: s.pair, size: s.position, side: s.position > 0 ? 'long' : 'short', unrealizedPnl: s.pnl }]
          : []);

      positions.slice(0, 5).forEach((p, i) => {
        const x = w * (0.22 + i * 0.09) + Math.sin(t * 1.2 + i) * 12;
        const y = seaY + 22 + i * 7 + Math.sin(t * 2.1 + i) * 3;
        this._ship(ctx, x, y, p.side === 'long' || p.size > 0, p, t, i);
      });
    }

    _ship(ctx, x, y, isLong, p, t, i) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(t * 2 + i) * 0.06);

      // wake
      ctx.strokeStyle = 'rgba(186,230,253,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-8, 6);
      ctx.quadraticCurveTo(-24, 10 + Math.sin(t * 3) * 2, -40, 8);
      ctx.stroke();

      // hull
      const hull = ctx.createLinearGradient(0, -4, 0, 10);
      hull.addColorStop(0, '#1e293b');
      hull.addColorStop(1, '#020617');
      ctx.fillStyle = hull;
      ctx.beginPath();
      ctx.moveTo(-20, 4);
      ctx.quadraticCurveTo(0, 14, 20, 4);
      ctx.lineTo(16, -2);
      ctx.lineTo(-16, -2);
      ctx.closePath();
      ctx.fill();

      // deck
      ctx.fillStyle = '#334155';
      ctx.fillRect(-12, -7, 24, 6);

      // sails
      ctx.fillStyle = isLong ? '#4ade80' : '#fb7185';
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(0, -32);
      ctx.lineTo(18, -9);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = isLong ? '#86efac' : '#fda4af';
      ctx.beginPath();
      ctx.moveTo(0, -7);
      ctx.lineTo(0, -26);
      ctx.lineTo(-12, -9);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -32);
      ctx.lineTo(0, 2);
      ctx.stroke();
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(0, -33, 2.2, 0, Math.PI * 2);
      ctx.fill();

      const pnl = p.unrealizedPnl;
      const label = `${p.coin || ''} ${isLong ? 'LONG' : 'SHORT'}${pnl != null ? ' ' + (pnl >= 0 ? '+' : '') + Number(pnl).toFixed(2) : ''}`;
      ctx.font = '600 10px "JetBrains Mono", monospace';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(6,10,22,0.88)';
      roundRect(ctx, -tw / 2 - 7, 12, tw + 14, 16, 6);
      ctx.fill();
      ctx.fillStyle = isLong ? '#4ade80' : '#fb7185';
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, 23);
      ctx.restore();
    }

    _dust(ctx, w, h, t, pal) {
      ctx.save();
      for (const d of this.dust) {
        const x = (d.x + Math.sin(t * 0.3 + d.ph) * 20) % w;
        const y = (d.y - t * d.sp * 0.15 + h) % h;
        const a = 0.08 + 0.12 * (0.5 + 0.5 * Math.sin(t + d.ph));
        ctx.fillStyle = `rgba(186,230,253,${a})`;
        ctx.beginPath();
        ctx.arc(x, y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    _post(ctx, w, h, pal) {
      // vignette
      const vig = ctx.createRadialGradient(w * 0.5, h * 0.42, h * 0.15, w * 0.5, h * 0.5, h * 0.78);
      vig.addColorStop(0, 'transparent');
      vig.addColorStop(0.7, 'transparent');
      vig.addColorStop(1, pal.fog);
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      // side curtains
      const left = ctx.createLinearGradient(0, 0, w * 0.12, 0);
      left.addColorStop(0, 'rgba(2,6,23,0.45)');
      left.addColorStop(1, 'transparent');
      ctx.fillStyle = left;
      ctx.fillRect(0, 0, w * 0.12, h);
      const right = ctx.createLinearGradient(w, 0, w * 0.88, 0);
      right.addColorStop(0, 'rgba(2,6,23,0.55)');
      right.addColorStop(1, 'transparent');
      ctx.fillStyle = right;
      ctx.fillRect(w * 0.88, 0, w * 0.12, h);

      // lightning flash
      if (this._flash > 0.05) {
        ctx.fillStyle = `rgba(224,231,255,${this._flash * 0.18})`;
        ctx.fillRect(0, 0, w, h);
      }

      // subtle scanline (very light)
      ctx.fillStyle = 'rgba(0,0,0,0.03)';
      for (let y = 0; y < h; y += 3) {
        ctx.fillRect(0, y, w, 1);
      }
    }

    _hud(ctx, w, h, seaY) {
      const s = this.state;
      const ix = w * 0.48;
      const iy = seaY + 92;

      // pair chip + price under island
      ctx.save();
      ctx.textAlign = 'center';
      const pair = String(s.pair || 'ETH');
      ctx.font = '700 12px "DM Sans", system-ui, sans-serif';
      const pw = ctx.measureText(pair).width;
      ctx.fillStyle = 'rgba(6,10,22,0.8)';
      ctx.strokeStyle = 'rgba(125,211,252,0.28)';
      roundRect(ctx, ix - pw / 2 - 14, iy, pw + 28, 24, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(pair, ix, iy + 16);

      ctx.font = '600 30px "JetBrains Mono", monospace';
      ctx.fillStyle = '#7dd3fc';
      ctx.shadowColor = 'rgba(56,189,248,0.5)';
      ctx.shadowBlur = 18;
      const price = s.price != null
        ? `$${Number(s.price).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
        : '—';
      ctx.fillText(price, ix, iy + 54);
      ctx.shadowBlur = 0;

      // left glass stack
      this._card(ctx, 18, 20, [
        ['FARO', !s.active ? 'Spento' : s.blocked ? 'Tempesta' : s.operational ? 'Acceso' : 'Attivo',
          !s.active ? '#fbbf24' : s.blocked ? '#fb7185' : '#4ade80'],
        ['TESORO', s.equity != null ? `$${Number(s.equity).toFixed(2)}` : '—', '#e2e8f0'],
        ['ROTTA', s.score != null ? `${Math.round(s.score)}/${s.minScore ?? '—'}` : '—',
          s.score != null && s.minScore != null && s.score >= s.minScore ? '#4ade80' : '#e2e8f0'],
      ]);

      // quality badge (8K)
      const qLabel = this.quality.label || '8K';
      const bw = this.canvas.width;
      const bh = this.canvas.height;
      const mp = ((bw * bh) / 1e6).toFixed(1);
      ctx.font = '700 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      const qtxt = `${qLabel} · ${bw}×${bh} · ${mp}MP · ${this.dpr.toFixed(2)}x`;
      const qtw = ctx.measureText(qtxt).width;
      ctx.fillStyle = 'rgba(6,10,22,0.75)';
      roundRect(ctx, 18, this.h - 36, qtw + 20, 20, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(56,189,248,0.35)';
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(qtxt, 28, this.h - 22);

      ctx.restore();
    }

    _card(ctx, x, y, rows) {
      const w = 176;
      const h = 16 + rows.length * 40;
      ctx.fillStyle = 'rgba(6,10,22,0.78)';
      ctx.strokeStyle = 'rgba(125,211,252,0.16)';
      roundRect(ctx, x, y, w, h, 18);
      ctx.fill();
      ctx.stroke();
      // top accent line
      const ag = ctx.createLinearGradient(x, y, x + w, y);
      ag.addColorStop(0, 'transparent');
      ag.addColorStop(0.5, 'rgba(56,189,248,0.35)');
      ag.addColorStop(1, 'transparent');
      ctx.strokeStyle = ag;
      ctx.beginPath();
      ctx.moveTo(x + 16, y + 1);
      ctx.lineTo(x + w - 16, y + 1);
      ctx.stroke();

      rows.forEach((row, i) => {
        const yy = y + 22 + i * 40;
        ctx.font = '650 9px "DM Sans", system-ui';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';
        ctx.fillText(row[0], x + 18, yy);
        ctx.font = '600 16px "JetBrains Mono", monospace';
        ctx.fillStyle = row[2] || '#e2e8f0';
        ctx.fillText(row[1], x + 18, yy + 18);
      });
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, rr);
    } else {
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }
  }

  global.H2BBMiniWorld = MiniWorld;
})(typeof window !== 'undefined' ? window : globalThis);
