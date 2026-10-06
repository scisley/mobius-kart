/**
 * Motion controls: rotate the phone like a steering wheel to steer, and flick it up-then-down to thump.
 *
 * Everything comes from DeviceMotion's accelerationIncludingGravity, rotated into screen coordinates.
 * A slow low-pass of it is gravity; what's left is the phone's own movement.
 * iOS reports the opposite sign to Android. Steering fixes the sign once at calibration (the top edge of
 * the screen is assumed to be up), and the bounce test uses a dot product, which doesn't care.
 */

const MAX_ANGLE = (26 * Math.PI) / 180;
const DEADZONE = 0.05;
/** Gravity in the screen plane below this (m/s²) means the phone is too flat to read a rotation. */
const MIN_IN_PLANE = 2;
/** Ignore steering while the phone is being jolted, so a bounce doesn't also yank the wheel. */
const JOLT = 4;
/** Vertical acceleration (m/s²) each way that counts as a deliberate flick. */
const BOUNCE = 7;
const BOUNCE_WINDOW_MS = 450;
const BOUNCE_COOLDOWN_MS = 900;

type Vec3 = [number, number, number];

export class Tilt {
  steer = 0;
  /** True once motion data is actually arriving. */
  active = false;

  private gravity: Vec3 = [0, 0, 0];
  private fast: Vec3 = [0, 0, 0];
  private last = 0;
  private sign = 1;
  private offset = 0;
  private calibrateNext = true;
  private upAt = -Infinity;
  private lastBounce = -Infinity;
  private bounceQueued = false;
  private listening = false;

  /**
   * Must be called straight from a tap handler: iOS only shows the permission prompt during a
   * user gesture, so requestPermission() is invoked before anything is awaited.
   */
  request(): Promise<boolean> {
    if (!window.isSecureContext || typeof DeviceMotionEvent === 'undefined') return Promise.resolve(false);
    const DM = DeviceMotionEvent as typeof DeviceMotionEvent & { requestPermission?: () => Promise<string> };
    const asked = typeof DM.requestPermission === 'function' ? DM.requestPermission() : Promise.resolve('granted');
    return asked.then(
      (state) => {
        if (state !== 'granted') return false;
        if (!this.listening) {
          window.addEventListener('devicemotion', this.onMotion);
          this.listening = true;
        }
        return true;
      },
      () => false,
    );
  }

  /** Treat however the phone is held right now as straight ahead. */
  calibrate() {
    this.calibrateNext = true;
  }

  consumeBounce(): boolean {
    const q = this.bounceQueued;
    this.bounceQueued = false;
    return q;
  }

  private onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const now = performance.now();
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / 60;
    this.last = now;

    // Device axes → screen axes (x right, y up on the display as currently shown).
    const deg = screen.orientation?.angle ?? (window as { orientation?: number }).orientation ?? 0;
    const r = (deg * Math.PI) / 180;
    const c = Math.cos(r);
    const s = Math.sin(r);
    const v: Vec3 = [c * a.x - s * a.y, s * a.x + c * a.y, a.z];

    if (!this.active) {
      this.gravity = [...v];
      this.fast = [...v];
      this.active = true;
    }
    const kSlow = 1 - Math.exp(-dt / 0.3);
    const kFast = 1 - Math.exp(-dt / 0.06);
    for (let i = 0; i < 3; i++) {
      this.gravity[i] += (v[i] - this.gravity[i]) * kSlow;
      this.fast[i] += (v[i] - this.fast[i]) * kFast;
    }

    // Bounce: a sharp move along real vertical, then the stop (opposite sign) shortly after.
    const g = this.gravity;
    const gMag = Math.hypot(g[0], g[1], g[2]) || 1;
    const lin: Vec3 = [v[0] - g[0], v[1] - g[1], v[2] - g[2]];
    const vert = (lin[0] * g[0] + lin[1] * g[1] + lin[2] * g[2]) / gMag;
    if (vert > BOUNCE) this.upAt = now;
    else if (vert < -BOUNCE && now - this.upAt < BOUNCE_WINDOW_MS && now - this.lastBounce > BOUNCE_COOLDOWN_MS) {
      this.bounceQueued = true;
      this.lastBounce = now;
      this.upAt = -Infinity;
    }

    // Steering: rotation of "up" within the screen plane.
    if (Math.hypot(lin[0], lin[1], lin[2]) > JOLT || now - this.lastBounce < 250) return;
    const [x, y] = this.fast;
    if (Math.hypot(x, y) < MIN_IN_PLANE) return;
    if (this.calibrateNext) this.sign = y >= 0 ? 1 : -1;
    // Clockwise rotation (top edge to the right) is positive, i.e. steer right.
    const angle = Math.atan2(-x * this.sign, y * this.sign);
    if (this.calibrateNext) {
      this.offset = angle;
      this.calibrateNext = false;
    }
    let d = angle - this.offset;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const raw = Math.max(-1, Math.min(1, d / MAX_ANGLE));
    const mag = Math.abs(raw);
    this.steer = mag < DEADZONE ? 0 : (Math.sign(raw) * (mag - DEADZONE)) / (1 - DEADZONE);
  };
}
