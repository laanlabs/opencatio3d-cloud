// Recipes: one Structure → its parts. Deterministic and pure (same structure + catalog → same parts,
// ids and order). Box templates (lean-to, freestanding, window box, porch infill, balcony) share one
// wall/roof/base recipe; tunnels have their own. Algorithms are specified in EXPORT_FORMAT.md
// "Generator algorithms" so the iOS port can match them number for number.
import type { Catalog, Material } from '../catalog/catalog';
import type { Furnishing, Project, Side, Structure, StructureOpening, TemplateId, Vec2, Vec3 } from '../model/types';
import { frontHeight, stableId } from '../model/types';
import {
  CLEAT_SPACING, DOOR_GAP, JOIST_SPACING, KNEE_SPACING, LEDGER_SCREW_SPACING, MESH_FASTENER_SPACING, OVERLAP, PARTIAL_COVER,
  PURLIN_SPACING, END_LAP, ROPE_PER_M, SCREWS_PER_MEMBER, SKIRT_DEPTH, STAPLE_SPACING, VESTIBULE_DEPTH, FRAME_ROLES,
  ceilE, r3, type Geom, type Part, type PartKind, type StepKey
} from './parts';

export interface StructureResult {
  parts: Part[];
  conceptOnly: boolean;
  /** Dimensions outside the template limits (CAT-BLD-005), e.g. "width 7.2 > 6". */
  unsupported: string[];
  /** Openings and furnishings that did not fit and were left out (CAT-BLD-006 / -007). */
  skippedOpenings: string[];
  skippedFurnishings: string[];
}

// ---------- materials ----------

export function frameMaterial(s: Structure, cat: Catalog): Material {
  const m = cat.material(s.frame?.materialId);
  if (m?.kind === 'lumber' && m.profile === s.frame.profile) return m;
  return cat.lumberFor(s.frame?.profile ?? 'wood-2x3')[0] ?? cat.lumberFor('wood-2x3')[0];
}
export function meshMaterial(s: Structure, cat: Catalog): Material {
  const m = cat.material(s.mesh?.materialId);
  return m?.kind === 'mesh' ? m : cat.ofKind('mesh')[0];
}
export function roofMaterial(s: Structure, cat: Catalog): Material {
  const m = cat.material(s.roof?.materialId);
  if (m?.kind === 'roof-panel') return m;
  return cat.material(s.roof?.kind === 'corrugated' ? 'roof-steel-corrugated' : 'roof-polycarb-corrugated') ?? cat.ofKind('roof-panel')[0];
}
const mat = (cat: Catalog, id: string, kind?: Material['kind']) => cat.material(id) ?? (kind ? cat.ofKind(kind)[0] : undefined);

// ---------- layout helpers ----------

export interface Layout { framed: Side[]; meshed: Side[]; houseBack: boolean }

/** Which sides get framing and mesh. Attached templates use the house wall as their back. */
export function layoutFor(t: TemplateId): Layout {
  switch (t) {
    case 'lean-to': case 'porch-infill': case 'balcony-concept': return { framed: ['front', 'left', 'right'], meshed: ['front', 'left', 'right'], houseBack: true };
    case 'window-box': return { framed: ['back', 'front', 'left', 'right'], meshed: ['front', 'left', 'right'], houseBack: true };
    default: return { framed: ['back', 'front', 'left', 'right'], meshed: ['back', 'front', 'left', 'right'], houseBack: false };
  }
}

export const sideLength = (side: Side, W: number, D: number) => (side === 'back' || side === 'front' ? W : D);

/** Wall extent [t0, t1] along a side: side walls butt between the back and front walls. */
export function wallExtent(side: Side, W: number, D: number, d: number, hasBackWall: boolean): [number, number] {
  if (side === 'back' || side === 'front') return [0, W];
  return [hasBackWall ? d : 0, D - d];
}

/** Bays so the pitch is ≤ maxSpacing and a mesh panel (pitch + OVERLAP) fits the roll. */
export const bayCount = (L: number, maxSpacing: number, rollWidth: number) => Math.max(1, ceilE(L / maxSpacing), ceilE(L / (rollWidth - OVERLAP)));

/** Mesh strips for a bay of pitch p: k strips of width p/k + OVERLAP, each ≤ roll width. */
export const stripCount = (p: number, rollWidth: number) => Math.max(1, ceilE((p + OVERLAP) / rollWidth));

const dist3 = (a: Vec3, b: Vec3) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
export const meshFasteners = (w: number, h: number) => 2 * ceilE(w / MESH_FASTENER_SPACING) + 2 * ceilE(h / MESH_FASTENER_SPACING);

/** Stock lengths offered for a lumber material: the project's list ∩ the catalog's, else the catalog's. */
export function stockFor(m: Material, wanted: number[]): number[] {
  const all = m.stockLengths ?? [2.438];
  const pick = all.filter((s) => wanted.some((w) => Math.abs(w - s) < 0.01));
  return pick.length ? pick : all;
}

/** Horizontal runs that are spliced over a stud when longer than the longest stock; anything else becomes overlong (CAT-BLD-003). */
export const SPLICE_ROLES = new Set(['plate', 'ledger', 'purlin', 'seal', 'tunnel-rail']);

class Builder {
  parts: Part[] = [];
  constructor(readonly s: Structure, readonly stock: number[] = [], readonly origin: Vec2 = [0, 0], readonly prefix = '') {}

  private shift(p: Vec3): Vec3 { return [p[0] + this.origin[0], p[1], p[2] + this.origin[1]]; }
  private shiftGeom(g?: Geom): Geom | undefined {
    if (!g) return g;
    if (g.type === 'bar') return { ...g, a: this.shift(g.a), b: this.shift(g.b) };
    if (g.type === 'quad') return { type: 'quad', p: g.p.map((q) => this.shift(q)) as [Vec3, Vec3, Vec3, Vec3] };
    return { ...g, c: this.shift(g.c) };
  }

  add(p: { key: string; kind: PartKind; role: string; materialId: string; step: StepKey; qty?: number } & Partial<Part>): Part {
    const key = this.prefix + p.key;
    const part: Part = { ...p, key, id: stableId(`${this.s.id}:${key}`), structureId: this.s.id, qty: p.qty ?? 1, geom: this.shiftGeom(p.geom) } as Part;
    if (part.geom === undefined) delete part.geom;
    this.parts.push(part);
    return part;
  }

