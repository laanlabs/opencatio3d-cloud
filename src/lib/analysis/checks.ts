// Design checks: project + catalog (+ generated assembly) → findings. Rule wording, severity and
// sources come from the catalog's rule records (rules.json); the logic for each id lives here and in
// the iOS port, and is pinned by tests/checks.test.ts and the parity fixtures. Language rule: findings
// never say "safe" or "approved" — with no findings the UI says "No issue detected by the current rules".
import type { Catalog, Severity } from '../catalog/catalog';
import type { Furnishing, HostWall, Project, Structure, Vec2 } from '../model/types';
import { frontHeight, stableId } from '../model/types';
import { convexOverlap, dist, distToSegment, footprintArea, footprints, pointInPolygon, rectCorners, toPlan, wallDir } from '../model/geometry';
import type { Assembly } from '../generate/assembly';
import { frameMaterial, layoutFor, meshMaterial } from '../generate/structure';
import { fieldValue, keyFields } from '../site/templates';

export interface Finding {
  id: string;
  ruleId: string;
  ruleVersion: number;
  severity: Severity;
  title: string;
  message: string;
  remediation: string;
  /** Structure, opening, furnishing or plant ids; [] for project-level findings. */
  targetIds: string[];
  sources: { id: string; title: string; url: string }[];
  acknowledgeable: boolean;
  reviewable: boolean;
  status: 'open' | 'acknowledged' | 'reviewed';
  note?: string;
}

export const SEVERITY_ORDER: Severity[] = ['blocker', 'warning', 'advisory', 'info'];
const SOFT = new Set(['grass', 'soil']);
const SOLID_ROOFS = new Set(['corrugated', 'polycarbonate', 'partial']);
/** Top of a floor-standing perch (its kit height); wall perches use their mount height. */
const PERCH_TOP: Record<string, number> = { cubby: 0.4 };
/** Mesh openings whose short side is at least this let cats through (CAT-ENC-001). */
export const ESCAPE_OPENING = 0.05;
/** Mesh openings wider than this are too big for kittens and small cats (CAT-ENC-002). */
export const KITTEN_OPENING = 0.026;

/** Local (u, v) centre of a furnishing on the floor plan of its structure. */
export function furnishingCentre(s: Structure, f: Furnishing, len: number): Vec2 {
  const t = f.offset + len / 2;
  switch (f.side) {
    case 'back': return [t, 0];
    case 'front': return [t, s.depth];
    case 'left': return [0, t];
    case 'right': return [s.width, t];
    default: return [s.width / 2, f.offset];
  }
}

/** Where an attached structure's back edge sits along its host wall ([start, end] from wall.a), or null if it is not on the wall. */
export function wallSpan(s: Structure, w: HostWall): [number, number] | null {
  const p0 = toPlan(s, 0, 0), p1 = toPlan(s, s.width, 0);
  if (distToSegment(p0, w.a, w.b) > 0.3 || distToSegment(p1, w.a, w.b) > 0.3) return null;
  const d = wallDir(w);
  const along = (p: Vec2) => (p[0] - w.a[0]) * d[0] + (p[1] - w.a[1]) * d[1];
  const a = along(p0), b = along(p1);
  return [Math.min(a, b), Math.max(a, b)];
}

/** Key dimensions of a structure that are not confirmed at their current value. */
export function unconfirmed(p: Project, s: Structure): string[] {
  return keyFields(s).filter((field) => {
    const m = p.site.measurements.find((x) => x.targetId === s.id && x.field === field);
    return !m || !m.confirmed || Math.abs(m.value - fieldValue(s, field)) > 0.005;
  });
}

