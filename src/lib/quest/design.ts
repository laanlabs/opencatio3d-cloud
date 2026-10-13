// Pure layout edits for Catio Quest: apply a piece, move or resize a furnishing, change the catio's
// size or shape. Each returns a new Project (immutable spreads, like the planner's editor), so the real
// generator and checks re-run on exactly what the player built. Placement uses the generator's own
// `furnishingFits` / `openingFits`, so anything the game accepts the planner accepts too.
import type { Catalog } from '../catalog/catalog';
import type { Furnishing, HostWall, PlantPlacement, Project, Side, Structure, StructureOpening, TemplateId, WallOpening } from '../model/types';
import { clone, frontHeight, uid } from '../model/types';
import { alongWall } from '../model/geometry';
import { furnishingFits, layoutFor, openingFits, sideLength } from '../generate/structure';
import { newStructure } from '../site/templates';
import { PLANTER_CAPACITY, type Piece } from './pieces';

export type IdFn = () => string;
export interface EditResult { project: Project; note?: string; selectId?: string }

/** The catio being designed: the first structure that is not a tunnel. */
export const mainStructure = (p: Project): Structure | undefined => p.structures.find((s) => s.template !== 'tunnel');

function withMain(p: Project, fn: (s: Structure) => Structure): Project {
  const s = mainStructure(p);
  if (!s) return p;
  return { ...p, structures: p.structures.map((x) => (x.id === s.id ? fn(x) : x)) };
}

export const hostWall = (p: Project, s: Structure): HostWall | undefined => p.site.walls.find((w) => w.id === s.hostWallId);
export function hostWindow(p: Project, s: Structure): WallOpening | undefined {
  const w = hostWall(p, s);
  return w?.openings.find((o) => o.id === s.hostOpeningId) ?? w?.openings.find((o) => o.kind === 'window');
}

