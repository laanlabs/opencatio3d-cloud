// The cat's body as one smooth skinned mesh: chest, waist, rump, haunches, legs, paws, neck and head are
// blended shapes (a signed distance field, smooth-unioned), meshed once with surface nets around the rig's
// rest pose, skinned to its joints (each vertex follows the shapes it is nearest, so the shoulder and haunch
// blend into the body as the legs swing) and painted with the coat in vertex colours. Browser only (three.js).
import * as THREE from 'three';
import { coatOf } from './textures';

type V = [number, number, number];
type Part = 'torso' | 'neck' | 'head' | 'jaw' | 'leg' | 'paw';

/** The rig's joints at rest, as the model builds them. */
export interface Rig {
  body: THREE.Object3D;
  neck: THREE.Object3D;
  head: THREE.Object3D;
  jaw: THREE.Object3D;
  legs: { hip: THREE.Object3D; j: THREE.Object3D[]; paw: THREE.Object3D; front: boolean; side: number }[];
}

interface Prim { d: (x: number, y: number, z: number) => number; bone: number; part: Part; side: number; c: V; r: number }

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

// Each shape also carries a bounding sphere, so far-away shapes cost one distance (see `sdf`).
function ellipsoid(c: V, r: V) {
  return Object.assign((x: number, y: number, z: number) => {
    const px = (x - c[0]) / r[0], py = (y - c[1]) / r[1], pz = (z - c[2]) / r[2];
    const qx = px / r[0], qy = py / r[1], qz = pz / r[2];
    const k0 = Math.sqrt(px * px + py * py + pz * pz), k1 = Math.sqrt(qx * qx + qy * qy + qz * qz);
    return k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(...r);
  }, { c, r: Math.max(...r) });
}

/** A capsule whose radius runs from ra at a to rb at b. */
function cone(a: V, b: V, ra: number, rb: number) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2], bb = bx * bx + by * by + bz * bz;
  const c: V = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  return Object.assign((x: number, y: number, z: number) => {
    const t = clamp(((x - a[0]) * bx + (y - a[1]) * by + (z - a[2]) * bz) / bb, 0, 1);
    const dx = x - a[0] - bx * t, dy = y - a[1] - by * t, dz = z - a[2] - bz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t);
  }, { c, r: Math.sqrt(bb) / 2 + Math.max(ra, rb) });
}

interface Built { geometry: THREE.BufferGeometry; parts: Uint8Array; side: Int8Array; headAt: V }
let cached: Built | null = null;
const PARTS: Part[] = ['torso', 'neck', 'head', 'jaw', 'leg', 'paw'];

