// Catio Prowl's world: what a cat can stand on and where it may go, built from a planner project.
// The catio comes from the generator's own parts (so shelves, ramps, beds and posts are exactly where the
// 3D view draws them); when the catio is attached over a window, a furnished room is added behind that
// house wall and the open window joins the two. A tunnel run from a house window to the catio's cat flap
// works the same way (see tunnel.ts). The cat is kept inside "volumes" (the room, the window passage, any
// tunnel and the catio's inside), so it can never reach the yard: that is what a catio is for.
// World: plan x → X, plan y → Z, y up (as the planner's 3D view).
import type { Catalog } from '../catalog/catalog';
import type { HostWall, Project, Structure, Vec2, Vec3 } from '../model/types';
import { frontHeight } from '../model/types';
import type { Assembly } from '../generate/assembly';
import type { Part } from '../generate/parts';
import { rad, toPlan, wallDir, wallNormal } from '../model/geometry';
import { frameMaterial, layoutFor } from '../generate/structure';
import { mainStructure } from '../quest/design';
import { type Flap, type TunnelRun, linkTunnels, windowAt, windowChute, windowRiser } from './tunnel';

export type Region = 'home' | 'catio' | 'tunnel';
export type SurfaceKind = 'floor' | 'sill' | 'furniture' | 'shelf' | 'ramp' | 'bridge' | 'hammock' | 'bed' | 'kit' | 'post';

/** An oriented box: centre (x, z), half extents along its local axes, yaw (local x = (cos yaw, sin yaw)). */
export interface Rect { c: Vec2; h: Vec2; yaw: number }

export interface Surface extends Rect {
  id: string;
  kind: SurfaceKind;
  label: string;
  region: Region;
  /** Height of the top; for a ramp, the top at the local +x end. */
  top: number;
  /** Ramp: height at the local −x end. */
  low?: number;
  bottom: number;
  /** Solid furniture blocks a cat below its top; ledges (shelves, tables, hammocks) only carry it. */
  solid: boolean;
  /** Indoor furniture is drawn from the surface (the catio is drawn from the generator's parts). */
  color?: string;
}

/** A vertical prism the cat may occupy: convex polygon, floor height and a (possibly sloping) ceiling plane. */
export interface Volume { id: string; region: Region; poly: Vec2[]; y0: number; ceil: [number, number, number] }

export type SpotKind = 'scratch' | 'sofa' | 'drink' | 'eat' | 'plant' | 'nap';
export interface Spot { id: string; kind: SpotKind; label: string; p: Vec3; r: number; region: Region; plantIds?: string[]; area?: Rect; sunny?: boolean }

export type ItemShape = 'mug' | 'glass' | 'book' | 'pot' | 'box' | 'remote' | 'vase';
export interface Item { id: string; label: string; shape: ItemShape; color: string; p: Vec3; size: Vec3 }
export interface Toy { id: string; p: Vec3; where: string }
/** Things drawn in the room that the game ignores (or that stand in a solid surface of the same id). */
export interface Decor { kind: 'lamp' | 'plant' | 'picture' | 'curtain' | 'pendant' | 'clock'; p: Vec3; yaw: number; w?: number; h?: number; variant?: number }

/** A wall to draw: the face line from `a` along `dir` for `length`; the body is `thickness` deep toward `-normal`.
 *  The host wall's normal points outdoors (its body is indoors); the room walls' normals point into the room. Holes are in wall coordinates. */
export interface WallSpec { id: string; a: Vec2; dir: Vec2; normal: Vec2; length: number; height: number; thickness: number; holes: { a0: number; a1: number; y0: number; y1: number }[]; host: boolean }