export function runChecks(p: Project, cat: Catalog, a?: Assembly): Finding[] {
  const out: Finding[] = [];
  const emit = (ruleId: string, targetIds: string[], detail?: string) => {
    const r = cat.rule(ruleId);
    if (!r) return;
    const target = targetIds[0] ?? '';
    const ack = p.overrides.find((o) => o.ruleId === ruleId && (o.targetId ?? '') === target);
    const status = ack && ack.kind === 'professional-review' && r.reviewable ? 'reviewed' : ack && ack.kind === 'acknowledge' && r.acknowledgeable ? 'acknowledged' : 'open';
    out.push({
      id: stableId(`${ruleId}:${targetIds.join(',')}`), ruleId, ruleVersion: r.version, severity: r.severity, title: r.title,
      message: detail ? `${detail} ${r.explanation}` : r.explanation, remediation: r.remediation, targetIds,
      sources: r.sources.map((id) => cat.source(id)).filter((x) => !!x).map((x) => ({ id: x!.id, title: x!.title, url: x!.url })),
      acknowledgeable: r.acknowledgeable, reviewable: r.reviewable, status, ...(status !== 'open' ? { note: ack!.note } : {})
    });
  };
  const climate = p.region?.climate;
  const ground = p.site.ground;
  const cats = p.cats ?? [];
  const smallCats = cats.some((c) => c.ageClass === 'kitten' || c.size === 'small');
  const escapeProne = cats.some((c) => c.escapeRisk === 'high');
  const lessMobile = cats.some((c) => c.ageClass === 'senior' || c.mobility !== 'full');

  for (const s of p.structures) {
    const t = cat.template(s.template);
    const info = a?.structures.find((x) => x.id === s.id);
    const name = s.name || t?.name || 'Structure';
    const tunnel = s.template === 'tunnel';
    const layout = layoutFor(s.template);
    const elev = s.elevation ?? 0;
    const Hb = s.height, Hf = frontHeight(s);

    // ---------- buildability & supported sizes ----------
    if (t?.conceptOnly) emit('CAT-BLD-004', [s.id], `${name}:`);
    if (info?.unsupported.length) emit('CAT-BLD-005', [s.id], `${name}: ${info.unsupported.join('; ')}.`);
    for (const id of info?.skippedOpenings ?? []) emit('CAT-BLD-006', [id, s.id], `${name}:`);
    for (const id of info?.skippedFurnishings ?? []) emit('CAT-BLD-007', [id, s.id], `${name}:`);
    if (a) {
      const overlong = a.cuts.materials.flatMap((m) => m.overlong).filter((c) => a.parts.find((x) => x.id === c.partId)?.structureId === s.id);
      if (overlong.length) emit('CAT-BLD-003', [s.id], `${name}: ${overlong.map((c) => `${c.label} (${Math.round(c.length * 100) / 100} m)`).join(', ')}.`);
    }
    if (s.frame.maxPostSpacing > 1.22 + 1e-9 || (s.frame.profile === 'wood-2x2' && Hb > 1.5 + 1e-9)) emit('CAT-BLD-001', [s.id], `${name}:`);
    if (!tunnel && SOLID_ROOFS.has(s.roof?.kind) && (Hb - Hf) / s.depth < 1 / 12 - 1e-9) emit('CAT-BLD-002', [s.id], `${name}:`);

    // ---------- enclosure ----------
    const mesh = meshMaterial(s, cat);
    const short = Math.min(...(mesh.opening ?? [0.0254, 0.0254]));
    if (short >= ESCAPE_OPENING - 1e-9) emit('CAT-ENC-001', [s.id], `${name}: ${mesh.name}.`);
    else if (short > KITTEN_OPENING && smallCats) emit('CAT-ENC-002', [s.id], `${name}: ${mesh.name}.`);
    if ((mesh.gauge ?? 16) >= 19) emit('CAT-ENC-003', [s.id], `${name}:`);
    if (mesh.coating === 'galvanized-before-welding') emit('CAT-MAT-001', [s.id], `${name}:`);

    const doors = (s.openings ?? []).filter((o) => o.kind === 'human-door');
    if (escapeProne && doors.length && !(s.openings ?? []).some((o) => o.kind === 'vestibule')) emit('CAT-ENC-006', [s.id], `${name}:`);

    // ---------- access ----------
    for (const o of s.openings ?? []) {
      const leaf = o.kind === 'human-door' || o.kind === 'cleaning-hatch' || o.kind === 'vestibule';
      if (leaf && !o.latch) emit('CAT-ACC-001', [o.id, s.id], `${name}:`);
      if (o.kind === 'human-door' && !o.selfClosing) emit('CAT-ACC-002', [o.id, s.id], `${name}:`);
      if (leaf && o.latch === 'gravity' && (o.swing ?? 'out') === 'out') emit('CAT-ACC-003', [o.id, s.id], `${name}:`);
      if (o.kind === 'human-door' && Hb >= 1.8 && (o.width < 0.6 - 1e-9 || o.height < 1.5 - 1e-9)) emit('CAT-ACC-004', [o.id, s.id], `${name}:`);
    }
    if (!tunnel && !(s.openings ?? []).some((o) => o.kind === 'human-door' || o.kind === 'cleaning-hatch' || o.kind === 'vestibule')) emit('CAT-ACC-005', [s.id], `${name}:`);
    if (!tunnel && layout.houseBack && !(s.openings ?? []).some((o) => o.kind === 'window-access' || o.kind === 'cat-door') && !tunnelTouches(p, s)) emit('CAT-ACC-006', [s.id], `${name}:`);
    if (tunnel && !tunnelHasEntrance(p, s)) emit('CAT-ENC-005', [s.id], `${name}:`);

    // ---------- materials ----------
    const frame = frameMaterial(s, cat);
    const onGround = elev <= 0 && (s.base?.kind === 'ground-skirt' || s.base?.kind === 'none');
    if (onGround && SOFT.has(ground) && !frame.groundContact) emit('CAT-MAT-002', [s.id], `${name}: ${frame.name}.`);
    if (frame.treatment && frame.treatment !== 'none') emit('CAT-MAT-003', [s.id], `${name}: ${frame.name}.`);

    // ---------- weather ----------
    const meshRoof = (s.roof?.kind ?? 'mesh') === 'mesh';
    if (!tunnel && meshRoof && climate?.hot) emit('CAT-WX-001', [s.id], `${name}:`);
    else if (!tunnel && meshRoof) emit('CAT-WX-002', [s.id], `${name}:`);
    if (climate?.snowLoad === 'heavy') emit('CAT-WX-003', [s.id], `${name}:`);
    if (climate?.wind === 'high') emit('CAT-WX-004', [s.id], `${name}:`);

    // ---------- ground ----------
    if (elev <= 0 && SOFT.has(ground) && (s.base?.kind === 'none' || s.base?.kind === 'deck')) emit('CAT-GND-001', [s.id], `${name}:`);
    if ((s.template === 'freestanding' || tunnel) && s.base?.kind === 'pavers' && SOFT.has(ground)) emit('CAT-GND-002', [s.id], `${name}:`);

    // ---------- house ----------
    const wall = p.site.walls.find((w) => w.id === s.hostWallId);
    const span = wall && layout.houseBack ? wallSpan(s, wall) : null;
    if (wall && span) {
      if (Hb + elev > wall.height + 1e-9) emit('CAT-HOME-006', [s.id], `${name}:`);
      const servedByInsert = (s.openings ?? []).some((o) => o.kind === 'window-access');
      for (const o of wall.openings) {
        const h0 = Math.max(span[0], o.offset), h1 = Math.min(span[1], o.offset + o.width);
        const v0 = Math.max(elev, o.sill), v1 = Math.min(elev + Hb, o.sill + o.height);
        if (h1 - h0 <= 0.01 || v1 - v0 <= 0.01) continue;
        const inside = o.offset >= span[0] - 0.01 && o.offset + o.width <= span[1] + 0.01 && o.sill >= elev - 0.01 && o.sill + o.height <= elev + Hb + 0.01;
        const label = `${name}: ${o.name || o.kind}.`;
        if (o.kind === 'dryer-vent') emit('CAT-HOME-001', [o.id, s.id], label);
        else if (o.kind === 'meter' || o.kind === 'utility') emit('CAT-HOME-002', [o.id, s.id], label);
        else if (o.kind === 'vent') emit('CAT-HOME-004', [o.id, s.id], label);
        else if (o.kind === 'downspout') emit('CAT-HOME-005', [o.id, s.id], label);
        else {
          if (o.egress) emit('CAT-HOME-003', [o.id, s.id], label);
          const served = servedByInsert && s.hostOpeningId === o.id;
          if (!inside && !served) emit('CAT-ENC-004', [o.id, s.id], label);
        }
      }
    }

    // ---------- elevation & size ----------
    if (elev > 1.8 + 1e-9) emit('CAT-ELEV-002', [s.id], `${name}: ${Math.round(elev * 100) / 100} m up.`);
    else if (elev > 0.9 + 1e-9) emit('CAT-ELEV-001', [s.id], `${name}:`);
    if (footprintArea(s) > 20 + 1e-9 || Hb > 2.7 + 1e-9) emit('CAT-ELEV-003', [s.id], `${name}:`);

    // ---------- site fit & measurements ----------
    const fps = footprints(s);
    for (const o of p.site.obstacles) {
      const r = rectCorners(o.x, o.y, o.width, o.depth, o.rotation);
      if (fps.some((f) => convexOverlap(f, r))) emit('CAT-DIM-002', [o.id, s.id], `${name}: ${o.name || o.kind}.`);
    }
    const missing = unconfirmed(p, s);
    if (missing.length) emit('CAT-DIM-001', [s.id], `${name}: ${missing.join(', ')} not confirmed.`);

    // ---------- welfare ----------
    if (!tunnel) {
      const area = footprintArea(s);
      const furn = (s.furnishings ?? []).map((f) => ({ f, c: cat.component(f.componentId) })).filter((x) => !!x.c);
      const has = (what: string) => furn.some((x) => x.c!.provides.includes(what));
      const perches = furn.filter((x) => x.c!.provides.includes('perch'));
      if (area >= 1 - 1e-9) {
        if (!has('rest') && !has('hide')) emit('CAT-WEL-001', [s.id], `${name}:`);
        if (new Set(perches.map((x) => x.f.mountHeight || PERCH_TOP[x.c!.id] || 0)).size < 2) emit('CAT-WEL-002', [s.id], `${name}:`);
        if (!has('scratch')) emit('CAT-WEL-004', [s.id], `${name}:`);
      }
      if (cats.length >= 2 && perches.length <= 1) emit('CAT-WEL-003', [s.id], `${name}:`);
      if (area >= 1.5 - 1e-9 && !has('water')) emit('CAT-WEL-005', [s.id], `${name}:`);
      const centre = (x: (typeof furn)[number]) => furnishingCentre(s, x.f, x.f.length ?? x.c!.defaults.length);
      const litter = furn.filter((x) => x.c!.provides.includes('litter')), water = furn.filter((x) => x.c!.provides.includes('water'));
      if (litter.some((l) => water.some((w) => dist(centre(l), centre(w)) < 1 - 1e-9))) emit('CAT-WEL-006', [s.id], `${name}:`);
      if (lessMobile) {
        const levels = [...new Set([0, ...perches.map((x) => x.f.mountHeight || PERCH_TOP[x.c!.id] || 0)])].sort((x, y) => x - y);
        const bigStep = levels.some((h, i) => i > 0 && h - levels[i - 1] > 0.3 + 1e-9);
        if (bigStep && !has('ramp')) emit('CAT-MOB-001', [s.id], `${name}:`);
      }
    }
  }

  // ---------- plants ----------
  for (const pl of p.plants ?? []) {
    const plant = cat.plant(pl.plantId);
    const label = plant ? `${plant.name} (${plant.scientificName}).` : `${pl.plantId}.`;
    if (!plant || plant.catSafety === 'insufficient-data' || plant.catSafety === 'conflicting') emit('CAT-PLT-003', [pl.id], label);
    else if (plant.catSafety === 'known-hazard') emit(plant.hazardLevel === 'severe' ? 'CAT-PLT-001' : 'CAT-PLT-002', [pl.id], label);
  }
  if ((p.plants ?? []).length) emit('CAT-PLT-004', []);
  if (p.structures.length) emit('CAT-MAT-004', []);

  return out.sort((x, y) => SEVERITY_ORDER.indexOf(x.severity) - SEVERITY_ORDER.indexOf(y.severity) || (x.ruleId < y.ruleId ? -1 : x.ruleId > y.ruleId ? 1 : 0) || (x.id < y.id ? -1 : 1));
}