  /**
   * One frame member from a to b. A spliceable run longer than the longest stock is split into
   * k = ceil(L / longest) equal pieces (keys `<key>:p0…`), joined over a stud or with a splice block.
   */
  member(key: string, role: string, step: StepKey, m: Material, a: Vec3, b: Vec3, extra: Partial<Part> = {}): Part {
    const size = (m.actual ?? [0.038, 0.064]) as [number, number];
    const L = dist3(a, b);
    const longest = Math.max(...stockFor(m, this.stock));
    if (SPLICE_ROLES.has(role) && L > longest + 1e-9) {
      const k = ceilE(L / longest);
      const lerp = (t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      let first: Part | undefined;
      for (let i = 0; i < k; i++) {
        const p = this.add({ key: `${key}:p${i}`, kind: 'member', role, materialId: m.id, step, length: r3(L / k), geom: { type: 'bar', a: lerp(i / k), b: lerp((i + 1) / k), size }, ...extra });
        first ??= p;
      }
      return first!;
    }
    return this.add({ key, kind: 'member', role, materialId: m.id, step, length: r3(L), geom: { type: 'bar', a, b, size }, ...extra });
  }

  /** One mesh panel (or several strips if wider than the roll). `quad` corners are in order along the width. */
  mesh(key: string, role: string, step: StepKey, m: Material, pitch: number, height: number, quad: [Vec3, Vec3, Vec3, Vec3], extra: Partial<Part> = {}) {
    const rollW = m.rollWidth ?? 1.2;
    const k = stripCount(pitch, rollW);
    const w = r3(pitch / k + OVERLAP), h = r3(height + OVERLAP);
    for (let j = 0; j < k; j++) {
      const t0 = j / k, t1 = (j + 1) / k;
      const lerp = (p: Vec3, q: Vec3, t: number): Vec3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
      const [p0, p1, p2, p3] = quad;
      const g: Geom = { type: 'quad', p: [lerp(p0, p1, t0), lerp(p0, p1, t1), lerp(p3, p2, t1), lerp(p3, p2, t0)] };
      this.add({ key: `${key}:${j}`, kind: 'panel', role, materialId: m.id, step, width: w, height: h, rollLength: h, geom: g, ...extra });
    }
  }
}

// ---------- fitting ----------

function limitCheck(s: Structure, cat: Catalog): string[] {
  const t = cat.template(s.template);
  if (!t) return [`unknown template ${s.template}`];
  const out: string[] = [];
  const chk = (name: string, v: number | undefined, r?: [number, number]) => {
    if (r == null || v == null) return;
    if (v < r[0] - 1e-9) out.push(`${name} ${r3(v)} < ${r[0]}`);
    if (v > r[1] + 1e-9) out.push(`${name} ${r3(v)} > ${r[1]}`);
  };
  chk('width', s.width, t.limits.width);
  chk('height', s.height, t.limits.height);
  if (s.template === 'tunnel') {
    const L = (s.path ?? []).slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - s.path![i][0], p[1] - s.path![i][1]), 0);
    chk('path length', L, t.limits.pathLength);
    if (!s.path || s.path.length < 2) out.push('path needs at least two points');
  } else {
    chk('depth', s.depth, t.limits.depth);
    chk('front height', frontHeight(s), t.limits.lowHeight);
    if (frontHeight(s) > s.height + 1e-9) out.push('front higher than back');
  }
  if (t.limits.elevation) chk('elevation', s.elevation ?? 0, t.limits.elevation);
  return out;
}

interface Ctx { s: Structure; cat: Catalog; W: number; D: number; Hb: number; Hf: number; d: number; w: number; layout: Layout }

function ctxFor(s: Structure, cat: Catalog): Ctx {
  const m = frameMaterial(s, cat);
  const [d, w] = (m.actual ?? [0.038, 0.064]) as [number, number];
  return { s, cat, W: s.width, D: s.depth, Hb: s.height, Hf: frontHeight(s), d, w, layout: layoutFor(s.template) };
}

const heightAt = (c: Pick<Ctx, 'D' | 'Hb' | 'Hf'>, side: Side, t: number) => (side === 'back' ? c.Hb : side === 'front' ? c.Hf : c.Hb + ((c.Hf - c.Hb) * t) / c.D);

/** Centre-plane point (u, v) of a wall at distance t along its side. */
function sidePoint(c: Pick<Ctx, 'W' | 'D' | 'd'>, side: Side, t: number): Vec2 {
  switch (side) {
    case 'back': return [t, c.d / 2];
    case 'front': return [t, c.D - c.d / 2];
    case 'left': return [c.d / 2, t];
    case 'right': return [c.W - c.d / 2, t];
  }
}
const at = (p: Vec2, y: number): Vec3 => [p[0], y, p[1]];

/** Whether a box-template opening fits its wall (CAT-BLD-006). `others` are the openings placed before it. */
export function openingFits(s: Structure, o: StructureOpening, cat: Catalog, others: StructureOpening[] = []): boolean {
  if (!(o.width > 0 && o.height > 0) || o.offset < -1e-9) return false;
  if (s.template === 'tunnel') return (o.side === 'back' || o.side === 'front') && (o.kind === 'cat-door' || o.kind === 'window-access') && o.width <= s.width + 1e-9 && (o.sill ?? 0) + o.height <= s.height + 1e-9;
  const c = ctxFor(s, cat);
  const L = sideLength(o.side, c.W, c.D);
  if (o.kind === 'window-access') return c.layout.houseBack && o.side === 'back' && o.offset + o.width <= L + 1e-9 && (o.sill ?? 0) + o.height <= c.Hb + 1e-9;
  if (o.kind === 'vestibule') return o.side === 'front' && o.offset + o.width <= c.W + 1e-9 && o.width >= 0.6 - 1e-9 && o.height >= 1.0 - 1e-9 && o.height <= 2.7 + 1e-9;
  if (!c.layout.meshed.includes(o.side)) return false;
  const [t0, t1] = wallExtent(o.side, c.W, c.D, c.d, c.layout.framed.includes('back'));
  if (o.offset < t0 + c.w - 1e-9 || o.offset + o.width > t1 - c.w + 1e-9) return false;
  const sill = o.sill ?? 0;
  const minH = Math.min(heightAt(c, o.side, o.offset), heightAt(c, o.side, o.offset + o.width));
  if (sill < 0 || sill + o.height > minH - c.w + 1e-9) return false;
  if (sill > 0 && sill < c.w - 1e-9) return false;
  return !others.some((x) => x.side === o.side && x.kind !== 'window-access' && x.kind !== 'vestibule' && o.offset - c.w < x.offset + x.width + c.w - 1e-9 && x.offset - c.w < o.offset + o.width + c.w - 1e-9);
}

