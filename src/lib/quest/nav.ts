// Navigation graph for the Catio Quest simulation, built from the same layout the generator builds:
// floor points, every furnishing that fits (shelves, ramps, bridges, beds, cubbies…), and the way in
// (window insert, cat door or the people door). Edges are walks, ramps, bridge planks and jumps; whether
// a given cat can take a jump depends on its reach (personalities.ts `capsFor`). Positions are
// structure-local [u, y, v] like the generator's geometry, so the 3D view can draw cats in place.
import type { Catalog } from '../catalog/catalog';
import type { Cat, Furnishing, Project, Structure, Vec3 } from '../model/types';
import { frontHeight } from '../model/types';
import { frameMaterial, furnishingFits } from '../generate/structure';
import type { Need } from './types';
import { mainStructure, rampRun } from './design';
import { capsFor } from './personalities';

export type NodeKind = 'floor' | 'entry' | 'shelf' | 'ramp-top' | 'bridge' | 'hammock' | 'cubby' | 'cubby-top' | 'bed' | 'scratcher' | 'water' | 'litter' | 'planter';

export interface NavNode {
  i: number;
  kind: NodeKind;
  pos: Vec3;
  /** Needs this spot satisfies, with a quality 0..1. */
  tags: Partial<Record<Need, number>>;
  furnishingId?: string;
  /** How many cats fit at once. */
  capacity: number;
  /** 0 = full sun, 1 = full shade. */
  shade: number;
  /** Stays dry in rain. */
  dry: boolean;
  label: string;
}

export type EdgeKind = 'walk' | 'ramp' | 'plank' | 'jump';
export interface NavEdge { a: number; b: number; kind: EdgeKind; len: number }

export interface NavGraph {
  structureId: string;
  nodes: NavNode[];
  edges: NavEdge[];
  /** Edge indices touching each node. */
  adj: number[][];
  entry: number | null;
  entryKind: 'window' | 'cat-door' | 'door' | 'none';
  W: number;
  D: number;
  H: number;
  elevation: number;
  covered: { kind: string; fraction: number; shade: number };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const hDist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** Shade and dryness from the roof: a partial roof covers the back `coverFraction` of the depth. */
function cover(s: Structure): NavGraph['covered'] {
  const k = s.roof?.kind ?? 'mesh';
  if (k === 'corrugated') return { kind: k, fraction: 1, shade: 1 };
  if (k === 'polycarbonate') return { kind: k, fraction: 1, shade: 0.35 };
  if (k === 'partial') {
    const steel = (s.roof.materialId ?? '').includes('steel');
    return { kind: k, fraction: s.roof.coverFraction ?? 0.5, shade: steel ? 1 : 0.35 };
  }
  return { kind: 'mesh', fraction: 0, shade: 0 };
}

export function buildNav(p: Project, cat: Catalog): NavGraph | null {
  const s = mainStructure(p);
  if (!s) return null;
  const W = s.width, D = s.depth, H = Math.min(s.height, frontHeight(s));
  const d = (frameMaterial(s, cat).actual ?? [0.038, 0.064])[0];
  const cov = cover(s);
  const nodes: NavNode[] = [];
  const edges: NavEdge[] = [];
  const add = (n: Omit<NavNode, 'i' | 'shade' | 'dry'> & { shade?: number; dry?: boolean }) => {
    const underRoof = cov.fraction > 0 && n.pos[2] <= D * cov.fraction + 1e-9;
    const node: NavNode = { ...n, i: nodes.length, shade: Math.max(n.shade ?? 0, underRoof ? cov.shade : 0), dry: !!n.dry || underRoof };
    nodes.push(node);
    return node.i;
  };
  const link = (a: number, b: number, kind: EdgeKind, len?: number) => {
    if (a === b || edges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) return;
    edges.push({ a, b, kind, len: r3(len ?? hDist(nodes[a].pos, nodes[b].pos)) });
  };
  const lookoutAt = (y: number) => (s.template === 'window-box' ? Math.min(1, 0.55 + y) : Math.max(0, Math.min(1, (y - 0.5) / 1.3)));

  // Floor grid.
  const m = 0.25;
  const nx = Math.max(1, Math.round((W - 2 * m) / 0.6) + 1), nz = Math.max(1, Math.round((D - 2 * m) / 0.6) + 1);
  const floor: number[][] = [];
  for (let ix = 0; ix < nx; ix++) {
    floor.push([]);
    for (let iz = 0; iz < nz; iz++) {
      const u = nx === 1 ? W / 2 : m + ((W - 2 * m) * ix) / (nx - 1);
      const v = nz === 1 ? D / 2 : m + ((D - 2 * m) * iz) / (nz - 1);
      const nearFront = v > D - 0.6;
      floor[ix].push(add({ kind: 'floor', pos: [r3(u), 0, r3(v)], tags: { play: 0.5, rest: 0.15, ...(s.template === 'window-box' ? { lookout: 0.6 } : nearFront ? { lookout: 0.2 } : {}) }, capacity: 4, label: 'floor' }));
    }
  }
  for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
    if (ix + 1 < nx) link(floor[ix][iz], floor[ix + 1][iz], 'walk');
    if (iz + 1 < nz) link(floor[ix][iz], floor[ix][iz + 1], 'walk');
  }
  const floorIds = floor.flat();
  const nearestFloor = (pos: Vec3) => floorIds.reduce((best, i) => (hDist(nodes[i].pos, pos) < hDist(nodes[best].pos, pos) ? i : best), floorIds[0]);

