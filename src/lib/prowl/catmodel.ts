// Catio Prowl's cat: one smooth skinned body (catbody.ts) with painted tabby fur, almond eyes, whiskers
// and a jointed rig: two-bone leg IK (hind legs with a raised hock), a ten-joint tail and a
// neck and head that look at things. Poses (stand, walk, trot, sneak, sit, loaf, sleep, leap, scratch,
// drink, sniff, watch, swipe, meow) blend smoothly into one another; the walk keeps its feet planted by
// matching stride to speed. Browser only (three.js); the game decides what the cat is doing.
import * as THREE from 'three';
import { coatOf, furHead, furRings } from './textures';
import { catBody } from './catbody';

export type CatBusy = 'scratch' | 'sofa' | 'drink' | 'eat' | 'sniff' | 'watch' | 'nap' | 'swipe' | 'meow' | null;
export interface CatDrive {
  /** Horizontal speed, m/s. */
  speed: number;
  sneak: boolean;
  ground: boolean;
  /** Leap progress 0…1 and whether it goes up. */
  leap: { k: number; up: boolean } | null;
  busy: CatBusy;
  busyK: number;
  /** Seconds without input. */
  idle: number;
  /** A point to look at, in the cat's own frame (x right, y up, z forward, from the paws). */
  look: [number, number, number] | null;
  /** Ground height under the front and back paws, relative to the paws (on ramps and edges). */
  frontDy: number;
  backDy: number;
  /** Seconds since the last meow. */
  meowAgo: number;
}

export interface CatModel {
  root: THREE.Group;
  update(dt: number, d: CatDrive): void;
  dispose(): void;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Piecewise-linear profile through [t, value] points. */
function profile(t: number, pts: [number, number][]) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1], [t1, v1] = pts[i];
      const k = (t - t0) / (t1 - t0);
      return v0 + (v1 - v0) * (k * k * (3 - 2 * k));
    }
  }
  return pts[pts.length - 1][1];
}

