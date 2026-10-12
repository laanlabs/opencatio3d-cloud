// OpenPlan3D "prepared RoomPlan JSON" with the `opencatio3d` block — the interchange contract in
// docs/EXPORT_FORMAT.md. Export writes the house walls, windows and doors as OpenPlan3D walls and
// openings, each structure as an OpenPlan3D object (so OpenPlan3D shows the catio as a box), and the
// full project in the block. Import reads iOS exports, our own files and plain OpenPlan3D plans.
import type { Catalog } from '../catalog/catalog';
import type { Building, HostWall, Project, Structure, Vec2, WallOpening } from '../model/types';
import { DEFAULT_ASSUMPTIONS, SCHEMA, clone, frontHeight, stableId, uid } from '../model/types';
import { dist, rad, toPlan } from '../model/geometry';
import { defaultSite } from '../site/templates';
import { sanitizeProject } from './validate';
import { catalog as defaultCatalog } from '../catalog/catalog';

type Json = Record<string, any>;

/** OpenPlan3D 4×4 column-major transform: heading `angle` (radians) in plan, position (x, y up, z). */
export function transform(x: number, z: number, angle: number, y: number): number[] {
  const c = Math.cos(angle), s = Math.sin(angle);
  // `+ 0` turns −0 into 0 so JSON round trips compare equal.
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, x, y, z, 1].map((v) => r6(v) + 0);
}
export const heading = (t: number[]) => Math.atan2(t[2], t[0]);
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** OpenPlan3D catalog id for a structure's bounding box (EXPORT_FORMAT.md mapping table). */
export const STRUCTURE_CATEGORY: Record<string, string> = { 'window-box': 'greenhouse_small', tunnel: 'greenhouse_small' };
export const structureCategory = (s: Structure) => STRUCTURE_CATEGORY[s.template] ?? 'greenhouse';

const WALL_THICKNESS = 0.2;

export interface ExportOptions {
  /** Embed the full web project (web → web file round trips). Never in links. */
  embedWebProject?: boolean;
  /** Link privacy: no embedded web project, no photo file names. */
  forLink?: boolean;
}

/** OpenPlan3D objects for every structure (tunnels: one per path segment), in project order. */
export function structureObjects(p: Project): Json[] {
  const out: Json[] = [];
  for (const s of p.structures) {
    const attributes = { opencatio3dRole: 'structure', opencatio3dKind: s.template, structureId: s.id };
    const elev = s.elevation ?? 0;
    if (s.template === 'tunnel') {
      const path = s.path ?? [];
      for (let i = 0; i < path.length - 1; i++) {
        const a = toPlan(s, ...path[i]), b = toPlan(s, ...path[i + 1]);
        const L = dist(a, b);
        if (L < 0.01) continue;
        out.push({ identifier: stableId(`${s.id}:segment:${i}`), dimensions: [r6(L), r6(s.height), r6(s.width)], transform: transform((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.atan2(b[1] - a[1], b[0] - a[0]), r6(elev + s.height / 2)), category: { [structureCategory(s)]: {} }, attributes: { ...attributes, segment: i }, story: 0 });
      }
      continue;
    }
    const c = toPlan(s, s.width / 2, s.depth / 2);
    const h = Math.max(s.height, frontHeight(s));
    out.push({ identifier: s.id, dimensions: [r6(s.width), r6(h), r6(s.depth)], transform: transform(c[0], c[1], rad(s.rotation), r6(elev + h / 2)), category: { [structureCategory(s)]: {} }, attributes, story: 0 });
  }
  return out;
}

/** OpenPlan3D walls/doors/windows from the site's house walls (when there is no verbatim building). */
export function houseArrays(p: Project): Pick<Building, 'walls' | 'doors' | 'windows'> {
  const walls: Json[] = [], doors: Json[] = [], windows: Json[] = [];
  for (const w of p.site.walls) {
    const L = dist(w.a, w.b);
    if (L < 0.01) continue;
    const ang = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]);
    const d: Vec2 = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
    const n: Vec2 = [-d[1], d[0]];
    // The wall line is the outdoor face; OpenPlan3D walls are centred, so shift half a thickness indoors.
    const at = (t: number): Vec2 => [w.a[0] + d[0] * t - n[0] * WALL_THICKNESS / 2, w.a[1] + d[1] * t - n[1] * WALL_THICKNESS / 2];
    const mid = at(L / 2);
    walls.push({ identifier: w.id, dimensions: [r6(L), r6(w.height), WALL_THICKNESS], transform: transform(mid[0], mid[1], ang, r6(w.height / 2)), story: 0 });
    for (const o of w.openings) {
      const c = at(o.offset + o.width / 2);
      const base = { identifier: o.id, parentIdentifier: w.id, dimensions: [r6(o.width), r6(o.height), WALL_THICKNESS], transform: transform(c[0], c[1], ang, r6(o.sill + o.height / 2)), story: 0 };
      if (o.kind === 'window') windows.push({ ...base, sillHeight: r6(o.sill) });
      else if (o.kind === 'door' || o.kind === 'patio-door') doors.push({ ...base, style: o.kind === 'patio-door' ? 'patio' : 'single' });
    }
  }
  return { walls, doors, windows };
}