export interface World {
  id: string;
  name: string;
  /** A furnished room joined to the catio through the open window. */
  home: boolean;
  surfaces: Surface[];
  volumes: Volume[];
  /** Where the camera may float: the volumes, with the catio widened past its (see-through) mesh walls. */
  cameraVolumes: Volume[];
  spots: Spot[];
  items: Item[];
  toys: Toy[];
  walls: WallSpec[];
  /** Room floor rectangle (drawn as a wooden floor). */
  room?: Rect & { height: number };
  sunbeams: Rect[];
  decor: Decor[];
  /** The room's extent along the host wall (including its side walls) and its depth behind it. */
  roomSpan?: { a0: number; a1: number; depth: number };
  /** Tunnel runs the cat can use, the cat flaps it pushes through, and planner parts the game replaces or adds. */
  tunnels: TunnelRun[];
  flaps: Flap[];
  hiddenParts: string[];
  extraParts: Part[];
  start: { p: Vec3; heading: number };
  catio: { structureId: string; volumeId: string; floor: number; perchTop: number; perchId: string | null; birdPerch: Vec3; centre: Vec3; elevated: boolean };
  sillId: string | null;
  hostWallId: string | null;
  gatewayOpeningId: string | null;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const ROOM_W = 6.4, ROOM_D = 5, WALL_T = 0.2;

export function buildWorld(p: Project, a: Assembly, cat: Catalog): World | null {
  const s = mainStructure(p);
  if (!s || s.template === 'tunnel') return null;
  const surfaces: Surface[] = [];
  const volumes: Volume[] = [];
  const spots: Spot[] = [];
  const items: Item[] = [];
  const toys: Toy[] = [];
  const walls: WallSpec[] = [];
  const sunbeams: Rect[] = [];
  const decor: Decor[] = [];
  const flaps: Flap[] = [];
  const hiddenParts: string[] = [];
  const extraParts: Part[] = [];
  const tunnelCams: Volume[] = [];
  let roomSpan: World['roomSpan'];

  // ---------- the catio ----------
  const r = rad(s.rotation);
  const elev = s.elevation ?? 0;
  const W = s.width, D = s.depth;
  const Hb = s.height, Hf = frontHeight(s);
  const parts = a.parts.filter((x) => x.structureId === s.id);
  const floorSheet = parts.find((x) => x.role === 'floor-sheet');
  const floorY = r3(elev + (floorSheet ? 0.015 : 0));
  const local = (u: number, v: number): Vec2 => toPlan(s, u, v);
  const fm = frameMaterial(s, cat);
  const margin = Math.max(...(fm.actual ?? [0.038, 0.064])) + 0.01;
  const layout = layoutFor(s.template);
  const openBack = layout.houseBack && !layout.framed.includes('back');
  const v0 = openBack ? 0 : margin, v1 = D - margin;
  // Ceiling: the roof slopes from Hb at the back (v = 0) to Hf at the front; keep clear of rafters.
  const k = (Hf - Hb) / D;
  const ceilA = elev + Hb - 0.06 + k * (s.x * Math.sin(r) - s.y * Math.cos(r));
  const catioVol: Volume = { id: 'catio', region: 'catio', poly: [local(margin, v0), local(W - margin, v0), local(W - margin, v1), local(margin, v1)], y0: floorY, ceil: [ceilA, -k * Math.sin(r), k * Math.cos(r)] };
  volumes.push(catioVol);
  const rectLocal = (u0: number, u1: number, w0: number, w1: number): Rect => ({ c: local((u0 + u1) / 2, (w0 + w1) / 2), h: [(u1 - u0) / 2, (w1 - w0) / 2], yaw: r });
  surfaces.push({ id: 'catio-floor', kind: 'floor', label: 'the catio floor', region: 'catio', ...rectLocal(0, W, 0, D), top: floorY, bottom: floorY - 0.05, solid: false });

  const furnLabel = (role: string) =>
    ({ 'shelf-board': 'a shelf', 'bridge-board': 'the bridge', 'ramp-board': 'the ramp', bed: 'the cat bed', hammock: 'the hammock', cubby: 'the hideaway cube', 'litter-annex': 'the litter annex', 'water-station': 'the water station', 'planter-small': 'a planter', 'planter-large': 'a planter', 'scratch-post': 'the scratching post' } as Record<string, string>)[role] ?? 'a perch';
  const owned = new Set(s.furnishings.map((f) => f.id));
  for (const pt of parts) {
    if (!pt.ownerId || !owned.has(pt.ownerId) || !pt.geom) continue;
    const g = pt.geom;
    const id = `f:${pt.id}`;
    if (g.type === 'bar') {
      const [ua, ya, wa] = g.a, [ub, yb, wb] = g.b;
      const A = local(ua, wa), B = local(ub, wb);
      const run = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const thick = Math.min(...g.size), wide = Math.max(...g.size);
      if (pt.role === 'scratch-post') {
        surfaces.push({ id, kind: 'post', label: furnLabel(pt.role), region: 'catio', c: A, h: [thick / 2, thick / 2], yaw: r, top: r3(elev + Math.max(ya, yb)), bottom: elev, solid: true });
        spots.push({ id: `scratch:${pt.id}`, kind: 'scratch', label: 'the scratching post', p: [A[0], floorY, A[1]], r: 0.38, region: 'catio' });
        continue;
      }
      if (pt.role !== 'shelf-board' && pt.role !== 'bridge-board' && pt.role !== 'ramp-board') continue;
      if (run < 0.05) continue;
      const yaw = Math.atan2(B[1] - A[1], B[0] - A[0]);
      const c: Vec2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      if (pt.role === 'ramp-board') {
        const lo = Math.min(ya, yb) === ya;
        surfaces.push({ id, kind: 'ramp', label: furnLabel(pt.role), region: 'catio', c, h: [run / 2, wide / 2], yaw: lo ? yaw : yaw + Math.PI, low: r3(elev + Math.min(ya, yb) + thick / 2), top: r3(elev + Math.max(ya, yb) + thick / 2), bottom: elev, solid: false });
      } else {
        const top = r3(elev + ya + thick / 2);
        surfaces.push({ id, kind: pt.role === 'bridge-board' ? 'bridge' : 'shelf', label: furnLabel(pt.role), region: 'catio', c, h: [run / 2, wide / 2], yaw, top, bottom: top - thick, solid: false });
      }
    } else if (g.type === 'box') {
      const [cu, cy, cv] = g.c, [su, sy, sv] = g.s;
      const top = r3(elev + cy + sy / 2);
      const hammock = pt.role === 'hammock';
      const kind: SurfaceKind = pt.role === 'bed' ? 'bed' : hammock ? 'hammock' : 'kit';
      surfaces.push({ id, kind, label: furnLabel(pt.role), region: 'catio', c: local(cu, cv), h: [su / 2, sv / 2], yaw: r, top, bottom: r3(elev + cy - sy / 2), solid: !hammock });
      const at = local(cu, cv);
      if (pt.role === 'bed' || hammock) spots.push({ id: `nap:${pt.id}`, kind: 'nap', label: furnLabel(pt.role), p: [at[0], top, at[1]], r: Math.max(su, sv) / 2 + 0.05, region: 'catio' });
      if (pt.role === 'water-station') spots.push({ id: `drink:${pt.id}`, kind: 'drink', label: 'the water station', p: [at[0], floorY, at[1]], r: 0.42, region: 'catio' });
      if (pt.role.startsWith('planter')) {
        const plantIds = p.plants.filter((x) => x.furnishingId === pt.ownerId).map((x) => x.plantId).filter((id) => cat.plant(id));
        const names = plantIds.map((id) => cat.plant(id)!.name.toLowerCase());
        if (plantIds.length) spots.push({ id: `plant:${pt.id}`, kind: 'plant', label: names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`, p: [at[0], floorY, at[1]], r: Math.max(su, sv) / 2 + 0.3, region: 'catio', plantIds });
      }
    }
  }

  // Sun in the catio: the part of the floor no solid roof covers (a partial roof covers the back).
  const roof = s.roof?.kind ?? 'mesh';
  const covered = roof === 'corrugated' ? 1 : roof === 'partial' && (s.roof.materialId ?? '').includes('steel') ? (s.roof.coverFraction ?? 0.5) : roof === 'partial' ? (s.roof.coverFraction ?? 0.5) * 0.5 : 0;
  if (covered < 1) {
    const w0 = Math.max(v0, D * covered), w1 = v1;
    if (w1 - w0 > 0.25) {
      const area = rectLocal(margin, W - margin, w0, w1);
      sunbeams.push(area);
      const ac = area.c;
      spots.push({ id: 'nap:catio-sun', kind: 'nap', label: 'a sunny spot in the catio', p: [ac[0], floorY, ac[1]], r: 0, area, region: 'catio', sunny: true });
    }
  }

  const perches = surfaces.filter((x) => x.region === 'catio' && x.kind !== 'floor' && x.kind !== 'post' && x.top >= floorY + 0.3);
  const perch = perches.reduce<Surface | null>((b, x) => (!b || x.top > b.top ? x : b), null);
  const centreXZ = local(W / 2, D / 2);
  const bp = local(W / 2, D + 0.7);
  const catio: World['catio'] = {
    structureId: s.id, volumeId: catioVol.id, floor: floorY, perchTop: perch?.top ?? floorY, perchId: perch?.id ?? null,
    birdPerch: [bp[0], elev + Math.min(Math.max(Hf, 1.2), 1.8), bp[1]], centre: [centreXZ[0], floorY, centreXZ[1]], elevated: elev > 0.3
  };

  // ---------- tunnels to the catio's cat flaps ----------
  const links = linkTunnels(p.structures.filter((x) => x.template === 'tunnel'), a.parts, { s, W, D, elev, floorY, margin, depth: fm.actual?.[0] ?? 0.038, parts }, cat);
  for (const l of links) {
    volumes.push(...l.volumes);
    surfaces.push(...l.surfaces);
    tunnelCams.push(...l.cameraVolumes);
    flaps.push(l.flap);
    hiddenParts.push(...l.hidden);
  }

  // ---------- the home behind the window ----------
  let wall = s.hostWallId ? p.site.walls.find((w) => w.id === s.hostWallId) : undefined;
  const access = s.openings.find((o) => o.kind === 'window-access');
  let gate = wall && access ? wall.openings.find((o) => o.id === s.hostOpeningId) ?? nearestWindow(wall, s) : undefined;
  // No window into the catio itself: a tunnel whose far end reaches a house window leads home instead.
  let via: { link: (typeof links)[number] } | null = null;
  if (!(wall && gate && layout.houseBack)) {
    for (const link of links) {
      const w = windowAt(p.site.walls, link.far.P);
      if (w) { via = { link }; wall = w.wall; gate = w.gate; break; }
    }
  }
  let home = false;
  let sillId: string | null = null;
  let start: World['start'];
  let room: World['room'];

  if (wall && gate && (layout.houseBack || via)) {
    home = true;
    const d = wallDir(wall), n = wallNormal(wall), m: Vec2 = [-n[0], -n[1]];
    const L = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    const H = wall.height;
    const wyaw = Math.atan2(d[1], d[0]);
    const WP = (A: number, B: number): Vec2 => [wall.a[0] + d[0] * A + m[0] * B, wall.a[1] + d[1] * A + m[1] * B];
    const RW = Math.min(ROOM_W, Math.max(4.6, L));
    const gc = gate.offset + gate.width / 2;
    const A0 = Math.max(Math.min(gc - RW / 2, Math.max(0, L - RW)), Math.min(0, L - RW));
    const RD = ROOM_D;
    const B0 = WALL_T;
    // Room coordinates: X along the wall from A0, Y into the room from the wall's inner face.
    const wx = gc - A0, gw = gate.width;
    const flip = wx < RW / 2; // keep the furniture on the side with more space
    const X = (x: number) => (flip ? RW - x : x);
    const rr = (x0: number, x1: number, y0: number, y1: number): Rect => {
      const xa = Math.min(X(x0), X(x1)), xb = Math.max(X(x0), X(x1));
      return { c: WP(A0 + (xa + xb) / 2, B0 + (y0 + y1) / 2), h: [(xb - xa) / 2, (y1 - y0) / 2], yaw: wyaw };
    };
    const at = (x: number, y: number, h: number): Vec3 => { const q = WP(A0 + X(x), B0 + y); return [q[0], h, q[1]]; };
    const box = (id: string, label: string, x0: number, x1: number, y0: number, y1: number, top: number, color: string, solid = true, kind: SurfaceKind = 'furniture', bottom = 0) =>
      surfaces.push({ id, kind, label, region: 'home', ...rr(x0, x1, y0, y1), top, bottom: solid ? bottom : top - 0.04, solid, color });
    const wwx = flip ? RW - wx : wx; // window centre in layout coordinates (always right of centre)

    room = { ...rr(0, RW, 0, RD), height: H };
    volumes.push({ id: 'room', region: 'home', poly: corners(rr(0, RW, 0, RD)), y0: 0, ceil: [H, 0, 0] });
    surfaces.push({ id: 'room-floor', kind: 'floor', label: 'the living-room floor', region: 'home', ...rr(0, RW, 0, RD), top: 0, bottom: -0.05, solid: false });

    // Through a tunnel: the planner's riser climbs from the tunnel to the window (older plans: a game chute).
    const riser = via ? windowRiser(via.link, a.parts, cat) : null;
    // The open window: a passage through the wall from the sill up (no wider than the riser), and sills on both sides.
    const sill = gate.sill;
    let pa0 = gate.offset + 0.02, pa1 = gate.offset + gate.width - 0.02;
    let la0 = gate.offset - 0.04, la1 = gate.offset + gate.width + 0.04;
    const ledge = riser ? 0.05 : 0.24; // over a riser, just the lip: the riser's step sits under the window
    if (riser) {
      const ra = (riser.centre[0] - wall.a[0]) * d[0] + (riser.centre[1] - wall.a[1]) * d[1];
      pa0 = Math.max(pa0, ra - riser.inner); pa1 = Math.min(pa1, ra + riser.inner);
      la0 = Math.max(la0, ra - riser.inner); la1 = Math.min(la1, ra + riser.inner);
    }
    const passage = (B0p: number, B1p: number) => [WP(pa0, B0p), WP(pa1, B0p), WP(pa1, B1p), WP(pa0, B1p)];
    volumes.push({ id: 'window', region: 'home', poly: passage(-((via ? 0 : margin) + 0.25), B0 + 0.3), y0: Math.min(sill, via ? 0 : floorY) - 0.02, ceil: [sill + gate.height, 0, 0] });
    const sillRect = (B0s: number, B1s: number): Rect => ({ c: WP((gate.offset + gate.offset + gate.width) / 2, (B0s + B1s) / 2), h: [gate.width / 2 + 0.04, (B1s - B0s) / 2], yaw: wyaw });
    sillId = 'sill';
    surfaces.push({ id: 'sill', kind: 'sill', label: 'the window sill', region: 'home', ...sillRect(0, B0 + 0.16), top: sill, bottom: 0, solid: true, color: '#f4efe6' });
    if (sill > (via ? 0 : floorY) + 0.05) surfaces.push({ id: 'sill-out', kind: 'sill', label: 'the window ledge', region: via ? 'tunnel' : 'catio', c: WP((la0 + la1) / 2, -ledge / 2), h: [(la1 - la0) / 2, ledge / 2], yaw: wyaw, top: sill, bottom: sill - 0.04, solid: false });
    if (riser) {
      volumes.push(riser.volume);
      surfaces.push(...riser.surfaces);
      tunnelCams.push(riser.cameraVolume);
      hiddenParts.push(...riser.hidden);
    } else if (via) {
      const ch = windowChute(via.link, wall, gate, a.parts, cat);
      volumes.push(ch.volume);
      surfaces.push(ch.floor);
      tunnelCams.push(ch.cameraVolume);
      extraParts.push(...ch.parts);
      hiddenParts.push(...ch.hidden);
    }

    // House walls: the host wall with the open window, and the room's other three walls.
    const holes = [{ a0: gate.offset, a1: gate.offset + gate.width, y0: sill, y1: sill + gate.height }];
    walls.push({ id: 'host', a: wall.a, dir: d, normal: n, length: L, height: H, thickness: WALL_T, holes, host: true });
    const rc = (x: number, y: number) => WP(A0 + x, B0 + y);
    const T = 0.14;
    // Room walls: `normal` points into the room so the thickness falls outside it; corners overlap.
    walls.push({ id: 'room-left', a: rc(0, RD + T), dir: [-m[0], -m[1]], normal: d, length: RD + T, height: H, thickness: T, holes: [], host: false });
    walls.push({ id: 'room-right', a: rc(RW, 0), dir: m, normal: [-d[0], -d[1]], length: RD + T, height: H, thickness: T, holes: [], host: false });
    walls.push({ id: 'room-back', a: rc(RW + T, RD), dir: [-d[0], -d[1]], normal: [-m[0], -m[1]], length: RW + 2 * T, height: H, thickness: T, holes: [], host: false });

    // ----- furniture (layout coordinates: window right of centre, free space on the left) -----
    const half = gw / 2;
    // Window seat and the sunbeam with a cat bed in it.
    box('seat', 'the window seat', wwx - half - 0.15, wwx + half + 0.15, 0, 0.42, 0.42, '#c9b79c');
    box('bed', 'the cat bed', wwx - 0.3, wwx + 0.3, 1.05, 1.5, 0.12, '#c98b6b', true, 'bed');
    const beam = rr(wwx - half - 0.15, wwx + half + 0.15, 0.5, 1.95);
    sunbeams.push(beam);
    spots.push({ id: 'nap:sunbeam', kind: 'nap', label: 'the sunbeam', p: at(wwx, 1.2, 0), r: 0, area: beam, region: 'home', sunny: true });
    spots.push({ id: 'nap:bed', kind: 'nap', label: 'the cat bed', p: at(wwx, 1.27, 0.12), r: 0.32, region: 'home', sunny: true });
    // Cat grass in a pot by the seat.
    const gx = Math.min(RW - 0.25, wwx + half + 0.45);
    box('grass', 'the cat grass pot', gx - 0.12, gx + 0.12, 0.12, 0.36, 0.2, '#b5653d');
    if (cat.plant('cat-grass-oat')) spots.push({ id: 'plant:cat-grass', kind: 'plant', label: cat.plant('cat-grass-oat')!.name.toLowerCase(), p: at(gx, 0.24, 0), r: 0.36, region: 'home', plantIds: ['cat-grass-oat'] });
    // Cat tree with a sisal post, left of the window.
    const tx = Math.max(0.75, wwx - half - 0.95);
    box('tree-base', 'the cat tree base', tx - 0.32, tx + 0.32, 0.12, 0.76, 0.06, '#b9a58a');
    box('tree-post', 'the cat tree post', tx - 0.06, tx + 0.06, 0.38, 0.5, 1.5, '#d6c29a');
    box('tree-1', 'the low cat-tree platform', tx + 0.06, tx + 0.5, 0.2, 0.64, 0.5, '#b9a58a', false);
    box('tree-2', 'the middle cat-tree platform', tx - 0.5, tx - 0.06, 0.3, 0.74, 1.0, '#b9a58a', false);
    box('tree-3', 'the top of the cat tree', tx - 0.24, tx + 0.24, 0.22, 0.66, 1.5, '#b9a58a', false);
    spots.push({ id: 'scratch:tree', kind: 'scratch', label: 'the cat tree’s scratching post', p: at(tx, 0.44, 0), r: 0.42, region: 'home' });
    // Cabinet → bookshelf → wardrobe: a staircase to the highest spot in the house.
    box('cabinet', 'the low cabinet', 0, 0.42, 1.05, 1.8, 0.8, '#8a6f5a');
    box('bookshelf', 'the bookshelf', 0, 0.36, 1.8, 2.6, 1.62, '#6f5845');
    box('wardrobe', 'the top of the wardrobe', 0, 0.62, 2.72, 3.7, 2.12, '#7c6450');
    // Sofa facing the window, a coffee table in front, a side table by the arm.
    const sx0 = RW / 2 - 0.95, sx1 = RW / 2 + 0.95;
    box('sofa-seat', 'the sofa', sx0 + 0.18, sx1 - 0.18, 2.5, 3.22, 0.45, '#5f7a8c');
    box('sofa-back', 'the back of the sofa', sx0, sx1, 3.22, 3.44, 0.86, '#56707f');
    box('sofa-arm-l', 'the sofa arm', sx0, sx0 + 0.18, 2.5, 3.22, 0.62, '#56707f');
    box('sofa-arm-r', 'the sofa arm', sx1 - 0.18, sx1, 2.5, 3.22, 0.62, '#56707f');
    spots.push({ id: 'sofa', kind: 'sofa', label: 'the sofa', p: at(RW / 2, 2.32, 0), r: 0.5, region: 'home' });
    box('coffee', 'the coffee table', RW / 2 - 0.55, RW / 2 + 0.55, 1.95, 2.3, 0.42, '#9a6b47', false);
    box('side', 'the side table', sx1 + 0.08, sx1 + 0.48, 2.7, 3.1, 0.56, '#9a6b47', false);
    // Kitchen along the back wall: counter and fridge, bowls on the floor.
    const kx1 = Math.min(2.7, RW - 2.9);
    box('counter', 'the kitchen counter', 0.12, kx1, RD - 0.62, RD, 0.92, '#e7e1d6');
    box('fridge', 'the top of the fridge', kx1, kx1 + 0.72, RD - 0.7, RD, 1.8, '#dfe4e8');
    spots.push({ id: 'drink:bowl', kind: 'drink', label: 'the water bowl', p: at(kx1 + 1.05, RD - 0.3, 0), r: 0.3, region: 'home' });
    spots.push({ id: 'eat:bowl', kind: 'eat', label: 'the food bowl', p: at(kx1 + 1.45, RD - 0.3, 0), r: 0.3, region: 'home' });

    // Things to knock off.
    const put = (id: string, label: string, shape: ItemShape, color: string, x: number, y: number, top: number, size: Vec3) => items.push({ id, label, shape, color, p: at(x, y, top), size });
    put('mug', 'the coffee mug', 'mug', '#d9534f', RW / 2 - 0.25, 2.1, 0.42, [0.09, 0.1, 0.09]);
    put('remote', 'the TV remote', 'remote', '#2b2b2e', RW / 2 + 0.25, 2.15, 0.42, [0.05, 0.025, 0.17]);
    put('glass', 'the glass of water', 'glass', '#bfe0ef', sx1 + 0.28, 2.9, 0.56, [0.07, 0.12, 0.07]);
    put('cup', 'the teacup', 'mug', '#7fb3d5', 0.6, RD - 0.3, 0.92, [0.08, 0.08, 0.08]);
    put('cereal', 'the cereal box', 'box', '#e8a93a', 1.3, RD - 0.3, 0.92, [0.19, 0.27, 0.07]);
    put('pen', 'the pen pot', 'pot', '#3f6f4f', Math.min(2.0, kx1 - 0.25), RD - 0.3, 0.92, [0.07, 0.11, 0.07]);
    put('vase', 'the vase', 'vase', '#2f5d8a', 0.2, 1.42, 0.8, [0.09, 0.2, 0.09]);
    put('book', 'the paperback', 'book', '#a15c00', 0.18, 2.2, 1.62, [0.14, 0.03, 0.2]);

    // Toy mice.
    toys.push({ id: 'toy-tree', p: at(tx, 0.44, 1.5), where: 'on top of the cat tree' });
    toys.push({ id: 'toy-fridge', p: at(kx1 + 0.36, RD - 0.35, 1.8), where: 'on top of the fridge' });
    toys.push({ id: 'toy-wardrobe', p: at(0.31, 3.2, 2.12), where: 'on top of the wardrobe' });
    toys.push({ id: 'toy-coffee', p: at(RW / 2 + 0.1, 2.12, 0), where: 'under the coffee table' });
    toys.push({ id: 'toy-sofa', p: at(RW / 2 - 0.4, 3.9, 0), where: 'behind the sofa' });
    // Decor: a floor lamp and a big potted plant (solid, so the cat walks round them), pictures, curtains, a pendant light.
    const yawIn = Math.atan2(m[0], m[1]); // facing into the room from the host wall
    const facing = (x: number, y: number) => { const q = WP(A0 + X(x), B0 + y); const c0 = WP(A0 + RW / 2, B0 + RD / 2); return Math.atan2(c0[0] - q[0], c0[1] - q[1]); };
    const lx = RW - 0.32, ly = Math.min(RD - 1.5, 2.2);
    surfaces.push({ id: 'lamp', kind: 'post', label: 'the floor lamp', region: 'home', ...rr(lx - 0.13, lx + 0.13, ly - 0.13, ly + 0.13), top: 1.55, bottom: 0, solid: true });
    decor.push({ kind: 'lamp', p: at(lx, ly, 0), yaw: 0 });
    const px = RW - 0.38, py = RD - 0.38;
    surfaces.push({ id: 'plant', kind: 'post', label: 'the potted plant', region: 'home', ...rr(px - 0.2, px + 0.2, py - 0.2, py + 0.2), top: 0.42, bottom: 0, solid: true });
    decor.push({ kind: 'plant', p: at(px, py, 0), yaw: 0 });
    // Pictures: over the low cabinet on the side wall, on the far side wall, and over the kitchen counter a clock.
    decor.push({ kind: 'picture', p: at(0.005, 1.42, 1.45), yaw: facing(0.005, 1.42), w: 0.62, h: 0.46, variant: 0 });
    decor.push({ kind: 'picture', p: at(RW - 0.005, 3.4, 1.5), yaw: facing(RW - 0.005, 3.4), w: 0.8, h: 0.6, variant: 2 });
    decor.push({ kind: 'picture', p: at(RW - 0.005, 1.4, 1.45), yaw: facing(RW - 0.005, 1.4), w: 0.5, h: 0.4, variant: 1 });
    decor.push({ kind: 'clock', p: at(Math.min(1.4, kx1 / 2), RD - 0.005, 1.75), yaw: yawIn + Math.PI, w: 0.3 });
    // Curtains either side of the open window, on the room side of the wall.
    for (const side of [-1, 1]) decor.push({ kind: 'curtain', p: at(wwx + side * (half + 0.14), 0.07, 0), yaw: yawIn, w: 0.26, h: sill + gate.height + 0.15 });
    decor.push({ kind: 'pendant', p: at(RW / 2, 2.2, H), yaw: 0 });
    roomSpan = { a0: A0 - T, a1: A0 + RW + T, depth: B0 + RD + T };
    start = { p: at(wwx, 1.27, 0.12), heading: Math.atan2(-m[0], -m[1]) };
  } else {
    // No room: start at one end of the catio's long side, looking out through the mesh, so the camera
    // behind the cat has the length of the catio to sit in.
    const alongU = W >= D;
    const fwd: Vec2 = alongU ? [Math.cos(r), Math.sin(r)] : [-Math.sin(r), Math.cos(r)];
    const heading = Math.atan2(fwd[0], fwd[1]);
    const len = alongU ? W : D, lo = alongU ? margin : v0, hi = alongU ? W - margin : v1;
    const clear = (q: Vec2) => !surfaces.some((x) => x.solid && x.region === 'catio' && inside({ ...x, h: [x.h[0] + 0.16, x.h[1] + 0.16] }, q[0], q[1]));
    let at: Vec2 = centreXZ;
    for (let k = hi - 0.4; k > lo + len * 0.4; k -= 0.1) {
      const q = alongU ? local(k, D / 2) : local(W / 2, k);
      if (clear(q)) { at = q; break; }
    }
    start = { p: [at[0], floorY, at[1]], heading: at === centreXZ ? 0 : heading };
  }

  // A toy mouse up high in the catio and one in a far corner of its floor.
  if (perch) toys.push({ id: 'toy-perch', p: [perch.c[0], perch.top, perch.c[1]], where: `on ${perch.label}` });
  const corner = local(W - margin - 0.2, Math.max(v0 + 0.2, D - margin - 0.2));
  if (!home || !perch) toys.push({ id: 'toy-corner', p: [corner[0], floorY, corner[1]], where: 'in a corner of the catio' });
  if (!home) {
    for (const x of perches.filter((q) => q !== perch).sort((q, w) => w.top - q.top).slice(0, 2)) toys.push({ id: `toy-${x.id}`, p: [x.c[0], x.top, x.c[1]], where: `on ${x.label}` });
  }

  // A toy mouse halfway along each tunnel.
  for (const l of links) toys.push({ id: `toy-tunnel:${l.t.id}`, p: l.run.mid, where: `halfway along ${links.length > 1 ? l.run.label.toLowerCase() : 'the tunnel'}` });

  // A bed or hammock standing in the sun is a sunny nap too.
  for (const sp of spots) if (sp.kind === 'nap' && !sp.area && !sp.sunny) sp.sunny = sunbeams.some((b) => inside(b, sp.p[0], sp.p[2]));

  // The camera may look in through the mesh from outside the catio, but never from above its roof.
  const out = 1.4;
  const cameraVolumes = [...volumes.filter((v) => v.id !== 'catio'), ...tunnelCams, { ...catioVol, id: 'catio-view', poly: [local(margin - out, openBack ? v0 : v0 - out), local(W - margin + out, openBack ? v0 : v0 - out), local(W - margin + out, v1 + out), local(margin - out, v1 + out)], y0: Math.min(floorY, 0) }];

  return {
    id: p.web?.sampleId ? `sample:${p.web.sampleId}` : p.id,
    name: p.name,
    home, surfaces, volumes, cameraVolumes, spots, items, toys, walls, room, sunbeams, decor, roomSpan, start, catio,
    tunnels: links.map((l) => l.run), flaps, hiddenParts, extraParts,
    sillId, hostWallId: home ? wall!.id : null, gatewayOpeningId: home ? gate!.id : null
  };
}

/** The house window behind a window-access opening, when the project does not record which one. */
function nearestWindow(w: HostWall, s: Structure) {
  const d = wallDir(w);
  const at = toPlan(s, s.width / 2, 0);
  const t = (at[0] - w.a[0]) * d[0] + (at[1] - w.a[1]) * d[1];
  return w.openings.filter((o) => o.kind === 'window').sort((x, y) => Math.abs(x.offset + x.width / 2 - t) - Math.abs(y.offset + y.width / 2 - t))[0];
}

function inside(r: Rect, x: number, z: number) {
  const dx = x - r.c[0], dz = z - r.c[1], c = Math.cos(r.yaw), sn = Math.sin(r.yaw);
  return Math.abs(dx * c + dz * sn) <= r.h[0] && Math.abs(-dx * sn + dz * c) <= r.h[1];
}

export function corners(r: Rect): Vec2[] {
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  const ax: Vec2 = [c * r.h[0], s * r.h[0]], az: Vec2 = [-s * r.h[1], c * r.h[1]];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [r.c[0] + ax[0] * i + az[0] * j, r.c[1] + ax[1] * i + az[1] * j] as Vec2);
}

export type { Part };