/** A smooth tapered tube swept through control points (Catmull-Rom), rebuilt every frame: legs and tail. */
class Tube {
  readonly mesh: THREE.Mesh;
  private pos: Float32Array; private nor: Float32Array;
  private readonly rings: number; private readonly radial: number;
  private readonly P = new THREE.Vector3(); private readonly T = new THREE.Vector3(); private readonly N = new THREE.Vector3(); private readonly B = new THREE.Vector3();
  private readonly q = new THREE.Vector3();
  constructor(rings: number, radial: number, material: THREE.Material, vRepeat: number) {
    this.rings = rings; this.radial = radial;
    const n = rings * (radial + 1);
    this.pos = new Float32Array(n * 3); this.nor = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const idx: number[] = [];
    for (let i = 0; i < rings; i++) for (let j = 0; j <= radial; j++) { const k = i * (radial + 1) + j; uv[k * 2] = j / radial; uv[k * 2 + 1] = (i / (rings - 1)) * vRepeat; }
    for (let i = 0; i < rings - 1; i++) for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
  }
  /** Points along the curve at u ∈ [0, 1] (uniform Catmull-Rom through `c`). */
  private at(c: THREE.Vector3[], u: number, out: THREE.Vector3) {
    const n = c.length - 1, x = Math.min(n - 1e-6, Math.max(0, u * n)), i = Math.floor(x), t = x - i;
    const p0 = c[Math.max(0, i - 1)], p1 = c[i], p2 = c[i + 1], p3 = c[Math.min(n, i + 2)];
    const t2 = t * t, t3 = t2 * t;
    for (const k of ['x', 'y', 'z'] as const) out[k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
    return out;
  }
  update(c: THREE.Vector3[], radius: (u: number) => number) {
    const { P, T, N, B, q } = this;
    for (let i = 0; i < this.rings; i++) {
      const u = i / (this.rings - 1);
      this.at(c, u, P);
      this.at(c, Math.min(1, u + 0.01), q); T.copy(q);
      this.at(c, Math.max(0, u - 0.01), q); T.sub(q).normalize();
      // Parallel transport of the ring's frame (starting from the x axis).
      if (i === 0) { N.set(1, 0, 0); if (Math.abs(N.dot(T)) > 0.9) N.set(0, 0, 1); }
      N.addScaledVector(T, -N.dot(T)).normalize();
      B.crossVectors(T, N);
      const r = radius(u);
      for (let j = 0; j <= this.radial; j++) {
        const a = (j / this.radial) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const nx = N.x * ca + B.x * sa, ny = N.y * ca + B.y * sa, nz = N.z * ca + B.z * sa;
        const k = (i * (this.radial + 1) + j) * 3;
        this.pos[k] = P.x + nx * r; this.pos[k + 1] = P.y + ny * r; this.pos[k + 2] = P.z + nz * r;
        this.nor[k] = nx; this.nor[k + 1] = ny; this.nor[k + 2] = nz;
      }
    }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.normal.needsUpdate = true;
  }
}

/** Two-bone IK in the leg's plane (y up, z forward). Returns the upper and lower joint angles (rotation.x). */
function ik2(ty: number, tz: number, a: number, b: number, kneeForward: boolean): [number, number] {
  const d = clamp(Math.hypot(ty, tz), 0.03, a + b - 1e-4);
  const tT = Math.atan2(-tz, -ty);
  const beta = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  const gamma = Math.acos(clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
  return kneeForward ? [tT - beta, Math.PI - gamma] : [tT + beta, -(Math.PI - gamma)];
}

// Proportions (metres). The body group sits at `bodyY` above the paws.
const SHOULDER: [number, number, number] = [0.038, -0.012, 0.122];
const HIP: [number, number, number] = [0.042, -0.002, -0.128];
const F1 = 0.085, F2 = 0.088; // upper arm, forearm
const H1 = 0.085, H2 = 0.078, H3 = 0.056; // thigh, shin, hock to paw
const TAIL_N = 10, TAIL_SEG = 0.031;

type Feet = [number, number][]; // [z, y] per leg: FL, FR, HL, HR (root space)
interface Params {
  bodyY: number; pitch: number; roll: number; spinePitch: number; spineYaw: number; neck: number; headPitch: number; headYaw: number; headRoll: number;
  tailBase: number; tailSide: number; tailBend: number; tailTip: number; tailCurl: number; tailSway: number;
  ears: number; eyes: number; jaw: number; gait: number; stretch: number;
  /** Hock-to-paw angle in root space: slightly forward standing, near flat (-π/2) when sitting or lying. */
  hock: number;
  feet: Feet;
}
const REST: Feet = [[0.118, 0], [0.118, 0], [-0.118, 0], [-0.118, 0]];
const params = (o: Partial<Params>): Params => ({
  bodyY: 0.19, pitch: 0, roll: 0, spinePitch: 0, spineYaw: 0, neck: 0, headPitch: 0, headYaw: 0, headRoll: 0,
  tailBase: -0.75, tailSide: 0, tailBend: 0.05, tailTip: 0.25, tailCurl: 0, tailSway: 0.12,
  ears: 0, eyes: 1, jaw: 0, gait: 0, stretch: 1, hock: -0.28, feet: REST.map((f) => [...f] as [number, number]), ...o
});

export function makeCatModel(coat: string): CatModel {
  const k = coatOf(coat);
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(x: T) => (owned.push(x), x);
  const headFur = own(new THREE.MeshStandardMaterial({ map: furHead(coat), roughness: 0.82 }));
  const tailFur = own(new THREE.MeshStandardMaterial({ map: furRings(coat, 1), roughness: 0.85 }));
  const pink = own(new THREE.MeshStandardMaterial({ color: k.nose, roughness: 0.6 }));
  const innerEar = own(new THREE.MeshStandardMaterial({ color: new THREE.Color('#d99f98').lerp(new THREE.Color(k.light), 0.25), roughness: 0.95, side: THREE.DoubleSide }));
  const rim = own(new THREE.MeshStandardMaterial({ color: '#2a201b', roughness: 0.6 }));
  const iris = own(new THREE.MeshStandardMaterial({ color: k.eye, roughness: 0.08, emissive: new THREE.Color(k.eye).multiplyScalar(0.15) }));
  const pupil = own(new THREE.MeshStandardMaterial({ color: '#0b0b0c', roughness: 0.05 }));
  const mouth = own(new THREE.MeshStandardMaterial({ color: '#5a2a2e', roughness: 0.7 }));

  const root = new THREE.Group();
  // Joints are bones: the body mesh (catbody.ts) is skinned to them; eyes, ears, nose and whiskers ride on the head.
  const body = new THREE.Bone();
  body.position.y = 0.19;
  root.add(body);
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, shadow = true) => { own(g); const x = new THREE.Mesh(g, m); x.castShadow = shadow; return x; };

  // The spine bends in the middle: the chest (front legs, neck and head) turns and tilts on the hips.
  const chest = new THREE.Bone();
  body.add(chest);

  // Neck and head.
  const neck = new THREE.Bone();
  neck.position.set(0, 0.03, 0.155);
  chest.add(neck);
  const head = new THREE.Bone();
  head.position.set(0, 0.05, 0.072);
  neck.add(head);
  // Nose leather: small, wider at the top, sitting on the end of the muzzle.
  const noseGeo = new THREE.SphereGeometry(0.0046, 12, 8);
  noseGeo.scale(1.45, 0.78, 0.8);
  { const q = noseGeo.attributes.position; for (let i = 0; i < q.count; i++) if (q.getY(i) < 0) q.setX(i, q.getX(i) * (1 + q.getY(i) / 0.0045 * 0.45)); }
  const nose = mesh(noseGeo, pink, false);
  nose.position.set(0, -0.0065, 0.0515);
  head.add(nose);
  const jaw = new THREE.Bone();
  jaw.position.set(0, -0.029, 0.018);
  head.add(jaw);
  const inside = mesh(new THREE.SphereGeometry(0.011, 10, 8), mouth, false);
  inside.scale.set(1.1, 0.4, 1.1);
  inside.position.set(0, 0.004, 0.014);
  jaw.add(inside);
  const eyes: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Group();
    e.position.set(s * 0.0205, 0.005, 0.0312);
    e.rotation.set(0, s * 0.45, -s * 0.14); // almond eyes, tilted up at the outer corner
    // A dark rim (cats' "eyeliner"), the iris set into it, and the pupil flush with the iris.
    const lid = mesh(new THREE.SphereGeometry(0.0146, 16, 12), rim, false);
    lid.scale.set(1.1, 0.88, 0.36);
    lid.position.z = -0.0008;
    const ball = mesh(new THREE.SphereGeometry(0.0136, 18, 14), iris, false);
    ball.scale.set(1.04, 0.82, 0.42);
    const pu = mesh(new THREE.SphereGeometry(0.0136, 14, 12), pupil, false);
    pu.scale.set(0.36, 0.78, 0.43);
    pu.position.z = 0.0002;
    e.add(lid, ball, pu);
    head.add(e);
    eyes.push(e);
  }
  const ears: THREE.Group[] = [];
  const earGeo = new THREE.ConeGeometry(0.024, 0.04, 16, 1);
  earGeo.scale(1, 1, 0.42);
  earGeo.translate(0, 0.02, 0);
  const innerGeo = new THREE.ConeGeometry(0.0165, 0.029, 14, 1);
  innerGeo.scale(1, 1, 0.22);
  innerGeo.translate(0, 0.0165, 0.0068);
  for (const s of [-1, 1]) {
    const e = new THREE.Group();
    e.position.set(s * 0.026, 0.03, -0.008);
    e.rotation.set(-0.12, s * 0.28, -s * 0.3);
    e.add(mesh(earGeo, headFur), mesh(innerGeo, innerEar, false));
    head.add(e);
    ears.push(e);
  }
  // Whiskers.
  const wpts: number[] = [];
  for (const s of [-1, 1]) for (const [dy, dz] of [[0.008, 0.006], [0, 0], [-0.008, -0.004]]) wpts.push(s * 0.018, -0.018, 0.047, s * 0.08, -0.016 + dy * 2.2, 0.055 + dz * 2);
  const wg = own(new THREE.BufferGeometry());
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wpts, 3));
  const whiskers = new THREE.LineSegments(wg, own(new THREE.LineBasicMaterial({ color: '#f4f1ea', transparent: true, opacity: 0.75 })));
  head.add(whiskers);
  owned.push(earGeo, innerGeo);

  // Legs: joints are bones; segments hang down (-y) from their joint.
  interface Leg { hip: THREE.Bone; j: THREE.Bone[]; paw: THREE.Bone; front: boolean; x: number; side: number }
  const legs: Leg[] = [];
  for (const [front, s] of [[true, -1], [true, 1], [false, -1], [false, 1]] as const) {
    const at = front ? SHOULDER : HIP;
    const hip = new THREE.Bone();
    hip.position.set(s * at[0], at[1], at[2]);
    (front ? chest : body).add(hip);
    const lens = front ? [F1, F2] : [H1, H2, H3];
    const j: THREE.Bone[] = [];
    let parent: THREE.Object3D = hip;
    lens.forEach((_, i) => {
      const g = new THREE.Bone();
      if (i > 0) g.position.y = -lens[i - 1];
      parent.add(g);
      j.push(g);
      parent = g;
    });
    const paw = new THREE.Bone();
    paw.position.y = -lens[lens.length - 1];
    parent.add(paw);
    legs.push({ hip, j, paw, front, x: s * at[0], side: s });
  }

  // Tail: a chain of joints from the rump; each segment points up (+y) from its joint.
  const tail: THREE.Group[] = [];
  const tailRoot = new THREE.Group();
  tailRoot.position.set(0, 0.03, -0.198);
  body.add(tailRoot);
  let tp: THREE.Object3D = tailRoot;
  for (let i = 0; i < TAIL_N; i++) {
    const g = new THREE.Group();
    if (i > 0) g.position.y = TAIL_SEG;
    tp.add(g);
    tail.push(g);
    tp = g;
  }
  const tailTip = new THREE.Object3D();
  tailTip.position.y = TAIL_SEG;
  tp.add(tailTip);
  const tailTube = new Tube(34, 10, tailFur, TAIL_N);
  owned.push(tailTube.mesh.geometry);
  body.add(tailTube.mesh);

  // The body, skinned to the joints at rest.
  root.updateMatrixWorld(true);
  const bones: THREE.Bone[] = [body, chest, neck, head, jaw, ...legs.flatMap((L) => [L.hip, ...L.j, L.paw])];
  const skin = catBody({ body, chest, neck, head, jaw, legs: legs.map((L) => ({ hip: L.hip, j: L.j, paw: L.paw, front: L.front, side: L.side })) }, bones, coat);
  owned.push(skin.geometry, skin.material as THREE.Material, skin.skeleton);
  root.add(skin);

  // ---------- animation ----------
  const cur = params({});
  let phase = 0, t = 0;
  let blinkAt = 2, blinkT = -1;
  let earTwitchAt = 3, earT = -1, earSide = 0;
  let idleLookAt = 0, idleYaw = 0, idlePitch = 0;
  let prevGround = true, land = 0;

  function goalFor(d: CatDrive): { p: Params; rate: number } {
    const look = (p: Params, maxYaw = 1.0) => {
      if (!d.look) return;
      const [lx, ly, lz] = d.look;
      const hy = 0.27;
      p.headYaw = clamp(Math.atan2(lx, Math.max(0.05, lz)), -maxYaw, maxYaw);
      // From the head (about 0.22 m ahead of the paws' centre), not from the centre: a ledge right in
      // front is looked at with a lift of the chin, not by throwing the head back.
      p.headPitch = clamp(-Math.atan2(ly - hy, Math.max(0.25, Math.hypot(lx, lz - 0.22))), -0.5, 0.7) - p.neck * 0.3;
    };
    if (d.leap) {
      const kk = d.leap.k;
      if (kk < 0.14) return { p: params({ bodyY: 0.135, pitch: d.leap.up ? -0.25 : 0.1, neck: -0.15, tailBase: -1.25, tailTip: 0.1, tailSway: 0, ears: 0.15, feet: [[0.13, 0], [0.13, 0], [-0.1, 0], [-0.1, 0]] }), rate: 30 };
      if (kk < 0.78) return { p: params({ bodyY: 0.19, pitch: d.leap.up ? -0.42 : 0.22, stretch: 1.06, neck: d.leap.up ? -0.1 : 0.15, headPitch: d.leap.up ? 0.25 : 0.1, tailBase: -1.45, tailBend: -0.02, tailTip: 0, tailSway: 0, ears: 0.35, feet: [[0.28, 0.07], [0.3, 0.09], [-0.31, 0.07], [-0.3, 0.05]] }), rate: 16 };
      return { p: params({ bodyY: 0.2, pitch: 0.18, neck: 0.1, tailBase: -1.25, tailTip: 0.1, tailSway: 0, ears: 0.15, feet: [[0.2, -0.03], [0.22, -0.03], [-0.2, 0.06], [-0.18, 0.07]] }), rate: 18 };
    }
    if (!d.ground) return { p: params({ bodyY: 0.2, pitch: 0.1, tailBase: -0.6, tailSway: 0, ears: 0.3, feet: [[0.16, -0.04], [0.16, -0.04], [-0.15, -0.03], [-0.15, -0.03]] }), rate: 14 };
    const sitting: Partial<Params> = { bodyY: 0.12, pitch: -0.7, spinePitch: 0.2, neck: 0.62, headPitch: 0.5, tailBase: -1.57, tailBend: 0, tailTip: 0, tailCurl: 0.3, tailSway: 0.05, hock: -1.45, feet: [[0.1, 0], [0.1, 0], [0.0, 0], [0.0, 0]] };
    // Lying down: belly on the floor, forearms folded under the chest, hind legs tucked with the hocks flat.
    const lying: Partial<Params> = { bodyY: 0.064, pitch: -0.06, hock: -1.5, tailBase: -1.6, tailBend: 0, tailTip: 0, tailCurl: 0.36, tailSway: 0.03, feet: [[0.15, 0.004], [0.15, 0.004], [-0.035, 0.004], [-0.035, 0.004]] };
    switch (d.busy) {
      case 'scratch': case 'sofa': {
        const s = Math.sin(t * 11) * 0.05;
        return { p: params({ bodyY: 0.2, pitch: -1.0, neck: -0.25, headPitch: 0.5, tailBase: -1.45, tailTip: 0.15, tailSway: 0.2, ears: 0.1, feet: [[0.25, 0.26 + s], [0.25, 0.26 - s], [-0.02, 0], [-0.02, 0]] }), rate: 10 };
      }
      case 'drink': case 'eat': {
        const lap = Math.sin(t * 9) * 0.06;
        return { p: params({ bodyY: 0.135, pitch: 0.28, neck: 0.75, headPitch: 0.55 + lap, jaw: Math.max(0, lap) * 2, tailBase: -1.5, tailCurl: 0.2, tailSway: 0.04, feet: [[0.12, 0], [0.12, 0], [-0.07, 0], [-0.07, 0]] }), rate: 8 };
      }
      case 'sniff': {
        const sn = Math.sin(t * 14) * 0.03;
        return { p: params({ bodyY: 0.17, pitch: 0.18, neck: 0.62, headPitch: 0.3 + sn, tailBase: -0.5, tailTip: 0.3, ears: -0.1, feet: [[0.13, 0], [0.13, 0], [-0.12, 0], [-0.12, 0]] }), rate: 8 };
      }
      case 'watch': {
        const p = params({ ...sitting, ears: -0.2, tailSway: 0.35 });
        look(p, 1.1);
        p.jaw = Math.max(0, Math.sin(t * 22)) * 0.25 * (Math.sin(t * 1.3) > 0.3 ? 1 : 0); // chattering
        return { p, rate: 6 };
      }
      case 'nap': {
        const br = Math.sin(t * 1.6) * 0.004;
        return { p: params({ ...lying, bodyY: 0.06 + br, roll: 0.22, spineYaw: 1.0, neck: 1.0, headPitch: 1.05, headYaw: 0.9, headRoll: 0.5, eyes: 0, tailBase: -1.62, tailSide: -0.9, tailCurl: -0.45, tailSway: 0.02, ears: 0.15 }), rate: 3 };
      }
      case 'swipe': {
        const kk = d.busyK;
        const lift = Math.sin(Math.min(1, kk * 1.2) * Math.PI);
        return { p: params({ bodyY: 0.17, pitch: -0.12, neck: 0.1, headPitch: 0.3, ears: 0.25, tailBase: -0.9, tailSway: 0.3, feet: [[0.12, 0], [0.14 + lift * 0.16, lift * 0.14], [-0.11, 0], [-0.11, 0]] }), rate: 22 };
      }
    }
    if (d.speed > 0.06) {
      const sneak = d.sneak;
      const p = params(sneak
        ? { bodyY: 0.145, pitch: 0.05, neck: 0.2, headPitch: -0.15, tailBase: -1.45, tailBend: 0.02, tailTip: 0.12, tailSway: 0.08, ears: 0.25, gait: 1 }
        : { bodyY: 0.188, pitch: 0, neck: -0.05, headPitch: 0.05, tailBase: -0.32, tailBend: 0.03, tailTip: 0.42, tailSway: 0.07, gait: 1 });
      look(p, 0.6);
      return { p, rate: 10 };
    }
    if (d.idle > 9) return { p: params({ ...lying, neck: 0.12, headPitch: 0.15, eyes: 0.55 }), rate: 3 };
    if (d.idle > 1.2) {
      const p = params(sitting);
      p.headYaw = idleYaw; p.headPitch += idlePitch;
      look(p, 1.1);
      return { p, rate: 4 };
    }
    const p = params({ headYaw: idleYaw * 0.6, headPitch: idlePitch });
    look(p, 0.9);
    return { p, rate: 7 };
  }

  const tgt = new THREE.Vector3(), toParent = new THREE.Matrix4();
  function apply(p: Params, d: CatDrive) {
    // Gait: lateral-sequence walk blending into a trot; stride matches speed so paws stay planted.
    const sp = Math.max(0.0, d.speed);
    const sf = clamp(sp / 1.7, 0, 1);
    const half = (d.sneak ? 0.045 : 0.05) + 0.065 * sf;
    const freq = sp > 0.02 ? (sp * 0.6) / (2 * half) : 0;
    const trot = smooth(0.9, 1.4, sp);
    const offs = [0.25 + 0.25 * trot, 0.75 + 0.25 * trot, 0, 0.5]; // FL, FR, HL, HR
    const feet: Feet = p.feet.map((f, i) => {
      if (p.gait < 0.01) return f;
      const psi = (((phase + offs[i]) % 1) + 1) % 1;
      let z: number, y: number;
      if (psi < 0.6) { z = half - (psi / 0.6) * 2 * half; y = 0; }
      else { const q = (psi - 0.6) / 0.4; z = -half + smooth(0, 1, q) * 2 * half; y = Math.sin(Math.PI * q) * (0.03 + 0.025 * sf + (i < 2 ? 0.008 : 0)); }
      const rest = REST[i];
      return [f[0] + (rest[0] + z - f[0]) * p.gait, f[1] + (y - f[1]) * p.gait];
    });
    const bob = p.gait * (-0.007 * Math.cos(phase * Math.PI * 4) * (0.5 + sf));
    // Slopes and ledges: pitch with the ground under front and back paws.
    const slope = Math.atan2(d.frontDy - d.backDy, 0.24);
    const pitch = p.pitch - slope * (d.ground && !d.leap ? 1 : 0);
    const by = p.bodyY + bob + (d.ground ? (d.frontDy + d.backDy) / 2 : 0);
    // Landing squash.
    const squash = land > 0 ? Math.sin((1 - land) * Math.PI) * 0.035 : 0;
    body.position.set(0, by - squash, 0);
    body.rotation.set(pitch, 0, p.roll + p.gait * 0.035 * Math.sin(phase * Math.PI * 2));
    body.scale.set(1, 1, p.stretch);
    // The chest sways a little from side to side as the cat walks.
    chest.rotation.set(p.spinePitch, p.spineYaw + p.gait * 0.06 * Math.sin(phase * Math.PI * 2 + 0.6), 0, 'YXZ');
    neck.rotation.x = p.neck;
    head.rotation.set(p.headPitch - p.neck * 0.6 + p.gait * 0.03 * Math.cos(phase * Math.PI * 4), p.headYaw, p.headRoll, 'YXZ');
    jaw.rotation.x = p.jaw * 0.6;
    const blink = blinkT >= 0 ? 1 - Math.sin((blinkT / 0.14) * Math.PI) : 1;
    for (const e of eyes) e.scale.y = Math.max(0.06, p.eyes * blink);
    ears.forEach((e, i) => {
      const s = i ? 1 : -1;
      const tw = earT >= 0 && earSide === i ? Math.sin((earT / 0.25) * Math.PI) * 0.5 : 0;
      e.rotation.set(-0.12 - p.ears * 0.9 - tw * 0.4, s * (0.28 + p.ears * 0.5), -s * (0.3 + p.ears * 0.5));
    });

    // Legs: each foot target goes from root space into the frame its leg hangs from (the hips or the chest).
    root.updateMatrixWorld(true);
    const ground = (i: number) => (i < 2 ? d.frontDy : d.backDy);
    legs.forEach((L, i) => {
      const fz = feet[i][0], fy = feet[i][1] + (d.ground ? ground(i) : 0) + squash * 0.2;
      toParent.copy(L.hip.parent!.matrixWorld).invert().multiply(root.matrixWorld);
      const local = (y: number, z: number) => tgt.set(L.x, y, z).applyMatrix4(toParent);
      const pt = pitch + (L.front ? p.spinePitch : 0); // how far the leg's frame is tipped
      if (L.front) {
        local(fy, fz);
        const [a, b] = ik2(tgt.y - L.hip.position.y, tgt.z - L.hip.position.z, F1, F2, false);
        L.j[0].rotation.x = a; L.j[1].rotation.x = b;
        L.paw.rotation.x = -(pt + a + b);
      } else {
        // Aim the knee at the hock, which sits behind and above the paw; the last bone runs down to the paw.
        const ha = p.hock;
        local(fy + H3 * Math.cos(ha), fz + H3 * Math.sin(ha));
        const [a, b] = ik2(tgt.y - L.hip.position.y, tgt.z - L.hip.position.z, H1, H2, true);
        L.j[0].rotation.x = a; L.j[1].rotation.x = b;
        const c = ha - pt - a - b;
        L.j[2].rotation.x = c;
        L.paw.rotation.x = -(pt + a + b + c);
      }
    });

    // Tail: base angle in root space, bending along the chain, a travelling sway, a curl around the body.
    tailRoot.rotation.set(p.tailBase - pitch, p.tailSide, 0, 'YXZ');
    tail.forEach((g, i) => {
      const f = i / (TAIL_N - 1);
      const sway = Math.sin(t * (1.6 + p.tailSway * 4) - i * 0.55) * p.tailSway * (0.3 + f);
      g.rotation.set(i === 0 ? 0 : p.tailBend + (f > 0.62 ? p.tailTip * (f - 0.55) * 2.4 : 0), 0, (i === 0 ? 0 : p.tailCurl) + sway * 0.5);
    });
    sweep();
  }

  // Sweep the tail tube through its joints (in the body's frame).
  const inv = new THREE.Matrix4();
  const jp = (o: THREE.Object3D, out: THREE.Vector3) => out.setFromMatrixPosition(o.matrixWorld).applyMatrix4(inv);
  const BACK = new THREE.Vector3(0, 0, 0.03);
  const tailPts = Array.from({ length: TAIL_N + 2 }, () => new THREE.Vector3());
  function sweep() {
    root.updateMatrixWorld(true);
    inv.copy(body.matrixWorld).invert();
    jp(tailRoot, tailPts[0]);
    tailPts[0].add(BACK);
    for (let i = 0; i < TAIL_N; i++) jp(tail[i], tailPts[i + 1]);
    jp(tailTip, tailPts[TAIL_N + 1]);
    tailTube.update(tailPts, (u) => {
      const base = 0.0165 - u * 0.0085;
      return u > 0.965 ? base * Math.sqrt(Math.max(0, (1 - u) / 0.035)) : base;
    });
  }

  function lerpParams(to: Params, a: number) {
    for (const key of Object.keys(to) as (keyof Params)[]) {
      if (key === 'feet') continue;
      (cur[key] as number) += ((to[key] as number) - (cur[key] as number)) * a;
    }
    cur.feet.forEach((f, i) => { f[0] += (to.feet[i][0] - f[0]) * a; f[1] += (to.feet[i][1] - f[1]) * a; });
  }

  return {
    root,
    update(dt, d) {
      t += dt;
      // Phase advances with distance walked.
      const sp = d.speed, sf = clamp(sp / 1.7, 0, 1);
      const half = (d.sneak ? 0.045 : 0.05) + 0.065 * sf;
      if (sp > 0.02) phase = (phase + (dt * sp * 0.6) / (2 * half)) % 1;
      // Blinks, ear twitches and idle glances.
      blinkAt -= dt; if (blinkAt <= 0) { blinkT = 0; blinkAt = 2.5 + Math.random() * 4; }
      if (blinkT >= 0) { blinkT += dt; if (blinkT > 0.14) blinkT = -1; }
      earTwitchAt -= dt; if (earTwitchAt <= 0) { earT = 0; earSide = Math.random() < 0.5 ? 0 : 1; earTwitchAt = 2 + Math.random() * 5; }
      if (earT >= 0) { earT += dt; if (earT > 0.25) earT = -1; }
      idleLookAt -= dt; if (idleLookAt <= 0) { idleYaw = (Math.random() - 0.5) * 1.4; idlePitch = (Math.random() - 0.5) * 0.4; idleLookAt = 1.8 + Math.random() * 3; }
      if (d.ground && !prevGround) land = 1;
      prevGround = d.ground && !d.leap;
      if (d.leap && d.leap.k > 0.97) land = 1;
      land = Math.max(0, land - dt * 5);

      const { p, rate } = goalFor(d);
      if (d.meowAgo < 0.6) { p.jaw = Math.max(p.jaw, Math.sin((d.meowAgo / 0.6) * Math.PI)); p.headPitch -= 0.25 * Math.sin((d.meowAgo / 0.6) * Math.PI); p.ears -= 0.1; }
      lerpParams(p, 1 - Math.exp(-dt * rate));
      cur.jaw = p.jaw; // the jaw follows at once
      apply(cur, d);
    },
    dispose() { for (const o of owned) o.dispose(); }
  };
}
