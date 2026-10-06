import * as THREE from 'three';
import { BUMP_GLSL, Bumps } from './thump';

/** Position and orientation of a point on the track, in world space. */
export interface TrackFrame {
  pos: THREE.Vector3;
  /** Forward, along the race direction. */
  T: THREE.Vector3;
  /** Across the track toward +v (the driver's left). */
  A: THREE.Vector3;
  /** Surface normal on the face being raced (T × A). */
  N: THREE.Vector3;
  /** Geodesic curvature of the centre line: + means the track bends toward +v. */
  kappa: number;
}

export function newFrame(): TrackFrame {
  return {
    pos: new THREE.Vector3(),
    T: new THREE.Vector3(),
    A: new THREE.Vector3(),
    N: new THREE.Vector3(),
    kappa: 0,
  };
}

export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Signed difference wrapped into [-n/2, n/2). */
export function wrapDelta(d: number, n: number): number {
  return mod(d + n / 2, n) - n / 2;
}

const TABLE = 4096;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * A Möbius strip racetrack.
 *
 * Everything in the game lives in race coordinates (s, v): s is arc length
 * along the centre line and v is the sideways offset (+v = driver's left).
 * The strip is one-sided, so getting back to the start on the *same* face
 * takes two trips round the loop. One lap is s ∈ [0, length), and the point
 * physically on the other side of (s, v) is (s + length/2, -v).
 */
export class MobiusTrack {
  /** One full lap: two trips round the loop. */
  readonly length: number;
  readonly halfWidth: number;

  private readonly c = new Float32Array(TABLE * 3);
  private readonly T = new Float32Array(TABLE * 3);
  private readonly A = new Float32Array(TABLE * 3);
  private readonly N = new Float32Array(TABLE * 3);
  private readonly kappa = new Float32Array(TABLE);

  constructor(
    readonly radius = 55,
    readonly width = 18,
    readonly hill = 6,
  ) {
    this.halfWidth = width / 2;

    // Arc length of the centre line over the doubled parameter range t ∈ [0, 4π].
    const M = TABLE * 8;
    const cum = new Float64Array(M + 1);
    const p = this.centerAt(0, new THREE.Vector3());
    const q = new THREE.Vector3();
    for (let i = 1; i <= M; i++) {
      this.centerAt((4 * Math.PI * i) / M, q);
      cum[i] = cum[i - 1] + q.distanceTo(p);
      p.copy(q);
    }
    this.length = cum[M];

    // Resample so table entries are evenly spaced in s.
    const c = new THREE.Vector3();
    const T = new THREE.Vector3();
    const A = new THREE.Vector3();
    const N = new THREE.Vector3();
    let j = 0;
    for (let i = 0; i < TABLE; i++) {
      const s = (i / TABLE) * this.length;
      while (cum[j + 1] < s) j++;
      const t = (4 * Math.PI * (j + (s - cum[j]) / (cum[j + 1] - cum[j]))) / M;
      this.frameAtT(t, c, T, A, N);
      c.toArray(this.c, i * 3);
      T.toArray(this.T, i * 3);
      A.toArray(this.A, i * 3);
      N.toArray(this.N, i * 3);
    }

    // Geodesic curvature: how fast the centre line bends within the surface.
    const ds = this.length / TABLE;
    for (let i = 0; i < TABLE; i++) {
      const a = ((i + TABLE - 1) % TABLE) * 3;
      const b = ((i + 1) % TABLE) * 3;
      let k = 0;
      for (let d = 0; d < 3; d++) k += ((this.T[b + d] - this.T[a + d]) / (2 * ds)) * this.A[i * 3 + d];
      this.kappa[i] = k;
    }
  }

  centerAt(t: number, out: THREE.Vector3): THREE.Vector3 {
    const R = this.radius;
    return out.set(R * Math.cos(t), this.hill * Math.sin(2 * t), R * Math.sin(t));
  }

  /** The half-twist: the across vector turns by t/2, so it flips after one trip round. */
  private frameAtT(t: number, c: THREE.Vector3, T: THREE.Vector3, A: THREE.Vector3, N: THREE.Vector3) {
    const R = this.radius;
    this.centerAt(t, c);
    T.set(-R * Math.sin(t), 2 * this.hill * Math.cos(2 * t), R * Math.cos(t)).normalize();
    const side = new THREE.Vector3().crossVectors(UP, T).normalize();
    const up = new THREE.Vector3().crossVectors(T, side);
    A.copy(side)
      .multiplyScalar(Math.cos(t / 2))
      .addScaledVector(up, Math.sin(t / 2));
    N.crossVectors(T, A);
  }

  /** World-space frame at race coordinates (s, v), lifted h above the surface. */
  sample(s: number, v: number, h: number, out: TrackFrame): TrackFrame {
    const x = (mod(s, this.length) / this.length) * TABLE;
    const fl = Math.floor(x);
    const i0 = fl % TABLE;
    const i1 = (i0 + 1) % TABLE;
    const f = x - fl;
    lerp3(this.c, i0, i1, f, out.pos);
    lerp3(this.T, i0, i1, f, out.T).normalize();
    lerp3(this.A, i0, i1, f, out.A).normalize();
    lerp3(this.N, i0, i1, f, out.N).normalize();
    out.kappa = this.kappa[i0] * (1 - f) + this.kappa[i1] * f;
    out.pos.addScaledVector(out.A, v).addScaledVector(out.N, h);
    return out;
  }
}

function lerp3(arr: Float32Array, i0: number, i1: number, f: number, out: THREE.Vector3): THREE.Vector3 {
  const a = i0 * 3;
  const b = i1 * 3;
  return out.set(
    arr[a] + (arr[b] - arr[a]) * f,
    arr[a + 1] + (arr[b + 1] - arr[a + 1]) * f,
    arr[a + 2] + (arr[b + 2] - arr[a + 2]) * f,
  );
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const trackVert = /* glsl */ `
  uniform float uL;
  ${BUMP_GLSL}
  attribute float aS;
  attribute float aV;
  varying float vS;
  varying float vV;
  varying float vBump;
  varying vec3 vViewPos;
  varying vec3 vNrm;
  void main() {
    vS = aS;
    vV = aV;
    // Mesh coordinates are face-A race coordinates and the mesh normal is face A's normal.
    float h = bumpHeight(aS, aV);
    vBump = abs(h);
    vec4 mv = modelViewMatrix * vec4(position + normal * h, 1.0);
    vViewPos = mv.xyz;
    vNrm = normalMatrix * normal;
    gl_Position = projectionMatrix * mv;
  }
`;

const trackFrag = /* glsl */ `
  uniform float uL;
  uniform float uHW;
  uniform float uTime;
  varying float vS;
  varying float vV;
  varying float vBump;
  varying vec3 vViewPos;
  varying vec3 vNrm;

  vec3 palette(float t) {
    return 0.55 + 0.45 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
  }

  float line(float x, float w) {
    float aa = fwidth(x) * 1.5;
    return 1.0 - smoothstep(w * 0.5, w * 0.5 + aa, abs(x));
  }

  void main() {
    // The mesh only covers half a lap. Its back face is the other half,
    // with the sideways axis mirrored.
    float s = vS;
    float v = vV;
    vec3 n = normalize(vNrm);
    if (!gl_FrontFacing) {
      s += uL * 0.5;
      v = -v;
      n = -n;
    }

    vec3 base = palette(s / uL + 0.55);

    float laneW = uHW * 0.5;
    float lv = (fract(v / laneW + 0.5) - 0.5) * laneW;
    float dash = step(0.45, fract(s / 7.0));
    float lanes = line(lv, 0.2) * dash * (1.0 - step(uHW - 0.8, abs(v)));
    float rungs = line((fract(s / 12.0 + 0.5) - 0.5) * 12.0, 0.14);
    float edge = smoothstep(uHW - 1.6, uHW - 0.2, abs(v));
    float pulse = pow(0.5 + 0.5 * sin(s * 0.2 - uTime * 5.0), 10.0) * 0.4;

    vec3 col = base * (0.28 + pulse) + vec3(lanes * 0.85) + base * rungs * 0.6
             + mix(base, vec3(1.0), 0.5) * edge;
    float a = 0.13 + 0.5 * lanes + 0.22 * rungs + 0.55 * edge + pulse * 0.3;

    if (s < 3.0) {
      // Start/finish line.
      float ch = mod(floor(s) + floor((v + uHW) * 1.0), 2.0);
      col = vec3(ch);
      a = 0.9;
    } else if (s > uL * 0.5 && s < uL * 0.5 + 3.0) {
      // The back of the finish line: halfway round, on the other face.
      float st = step(0.5, fract((s + v) * 0.5));
      col = mix(vec3(0.08), vec3(1.0, 0.8, 0.1), st);
      a = 0.75;
    }

    // Thumps glow so you can see them coming through the sheet.
    float glow = clamp(vBump * 0.5, 0.0, 1.0);
    col = mix(col, vec3(1.0, 0.55, 0.95), glow);
    a = max(a, glow * 0.8);

    float fres = pow(1.0 - abs(dot(n, normalize(-vViewPos))), 3.0);
    a = clamp(a + fres * 0.12, 0.0, 0.95);
    a *= mix(1.0, 0.6, smoothstep(60.0, 220.0, length(vViewPos)));
    gl_FragColor = vec4(col, a);
  }
`;

export interface TrackVisual {
  group: THREE.Group;
  material: THREE.ShaderMaterial;
}

export function buildTrackVisual(track: MobiusTrack, bumps: Bumps): TrackVisual {
  const group = new THREE.Group();

  // Surface: only half a lap of s, since the other half is the same sheet seen from behind.
  const segs = 480;
  const across = 24;
  const pos: number[] = [];
  const nrm: number[] = [];
  const aS: number[] = [];
  const aV: number[] = [];
  const f = newFrame();
  for (let i = 0; i <= segs; i++) {
    const s = (i / segs) * (track.length / 2);
    for (let j = 0; j <= across; j++) {
      const v = -track.halfWidth + (j / across) * track.width;
      track.sample(s, v, 0, f);
      pos.push(f.pos.x, f.pos.y, f.pos.z);
      nrm.push(f.N.x, f.N.y, f.N.z);
      aS.push(s);
      aV.push(v);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * (across + 1) + j;
      const b = a + across + 1;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
  geo.setAttribute('aV', new THREE.Float32BufferAttribute(aV, 1));
  geo.setIndex(index);

  const material = new THREE.ShaderMaterial({
    vertexShader: trackVert,
    fragmentShader: trackFrag,
    uniforms: {
      uL: { value: track.length },
      uHW: { value: track.halfWidth },
      uTime: { value: 0 },
      uBumps: { value: bumps.uniform },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const surface = new THREE.Mesh(geo, material);
  surface.renderOrder = 1;
  group.add(surface);

  // A Möbius strip has a single edge: one closed curve twice the loop's length.
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 720; i++) {
    track.sample((i / 720) * track.length, track.halfWidth, 0, f);
    pts.push(f.pos.clone());
  }
  const rail = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 1200, 0.3, 6, true),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x88ccff, emissiveIntensity: 0.9, roughness: 0.3 }),
  );
  group.add(rail);

  return { group, material };
}

/**
 * A finish gantry over the track at race position s. At s = L/2 it hangs off face B,
 * which means physically underneath grid A's gantry.
 */
export function buildFinishArch(track: MobiusTrack, s: number, label: string, color: string): THREE.Group {
  const arch = new THREE.Group();
  const f = track.sample(s, 0, 0, newFrame());
  arch.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.A, f.N, f.T));
  arch.position.copy(f.pos);

  const postMat = new THREE.MeshStandardMaterial({ color: 0x222233, emissive: color, emissiveIntensity: 0.25 });
  const post = new THREE.BoxGeometry(0.45, 6.4, 0.45);
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(post, postMat);
    p.position.set(side * (track.halfWidth + 0.7), 3.2, 0);
    arch.add(p);
  }

  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#140a28';
  g.fillRect(0, 0, 1024, 128);
  g.strokeStyle = color;
  g.lineWidth = 10;
  g.strokeRect(5, 5, 1014, 118);
  g.fillStyle = color;
  g.font = 'italic 900 76px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 512, 68);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;

  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(track.width + 1.9, 1.9),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }),
  );
  // Planes face +z; turn it to face karts arriving from behind.
  banner.rotation.y = Math.PI;
  banner.position.y = 6.2;
  arch.add(banner);
  return arch;
}