/** Whether a furnishing fits where it is placed (CAT-BLD-007). */
export function furnishingFits(s: Structure, f: Furnishing, cat: Catalog): boolean {
  const comp = cat.component(f.componentId);
  if (!comp) return false;
  if (s.template === 'tunnel') return false;
  const c = ctxFor(s, cat);
  const len = f.length ?? comp.defaults.length;
  if (f.side === 'span') return f.offset >= 0 && f.offset <= c.D && f.mountHeight + 0.1 <= Math.min(c.Hb, c.Hf, heightAt(c, 'left', f.offset)) + 1e-9;
  const L = sideLength(f.side, c.W, c.D);
  if (f.offset < -1e-9 || f.offset + len > L + 1e-9) return false;
  if (comp.mount === 'wall' && (!c.layout.framed.includes(f.side) || (c.layout.houseBack && f.side === 'back' && s.template !== 'window-box'))) return false;
  const top = comp.recipe === 'post-scratcher' ? f.mountHeight : f.mountHeight + 0.05;
  return top <= Math.min(heightAt(c, f.side, f.offset), heightAt(c, f.side, Math.min(L, f.offset + len))) + 1e-9;
}

// ---------- box templates ----------

interface WallSpec { side: Side; meshed: boolean; openings: StructureOpening[] }

function walls(b: Builder, c: Ctx, m: Material, mesh: Material, spec: WallSpec) {
  const { side } = spec;
  const hasBack = c.layout.framed.includes('back');
  const [t0, t1] = wallExtent(side, c.W, c.D, c.d, hasBack);
  const h = (t: number) => heightAt(c, side, t);
  const P = (t: number) => sidePoint(c, side, t);
  const { w } = c;
  b.member(`${side}:plate-bottom`, 'plate', 'walls', m, at(P(t0), w / 2), at(P(t1), w / 2), { side });
  b.member(`${side}:plate-top`, 'plate', 'walls', m, at(P(t0), h(t0) - w / 2), at(P(t1), h(t1) - w / 2), { side });

  // Studs: two end studs, then the equal-pitch intermediates minus any inside an opening, plus jambs.
  const Lw = t1 - t0;
  const n = bayCount(Lw, c.s.frame.maxPostSpacing, mesh.rollWidth ?? 1.2);
  type Stud = { key: string; t: number; role: 'stud' | 'jamb'; opening?: string };
  const studs: Stud[] = [{ key: 'stud:start', t: t0 + w / 2, role: 'stud' }, { key: 'stud:end', t: t1 - w / 2, role: 'stud' }];
  const framed = spec.openings;
  for (let i = 1; i < n; i++) {
    const t = t0 + (Lw * i) / n;
    if (framed.some((o) => t >= o.offset - w - 1e-9 && t <= o.offset + o.width + w + 1e-9)) continue;
    studs.push({ key: `stud:${i}`, t, role: 'stud' });
  }
  for (const o of framed) {
    if (o.offset - w >= t0 + w - 1e-9) studs.push({ key: `jamb:${o.id}:l`, t: o.offset - w / 2, role: 'jamb', opening: o.id });
    if (o.offset + o.width + w <= t1 - w + 1e-9) studs.push({ key: `jamb:${o.id}:r`, t: o.offset + o.width + w / 2, role: 'jamb', opening: o.id });
  }
  studs.sort((a, b2) => a.t - b2.t || (a.key < b2.key ? -1 : 1));
  for (const st of studs) b.member(`${side}:${st.key}`, st.role, 'walls', m, at(P(st.t), w), at(P(st.t), h(st.t) - w), { side, ...(st.opening ? { ownerId: st.opening } : {}) });

  // Bays between consecutive studs: rails + mesh, except where an opening sits.
  for (let i = 0; i < studs.length - 1; i++) {
    const a = studs[i].t, z = studs[i + 1].t;
    const pitch = z - a;
    const opening = framed.find((o) => o.offset >= a - 1e-9 && o.offset + o.width <= z + 1e-9);
    const hMin = Math.min(h(a), h(z)), hMax = Math.max(h(a), h(z));
    const quad = (y0: number, y1a: number, y1z: number): [Vec3, Vec3, Vec3, Vec3] => [at(P(a), y0), at(P(z), y0), at(P(z), y1z), at(P(a), y1a)];
    if (opening) {
      const sill = opening.sill ?? 0;
      const top = sill + opening.height;
      if (top + w < hMin - w - 1e-9) b.member(`${side}:header:${opening.id}`, 'header', 'walls', m, at(P(opening.offset), top + w / 2), at(P(opening.offset + opening.width), top + w / 2), { side, ownerId: opening.id });
      if (sill > 0) b.member(`${side}:sill:${opening.id}`, 'sill', 'walls', m, at(P(opening.offset), sill - w / 2), at(P(opening.offset + opening.width), sill - w / 2), { side, ownerId: opening.id });
      if (spec.meshed && hMax - top > 0.05) b.mesh(`${side}:bay${i}:mesh-above`, 'mesh-wall', 'mesh', mesh, pitch, hMax - top, quad(top, h(a), h(z)), { side });
      if (spec.meshed && sill > w + 0.05) b.mesh(`${side}:bay${i}:mesh-below`, 'mesh-wall', 'mesh', mesh, pitch, sill, quad(0, sill, sill), { side });
      continue;
    }
    if (!spec.meshed) continue;
    const clear = pitch - w;
    const inner = hMin - 2 * w;
    if (clear > 0.05 && inner > 0) {
      const r = Math.max(0, ceilE(inner / c.s.frame.railSpacing) - 1);
      for (let j = 1; j <= r; j++) {
        const y = w + (inner * j) / (r + 1);
        b.member(`${side}:bay${i}:rail${j}`, 'rail', 'walls', m, at(P(a + w / 2), y), at(P(z - w / 2), y), { side });
      }
    }
    b.mesh(`${side}:bay${i}:mesh`, 'mesh-wall', 'mesh', mesh, pitch, hMax, quad(0, h(a), h(z)), { side });
  }
}

