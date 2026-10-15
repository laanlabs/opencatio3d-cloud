// Catio Prowl tunnels: a tunnel run whose end meets the catio's cat flap becomes part of the world, a low
// mesh corridor the cat can run along. When its other end reaches a house window, the room behind the
// window is added and the planner's window riser (a mesh box with a step, up to the window insert) joins
// the two, so the cat goes window → riser → tunnel → cat flap → catio. Older plans with the insert at
// ground level have no riser; a game-only mesh chute stands in for it.
// Tunnel parts are in the tunnel's own coordinates (u, y, v), as the generator draws them.
import type { Catalog } from '../catalog/catalog';
import type { HostWall, Structure, StructureOpening, Vec2, Vec3 } from '../model/types';
import type { Part } from '../generate/parts';
import { toLocal, toPlan, wallDir, wallNormal } from '../model/geometry';
import { frameMaterial, meshMaterial } from '../generate/structure';
import type { Rect, Surface, Volume } from './world';

/** A cat flap the game draws (and swings as the cat pushes through) in place of the planner's kit box. */
export interface Flap { c: Vec3; along: Vec2; w: number; h: number }
export interface TunnelRun { id: string; label: string; ends: [Vec3, Vec3]; mid: Vec3; length: number; paved: boolean }

/** What a linked tunnel adds to the world. */
export interface TunnelLink {
  t: Structure;
  run: TunnelRun;
  volumes: Volume[];
  cameraVolumes: Volume[];
  surfaces: Surface[];
  flap: Flap;
  hidden: string[];
  /** The tunnel's other end: plan point, plan direction into the tunnel, and the same in tunnel coordinates. */
  far: { key: 'start' | 'end'; P: Vec2; e: Vec2; local: Vec2; eLocal: Vec2 };
}

/** The catio as the tunnel sees it. */
export interface CatioFrame { s: Structure; W: number; D: number; elev: number; floorY: number; margin: number; depth: number; parts: Part[] }

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec2, b: Vec2, k = 1): Vec2 => [a[0] + b[0] * k, a[1] + b[1] * k];
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const len = (a: Vec2) => Math.hypot(a[0], a[1]);
const unit = (a: Vec2): Vec2 => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const rectPoly = (c: Vec2, ax: Vec2, h0: number, h1: number): Vec2[] => {
  const az: Vec2 = [-ax[1], ax[0]];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [c[0] + ax[0] * h0 * i + az[0] * h1 * j, c[1] + ax[1] * h0 * i + az[1] * h1 * j] as Vec2);
};

/** The tunnel's path as the generator uses it (points closer than 5 cm merged), in tunnel coordinates. */
export function tunnelPath(t: Structure): Vec2[] {
  return (t.path ?? []).filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.05);
}

