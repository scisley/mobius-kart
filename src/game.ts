import * as THREE from 'three';
import { AIDriver, AIContext } from './ai';
import { SoundSystem } from './audio';
import { formatTime, Hud } from './hud';
import { Input } from './input';
import { BoostPads, ItemBoxes, Slicks } from './items';
import { Controls, ItemKind, Kart, THUMP_COOLDOWN, TOP_SPEED } from './kart';
import { Scenery } from './scenery';
import { Tutorial } from './tutorial';
import { Bumps } from './thump';
import { buildFinishArch, buildTrackVisual, MobiusTrack, TrackVisual, wrapDelta } from './track';

const LAPS = 3;
/** How closely two karts must be mirrored across the sheet to thump or slipstream each other. */
const MIRROR_RANGE_S = 9;
const MIRROR_RANGE_V = 4.5;
/** Top-speed bonus for holding an antipode link, reached after LINK_RAMP seconds. */
const LINK_BONUS = 0.06;
const LINK_RAMP = 1;

/**
 * Two grids of four, back to back on the same patch of track: grid A behind the finish line
 * on face A, grid B behind the halfway band on face B. Each races 3 laps from its own line.
 */
const ROSTER: { name: string; color: number; skill: number; grid: 'A' | 'B'; hunter?: boolean }[] = [
  { name: 'Volt', color: 0xffd23b, skill: 0.97, grid: 'A' },
  { name: 'Moss', color: 0x3bdc6a, skill: 0.94, grid: 'A' },
  { name: 'You', color: 0xff3b3b, skill: 0.97, grid: 'A' },
  { name: 'Pip', color: 0x3bb6ff, skill: 0.95, grid: 'A', hunter: true },
  { name: 'Taffy', color: 0xff7ad9, skill: 0.92, grid: 'B' },
  { name: 'Rook', color: 0xff8a2a, skill: 0.95, grid: 'B' },
  { name: 'Juno', color: 0x2ae0d0, skill: 0.96, grid: 'B' },
  // The fastest racer, hunting from the other face. 4th in grid B puts him directly under you at the start.
  { name: 'Ethan', color: 0xb44bff, skill: 0.98, grid: 'B', hunter: true },
];

type Phase = 'title' | 'countdown' | 'race' | 'done' | 'tutorial';

