// TelemetryCollector.js (ESM + global fallback)
// Collects pointer/mouse/touch + keyboard events and minimal device/viewport metadata.
// Matches analysisEngine.js expected shapes: signals.samples, signals.clicks, signals.keyboard, signals.meta.
//
// Usage in index.html is already:
//   const mod = await import('./TelemetryCollector.js');
//   const TelemetryCollector = mod.default || mod.TelemetryCollector || window.TelemetryCollector;
//
// This file provides both a default export and attaches to window for safety.

class TelemetryCollector {
  constructor(hostElement, opts = {}) {
    if (!hostElement) throw new Error('TelemetryCollector requires a host element');
    this.host = hostElement;
    this.opts = Object.assign({
      sampleMove: true,
      sampleDownUp: true,
      sampleClicks: true,
      sampleKeyboard: true,
      maxSamples: 5000,   // hard cap to avoid giant payloads
      maxClicks: 200,
      maxKeys: 400,
    }, opts);

    // buffers
    this.samples = [];   // [{t,x,y,type,pressure,tiltX,tiltY}]
    this.clicks = [];    // [{t,x,y,button}]
    this.keyboard = [];  // [{t,type,key,code}]

    this.pointerType = (navigator.maxTouchPoints > 0) ? 'touch' : 'mouse';
    this.started = false;
    this.startTs = 0;

    // bound handlers
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onClick = this._onClick.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._resizeObserver = null;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.samples.length = 0;
    this.clicks.length = 0;
    this.keyboard.length = 0;
    this.startTs = performance.now();

    // Event targets: capture on host and document for keyboard
    const opts = { passive: true };
    if (this.opts.sampleMove) this.host.addEventListener('pointermove', this._onPointerMove, opts);
    if (this.opts.sampleDownUp) {
      this.host.addEventListener('pointerdown', this._onPointerDown, opts);
      this.host.addEventListener('pointerup', this._onPointerUp, opts);
      this.host.addEventListener('pointercancel', this._onPointerUp, opts);
      this.host.addEventListener('pointerout', this._onPointerMove, opts);
      this.host.addEventListener('pointerleave', this._onPointerMove, opts);
      this.host.addEventListener('pointerenter', this._onPointerMove, opts);
    }
    if (this.opts.sampleClicks) this.host.addEventListener('click', this._onClick, opts);
    if (this.opts.sampleKeyboard) {
      document.addEventListener('keydown', this._onKeyDown, opts);
      document.addEventListener('keyup', this._onKeyUp, opts);
    }

    // Resize observer to keep meta updated during the session
    if ('ResizeObserver' in window) {
      this._resizeObserver = new ResizeObserver(() => {});
      this._resizeObserver.observe(this.host);
    }
  }

  stop() {
    if (!this.started) return;
    this.started = false;

    this.host.removeEventListener('pointermove', this._onPointerMove);
    this.host.removeEventListener('pointerdown', this._onPointerDown);
    this.host.removeEventListener('pointerup', this._onPointerUp);
    this.host.removeEventListener('pointercancel', this._onPointerUp);
    this.host.removeEventListener('pointerout', this._onPointerMove);
    this.host.removeEventListener('pointerleave', this._onPointerMove);
    this.host.removeEventListener('pointerenter', this._onPointerMove);
    this.host.removeEventListener('click', this._onClick);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    if (this._resizeObserver) {
      try { this._resizeObserver.disconnect(); } catch (_) {}
      this._resizeObserver = null;
    }
  }

  // ---- internal helpers ----
  _now() { return performance.now() - this.startTs; }

  _hostRect() {
    const r = this.host.getBoundingClientRect();
    return { left:r.left, top:r.top, width: r.width, height: r.height };
  }

  _normXY(clientX, clientY) {
    const r = this._hostRect();
    const x = Math.max(0, Math.min(r.width, clientX - r.left));
    const y = Math.max(0, Math.min(r.height, clientY - r.top));
    return { x, y };
  }

  _pushSample(obj) {
    if (this.samples.length < this.opts.maxSamples) this.samples.push(obj);
  }