/** Door / hatch leaf, hinges, latch and handle; cat doors get a kit. */
function openingHardware(b: Builder, c: Ctx, m: Material, mesh: Material, o: StructureOpening) {
  const cat = c.cat;
  const P = (t: number) => sidePoint(c, o.side as Side, t);
  const sill = o.sill ?? 0;
  const k = `${o.side}:${o.kind}:${o.id}`;
  if (o.kind === 'cat-door') { b.add({ key: `${k}:kit`, kind: 'kit', role: 'cat-door', materialId: mat(cat, 'kit-cat-door', 'kit')!.id, step: 'openings', ownerId: o.id, side: o.side, geom: { type: 'box', c: at(P(o.offset + o.width / 2), sill + o.height / 2), s: [o.width, o.height, 0.03] } }); return; }
  if (o.kind === 'window-access') { b.add({ key: `${k}:kit`, kind: 'kit', role: 'window-insert', materialId: mat(cat, 'kit-window-insert', 'kit')!.id, step: 'openings', ownerId: o.id, side: o.side, geom: { type: 'box', c: [o.offset + o.width / 2, sill + o.height / 2, 0.02], s: [o.width, o.height, 0.03] } }); return; }
  // human door, cleaning hatch, vestibule door: a framed leaf with its own mesh
  const { w } = c;
  const lw = o.width - 2 * DOOR_GAP, lh = o.height - 2 * DOOR_GAP;
  const x0 = o.offset + DOOR_GAP, x1 = o.offset + o.width - DOOR_GAP, y0 = sill + DOOR_GAP, y1 = sill + o.height - DOOR_GAP;
  const out = 0.012;
  const Pq = (t: number, y: number): Vec3 => { const p = P(t); const n = outward(o.side as Side); return [p[0] + n[0] * out, y, p[1] + n[1] * out]; };
  b.member(`${k}:stile-l`, 'door-stile', 'openings', m, Pq(x0 + w / 2, y0), Pq(x0 + w / 2, y1), { side: o.side, ownerId: o.id });
  b.member(`${k}:stile-r`, 'door-stile', 'openings', m, Pq(x1 - w / 2, y0), Pq(x1 - w / 2, y1), { side: o.side, ownerId: o.id });
  b.member(`${k}:rail-b`, 'door-rail', 'openings', m, Pq(x0 + w, y0 + w / 2), Pq(x1 - w, y0 + w / 2), { side: o.side, ownerId: o.id });
  b.member(`${k}:rail-t`, 'door-rail', 'openings', m, Pq(x0 + w, y1 - w / 2), Pq(x1 - w, y1 - w / 2), { side: o.side, ownerId: o.id });
  if (lh > 1) b.member(`${k}:brace`, 'door-brace', 'openings', m, Pq(x0 + w, y0 + w), Pq(x1 - w, y1 - w), { side: o.side, ownerId: o.id });
  b.mesh(`${k}:mesh`, 'mesh-door', 'openings', mesh, lw, lh, [Pq(x0, y0), Pq(x1, y0), Pq(x1, y1), Pq(x0, y1)], { side: o.side, ownerId: o.id });
  const hinge = mat(cat, o.selfClosing ? 'hinge-spring-4in' : 'hinge-tee-4in', 'hardware')!;
  b.add({ key: `${k}:hinges`, kind: 'hardware', role: 'hinge', materialId: hinge.id, step: 'openings', qty: o.height > 1.5 ? 3 : 2, ownerId: o.id, side: o.side });
  if (o.latch) {
    const latch = cat.latchMaterial(o.latch);
    if (latch) b.add({ key: `${k}:latch`, kind: 'hardware', role: 'latch', materialId: latch.id, step: 'openings', ownerId: o.id, side: o.side });
  }
  if (o.kind === 'human-door') b.add({ key: `${k}:handle`, kind: 'hardware', role: 'handle', materialId: mat(cat, 'handle-pull', 'hardware')!.id, step: 'openings', ownerId: o.id, side: o.side });
}

const outward = (side: Side): Vec2 => (side === 'back' ? [0, -1] : side === 'front' ? [0, 1] : side === 'left' ? [-1, 0] : [1, 0]);

function roof(b: Builder, c: Ctx, m: Material, mesh: Material) {
  const { W, D, Hb, Hf, w, cat, s } = c;
  const slope = Math.hypot(D, Hb - Hf);
  const nR = bayCount(W, s.frame.maxPostSpacing, mesh.rollWidth ?? 1.2);
  for (let i = 1; i < nR; i++) {
    const u = (W * i) / nR;
    b.member(`roof:rafter${i}`, 'rafter', 'roof-frame', m, [u, Hb + w / 2, 0], [u, Hf + w / 2, D], { side: 'roof' });
  }
  const kind = s.roof?.kind ?? 'mesh';
  const yAt = (v: number) => Hb + w + ((Hf - Hb) * v) / D;
  if (kind === 'mesh' || kind === 'partial') {
    for (let i = 0; i < nR; i++) {
      const u0 = (W * i) / nR, u1 = (W * (i + 1)) / nR;
      b.mesh(`roof:bay${i}:mesh`, 'mesh-roof', 'mesh', mesh, W / nR, slope, [[u0, yAt(0), 0], [u1, yAt(0), 0], [u1, yAt(D), D], [u0, yAt(D), D]], { side: 'roof' });
    }
  }
  if (kind === 'mesh') return;
  const frac = kind === 'partial' ? Math.min(1, Math.max(0, s.roof.coverFraction ?? PARTIAL_COVER)) : 1;
  const covered = slope * frac;
  if (covered < 0.05) return;
  const panel = roofMaterial(s, cat);
  const p = Math.max(2, ceilE(covered / PURLIN_SPACING) + 1);
  const vAt = (sAlong: number) => (sAlong / slope) * D;
  for (let j = 0; j < p; j++) {
    const v = vAt((covered * j) / (p - 1));
    b.member(`roof:purlin${j}`, 'purlin', 'roof-frame', m, [0, yAt(v) + w / 2, v], [W, yAt(v) + w / 2, v], { side: 'roof' });
  }
  const across = ceilE(W / (panel.coverWidth ?? 0.6));
  const sl = panel.sheetLength ?? 2.44;
  const rows = covered <= sl + 1e-9 ? 1 : 1 + ceilE((covered - sl) / (sl - END_LAP));
  const vEnd = vAt(covered);
  b.add({ key: 'roof:sheets', kind: 'panel', role: 'roof-sheet', materialId: panel.id, step: 'roof-cover', qty: across * rows, side: 'roof', geom: { type: 'quad', p: [[0, yAt(0) + w * 1.6, 0], [W, yAt(0) + w * 1.6, 0], [W, yAt(vEnd) + w * 1.6, vEnd], [0, yAt(vEnd) + w * 1.6, vEnd]] } });
  b.add({ key: 'roof:screws', kind: 'connector', role: 'roof-screw', materialId: mat(cat, 'screw-roofing', 'fastener')!.id, step: 'roof-cover', qty: across * p * 3 });
}