export interface ResultRow {
  name: string;
  color: number;
  time: string;
  me: boolean;
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, 4000);
  private readonly track = new MobiusTrack();
  private readonly trackVisual: TrackVisual;
  private readonly scenery = new Scenery();
  private readonly boxes: ItemBoxes;
  private readonly pads: BoostPads;
  private readonly slicks: Slicks;
  private readonly bumps: Bumps;
  private readonly reticle: THREE.Mesh;
  private readonly tether: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly karts: Kart[] = [];
  private readonly drivers = new Map<Kart, AIDriver>();
  private readonly player: Kart;

  private phase: Phase = 'title';
  private phaseTime = 0;
  private raceTime = 0;
  private time = 0;
  private ranked: Kart[] = [];
  private lastLap = 1;
  private lastSideB = false;
  private resultsShown = false;
  private playerSlamAt = -99;
  private playerVictim: Kart | null = null;
  private shake = 0;
  private lastCount = 0;
  private playerOnPad = false;
  private wasLinked = false;

  private readonly camPos = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3(0, 1, 0);
  private readonly camLook = new THREE.Vector3();
  private readonly tmpFwd = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly playerCtl: Controls = { steer: 0, brake: false, useItem: false, thump: false };

  onFinish: (rows: ResultRow[]) => void = () => {};
  onTutorialExit: (to: 'race' | 'title') => void = () => {};
  /** Karts taking part right now: everyone in a race, just you (and later Ethan) in the tutorial. */
  private active: Kart[] = [];
  private tutorial: Tutorial | null = null;

  constructor(
    container: HTMLElement,
    private readonly input: Input,
    private readonly hud: Hud,
    private readonly sound: SoundSystem,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene.add(this.scenery.group);
    this.scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a2a70, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(30, 80, 40);
    this.scene.add(sun);

    this.bumps = new Bumps(this.track);
    this.trackVisual = buildTrackVisual(this.track, this.bumps);
    this.scene.add(this.trackVisual.group);
    this.boxes = new ItemBoxes(this.track, this.scene);
    this.pads = new BoostPads(this.track, this.scene);
    this.slicks = new Slicks(this.track, this.scene);

    // Lock-on ring around whoever is opposite you; drawn on top so it shows through the floor.
    this.reticle = new THREE.Mesh(
      new THREE.TorusGeometry(2.1, 0.13, 8, 40).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff3a7a, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.reticle.renderOrder = 5;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    // Slipstream beam between you and your antipode partner, through the sheet.
    this.tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 1, 6, 1, true).translate(0, 0.5, 0),
      new THREE.MeshBasicMaterial({ color: 0x5ff6ff, transparent: true, depthTest: false, blending: THREE.AdditiveBlending }),
    );
    this.tether.renderOrder = 5;
    this.tether.visible = false;
    this.scene.add(this.tether);

    this.scene.add(buildFinishArch(this.track, 1.5, 'GRID A  ·  FINISH', '#ffffff'));
    this.scene.add(buildFinishArch(this.track, this.track.length / 2 + 1.5, 'GRID B  ·  FINISH', '#ffd84f'));

    for (const r of ROSTER) {
      const kart = new Kart(r.name, r.color, this.track);
      kart.grid = r.grid;
      this.karts.push(kart);
      this.drivers.set(kart, new AIDriver(kart, r.skill, r.hunter));
      this.scene.add(kart.group);
    }
    this.player = this.karts.find((k) => k.name === 'You')!;

    this.resetGrid();
    this.setActive(this.karts);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private resetGrid() {
    for (const grid of ['A', 'B'] as const) {
      const start = grid === 'A' ? 0 : this.track.length / 2;
      this.karts
        .filter((k) => k.grid === grid)
        .forEach((k, i) => k.reset(start, 4 + Math.floor(i / 2) * 6, i % 2 ? -3.5 : 3.5));
    }
    this.slicks.clear();
    this.bumps.clear();
    this.boxes.reset();
    this.ranked = [...this.karts];
    for (const k of this.karts) k.updateVisual(0);
  }

  private setActive(karts: Kart[]) {
    this.active = karts;
    for (const k of this.karts) k.group.visible = karts.includes(k);
  }

  private endTutorial() {
    this.tutorial?.dispose();
    this.tutorial = null;
  }

  toTitle() {
    this.endTutorial();
    this.resetGrid();
    this.setActive(this.karts);
    this.phase = 'title';
  }

  startTutorial() {
    this.endTutorial();
    this.resetGrid();
    this.setActive([this.player]);
    const ethan = this.karts.find((k) => k.name === 'Ethan')!;
    this.phase = 'tutorial';
    this.phaseTime = 0;
    this.raceTime = 0;
    this.input.tilt.calibrate();
    this.snapCamera();
    this.tutorial = new Tutorial({
      player: this.player,
      partner: ethan,
      trackLength: this.track.length,
      input: this.input,
      setPartnerActive: (on) => {
        this.setActive(on ? [this.player, ethan] : [this.player]);
        if (on) ethan.reset(this.player.progress + this.track.length / 2, 0, -this.player.v);
      },
      celebrate: () => {
        this.hud.flash('NICE!', 0.9, true);
        this.sound.lap(false);
      },
      flash: (text) => this.hud.flash(text, 1.4, true),
      exit: (to) => {
        // Defer: this runs from a tutorial button handler, and exiting disposes the tutorial.
        queueMicrotask(() => {
          this.toTitle();
          this.onTutorialExit(to);
        });
      },
    });
  }

  startRace() {
    this.endTutorial();
    this.resetGrid();
    this.setActive(this.karts);
    this.phase = 'countdown';
    this.phaseTime = 0;
    this.raceTime = 0;
    this.lastLap = 1;
    this.lastSideB = false;
    this.resultsShown = false;
    this.lastCount = 0;
    this.input.tilt.calibrate();
    this.snapCamera();
  }

  tick(dt: number) {
    this.time += dt;
    this.input.update(dt);
    this.trackVisual.material.uniforms.uTime.value = this.time;
    this.scenery.update(dt);
    this.boxes.update(dt, this.time);
    this.pads.update(dt);

    if (this.phase === 'title') {
      this.orbitCamera();
    } else {
      this.phaseTime += dt;
      if (this.phase === 'countdown') this.countdown();
      else this.simulate(dt);
      this.tutorial?.update(dt);
      this.updateThumpUI();
      this.followCamera(dt);
      this.hud.update(dt, this.player, this.ranked.indexOf(this.player) + 1, LAPS, this.raceTime);
      this.hud.drawMinimap(this.track, this.active, this.player);
    }

    this.updateSound();
    for (const k of this.karts) k.updateVisual(this.time);
    this.renderer.render(this.scene, this.camera);
  }

  private countdown() {
    const n = 4 - Math.floor(this.phaseTime);
    if (n === 4) {
      this.hud.flash("ETHAN'S LOOP", 0.5, true);
    } else if (n > 0) {
      this.hud.flash(String(n), 0.5);
      if (n !== this.lastCount) this.sound.countdown(false);
      this.lastCount = n;
    } else {
      this.hud.flash('GO!', 0.8);
      this.sound.countdown(true);
      // Whatever angle you're holding the phone at when the race starts is "straight".
      this.input.tilt.calibrate();
      this.phase = 'race';
    }
  }

  private simulate(dt: number) {
    this.raceTime += dt;
    const ctx: AIContext = {
      track: this.track,
      boxes: this.boxes,
      slicks: this.slicks,
      time: this.time,
      hasThumpTarget: (k) => this.oppositeTarget(k) !== null,
      karts: this.active,
      player: this.player,
    };

    const useItem = this.input.consumeItem();
    const thump = this.input.consumeThump();
    const steps = Math.ceil(dt / (1 / 60));
    const h = dt / steps;
    for (let step = 0; step < steps; step++) {
      this.bumps.update(h);
      this.tutorial?.beforeStep();
      for (const k of this.active) {
        let ctl: Controls;
        if (k === this.player && !k.finished) {
          ctl = this.playerCtl;
          ctl.steer = this.input.steer;
          ctl.brake = this.input.brake;
          ctl.useItem = useItem && step === 0;
          ctl.thump = thump && step === 0;
        } else {
          ctl = this.drivers.get(k)!.controls(ctx, h);
        }
        k.update(h, ctl, this.topFactor(k), this.bumps);
        this.handleEvents(k);

        const isPlayer = k === this.player;
        if (ctl.useItem && k.item) this.useItem(k);
        if (this.boxes.tryPickup(k) && !k.item) {
          k.item = this.rollItem(k);
          if (isPlayer) this.sound.pickup();
        }
        const onPad = this.pads.check(k);
        if (onPad) k.boost = Math.max(k.boost, 0.9);
        if (isPlayer) {
          if (onPad && !this.playerOnPad) this.sound.boost();
          this.playerOnPad = onPad;
        }
        if (this.slicks.check(k)) {
          // Boosting karts skate straight over a slick.
          if (k.boost > 0) {
            if (isPlayer) {
              this.hud.flash('SKATED IT!', 0.8, true);
              this.sound.skated();
            }
          } else {
            k.spin = 1.0;
            if (isPlayer) {
              this.hud.flash('SLICKED!', 0.9, true);
              this.sound.slicked();
            }
          }
        }
        if (!this.tutorial && !k.finished && k.raced >= LAPS * this.track.length) {
          k.finished = true;
          k.finishTime = this.raceTime;
        }
      }
      this.collide();
      this.updateLinks(h);
    }
    this.slicks.update(dt);

    this.ranked = [...this.active].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.finishTime - b.finishTime;
      return b.raced - a.raced;
    });

    if (!this.tutorial) this.announce();
  }

  private topFactor(k: Kart): number {
    const link = 1 + LINK_BONUS * Math.min(1, k.linkTime / LINK_RAMP);
    if (k === this.player && !k.finished) return link;
    const driver = this.drivers.get(k)!;
    // Mild rubber-banding so the field stays together.
    const lead = k.raced - this.player.raced;
    return driver.skill * driver.speedAdjust * link * (1 - THREE.MathUtils.clamp(lead / 300, -0.08, 0.1));
  }

  /** Antipode slipstream: karts mirrored across the sheet both build up a speed bonus. */
  private updateLinks(dt: number) {
    for (const k of this.active) {
      if (this.oppositeTarget(k)) k.linkTime += dt;
      else k.linkTime = Math.max(0, k.linkTime - dt * 3);
    }
  }

  private rollItem(k: Kart): ItemKind {
    if (this.tutorial) return 'turbo';
    const rank = this.ranked.indexOf(k) / Math.max(1, this.karts.length - 1);
    // Slick odds: about 32% for the leader down to 5% for last place; turbos otherwise.
    const slickChance = (0.65 - 0.55 * rank) / 2;
    return Math.random() < slickChance ? 'slick' : 'turbo';
  }

  private useItem(k: Kart) {
    const isPlayer = k === this.player;
    if (k.item === 'turbo') {
      k.boost = Math.max(k.boost, 1.4);
      if (isPlayer) this.sound.boost();
    } else if (k.item === 'slick') {
      this.slicks.add(k);
      if (isPlayer) this.sound.slickDrop();
    }
    k.item = null;
    this.tutorial?.onItemUsed(k);
  }

  /** The kart most nearly mirrored across the sheet from k, if any is in thump range. */
  private oppositeTarget(k: Kart): Kart | null {
    const L = this.track.length;
    let best: Kart | null = null;
    let bestD = Infinity;
    for (const o of this.active) {
      if (o === k || o.launched) continue;
      const ds = Math.abs(wrapDelta(o.s - k.s - L / 2, L));
      const dv = Math.abs(o.v + k.v);
      if (ds > MIRROR_RANGE_S || dv > MIRROR_RANGE_V) continue;
      const d = Math.hypot(ds, dv);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private handleEvents(k: Kart) {
    const isPlayer = k === this.player;
    for (const e of k.events) {
      switch (e) {
        case 'thumpStart': {
          // Warn whoever is about to get it; AI sometimes times the bounce.
          const victim = this.oppositeTarget(k);
          if (isPlayer) {
            this.playerVictim = victim;
            this.sound.thumpHop();
          }
          if (victim === this.player) {
            this.hud.flash('⚠ INCOMING! THUMP TO BOUNCE', 0.6, true);
            this.sound.warning();
          } else if (victim && Math.random() < 0.35) victim.autoTrampolineUntil = victim.clock + 1;
          break;
        }
        case 'slam':
          this.bumps.add(k.s, k.v);
          // You hear slams close to you, which usually means right under or over you.
          this.sound.slam(isPlayer ? 1 : 1 - k.group.position.distanceTo(this.player.group.position) / 40);
          if (isPlayer) {
            this.playerSlamAt = this.raceTime;
            this.shake = 0.35;
          }
          break;
        case 'launched':
          if (isPlayer) {
            this.shake = 0.6;
            this.sound.launched();
          }
          break;
        case 'thumped':
          if (isPlayer) {
            this.hud.flash('THUMPED!', 0.9, true);
            this.sound.thumped();
          } else if (k === this.playerVictim && this.raceTime - this.playerSlamAt < 2) {
            this.hud.flash('GOTCHA!', 0.9, true);
            this.sound.gotcha();
          }
          break;
        case 'bigAir':
          if (isPlayer) {
            this.hud.flash('BIG AIR!', 0.9, true);
            this.sound.bigAir();
          }
          break;
      }
      this.tutorial?.onEvent(k, e);
    }
    k.events.length = 0;
  }

  private updateThumpUI() {
    const p = this.player;
    const live = this.phase === 'race' || this.phase === 'tutorial';
    const target = live && !p.finished ? this.oppositeTarget(p) : null;
    this.reticle.visible = target !== null;
    if (target) {
      this.reticle.position.copy(target.group.position);
      this.reticle.quaternion.copy(target.group.quaternion);
      this.reticle.scale.setScalar(p.thumpCooldown > 0 ? 0.8 : 1 + Math.sin(this.time * 12) * 0.08);
      (this.reticle.material as THREE.MeshBasicMaterial).opacity = p.thumpCooldown > 0 ? 0.35 : 0.9;
    }
    this.hud.setThump(1 - p.thumpCooldown / THUMP_COOLDOWN, target !== null);

    const linked = target !== null && p.linkTime > 0.05;
    if (linked && !this.wasLinked) this.sound.link();
    this.wasLinked = linked;
    this.tether.visible = linked;
    if (linked) {
      const a = p.group.localToWorld(this.tmpA.set(0, 1, 0));
      const dir = target.group.localToWorld(this.tmpB.set(0, 1, 0)).sub(a);
      const len = dir.length();
      this.tether.position.copy(a);
      this.tether.quaternion.setFromUnitVectors(this.tmpUp.set(0, 1, 0), dir.divideScalar(Math.max(len, 1e-3)));
      this.tether.scale.set(1, len, 1);
      this.tether.material.opacity = 0.4 + 0.4 * Math.min(1, p.linkTime / LINK_RAMP) + Math.sin(this.time * 20) * 0.1;
    }
    this.hud.setLink(Math.min(1, p.linkTime / LINK_RAMP));
  }

  /** Kart-to-kart bumps, done in race coordinates (karts on opposite faces never touch). */
  private collide() {
    const L = this.track.length;
    for (let i = 0; i < this.active.length; i++) {
      for (let j = i + 1; j < this.active.length; j++) {
        const a = this.active[i];
        const b = this.active[j];
        const ds = wrapDelta(a.progress - b.progress, L);
        const dv = a.v - b.v;
        if (Math.abs(ds) > 2.6 || Math.abs(dv) > 1.9) continue;
        if (Math.abs(a.h - b.h) > 1.5) continue;
        const push = (1.9 - Math.abs(dv)) * 0.5 * (dv >= 0 ? 1 : -1);
        a.v += push;
        b.v -= push;
        if (Math.abs(dv) < 1.2) {
          const [front, back] = ds > 0 ? [a, b] : [b, a];
          back.speed = Math.min(back.speed, front.speed * 0.97);
        }
      }
    }
  }

  private announce() {
    const p = this.player;
    if (!p.finished) {
      const lap = Math.max(1, p.lap);
      if (lap > this.lastLap) {
        this.hud.flash(lap === LAPS ? 'FINAL LAP!' : `LAP ${lap}`, 1.5);
        this.sound.lap(lap === LAPS);
        this.lastLap = lap;
      }
      if (p.onSideB !== this.lastSideB && p.raced > 0) {
        this.lastSideB = p.onSideB;
        if (p.onSideB) this.hud.flash('↻ OTHER SIDE', 1.0, true);
      }
    }

    if (p.finished && this.phase === 'race') {
      this.phase = 'done';
      this.phaseTime = 0;
      const place = this.ranked.indexOf(p) + 1;
      this.hud.flash(place === 1 ? 'YOU WIN!' : 'FINISH!', 2.5);
      this.sound.finish(place === 1);
    }
    if (this.phase === 'done' && !this.resultsShown && this.phaseTime > 2.5) {
      this.resultsShown = true;
      this.onFinish(
        this.ranked.map((k) => ({
          name: k.name,
          color: k.color,
          time: k.finished ? formatTime(k.finishTime) : '—',
          me: k === p,
        })),
      );
    }
  }

  private updateSound() {
    const p = this.player;
    const racing = this.phase === 'countdown' || this.phase === 'race';
    const finalLap = this.phase === 'race' && p.lap >= LAPS;
    this.sound.setMusic(racing ? (finalLap ? 'final' : 'race') : 'title');
    this.sound.engine(racing || this.phase === 'tutorial' || (this.phase === 'done' && !this.resultsShown), p.speed / TOP_SPEED, p.boost > 0, p.airborne);
  }

  // -------------------------------------------------------------------------
  // Camera

  private orbitCamera() {
    const a = this.time * 0.12;
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(Math.cos(a) * 120, 55, Math.sin(a) * 120);
    this.camera.lookAt(0, -5, 0);
    this.camera.fov = 60;
    this.camera.updateProjectionMatrix();
  }

  private chaseTargets(pos: THREE.Vector3, look: THREE.Vector3): THREE.Vector3 {
    const fwd = this.tmpFwd;
    const f = this.player.chaseFrame(fwd);
    // Look mostly along the kart's heading, but keep some of the track direction so sideways moves stay readable.
    fwd.multiplyScalar(0.6).addScaledVector(f.T, 0.4).normalize();
    pos.copy(f.pos).addScaledVector(f.N, 3.4).addScaledVector(fwd, -8);
    look.copy(f.pos).addScaledVector(f.N, 1.3).addScaledVector(fwd, 6);
    return f.N;
  }

  private snapCamera() {
    const up = this.chaseTargets(this.camPos, this.camLook);
    this.camUp.copy(up);
  }

  private followCamera(dt: number) {
    const look = this.tmpV;
    const target = new THREE.Vector3();
    const up = this.chaseTargets(target, look);
    this.camPos.lerp(target, 1 - Math.exp(-dt * 10));
    this.camLook.lerp(look, 1 - Math.exp(-dt * 14));
    this.camUp.lerp(up, 1 - Math.exp(-dt * 6)).normalize();

    this.camera.position.copy(this.camPos);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      this.camera.position.add(this.tmpV.randomDirection().multiplyScalar(this.shake * 0.6));
    }
    this.camera.up.copy(this.camUp);
    this.camera.lookAt(this.camLook);

    const portrait = this.camera.aspect < 1;
    const fov = (portrait ? 82 : 68) + (this.player.boost > 0 ? 10 : 0);
    this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 4));
    this.camera.updateProjectionMatrix();
  }
}