  // Inner face of a wall, `inset` in from its centre plane.
  const inner = (side: string, t: number, inset: number): [number, number] => {
    switch (side) {
      case 'back': return [t, d / 2 + inset];
      case 'front': return [t, D - d / 2 - inset];
      case 'left': return [d / 2 + inset, t];
      default: return [W - d / 2 - inset, t];
    }
  };

  const elevated: number[] = [];
  for (const f of s.furnishings) {
    const comp = cat.component(f.componentId);
    if (!comp || !furnishingFits(s, f, cat)) continue;
    const len = f.length ?? comp.defaults.length;
    const depth = comp.defaults.depth;
    const y = f.mountHeight;
    const fid = f.id;
    const centre = (t: number) => inner(f.side, t, d / 2 + depth / 2);
    switch (comp.id) {
      case 'shelf': {
        const [u, v] = centre(f.offset + len / 2);
        elevated.push(add({ kind: 'shelf', pos: [r3(u), y, r3(v)], tags: { rest: 0.6, lookout: lookoutAt(y) }, furnishingId: fid, capacity: len >= 0.85 ? 2 : 1, label: `shelf at ${y.toFixed(1)} m` }));
        break;
      }
      case 'hammock': {
        const [u, v] = centre(f.offset + len / 2);
        elevated.push(add({ kind: 'hammock', pos: [r3(u), y, r3(v)], tags: { rest: 1, lookout: lookoutAt(y) * 0.8 }, furnishingId: fid, capacity: 1, shade: 0.3, label: 'hammock' }));
        break;
      }
      case 'ramp': {
        const run = rampRun(f);
        const [u0, v0] = centre(f.offset), [u1, v1] = centre(f.offset + run);
        const top = add({ kind: 'ramp-top', pos: [r3(u1), y, r3(v1)], tags: { lookout: lookoutAt(y) * 0.6, play: 0.4 }, furnishingId: fid, capacity: 1, label: 'top of the ramp' });
        elevated.push(top);
        link(nearestFloor([u0, 0, v0]), top, 'ramp', len);
        break;
      }
      case 'bridge': {
        const span = f.length ?? W - 2 * d;
        const u0 = (W - span) / 2 + 0.2, u1 = W - (W - span) / 2 - 0.2;
        const n = Math.max(2, Math.round((u1 - u0) / 0.6) + 1);
        let prev = -1;
        for (let k = 0; k < n; k++) {
          const i = add({ kind: 'bridge', pos: [r3(u0 + ((u1 - u0) * k) / (n - 1)), y, r3(f.offset)], tags: { lookout: lookoutAt(y), play: 0.7, rest: 0.25 }, furnishingId: fid, capacity: 1, label: 'bridge' });
          elevated.push(i);
          if (prev >= 0) link(prev, i, 'plank');
          prev = i;
        }
        break;
      }
      case 'cubby': {
        const [u, v] = centre(f.offset + len / 2);
        const inside = add({ kind: 'cubby', pos: [r3(u), 0.05, r3(v)], tags: { hide: 1, rest: 0.7 }, furnishingId: fid, capacity: 1, shade: 1, dry: true, label: 'hideaway cube' });
        link(nearestFloor([u, 0, v]), inside, 'walk');
        elevated.push(add({ kind: 'cubby-top', pos: [r3(u), 0.4, r3(v)], tags: { rest: 0.4, lookout: lookoutAt(0.4) }, furnishingId: fid, capacity: 1, label: 'top of the cube' }));
        break;
      }
      default: {
        const [u, v] = centre(f.offset + len / 2);
        const kind: NodeKind = comp.id === 'bed' ? 'bed' : comp.id === 'scratcher-post' ? 'scratcher' : comp.id === 'water-station' ? 'water' : comp.id === 'litter-annex' ? 'litter' : 'planter';
        const tags: NavNode['tags'] = kind === 'bed' ? { rest: 0.9 } : kind === 'scratcher' ? { scratch: 1, play: 0.3 } : kind === 'water' ? { drink: 1 } : kind === 'litter' ? { toilet: 1 } : { greens: 1, hide: comp.id === 'planter-large' ? 0.3 : 0 };
        const i = add({ kind, pos: [r3(u), kind === 'bed' ? 0.15 : 0, r3(v)], tags, furnishingId: fid, capacity: kind === 'planter' ? 2 : 1, dry: kind === 'litter', shade: kind === 'litter' ? 1 : 0, label: comp.name.toLowerCase() });
        link(nearestFloor([u, 0, v]), i, 'walk');
      }
    }
  }

