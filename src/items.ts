import * as THREE from 'three';
import { Kart } from './kart';
import { MobiusTrack, newFrame, wrapDelta } from './track';

const frame = newFrame();
const basis = new THREE.Matrix4();

/** Place an object at race coordinates, oriented so +y is the surface normal and +z is forward. */
function place(obj: THREE.Object3D, track: MobiusTrack, s: number, v: number, h: number) {
  const f = track.sample(s, v, h, frame);
  basis.makeBasis(f.A, f.N, f.T);
  obj.quaternion.setFromRotationMatrix(basis);
  obj.position.copy(f.pos);
}

// ---------------------------------------------------------------------------

interface Box {
  s: number;
  v: number;
  cooldown: number;
  gem: THREE.Mesh;
}

export class ItemBoxes {
  readonly list: Box[] = [];
  private readonly material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xff00ff,
    emissiveIntensity: 0.8,
    roughness: 0.2,
    flatShading: true,
    transparent: true,
    opacity: 0.9,
  });

  constructor(
    private readonly track: MobiusTrack,
    scene: THREE.Scene,
  ) {
    const geometry = new THREE.OctahedronGeometry(0.85);
    // A quarter-lap apart, so grid A (starting at 0) and grid B (starting at 0.5) meet rows at the same
    // distances from their own start lines.
    const rows = [0.05, 0.3, 0.55, 0.8];
    for (const r of rows) {
      for (const v of [-5, 0, 5]) {
        const holder = new THREE.Group();
        const gem = new THREE.Mesh(geometry, this.material);
        holder.add(gem);
        const s = r * track.length;
        place(holder, track, s, v, 1.3);
        scene.add(holder);
        this.list.push({ s, v, cooldown: 0, gem });
      }
    }
  }

  reset() {
    for (const b of this.list) b.cooldown = 0;
  }

  update(dt: number, time: number) {
    this.material.emissive.setHSL((time * 0.25) % 1, 0.9, 0.5);
    for (const b of this.list) {
      b.cooldown -= dt;
      b.gem.visible = b.cooldown <= 0;
      b.gem.rotation.y = time * 2 + b.v;
      b.gem.position.y = Math.sin(time * 3 + b.s) * 0.15;
    }
  }

  /** Returns true if the kart drove through an active box (which is then used up). */
  tryPickup(kart: Kart): boolean {
    for (const b of this.list) {
      if (b.cooldown > 0) continue;
      if (Math.abs(wrapDelta(b.s - kart.s, this.track.length)) < 1.8 && Math.abs(b.v - kart.v) < 1.8) {
        b.cooldown = 3;
        return true;
      }
    }
    return false;
  }

  /** The v of the closest active box within `range` ahead, for AI seeking. */
  nearestAhead(kart: Kart, range: number): number | null {
    let best: number | null = null;
    let bestScore = Infinity;
    for (const b of this.list) {
      if (b.cooldown > 0) continue;
      const d = wrapDelta(b.s - kart.s, this.track.length);
      if (d < 4 || d > range) continue;
      const score = d + Math.abs(b.v - kart.v) * 3;
      if (score < bestScore) {
        bestScore = score;
        best = b.v;
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------

function chevronTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,140,30,0.55)';
  g.fillRect(0, 0, 64, 128);
  g.strokeStyle = '#fff6a0';
  g.lineWidth = 12;
  g.lineJoin = 'round';
  for (const y of [20, 84]) {
    g.beginPath();
    g.moveTo(8, y);
    g.lineTo(32, y + 28);
    g.lineTo(56, y);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class BoostPads {
  readonly pads: { s: number; v: number }[] = [];
  private readonly texture = chevronTexture();

  constructor(
    private readonly track: MobiusTrack,
    scene: THREE.Scene,
  ) {
    const L = track.length;
    const spots = [
      [0.14, 0],
      [0.34, -5],
      [0.34, 5],
      [0.52, 0],
      [0.68, -5.5],
      [0.85, 5.5],
    ];
    const geometry = new THREE.PlaneGeometry(3, 4).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (const [r, v] of spots) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = 2;
      place(mesh, track, r * L, v, 0.06);
      scene.add(mesh);
      this.pads.push({ s: r * L, v });
    }
  }

  update(dt: number) {
    this.texture.offset.y -= dt * 1.5;
  }

  check(kart: Kart): boolean {
    for (const p of this.pads) {
      if (Math.abs(wrapDelta(kart.s - p.s, this.track.length)) < 2 && Math.abs(kart.v - p.v) < 1.7) return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------

const slickVert = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xz / 1.6;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Swirling rainbow oil sheen with a pulsing rim, so slicks read clearly against the dark track.
const slickFrag = /* glsl */ `
  uniform float uTime;
  varying vec2 vP;
  void main() {
    float ang = atan(vP.y, vP.x);
    float r = length(vP) * (1.0 + 0.07 * sin(ang * 5.0 + uTime * 2.0));
    if (r > 1.0) discard;
    float hue = r * 2.5 + ang / 6.28318 - uTime * 0.6;
    vec3 sheen = 0.5 + 0.5 * cos(6.28318 * (hue + vec3(0.0, 0.33, 0.67)));
    vec3 col = mix(vec3(0.06, 0.02, 0.1), sheen, smoothstep(0.15, 0.7, r) * 0.85);
    float rim = smoothstep(0.78, 0.93, r) * (0.65 + 0.35 * sin(uTime * 8.0));
    col = mix(col, vec3(1.0, 0.35, 0.6), rim);
    gl_FragColor = vec4(col, 0.92);
  }
`;

interface Slick {
  s: number;
  v: number;
  owner: Kart;
  age: number;
  holder: THREE.Group;
  marker: THREE.Mesh;
}

interface Puff {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  age: number;
}

const PUFF_LIFE = 0.45;

export class Slicks {
  readonly list: Slick[] = [];
  private readonly puffs: Puff[] = [];
  private time = 0;
  private readonly discGeo = new THREE.CircleGeometry(1.6, 32).rotateX(-Math.PI / 2);
  private readonly discMat = new THREE.ShaderMaterial({
    vertexShader: slickVert,
    fragmentShader: slickFrag,
    uniforms: { uTime: { value: 0 } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // Floating warning marker: easy to spot far ahead, and through the floor from the other face.
  private readonly markerGeo = new THREE.ConeGeometry(0.45, 0.9, 4).rotateX(Math.PI);
  private readonly markerMat = new THREE.MeshBasicMaterial({ color: 0xff3a7a });
  private readonly puffGeo = new THREE.SphereGeometry(1, 12, 8);

  constructor(
    private readonly track: MobiusTrack,
    private readonly scene: THREE.Scene,
  ) {}

  add(kart: Kart) {
    if (this.list.length >= 12) this.remove(this.list[0]);
    const s = kart.s - 3;
    const holder = new THREE.Group();
    const disc = new THREE.Mesh(this.discGeo, this.discMat);
    disc.position.y = 0.07;
    disc.renderOrder = 2;
    const marker = new THREE.Mesh(this.markerGeo, this.markerMat);
    holder.add(disc, marker);
    place(holder, this.track, s, kart.v, 0);
    this.scene.add(holder);
    this.list.push({ s, v: kart.v, owner: kart, age: 0, holder, marker });
    this.puff(s, kart.v, 0x9a5cff);
  }

  clear() {
    while (this.list.length) this.remove(this.list[0]);
    for (const p of this.puffs) this.scene.remove(p.mesh);
    this.puffs.length = 0;
  }

  update(dt: number) {
    this.time += dt;
    this.discMat.uniforms.uTime.value = this.time;
    for (const sl of [...this.list]) {
      sl.age += dt;
      if (sl.age > 30) this.remove(sl);
      sl.marker.position.y = 2.3 + Math.sin(this.time * 4 + sl.s) * 0.2;
      sl.marker.rotation.y = this.time * 3;
    }
    for (const p of [...this.puffs]) {
      p.age += dt;
      const t = p.age / PUFF_LIFE;
      if (t >= 1) {
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        this.puffs.splice(this.puffs.indexOf(p), 1);
        continue;
      }
      p.mesh.scale.setScalar(0.6 + t * 2.2);
      p.mesh.material.opacity = 0.7 * (1 - t);
    }
  }

  /** Returns true if the kart hit a slick (which is then cleaned up with a splash). */
  check(kart: Kart): boolean {
    for (const sl of this.list) {
      if (sl.owner === kart && sl.age < 1.2) continue;
      if (Math.abs(wrapDelta(sl.s - kart.s, this.track.length)) < 1.6 && Math.abs(sl.v - kart.v) < 1.6) {
        this.remove(sl);
        this.puff(sl.s, sl.v, 0xff5a9a);
        return true;
      }
    }
    return false;
  }

  private puff(s: number, v: number, color: number) {
    const mesh = new THREE.Mesh(
      this.puffGeo,
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }),
    );
    mesh.renderOrder = 3;
    place(mesh, this.track, s, v, 0.6);
    mesh.scale.setScalar(0.6);
    this.scene.add(mesh);
    this.puffs.push({ mesh, age: 0 });
  }

  private remove(sl: Slick) {
    this.scene.remove(sl.holder);
    this.list.splice(this.list.indexOf(sl), 1);
  }
}