/** Every tunnel with an end at one of the catio's cat doors, as walkable volumes. */
export function linkTunnels(tunnels: Structure[], all: Part[], c: CatioFrame, cat: Catalog): TunnelLink[] {
  const out: TunnelLink[] = [];
  if (c.elev > 0.3) return out; // tunnels run along the ground
  const { s, W, D } = c;
  const r = (s.rotation * Math.PI) / 180;
  for (const t of tunnels) {
    if ((t.elevation ?? 0) > 0.05) continue;
    const loc = tunnelPath(t);
    if (loc.length < 2) continue;
    const P = loc.map((q) => toPlan(t, q[0], q[1]));
    const [fd, fw] = (frameMaterial(t, cat).actual ?? [0.038, 0.038]) as [number, number];
    const half = t.width / 2, hi = half - fd - 0.005, ceil = t.height - fw - 0.005;

    // Which end meets a cat door in the catio's wall.
    let join: { k: number; side: StructureOpening['side']; door: StructureOpening; along: number } | null = null;
    for (const k of [0, P.length - 1]) {
      const [u, v] = toLocal(s, P[k]);
      const sides: [StructureOpening['side'], number, number][] = [['back', Math.abs(v), u], ['front', Math.abs(v - D), u], ['left', Math.abs(u), v], ['right', Math.abs(u - W), v]];
      for (const [side, off, along] of sides) {
        const span = side === 'back' || side === 'front' ? W : D;
        if (off > 0.35 || along < -0.1 || along > span + 0.1) continue;
        const door = s.openings
          .filter((o) => o.kind === 'cat-door' && o.side === side && c.parts.some((x) => x.ownerId === o.id && x.role === 'cat-door'))
          .sort((a, b) => Math.abs(a.offset + a.width / 2 - along) - Math.abs(b.offset + b.width / 2 - along))[0];
        if (door && Math.abs(door.offset + door.width / 2 - along) <= 0.35) { join = { k, side, door, along }; break; }
      }
      if (join) break;
    }
    if (!join) continue;

    const volumes: Volume[] = [];
    const cameraVolumes: Volume[] = [];
    const surfaces: Surface[] = [];
    const tag = `tunnel:${t.id}`;
    // Segments: the corridor between the hoops (inside the posts, under the top bars).
    let length = 0;
    for (let i = 0; i < P.length - 1; i++) {
      const A = P[i], Z = P[i + 1];
      const L = len(sub(Z, A));
      const e = unit(sub(Z, A));
      const mid: Vec2 = [(A[0] + Z[0]) / 2, (A[1] + Z[1]) / 2];
      volumes.push({ id: `${tag}:seg${i}`, region: 'tunnel', poly: rectPoly(mid, e, L / 2, hi), y0: 0, ceil: [ceil, 0, 0] });
      cameraVolumes.push({ id: `${tag}:seg${i}:view`, region: 'tunnel', poly: rectPoly(mid, e, L / 2, half + 1.1), y0: 0, ceil: [1.8, 0, 0] });
      surfaces.push({ id: `${tag}:seg${i}`, kind: 'floor', label: 'the tunnel', region: 'tunnel', c: mid, h: [L / 2, half - fd], yaw: Math.atan2(e[1], e[0]), top: 0, bottom: -0.05, solid: false });
      length += L;
      // Bends: a round joint (the generator's corner wedges close the outside of the bend).
      if (i > 0) {
        volumes.push({ id: `${tag}:joint${i}`, region: 'tunnel', poly: Array.from({ length: 12 }, (_, j) => [A[0] + Math.cos((j / 12) * Math.PI * 2) * hi, A[1] + Math.sin((j / 12) * Math.PI * 2) * hi] as Vec2), y0: 0, ceil: [ceil, 0, 0] });
        surfaces.push({ id: `${tag}:joint${i}`, kind: 'floor', label: 'the tunnel', region: 'tunnel', c: A, h: [hi, hi], yaw: Math.atan2(e[1], e[0]), top: 0, bottom: -0.05, solid: false });
      }
    }

    // The cat flap: a passage through the catio wall, a threshold at the flap's sill, and the flap itself.
    const { side, door } = join;
    const tc = door.offset + door.width / 2;
    const toLoc = (along: number, q: number): Vec2 => (side === 'back' ? [along, q] : side === 'front' ? [along, D - q] : side === 'left' ? [q, along] : [W - q, along]);
    const at = (along: number, q: number) => { const l = toLoc(along, q); return toPlan(s, l[0], l[1]); };
    const alongDir: Vec2 = side === 'back' || side === 'front' ? [Math.cos(r), Math.sin(r)] : [-Math.sin(r), Math.cos(r)];
    const pw = Math.max(door.width / 2, Math.min(hi, 0.2)); // as wide as the tunnel: the flap gives as the cat squeezes through
    const q0 = -0.35, q1 = c.margin + 0.25;
    const sill = c.elev + (door.sill ?? 0);
    volumes.push({ id: `${tag}:flap`, region: 'tunnel', poly: [at(tc - pw, q0), at(tc + pw, q0), at(tc + pw, q1), at(tc - pw, q1)], y0: Math.min(c.floorY, 0) - 0.02, ceil: [sill + door.height, 0, 0] });
    if ((door.sill ?? 0) > 0.02) {
      const qa = -0.03, qb = c.depth + 0.03;
      const rect: Rect = { c: at(tc, (qa + qb) / 2), h: [door.width / 2 + 0.01, (qb - qa) / 2], yaw: Math.atan2(alongDir[1], alongDir[0]) };
      surfaces.push({ id: `${tag}:flap-sill`, kind: 'sill', label: 'the cat flap', region: 'tunnel', ...rect, top: sill, bottom: c.elev, solid: true });
    }
    const fc = at(tc, c.depth / 2);
    const flap: Flap = { c: [fc[0], sill, fc[1]], along: alongDir, w: door.width, h: door.height };
    const hidden = c.parts.filter((x) => x.ownerId === door.id && x.role === 'cat-door').map((x) => x.id);

    const kf = join.k === 0 ? P.length - 1 : 0;
    const kn = kf === 0 ? 1 : P.length - 2;
    // The halfway point along the path (for a toy mouse and the camera).
    let left = length / 2, midP: Vec2 = P[0];
    for (let i = 0; i < P.length - 1; i++) {
      const L = len(sub(P[i + 1], P[i]));
      if (left <= L) { midP = add(P[i], unit(sub(P[i + 1], P[i])), left); break; }
      left -= L;
    }
    out.push({
      t,
      run: { id: t.id, label: t.name || 'the tunnel', ends: [[P[join.k][0], 0, P[join.k][1]], [P[kf][0], 0, P[kf][1]]], mid: [midP[0], 0, midP[1]], length, paved: t.base?.kind === 'pavers' },
      volumes, cameraVolumes, surfaces, flap, hidden,
      far: { key: kf === 0 ? 'start' : 'end', P: P[kf], e: unit(sub(P[kn], P[kf])), local: loc[kf], eLocal: unit(sub(loc[kn], loc[kf])) }
    });
  }
  return out;
}