/** The skinned body for a rig at rest; `bones` lists the joints in skeleton order. Shared by every cat. */
function build(rig: Rig, bones: THREE.Object3D[]): Built {
  const W = (o: THREE.Object3D, x = 0, y = 0, z = 0): V => { const v = o.localToWorld(new THREE.Vector3(x, y, z)); return [v.x, v.y, v.z]; };
  const bi = (o: THREE.Object3D) => bones.indexOf(o);
  const prims: Prim[] = [];
  const add = (d: Prim['d'] & { c: V; r: number }, o: THREE.Object3D, part: Part, side = 0) => { prims.push({ d, bone: bi(o), part, side, c: d.c, r: d.r }); return prims.length - 1; };
  const { body, neck, head, jaw } = rig;

  // Torso: a deep chest, a tucked waist and a round rump, and the root of the tail.
  const torso = [
    add(ellipsoid(W(body, 0, -0.004, 0.083), [0.05, 0.072, 0.1]), body, 'torso'),
    add(ellipsoid(W(body, 0, 0.006, -0.02), [0.047, 0.057, 0.11]), body, 'torso'),
    add(ellipsoid(W(body, 0, 0.008, -0.122), [0.055, 0.062, 0.082]), body, 'torso'),
    add(cone(W(body, 0, 0.022, -0.168), W(body, 0, 0.03, -0.205), 0.028, 0.016), body, 'torso')
  ];
  const neckP = add(cone(W(body, 0, 0.012, 0.118), W(head, 0, -0.008, -0.018), 0.045, 0.036), neck, 'neck');
  // Head: a rounded skull, full cheeks, the bridge of the nose and the whisker pads; the chin moves with the jaw.
  const headP = [
    add(ellipsoid(W(head, 0, 0.004, -0.004), [0.044, 0.037, 0.043]), head, 'head'),
    add(ellipsoid(W(head, 0, -0.012, 0.006), [0.049, 0.027, 0.036]), head, 'head'),
    add(ellipsoid(W(head, 0, -0.002, 0.029), [0.014, 0.012, 0.02]), head, 'head'),
    add(ellipsoid(W(head, -0.0105, -0.018, 0.039), [0.0135, 0.0115, 0.013]), head, 'head'),
    add(ellipsoid(W(head, 0.0105, -0.018, 0.039), [0.0135, 0.0115, 0.013]), head, 'head'),
    add(ellipsoid(W(jaw, 0, -0.004, 0.014), [0.0135, 0.008, 0.015]), jaw, 'jaw')
  ];
  // Legs: shoulder and forearm, or haunch, shin and hock, each blending into the next, and an oval paw.
  const legP = rig.legs.map((L) => {
    const s = L.side;
    const ids: number[] = [];
    if (L.front) {
      ids.push(add(cone(W(L.hip, -s * 0.004, 0.024, -0.004), W(L.j[1]), 0.027, 0.016), L.j[0], 'leg', s));
      ids.push(add(cone(W(L.j[1]), W(L.paw, 0, 0.012, 0), 0.0155, 0.0115), L.j[1], 'leg', s));
    } else {
      ids.push(add(cone(W(L.hip, -s * 0.008, 0.008, 0.006), W(L.j[1], 0, 0.012, 0), 0.041, 0.02), L.j[0], 'leg', s));
      ids.push(add(ellipsoid(W(L.hip, -s * 0.004, -0.03, 0.006), [0.03, 0.045, 0.04]), L.j[0], 'leg', s)); // the haunch
      ids.push(add(cone(W(L.j[1]), W(L.j[2]), 0.0175, 0.012), L.j[1], 'leg', s));
      ids.push(add(cone(W(L.j[2]), W(L.paw, 0, 0.01, 0), 0.0115, 0.0105), L.j[2], 'leg', s));
    }
    ids.push(add(ellipsoid(W(L.paw, 0, 0.008, 0.007), L.front ? [0.0135, 0.0085, 0.019] : [0.013, 0.0085, 0.018]), L.paw, 'paw', s));
    return ids;
  });

  const v = new Float64Array(prims.length);
  // A shape more than 5 cm away counts by its bounding sphere: too far to change the blend (k ≤ 4 cm).
  const shapes = (x: number, y: number, z: number) => {
    for (let i = 0; i < prims.length; i++) {
      const P = prims[i], dx = x - P.c[0], dy = y - P.c[1], dz = z - P.c[2], db = Math.sqrt(dx * dx + dy * dy + dz * dz) - P.r;
      v[i] = db > 0.05 ? db : P.d(x, y, z);
    }
  };
  const sdf = (x: number, y: number, z: number) => {
    shapes(x, y, z);
    let t = v[torso[0]];
    for (let n = 1; n < torso.length; n++) t = smin(t, v[torso[n]], 0.04);
    let hd = v[headP[0]];
    for (let n = 1; n < headP.length; n++) hd = smin(hd, v[headP[n]], 0.012);
    let d = smin(smin(t, v[neckP], 0.03), hd, 0.02);
    for (const ids of legP) {
      let l = v[ids[0]];
      for (let n = 1; n < ids.length; n++) l = smin(l, v[ids[n]], 0.012);
      d = smin(d, l, 0.016);
    }
    return d;
  };

  // Surface nets over the rest pose.
  const h = 0.005, x0 = -0.095, y0 = -0.07, z0 = -0.245;
  const nx = Math.ceil(0.19 / h) + 1, ny = Math.ceil(0.41 / h) + 1, nz = Math.ceil(0.56 / h) + 1;
  const field = new Float32Array(nx * ny * nz);
  const id = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  // Coarse first (every other point); near the surface, the full detail.
  for (let k = 0; k < nz; k += 2) for (let j = 0; j < ny; j += 2) for (let i = 0; i < nx; i += 2) field[id(i, j, k)] = sdf(x0 + i * h, y0 + j * h, z0 + k * h);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!(i & 1) && !(j & 1) && !(k & 1)) continue;
    const near = field[id(Math.min(nx - 1, (i + 1) & ~1), Math.min(ny - 1, (j + 1) & ~1), Math.min(nz - 1, (k + 1) & ~1))];
    field[id(i, j, k)] = Math.abs(near) > 2.5 * h ? near : sdf(x0 + i * h, y0 + j * h, z0 + k * h);
  }
  const cell = new Int32Array(nx * ny * nz).fill(-1);
  const pos: number[] = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { cv[c] = field[id(i + corners[c][0], j + corners[c][1], k + corners[c][2])]; if (cv[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [a, b] of edges) {
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
      sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
      sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
      n++;
    }
    cell[id(i, j, k)] = pos.length / 3;
    pos.push(x0 + (i + sx / n) * h, y0 + (j + sy / n) * h, z0 + (k + sz / n) * h);
  }
  // Normals from the field's own gradient (central differences at the grid points, blended across the cell).
  const at = (i: number, j: number, k: number) => field[id(clamp(i, 0, nx - 1), clamp(j, 0, ny - 1), clamp(k, 0, nz - 1))];
  const grad = (x: number, y: number, z: number): V => {
    const fx = (x - x0) / h, fy = (y - y0) / h, fz = (z - z0) / h;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz), u = fx - i, w = fy - j, q = fz - k;
    const g: V = [0, 0, 0];
    for (let c = 0; c < 8; c++) {
      const a = i + (c & 1), b = j + ((c >> 1) & 1), e = k + ((c >> 2) & 1);
      const wt = (c & 1 ? u : 1 - u) * ((c >> 1) & 1 ? w : 1 - w) * ((c >> 2) & 1 ? q : 1 - q);
      g[0] += wt * (at(a + 1, b, e) - at(a - 1, b, e));
      g[1] += wt * (at(a, b + 1, e) - at(a, b - 1, e));
      g[2] += wt * (at(a, b, e + 1) - at(a, b, e - 1));
    }
    const m = Math.sqrt(g[0] * g[0] + g[1] * g[1] + g[2] * g[2]) || 1;
    return [g[0] / m, g[1] / m, g[2] / m];
  };
  const index: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, axis: number, inside: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // Wind so the face looks out of the body (along +axis when the start of the edge is inside).
    const flip = (axis === 1) !== inside;
    if (flip) index.push(a, b, c, a, c, d); else index.push(a, c, b, a, d, c);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const f0 = field[id(i, j, k)] < 0;
    if (f0 !== (field[id(i + 1, j, k)] < 0)) quad(cell[id(i, j - 1, k - 1)], cell[id(i, j, k - 1)], cell[id(i, j, k)], cell[id(i, j - 1, k)], 0, f0);
    if (f0 !== (field[id(i, j + 1, k)] < 0)) quad(cell[id(i - 1, j, k - 1)], cell[id(i, j, k - 1)], cell[id(i, j, k)], cell[id(i - 1, j, k)], 1, f0);
    if (f0 !== (field[id(i, j, k + 1)] < 0)) quad(cell[id(i - 1, j - 1, k)], cell[id(i, j - 1, k)], cell[id(i, j, k)], cell[id(i - 1, j, k)], 2, f0);
  }

  // Normals, skin weights (by how near each shape is) and what part each vertex belongs to.
  const count = pos.length / 3;
  const nor = new Float32Array(count * 3), si = new Uint16Array(count * 4), sw = new Float32Array(count * 4);
  const parts = new Uint8Array(count), side = new Int8Array(count);
  const perBone = new Float64Array(bones.length);
  for (let n = 0; n < count; n++) {
    const x = pos[n * 3], y = pos[n * 3 + 1], z = pos[n * 3 + 2];
    const g = grad(x, y, z);
    nor.set(g, n * 3);
    let best = 0, dmin = Infinity;
    shapes(x, y, z);
    for (let i = 0; i < prims.length; i++) if (v[i] < dmin) { dmin = v[i]; best = i; }
    parts[n] = PARTS.indexOf(prims[best].part);
    side[n] = prims[best].side;
    perBone.fill(0);
    for (let i = 0; i < prims.length; i++) if (v[i] - dmin < 0.06) perBone[prims[i].bone] += Math.exp(-(v[i] - dmin) / 0.0055);
    // The four bones with the most weight.
    const top = [-1, -1, -1, -1];
    for (let b = 0; b < perBone.length; b++) {
      if (!perBone[b]) continue;
      for (let c = 0; c < 4; c++) if (top[c] < 0 || perBone[b] > perBone[top[c]]) { top.splice(c, 0, b); top.length = 4; break; }
    }
    let sum = 0;
    for (const b of top) if (b >= 0) sum += perBone[b];
    top.forEach((b, c) => { si[n * 4 + c] = Math.max(0, b); sw[n * 4 + c] = b >= 0 ? perBone[b] / sum : 0; });
  }
  // The surface nets' faces can point either way round where the grid is ambiguous: turn each to face out.
  for (let f = 0; f < index.length; f += 3) {
    const [a, b, c] = [index[f], index[f + 1], index[f + 2]];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const wx = pos[c * 3] - pos[a * 3], wy = pos[c * 3 + 1] - pos[a * 3 + 1], wz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = uy * wz - uz * wy, fy = uz * wx - ux * wz, fz = ux * wy - uy * wx;
    if (fx * (nor[a * 3] + nor[b * 3] + nor[c * 3]) + fy * (nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1]) + fz * (nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2]) < 0) { index[f + 1] = c; index[f + 2] = b; }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geometry.setIndex(index);
  return { geometry, parts, side, headAt: W(head) };
}

