// games/FireflyTrace.js
// Old visual design preserved; upgraded for crisp DPR scaling, accurate hit tests,
// per-target ring effects, and telemetry in consistent CSS-pixel coordinates.

export default class FireflyTrace {
  static SIZE_SCALE = 2.5;

  constructor(container, telemetryCollector, options = {}) {
    this.container = container;
    this.telemetryCollector = telemetryCollector;
    this.options = {
      fireflyCount: options.fireflyCount ?? 7,
      winTarget: options.winTarget ?? 3,
      gameDurationMs: options.gameDurationMs ?? 15000
    };

    this.resolvePromise = null;
    this.isComplete = false;
    this.fireflies = [];
    this.caughtCount = 0;

    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    this._gameLoop = this._gameLoop.bind(this);
    this._handlePointerDown = this._handlePointerDown.bind(this);
    this._onResize = this._onResize.bind(this);
  }

  mount() {
    this.container.innerHTML = '';
    // Ensure container can position the UI overlay
    const cs = getComputedStyle(this.container);
    if (cs.position === 'static') this.container.style.position = 'relative';

    // UI
    const ui = document.createElement('div');
    ui.innerHTML = `
      <div id="firefly-ui" role="status" aria-live="polite">
        <span>Catch <strong>${this.options.winTarget}</strong> fireflies</span>
        <span id="firefly-score">0/${this.options.winTarget}</span>
        <span id="firefly-timer">${Math.ceil(this.options.gameDurationMs/1000)}s</span>
      </div>`;
    this.container.appendChild(ui);
    this.container.appendChild(this.canvas);
    this.timerDisplay = ui.querySelector('#firefly-timer');
    this.scoreDisplay = ui.querySelector('#firefly-score');

    // Styles (scoped)
    const style = document.createElement('style');
    style.textContent = `
      #firefly-ui {
        position: absolute; inset: 10px 10px auto 10px;
        display: flex; gap: 12px; justify-content: space-between;
        background: rgba(0,0,0,0.5); color: #fff;
        padding: 8px 12px; border-radius: 10px; font-size: 14px; z-index: 10;
        pointer-events: none; user-select: none;
      }
      #firefly-ui strong { color: #f1c40f; }
      canvas { display: block; width: 100%; height: 100%; touch-action: none; }
    `;
    this.container.appendChild(style);

    // Initial layout + DPR scaling
    this._resize();

    // Fireflies
    this._createFireflies();

    // Telemetry: seed initial frame context
    this._refreshContext();

    // Events
    this.canvas.addEventListener('pointerdown', this._handlePointerDown, { passive: true });
    window.addEventListener('resize', this._onResize);

    // (Optional) react to DPR changes when users zoom or move displays
    this._dprWatcher = setInterval(() => {
      const cur = Math.max(1, window.devicePixelRatio || 1);
      if (Math.abs(cur - this.dpr) > 0.001) {
        this.dpr = cur;
        this._resize();
      }
    }, 500);

    // Timer + loop
    this._startTimer(Math.ceil(this.options.gameDurationMs / 1000));
    this.animationFrameId = requestAnimationFrame(this._gameLoop);

    return new Promise(resolve => { this.resolvePromise = resolve; });
  }

  unmount() {
    try { cancelAnimationFrame(this.animationFrameId); } catch {}
    try { clearInterval(this.timerIntervalId); } catch {}
    try { clearInterval(this._dprWatcher); } catch {}
    this.canvas.removeEventListener('pointerdown', this._handlePointerDown);
    window.removeEventListener('resize', this._onResize);
    this.container.innerHTML = '';
    this.isComplete = true;
  }

  // ---------- Input ----------

  _handlePointerDown(e) {
    if (this.isComplete) return;

    const rect = this.canvas.getBoundingClientRect();
    // Because we scaled the context by DPR, code units are CSS pixels:
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Raw click for kinetics (CSS px)
    this.telemetryCollector?._log?.('down', {
      x, y, t: performance.now(), game: 'FireflyTrace'
    });

    // Small forgiveness; inversely scaled so Retina doesn't over-inflate
    const padding = 5 / this.dpr;

    const hit = this.fireflies.find(f =>
      !f.isCaught && Math.hypot(x - f.x, y - f.y) <= (f.radius + padding)
    );

    if (hit) {
      hit.isCaught = true;
      this.caughtCount++;
      this.scoreDisplay.textContent = `${this.caughtCount}/${this.options.winTarget}`;

      // Success event in frame (CSS px) coords
      const w = hit.radius * 2;
      this.telemetryCollector?.addSuccessEvent?.({
        x, y, w, h: w,
        targetId: hit.id,
        is_target: true
      });

      // Per-target ring effect
      hit.effectShown = true;
      hit.effectRadius = hit.radius * 1.5;
      hit.effectLife = 1.0;

      if (this.caughtCount >= this.options.winTarget) {
        this._win();
      } else {
        // Update context after state change
        this._refreshContext();
      }
    }
  }

  // ---------- Core ----------