const DEFAULT_STORIES = [{ index: 0, name: 'Ground Floor' }];
const DEFAULT_DEFAULTS = { ceilingHeight: 2.4, interiorWallThickness: 0.12, exteriorWallThickness: 0.2 };

export function toOpenPlan(p: Project, cat: Catalog = defaultCatalog, opts: ExportOptions = {}): Json {
  const forLink = !!opts.forLink;
  const embed = !forLink && (opts.embedWebProject ?? true);
  const b = p.building;
  const observations = clone(p.observations ?? []).map((o) => {
    if (!forLink) return o;
    const { photoFile: _f, ...rest } = o;
    return rest;
  });
  const block: Json = {
    ...clone(p.extra ?? {}),
    schema: SCHEMA,
    producer: 'web',
    lengthUnit: 'm',
    projectId: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    catalogVersion: p.catalogVersion || cat.version,
    captureSource: p.captureSource,
    units: p.units,
    currency: p.currency,
    ...(p.region ? { region: clone(p.region) } : {}),
    site: clone(p.site),
    structures: clone(p.structures),
    cats: clone(p.cats),
    plants: clone(p.plants),
    overrides: clone(p.overrides),
    alternatives: clone(p.alternatives),
    observations,
    assumptions: clone(p.assumptions),
    building: b ? clone(b) : null,
    web: clone(p.web)
  };
  if (embed) block.webProject = clone(p);
  const house = b ? { walls: b.walls, doors: b.doors, windows: b.windows } : houseArrays(p);
  return {
    openplanPrepared: true,
    openplanHandoffVersion: 1,
    version: 2,
    walls: clone(house.walls ?? []),
    doors: clone(house.doors ?? []),
    windows: clone(house.windows ?? []),
    openings: clone(b?.openings ?? []),
    objects: [...structureObjects(p), ...clone(b?.objects ?? [])],
    sections: clone(b?.sections ?? []),
    stories: clone(b?.stories?.length ? b.stories : DEFAULT_STORIES),
    floors: clone(b?.floors ?? []),
    defaults: clone(b?.defaults && Object.keys(b.defaults).length ? b.defaults : DEFAULT_DEFAULTS),
    planNotes: 'Created with OpenCatio3D. Catios are shown as boxes; the full design is in the opencatio3d block. Planning guidance only — confirm dimensions on site.',
    opencatio3d: block
  };
}

// ---------- import ----------

export function isOpenPlanJson(j: unknown): j is Json {
  return !!j && typeof j === 'object' && Array.isArray((j as Json).walls) && ((j as Json).openplanHandoffVersion === 1 || (j as Json).openplanPrepared === true || 'objects' in (j as Json));
}
export const isWebProject = (j: unknown): j is Project => !!j && typeof j === 'object' && (j as Json).schema === SCHEMA && Array.isArray((j as Json).structures);

