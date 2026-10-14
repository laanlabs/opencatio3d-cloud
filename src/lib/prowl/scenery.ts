// Catio Prowl's surroundings, drawn for the game only (the catio itself comes from the generator):
// a sky with clouds and far hills, a fenced lawn with trees, shrubs, flowers and the neighbours'
// houses, the outside of the house (siding, a shingled roof), and inside a lived-in room — floorboards,
// wallpaper, skirting, a rug, textured furniture, curtains, pictures, lamps — with light falling through
// the open window. Nothing here changes where the cat can go, except the lamp and plant (solid in the
// world). Browser only.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { Project, Vec2, Vec3 } from '../model/types';
import { toPlan, wallDir, wallNormal } from '../model/geometry';
import { GROUND_COLOR, buildObstacle } from '../scene/build';
import type { Rect, Surface, WallSpec, World } from './world';
import { corners } from './world';
import * as tex from './textures';

/** Layer for the room's ceiling and the roof over it: hidden from the camera when it rises above them, still casting shadows. */
export const ROOF_LAYER = 2;

const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });

/** Scale a geometry's UVs (so a texture repeats per metre rather than per face). */
function scaleUV(g: THREE.BufferGeometry, su: number, sv: number) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return g;
}

/** Box UVs in metres / `unit` on every face (faces: +x, −x, +y, −y, +z, −z; four vertices each). */
function boxUV(g: THREE.BoxGeometry, sx: number, sy: number, sz: number, unit = 1) {
  const uv = g.attributes.uv;
  const dims: [number, number][] = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, (uv.getX(i) * dims[f][0]) / unit, (uv.getY(i) * dims[f][1]) / unit); }
  return g;
}

const P3 = (q: Vec2, y = 0) => new THREE.Vector3(q[0], y, q[1]);

// ---------- sky ----------