  // Jumps: floor ↔ every elevated spot above it, and between elevated spots within a leap.
  for (const e of elevated) link(nearestFloor(nodes[e].pos), e, 'jump', 0.3);
  for (let a = 0; a < elevated.length; a++) for (let b = a + 1; b < elevated.length; b++) {
    const na = nodes[elevated[a]], nb = nodes[elevated[b]];
    const h = hDist(na.pos, nb.pos);
    if (h <= 1.25 && !(na.furnishingId === nb.furnishingId && na.kind === 'bridge')) link(na.i, nb.i, 'jump', h);
  }

  // The way in.
  let entry: number | null = null;
  let entryKind: NavGraph['entryKind'] = 'none';
  const wa = s.openings.find((o) => o.kind === 'window-access');
  const cd = s.openings.find((o) => o.kind === 'cat-door');
  const door = s.openings.find((o) => o.kind === 'human-door' || o.kind === 'cleaning-hatch');
  if (wa) {
    const [u, v] = inner('back', wa.offset + wa.width / 2, 0.12);
    entry = add({ kind: 'entry', pos: [r3(u), r3(wa.sill ?? 0), r3(v)], tags: {}, capacity: 4, dry: true, shade: 1, label: 'window' });
    entryKind = 'window';
    link(nearestFloor(nodes[entry].pos), entry, 'jump', 0.3);
    // The insert's ledge runs the width of the window: cats step off anywhere along it.
    const u0 = wa.offset, u1 = wa.offset + wa.width;
    for (const e of elevated) {
      const [u, , v] = nodes[e].pos;
      const du = u < u0 ? u0 - u : u > u1 ? u - u1 : 0;
      if (Math.hypot(du, v - nodes[entry].pos[2]) <= 1.0) link(entry, e, 'jump', 0.3);
    }
  } else if (cd) {
    const [u, v] = inner(cd.side, cd.offset + cd.width / 2, 0.15);
    entry = add({ kind: 'entry', pos: [r3(u), 0, r3(v)], tags: {}, capacity: 4, label: 'cat door' });
    entryKind = 'cat-door';
    link(nearestFloor(nodes[entry].pos), entry, 'walk');
  } else if (door) {
    const [u, v] = inner(door.side, door.offset + door.width / 2, 0.3);
    entry = add({ kind: 'entry', pos: [r3(u), 0, r3(v)], tags: {}, capacity: 4, label: door.kind === 'human-door' ? 'people door' : 'hatch' });
    entryKind = 'door';
    link(nearestFloor(nodes[entry].pos), entry, 'walk');
  }

  const adj: number[][] = nodes.map(() => []);
  edges.forEach((e, k) => { adj[e.a].push(k); adj[e.b].push(k); });
  return { structureId: s.id, nodes, edges, adj, entry, entryKind, W, D, H, elevation: s.elevation ?? 0, covered: cov };
}