/** Keys of the `opencatio3d` block this app models; anything else is kept in `extra`. */
const BLOCK_KEYS = new Set(['schema', 'producer', 'lengthUnit', 'projectId', 'name', 'createdAt', 'updatedAt', 'catalogVersion', 'captureSource', 'units', 'currency', 'region', 'site', 'structures', 'cats', 'plants', 'overrides', 'alternatives', 'observations', 'assumptions', 'building', 'web', 'webProject']);

/** Fills defaults so older or partial projects open safely, then type-checks them (io/validate.ts). */
export function normalizeProject(p: Partial<Project> & { id?: string }, cat: Catalog = defaultCatalog): Project {
  const now = new Date().toISOString();
  const filled = {
    schema: SCHEMA,
    id: p.id ?? uid(),
    name: p.name ?? 'Untitled catio',
    createdAt: p.createdAt ?? now,
    updatedAt: p.updatedAt ?? now,
    catalogVersion: p.catalogVersion ?? cat.version,
    captureSource: p.captureSource ?? 'manual',
    units: p.units ?? 'imperial',
    currency: p.currency ?? 'USD',
    ...(p.region ? { region: p.region } : {}),
    site: p.site && typeof p.site === 'object' ? { ...defaultSite(), ...p.site } : defaultSite(),
    structures: p.structures ?? [],
    cats: p.cats ?? [],
    plants: p.plants ?? [],
    overrides: p.overrides ?? [],
    alternatives: p.alternatives ?? [],
    observations: p.observations ?? [],
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...(p.assumptions && typeof p.assumptions === 'object' ? p.assumptions : {}) },
    building: p.building ?? null,
    web: p.web && typeof p.web === 'object' ? p.web : {},
    extra: p.extra ?? {}
  } as Project;
  return sanitizeProject(filled, cat).project;
}

/** House walls (outdoor face lines) and their windows/doors from verbatim OpenPlan3D arrays. */
export function wallsFromBuilding(b: Building): HostWall[] {
  const out: HostWall[] = [];
  for (const w of b.walls ?? []) {
    const t = w?.transform as number[] | undefined;
    if (!Array.isArray(t) || !Array.isArray(w.dimensions)) continue;
    const ang = heading(t);
    const d: Vec2 = [Math.cos(ang), Math.sin(ang)];
    const half = w.dimensions[0] / 2;
    const thick = w.dimensions[2] ?? WALL_THICKNESS;
    const n: Vec2 = [-d[1], d[0]];
    const c: Vec2 = [t[12] + n[0] * thick / 2, t[14] + n[1] * thick / 2];
    const a: Vec2 = [r6(c[0] - d[0] * half), r6(c[1] - d[1] * half)], bb: Vec2 = [r6(c[0] + d[0] * half), r6(c[1] + d[1] * half)];
    const openings: WallOpening[] = [];
    const read = (list: any[] | undefined, kind: (o: any) => WallOpening['kind']) => {
      for (const o of list ?? []) {
        if (o?.parentIdentifier !== w.identifier || !Array.isArray(o.transform) || !Array.isArray(o.dimensions)) continue;
        const along = (o.transform[12] - a[0]) * d[0] + (o.transform[14] - a[1]) * d[1];
        const sill = typeof o.sillHeight === 'number' ? o.sillHeight : Math.max(0, o.transform[13] - o.dimensions[1] / 2);
        openings.push({ id: String(o.identifier), kind: kind(o), offset: r6(along - o.dimensions[0] / 2), width: o.dimensions[0], height: o.dimensions[1], sill: r6(sill) });
      }
    };
    read(b.windows, () => 'window');
    read(b.doors, (o) => (o.style === 'patio' || o.style === 'sliding' ? 'patio-door' : 'door'));
    out.push({ id: String(w.identifier), a, b: bb, height: w.dimensions[1] ?? 2.7, openings });
  }
  return out;
}