/** Lines a window insert up with the house window behind an attached catio. */
function windowInsert(p: Project, s: Structure, id: string): StructureOpening | null {
  const w = hostWall(p, s), win = hostWindow(p, s);
  if (!w || !win || !layoutFor(s.template).houseBack) return null;
  const start = alongWall(w, [s.x, s.y]);
  const offset = Math.max(0, win.offset - start);
  const sill = Math.max(0, win.sill - (s.elevation ?? 0));
  return { id, kind: 'window-access', side: 'back', offset: r3(offset), width: r3(Math.min(win.width, s.width - offset)), height: r3(Math.min(win.height, s.height - sill)), sill: r3(sill) };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

// ---------- furnishings ----------

/** Structure-local floor-plan point a distance t along a side (just inside the wall). */
function planPoint(s: Structure, side: Side, t: number): [number, number] {
  switch (side) {
    case 'back': return [t, 0.15];
    case 'front': return [t, s.depth - 0.15];
    case 'left': return [0.15, t];
    case 'right': return [s.width - 0.15, t];
  }
}

const WALL_LEVELS: Record<string, number[]> = { shelf: [0.9, 1.3, 0.5, 1.7, 2.1], hammock: [1.1, 1.5, 0.7], ramp: [0.6], 'scratcher-post': [0.9] };

/** Floor-item collision box along a side: [t0, t1]. */
const span = (f: Furnishing, len: number): [number, number] => [f.offset, f.offset + len];

function overlaps(s: Structure, f: Furnishing, cat: Catalog): boolean {
  const comp = cat.component(f.componentId)!;
  const len = f.length ?? comp.defaults.length;
  const floor = comp.mount === 'floor';
  for (const g of s.furnishings) {
    if (g.id === f.id) continue;
    const gc = cat.component(g.componentId);
    if (!gc) continue;
    if (f.side === 'span' || g.side === 'span') {
      if (f.side === 'span' && g.side === 'span' && Math.abs(f.offset - g.offset) < 0.35 && Math.abs(f.mountHeight - g.mountHeight) < 0.3) return true;
      continue;
    }
    if (g.side !== f.side) continue;
    const [a0, a1] = span(f, len), [b0, b1] = span(g, g.length ?? gc.defaults.length);
    if (a1 + 0.05 <= b0 || b1 + 0.05 <= a0) continue;
    const gFloor = gc.mount === 'floor';
    if (floor && gFloor) return true;
    if (!floor && !gFloor && Math.abs(f.mountHeight - g.mountHeight) < 0.3) return true;
    if (g.componentId === 'ramp' && floor) return true;
    if (f.componentId === 'ramp' && gFloor) return true;
  }
  // Keep floor items out of a door's swing.
  if (floor) for (const o of s.openings) {
    if (o.side !== f.side || (o.kind !== 'human-door' && o.kind !== 'vestibule' && o.kind !== 'cat-door')) continue;
    const [a0, a1] = span(f, len);
    if (!(a1 <= o.offset || o.offset + o.width <= a0)) return true;
  }
  return false;
}

/** Sides a component can go on, in preference order. */
export function sidesFor(s: Structure, mount: string): Side[] {
  const L = layoutFor(s.template);
  const all: Side[] = ['left', 'right', 'front', 'back'];
  if (mount !== 'wall') return all;
  return all.filter((side) => L.framed.includes(side) && !(L.houseBack && side === 'back' && s.template !== 'window-box'));
}

/** A free spot for a new furnishing, or null when the catio is full. Deterministic. */
export function autoPlace(s: Structure, componentId: string, cat: Catalog, id: string): Furnishing | null {
  const comp = cat.component(componentId);
  if (!comp || s.template === 'tunnel') return null;
  const minH = Math.min(s.height, frontHeight(s));
  if (comp.mount === 'span') {
    const len = r3(s.width - 0.076);
    for (const k of [0.5, 0.35, 0.65, 0.2, 0.8]) {
      for (const h of [Math.min(1.5, minH - 0.25), Math.min(1.2, minH - 0.25), Math.min(0.9, minH - 0.2)]) {
        const f: Furnishing = { id, componentId, side: 'span', offset: r3(s.depth * k), mountHeight: r3(Math.max(0.3, h)), length: len };
        if (furnishingFits(s, f, cat) && !overlaps(s, f, cat)) return f;
      }
    }
    return null;
  }
  const levels = comp.mount === 'wall' || comp.recipe === 'post-scratcher' ? WALL_LEVELS[componentId] ?? [comp.defaults.mountHeight] : [0];
  const existingShelves = new Set(s.furnishings.filter((f) => f.componentId === 'shelf' || f.componentId === 'hammock').map((f) => Math.round(f.mountHeight * 10)));
  const ordered = componentId === 'shelf' ? [...levels.filter((h) => !existingShelves.has(Math.round(h * 10))), ...levels] : levels;
  for (const hRaw of ordered) {
    const h = Math.min(hRaw, Math.max(0, minH - 0.2));
    let len = comp.defaults.length;
    if (componentId === 'ramp') {
      // The ramp should lead somewhere: up to the window ledge, or to the lowest shelf.
      const wa = s.openings.find((o) => o.kind === 'window-access');
      const shelf = s.furnishings.filter((f) => f.componentId === 'shelf' && f.mountHeight <= 1.0).sort((a, b) => a.mountHeight - b.mountHeight)[0];
      const top = wa && (wa.sill ?? 0) <= 1.0 && (wa.sill ?? 0) >= 0.3 ? wa.sill! : shelf ? shelf.mountHeight : h;
      const target: [number, number] = wa ? [wa.offset + wa.width / 2, 0] : shelf ? planPoint(s, shelf.side as Side, shelf.offset + (shelf.length ?? 0.6) / 2) : [s.width / 2, s.depth / 2];
      let best: { f: Furnishing; d: number } | null = null;
      for (const side of sidesFor(s, comp.mount)) {
        const L = sideLength(side, s.width, s.depth);
        for (const ramp of [Math.min(2, Math.max(0.8, top * 1.8)), 1.4, 1.2, 1.0]) {
          const run = ramp > top ? Math.sqrt(ramp * ramp - top * top) : ramp * 0.7;
          for (let t = 0.05; t + run <= L - 0.05 + 1e-9; t += 0.1) {
            const f: Furnishing = { id, componentId, side, offset: r3(t), mountHeight: r3(top), length: r3(ramp) };
            if (!furnishingFits(s, f, cat) || overlaps(s, f, cat)) continue;
            const [u, v] = planPoint(s, side, t + run);
            const d = Math.hypot(u - target[0], v - target[1]);
            if (!best || d < best.d - 1e-9) best = { f, d };
          }
        }
      }
      return best?.f ?? null;
    }
    for (const side of sidesFor(s, comp.mount)) {
      const L = sideLength(side, s.width, s.depth);
      if (componentId === 'shelf') len = Math.min(0.6, Math.max(0.3, L - 0.2));
      for (let t = 0.05; t + len <= L - 0.04 + 1e-9; t += 0.1) {
        const f: Furnishing = { id, componentId, side, offset: r3(t), mountHeight: r3(h), ...(componentId === 'shelf' ? { length: r3(len) } : {}) };
        if (furnishingFits(s, f, cat) && !overlaps(s, f, cat)) return f;
      }
    }
  }
  return null;
}

export function updateFurnishing(p: Project, id: string, patch: Partial<Furnishing>, cat: Catalog): EditResult {
  let note: string | undefined;
  const project = withMain(p, (s) => ({
    ...s,
    furnishings: s.furnishings.map((f) => {
      if (f.id !== id) return f;
      const comp = cat.component(f.componentId);
      const next = { ...f, ...patch };
      if (comp && next.side !== 'span') {
        const L = sideLength(next.side as Side, s.width, s.depth);
        const len = next.componentId === 'ramp' ? rampRun(next) : next.length ?? comp.defaults.length;
        next.offset = r3(Math.max(0, Math.min(next.offset, L - len)));
      } else if (next.side === 'span') next.offset = r3(Math.max(0.1, Math.min(next.offset, s.depth - 0.1)));
      if (comp && !furnishingFits({ ...s, furnishings: [] }, next, cat)) note = `That spot doesn’t fit the ${comp.name.toLowerCase()} — it’s marked until you move it.`;
      return next;
    })
  }));
  return { project, note };
}

export const rampRun = (f: Furnishing) => {
  const len = f.length ?? 1;
  return len > f.mountHeight ? Math.sqrt(len * len - f.mountHeight * f.mountHeight) : len * 0.7;
};

// ---------- openings ----------

function openingFor(p: Project, s: Structure, kind: StructureOpening['kind'], cat: Catalog, id: string): StructureOpening | string {
  const attached = layoutFor(s.template).houseBack;
  const Hf = frontHeight(s);
  const others = s.openings;
  const tryOffsets = (o: StructureOpening): StructureOpening | null => {
    const L = sideLength(o.side, s.width, s.depth);
    const centre = (L - o.width) / 2;
    for (let k = 0; k < 40; k++) {
      const t = centre + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.1;
      const cand = { ...o, offset: r3(t) };
      if (t >= 0 && openingFits(s, cand, cat, others)) return cand;
    }
    return null;
  };
  switch (kind) {
    case 'window-access': {
      if (others.some((o) => o.kind === 'window-access')) return 'There’s already a window insert.';
      const o = attached ? windowInsert(p, s, id) : null;
      return o && openingFits(s, o, cat, others) ? o : 'A window insert needs the catio against the house, over a window.';
    }
    case 'human-door': {
      if (s.template === 'window-box') return 'A people door won’t fit a window box — use a cleaning hatch.';
      const h = r3(Math.min(1.829, Hf - 0.15));
      const o = tryOffsets({ id, kind, side: 'front', offset: 0, width: 0.762, height: h, swing: 'out', hinge: 'left', latch: 'hasp', selfClosing: true });
      return o ?? 'No room on the front wall for a door. Make the catio wider or taller.';
    }
    case 'cleaning-hatch': {
      const w = r3(Math.min(0.5, s.width - 0.3)), h = r3(Math.min(0.45, Hf * 0.5));
      const o = tryOffsets({ id, kind, side: 'front', offset: 0, width: w, height: h, sill: 0.1, swing: 'out', hinge: 'left', latch: 'slide-bolt' });
      return o ?? 'No room for a hatch on the front wall.';
    }
    case 'cat-door': {
      const side: Side = attached ? 'left' : 'back';
      const o = tryOffsets({ id, kind, side, offset: 0, width: 0.25, height: 0.3, sill: 0.1 });
      return o ?? 'No room for a cat door.';
    }
    case 'vestibule': {
      if (others.some((o) => o.kind === 'vestibule')) return 'There’s already a vestibule.';
      const door = others.find((o) => o.kind === 'human-door' && o.side === 'front');
      if (!door) return 'Add a people door on the front first — the vestibule goes around it.';
      const o: StructureOpening = { id, kind, side: 'front', offset: r3(Math.max(0, door.offset - 0.1)), width: r3(Math.min(s.width - Math.max(0, door.offset - 0.1), door.width + 0.2)), height: r3(Math.max(1, Math.min(1.9, door.height + 0.1))), depth: 0.9, swing: 'out', hinge: 'left', latch: 'slide-bolt', selfClosing: true };
      return openingFits(s, o, cat, others) ? o : 'The vestibule doesn’t fit here.';
    }
  }
}

export function updateOpening(p: Project, id: string, patch: Partial<StructureOpening>): Project {
  return withMain(p, (s) => ({ ...s, openings: s.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
}

// ---------- plants ----------

function addPlant(p: Project, plantId: string, cat: Catalog, ids: IdFn): EditResult {
  let s = mainStructure(p);
  if (!s) return { project: p };
  const used = (f: Furnishing) => p.plants.filter((pl) => pl.furnishingId === f.id).length;
  let planter = s.furnishings.find((f) => (PLANTER_CAPACITY[f.componentId] ?? 0) > used(f));
  let project = p;
  if (!planter) {
    const f = autoPlace(s, 'planter-small', cat, ids());
    if (!f) return { project: p, note: 'No room for a planter. Move something or make the catio bigger.' };
    s = { ...s, furnishings: [...s.furnishings, f] };
    project = withMain(p, () => s!);
    planter = f;
  }
  const pl: PlantPlacement = { id: ids(), plantId, structureId: s.id, furnishingId: planter.id };
  return { project: { ...project, plants: [...project.plants, pl] }, selectId: planter.id };
}

// ---------- shape and size ----------

/** Re-seats an attached catio on its wall, centred on the window, after a size change. */
function reseat(p: Project, s: Structure): Structure {
  const w = hostWall(p, s), win = hostWindow(p, s);
  if (!w || !layoutFor(s.template).houseBack) return s;
  const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const centre = win ? win.offset + win.width / 2 : L / 2;
  const start = Math.max(0, Math.min(L - s.width, centre - s.width / 2));
  const d: [number, number] = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
  const next = { ...s, x: r3(w.a[0] + d[0] * start), y: r3(w.a[1] + d[1] * start) };
  const wa = next.openings.find((o) => o.kind === 'window-access');
  if (wa) {
    const fresh = windowInsert(p, next, wa.id);
    next.openings = next.openings.map((o) => (o.id === wa.id && fresh ? fresh : o));
  }
  return next;
}

export type SizeField = 'width' | 'depth' | 'height';

export function setSize(p: Project, field: SizeField, value: number, cat: Catalog, limits?: Partial<Record<SizeField, [number, number]>>): Project {
  return withMain(p, (s) => {
    const t = cat.template(s.template);
    const lim = limits?.[field] ?? t?.limits[field];
    const v = r3(lim ? Math.max(lim[0], Math.min(lim[1], value)) : value);
    let next: Structure = { ...s, [field]: v };
    if (field === 'height' && typeof s.lowHeight === 'number') {
      const drop = s.height - s.lowHeight;
      const lowLim = t?.limits.lowHeight;
      next.lowHeight = r3(Math.max(lowLim?.[0] ?? 0.4, Math.min(v, v - drop)));
    }
    // Keep a front door inside a shorter wall.
    next.openings = next.openings.map((o) => (o.kind === 'human-door' ? { ...o, height: r3(Math.min(o.height, frontHeight(next) - 0.15)) } : o));
    return reseat(p, next);
  });
}

/** Switch the catio's shape: template defaults, keeping the player's mesh and every furnishing that still fits. */
export function switchTemplate(p: Project, template: TemplateId, cat: Catalog, ids: IdFn): EditResult {
  const old = mainStructure(p);
  if (!old || old.template === template) return { project: p };
  const t = cat.template(template);
  if (!t) return { project: p };
  const wall = p.site.walls[0];
  const win = wall?.openings.find((o) => o.kind === 'window');
  const fresh = newStructure(template, cat, t.attached && wall ? { wall, opening: win } : { x: old.template === 'freestanding' ? old.x : 1.2, y: old.template === 'freestanding' ? old.y : 2.6 });
  const s: Structure = { ...fresh, id: old.id, name: t.name, mesh: cat.material(old.mesh.materialId) ? old.mesh : fresh.mesh, furnishings: [], openings: fresh.openings.map((o) => ({ ...o, id: ids() })) };
  const kept: Furnishing[] = [];
  for (const f of old.furnishings) {
    const trial = { ...s, furnishings: kept };
    const placed = furnishingFits(trial, f, cat) && !overlaps(trial, f, cat) ? f : autoPlace(trial, f.componentId, cat, f.id);
    if (placed) kept.push(placed);
  }
  const next = { ...s, furnishings: kept };
  const keptIds = new Set(kept.map((f) => f.id));
  const lost = old.furnishings.length - kept.length;
  return {
    project: { ...p, structures: p.structures.map((x) => (x.id === old.id ? next : x)), plants: p.plants.filter((pl) => !pl.furnishingId || keptIds.has(pl.furnishingId)) },
    note: lost ? `${lost} item${lost === 1 ? '' : 's'} didn’t fit the ${t.name.toLowerCase()} and went back in the tray.` : undefined
  };
}

// ---------- the tray ----------

export function applyPiece(p: Project, pc: Piece, cat: Catalog, ids: IdFn = uid, allowed?: TemplateId[]): EditResult {
  const s = mainStructure(p);
  const a = pc.action;
  if (a.kind === 'template') {
    if (allowed && !allowed.includes(a.template)) return { project: p, note: `This household’s site doesn’t suit a ${pc.name.toLowerCase()}.` };
    return switchTemplate(p, a.template, cat, ids);
  }
  if (!s) return { project: p };
  switch (a.kind) {
    case 'mesh': return { project: withMain(p, (x) => ({ ...x, mesh: { ...x.mesh, materialId: a.materialId } })) };
    case 'roof': return { project: withMain(p, (x) => ({ ...x, roof: { kind: a.roof, ...(a.materialId ? { materialId: a.materialId } : {}), ...(a.coverFraction ? { coverFraction: a.coverFraction } : {}) } })) };
    case 'base': {
      if (s.template === 'window-box' && a.base !== 'raised-floor') return { project: p, note: 'A window box always has its own raised floor.' };
      return { project: withMain(p, (x) => ({ ...x, base: a.base === 'ground-skirt' ? { kind: a.base, skirtDepth: 0.3 } : { kind: a.base } })) };
    }
    case 'opening': {
      const o = openingFor(p, s, a.opening, cat, ids());
      if (typeof o === 'string') return { project: p, note: o };
      return { project: withMain(p, (x) => ({ ...x, openings: [...x.openings, o] })), selectId: o.id };
    }
    case 'furnishing': {
      const f = autoPlace(s, a.componentId, cat, ids());
      if (!f) return { project: p, note: `No free spot for the ${pc.name.toLowerCase()}. Move something, or make the catio bigger.` };
      return { project: withMain(p, (x) => ({ ...x, furnishings: [...x.furnishings, f] })), selectId: f.id };
    }
    case 'plant': return addPlant(p, a.plantId, cat, ids);
  }
}

/** Removes a furnishing (and the plants in it), an opening or a plant. */
export function removeItem(p: Project, id: string): Project {
  if (p.plants.some((pl) => pl.id === id)) return { ...p, plants: p.plants.filter((pl) => pl.id !== id) };
  const next = withMain(p, (s) => ({ ...s, furnishings: s.furnishings.filter((f) => f.id !== id), openings: s.openings.filter((o) => o.id !== id) }));
  return { ...next, plants: next.plants.filter((pl) => pl.furnishingId !== id) };
}

export const cloneProject = (p: Project) => clone(p);
