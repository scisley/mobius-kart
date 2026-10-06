import * as THREE from 'three';
import type { MobiusTrack } from './track';

// Local copy so this module has no runtime dependency on track.ts (which imports BUMP_GLSL from here).
function wrapDelta(d: number, n: number): number {
  return ((((d + n / 2) % n) + n) % n) - n / 2;
}

/**
 * Thumps: a kart slams down and dents the sheet. Since the track has no thickness,
 * the dent is a bulge on the other face, at race coordinates (s + L/2, -v).
 *
 * Heights are measured along the surface normal of whichever face you are on, so one
 * function serves both faces: a dent at (s0, v0), plus an equal bulge at its mirror image.
 * The same maths runs in the track's vertex shader (see BUMP_GLSL) and on the CPU for physics.
 */

export const MAX_BUMPS = 8;
const PEAK = 2.4;
const RADIUS = 4.2;
const RISE = 0.12;
const DECAY = 5.0;
const RING_SPEED = 18;
// Wide and shallow: a visible ripple that gives at most a harmless hop, never a launch.
const RING_AMP = 0.15;
const RING_WIDTH = 3.0;
const LIFE = 1.3;

function profile(d: number, age: number): number {
  if (age < 0) return 0;
  const rise = Math.sin(Math.min(age / RISE, 1) * Math.PI * 0.5);
  const env = rise * Math.exp(-Math.max(age - RISE, 0) * DECAY);
  const bulge = Math.exp(-(d * d) / (RADIUS * RADIUS)) * env;
  const ringR = 3 + RING_SPEED * age;
  const ring = Math.exp(-((d - ringR) * (d - ringR)) / RING_WIDTH) * RING_AMP * Math.exp(-3 * age);
  return PEAK * (bulge + ring);
}

export const BUMP_GLSL = /* glsl */ `
  uniform vec4 uBumps[${MAX_BUMPS}]; // s, v, age, live
  float bumpProfile(float d, float age) {
    float rise = sin(min(age / ${RISE.toFixed(3)}, 1.0) * 1.5708);
    float env = rise * exp(-max(age - ${RISE.toFixed(3)}, 0.0) * ${DECAY.toFixed(2)});
    float bulge = exp(-(d * d) / ${(RADIUS * RADIUS).toFixed(3)}) * env;
    float ringR = 3.0 + ${RING_SPEED.toFixed(2)} * age;
    float ring = exp(-((d - ringR) * (d - ringR)) / ${RING_WIDTH.toFixed(2)}) * ${RING_AMP.toFixed(2)} * exp(-3.0 * age);
    return ${PEAK.toFixed(2)} * (bulge + ring);
  }
  float wrapS(float d) { return mod(d + uL * 0.5, uL) - uL * 0.5; }
  float bumpHeight(float s, float v) {
    float h = 0.0;
    for (int i = 0; i < ${MAX_BUMPS}; i++) {
      vec4 b = uBumps[i];
      if (b.w < 0.5) continue;
      h -= bumpProfile(length(vec2(wrapS(s - b.x), v - b.y)), b.z);
      h += bumpProfile(length(vec2(wrapS(s - b.x - uL * 0.5), v + b.y)), b.z);
    }
    return h;
  }
`;

interface Bump {
  s: number;
  v: number;
  age: number;
}

export class Bumps {
  readonly list: Bump[] = [];
  readonly uniform: THREE.Vector4[] = Array.from({ length: MAX_BUMPS }, () => new THREE.Vector4());

  constructor(private readonly track: MobiusTrack) {}

  add(s: number, v: number) {
    if (this.list.length >= MAX_BUMPS) this.list.shift();
    this.list.push({ s, v, age: 0 });
  }

  clear() {
    this.list.length = 0;
    this.syncUniforms();
  }

  update(dt: number) {
    for (const b of this.list) b.age += dt;
    while (this.list.length && this.list[0].age > LIFE) this.list.shift();
    this.syncUniforms();
  }

  private syncUniforms() {
    this.uniform.forEach((u, i) => {
      const b = this.list[i];
      if (b) u.set(b.s, b.v, b.age, 1);
      else u.set(0, 0, 0, 0);
    });
  }

  /** Surface height along the local normal at (s, v); `ageOffset` evaluates at another moment. */
  heightAt(s: number, v: number, ageOffset = 0): number {
    const L = this.track.length;
    let h = 0;
    for (const b of this.list) {
      const age = b.age + ageOffset;
      h -= profile(Math.hypot(wrapDelta(s - b.s, L), v - b.v), age);
      h += profile(Math.hypot(wrapDelta(s - b.s - L / 2, L), v + b.v), age);
    }
    return h;
  }
}