/** Base: pavers, ground skirt, deck brackets, raised floor or masonry screws; ledgers and seal trim for attached boxes. */
function base(b: Builder, c: Ctx, m: Material, mesh: Material, project: Project | undefined) {
  const { W, D, Hb, w, d, cat, s, layout } = c;
  const kind = s.base?.kind ?? 'none';
  const perimeter = layout.framed.filter((sd) => !(layout.houseBack && sd === 'back'));
  const corners = layout.houseBack ? 2 : 4;
  const ground = project?.site?.ground ?? 'grass';
  const soft = ground === 'grass' || ground === 'soil';
  if (kind === 'pavers') {
    const paver = mat(cat, 'paver-16in', 'base')!;
    const n = perimeter.reduce((a, sd) => a + ceilE(sideLength(sd, W, D) / (paver.size ?? 0.4)), 0);
    b.add({ key: 'base:pavers', kind: 'base', role: 'paver', materialId: paver.id, step: 'base', qty: n });
    b.add({ key: 'base:sand', kind: 'base', role: 'sand', materialId: mat(cat, 'sand-leveling', 'base')!.id, step: 'base', qty: ceilE(n / 4) });
  } else if (kind === 'ground-skirt') {
    const depth = s.base.skirtDepth ?? SKIRT_DEPTH;
    let staples = 0;
    for (const sd of perimeter) {
      const L = sideLength(sd, W, D);
      const p0 = sidePoint(c, sd, 0), p1 = sidePoint(c, sd, L), n = outward(sd);
      b.add({ key: `base:skirt:${sd}`, kind: 'panel', role: 'mesh-skirt', materialId: mesh.id, step: 'skirt', width: r3(depth), height: r3(L), rollLength: r3((L * depth) / (mesh.rollWidth ?? 1.2)), side: sd,
        geom: { type: 'quad', p: [[p0[0], 0.005, p0[1]], [p1[0], 0.005, p1[1]], [p1[0] + n[0] * depth, 0.005, p1[1] + n[1] * depth], [p0[0] + n[0] * depth, 0.005, p0[1] + n[1] * depth]] } });
      staples += ceilE(L / STAPLE_SPACING) + 1;
    }
    b.add({ key: 'base:staples', kind: 'connector', role: 'staple', materialId: mat(cat, 'staple-landscape', 'fastener')!.id, step: 'skirt', qty: staples });
    if (soft) b.add({ key: 'base:anchors', kind: 'base', role: 'anchor', materialId: mat(cat, 'anchor-auger', 'base')!.id, step: 'base', qty: corners });
  } else if (kind === 'deck') {
    b.add({ key: 'base:deck-brackets', kind: 'hardware', role: 'deck-bracket', materialId: mat(cat, 'bracket-corner', 'hardware')!.id, step: 'base', qty: 2 * corners });
  } else if (kind === 'raised-floor') {
    const nj = ceilE(D / JOIST_SPACING) + 1;
    for (let j = 0; j < nj; j++) {
      const v = d / 2 + ((D - d) * j) / (nj - 1);
      b.member(`base:joist${j}`, 'joist', 'base', m, [d, -w / 2, v], [W - d, -w / 2, v]);
    }
    const ply = mat(cat, 'plywood-ext-15mm', 'sheet')!;
    b.add({ key: 'base:floor', kind: 'panel', role: 'floor-sheet', materialId: ply.id, step: 'base', area: r3(W * D), width: r3(W), height: r3(D), geom: { type: 'box', c: [W / 2, 0.0075, D / 2], s: [W, 0.015, D] } });
    if ((s.elevation ?? 0) > 0) b.add({ key: 'base:knee-braces', kind: 'hardware', role: 'knee-brace', materialId: mat(cat, 'bracket-knee', 'hardware')!.id, step: 'base', qty: ceilE(W / KNEE_SPACING) + 1 });
  } else if (kind === 'none') {
    b.add({ key: 'base:masonry', kind: 'connector', role: 'masonry-screw', materialId: mat(cat, 'screw-masonry', 'fastener')!.id, step: 'base', qty: 2 * corners });
  }
  if (!layout.houseBack) return;
  // Attached: ledgers on the house wall (or the back plates of a window box) and trim that closes the wall gap.
  if (!layout.framed.includes('back')) {
    b.member('attach:ledger-top', 'ledger', 'attach', m, [0, Hb - w / 2, d / 2], [W, Hb - w / 2, d / 2], { side: 'back' });
    b.member('attach:ledger-bottom', 'ledger', 'attach', m, [0, w / 2, d / 2], [W, w / 2, d / 2], { side: 'back' });
  }
  b.add({ key: 'attach:ledger-screws', kind: 'connector', role: 'ledger-screw', materialId: mat(cat, 'screw-structural-5in', 'fastener')!.id, step: 'attach', qty: 2 * (ceilE(W / LEDGER_SCREW_SPACING) + 1) });
  const trim = mat(cat, 'board-1x2-furring', 'lumber')!;
  b.member('attach:seal-left', 'seal', 'attach', trim, [0, 0, 0], [0, Hb, 0], { side: 'back' });
  b.member('attach:seal-right', 'seal', 'attach', trim, [W, 0, 0], [W, Hb, 0], { side: 'back' });
  b.member('attach:seal-top', 'seal', 'attach', trim, [0, Hb, 0], [W, Hb, 0], { side: 'back' });
  if (s.template === 'window-box') b.member('attach:seal-bottom', 'seal', 'attach', trim, [0, 0, 0], [W, 0, 0], { side: 'back' });
}