/** Coat colours for every vertex: a pale belly, bib, muzzle and chin, tabby bands over the back and down the
 *  legs, the forehead "M" and cheek lines. */
function paint(b: Built, coat: string): Float32Array {
  const k = coatOf(coat);
  const B = new THREE.Color(k.base), D = new THREE.Color(k.dark), L = new THREE.Color(k.light);
  const pos = b.geometry.attributes.position.array as Float32Array, nor = b.geometry.attributes.normal.array as Float32Array;
  const out = new Float32Array(pos.length);
  const c = new THREE.Color();
  const st = k.stripes;
  for (let n = 0; n < b.parts.length; n++) {
    const x = pos[n * 3], y = pos[n * 3 + 1], z = pos[n * 3 + 2];
    const ny = nor[n * 3 + 1], nz = nor[n * 3 + 2], nx = nor[n * 3];
    const part = PARTS[b.parts[n]], s = b.side[n];
    c.copy(B);
    let light = 0, dark = 0;
    if (part === 'torso' || part === 'neck') {
      const belly = smooth(-0.35, -0.8, ny);
      const bib = smooth(0.3, 0.8, nz) * smooth(0.2, 0.15, y) * smooth(0.035, 0.015, Math.abs(x)) * (part === 'neck' ? 1 : smooth(0.1, 0.15, z));
      light = Math.max(belly, bib);
      const back = smooth(-0.4, 0.35, ny) * (1 - light);
      const band = part === 'neck'
        ? Math.sin(((y - b.headAt[1]) * 0.6 + (z - b.headAt[2]) * 0.8) * ((2 * Math.PI) / 0.028))
        : Math.sin(z * ((2 * Math.PI) / 0.052) + Math.sin(y * 70 + x * 35) * 0.7 + Math.sin(x * 60) * 0.35);
      dark = Math.max(smooth(0.3, 0.8, band) * back * 0.9, smooth(0.86, 0.97, ny) * smooth(0.012, 0.004, Math.abs(x)) * 0.7);
    } else if (part === 'leg') {
      const outside = smooth(-0.3, 0.5, nx * s + nz * 0.4);
      dark = smooth(0.35, 0.85, Math.sin(y * ((2 * Math.PI) / 0.034) + 1.1)) * outside * 0.8 * smooth(0.0, 0.05, y);
      light = smooth(0.2, -0.6, nx * s) * 0.25;
    } else if (part === 'paw') {
      light = st > 0.5 ? 0.25 : 0.9;
    } else {
      // Face, in the head's frame.
      const qx = x - b.headAt[0], qy = y - b.headAt[1], qz = z - b.headAt[2];
      // Pale muzzle and chin; the cheeks keep the coat colour.
      light = part === 'jaw' ? 1 : smooth(-0.006, -0.018, qy) * smooth(0.014, 0.034, qz) * smooth(0.03, 0.017, Math.abs(qx));
      if (st > 0.2) {
        const brow = smooth(0.0, 0.016, qy) * smooth(-0.012, 0.016, qz) * smooth(0.032, 0.02, Math.abs(qx));
        const m = Math.min(...[-0.015, -0.005, 0.005, 0.015].map((lx) => Math.abs(qx - lx)));
        const crown = smooth(0.0, -0.022, qz) * smooth(-0.004, 0.02, qy) * smooth(0.55, 0.9, Math.abs(Math.sin(qx * ((2 * Math.PI) / 0.018))));
        const cheek = smooth(0.03, 0.04, Math.abs(qx)) * smooth(0.0015, 0.0005, Math.min(Math.abs(qy + 0.003), Math.abs(qy + 0.011))) * smooth(-0.01, 0.01, qz);
        dark = Math.max(brow * smooth(0.0022, 0.0009, m), crown * 0.8, cheek * 0.9);
      }
    }
    c.lerp(L, light * 0.92);
    c.lerp(D, dark * st * 0.9);
    // Fur grain.
    const g = Math.sin(x * 1291.7 + y * 3117.3 + z * 2711.1) * 43758.5453;
    c.multiplyScalar(0.95 + 0.08 * (g - Math.floor(g)));
    out[n * 3] = c.r; out[n * 3 + 1] = c.g; out[n * 3 + 2] = c.b;
  }
  return out;
}

/** The body mesh for this rig and coat, bound to `bones` (the rig must be at rest, its matrices up to date). */
export function catBody(rig: Rig, bones: THREE.Bone[], coat: string): THREE.SkinnedMesh {
  cached ??= build(rig, bones);
  const geometry = cached.geometry.clone();
  geometry.setAttribute('color', new THREE.BufferAttribute(paint(cached, coat), 3));
  const k = coatOf(coat);
  const material = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.82, sheen: 0.7, sheenRoughness: 0.6, sheenColor: new THREE.Color(k.light).multiplyScalar(0.6) });
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.bind(new THREE.Skeleton(bones));
  return mesh;
}
