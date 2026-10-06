import { Tilt } from './tilt';

const STEER_MODE_KEY = 'mobius-kart-steering';
/** In tilt mode a resting thumb shouldn't steer; only a real drag overrides the tilt. */
const DRAG_ENGAGE_PX = 20;

/** Keyboard + touch + tilt input, merged into one steer/brake/item/thump state. */
export class Input {
  steer = 0;
  brake = false;
  readonly isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  readonly tilt = new Tilt();
  /** The player's choice; tilt is only used once motion data actually arrives. */
  tiltWanted = true;
  onRecenter: () => void = () => {};

  private readonly keys = new Set<string>();
  private keySteer = 0;
  private itemQueued = false;
  private thumpQueued = false;
  private steerPointer: number | null = null;
  private steerOrigin = 0;
  private touchSteer = 0;
  private touchBrake = false;
  private steerDownAt = 0;
  private steerDownY = 0;
  private dragEngaged = false;

  constructor() {
    try {
      this.tiltWanted = localStorage.getItem(STEER_MODE_KEY) !== 'touch';
    } catch {
      // Keep the default.
    }

    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (!e.repeat && ['Space', 'KeyE', 'KeyX', 'ShiftLeft', 'ShiftRight'].includes(e.code)) this.itemQueued = true;
      if (!e.repeat && ['KeyQ', 'KeyZ'].includes(e.code)) this.thumpQueued = true;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    const zone = document.getElementById('steer-zone')!;
    const knob = document.getElementById('knob')!;
    zone.addEventListener('pointerdown', (e) => {
      if (this.steerPointer !== null) return;
      this.steerPointer = e.pointerId;
      this.steerOrigin = e.clientX;
      this.steerDownAt = performance.now();
      this.steerDownY = e.clientY;
      this.dragEngaged = !this.usingTilt;
      zone.setPointerCapture(e.pointerId);
      knob.style.display = this.dragEngaged ? 'block' : 'none';
      knob.style.left = `${e.clientX}px`;
      knob.style.top = `${e.clientY - zone.getBoundingClientRect().top}px`;
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.steerPointer) return;
      let dx = e.clientX - this.steerOrigin;
      if (!this.dragEngaged) {
        if (Math.abs(dx) < DRAG_ENGAGE_PX) return;
        // Start the drag from here, so taking over from tilt doesn't jump.
        this.dragEngaged = true;
        this.steerOrigin = e.clientX;
        dx = 0;
        knob.style.display = 'block';
        knob.style.left = `${e.clientX}px`;
        knob.style.top = `${e.clientY - zone.getBoundingClientRect().top}px`;
      }
      const x = Math.max(-1, Math.min(1, dx / 60));
      this.touchSteer = Math.abs(x) < 0.08 ? 0 : x;
      knob.style.transform = `translateX(${x * 40}px)`;
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== this.steerPointer) return;
      // A quick tap (no drag) in tilt mode re-centers the steering.
      const tap =
        !this.dragEngaged &&
        performance.now() - this.steerDownAt < 300 &&
        Math.abs(e.clientY - this.steerDownY) < DRAG_ENGAGE_PX;
      if (tap && this.usingTilt) {
        this.tilt.calibrate();
        this.onRecenter();
      }
      this.steerPointer = null;
      this.dragEngaged = false;
      this.touchSteer = 0;
      knob.style.display = 'none';
      knob.style.transform = '';
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);

    this.holdButton('btn-brake', (down) => (this.touchBrake = down));
    this.holdButton('btn-item', (down) => {
      if (down) this.itemQueued = true;
    });
    this.holdButton('btn-thump', (down) => {
      if (down) this.thumpQueued = true;
    });
  }

  get usingTilt(): boolean {
    return this.tiltWanted && this.tilt.active;
  }

  setTiltWanted(on: boolean) {
    this.tiltWanted = on;
    try {
      localStorage.setItem(STEER_MODE_KEY, on ? 'tilt' : 'touch');
    } catch {
      // Not persisted; fine.
    }
  }

  private holdButton(id: string, set: (down: boolean) => void) {
    const el = document.getElementById(id)!;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      el.classList.add('active');
      set(true);
    });
    const up = () => {
      el.classList.remove('active');
      set(false);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  update(dt: number) {
    const k = this.keys;
    const want = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    // Ease keyboard steering so tapping a key isn't a jerk to full lock.
    const rate = want === 0 ? 8 : 5;
    this.keySteer += Math.max(-rate * dt, Math.min(rate * dt, want - this.keySteer));

    if (this.steerPointer !== null && this.dragEngaged) this.steer = this.touchSteer;
    else if (this.usingTilt) this.steer = this.tilt.steer;
    else this.steer = this.keySteer;
    this.brake = k.has('ArrowDown') || k.has('KeyS') || this.touchBrake;
  }

  consumeThump(): boolean {
    const bounced = this.tilt.consumeBounce() && this.usingTilt;
    const q = this.thumpQueued || bounced;
    this.thumpQueued = false;
    return q;
  }

  consumeItem(): boolean {
    const q = this.itemQueued;
    this.itemQueued = false;
    return q;
  }
}