function vestibule(b: Builder, c: Ctx, m: Material, mesh: Material, o: StructureOpening) {
  // A small three-sided box in front of the front wall with its own self-closing door.
  const depth = o.depth ?? VESTIBULE_DEPTH;
  const sub: Structure = { ...c.s, width: o.width, depth, height: o.height, lowHeight: o.height, template: 'lean-to', openings: [], furnishings: [] };
  const vb = new Builder(c.s, b.stock, [b.origin[0] + o.offset, b.origin[1] + c.D], `${b.prefix}vest:${o.id}:`);
  const vc: Ctx = { ...c, s: sub, W: o.width, D: depth, Hb: o.height, Hf: o.height, layout: { framed: ['front', 'left', 'right'], meshed: ['front', 'left', 'right'], houseBack: true } };
  const doorW = Math.min(0.76, o.width - 2 * c.w - 0.1);
  const door: StructureOpening = { id: `${o.id}-door`, kind: 'human-door', side: 'front', offset: (o.width - doorW) / 2, width: doorW, height: Math.min(1.83, o.height - 2 * c.w - 0.02), swing: 'out', hinge: 'left', latch: o.latch ?? 'hasp', selfClosing: true };
  const doorFits = doorW > 0.4 && door.height > 1;
  for (const side of vc.layout.framed) walls(vb, vc, m, mesh, { side, meshed: true, openings: side === 'front' && doorFits ? [door] : [] });
  if (doorFits) openingHardware(vb, vc, m, mesh, door);
  roof(vb, { ...vc, s: { ...sub, roof: { kind: 'mesh' } } }, m, mesh);
  b.parts.push(...vb.parts);
}

function furnish(b: Builder, c: Ctx, f: Furnishing) {
  const { cat, W, d } = c;
  const comp = cat.component(f.componentId)!;
  const k = `furn:${f.id}`;
  const len = f.length ?? comp.defaults.length;
  const depth = comp.defaults.depth;
  const y = f.mountHeight;
  const m = (role: string) => cat.material(comp.materials[role])!;
  // Inner face of a wall, `inset` metres in from its centre plane.
  const inner = (side: Side, t: number, inset: number): Vec2 => {
    const p = sidePoint(c, side, t);
    const n = outward(side);
    return [p[0] - n[0] * inset, p[1] - n[1] * inset];
  };
  const screws: number[] = [0, 0]; // [3″ frame screws, 1¼″ screws]
  switch (comp.recipe) {
    case 'board-shelf': {
      const side = f.side as Side;
      const a = inner(side, f.offset, d / 2 + depth / 2), z = inner(side, f.offset + len, d / 2 + depth / 2);
      b.member(`${k}:board`, 'shelf-board', 'furnish', m('board'), [a[0], y, a[1]], [z[0], y, z[1]], { ownerId: f.id, side });
      const nb = ceilE(len / 0.6) + 1;
      b.add({ key: `${k}:brackets`, kind: 'hardware', role: 'bracket', materialId: m('bracket').id, step: 'furnish', qty: nb, ownerId: f.id });
      screws[0] += 4 * nb;
      break;
    }
    case 'board-ramp': {
      const side = f.side as Side;
      const run = len > y ? Math.sqrt(len * len - y * y) : len * 0.7;
      const a = inner(side, f.offset, d / 2 + depth / 2), z = inner(side, f.offset + run, d / 2 + depth / 2);
      b.member(`${k}:board`, 'ramp-board', 'furnish', m('board'), [a[0], 0.02, a[1]], [z[0], y, z[1]], { ownerId: f.id, side });
      const nc = Math.floor(len / CLEAT_SPACING + 1e-9);
      const cleat = m('cleat');
      const board = m('board');
      for (let i = 1; i <= nc; i++) {
        const t = (i - 0.5) / nc;
        const p = inner(side, f.offset + run * t, d / 2 + depth / 2);
        const half = ((board.actual?.[1] ?? 0.235) - 0.02) / 2;
        const across = outward(side);
        b.member(`${k}:cleat${i}`, 'ramp-cleat', 'furnish', cleat, [p[0] - across[0] * half, 0.03 + y * t, p[1] - across[1] * half], [p[0] + across[0] * half, 0.03 + y * t, p[1] + across[1] * half], { ownerId: f.id, side });
      }
      b.add({ key: `${k}:brackets`, kind: 'hardware', role: 'bracket', materialId: m('bracket').id, step: 'furnish', qty: 2, ownerId: f.id });
      screws[0] += 8;
      screws[1] += 2 * nc;
      break;
    }
    case 'board-bridge': {
      const span = f.length ?? W - 2 * d;
      const u0 = (W - span) / 2;
      b.member(`${k}:board`, 'bridge-board', 'furnish', m('board'), [u0, y, f.offset], [u0 + span, y, f.offset], { ownerId: f.id, side: 'span' });
      b.add({ key: `${k}:brackets`, kind: 'hardware', role: 'bracket', materialId: m('bracket').id, step: 'furnish', qty: 2, ownerId: f.id });
      screws[0] += 8;
      break;
    }
    case 'post-scratcher': {
      const side = f.side as Side;
      const post = m('post');
      const p = inner(side, f.offset + (post.actual?.[1] ?? 0.089) / 2, d / 2 + (post.actual?.[1] ?? 0.089) / 2);
      b.member(`${k}:post`, 'scratch-post', 'furnish', post, [p[0], 0, p[1]], [p[0], y, p[1]], { ownerId: f.id, side });
      b.add({ key: `${k}:rope`, kind: 'kit', role: 'sisal', materialId: m('rope').id, step: 'furnish', length: r3(y * ROPE_PER_M), ownerId: f.id });
      b.add({ key: `${k}:brackets`, kind: 'hardware', role: 'bracket', materialId: m('bracket').id, step: 'furnish', qty: 2, ownerId: f.id });
      screws[0] += 8;
      break;
    }
    case 'kit': {
      const L = comp.defaults.length, Dp = comp.defaults.depth;
      const hgt = comp.category === 'planter' ? 0.3 : comp.id === 'litter-annex' ? 0.6 : comp.id === 'cubby' ? 0.4 : comp.id === 'hammock' ? 0.12 : comp.id === 'bed' ? 0.15 : 0.12;
      let cpos: Vec2;
      if (f.side === 'span') cpos = [W / 2, f.offset];
      else cpos = inner(f.side, f.offset + L / 2, d / 2 + Dp / 2);
      const rot = f.side === 'left' || f.side === 'right';
      b.add({ key: `${k}:kit`, kind: 'kit', role: comp.id, materialId: m('kit').id, step: 'furnish', ownerId: f.id, side: f.side, geom: { type: 'box', c: [cpos[0], y + hgt / 2, cpos[1]], s: rot ? [Dp, hgt, L] : [L, hgt, Dp] } });
      break;
    }
  }
  return screws;
}

