/**
 * H2BB Minimondo — cinematic canvas world
 * Draws sky, sea, island, lighthouse, ships, market isles, atmosphere.
 */
(function (global) {
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { return 1 - (1 - t) * (1 - t); }

  class MiniWorld {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.w = 0;
      this.h = 0;
      this.dpr = 1;
      this.t = 0;
      this.state = {
        mood: 'calm', // calm | paused | bull | bear | storm
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
      this.birds = [];
      this.foam = [];
      this.bolts = 0;
      this._resize();
      this._seedStars();
      this._seedFoam();
      window.addEventListener('resize', () => this._resize());
      this._raf = null;
      this._last = performance.now();
      this.start();
    }

    setState( partial ) {
      Object.assign(this.state, partial || {});
      // derive mood
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
        this.draw(dt);
        this._raf = requestAnimationFrame(loop);
      };
      this._raf = requestAnimationFrame(loop);
    }

    _resize() {
      const parent = this.canvas.parentElement || this.canvas;
      const rect = parent.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = Math.max(320, rect.width || window.innerWidth);
      this.h = Math.max(280, rect.height || window.innerHeight);
      this.canvas.width = Math.floor(this.w * this.dpr);
      this.canvas.height = Math.floor(this.h * this.dpr);
      this.canvas.style.width = `${this.w}px`;
      this.canvas.style.height = `${this.h}px`;
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this._seedStars();
      this._seedFoam();
    }

    _seedStars() {
      const n = Math.floor((this.w * this.h) / 9000);
      this.stars = Array.from({ length: n }, () => ({
        x: Math.random() * this.w,
        y: Math.random() * this.h * 0.55,
        r: Math.random() * 1.4 + 0.3,
        a: Math.random(),
        sp: 0.4 + Math.random() * 1.2,
        cold: Math.random() > 0.7,
      }));
    }

    _seedFoam() {
      this.foam = Array.from({ length: 28 }, () => ({
        x: Math.random() * this.w,
        y: 0.62 + Math.random() * 0.3,
        s: 0.5 + Math.random() * 1.5,
        ph: Math.random() * Math.PI * 2,
      }));
    }

    _palette() {
      const m = this.state.mood;
      const pal = {
        calm: {
          top: '#070b18', mid: '#0f2744', bot: '#0a4a6e',
          sea1: '#0c4a6e', sea2: '#082f49', sea3: '#020617',
          glow: 'rgba(56,189,248,0.14)', sun: ['#fff7ed', '#fbbf24', '#d97706'],
        },
        paused: {
          top: '#0b0f17', mid: '#1e293b', bot: '#334155',
          sea1: '#1e293b', sea2: '#0f172a', sea3: '#020617',
          glow: 'rgba(148,163,184,0.1)', sun: ['#f8fafc', '#94a3b8', '#64748b'],
        },
        bull: {
          top: '#021a1a', mid: '#0f4c45', bot: '#0e7490',
          sea1: '#0f766e', sea2: '#115e59', sea3: '#042f2e',
          glow: 'rgba(45,212,191,0.16)', sun: ['#ecfdf5', '#34d399', '#059669'],
        },
        bear: {
          top: '#1c0a0a', mid: '#7f1d1d', bot: '#1e293b',
          sea1: '#7f1d1d', sea2: '#450a0a', sea3: '#0c0a09',
          glow: 'rgba(251,113,133,0.12)', sun: ['#ffe4e6', '#fb7185', '#be123c'],
        },
        storm: {
          top: '#0f0a1e', mid: '#312e81', bot: '#1e1b4b',
          sea1: '#312e81', sea2: '#1e1b4b', sea3: '#020617',
          glow: 'rgba(129,140,248,0.14)', sun: ['#e0e7ff', '#818cf8', '#4338ca'],
        },
      };
      return pal[m] || pal.calm;
    }

    draw() {
      const ctx = this.ctx;
      const { w, h } = this;
      const pal = this._palette();
      const seaY = h * 0.58;

      // --- Sky ---
      const g = ctx.createLinearGradient(0, 0, 0, seaY + 40);
      g.addColorStop(0, pal.top);
      g.addColorStop(0.45, pal.mid);
      g.addColorStop(1, pal.bot);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // horizon bloom
      const hg = ctx.createRadialGradient(w * 0.5, seaY, 10, w * 0.5, seaY, w * 0.55);
      hg.addColorStop(0, pal.glow);
      hg.addColorStop(1, 'transparent');
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, w, h);

      // stars
      for (const s of this.stars) {
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.t * s.sp + s.a * 10));
        ctx.beginPath();
        ctx.fillStyle = s.cold
          ? `rgba(186,230,253,${tw * 0.9})`
          : `rgba(255,255,255,${tw})`;
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // soft clouds
      this._drawClouds(ctx, w, seaY, pal);

      // celestial body
      this._drawSun(ctx, w * 0.78, h * 0.16, 28, pal);

      // aurora when bull
      if (this.state.mood === 'bull') this._drawAurora(ctx, w, h * 0.12);

      // distant islands / watchlist
      this._drawMarketIsles(ctx, w, seaY);

      // sea
      this._drawSea(ctx, w, h, seaY, pal);

      // main island + lighthouse
      const ix = w * 0.5;
      const iy = seaY + 8;
      this._drawIsland(ctx, ix, iy, pal);

      // ships for positions
      this._drawShips(ctx, w, seaY);

      // fog / vignette
      const vig = ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.2, w * 0.5, h * 0.5, h * 0.75);
      vig.addColorStop(0, 'transparent');
      vig.addColorStop(1, 'rgba(2,6,23,0.55)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      // bottom fade into panel world
      const bot = ctx.createLinearGradient(0, h * 0.85, 0, h);
      bot.addColorStop(0, 'transparent');
      bot.addColorStop(1, 'rgba(2,6,23,0.5)');
      ctx.fillStyle = bot;
      ctx.fillRect(0, h * 0.85, w, h * 0.15);

      // HUD labels on world
      this._drawWorldHud(ctx, w, h, seaY);

      // lightning
      if (this.state.mood === 'storm' && Math.sin(this.t * 3) > 0.97) {
        ctx.fillStyle = 'rgba(224,231,255,0.12)';
        ctx.fillRect(0, 0, w, h);
      }
    }

    _drawClouds(ctx, w, seaY, pal) {
      ctx.save();
      const t = this.t * 8;
      const drawBlob = (x, y, sc, a) => {
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath();
        ctx.ellipse(x, y, 52 * sc, 18 * sc, 0, 0, Math.PI * 2);
        ctx.ellipse(x - 30 * sc, y + 4, 34 * sc, 14 * sc, 0, 0, Math.PI * 2);
        ctx.ellipse(x + 28 * sc, y + 2, 36 * sc, 15 * sc, 0, 0, Math.PI * 2);
        ctx.fill();
      };
      drawBlob(((t * 3) % (w + 200)) - 100, seaY * 0.28, 1.1, 0.06);
      drawBlob(((t * 2 + 400) % (w + 240)) - 80, seaY * 0.38, 0.85, 0.05);
      drawBlob(((t * 1.5 + 900) % (w + 280)) - 120, seaY * 0.22, 1.3, 0.045);
      ctx.restore();
    }

    _drawSun(ctx, x, y, r, pal) {
      const [c0, c1, c2] = pal.sun;
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r * 2.2);
      g.addColorStop(0, c0);
      g.addColorStop(0.35, c1);
      g.addColorStop(0.55, c2);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
      ctx.fill();

      const core = ctx.createRadialGradient(x - r * 0.25, y - r * 0.25, 1, x, y, r);
      core.addColorStop(0, c0);
      core.addColorStop(0.5, c1);
      core.addColorStop(1, c2);
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    _drawAurora(ctx, w, y) {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const t = this.t;
      for (let i = 0; i < 3; i++) {
        const g = ctx.createLinearGradient(0, y, w, y + 40);
        g.addColorStop(0, 'transparent');
        g.addColorStop(0.3, `rgba(45,212,191,${0.06 + i * 0.02})`);
        g.addColorStop(0.55, `rgba(56,189,248,${0.08 + i * 0.02})`);
        g.addColorStop(0.8, `rgba(167,139,250,${0.05})`);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, y + 30 + i * 12);
        for (let x = 0; x <= w; x += 20) {
          const yy = y + 20 + i * 10
            + Math.sin(x * 0.01 + t * 0.8 + i) * 14
            + Math.sin(x * 0.02 - t + i) * 8;
          ctx.lineTo(x, yy);
        }
        ctx.lineTo(w, y + 80);
        ctx.lineTo(0, y + 80);
        ctx.fill();
      }
      ctx.restore();
    }

    _drawSea(ctx, w, h, seaY, pal) {
      // base fill
      const sg = ctx.createLinearGradient(0, seaY - 20, 0, h);
      sg.addColorStop(0, pal.sea1);
      sg.addColorStop(0.45, pal.sea2);
      sg.addColorStop(1, pal.sea3);
      ctx.fillStyle = sg;
      ctx.fillRect(0, seaY - 10, w, h - seaY + 10);

      // layered sine waves
      const layers = [
        { amp: 7, len: 0.012, sp: 1.1, col: 'rgba(125,211,252,0.12)', y: 0 },
        { amp: 11, len: 0.008, sp: 0.7, col: 'rgba(14,165,233,0.18)', y: 8 },
        { amp: 16, len: 0.0055, sp: 0.45, col: 'rgba(8,47,73,0.55)', y: 18 },
      ];
      for (const L of layers) {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 6) {
          const y = seaY + L.y
            + Math.sin(x * L.len + this.t * L.sp) * L.amp
            + Math.sin(x * L.len * 2.3 - this.t * L.sp * 1.4) * L.amp * 0.35;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = L.col;
        ctx.fill();
      }

      // specular band
      const sheen = ctx.createLinearGradient(0, seaY, 0, seaY + 50);
      sheen.addColorStop(0, 'rgba(186,230,253,0.18)');
      sheen.addColorStop(1, 'transparent');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, seaY - 4, w, 50);

      // foam dots
      ctx.fillStyle = 'rgba(224,242,254,0.35)';
      for (const f of this.foam) {
        const x = (f.x + this.t * 12 * f.s) % (w + 20) - 10;
        const y = seaY + (f.y - 0.62) * (h - seaY) * 1.2
          + Math.sin(this.t * 2 + f.ph) * 3;
        const a = 0.15 + 0.25 * (0.5 + 0.5 * Math.sin(this.t * 3 + f.ph));
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(x, y, f.s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    _drawMarketIsles(ctx, w, seaY) {
      const list = (this.state.watchlist || [])
        .filter((x) => x.pair && String(x.pair).toUpperCase() !== String(this.state.pair || '').toUpperCase())
        .slice(0, 4);
      const slots = [
        [0.14, 0.78], [0.86, 0.76], [0.22, 0.68], [0.80, 0.66],
      ];
      list.forEach((item, i) => {
        const [px, py] = slots[i] || [0.5, 0.7];
        const x = w * px;
        const y = seaY * py + Math.sin(this.t * 1.2 + i) * 4;
        this._drawMiniIsle(ctx, x, y, item.pair, item.price, i);
      });
    }

    _drawMiniIsle(ctx, x, y, pair, price, i) {
      const colors = ['#22c55e', '#14b8a6', '#38bdf8', '#a78bfa'];
      const c = colors[i % colors.length];
      ctx.save();
      // reflection
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(x, y + 18, 34, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      // rock
      const rock = ctx.createLinearGradient(x, y, x, y + 16);
      rock.addColorStop(0, '#a16207');
      rock.addColorStop(1, '#451a03');
      ctx.fillStyle = rock;
      ctx.beginPath();
      ctx.ellipse(x, y + 10, 32, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      // grass
      const grass = ctx.createLinearGradient(x, y - 8, x, y + 8);
      grass.addColorStop(0, c);
      grass.addColorStop(1, '#14532d');
      ctx.fillStyle = grass;
      ctx.beginPath();
      ctx.ellipse(x, y, 26, 10, 0, 0, Math.PI * 2);
      ctx.fill();
      // highlight
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.ellipse(x - 4, y - 3, 12, 4, -0.3, 0, Math.PI * 2);
      ctx.fill();
      // labels
      ctx.font = '600 11px "DM Sans", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(226,232,240,0.95)';
      ctx.textAlign = 'center';
      ctx.fillText(String(pair || ''), x, y + 34);
      ctx.font = '600 12px "JetBrains Mono", monospace';
      ctx.fillStyle = '#5eead4';
      const ptxt = price != null && Number.isFinite(Number(price))
        ? `$${Number(price).toLocaleString('en-US', { maximumFractionDigits: pair === 'BTC' ? 0 : 2 })}`
        : '—';
      ctx.fillText(ptxt, x, y + 48);
      ctx.restore();
    }

    _drawIsland(ctx, x, y, pal) {
      const s = this.state;
      const scale = Math.min(1.15, Math.max(0.85, this.w / 1100));

      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);

      // water reflection under island
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(0, 22, 120, 16, 0, 0, Math.PI * 2);
      ctx.fill();

      // cliff layers
      const cliff = (cy, rx, ry, c0, c1) => {
        const g = ctx.createLinearGradient(0, cy - ry, 0, cy + ry);
        g.addColorStop(0, c0);
        g.addColorStop(1, c1);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      };
      cliff(14, 118, 30, '#b45309', '#451a03');
      cliff(6, 102, 24, '#d97706', '#78350f');

      // grass plateau
      const grass = ctx.createLinearGradient(0, -20, 0, 16);
      grass.addColorStop(0, '#4ade80');
      grass.addColorStop(0.5, '#16a34a');
      grass.addColorStop(1, '#14532d');
      ctx.fillStyle = grass;
      ctx.beginPath();
      ctx.ellipse(0, -2, 82, 24, 0, 0, Math.PI * 2);
      ctx.fill();
      // grass sheen
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.ellipse(-10, -8, 40, 8, -0.2, 0, Math.PI * 2);
      ctx.fill();

      // path
      ctx.strokeStyle = 'rgba(214,211,209,0.45)';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(6, 10);
      ctx.quadraticCurveTo(18, 0, 22, -18);
      ctx.stroke();

      // trees
      this._tree(ctx, -58, -6, 1);
      this._tree(ctx, 56, -2, 0.85);
      this._tree(ctx, -36, 2, 0.7);

      // lighthouse
      this._lighthouse(ctx, 0, -8, s);

      // hermes mark
      ctx.save();
      ctx.translate(40, -18);
      ctx.font = '22px serif';
      ctx.fillStyle = '#fde68a';
      ctx.shadowColor = 'rgba(253,224,71,0.55)';
      ctx.shadowBlur = 12;
      ctx.fillText('☿', 0, 0);
      ctx.restore();

      // small cabin
      ctx.fillStyle = '#44403c';
      ctx.fillRect(-70, -18, 22, 14);
      ctx.fillStyle = '#292524';
      ctx.beginPath();
      ctx.moveTo(-72, -18);
      ctx.lineTo(-59, -28);
      ctx.lineTo(-46, -18);
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.globalAlpha = s.active ? 0.9 : 0.25;
      ctx.fillRect(-64, -12, 5, 5);
      ctx.globalAlpha = 1;

      ctx.restore();
    }

    _tree(ctx, x, y, sc) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sc, sc);
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.lineTo(0, -14);
      ctx.stroke();
      const leaf = (ox, oy, r, c) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
        ctx.fill();
      };
      leaf(0, -18, 10, '#16a34a');
      leaf(-8, -14, 7, '#15803d');
      leaf(8, -14, 7, '#22c55e');
      leaf(2, -24, 6, '#4ade80');
      ctx.restore();
    }

    _lighthouse(ctx, x, y, s) {
      ctx.save();
      ctx.translate(x, y);

      // tower body with stripes
      const body = ctx.createLinearGradient(-14, 0, 14, 0);
      body.addColorStop(0, '#475569');
      body.addColorStop(0.45, '#e2e8f0');
      body.addColorStop(1, '#334155');
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.moveTo(-12, 20);
      ctx.lineTo(-8, -48);
      ctx.lineTo(8, -48);
      ctx.lineTo(12, 20);
      ctx.closePath();
      ctx.fill();

      // red/white stripes vibe (dark bands)
      ctx.fillStyle = 'rgba(15,23,42,0.35)';
      for (let i = 0; i < 4; i++) {
        const yy = -40 + i * 14;
        ctx.fillRect(-10, yy, 20, 5);
      }

      // gallery
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-14, -56, 28, 10);
      // dome
      ctx.beginPath();
      ctx.moveTo(-16, -56);
      ctx.lineTo(0, -70);
      ctx.lineTo(16, -56);
      ctx.closePath();
      ctx.fillStyle = '#334155';
      ctx.fill();
      ctx.fillStyle = '#475569';
      ctx.fillRect(-2, -74, 4, 6);

      // lamp
      const on = s.active && !s.blocked;
      const blocked = s.active && s.blocked;
      if (on || blocked) {
        // beam
        ctx.save();
        ctx.translate(0, -51);
        ctx.rotate(Math.sin(this.t * 0.9) * 0.45);
        const beam = ctx.createRadialGradient(0, 0, 2, 0, 0, 160);
        if (blocked) {
          beam.addColorStop(0, 'rgba(251,113,133,0.55)');
          beam.addColorStop(0.3, 'rgba(251,113,133,0.12)');
          beam.addColorStop(1, 'transparent');
        } else {
          beam.addColorStop(0, 'rgba(254,240,138,0.65)');
          beam.addColorStop(0.25, 'rgba(250,204,21,0.18)');
          beam.addColorStop(1, 'transparent');
        }
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(150, -40);
        ctx.lineTo(150, 40);
        ctx.closePath();
        ctx.fill();
        // opposite faint beam
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-90, -24);
        ctx.lineTo(-90, 24);
        ctx.closePath();
        ctx.globalAlpha = 0.35;
        ctx.fill();
        ctx.restore();
      }

      // lamp glass
      const lampG = ctx.createRadialGradient(-2, -53, 1, 0, -51, 9);
      if (on) {
        lampG.addColorStop(0, '#fffbeb');
        lampG.addColorStop(0.4, '#facc15');
        lampG.addColorStop(1, '#ca8a04');
      } else if (blocked) {
        lampG.addColorStop(0, '#ffe4e6');
        lampG.addColorStop(1, '#e11d48');
      } else {
        lampG.addColorStop(0, '#94a3b8');
        lampG.addColorStop(1, '#475569');
      }
      ctx.fillStyle = lampG;
      ctx.beginPath();
      ctx.arc(0, -51, 8, 0, Math.PI * 2);
      ctx.fill();
      if (on) {
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(0, -51, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#fef9c3';
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      ctx.restore();
    }

    _drawShips(ctx, w, seaY) {
      const s = this.state;
      const positions = s.openPositions && s.openPositions.length
        ? s.openPositions
        : (Math.abs(s.position) > 1e-9
          ? [{ coin: s.pair, size: s.position, side: s.position > 0 ? 'long' : 'short', unrealizedPnl: s.pnl }]
          : []);

      positions.slice(0, 5).forEach((p, i) => {
        const baseX = w * (0.28 + i * 0.1);
        const x = baseX + Math.sin(this.t * 1.3 + i) * 10;
        const y = seaY + 18 + i * 6 + Math.sin(this.t * 2 + i) * 3;
        this._ship(ctx, x, y, p.side === 'long' || (p.size > 0), p);
      });
    }

    _ship(ctx, x, y, isLong, p) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(this.t * 2) * 0.05);
      // hull
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.moveTo(-18, 4);
      ctx.quadraticCurveTo(0, 12, 18, 4);
      ctx.lineTo(14, -2);
      ctx.lineTo(-14, -2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-12, -6, 24, 5);
      // sail
      ctx.fillStyle = isLong ? '#4ade80' : '#fb7185';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(0, -28);
      ctx.lineTo(16, -8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = isLong ? '#86efac' : '#fda4af';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(0, -22);
      ctx.lineTo(-10, -8);
      ctx.closePath();
      ctx.fill();
      // mast
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -28);
      ctx.lineTo(0, 2);
      ctx.stroke();
      // label
      const label = `${p.coin || ''} ${isLong ? 'L' : 'S'} ${p.unrealizedPnl != null ? (p.unrealizedPnl >= 0 ? '+' : '') + Number(p.unrealizedPnl).toFixed(2) : ''}`.trim();
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(15,23,42,0.85)';
      const tw = ctx.measureText(label).width;
      ctx.beginPath();
      ctx.roundRect?.(-tw / 2 - 6, 12, tw + 12, 16, 6);
      if (!ctx.roundRect) {
        ctx.fillRect(-tw / 2 - 6, 12, tw + 12, 16);
      } else {
        ctx.fill();
      }
      ctx.fillStyle = isLong ? '#4ade80' : '#fb7185';
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, 23);
      ctx.restore();
    }

    _drawWorldHud(ctx, w, h, seaY) {
      const s = this.state;
      // pair + price under island
      ctx.save();
      ctx.textAlign = 'center';
      const ix = w * 0.5;
      const iy = seaY + 78;

      // chip
      const pair = String(s.pair || 'ETH');
      ctx.font = '700 12px "DM Sans", system-ui, sans-serif';
      const pw = ctx.measureText(pair).width;
      ctx.fillStyle = 'rgba(8,15,30,0.75)';
      ctx.strokeStyle = 'rgba(125,211,252,0.25)';
      ctx.lineWidth = 1;
      const chipW = pw + 28;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(ix - chipW / 2, iy, chipW, 22, 11);
      else ctx.rect(ix - chipW / 2, iy, chipW, 22);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(pair, ix, iy + 15);

      // price
      ctx.font = '600 28px "JetBrains Mono", monospace';
      ctx.fillStyle = '#7dd3fc';
      ctx.shadowColor = 'rgba(56,189,248,0.45)';
      ctx.shadowBlur = 16;
      const price = s.price != null
        ? `$${Number(s.price).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
        : '—';
      ctx.fillText(price, ix, iy + 52);
      ctx.shadowBlur = 0;

      // left glass cards
      this._hudCard(ctx, 20, 24, [
        ['FARO', !s.active ? 'Spento' : s.blocked ? 'Tempesta' : s.operational ? 'Acceso' : 'Attivo'],
        ['TESORO', s.equity != null ? `$${Number(s.equity).toFixed(2)}` : '—'],
        ['ROTTA', s.score != null ? `${Math.round(s.score)}/${s.minScore ?? '—'}` : '—'],
      ], s);

      ctx.restore();
    }

    _hudCard(ctx, x, y, rows, s) {
      const w = 168;
      const h = 18 + rows.length * 36;
      ctx.save();
      ctx.fillStyle = 'rgba(8,15,30,0.72)';
      ctx.strokeStyle = 'rgba(125,211,252,0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, 16);
      else ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.stroke();

      rows.forEach((row, i) => {
        const yy = y + 20 + i * 36;
        ctx.font = '600 9px "DM Sans", system-ui';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'left';
        ctx.fillText(row[0], x + 16, yy);
        ctx.font = '600 15px "JetBrains Mono", monospace';
        let col = '#e2e8f0';
        if (i === 0) {
          col = !s.active ? '#fbbf24' : s.blocked ? '#fb7185' : '#4ade80';
        }
        if (i === 2 && s.score != null && s.minScore != null) {
          col = s.score >= s.minScore ? '#4ade80' : '#e2e8f0';
        }
        ctx.fillStyle = col;
        ctx.fillText(row[1], x + 16, yy + 16);
      });
      ctx.restore();
    }
  }

  global.H2BBMiniWorld = MiniWorld;
})(typeof window !== 'undefined' ? window : globalThis);