export function buildSky(sunDir: THREE.Vector3) {
  const g = new THREE.Group();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: new THREE.Color('#4f86c2') },
      horizon: { value: new THREE.Color('#dce9f0') },
      below: { value: new THREE.Color('#c3d0bf') },
      sun: { value: sunDir.clone().normalize() }
    },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: `uniform vec3 zenith; uniform vec3 horizon; uniform vec3 below; uniform vec3 sun; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = d.y > 0.0 ? mix(horizon, zenith, pow(clamp(d.y, 0.0, 1.0), 0.5)) : mix(horizon, below, clamp(-d.y * 5.0, 0.0, 1.0));
        float s = max(dot(d, normalize(sun)), 0.0);
        c += vec3(1.0, 0.92, 0.78) * (pow(s, 900.0) * 8.0 + pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.08);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), material);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  g.add(dome);
  // Clouds: soft sprites around the horizon.
  const r = tex.rng(77);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + r() * 0.4, d = 95 + r() * 30;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.cloud(1 + (i % 4)), transparent: true, depthWrite: false, fog: false, opacity: 0.85 }));
    s.position.set(Math.cos(a) * d, 22 + r() * 26, Math.sin(a) * d);
    const w = 34 + r() * 30;
    s.scale.set(w, w * 0.45, 1);
    s.renderOrder = -9;
    g.add(s);
  }
  return { group: g, dome, horizon: material.uniforms.horizon.value as THREE.Color };
}

// ---------- the yard ----------

interface Frame { o: Vec2; d: Vec2; n: Vec2; s0: number; s1: number; T: number; L: number; ps0: number; ps1: number; pT: number }

/** The yard's frame: along the host (or first) house wall, outward from it, sized to hold every structure. */
function yardFrame(p: Project, w: World): Frame {
  const wall = p.site.walls.find((x) => x.id === w.hostWallId) ?? p.site.walls.find((x) => Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]) > 0.5);
  const o: Vec2 = wall ? wall.a : [w.catio.centre[0] - 4, w.catio.centre[2] - 3];
  const d: Vec2 = wall ? wallDir(wall) : [1, 0];
  const n: Vec2 = wall ? wallNormal(wall) : [0, 1];
  const L = wall ? Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) : 8;
  let sMin = 0, sMax = L, tMax = 0;
  let psMin = Infinity, psMax = -Infinity, ptMax = 0;
  const seeS = (q: Vec2) => { const s = (q[0] - o[0]) * d[0] + (q[1] - o[1]) * d[1], t = (q[0] - o[0]) * n[0] + (q[1] - o[1]) * n[1]; psMin = Math.min(psMin, s); psMax = Math.max(psMax, s); ptMax = Math.max(ptMax, t); };
  const see = (q: Vec2) => { const s = (q[0] - o[0]) * d[0] + (q[1] - o[1]) * d[1], t = (q[0] - o[0]) * n[0] + (q[1] - o[1]) * n[1]; sMin = Math.min(sMin, s); sMax = Math.max(sMax, s); tMax = Math.max(tMax, t); };
  for (const s of p.structures) {
    if (s.template === 'tunnel') for (const q of s.path ?? []) see(toPlan(s, q[0], q[1]));
    else for (const [u, v] of [[0, 0], [s.width, 0], [s.width, s.depth], [0, s.depth]]) { see(toPlan(s, u, v)); seeS(toPlan(s, u, v)); }
  }
  for (const ob of p.site.obstacles ?? []) see([ob.x, ob.y]);
  see([w.catio.birdPerch[0], w.catio.birdPerch[2]]);
  if (!Number.isFinite(psMin)) { psMin = 0; psMax = 2; }
  return { o, d, n, L, s0: sMin - 2.6, s1: sMax + 2.6, T: Math.max(tMax + 3.2, 8.5), ps0: psMin - 1.2, ps1: psMax + 1.2, pT: ptMax + 1.4 };
}

/** Keep-out circles: structures, tunnels, obstacles, the bird post. */
function keepOut(p: Project, w: World): [Vec2, number][] {
  const out: [Vec2, number][] = [];
  for (const s of p.structures) {
    if (s.template === 'tunnel') {
      // Along every segment, not just at the bends.
      const path = s.path ?? [];
      for (let i = 0; i < path.length; i++) {
        const a = path[i], b = path[Math.min(i + 1, path.length - 1)];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.5));
        for (let k = 0; k < (i < path.length - 1 ? n : 1); k++) out.push([toPlan(s, a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n), s.width / 2 + 0.3]);
      }
    }
    else out.push([toPlan(s, s.width / 2, s.depth / 2), Math.hypot(s.width, s.depth) / 2 + 0.3]);
  }
  for (const ob of p.site.obstacles ?? []) out.push([[ob.x, ob.y], Math.max(ob.width, ob.depth) / 2 + 0.5]);
  out.push([[w.catio.birdPerch[0], w.catio.birdPerch[2]], 0.5]);
  return out;
}

function blobGeometry(blobs: [number, number, number, number][], detail = 2) {
  const parts = blobs.map(([x, y, z, r]) => { const g = new THREE.IcosahedronGeometry(r, detail); g.translate(x, y, z); return g; });
  const m = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return m;
}

export function buildYard(p: Project, w: World): THREE.Group {
  const g = new THREE.Group();
  const f = yardFrame(p, w);
  const at = (s: number, t: number): Vec2 => [f.o[0] + f.d[0] * s + f.n[0] * t, f.o[1] + f.d[1] * s + f.n[1] * t];
  const yawAlong = Math.atan2(f.d[1], f.d[0]);
  const rnd = tex.rng(1234);
  const avoid = keepOut(p, w);
  const clear = (q: Vec2, r: number) => avoid.every(([c, rr]) => Math.hypot(q[0] - c[0], q[1] - c[1]) > rr + r);

  // Ground: lawn out to the hills; a patio of the site's own surface (concrete, pavers, deck…) round the structures.
  const kind = p.site.ground ?? 'grass';
  // Pushed back in depth (and a little down) so floors and patios laid on it never flicker on low-precision depth buffers.
  const lawnMesh = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(400, 400), 250, 250), std({ map: tex.lawn(), roughness: 1, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 4 }));
  lawnMesh.rotation.x = -Math.PI / 2;
  lawnMesh.position.y = -0.01;
  lawnMesh.receiveShadow = true;
  g.add(lawnMesh);
  if (kind !== 'grass') {
    const pw = f.ps1 - f.ps0, pd = f.pT;
    const m = kind === 'concrete' ? std({ map: tex.concrete(), roughness: 0.95 }) : kind === 'pavers' ? std({ map: tex.pavers(), roughness: 0.95 }) : std({ color: GROUND_COLOR[kind] ?? GROUND_COLOR.grass, roughness: 1 });
    const patio = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(pw, pd), pw / 1.2, pd / 1.2), m);
    const c = at((f.ps0 + f.ps1) / 2, pd / 2);
    patio.rotation.order = 'YXZ';
    patio.rotation.set(-Math.PI / 2, -yawAlong, 0);
    patio.position.set(c[0], 0.003, c[1]);
    patio.receiveShadow = true;
    g.add(patio);
  }

  // Fence: three sides of the yard plus the stubs back to the house.
  const FH = 1.8;
  const fenceMat = std({ map: tex.fenceBoards(), roughness: 0.95 });
  const postMat = std({ color: '#7d5a3c', roughness: 0.9 });
  const runs: [Vec2, Vec2][] = [[at(f.s0, 0), at(f.s0, f.T)], [at(f.s0, f.T), at(f.s1, f.T)], [at(f.s1, f.T), at(f.s1, 0)]];
  if (f.s0 < -0.1) runs.push([at(f.s0, 0), at(0, 0)]);
  if (f.s1 > f.L + 0.1) runs.push([at(f.L, 0), at(f.s1, 0)]);
  const posts: THREE.Matrix4[] = [];
  for (const [a, b] of runs) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.1) continue;
    const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(len, FH, 0.03), len, FH, 0.03, 1.1), fenceMat);
    m.position.set((a[0] + b[0]) / 2, FH / 2, (a[1] + b[1]) / 2);
    m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    const nPosts = Math.max(1, Math.round(len / 2.4));
    for (let i = 0; i <= nPosts; i++) {
      const q: Vec2 = [a[0] + ((b[0] - a[0]) * i) / nPosts, a[1] + ((b[1] - a[1]) * i) / nPosts];
      posts.push(new THREE.Matrix4().compose(P3(q, (FH + 0.12) / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, m.rotation.y, 0)), new THREE.Vector3(1, 1, 1)));
    }
  }
  const postMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, FH + 0.12, 0.09), postMat, posts.length);
  posts.forEach((m, i) => postMesh.setMatrixAt(i, m));
  postMesh.castShadow = true;
  g.add(postMesh);

  // Trees: beyond the fence all round, and one or two in the yard's far corners if there is room.
  const trees: { q: Vec2; s: number }[] = [];
  for (let i = 0; i < 22; i++) {
    const side = rnd();
    let q: Vec2;
    if (side < 0.5) q = at(f.s0 - 3 + rnd() * (f.s1 - f.s0 + 6), f.T + 1.8 + rnd() * 9);
    else if (side < 0.75) q = at(f.s0 - 1.8 - rnd() * 8, rnd() * (f.T + 4));
    else q = at(f.s1 + 1.8 + rnd() * 8, rnd() * (f.T + 4));
    if (trees.every((t) => Math.hypot(t.q[0] - q[0], t.q[1] - q[1]) > 2.6)) trees.push({ q, s: 0.8 + rnd() * 0.7 });
  }
  for (const [s, t] of [[f.s0 + 1.7, f.T - 1.7], [f.s1 - 1.7, f.T - 1.7]]) { const q = at(s, t); if (clear(q, 2.2)) trees.push({ q, s: 0.75 }); }
  for (const ob of p.site.obstacles ?? []) if (ob.kind === 'tree') trees.push({ q: [ob.x, ob.y], s: Math.max(0.6, ob.height / 4.6) });
  const trunkGeo = new THREE.CylinderGeometry(0.11, 0.19, 2.6, 9);
  trunkGeo.translate(0, 1.3, 0);
  const crownGeo = blobGeometry([[0, 3.3, 0, 1.35], [0.85, 2.85, 0.3, 0.95], [-0.8, 2.95, -0.25, 1.0], [0.2, 2.8, -0.85, 0.9], [-0.25, 2.75, 0.85, 0.9], [0.1, 4.05, 0.1, 0.9]]);
  const trunks = new THREE.InstancedMesh(trunkGeo, std({ color: '#6b4f3a', roughness: 0.95 }), trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, std({ map: tex.foliage(), roughness: 0.9 }), trees.length);
  const greens = ['#5d8a45', '#4f7a3c', '#6e9a4f', '#577f3f', '#7a9e4a'];
  trees.forEach((t, i) => {
    const m = new THREE.Matrix4().compose(P3(t.q), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6.28, 0)), new THREE.Vector3(t.s, t.s * (0.9 + rnd() * 0.25), t.s));
    trunks.setMatrixAt(i, m); crowns.setMatrixAt(i, m);
    crowns.setColorAt(i, new THREE.Color(greens[i % greens.length]));
  });
  trunks.castShadow = crowns.castShadow = true;
  crowns.receiveShadow = true;
  g.add(trunks, crowns);

  // Shrubs along the fence and the house, with flowers in front.
  const shrubs: { q: Vec2; s: number }[] = [];
  const along = (a: Vec2, b: Vec2, inward: Vec2) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let x = 0.8; x < len - 0.6; x += 1.15 + rnd() * 0.6) {
      if (rnd() < 0.25) continue;
      const k = x / len;
      const q: Vec2 = [a[0] + (b[0] - a[0]) * k + inward[0] * 0.55, a[1] + (b[1] - a[1]) * k + inward[1] * 0.55];
      if (clear(q, 0.7)) shrubs.push({ q, s: 0.75 + rnd() * 0.5 });
    }
  };
  const inD: Vec2 = f.d, outD: Vec2 = [-f.d[0], -f.d[1]], inN: Vec2 = [-f.n[0], -f.n[1]];
  along(at(f.s0, 0.4), at(f.s0, f.T), inD);
  along(at(f.s0, f.T), at(f.s1, f.T), inN);
  along(at(f.s1, f.T), at(f.s1, 0.4), outD);
  if (!w.home) along(at(0, 0), at(f.L, 0), f.n);
  const shrubGeo = blobGeometry([[0, 0.3, 0, 0.42], [0.3, 0.24, 0.1, 0.32], [-0.28, 0.25, -0.05, 0.33], [0.05, 0.5, 0.05, 0.3]]);
  const shrubMesh = new THREE.InstancedMesh(shrubGeo, std({ map: tex.foliage(), roughness: 0.9 }), shrubs.length);
  const flowers: THREE.Matrix4[] = [];
  const flowerCols: THREE.Color[] = [];
  const petal = ['#e86f8a', '#f2c94c', '#f4f1ea', '#9b6fc9', '#e8823a'];
  shrubs.forEach((s, i) => {
    shrubMesh.setMatrixAt(i, new THREE.Matrix4().compose(P3(s.q), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd() * 6.28, 0)), new THREE.Vector3(s.s, s.s, s.s)));
    shrubMesh.setColorAt(i, new THREE.Color(greens[(i + 2) % greens.length]).multiplyScalar(0.95));
    const c = petal[i % petal.length];
    for (let k = 0; k < 7; k++) {
      const a = rnd() * 6.28, rr = 0.45 * s.s + rnd() * 0.25;
      const q: Vec2 = [s.q[0] + Math.cos(a) * rr, s.q[1] + Math.sin(a) * rr];
      if (!clear(q, 0.15)) continue;
      flowers.push(new THREE.Matrix4().compose(P3(q, 0.12 + rnd() * 0.12), new THREE.Quaternion(), new THREE.Vector3(1, 0.7, 1)));
      flowerCols.push(new THREE.Color(c));
    }
  });
  shrubMesh.castShadow = shrubMesh.receiveShadow = true;
  g.add(shrubMesh);
  if (flowers.length) {
    const fm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.045, 1), std({ color: '#ffffff', roughness: 0.6 }), flowers.length);
    flowers.forEach((m, i) => { fm.setMatrixAt(i, m); fm.setColorAt(i, flowerCols[i]); });
    g.add(fm);
  }

  // The neighbours' houses beyond the fence, and hills on the horizon.
  const homes: [number, number, number, string][] = [];
  for (let s = f.s0 + 1; s < f.s1; s += 10.5) homes.push([s + 3.5, f.T + 9, 0, ['#d9cdb8', '#b7c7cf', '#cfa98f', '#c9d3b8'][homes.length % 4]]);
  homes.push([f.s0 - 9, f.T * 0.45, Math.PI / 2, '#e2d6c2'], [f.s1 + 9, f.T * 0.45, -Math.PI / 2, '#bfc9d6']);
  for (const [s, t, turn, color] of homes) {
    const c = at(s, t);
    const yaw = -yawAlong + turn;
    const house = new THREE.Group();
    house.position.set(c[0], 0, c[1]);
    house.rotation.y = yaw;
    const W = 7, D = 6, H = 5.2;
    const face = std({ map: tex.houseFace(color) });
    const plain = std({ color });
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [plain, plain, plain, plain, face, face]);
    body.position.y = H / 2;
    house.add(body, roofPrism(W + 0.6, D + 0.6, 1.9, H, std({ map: tex.shingles() })));
    g.add(house);
  }
  const hillMat = std({ color: '#7f9a7a', roughness: 1 });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.3, d = 105 + rnd() * 25;
    const h = new THREE.Mesh(new THREE.SphereGeometry(30 + rnd() * 25, 20, 10), hillMat);
    h.scale.y = 0.22 + rnd() * 0.12;
    h.position.set(w.catio.centre[0] + Math.cos(a) * d, -2, w.catio.centre[2] + Math.sin(a) * d);
    g.add(h);
  }

  // Other site obstacles (trees are drawn above).
  for (const ob of p.site.obstacles ?? []) if (ob.kind !== 'tree') g.add(buildObstacle(ob));
  return g;
}

/** A gable roof: eaves at `eave` along x, ridge along x, `rise` above the eaves. Centred on the origin in x and z. */
function roofPrism(len: number, depth: number, rise: number, eave: number, m: THREE.Material): THREE.Object3D {
  const g = new THREE.Group();
  const half = depth / 2, slope = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(boxUV(new THREE.BoxGeometry(len, 0.08, slope), len, 0.08, slope, 1.6), m);
    b.position.set(0, eave + rise / 2, (s * half) / 2);
    b.rotation.x = s * ang;
    b.castShadow = true;
    g.add(b);
  }
  const shape = new THREE.Shape([new THREE.Vector2(-half + 0.3, 0), new THREE.Vector2(half - 0.3, 0), new THREE.Vector2(0, rise - 0.15)]);
  const gm = new THREE.MeshStandardMaterial({ color: '#e7e2d8', roughness: 0.9, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.ShapeGeometry(shape), gm);
    t.rotation.y = Math.PI / 2;
    t.position.set((s * (len - 0.6)) / 2, eave, 0);
    g.add(t);
  }
  return g;
}

/** Pavers along the floor of paved tunnels and their window chute. */
export function buildTunnelFloors(w: World): THREE.Group {
  const g = new THREE.Group();
  const paved = w.tunnels.filter((t) => t.paved).map((t) => `tunnel:${t.id}:seg`);
  if (!paved.length) return g;
  const m = std({ map: tex.pavers(), roughness: 0.95 });
  for (const s of w.surfaces) {
    const chute = s.id === 'chute-floor';
    if (!chute && !paved.some((k) => s.id.startsWith(k))) continue;
    const mesh = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(2 * s.h[0], 2 * s.h[1]), (2 * s.h[0]) / 0.8, (2 * s.h[1]) / 0.8), m);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.set(-Math.PI / 2, -s.yaw, 0);
    mesh.position.set(s.c[0], chute ? 0.004 : 0.006, s.c[1]);
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

// ---------- the house ----------

/** The house behind each site wall: siding, windows from the plan, and a shingled roof. Over the room the roof goes on ROOF_LAYER. */
export function buildHouseShell(p: Project, w: World): THREE.Group {
  const g = new THREE.Group();
  const sidingMat = std({ map: tex.siding('#e3e6e4'), roughness: 0.9 });
  const roofMat = std({ map: tex.shingles(), roughness: 0.9 });
  const trim = std({ color: '#f7f5ef', roughness: 0.7 });
  const glass = std({ color: '#7fa6c0', roughness: 0.08, metalness: 0.2 });
  const door = std({ color: '#6b5a4c' });
  for (const wall of p.site.walls) {
    const L = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    if (L < 0.5) continue;
    const host = wall.id === w.hostWallId && w.roomSpan;
    if (w.home && !host) continue; // the planner's own wall drawing stands in
    const ang = Math.atan2(wall.b[1] - wall.a[1], wall.b[0] - wall.a[0]);
    const grp = new THREE.Group();
    grp.position.set(wall.a[0], 0, wall.a[1]);
    grp.rotation.y = -ang;
    // Wall-local: x along the wall, +z outdoors, the house body toward −z.
    const H = wall.height, DEP = host ? w.roomSpan!.depth : 6;
    const body = (x0: number, x1: number) => {
      if (x1 - x0 < 0.05) return;
      const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(x1 - x0, H, DEP - 0.2), x1 - x0, H, DEP - 0.2, 2), sidingMat);
      m.position.set((x0 + x1) / 2, H / 2, -0.2 - (DEP - 0.2) / 2);
      m.castShadow = m.receiveShadow = true;
      grp.add(m);
    };
    if (host) { body(0, w.roomSpan!.a0); body(w.roomSpan!.a1, L); } else body(0, L);
    // The face of the wall outdoors: siding over the planner's plain wall.
    if (host) {
      // The host wall is drawn by the game (with the open window); its other openings go on its face.
      for (const o of wall.openings) {
        if (o.id === w.gatewayOpeningId) continue;
        const isGlass = o.kind === 'window' || o.kind === 'patio-door';
        const fr = new THREE.Mesh(new THREE.BoxGeometry(o.width + 0.1, o.height + 0.1, 0.03), trim);
        fr.position.set(o.offset + o.width / 2, o.sill + o.height / 2, 0.012);
        const pane = new THREE.Mesh(new THREE.BoxGeometry(o.width, o.height, 0.02), isGlass ? glass : door);
        pane.position.set(o.offset + o.width / 2, o.sill + o.height / 2, 0.024);
        grp.add(fr, pane);
      }
    } else {
      const face = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(L, H), L / 2, H / 2), sidingMat);
      face.position.set(L / 2, H / 2, 0.003);
      grp.add(face);
    }
    // Roof along the wall, eaves overhanging front and back; split over the room.
    const roof = (x0: number, x1: number, overRoom: boolean) => {
      if (x1 - x0 < 0.05) return;
      const r = roofPrism(x1 - x0, DEP + 0.7, Math.min(2.2, DEP * 0.32), H, roofMat);
      r.position.set((x0 + x1) / 2, 0, -DEP / 2 + 0.0);
      if (overRoom) r.traverse((o) => o.layers.set(ROOF_LAYER));
      grp.add(r);
    };
    if (host) { roof(-0.35, w.roomSpan!.a0, false); roof(w.roomSpan!.a0, w.roomSpan!.a1, true); roof(w.roomSpan!.a1, L + 0.35, false); }
    else roof(-0.35, L + 0.35, false);
    // Fascia board under the front eave.
    const fascia = new THREE.Mesh(new THREE.BoxGeometry(L + 0.7, 0.14, 0.04), trim);
    fascia.position.set(L / 2, H - 0.02, 0.36);
    grp.add(fascia);
    g.add(grp);
  }
  return g;
}

/** A house wall from the world (host wall or room wall), with siding outside, wallpaper inside, skirting and a window frame. */
export function houseWall(w: WallSpec): { group: THREE.Group; materials: THREE.MeshStandardMaterial[] } {
  const group = new THREE.Group();
  const ang = Math.atan2(w.dir[1], w.dir[0]);
  group.position.set(w.a[0], 0, w.a[1]);
  group.rotation.y = -ang;
  const left: [number, number] = [-w.dir[1], w.dir[0]];
  const toward = left[0] * w.normal[0] + left[1] * w.normal[1] > 0 ? -1 : 1; // the body lies toward local z = toward
  const zc = (toward * w.thickness) / 2;
  // Which box face is indoors: room walls face their normal (z = 0 side); the host wall faces away from it.
  const innerAtZero = !w.host;
  const paper = std({ map: tex.wallpaper('#e9dfcf'), roughness: 0.95 });
  const outside = w.host ? std({ map: tex.siding('#e3e6e4'), roughness: 0.9 }) : std({ color: '#ddd6ca', roughness: 0.95 });
  const edge = std({ color: '#f1ebe0', roughness: 0.95 });
  const skirting = std({ color: '#f7f4ee', roughness: 0.6 });
  const frame = std({ color: '#ffffff', roughness: 0.5 });
  const materials = [paper, outside, edge, skirting, frame];
  // Box faces +z / −z: the +z face is at z = zc + T/2.
  const plusZIsInner = innerAtZero ? toward < 0 : toward > 0;
  const faceMats = [edge, edge, edge, edge, plusZIsInner ? paper : outside, plusZIsInner ? outside : paper];
  const piece = (a0: number, a1: number, y0: number, y1: number) => {
    if (a1 - a0 < 0.005 || y1 - y0 < 0.005) return;
    const geo = new THREE.BoxGeometry(a1 - a0, y1 - y0, w.thickness);
    // Texture coordinates in metres from the wall's start and the floor, so pieces line up.
    const uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 16; i < 24; i++) uv.setXY(i, (pos.getX(i) + (a0 + a1) / 2) / 1.2, (pos.getY(i) + (y0 + y1) / 2) / 1.2);
    const m = new THREE.Mesh(geo, faceMats);
    m.position.set((a0 + a1) / 2, (y0 + y1) / 2, zc);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  let at = 0;
  const holes = [...w.holes].sort((x, y) => x.a0 - y.a0);
  for (const h of holes) {
    piece(at, h.a0, 0, w.height);
    piece(h.a0, h.a1, 0, h.y0);
    piece(h.a0, h.a1, h.y1, w.height);
    // A white frame round the open window on both faces, and a sill board indoors.
    for (const [a0, a1, y0, y1] of [[h.a0 - 0.06, h.a0, h.y0, h.y1 + 0.06], [h.a1, h.a1 + 0.06, h.y0, h.y1 + 0.06], [h.a0 - 0.06, h.a1 + 0.06, h.y1, h.y1 + 0.06], [h.a0 - 0.06, h.a1 + 0.06, h.y0 - 0.05, h.y0]]) {
      for (const z of [-0.012, w.thickness + 0.012]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(a1 - a0, y1 - y0, 0.02), frame);
        f.position.set((a0 + a1) / 2, (y0 + y1) / 2, toward * z);
        group.add(f);
      }
    }
    at = h.a1;
  }
  piece(at, w.length, 0, w.height);
  // Skirting along the indoor face.
  const zIn = innerAtZero ? -toward * 0.008 : toward * (w.thickness + 0.008);
  const sk = new THREE.Mesh(new THREE.BoxGeometry(w.length, 0.09, 0.016), skirting);
  sk.position.set(w.length / 2, 0.045, zIn);
  sk.receiveShadow = true;
  group.add(sk);
  return { group, materials };
}

// ---------- the room ----------

/** Soft furniture and its front faces: bookshelves full of books, cabinet doors, a sofa with cushions. */
export function buildFurniture(s: Surface, roomCentre: Vec2): THREE.Object3D {
  const g = new THREE.Group();
  const color = s.color ?? '#a08870';
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  // Which side faces the room: local +x, −x, +z or −z.
  const to: Vec2 = [roomCentre[0] - s.c[0], roomCentre[1] - s.c[1]];
  const lx = to[0] * c + to[1] * sn, lz = -to[0] * sn + to[1] * c;
  const front = Math.abs(lx) / Math.max(0.01, s.h[0]) > Math.abs(lz) / Math.max(0.01, s.h[1]) ? (lx > 0 ? 0 : 1) : lz > 0 ? 4 : 5;
  const place = (m: THREE.Mesh, y: number) => { m.position.set(s.c[0], y, s.c[1]); m.rotation.y = -s.yaw; m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  const box = (y0: number, y1: number, mats: THREE.Material | THREE.Material[], inset = 0) => place(new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.01, 2 * s.h[0] - inset), Math.max(0.005, y1 - y0), Math.max(0.01, 2 * s.h[1] - inset)), mats), (y0 + y1) / 2);
  const rounded = (w: number, h: number, d: number, y: number, m: THREE.Material, dx = 0, dz = 0, r = 0.05) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, h / 2 - 0.001, w / 2 - 0.001, d / 2 - 0.001)), m);
    mesh.position.set(s.c[0] + dx * c - dz * sn, y, s.c[1] + dx * sn + dz * c);
    mesh.rotation.y = -s.yaw;
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  const withFront = (t: THREE.Texture, base: string) => { const plain = std({ color: base }); const f = std({ map: t, roughness: 0.8 }); const a: THREE.Material[] = [plain, plain, plain, plain, plain, plain]; a[front] = f; return a; };
  const legs = (h: number, inset = 0.05) => {
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = i * (s.h[0] - inset), z = j * (s.h[1] - inset);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.014, h, 8), std({ color: '#5b4331' }));
      leg.position.set(s.c[0] + x * c - z * sn, h / 2, s.c[1] + x * sn + z * c);
      leg.castShadow = true;
      g.add(leg);
    }
  };
  const wood = (col: string) => std({ color: col, roughness: 0.6 });
  switch (s.id) {
    case 'sill': box(s.top - 0.04, s.top, std({ color: '#f4efe6', roughness: 0.5 })); break;
    case 'seat': {
      box(0, s.top - 0.08, withFront(tex.cabinetDoors('#e8e1d4', 1, 2), '#e8e1d4'));
      rounded(2 * s.h[0] - 0.02, 0.09, 2 * s.h[1] - 0.02, s.top - 0.045, std({ map: tex.soft('#c9b79c'), roughness: 1 }), 0, 0, 0.04);
      break;
    }
    case 'counter': {
      box(0, s.top - 0.04, withFront(tex.cabinetDoors('#e3ddd2', 1, 4), '#e3ddd2'), 0.04);
      box(s.top - 0.04, s.top, std({ color: '#d9d4cb', roughness: 0.35 }));
      break;
    }
    case 'fridge': box(0, s.top, withFront(tex.cabinetDoors('#e4e8ec', 2, 1), '#e4e8ec').map((m) => { (m as THREE.MeshStandardMaterial).roughness = 0.3; return m; })); break;
    case 'cabinet': box(0, s.top, withFront(tex.cabinetDoors('#8a6f5a', 2, 1), '#8a6f5a')); break;
    case 'bookshelf': box(0, s.top, withFront(tex.books(), '#6f5845')); break;
    case 'wardrobe': box(0, s.top, withFront(tex.cabinetDoors('#7c6450', 1, 2), '#7c6450')); break;
    case 'coffee': case 'side': {
      box(s.top - 0.04, s.top, wood(color));
      legs(s.top - 0.04);
      break;
    }
    case 'grass': {
      place(new THREE.Mesh(new THREE.CylinderGeometry(Math.min(s.h[0], s.h[1]) * 1.05, Math.min(s.h[0], s.h[1]) * 0.85, s.top, 18), std({ color: '#b5653d', roughness: 0.9 })), s.top / 2);
      const blades = blobGeometry([[0, 0, 0, 0.09], [0.05, 0.03, 0.02, 0.07], [-0.05, 0.04, -0.02, 0.07]], 1);
      blades.scale(1, 1.6, 1);
      const m = new THREE.Mesh(blades, std({ color: '#7bb35a', roughness: 0.8, flatShading: true }));
      m.position.set(s.c[0], s.top + 0.08, s.c[1]);
      g.add(m);
      break;
    }
    case 'bed': {
      rounded(2 * s.h[0], s.top, 2 * s.h[1], s.top / 2, std({ map: tex.soft(color), roughness: 1 }), 0, 0, 0.05);
      rounded(2 * s.h[0] - 0.14, 0.04, 2 * s.h[1] - 0.14, s.top + 0.005, std({ map: tex.soft('#efe3d3'), roughness: 1 }), 0, 0, 0.018);
      break;
    }
    case 'sofa-seat': {
      const fab = std({ map: tex.soft(color), roughness: 1 });
      rounded(2 * s.h[0], s.top - 0.12, 2 * s.h[1], (s.top - 0.12) / 2, fab, 0, 0, 0.04);
      const n = 3, cw = (2 * s.h[0]) / n;
      for (let i = 0; i < n; i++) rounded(cw - 0.015, 0.14, 2 * s.h[1] - 0.02, s.top - 0.07, fab, -s.h[0] + cw * (i + 0.5), 0, 0.06);
      break;
    }
    case 'sofa-back': case 'sofa-arm-l': case 'sofa-arm-r':
      rounded(2 * s.h[0], s.top, 2 * s.h[1], s.top / 2, std({ map: tex.soft(color), roughness: 1 }), 0, 0, 0.07);
      break;
    case 'tree-base': rounded(2 * s.h[0], s.top, 2 * s.h[1], s.top / 2, std({ map: tex.soft('#b9a58a'), roughness: 1 }), 0, 0, 0.02); break;
    case 'tree-post': {
      const r = Math.min(s.h[0], s.h[1]);
      const rope = std({ map: tex.soft('#d6c29a'), roughness: 1 });
      const geo = new THREE.CylinderGeometry(r, r, s.top, 14);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 30, uv.getX(i)); // sisal wound round the post
      place(new THREE.Mesh(geo, rope), s.top / 2);
      break;
    }
    case 'tree-1': case 'tree-2': case 'tree-3':
      rounded(2 * s.h[0], 0.05, 2 * s.h[1], s.top - 0.025, std({ map: tex.soft('#b9a58a'), roughness: 1 }), 0, 0, 0.02);
      break;
    case 'lamp': case 'plant': break; // drawn as decor
    default:
      if (s.solid) box(s.bottom, s.top, std({ color }));
      else box(s.top - 0.04, s.top, std({ color }));
  }
  return g;
}

export interface Interior { group: THREE.Group; wallDecor: { wallId: string; object: THREE.Object3D }[]; update(t: number, camera: THREE.Vector3): void }

/** Floor, rug, ceiling, decor, bowls, lights and the light through the window. */
export function buildInterior(w: World, hostWall: WallSpec | undefined): Interior {
  const g = new THREE.Group();
  const wallDecor: Interior['wallDecor'] = [];
  const room = w.room!;
  const centre = room.c;
  // Floor.
  const floor = new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(2 * room.h[0] + 0.3, 2 * room.h[1] + 0.3), (2 * room.h[0]) / 1.2, (2 * room.h[1]) / 1.2), std({ map: tex.floorboards(), roughness: 0.55 }));
  floor.rotation.order = 'YXZ';
  floor.rotation.set(-Math.PI / 2, -room.yaw, 0);
  floor.position.set(centre[0], 0.002, centre[1]);
  floor.receiveShadow = true;
  g.add(floor);
  // Rug under the coffee table.
  const coffee = w.surfaces.find((s) => s.id === 'coffee');
  if (coffee) {
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(2 * coffee.h[0] + 1.3, 2 * coffee.h[1] + 1.0), std({ map: tex.rug(), roughness: 1 }));
    rug.rotation.order = 'YXZ';
    rug.rotation.set(-Math.PI / 2, -coffee.yaw, 0);
    rug.position.set(coffee.c[0], 0.005, coffee.c[1]);
    rug.receiveShadow = true;
    g.add(rug);
  }
  // Ceiling: on the roof layer (hidden from a camera above it, still shading the room).
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2 * room.h[0] + 0.4, 2 * room.h[1] + 0.4), std({ color: '#f6f2ea', roughness: 1 }));
  ceil.rotation.order = 'YXZ';
  ceil.rotation.set(Math.PI / 2, -room.yaw, 0);
  ceil.position.set(centre[0], room.height, centre[1]);
  ceil.castShadow = true;
  ceil.layers.set(ROOF_LAYER);
  g.add(ceil);
  // Furniture.
  for (const s of w.surfaces) if (s.region === 'home' && s.color) g.add(buildFurniture(s, centre));
  // Bowls.
  for (const s of w.spots) {
    if (s.region !== 'home' || (s.kind !== 'drink' && s.kind !== 'eat')) continue;
    const bowl = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.07, 0], [0.09, 0.05], [0.082, 0.052], [0.065, 0.012], [0, 0.012]].map(([x, y]) => new THREE.Vector2(x, y)), 24), std({ color: s.kind === 'drink' ? '#4a8fc2' : '#c9a27e', roughness: 0.3 }));
    bowl.position.set(s.p[0], 0.003, s.p[2]);
    bowl.castShadow = true;
    g.add(bowl);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(0.075, 20), s.kind === 'drink' ? std({ color: '#9fd0ec', roughness: 0.05, metalness: 0.1 }) : std({ color: '#8a5a32', roughness: 0.9 }));
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(s.p[0], 0.04, s.p[2]);
    g.add(fill);
  }

  // Decor.
  const nearestWall = (p: Vec3) => {
    let best: { id: string; d: number } | null = null;
    for (const ws of w.walls) {
      const dx = p[0] - ws.a[0], dz = p[2] - ws.a[1];
      const along = dx * ws.dir[0] + dz * ws.dir[1];
      const off = Math.abs(dx * ws.normal[0] + dz * ws.normal[1]) - (ws.host ? ws.thickness : 0);
      if (along < -0.2 || along > ws.length + 0.2) continue;
      if (!best || Math.abs(off) < best.d) best = { id: ws.id, d: Math.abs(off) };
    }
    return best && best.d < 0.2 ? best.id : null;
  };
  const lights: THREE.PointLight[] = [];
  let rodEnds: THREE.Vector3[] = [];
  for (const d of w.decor) {
    const o = new THREE.Group();
    o.position.set(d.p[0], d.p[1], d.p[2]);
    o.rotation.y = d.yaw;
    switch (d.kind) {
      case 'picture': {
        const pw = d.w ?? 0.6, ph = d.h ?? 0.45;
        const plain = std({ color: '#2b2622', roughness: 0.6 });
        const m = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.03), [plain, plain, plain, plain, std({ map: tex.picture(d.variant ?? 0), roughness: 0.5 }), plain]);
        m.position.z = 0.016;
        m.castShadow = true;
        o.add(m);
        break;
      }
      case 'clock': {
        const r = (d.w ?? 0.3) / 2;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.04, 32), [std({ color: '#2b2622' }), std({ map: tex.clockFace(), roughness: 0.4 }), std({ color: '#2b2622' })]);
        m.rotation.x = Math.PI / 2;
        m.position.z = 0.02;
        o.add(m);
        break;
      }
      case 'curtain': {
        const cw = d.w ?? 0.26, top = d.h ?? 2;
        const bottom = 0.5;
        const geo = new THREE.PlaneGeometry(cw, top - bottom, 18, 1);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) pos.setZ(i, 0.022 * Math.sin((pos.getX(i) / cw) * Math.PI * 7));
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, std({ map: tex.soft('#b9644c'), roughness: 1, side: THREE.DoubleSide }));
        m.position.set(0, (top + bottom) / 2, 0);
        m.castShadow = true;
        o.add(m);
        rodEnds.push(new THREE.Vector3(d.p[0], top + 0.03, d.p[2]));
        break;
      }
      case 'lamp': {
        const metal = std({ color: '#3a3632', roughness: 0.4, metalness: 0.6 });
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.03, 24), metal);
        base.position.y = 0.015;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.45, 8), metal);
        pole.position.y = 0.74;
        const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 0.26, 28, 1, true), std({ color: '#f3e7cf', roughness: 0.9, side: THREE.DoubleSide, emissive: new THREE.Color('#ffcf8a'), emissiveIntensity: 0.55 }));
        shade.position.y = 1.5;
        for (const m of [base, pole, shade]) m.castShadow = true;
        const light = new THREE.PointLight('#ffc98a', 1.2, 6, 2);
        light.position.y = 1.45;
        lights.push(light);
        o.add(base, pole, shade, light);
        break;
      }
      case 'plant': {
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.14, 0.38, 22), std({ color: '#c6703f', roughness: 0.85 }));
        pot.position.y = 0.19;
        pot.castShadow = true;
        o.add(pot);
        const leafMat = std({ color: '#3f7a3a', roughness: 0.6, side: THREE.DoubleSide });
        const r = tex.rng(5);
        for (let i = 0; i < 11; i++) {
          const a = (i / 11) * Math.PI * 2 + r() * 0.4;
          const stem = new THREE.Group();
          stem.position.y = 0.36;
          stem.rotation.set(0, a, 0);
          const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), leafMat);
          leaf.scale.set(0.7, 0.08, 1.2);
          const tilt = 0.5 + r() * 0.6;
          leaf.position.set(0, 0.25 + r() * 0.45, 0.18 + r() * 0.1);
          leaf.rotation.x = tilt;
          leaf.castShadow = true;
          stem.add(leaf);
          o.add(stem);
        }
        break;
      }
      case 'pendant': {
        o.layers.set(ROOF_LAYER);
        const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.5, 6), std({ color: '#222222' }));
        cord.position.y = -0.25;
        const shade = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.18, 28, 1, true), std({ color: '#2f4a5e', roughness: 0.5, side: THREE.DoubleSide }));
        shade.position.y = -0.55;
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshBasicMaterial({ color: '#fff3d6' }));
        bulb.position.y = -0.62;
        const light = new THREE.PointLight('#ffe2b8', 2.2, 9, 2);
        light.position.y = -0.7;
        lights.push(light);
        for (const m of [cord, shade, bulb]) m.layers.set(ROOF_LAYER);
        o.add(cord, shade, bulb, light);
        break;
      }
    }
    const wid = d.kind === 'curtain' || d.kind === 'picture' || d.kind === 'clock' ? nearestWall(d.p) : null;
    if (wid) wallDecor.push({ wallId: wid, object: o });
    else g.add(o);
  }
  // Curtain rod across both curtains.
  if (rodEnds.length === 2 && hostWall) {
    const [a, b] = rodEnds;
    const dir = b.clone().sub(a);
    const len = dir.length() + 0.3;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 8), std({ color: '#3a3632', metalness: 0.6, roughness: 0.35 }));
    rod.position.copy(a.clone().add(b).multiplyScalar(0.5));
    rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const wid = nearestWall([rod.position.x, rod.position.y, rod.position.z]);
    if (wid) wallDecor.push({ wallId: wid, object: rod }); else g.add(rod);
  }
  rodEnds = [];

  // Light through the window: a soft shaft from the opening to the sunbeam on the floor, with dust in it.
  let update = (_t: number, _cam: THREE.Vector3) => {};
  const beam = w.spots.find((s) => s.id === 'nap:sunbeam')?.area;
  const hole = hostWall?.holes[0];
  if (hostWall && hole && beam) {
    const inward: Vec2 = [-hostWall.normal[0], -hostWall.normal[1]];
    const onWall = (a: number, y: number) => new THREE.Vector3(hostWall.a[0] + hostWall.dir[0] * a + inward[0] * hostWall.thickness, y, hostWall.a[1] + hostWall.dir[1] * a + inward[1] * hostWall.thickness);
    const W = [onWall(hole.a0, hole.y0), onWall(hole.a1, hole.y0), onWall(hole.a1, hole.y1), onWall(hole.a0, hole.y1)]; // bottom-left, bottom-right, top-right, top-left
    const cs = corners(beam).map((q) => ({ q, along: (q[0] - hostWall.a[0]) * hostWall.dir[0] + (q[1] - hostWall.a[1]) * hostWall.dir[1], off: (q[0] - hostWall.a[0]) * inward[0] + (q[1] - hostWall.a[1]) * inward[1] }));
    const near = cs.sort((x, y) => x.off - y.off).slice(0, 2).sort((x, y) => x.along - y.along);
    const far = cs.slice(2).sort((x, y) => x.along - y.along);
    const y0 = 0.01;
    const F = [P3(near[0].q, y0), P3(near[1].q, y0), P3(far[1].q, y0), P3(far[0].q, y0)]; // near-left, near-right, far-right, far-left
    const quads: [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3][] = [[W[0], W[1], F[1], F[0]], [W[3], W[2], F[2], F[3]], [W[0], W[3], F[3], F[0]], [W[1], W[2], F[2], F[1]]];
    const pos: number[] = [], k: number[] = [];
    for (const [a, b, c2, d2] of quads) {
      for (const [v, kk] of [[a, 1], [b, 1], [c2, 0], [a, 1], [c2, 0], [d2, 0]] as const) { pos.push(v.x, v.y, v.z); k.push(kk); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('k', new THREE.Float32BufferAttribute(k, 1));
    const shaft = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color('#ffe9bf') }, strength: { value: 1 } },
      vertexShader: 'attribute float k; varying float vk; void main() { vk = k; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 color; uniform float strength; varying float vk; void main() { gl_FragColor = vec4(color * (0.015 + 0.07 * vk * vk) * strength, 1.0); }',
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    shaft.renderOrder = 4;
    g.add(shaft);
    // Dust motes drifting in the light.
    const N = 140;
    const seeds = Array.from({ length: N }, (_, i) => { const r = tex.rng(900 + i); return [r(), r(), r(), r() * 6.28] as const; });
    const mp = new Float32Array(N * 3);
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    const motes = new THREE.Points(mg, new THREE.PointsMaterial({ map: tex.mote(), size: 0.018, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, color: '#fff2cf' }));
    motes.frustumCulled = false;
    g.add(motes);
    const lerp = (a: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) => out.copy(a).lerp(b, t);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3(), E = new THREE.Vector3();
    // The shaft only shows from inside the room (from outside, the light is on the far side of the glass).
    const inRoom = (q: THREE.Vector3) => {
      const dx = q.x - room.c[0], dz = q.z - room.c[1], c = Math.cos(room.yaw), sn = Math.sin(room.yaw);
      return Math.abs(dx * c + dz * sn) < room.h[0] + 0.05 && Math.abs(-dx * sn + dz * c) < room.h[1] + 0.05 && q.y < room.height;
    };
    const shaftMat = shaft.material as THREE.ShaderMaterial;
    let seen = 1;
    const wc = W[0].clone().add(W[2]).multiplyScalar(0.5);
    update = (t: number, cam: THREE.Vector3) => {
      // Fade out close to the window too, where the camera would look along the shaft's sheets.
      const near = Math.hypot(cam.x - wc.x, cam.z - wc.z);
      const goal = inRoom(cam) ? Math.min(1, Math.max(0, (near - 1.1) / 1.0)) : 0;
      seen += (goal - seen) * 0.1;
      shaftMat.uniforms.strength.value = seen;
      shaft.visible = motes.visible = seen > 0.02;
      for (let i = 0; i < N; i++) {
        const [u0, v, h, ph] = seeds[i];
        const u = (u0 + t * 0.012) % 1;
        // Point on the window (v along, h up) and on the floor patch (v along, h near→far), then along the shaft.
        lerp(W[0], W[1], v, A); lerp(W[3], W[2], v, B); lerp(A, B, h, C);
        lerp(F[0], F[1], v, A); lerp(F[3], F[2], v, B); lerp(A, B, h, D);
        lerp(C, D, 0.08 + u * 0.84, E);
        mp[i * 3] = E.x + Math.sin(t * 0.3 + ph) * 0.03;
        mp[i * 3 + 1] = E.y + Math.sin(t * 0.21 + ph * 2) * 0.03;
        mp[i * 3 + 2] = E.z + Math.cos(t * 0.27 + ph) * 0.03;
      }
      mg.attributes.position.needsUpdate = true;
    };
    update(0, new THREE.Vector3(room.c[0], 1, room.c[1]));
  }
  return { group: g, wallDecor, update };
}

/** Where the sun should be so that it shines through the open window onto the room's sunbeam (else a pleasant default). */
export function sunDirection(w: World, hostWall: WallSpec | undefined): THREE.Vector3 {
  const beam = w.spots.find((s) => s.id === 'nap:sunbeam')?.area;
  const hole = hostWall?.holes[0];
  if (hostWall && hole && beam) {
    const a = (hole.a0 + hole.a1) / 2;
    const wc = new THREE.Vector3(hostWall.a[0] + hostWall.dir[0] * a, (hole.y0 + hole.y1) / 2, hostWall.a[1] + hostWall.dir[1] * a);
    const dir = wc.sub(new THREE.Vector3(beam.c[0], 0, beam.c[1])).normalize();
    return dir;
  }
  return new THREE.Vector3(-0.45, 0.75, 0.5).normalize();
}

export type { Rect };

// ---------- draw-call budget ----------

/** A key for materials that draw identically (the planner makes one material per part). */
function signature(m: THREE.Material): string | null {
  if (!(m instanceof THREE.MeshStandardMaterial) && !(m instanceof THREE.MeshBasicMaterial)) return null;
  const s = m as THREE.MeshStandardMaterial;
  return [m.type, s.color?.getHexString(), s.roughness, s.metalness, s.map?.uuid, s.emissive?.getHexString(), s.emissiveIntensity, m.transparent, m.opacity, m.side, m.depthWrite, m.alphaTest, s.flatShading, m.polygonOffset, m.polygonOffsetFactor, m.blending, m.vertexColors].join('|');
}

/** One piece of a mesh's geometry (a material group), in world space, with position, normal and uv only. */
function piece(mesh: THREE.Mesh, start: number, count: number): THREE.BufferGeometry {
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const g = new THREE.BufferGeometry();
  const end = Math.min(src.attributes.position.count, start + count);
  for (const name of ['position', 'normal', 'uv']) {
    const a = src.attributes[name] as THREE.BufferAttribute | undefined;
    const size = name === 'uv' ? 2 : 3;
    const arr = new Float32Array((end - start) * size);
    if (a) for (let i = start; i < end; i++) for (let k = 0; k < size; k++) arr[(i - start) * size + k] = a.array[i * a.itemSize + k];
    g.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  if (!src.attributes.normal) g.computeVertexNormals();
  g.applyMatrix4(mesh.matrixWorld);
  return g;
}

/**
 * Merge a static group's meshes into one mesh per look (material, shadows, layer, draw order), so a room
 * full of furniture costs a handful of draw calls. Lights, instanced meshes, points, sprites, lines and
 * custom shaders are kept as they are (re-parented with their world transforms).
 */
export function mergeStatics(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const out = new THREE.Group();
  const buckets = new Map<string, { mat: THREE.Material; mesh: THREE.Mesh; geos: THREE.BufferGeometry[] }>();
  const keep: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o === root) return;
    const m = o as THREE.Mesh;
    const plain = m.isMesh && !(o as THREE.InstancedMesh).isInstancedMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh;
    if (!plain) {
      if ((o as THREE.Light).isLight || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.Line).isLine || (o as THREE.InstancedMesh).isInstancedMesh) keep.push(o);
      return;
    }
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some((x) => signature(x) === null)) { keep.push(o); return; }
    const count = m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count;
    const groups = Array.isArray(m.material) && m.geometry.groups.length ? m.geometry.groups : [{ start: 0, count, materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0];
      if (!mat || !mat.visible) continue;
      const key = `${signature(mat)}|${m.castShadow}|${m.receiveShadow}|${m.layers.mask}|${m.renderOrder}`;
      let b = buckets.get(key);
      if (!b) { b = { mat, mesh: m, geos: [] }; buckets.set(key, b); }
      b.geos.push(piece(m, gr.start, gr.count));
    }
  });
  for (const b of buckets.values()) {
    const geo = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    if (b.geos.length > 1) for (const g of b.geos) g.dispose();
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, b.mat);
    mesh.castShadow = b.mesh.castShadow;
    mesh.receiveShadow = b.mesh.receiveShadow;
    mesh.layers.mask = b.mesh.layers.mask;
    mesh.renderOrder = b.mesh.renderOrder;
    out.add(mesh);
  }
  for (const o of keep) out.attach(o);
  return out;
}
