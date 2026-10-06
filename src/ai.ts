import * as THREE from 'three';
import { ItemBoxes, Slicks } from './items';
import { Controls, Kart, TURN_RATE } from './kart';
import { MobiusTrack, newFrame, wrapDelta } from './track';

const frame = newFrame();
const clamp = THREE.MathUtils.clamp;

export interface AIContext {
  track: MobiusTrack;
  boxes: ItemBoxes;
  slicks: Slicks;
  time: number;
  hasThumpTarget: (k: Kart) => boolean;
  karts: Kart[];
  player: Kart;
}

/** How far (along the track) a hunter will look for someone to shadow. */
const HUNT_RANGE = 60;

/**
 * Simple lane-following driver: hugs the inside of bends, grabs items, dodges slicks.
 * Hunters also shadow a kart on the other face (preferably you), matching its mirrored
 * position so they can thump it.
 */
export class AIDriver {
  /** Multiplier on top speed requested by the hunting logic. */
  speedAdjust = 1;
  huntTarget: Kart | null = null;
  private itemTimer = 0;
  private itemDelay = 1;
  private readonly lane: number;
  private readonly phase: number;
  private readonly out: Controls = { steer: 0, brake: false, useItem: false, thump: false };

  constructor(
    readonly kart: Kart,
    /** Fraction of top speed this driver manages; also how hard they cut corners. */
    readonly skill: number,
    readonly hunter = false,
  ) {
    this.lane = (Math.random() - 0.5) * 6;
    this.phase = Math.random() * Math.PI * 2;
  }

  controls(ctx: AIContext, dt: number): Controls {
    const k = this.kart;
    const { track } = ctx;
    const hw = track.halfWidth - 2;
    const out = this.out;

    const here = track.sample(k.s, k.v, 0, frame).kappa;
    const ahead = track.sample(k.s + 18, 0, 0, frame).kappa;

    let target = ahead * track.radius * hw * this.skill + this.lane + Math.sin(ctx.time * 0.7 + this.phase) * 1.5;

    let hunting = false;
    this.speedAdjust = 1;
    this.huntTarget = null;
    if (this.hunter) {
      const prey = this.pickPrey(ctx);
      if (prey) {
        // Positive gap: the prey's mirror point is ahead of us, so speed up to meet it.
        const gap = wrapDelta(prey.s + track.length / 2 - k.s, track.length);
        this.speedAdjust = 1 + clamp(gap * 0.004, -0.08, 0.08);
        this.huntTarget = prey;
        if (Math.abs(gap) < 25) {
          target = -prey.v;
          hunting = true;
        }
      }
    }

    if (!k.item && !hunting) {
      const box = ctx.boxes.nearestAhead(k, 35);
      if (box !== null) target = box;
    }

    for (const sl of ctx.slicks.list) {
      const d = wrapDelta(sl.s - k.s, track.length);
      if (d > 0 && d < 25 && Math.abs(sl.v - target) < 2.8) {
        target = sl.v + (target >= sl.v ? 3.5 : -3.5);
      }
    }
    target = clamp(target, -hw, hw);

    const wantPsi = clamp((target - k.v) * 0.12, -0.5, 0.5);
    const wantYaw = here * k.speed + (wantPsi - k.psi) * 3.5;
    out.steer = clamp(-wantYaw / TURN_RATE, -1, 1);
    out.brake = false;

    // Thump whoever is mirrored below us, after a human-ish reaction delay.
    out.thump = k.thumpCooldown <= 0 && ctx.hasThumpTarget(k) && Math.random() < dt * (this.hunter ? 3 : 1.5);

    out.useItem = false;
    if (k.item) {
      this.itemTimer += dt;
      if (this.itemTimer > this.itemDelay) {
        out.useItem = true;
        this.itemTimer = 0;
        this.itemDelay = k.item === 'turbo' ? 0.5 + Math.random() * 2 : 2 + Math.random() * 4;
      }
    }
    return out;
  }

  private pickPrey(ctx: AIContext): Kart | null {
    const k = this.kart;
    const L = ctx.track.length;
    let best: Kart | null = null;
    let bestScore = Infinity;
    for (const o of ctx.karts) {
      if (o === k || o.finished) continue;
      const gap = Math.abs(wrapDelta(o.s + L / 2 - k.s, L));
      if (gap > HUNT_RANGE) continue;
      const score = gap - (o === ctx.player ? 20 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    return best;
  }
}