function boxStructure(s: Structure, cat: Catalog, project: Project | undefined, res: StructureResult) {
  const c = ctxFor(s, cat);
  const m = frameMaterial(s, cat);
  const mesh = meshMaterial(s, cat);
  const b = new Builder(s, project?.assumptions?.stockLengths ?? []);
  const placed: StructureOpening[] = [];
  for (const o of s.openings ?? []) {
    if (openingFits(s, o, cat, placed)) placed.push(o);
    else res.skippedOpenings.push(o.id);
  }
  const framedOpenings = placed.filter((o) => o.kind !== 'window-access' && o.kind !== 'vestibule');
  for (const side of c.layout.framed) walls(b, c, m, mesh, { side, meshed: c.layout.meshed.includes(side), openings: framedOpenings.filter((o) => o.side === side) });
  roof(b, c, m, mesh);
  base(b, c, m, mesh, project);
  for (const o of placed) {
    if (o.kind === 'vestibule') vestibule(b, c, m, mesh, o);
    else openingHardware(b, c, m, mesh, o);
  }
  const screws = [0, 0];
  for (const f of s.furnishings ?? []) {
    if (!furnishingFits(s, f, cat)) { res.skippedFurnishings.push(f.id); continue; }
    const [a, z] = furnish(b, c, f);
    screws[0] += a; screws[1] += z;
  }
  fasteners(b, cat, screws, c.layout.framed.length + placed.filter((o) => o.kind === 'vestibule').length * 3, s.base?.kind === 'deck' ? (c.layout.houseBack ? 2 : 4) : 0);
  res.parts.push(...b.parts);
}

/** Frame screws, corner brackets, mesh screws/washers and trim screws for everything built so far. */
function fasteners(b: Builder, cat: Catalog, extra: number[], wallCount: number, deckCorners: number) {
  let frame = extra[0], small = extra[1], meshCount = 0;
  for (const p of b.parts) {
    if (p.kind === 'member' && FRAME_ROLES.has(p.role)) frame += SCREWS_PER_MEMBER;
    if (p.kind === 'member' && p.role === 'seal') small += ceilE((p.length ?? 0) / STAPLE_SPACING) + 1;
    if (p.kind === 'panel' && (p.role === 'mesh-wall' || p.role === 'mesh-roof' || p.role === 'mesh-door' || p.role === 'mesh-tunnel')) meshCount += meshFasteners(p.width ?? 0, p.height ?? 0) * p.qty;
  }
  frame += 8 * deckCorners;
  b.add({ key: 'fasten:frame-screws', kind: 'connector', role: 'frame-screw', materialId: mat(cat, 'screw-ext-3in', 'fastener')!.id, step: 'walls', qty: frame });
  b.add({ key: 'fasten:corner-brackets', kind: 'hardware', role: 'corner-bracket', materialId: mat(cat, 'bracket-corner', 'hardware')!.id, step: 'walls', qty: 4 * wallCount });
  if (meshCount + small > 0) b.add({ key: 'fasten:mesh-screws', kind: 'connector', role: 'mesh-screw', materialId: mat(cat, 'screw-ext-1in-washer', 'fastener')!.id, step: 'mesh', qty: meshCount + small });
  if (meshCount > 0) b.add({ key: 'fasten:mesh-washers', kind: 'connector', role: 'mesh-washer', materialId: mat(cat, 'washer-fender-1in', 'fastener')!.id, step: 'mesh', qty: meshCount });
}

// ---------- tunnels ----------

