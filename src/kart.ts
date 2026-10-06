import * as THREE from 'three';
import type { Bumps } from './thump';
import { MobiusTrack, TrackFrame, mod, newFrame } from './track';

export type ItemKind = 'turbo' | 'slick';

export interface Controls {
  /** -1 = full left, +1 = full right. */
  steer: number;
  brake: boolean;
  useItem: boolean;
  thump: boolean;
}

/** One-shot things that happened during an update, for the game to react to. */
export type KartEvent = 'thumpStart' | 'slam' | 'launched' | 'thumped' | 'bigAir';

export const TOP_SPEED = 34;
export const TURN_RATE = 1.9;
const ACCEL = 18;
const BRAKE = 45;
const BOOST_MULT = 1.45;
const MAX_HEADING = 1.3;

const GRAVITY = 38;
export const THUMP_COOLDOWN = 5;
const THUMP_HOP = 10;
/** Sheet rising faster than this under a grounded kart throws it into the air, out of control. */
const LAUNCH_VEL = 10;
/** Gentler rises (ripples, driving over a bulge) just give a harmless hop. */
const BOUNCE_VEL = 6;
const MAX_LAUNCH = 16;
const TRAMPOLINE_MULT = 1.35;
/**
 * Press THUMP within this long before the launch (your hop gets caught by the rising bulge)...
 * Generous enough that reacting to the ⚠ warning, the moment the attacker hops, still counts.
 */
const TRAMPOLINE_EARLY = 0.4;
/** ...or this long after it, to ride the bulge instead of being thrown by it. */
const TRAMPOLINE_LATE = 0.2;
/** A thump hop this close above a rising bulge gets caught by it (and turned into a bounce). */
const CATCH_HEIGHT = 1.5;

// Shared geometry/materials so six karts cost little more than one.
const geo = {
  body: new THREE.BoxGeometry(1.6, 0.45, 2.5),
  nose: new THREE.BoxGeometry(1.1, 0.3, 0.9),
  bumper: new THREE.BoxGeometry(1.8, 0.25, 0.3),
  torso: new THREE.CylinderGeometry(0.3, 0.4, 0.6, 8),
  head: new THREE.SphereGeometry(0.42, 12, 10),
  visor: new THREE.BoxGeometry(0.55, 0.18, 0.2),
  spoiler: new THREE.BoxGeometry(1.9, 0.1, 0.5),
  strut: new THREE.BoxGeometry(0.1, 0.4, 0.1),
  wheel: new THREE.CylinderGeometry(0.38, 0.38, 0.34, 12).rotateZ(Math.PI / 2),
  flame: new THREE.ConeGeometry(0.32, 1.4, 8).rotateX(-Math.PI / 2),
  shadow: new THREE.CircleGeometry(1.5, 20).rotateX(-Math.PI / 2),
};
const mat = {
  dark: new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.8, flatShading: true }),
  suit: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7, flatShading: true }),
  flame: new THREE.MeshBasicMaterial({ color: 0x66ddff, transparent: true, opacity: 0.85 }),
  shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }),
};

const tmpFwd = new THREE.Vector3();
const tmpLeft = new THREE.Vector3();
const tmpMat = new THREE.Matrix4();

export class Kart {
  /** Unwrapped position along the track; s = progress mod length. */
  progress = 0;
  /** Where this kart's own start/finish line is. Grid B starts half a lap round, on the other face. */
  startOffset = 0;
  grid: 'A' | 'B' = 'A';
  /** How long we've been mirrored with another kart (antipode slipstream). */
  linkTime = 0;
  v = 0;
  /** Heading relative to the track direction, + = toward +v. */
  psi = 0;
  speed = 0;
  boost = 0;
  spin = 0;
  item: ItemKind | null = null;
  finished = false;
  finishTime = 0;

  /** Height above the undeformed surface, along its normal. */
  h = 0;
  vz = 0;
  ground = 0;
  airborne = false;
  /** Thrown by a thump from the other face: no control until landing. */
  launched = false;
  /** Timed the THUMP press: launch becomes a big-air bounce with a turbo. */
  trampoline = false;
  /** In the air from our own thump; slams down hard on the way back. */
  thumping = false;
  thumpCooldown = 0;
  /** AI shortcut: counts as a well-timed press for launches before this clock time. */
  autoTrampolineUntil = -1;
  clock = 0;
  readonly events: KartEvent[] = [];

  readonly group = new THREE.Group();
  private readonly model = new THREE.Group();
  private readonly wheels: THREE.Mesh[] = [];
  private readonly flame: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  private readonly frame: TrackFrame = newFrame();
  private wheelAngle = 0;
  private hopPressedAt = -99;
  private launchTime = -99;