function buildingFrom(j: Json, passthrough: Json[]): Building | null {
  const b: Building = {
    walls: clone(j.walls ?? []), doors: clone(j.doors ?? []), windows: clone(j.windows ?? []), openings: clone(j.openings ?? []),
    sections: clone(j.sections ?? []), stories: clone(j.stories ?? DEFAULT_STORIES), floors: clone(j.floors ?? []), defaults: clone(j.defaults ?? DEFAULT_DEFAULTS),
    ...(passthrough.length ? { objects: clone(passthrough) } : {})
  };
  const empty = !b.walls.length && !b.doors.length && !b.windows.length && !b.openings.length && !b.sections.length && !passthrough.length;
  return empty ? null : b;
}

/** Reads an OpenCatio3D export (web or iOS), a plain OpenPlan3D file, or a web project. */
export function fromOpenPlan(j: Json, cat: Catalog = defaultCatalog, fallbackName = 'Imported catio'): Project {
  if (isWebProject(j)) return normalizeProject(clone(j), cat);
  const block: Json | undefined = j.opencatio3d;
  // The embedded web project is trusted only when the web wrote the file; iOS edits come from the block.
  if (block?.producer === 'web' && isWebProject(block.webProject)) return normalizeProject(clone(block.webProject), cat);
  const now = new Date().toISOString();
  const objects: Json[] = Array.isArray(j.objects) ? j.objects : [];
  if (!block) {
    // A plain OpenPlan3D plan: keep the building verbatim and lift its walls in as house walls.
    const building = buildingFrom(j, objects);
    const name = j.sections?.find((s: Json) => s.displayName)?.displayName ?? fallbackName;
    return normalizeProject({ id: uid(), name, createdAt: now, updatedAt: now, captureSource: 'openplan', building, site: { ...defaultSite(), walls: building ? wallsFromBuilding(building) : [] } }, cat);
  }
  const ours = (o: Json) => typeof o?.attributes?.opencatio3dRole === 'string';
  const passthrough = objects.filter((o) => !ours(o));
  const extra: Json = {};
  for (const [k, v] of Object.entries(block)) if (!BLOCK_KEYS.has(k)) extra[k] = clone(v);
  const building = block.building && typeof block.building === 'object' ? (clone(block.building) as Building) : null;
  if (building && passthrough.length && !building.objects) building.objects = clone(passthrough);
  return normalizeProject({
    id: String(block.projectId ?? uid()),
    name: String(block.name ?? fallbackName),
    createdAt: block.createdAt ?? now,
    updatedAt: block.updatedAt ?? now,
    catalogVersion: block.catalogVersion ?? cat.version,
    captureSource: block.captureSource ?? 'manual',
    units: block.units === 'metric' ? 'metric' : 'imperial',
    currency: typeof block.currency === 'string' ? block.currency : 'USD',
    ...(block.region ? { region: clone(block.region) } : {}),
    site: clone(block.site ?? defaultSite()),
    structures: clone(block.structures ?? []),
    cats: clone(block.cats ?? []),
    plants: clone(block.plants ?? []),
    overrides: clone(block.overrides ?? []),
    alternatives: clone(block.alternatives ?? []),
    observations: clone(block.observations ?? []),
    assumptions: clone(block.assumptions ?? DEFAULT_ASSUMPTIONS),
    building,
    web: clone(block.web ?? {}),
    extra
  }, cat);
}

export function fileName(p: Project, suffix: string, ext: string) {
  const safe = p.name.split(/[^A-Za-z0-9]+/).filter(Boolean).join('-');
  return `${safe || 'catio'}-${suffix}.${ext}`;
}

/** Compact, key-sorted JSON (the OpenPlan3D handoff payload form and the fixture form). */
export function sortedJson(v: unknown, indent?: number): string {
  const sort = (x: any): any => (Array.isArray(x) ? x.map(sort) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sort(x[k])])) : x);
  return JSON.stringify(sort(v), null, indent);
}