/** The house window a tunnel end reaches (within 0.3 m, as the planner's entrance check). */
export function windowAt(walls: HostWall[], P: Vec2): { wall: HostWall; gate: HostWall['openings'][number] } | null {
  let best: { wall: HostWall; gate: HostWall['openings'][number]; d: number } | null = null;
  for (const wall of walls) {
    const d = wallDir(wall), n = wallNormal(wall);
    const rel = sub(P, wall.a);
    const A = dot(rel, d), O = dot(rel, n);
    if (Math.abs(O) > 0.35) continue;
    for (const o of wall.openings) {
      if (o.kind !== 'window' || A < o.offset - 0.3 || A > o.offset + o.width + 0.3) continue;
      const dd = Math.abs(O) + Math.max(0, o.offset - A, A - o.offset - o.width);
      if (!best || dd < best.d) best = { wall, gate: o, d: dd };
    }
  }
  return best;
}

/** The planner's window riser at the tunnel's far end (`riser-<end>:*` parts), as the game sees it: the room
 *  inside, its floor and step, and the camera's room. The window insert gives way to the open window. */
export function windowRiser(link: TunnelLink, all: Part[], cat: Catalog) {
  const { t, far } = link;
  const k = `riser-${far.key}:`;
  const parts = all.filter((x) => x.structureId === t.id && x.key.startsWith(k));
  if (!parts.length) return null;
  const [fd, fw] = (frameMaterial(t, cat).actual ?? [0.038, 0.038]) as [number, number];
  const W = t.width, half = W / 2;
  const Hr = Math.max(...parts.flatMap((x) => (x.geom?.type === 'quad' ? x.geom.p.map((q) => q[1]) : [0])));
  const yaw = Math.atan2(far.e[1], far.e[0]);
  const c = add(far.P, far.e, W / 2);
  const inner = half - fd - 0.005;
  const volume: Volume = { id: 'chute', region: 'tunnel', poly: rectPoly(c, far.e, W / 2, inner), y0: 0, ceil: [Hr - fw - 0.005, 0, 0] };
  const cameraVolume: Volume = { id: 'chute-view', region: 'tunnel', poly: rectPoly(add(far.P, far.e, (W + 1.2) / 2), far.e, (W + 1.2) / 2, half + 0.8), y0: 0, ceil: [Hr + 0.6, 0, 0] };
  const floor: Surface = { id: 'chute-floor', kind: 'floor', label: 'the bottom of the window riser', region: 'tunnel', c, h: [W / 2, half - fd], yaw, top: 0, bottom: -0.05, solid: false };
  const surfaces: Surface[] = [floor];
  const step = parts.find((x) => x.key === `${k}step`);
  if (step?.geom?.type === 'bar') {
    const g = step.geom;
    const A = toPlan(t, g.a[0], g.a[2]), B = toPlan(t, g.b[0], g.b[2]);
    const thick = Math.min(...g.size), wide = Math.max(...g.size);
    const top = g.a[1] + thick / 2;
    surfaces.push({ id: 'riser-step', kind: 'shelf', label: 'the step in the window riser', region: 'tunnel', c: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], h: [len(sub(B, A)) / 2, wide / 2], yaw: Math.atan2(B[1] - A[1], B[0] - A[0]), top, bottom: top - thick, solid: false });
  }
  const side = far.key === 'start' ? 'back' : 'front';
  const hidden = all.filter((x) => x.structureId === t.id && x.role === 'window-insert' && x.key.startsWith(`${side}:`)).map((x) => x.id);
  return { volume, cameraVolume, surfaces, hidden, centre: c, inner };
}