  _gameLoop(ts = performance.now()) {
    if (this.isComplete) return;

    const ctx = this.ctx;
    const wCss = this.canvas.width / this.dpr;
    const hCss = this.canvas.height / this.dpr;

    // Background
    ctx.fillStyle = '#0b1038';
    ctx.fillRect(0, 0, wCss, hCss);

    // Update + draw each firefly in CSS-pixel space
    for (const f of this.fireflies) {
      // Motion (gentle Brownian)
      f.vx += (Math.random() - 0.5) * 0.05;
      f.vy += (Math.random() - 0.5) * 0.05;
      f.x += f.vx;
      f.y += f.vy;

      // Bounds reflect
      if (f.x < 0)   { f.x = 0;   f.vx *= -1; }
      if (f.x > wCss){ f.x = wCss;f.vx *= -1; }
      if (f.y < 0)   { f.y = 0;   f.vy *= -1; }
      if (f.y > hCss){ f.y = hCss;f.vy *= -1; }

      // Twinkle
      f.alpha = 0.5 + 0.5 * Math.sin(ts * f.twinkleSpeed);

      // Color (caught turn green)
      const [r,g,b] = f.isCaught ? [76,175,80] : [255,235,59];
      const coreR  = ((f.radius * 0.9) * FireflyTrace.SIZE_SCALE);
      const bloomR = ((f.radius * 2.4) * FireflyTrace.SIZE_SCALE);

      // Softer than heavy shadowBlur (Safari friendly)
      const g1 = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, bloomR);
      g1.addColorStop(0, `rgba(${r},${g},${b},${0.12 * Math.max(0.3, f.alpha)})`);
      g1.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = g1;
      ctx.beginPath();
      ctx.arc(f.x, f.y, bloomR, 0, Math.PI * 2);
      ctx.fill();

      const g2 = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, coreR);
      g2.addColorStop(0, `rgba(${r},${g},${b},${0.9 * Math.max(0.3, f.alpha)})`);
      g2.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(f.x, f.y, coreR, 0, Math.PI * 2);
      ctx.fill();

      // Per-target ring effect (sizes in CSS px, lineWidth compensates DPR)
      if (f.effectLife > 0) {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.effectRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${f.effectLife})`;
        ctx.lineWidth = 2 / this.dpr;
        ctx.stroke();
        f.effectRadius += 2;   // expand
        f.effectLife -= 0.05;  // fade
      }
    }

    // Update frame context each frame (for density/entropy features)
    this._refreshContext();

    this.animationFrameId = requestAnimationFrame(this._gameLoop);
  }

  _createFireflies() {
    const wCss = this.canvas.width / this.dpr;
    const hCss = this.canvas.height / this.dpr;
    this.fireflies.length = 0;

    for (let i = 0; i < this.options.fireflyCount; i++) {
      const speed = 0.6 + Math.random() * 1.2;          // CSS px / frame
      const angle = Math.random() * Math.PI * 2;
      const radius = 4 + Math.random() * 6;              // CSS px

      this.fireflies.push({
        id: i + 1,
        x: Math.random() * wCss,
        y: Math.random() * hCss,
        radius,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        alpha: 0.5 + Math.random() * 0.5,
        twinkleSpeed: 0.0015 + Math.random() * 0.004,
        isCaught: false,
        effectShown: false,
        effectLife: 0,
        effectRadius: 0
      });
    }
  }

  _refreshContext() {
    const frame = { width: this.canvas.width / this.dpr, height: this.canvas.height / this.dpr };
    const objects = this.fireflies
      .filter(f => !f.isCaught)
      .map(f => ({
        id: f.id,
        x: f.x,
        y: f.y,
        r: ((f.radius * 2.4) * FireflyTrace.SIZE_SCALE) // approximate visible bloom radius in CSS px
      }));

    this.telemetryCollector?.setFrameContext?.(frame, objects);
  }

  _startTimer(seconds) {
    let timeLeft = seconds;
    this.timerDisplay.textContent = `${timeLeft}s`;
    this.timerIntervalId = setInterval(() => {
      timeLeft--;
      this.timerDisplay.textContent = `${timeLeft}s`;
      if (timeLeft <= 0 && !this.isComplete) {
        clearInterval(this.timerIntervalId);
        this._lose();
      }
    }, 1000);
  }

  _win() {
    if (this.isComplete) return;
    this.isComplete = true;

    const frame = { width: this.canvas.width / this.dpr, height: this.canvas.height / this.dpr };
    const context = { frame, objects: [] };
    const successEvents = this.telemetryCollector?._successEvents
      ? this.telemetryCollector._successEvents.slice(0)
      : [];

    if (this.resolvePromise) {
      this.resolvePromise({ success: true, game: 'FireflyTrace', context, successEvents });
    }
  }

  _lose() {
    if (this.isComplete) return;
    this.isComplete = true;

    const frame = { width: this.canvas.width / this.dpr, height: this.canvas.height / this.dpr };
    const context = { frame, objects: [] };
    const successEvents = this.telemetryCollector?._successEvents
      ? this.telemetryCollector._successEvents.slice(0)
      : [];

    if (this.resolvePromise) {
      this.resolvePromise({ success: false, game: 'FireflyTrace', context, successEvents });
    }
  }

  // ---------- Sizing / DPR ----------

  _onResize() {
    // Reflow-safe: only recompute sizes and keep positions in-bounds
    const prevW = this.canvas.width / this.dpr;
    const prevH = this.canvas.height / this.dpr;
    this._resize();
    const newW = this.canvas.width / this.dpr;
    const newH = this.canvas.height / this.dpr;

    // Clamp fireflies to new bounds (keep CSS-px coords)
    for (const f of this.fireflies) {
      f.x = Math.min(Math.max(0, f.x), newW);
      f.y = Math.min(Math.max(0, f.y), newH);
    }
    this._refreshContext();
  }

  _resize() {
    const rect = this.container.getBoundingClientRect();
    const wCss = Math.max(1, Math.floor(rect.width || 1));
    const hCss = Math.max(1, Math.floor(rect.height || 1));

    // Visual size in CSS px
    this.canvas.style.width = `${wCss}px`;
    this.canvas.style.height = `${hCss}px`;

    // Internal bitmap size in device px
    this.canvas.width = Math.floor(wCss * this.dpr);
    this.canvas.height = Math.floor(hCss * this.dpr);

    // Scale so 1 unit in code == 1 CSS pixel
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }
}