/** Plan points where cats can get into a tunnel end: a house opening or another structure within 0.3 m. */
function endConnected(p: Project, s: Structure, end: Vec2): boolean {
  for (const w of p.site.walls) {
    const d = wallDir(w);
    for (const o of w.openings) {
      if (!['window', 'door', 'patio-door'].includes(o.kind)) continue;
      const a: Vec2 = [w.a[0] + d[0] * o.offset, w.a[1] + d[1] * o.offset];
      const b: Vec2 = [a[0] + d[0] * o.width, a[1] + d[1] * o.width];
      if (distToSegment(end, a, b) <= 0.3) return true;
    }
  }
  return p.structures.some((o) => o.id !== s.id && footprints(o).some((f) => pointInPolygon(end, f) || f.some((q: Vec2, i: number) => distToSegment(end, q, f[(i + 1) % f.length]) <= 0.3)));
}

function tunnelHasEntrance(p: Project, s: Structure): boolean {
  const path = s.path ?? [];
  if (path.length < 2) return false;
  if ((s.openings ?? []).some((o) => o.kind === 'window-access' || o.kind === 'cat-door')) return true;
  return endConnected(p, s, toPlan(s, ...path[0])) || endConnected(p, s, toPlan(s, ...path[path.length - 1]));
}

/** Whether any tunnel ends at (or inside) this structure. */
function tunnelTouches(p: Project, s: Structure): boolean {
  const fps = footprints(s);
  return p.structures.some((t) => t.template === 'tunnel' && t.id !== s.id && (t.path ?? []).length >= 2 && [t.path![0], t.path![t.path!.length - 1]].some((pt) => {
    const e = toPlan(t, ...pt);
    return fps.some((f) => pointInPolygon(e, f) || f.some((q: Vec2, i: number) => distToSegment(e, q, f[(i + 1) % f.length]) <= 0.3));
  }));
}

/** Findings that stop a build package: open blockers. */
export const activeBlockers = (fs: Finding[]) => fs.filter((f) => f.severity === 'blocker' && f.status === 'open');

/** Counts of open findings by severity. */
export function tally(fs: Finding[]): Record<Severity, number> {
  const t: Record<Severity, number> = { blocker: 0, warning: 0, advisory: 0, info: 0 };
  for (const f of fs) if (f.status === 'open') t[f.severity]++;
  return t;
}