/** The mesh chute from a house window down into the tunnel: volume, floor, the camera's room, and its parts
 *  (drawn with the tunnel). Tunnel parts inside the chute are hidden or cut back to its face. */
export function windowChute(link: TunnelLink, wall: HostWall, gate: HostWall['openings'][number], all: Part[], cat: Catalog) {
  const { t, far } = link;
  const d = wallDir(wall), n = wallNormal(wall);
  const AO = (A: number, O: number): Vec2 => [wall.a[0] + d[0] * A + n[0] * O, wall.a[1] + d[1] * A + n[1] * O];
  const rel = sub(far.P, wall.a);
  const Af = dot(rel, d), Of = dot(rel, n);
  const half = t.width / 2;
  const c0 = Math.min(gate.offset, Af - half) - 0.02, c1 = Math.max(gate.offset + gate.width, Af + half) + 0.02;
  const Dc = Math.max(0.6, Of + 0.35);
  const Htop = Math.min(wall.height - 0.05, gate.sill + gate.height + 0.08);
  const yawAlong = Math.atan2(d[1], d[0]);
  const volume: Volume = { id: 'chute', region: 'tunnel', poly: [AO(c0 + 0.03, 0), AO(c1 - 0.03, 0), AO(c1 - 0.03, Dc - 0.03), AO(c0 + 0.03, Dc - 0.03)], y0: 0, ceil: [Htop - 0.03, 0, 0] };
  const cameraVolume: Volume = { id: 'chute-view', region: 'tunnel', poly: [AO(c0 - 0.8, 0), AO(c1 + 0.8, 0), AO(c1 + 0.8, Dc + 1.2), AO(c0 - 0.8, Dc + 1.2)], y0: 0, ceil: [Htop + 0.6, 0, 0] };
  const floor: Surface = { id: 'chute-floor', kind: 'floor', label: 'the bottom of the window chute', region: 'tunnel', c: AO((c0 + c1) / 2, Dc / 2), h: [(c1 - c0) / 2, Dc / 2], yaw: yawAlong, top: 0, bottom: -0.05, solid: false };

  // Where the tunnel leaves the chute: through its outer face or one of its sides.
  const ea = dot(far.e, d), eo = dot(far.e, n);
  const hits: [number, 'outer' | 'c0' | 'c1'][] = [];
  if (eo > 1e-6) hits.push([(Dc - Of) / eo, 'outer']);
  if (ea > 1e-6) hits.push([(c1 - Af) / ea, 'c1']);
  if (ea < -1e-6) hits.push([(c0 - Af) / ea, 'c0']);
  const [sIn, face] = hits.filter((h) => h[0] > 0).sort((a, b) => a[0] - b[0])[0] ?? [Dc, 'outer'];
  const cross = face === 'outer' ? Af + ea * sIn : Of + eo * sIn;
  const hw = half / Math.max(0.35, Math.abs(face === 'outer' ? eo : ea));

  // Parts, in tunnel coordinates.
  const mesh = meshMaterial(t, cat), frame = frameMaterial(t, cat);
  const size = (frame.actual ?? [0.038, 0.038]) as [number, number];
  const L3 = (q: Vec2, y: number): Vec3 => { const l = toLocal(t, q); return [l[0], y, l[1]]; };
  const parts: Part[] = [];
  const base = { structureId: t.id, qty: 1 } as const;
  const panel = (key: string, p: [Vec3, Vec3, Vec3, Vec3], w: number, h: number) =>
    parts.push({ ...base, id: `${t.id}:prowl:${key}`, key: `prowl:${key}`, kind: 'panel', role: 'mesh-tunnel', materialId: mesh.id, step: 'mesh', width: w, height: h, geom: { type: 'quad', p } } as Part);
  const wallPanel = (key: string, a: Vec2, b: Vec2, y0: number, y1: number) => { if (len(sub(b, a)) > 0.02 && y1 - y0 > 0.02) panel(key, [L3(a, y0), L3(b, y0), L3(b, y1), L3(a, y1)], len(sub(b, a)), y1 - y0); };
  const H = t.height;
  // A face from (s0) to (s1) along it, with the tunnel's hole when it leaves through this face.
  const faceOf = (key: string, pt: (s: number) => Vec2, s0: number, s1: number, holed: boolean) => {
    if (!holed) return wallPanel(key, pt(s0), pt(s1), 0, Htop);
    wallPanel(`${key}:a`, pt(s0), pt(Math.max(s0, cross - hw)), 0, H);
    wallPanel(`${key}:b`, pt(Math.min(s1, cross + hw)), pt(s1), 0, H);
    wallPanel(`${key}:top`, pt(s0), pt(s1), H, Htop);
  };
  faceOf('chute:outer', (s) => AO(s, Dc), c0, c1, face === 'outer');
  faceOf('chute:c0', (s) => AO(c0, s), 0, Dc, face === 'c0');
  faceOf('chute:c1', (s) => AO(c1, s), 0, Dc, face === 'c1');
  panel('chute:top', [L3(AO(c0, 0), Htop), L3(AO(c1, 0), Htop), L3(AO(c1, Dc), Htop), L3(AO(c0, Dc), Htop)], c1 - c0, Dc);
  const bar = (key: string, a: Vec3, b: Vec3) => parts.push({ ...base, id: `${t.id}:prowl:${key}`, key: `prowl:${key}`, kind: 'member', role: 'hoop-post', materialId: frame.id, step: 'walls', geom: { type: 'bar', a, b, size } } as Part);
  const inset = size[0] / 2;
  for (const [k, A, O] of [['p0', c0 + inset, Dc - inset], ['p1', c1 - inset, Dc - inset], ['p2', c0 + inset, inset], ['p3', c1 - inset, inset]] as const) bar(`chute:${k}`, L3(AO(A, O), 0), L3(AO(A, O), Htop - size[1]));
  for (const [k, a, b] of [['r0', AO(c0, Dc - inset), AO(c1, Dc - inset)], ['r1', AO(c0 + inset, 0), AO(c0 + inset, Dc)], ['r2', AO(c1 - inset, 0), AO(c1 - inset, Dc)]] as const) bar(`chute:${k}`, L3(a, Htop - size[1] / 2), L3(b, Htop - size[1] / 2));

  // The tunnel inside the chute: hidden where it is wholly inside, cut back to the chute's face where it crosses.
  const hidden: string[] = [];
  const sOf = (q: Vec3) => (q[0] - far.local[0]) * far.eLocal[0] + (q[2] - far.local[1]) * far.eLocal[1];
  const latOf = (q: Vec3) => Math.abs(-(q[0] - far.local[0]) * far.eLocal[1] + (q[2] - far.local[1]) * far.eLocal[0]);
  for (const x of all) {
    if (x.structureId !== t.id || !x.geom) continue;
    const g = x.geom;
    const pts: Vec3[] = g.type === 'bar' ? [g.a, g.b] : g.type === 'quad' ? g.p : [g.c];
    if (pts.some((q) => latOf(q) > half + 0.05)) continue;
    const ss = pts.map(sOf);
    const lo = Math.min(...ss), hiS = Math.max(...ss);
    if (lo < -0.05) continue;
    if (hiS <= sIn + 0.01) { hidden.push(x.id); continue; }
    if (lo >= sIn - 0.01 || g.type === 'box') continue;
    const move = (q: Vec3): Vec3 => { const s0 = sOf(q); return s0 >= sIn ? q : [q[0] + far.eLocal[0] * (sIn - s0), q[1], q[2] + far.eLocal[1] * (sIn - s0)]; };
    hidden.push(x.id);
    const cut = hiS - Math.max(lo, sIn);
    const geom = g.type === 'bar' ? { ...g, a: move(g.a), b: move(g.b) } : { type: 'quad' as const, p: g.p.map(move) as [Vec3, Vec3, Vec3, Vec3] };
    parts.push({ ...x, id: `${x.id}:cut`, key: `${x.key}:cut`, geom, ...(x.width ? { width: (x.width * cut) / (hiS - lo) } : {}) });
  }
  return { volume, cameraVolume, floor, parts, hidden };
}