  constructor(
    readonly name: string,
    readonly color: number,
    readonly track: MobiusTrack,
  ) {
    const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1, flatShading: true });
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(x, y, z);
      this.model.add(mesh);
      return mesh;
    };
    add(geo.body, paint, 0, 0.6, 0);
    add(geo.nose, paint, 0, 0.5, 1.6);
    add(geo.bumper, mat.dark, 0, 0.42, 2.0);
    add(geo.torso, mat.suit, 0, 1.1, -0.3);
    add(geo.head, paint, 0, 1.62, -0.3);
    add(geo.visor, mat.dark, 0, 1.66, -0.02);
    add(geo.spoiler, paint, 0, 1.25, -1.3);
    add(geo.strut, mat.dark, 0.6, 1.0, -1.3);
    add(geo.strut, mat.dark, -0.6, 1.0, -1.3);
    for (const [x, z] of [[0.9, 0.85], [-0.9, 0.85], [0.95, -0.85], [-0.95, -0.85]]) {
      this.wheels.push(add(geo.wheel, mat.dark, x, 0.38, z));
    }
    this.flame = add(geo.flame, mat.flame, 0, 0.6, -2.0);
    this.flame.visible = false;
    this.shadow = new THREE.Mesh(geo.shadow, mat.shadow);
    this.shadow.position.y = 0.05;
    this.shadow.renderOrder = 2;
    this.group.add(this.shadow, this.model);
    this.model.scale.setScalar(1.15);
  }

  get s(): number {
    return mod(this.progress, this.track.length);
  }

  /** 1-based lap number. */
  /** Distance raced from our own start line; this, not physical position, decides placings. */
  get raced(): number {
    return this.progress - this.startOffset;
  }

  get lap(): number {
    return Math.floor(this.raced / this.track.length) + 1;
  }

  /** True on the half of the lap that runs along the strip's "other" face. */
  get onSideB(): boolean {
    return this.s >= this.track.length / 2;
  }

  reset(startOffset: number, gridBack: number, v: number) {
    this.startOffset = startOffset;
    this.progress = startOffset - gridBack;
    this.linkTime = 0;
    this.v = v;
    this.psi = 0;
    this.speed = 0;
    this.boost = 0;
    this.spin = 0;
    this.item = null;
    this.finished = false;
    this.finishTime = 0;
    this.h = this.vz = this.ground = 0;
    this.airborne = this.launched = this.trampoline = this.thumping = false;
    // Start empty, as if just used, so nobody can thump off the line. The cooldown
    // only runs once racing starts, so the first thump is ready 5s after GO.
    this.thumpCooldown = THUMP_COOLDOWN;
    this.autoTrampolineUntil = -1;
    this.hopPressedAt = this.launchTime = -99;
    this.events.length = 0;
  }

  update(dt: number, ctl: Controls, topFactor: number, bumps: Bumps) {
    this.clock += dt;
    this.thumpCooldown = Math.max(0, this.thumpCooldown - dt);
    const f = this.track.sample(this.s, this.v, 0, this.frame);

    if (ctl.thump) {
      this.hopPressedAt = this.clock;
      // A late press still counts, as long as we've only just left the ground.
      if (this.launched && !this.trampoline && this.clock - this.launchTime < TRAMPOLINE_LATE) {
        this.trampoline = true;
        this.vz += 5;
        this.thumpCooldown = 0;
      }
    }
    let top = TOP_SPEED * topFactor;
    let accel = ACCEL;
    if (this.boost > 0) {
      this.boost -= dt;
      top *= BOOST_MULT;
      accel *= 3;
    }

    let yaw = 0;
    if (this.launched) {
      // Tumbling through the air: no grip, no throttle.
      this.speed *= Math.exp(-0.5 * dt);
    } else if (this.spin > 0) {
      this.spin -= dt;
      this.speed *= Math.exp(-2.2 * dt);
    } else {
      if (ctl.brake) this.speed = Math.max(0, this.speed - BRAKE * dt);
      else if (this.speed < top) this.speed = Math.min(top, this.speed + accel * dt);
      if (this.speed > top) this.speed -= (this.speed - top) * Math.min(1, 1.5 * dt);

      const grip = Math.min(1, this.speed / 10);
      yaw = -ctl.steer * TURN_RATE * grip;

      if (ctl.thump) this.tryThump();
    }

    // Integrate in race coordinates. Inside lanes are shorter (1 - κv), and
    // the track bending under us rotates our heading relative to it.
    this.psi += yaw * dt;
    const stretch = THREE.MathUtils.clamp(1 - f.kappa * this.v, 0.5, 1.5);
    const ds = (this.speed * Math.cos(this.psi) * dt) / stretch;
    this.progress += ds;
    this.v += this.speed * Math.sin(this.psi) * dt;
    this.psi -= f.kappa * ds;
    this.psi = THREE.MathUtils.clamp(this.psi, -MAX_HEADING, MAX_HEADING);

    const lim = this.track.halfWidth - 1.0;
    if (Math.abs(this.v) > lim) {
      const side = Math.sign(this.v);
      this.v = side * lim;
      if (Math.sign(this.psi) === side) this.psi *= -0.3;
      this.speed *= Math.exp(-1.8 * dt);
    }

    this.wheelAngle += (this.speed * dt) / 0.38;
    this.updateVertical(dt, bumps);
  }

  /** Hop up to slam down on landing. Returns false if not possible right now (cooldown, airborne, spinning). */
  tryThump(): boolean {
    if (this.thumpCooldown > 0 || this.airborne || this.spin > 0) return false;
    this.thumping = true;
    this.airborne = true;
    this.vz = THUMP_HOP;
    this.thumpCooldown = THUMP_COOLDOWN;
    this.speed *= 0.9;
    this.events.push('thumpStart');
    return true;
  }

  /** Ride the (possibly bulging) sheet, or fly. */
  private updateVertical(dt: number, bumps: Bumps) {
    const ground = bumps.heightAt(this.s, this.v);
    const totalVel = (ground - this.ground) / dt;
    this.ground = ground;

    // Only the sheet moving under us (not us driving onto a slope) counts as a thump. It also
    // catches a fresh thump hop, since pressing THUMP as the bump arrives is how you bounce.
    const sheetVel = (ground - bumps.heightAt(this.s, this.v, -dt)) / dt;
    const freshHop = this.thumping && this.clock - this.hopPressedAt < TRAMPOLINE_EARLY;
    const nearSheet =
      !this.airborne || (!this.launched && (!this.thumping || freshHop) && this.h - ground < CATCH_HEIGHT);
    if (nearSheet && sheetVel > LAUNCH_VEL) {
      this.h = Math.max(this.h, ground);
      this.launch(sheetVel);
      return;
    }

    if (!this.airborne) {
      this.h = ground;
      if (totalVel > BOUNCE_VEL) {
        this.airborne = true;
        this.vz = totalVel * 0.6;
      }
      return;
    }

    const g = this.thumping && this.vz < 0 ? GRAVITY * 3 : GRAVITY;
    this.vz -= g * dt;
    this.h += this.vz * dt;
    if (this.h <= ground) {
      if (this.launched && sheetVel > 0) {
        // The bulge is still rising faster than we fly: it carries us up rather than landing us.
        this.h = ground;
        const carry = Math.min(sheetVel, MAX_LAUNCH) * (this.trampoline ? TRAMPOLINE_MULT : 1);
        this.vz = Math.max(this.vz, carry);
      } else {
        this.land(ground);
      }
    }
  }

  private launch(sheetVel: number) {
    this.airborne = true;
    this.launched = true;
    this.thumping = false;
    this.launchTime = this.clock;
    this.trampoline = this.clock - this.hopPressedAt < TRAMPOLINE_EARLY || this.clock < this.autoTrampolineUntil;
    // Bouncing used your hop defensively, so the thump charge comes back.
    if (this.trampoline) this.thumpCooldown = 0;
    this.vz = Math.min(sheetVel * 0.6, MAX_LAUNCH) * (this.trampoline ? TRAMPOLINE_MULT : 1);
    this.events.push('launched');
  }

  private land(ground: number) {
    this.h = ground;
    this.vz = 0;
    this.airborne = false;
    if (this.thumping) {
      this.thumping = false;
      this.events.push('slam');
    }
    if (this.launched) {
      this.launched = false;
      if (this.trampoline) {
        this.boost = Math.max(this.boost, 1.3);
        this.events.push('bigAir');
      } else {
        this.speed *= 0.65;
        this.spin = Math.max(this.spin, 0.4);
        this.events.push('thumped');
      }
      this.trampoline = false;
    }
  }

  updateVisual(time: number) {
    const f = this.track.sample(this.s, this.v, 0, this.frame);
    const c = Math.cos(this.psi);
    const sn = Math.sin(this.psi);
    tmpFwd.copy(f.T).multiplyScalar(c).addScaledVector(f.A, sn);
    tmpLeft.copy(f.A).multiplyScalar(c).addScaledVector(f.T, -sn);
    tmpMat.makeBasis(tmpLeft, f.N, tmpFwd);
    this.group.quaternion.setFromRotationMatrix(tmpMat);
    this.group.position.copy(f.pos).addScaledVector(f.N, this.h);
    const air = this.h - this.ground;
    this.shadow.position.y = 0.05 - air;
    this.shadow.scale.setScalar(Math.max(0.35, 1 - air * 0.12));

    this.model.rotation.y = this.spin > 0 ? this.spin * 14 : 0;
    // Tumble while launched; nose up while riding a big-air bounce.
    this.model.rotation.x = this.launched ? (this.trampoline ? -0.35 : (this.clock - this.launchTime) * 9) : 0;
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;

    this.flame.visible = this.boost > 0;
    this.flame.scale.set(1, 1, 0.8 + Math.sin(time * 60) * 0.25);
  }

  /** Forward direction including heading, plus the frame at the kart. Used by the camera. */
  chaseFrame(outFwd: THREE.Vector3): TrackFrame {
    const f = this.track.sample(this.s, this.v, 0, this.frame);
    outFwd.copy(f.T).multiplyScalar(Math.cos(this.psi)).addScaledVector(f.A, Math.sin(this.psi));
    f.pos.addScaledVector(f.N, this.h * 0.7);
    return f;
  }
}
