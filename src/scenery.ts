import * as THREE from 'three';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';

/** The classic "bottle" immersion of the Klein bottle, u, v ∈ [0, 1]. */
function kleinBottle(u: number, v: number, target: THREE.Vector3) {
  u *= Math.PI;
  v *= 2 * Math.PI;
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const cv = Math.cos(v);
  const sv = Math.sin(v);
  const cu2 = cu * cu;
  const cu3 = cu2 * cu;
  const cu4 = cu2 * cu2;
  const cu5 = cu4 * cu;
  const cu6 = cu4 * cu2;
  const cu7 = cu6 * cu;
  const x = (-2 / 15) * cu * (3 * cv - 30 * su + 90 * cu4 * su - 60 * cu6 * su + 5 * cu * cv * su);
  const y =
    (-1 / 15) *
    su *
    (3 * cv -
      3 * cu2 * cv -
      48 * cu4 * cv +
      48 * cu6 * cv -
      60 * su +
      5 * cu * cv * su -
      5 * cu3 * cv * su -
      80 * cu5 * cv * su +
      80 * cu7 * cv * su);
  const z = (2 / 15) * (3 + 5 * cu * su) * sv;
  target.set(x, y, z);
}

const glowVert = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const glowFrag = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
    gl_FragColor = vec4(uColor * (0.12 + f * 1.3), 0.1 + f * 0.7);
  }
`;

function glowMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: glowVert,
    fragmentShader: glowFrag,
    uniforms: { uColor: { value: new THREE.Color(color) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFrag = /* glsl */ `
  varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 top = vec3(0.03, 0.02, 0.10);
    vec3 mid = vec3(0.20, 0.06, 0.30);
    vec3 bot = vec3(0.02, 0.07, 0.16);
    vec3 col = h > 0.0 ? mix(mid, top, pow(h, 0.5)) : mix(mid, bot, pow(-h, 0.5));
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Scenery {
  readonly group = new THREE.Group();
  private readonly bottles: { mesh: THREE.Mesh; spin: THREE.Vector3 }[] = [];

  constructor() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false }),
    );
    sky.renderOrder = -10;
    this.group.add(sky);

    const count = 1500;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const d = new THREE.Vector3().randomDirection().multiplyScalar(700 + Math.random() * 600);
      d.toArray(pos, i * 3);
      c.setHSL(Math.random(), 0.6, 0.75 + Math.random() * 0.25).toArray(col, i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.group.add(
      new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true })),
    );

    // Klein bottles: one hovering in the middle of the loop, more drifting far away.
    const geometry = new ParametricGeometry(kleinBottle, 64, 48);
    geometry.center();
    const placements: [number, number, number, number, number][] = [
      [0, 4, 0, 7, 0x66ffe0],
      [260, 60, -180, 22, 0xff66cc],
      [-300, -40, 120, 26, 0xffcc55],
      [80, -90, 320, 18, 0x88aaff],
    ];
    for (const [x, y, z, scale, color] of placements) {
      const mesh = new THREE.Mesh(geometry, glowMaterial(color));
      mesh.position.set(x, y, z);
      mesh.scale.setScalar(scale);
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      mesh.renderOrder = -5;
      this.group.add(mesh);
      const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.3);
      this.bottles.push({ mesh, spin });
    }
  }

  update(dt: number) {
    for (const b of this.bottles) {
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      b.mesh.rotation.z += b.spin.z * dt;
    }
  }
}