function tunnelStructure(s: Structure, cat: Catalog, project: Project | undefined, res: StructureResult) {
  const m = frameMaterial(s, cat);
  const mesh = meshMaterial(s, cat);
  const [d, w] = (m.actual ?? [0.038, 0.038]) as [number, number];
  const b = new Builder(s, project?.assumptions?.stockLengths ?? []);
  const pts = (s.path ?? []).filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 0.05);
  if (pts.length < 2) return;
  const W = s.width, H = s.height, half = W / 2;
  const rollW = mesh.rollWidth ?? 0.9;
  const segs = pts.slice(0, -1).map((a, i) => {
    const z = pts[i + 1];
    const L = Math.hypot(z[0] - a[0], z[1] - a[1]);
    const e: Vec2 = [(z[0] - a[0]) / L, (z[1] - a[1]) / L];
    return { a, z, L, e, n: [-e[1], e[0]] as Vec2, bays: bayCount(L, s.frame.maxPostSpacing, rollW) };
  });
  const off = (p: Vec2, n: Vec2, k: number): Vec2 => [p[0] + n[0] * k, p[1] + n[1] * k];
  const P3 = (p: Vec2, y: number): Vec3 => [p[0], y, p[1]];
  // Hoops: every bay start of every segment, plus the very end.
  const hoops: { p: Vec2; n: Vec2 }[] = [];
  for (const sg of segs) for (let i = 0; i < sg.bays; i++) hoops.push({ p: off(sg.a, sg.e, (sg.L * i) / sg.bays), n: sg.n });
  hoops.push({ p: segs[segs.length - 1].z, n: segs[segs.length - 1].n });
  hoops.forEach((h, i) => {
    const l = off(h.p, h.n, half - d / 2), r = off(h.p, h.n, -(half - d / 2));
    b.member(`hoop${i}:post-l`, 'hoop-post', 'walls', m, P3(l, w), P3(l, H - w));
    b.member(`hoop${i}:post-r`, 'hoop-post', 'walls', m, P3(r, w), P3(r, H - w));
    b.member(`hoop${i}:top`, 'hoop-bar', 'walls', m, P3(off(h.p, h.n, half), H - w / 2), P3(off(h.p, h.n, -half), H - w / 2));
    b.member(`hoop${i}:bottom`, 'hoop-bar', 'walls', m, P3(off(h.p, h.n, half - d), w / 2), P3(off(h.p, h.n, -(half - d)), w / 2));
  });
  segs.forEach((sg, k) => {
    for (const [key, side, y] of [['rail-tl', 1, H - w / 2], ['rail-tr', -1, H - w / 2], ['rail-bl', 1, w / 2], ['rail-br', -1, w / 2]] as const)
      b.member(`seg${k}:${key}`, 'tunnel-rail', 'walls', m, P3(off(sg.a, sg.n, side * (half - d / 2)), y), P3(off(sg.z, sg.n, side * (half - d / 2)), y));
    for (let i = 0; i < sg.bays; i++) {
      const p0 = off(sg.a, sg.e, (sg.L * i) / sg.bays), p1 = off(sg.a, sg.e, (sg.L * (i + 1)) / sg.bays);
      const bl = sg.L / sg.bays;
      const L0 = off(p0, sg.n, half), L1 = off(p1, sg.n, half), R0 = off(p0, sg.n, -half), R1 = off(p1, sg.n, -half);
      b.mesh(`seg${k}:bay${i}:side-l`, 'mesh-tunnel', 'mesh', mesh, bl, H, [P3(L0, 0), P3(L1, 0), P3(L1, H), P3(L0, H)]);
      b.mesh(`seg${k}:bay${i}:side-r`, 'mesh-tunnel', 'mesh', mesh, bl, H, [P3(R0, 0), P3(R1, 0), P3(R1, H), P3(R0, H)]);
      b.mesh(`seg${k}:bay${i}:top`, 'mesh-tunnel', 'mesh', mesh, bl, W, [P3(L0, H), P3(L1, H), P3(R1, H), P3(R0, H)]);
    }
  });
  // Outside wedge at each bend.
  for (let v = 1; v < segs.length; v++) {
    const e0 = segs[v - 1].e, e1 = segs[v].e;
    const theta = Math.abs(Math.atan2(e0[0] * e1[1] - e0[1] * e1[0], e0[0] * e1[0] + e0[1] * e1[1]));
    if (theta <= 0.01) continue;
    const wedge = W * Math.tan(Math.min(theta, 1.4) / 2);
    const c = segs[v].a;
    const g = (y: number): [Vec3, Vec3, Vec3, Vec3] => [P3(off(c, e0, -wedge / 2), y), P3(off(c, e0, wedge / 2), y), P3(off(c, e0, wedge / 2), y + 0.001), P3(off(c, e0, -wedge / 2), y + 0.001)];
    b.mesh(`corner${v}:side`, 'mesh-tunnel', 'mesh', mesh, wedge, H, g(0));
    b.mesh(`corner${v}:top`, 'mesh-tunnel', 'mesh', mesh, wedge, W, g(H));
  }
  const openings: StructureOpening[] = [];
  for (const o of s.openings ?? []) (openingFits(s, o, cat) ? openings.push(o) : res.skippedOpenings.push(o.id));
  for (const [end, sideKey] of [['start', 'back'], ['end', 'front']] as const) {
    const h = end === 'start' ? hoops[0] : hoops[hoops.length - 1];
    const here = openings.filter((o) => o.side === sideKey);
    if (!here.some((o) => o.kind === 'window-access'))
      b.mesh(`end-${end}:mesh`, 'mesh-tunnel', 'mesh', mesh, W, H, [P3(off(h.p, h.n, half), 0), P3(off(h.p, h.n, -half), 0), P3(off(h.p, h.n, -half), H), P3(off(h.p, h.n, half), H)]);
    for (const o of here) b.add({ key: `${sideKey}:${o.kind}:${o.id}:kit`, kind: 'kit', role: o.kind === 'cat-door' ? 'cat-door' : 'window-insert', materialId: cat.material(o.kind === 'cat-door' ? 'kit-cat-door' : 'kit-window-insert')!.id, step: 'openings', ownerId: o.id, geom: { type: 'box', c: P3(h.p, (o.sill ?? 0) + o.height / 2), s: [o.width, o.height, 0.03] } });
  }
  const length = segs.reduce((a, sg) => a + sg.L, 0);
  const kind = s.base?.kind ?? 'ground-skirt';
  const soft = ['grass', 'soil'].includes(project?.site?.ground ?? 'grass');
  if (kind === 'ground-skirt') {
    const depth = s.base.skirtDepth ?? SKIRT_DEPTH;
    const perimeter = 2 * length + 2 * W;
    b.add({ key: 'base:skirt', kind: 'panel', role: 'mesh-skirt', materialId: mesh.id, step: 'skirt', width: r3(depth), height: r3(perimeter), rollLength: r3((perimeter * depth) / rollW) });
    b.add({ key: 'base:staples', kind: 'connector', role: 'staple', materialId: cat.material('staple-landscape')!.id, step: 'skirt', qty: ceilE(perimeter / STAPLE_SPACING) + 2 });
    if (soft) b.add({ key: 'base:anchors', kind: 'base', role: 'anchor', materialId: cat.material('anchor-auger')!.id, step: 'base', qty: 4 });
  } else if (kind === 'pavers') {
    const paver = cat.material('paver-16in')!;
    const n = 2 * segs.reduce((a, sg) => a + ceilE(sg.L / (paver.size ?? 0.4)), 0);
    b.add({ key: 'base:pavers', kind: 'base', role: 'paver', materialId: paver.id, step: 'base', qty: n });
    b.add({ key: 'base:sand', kind: 'base', role: 'sand', materialId: cat.material('sand-leveling')!.id, step: 'base', qty: ceilE(n / 4) });
  }
  fasteners(b, cat, [0, 0], hoops.length, 0);
  res.parts.push(...b.parts);
}

// ---------- entry ----------

export function generateStructure(s: Structure, cat: Catalog, project?: Project): StructureResult {
  const t = cat.template(s.template);
  const res: StructureResult = { parts: [], conceptOnly: !!t?.conceptOnly, unsupported: limitCheck(s, cat), skippedOpenings: [], skippedFurnishings: [] };
  if (!t) return res;
  if (s.template === 'tunnel') tunnelStructure(s, cat, project, res);
  else boxStructure(s, cat, project, res);
  return res;
}