  _onPointerMove(e) {
    const { x, y } = this._normXY(e.clientX, e.clientY);
    this._pushSample({
      t: this._now(),
      x, y,
      type: 'move',
      pressure: Number(e.pressure) || 0,
      tiltX: Number(e.tiltX) || 0,
      tiltY: Number(e.tiltY) || 0,
    });
  }
  _onPointerDown(e) {
    const { x, y } = this._normXY(e.clientX, e.clientY);
    this._pushSample({
      t: this._now(),
      x, y,
      type: 'down',
      pressure: Number(e.pressure) || 0,
      tiltX: Number(e.tiltX) || 0,
      tiltY: Number(e.tiltY) || 0,
    });
  }
  _onPointerUp(e) {
    const { x, y } = this._normXY(e.clientX, e.clientY);
    this._pushSample({
      t: this._now(),
      x, y,
      type: 'up',
      pressure: Number(e.pressure) || 0,
      tiltX: Number(e.tiltX) || 0,
      tiltY: Number(e.tiltY) || 0,
    });
  }
  _onClick(e) {
    if (this.clicks.length >= this.opts.maxClicks) return;
    const { x, y } = this._normXY(e.clientX, e.clientY);
    this.clicks.push({
      t: this._now(),
      x, y,
      button: Number(e.button) || 0,
    });
  }

  _onKeyDown(e) {
    if (this.keyboard.length >= this.opts.maxKeys) return;
    this.keyboard.push({ t: this._now(), type: 'down', key: e.key, code: e.code });
  }
  _onKeyUp(e) {
    if (this.keyboard.length >= this.opts.maxKeys) return;
    this.keyboard.push({ t: this._now(), type: 'up', key: e.key, code: e.code });
  }

  // ---- public API ----

  /**
   * Optional helpers for games (non-breaking): games can call these to attach
   * success events and environment context. If games already return
   * {successEvents, context} from mount(), you can ignore these.
   */
  setFrameContext(frame, objects) {
    this._frame = frame && typeof frame === 'object' ? {
      width: Number(frame.width) || 0,
      height: Number(frame.height) || 0,
    } : null;
    this._objects = Array.isArray(objects) ? objects.slice(0, 500) : null;
  }

  /**
   * Games may call addSuccessEvent({x, y, targetId}) when a valid hit occurs.
   * If you don't use this, the game can still return successEvents via mount().
   */
  addSuccessEvent(ev) {
    if (!this._successEvents) this._successEvents = [];
    const t = this._now();
    const sx = Number(ev?.x) || 0, sy = Number(ev?.y) || 0;
    const targetId = (ev && ev.targetId != null) ? ev.targetId : undefined;
    const norm = this._normXY(sx, sy); // assumes host-relative coords
    this._successEvents.push({ t, x: norm.x, y: norm.y, targetId });
  }

// Generic log interface: log(type, payload).
log(type, payload = {}) {
  // unify possible coords (client or element-space)
  const cx = Number(payload.clientX ?? payload.x ?? 0);
  const cy = Number(payload.clientY ?? payload.y ?? 0);

  if (type === 'hit' && payload && this.addSuccessEvent) {
    // allow games that don't call addSuccessEvent directly to still work
    this.addSuccessEvent({
      x: cx, y: cy,
      targetId: payload.targetId,
      w: payload.w, h: payload.h, // if provided
      is_target: payload.isTarget === true
    });
  }

  if (type === 'frame' && payload && this.setFrameContext) {
    // optional: games may push frame/object context this way too
    this.setFrameContext(payload.frame, payload.objects);
  }
}
// optional alias so _emit tries succeed
_log(type, payload){ this.log(type, payload); }


  /**
   * Returns telemetry payload consumed by index.html → /verify via analysisEngine.js
   */
  getData() {
    const durationMs = this.samples.length
      ? Math.max(0, (this.samples[this.samples.length - 1].t - (this.samples[0]?.t || 0)))
      : 0;

    const meta = {
      userAgent: navigator.userAgent,
      screenWidth: window.screen?.width || 0,
      screenHeight: window.screen?.height || 0,
      windowWidth: window.innerWidth || 0,
      windowHeight: window.innerHeight || 0,
      colorDepth: window.screen?.colorDepth || 0,
      automationFramework: !!navigator.webdriver,
    };

    // shape expected by analysisEngine.js
    return {
      samples: this.samples.slice(0),
      clicks: this.clicks.slice(0),
      keyboard: this.keyboard.slice(0),
      durationMs,
      pointerType: this.pointerType,
      meta,
      // The following are optional helpers; index.html already passes success/context separately
      // but we include them for completeness if a game used setFrameContext/addSuccessEvent.
      successEvents: this._successEvents || [],
      context: (this._frame || this._objects) ? { frame: this._frame, objects: this._objects || [] } : null,
    };
  }
}

export { TelemetryCollector };
export default TelemetryCollector;

// Also attach to window for maximum compatibility
if (typeof window !== 'undefined') window.TelemetryCollector = TelemetryCollector;
