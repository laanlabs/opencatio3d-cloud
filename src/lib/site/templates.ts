// Factories for new projects, house walls and structures from catalog templates.
import type { Catalog } from '../catalog/catalog';
import type { Cat, Furnishing, HostWall, Measurement, Project, Site, Structure, StructureOpening, TemplateId, Units, Vec2, WallOpening } from '../model/types';
import { DEFAULT_ASSUMPTIONS, SCHEMA, clone, uid } from '../model/types';
import { alongWall, dist, polylineLength, wallAngle } from '../model/geometry';

export function defaultSite(): Site {
  return { northDeg: 0, ground: 'grass', walls: [], obstacles: [], measurements: [] };
}

/** A house wall from a to b with the given openings (offsets from a). */
export function houseWall(a: Vec2, b: Vec2, height = 2.7, openings: Omit<WallOpening, 'id'>[] = []): HostWall {
  return { id: uid(), a, b, height, openings: openings.map((o) => ({ ...o, id: uid() }) as WallOpening) };
}

export interface NewStructureOptions {
  x?: number;
  y?: number;
  rotation?: number;
  /** Attach the back of the structure to this wall, centred on `opening` if given (else on the wall). */
  wall?: HostWall;
  opening?: WallOpening;
  name?: string;
}

/** A structure from a template's defaults, with fresh ids for it and every opening and furnishing. */
export function newStructure(templateId: TemplateId, cat: Catalog, opts: NewStructureOptions = {}): Structure {
  const t = cat.template(templateId) ?? cat.templates[0];
  const d = clone(t.defaults);
  const s: Structure = {
    id: uid(),
    name: opts.name ?? t.name.replace(/ \(concept\)$/, ''),
    template: t.id,
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    rotation: opts.rotation ?? 0,
    width: d.width,
    depth: d.depth,
    height: d.height,
    ...(d.lowHeight != null ? { lowHeight: d.lowHeight } : {}),
    ...(d.elevation != null ? { elevation: d.elevation } : {}),
    ...(d.path ? { path: d.path } : {}),
    frame: d.frame,
    mesh: d.mesh,
    roof: d.roof,
    base: d.base,
    openings: d.openings.map((o) => ({ ...o, id: uid() }) as StructureOpening),
    furnishings: d.furnishings.map((f) => ({ ...f, id: uid() }) as Furnishing)
  };
  if (opts.wall && t.attached) attachToWall(s, opts.wall, opts.opening);
  return s;
}

/**
 * Places an attached structure with its back on the wall's outdoor face, centred on `opening` (or the
 * wall), and lines a window-access opening up with that window.
 */
export function attachToWall(s: Structure, wall: HostWall, opening?: WallOpening) {
  const L = dist(wall.a, wall.b);
  const centre = opening ? opening.offset + opening.width / 2 : L / 2;
  const start = Math.max(0, Math.min(L - s.width, centre - s.width / 2));
  const dir: Vec2 = [(wall.b[0] - wall.a[0]) / (L || 1), (wall.b[1] - wall.a[1]) / (L || 1)];
  s.x = wall.a[0] + dir[0] * start;
  s.y = wall.a[1] + dir[1] * start;
  s.rotation = wallAngle(wall);
  s.hostWallId = wall.id;
  if (opening && (opening.kind === 'window' || opening.kind === 'door' || opening.kind === 'patio-door')) {
    s.hostOpeningId = opening.id;
    const wa = s.openings.find((o) => o.kind === 'window-access');
    if (wa && opening.kind === 'window') {
      wa.offset = Math.max(0, opening.offset - start);
      wa.width = Math.min(opening.width, s.width - wa.offset);
      wa.sill = Math.max(0, opening.sill - (s.elevation ?? 0));
      wa.height = Math.min(opening.height, s.height - wa.sill);
    }
  }
}

export const KEY_FIELDS: Record<string, string[]> = {
  tunnel: ['width', 'height', 'path'],
  'window-box': ['width', 'depth', 'height', 'elevation'],
  default: ['width', 'depth', 'height']
};
/** The dimensions that must be confirmed (CAT-DIM-001) before a build package. */
export const keyFields = (s: Structure) => KEY_FIELDS[s.template] ?? KEY_FIELDS.default;

/** Current value of a key dimension (`path` = tunnel centreline length). */
export function fieldValue(s: Structure, field: string): number {
  if (field === 'path') return polylineLength(s.path ?? []);
  const v = s[field];
  return typeof v === 'number' ? v : 0;
}

/** Measurement records for a structure's key dimensions, all typed and unconfirmed. */
export function measurementsFor(s: Structure): Measurement[] {
  return keyFields(s).map((field) => ({ id: uid(), targetId: s.id, field, value: fieldValue(s, field), source: 'typed', confirmed: false }));
}

export interface NewProjectOptions {
  name?: string;
  units?: Units;
  template?: TemplateId | 'blank';
  cats?: number;
}

export function newCat(name = 'Cat', patch: Partial<Cat> = {}): Cat {
  return { id: uid(), name, ageClass: 'adult', mobility: 'full', size: 'medium', climber: true, escapeRisk: 'medium', ...patch };
}

/** A new project: a 10 m house wall with a window and a back door, and (unless blank) one structure. */
export function newProject(opts: NewProjectOptions, cat: Catalog): Project {
  const now = new Date().toISOString();
  const wall = houseWall([0, 0], [10, 0], 2.7, [
    { kind: 'window', offset: 2.2, width: 0.9, height: 1.2, sill: 0.9, name: 'Living room window' },
    { kind: 'door', offset: 6.5, width: 0.9, height: 2.03, sill: 0, name: 'Back door' }
  ]);
  const site = { ...defaultSite(), walls: [wall] };
  const structures: Structure[] = [];
  const template = opts.template ?? 'lean-to';
  if (template !== 'blank') {
    const t = cat.template(template);
    const s = newStructure(template, cat, t?.attached ? { wall, opening: wall.openings[0] } : { x: 2, y: 3 });
    if (template === 'tunnel') { s.x = 2.65; s.y = 0; s.rotation = 90; }
    structures.push(s);
    site.measurements.push(...measurementsFor(s));
  }
  return {
    schema: SCHEMA,
    id: uid(),
    name: opts.name || 'My catio',
    createdAt: now,
    updatedAt: now,
    catalogVersion: cat.version,
    captureSource: 'template',
    units: opts.units ?? 'imperial',
    currency: 'USD',
    region: { country: 'US', climate: { snowLoad: 'none', wind: 'normal', hot: false, rainy: false } },
    site,
    structures,
    cats: Array.from({ length: opts.cats ?? 1 }, (_, i) => newCat(i ? `Cat ${i + 1}` : 'My cat')),
    plants: [],
    overrides: [],
    alternatives: [],
    observations: [],
    assumptions: { ...DEFAULT_ASSUMPTIONS },
    building: null,
    web: {},
    extra: {}
  };
}

/** Distance along a wall of a structure's back-left corner (for attached structures). */
export const offsetOnWall = (s: Structure, w: HostWall) => alongWall(w, [s.x, s.y]);