export type Caps = ReturnType<typeof capsFor>;

/** Whether a cat with these caps can go from node `from` along edge e. */
export function canTraverse(g: NavGraph, e: NavEdge, from: number, caps: Caps): boolean {
  if (e.kind !== 'jump') return true;
  const to = e.a === from ? e.b : e.a;
  const dy = g.nodes[to].pos[1] - g.nodes[from].pos[1];
  const reach = e.len <= 0.35 ? 99 : caps.leap + 0.25;
  if (e.len > reach) return false;
  return dy >= 0 ? dy <= caps.up + 1e-9 : -dy <= caps.down + 1e-9;
}

/** Cost of taking an edge (seconds-ish). Seniors pay more for jumps. */
export function edgeCost(g: NavGraph, e: NavEdge, from: number, caps: Caps): number {
  const to = e.a === from ? e.b : e.a;
  const dy = Math.abs(g.nodes[to].pos[1] - g.nodes[from].pos[1]);
  if (e.kind === 'jump') return 2 + dy * (caps.up < 0.7 ? 6 : 2) + e.len;
  if (e.kind === 'ramp') return e.len * 1.5;
  return e.len * 1.2;
}

export interface Paths { dist: number[]; prev: number[]; prevEdge: number[] }

/** Dijkstra from `src` for one cat. Deterministic: ties go to the lower node index. */
export function shortestPaths(g: NavGraph, src: number, caps: Caps): Paths {
  const n = g.nodes.length;
  const dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), prevEdge = new Array(n).fill(-1);
  const done = new Array(n).fill(false);
  dist[src] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = true;
    for (const k of g.adj[u]) {
      const e = g.edges[k];
      if (!canTraverse(g, e, u, caps)) continue;
      const v = e.a === u ? e.b : e.a;
      const nd = dist[u] + edgeCost(g, e, u, caps);
      if (nd < dist[v] - 1e-9) { dist[v] = nd; prev[v] = u; prevEdge[v] = k; }
    }
  }
  return { dist, prev, prevEdge };
}

export function pathTo(paths: Paths, to: number): { nodes: number[]; edges: number[] } {
  const nodes: number[] = [], edges: number[] = [];
  for (let v = to; v >= 0 && paths.prev[v] !== -1; v = paths.prev[v]) { nodes.unshift(v); edges.unshift(paths.prevEdge[v]); }
  return { nodes, edges };
}

/** Elevated spots with a single way on or off for an agile adult — a cat there can be cornered. */
export function deadEnds(g: NavGraph): number[] {
  const adult = capsFor({ id: '', name: '', ageClass: 'adult', mobility: 'full', size: 'medium', climber: true, escapeRisk: 'low' } as Cat);
  return g.nodes.filter((n) => n.pos[1] >= 0.5 && n.kind !== 'entry').filter((n) => {
    const ways = new Set<number>();
    for (const k of g.adj[n.i]) {
      const e = g.edges[k];
      const o = e.a === n.i ? e.b : e.a;
      if (canTraverse(g, e, n.i, adult) && g.nodes[o].kind !== 'floor') ways.add(o);
      else if (g.nodes[o].kind === 'floor' && canTraverse(g, e, o, adult)) ways.add(-1);
    }
    return ways.size <= 1;
  }).map((n) => n.i);
}

/** Ways up from the floor into the high network (distinct elevated spots ≥ 0.8 m reachable directly). */
export function routesUp(g: NavGraph): number {
  const adult = capsFor({ id: '', name: '', ageClass: 'adult', mobility: 'full', size: 'medium', climber: false, escapeRisk: 'low' } as Cat);
  let n = 0;
  for (const e of g.edges) {
    const a = g.nodes[e.a], b = g.nodes[e.b];
    const [lo, hi] = a.pos[1] <= b.pos[1] ? [a, b] : [b, a];
    if (lo.pos[1] < 0.45 && hi.pos[1] >= 0.45 && canTraverse(g, e, lo.i, adult)) n++;
  }
  return n;
}

export const furnishingNode = (g: NavGraph, f: Furnishing) => g.nodes.find((n) => n.furnishingId === f.id);
