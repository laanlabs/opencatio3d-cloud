// Sample catios: complete, deterministic projects (stable ids from stableId) used by Home, the
// website's deep links (#/sample/<id>) and the golden/parity fixtures. Every key dimension is
// confirmed so each sample shows a full build package.
import type { Catalog } from '../catalog/catalog';
import type { Cat, Project, Structure, StructureOpening, Furnishing, PlantPlacement } from '../model/types';
import { SCHEMA, DEFAULT_ASSUMPTIONS, stableId, uid, clone } from '../model/types';
import { houseWall, measurementsFor, newStructure } from './templates';

export interface SampleInfo { id: string; name: string; blurb: string; template: string }

export const SAMPLES: SampleInfo[] = [
  { id: 'lean-to-window', name: 'Lean-to on the back wall', blurb: '8 × 4 ft lean-to over a living-room window: two cats, a window insert, half-covered roof, shelves and a ramp.', template: 'lean-to' },
  { id: 'garden-retreat', name: 'Garden retreat with tunnel', blurb: 'A walk-in 8 × 6 ft catio in the yard, linked to the house by a tunnel run. Three cats, including a senior.', template: 'freestanding' },
  { id: 'window-box', name: 'Window box', blurb: 'A 3 ft window box with a polycarbonate top and a cleaning hatch — the quickest catio to build.', template: 'window-box' }
];

/** Rewrites every id in a structure to a stable one derived from `key`. */
function stable<T extends Structure>(s: T, key: string): T {
  s.id = stableId(`sample:${key}`);
  s.openings = s.openings.map((o, i) => ({ ...o, id: stableId(`sample:${key}:opening:${i}`) }));
  s.furnishings = s.furnishings.map((f, i) => ({ ...f, id: stableId(`sample:${key}:furnishing:${i}`) }));
  return s;
}

const cat = (key: string, name: string, patch: Partial<Cat>): Cat => ({ id: stableId(`sample:cat:${key}`), name, ageClass: 'adult', mobility: 'full', size: 'medium', climber: true, escapeRisk: 'medium', ...patch });

function confirm(p: Project) {
  p.site.measurements = p.structures.flatMap(measurementsFor).map((m, i) => ({ ...m, id: stableId(`sample:${p.id}:m:${i}`), source: 'tape', confirmed: true }));
}

function base(id: string, name: string): Project {
  const at = '2026-10-12T12:00:00.000Z';
  return {
    schema: SCHEMA, id: stableId(`sample:${id}`), name, createdAt: at, updatedAt: at, catalogVersion: '', captureSource: 'sample',
    units: 'imperial', currency: 'USD', region: { country: 'US', state: 'OR', climate: { snowLoad: 'none', wind: 'normal', hot: false, rainy: true } },
    site: { northDeg: 0, ground: 'grass', walls: [], obstacles: [], measurements: [] },
    structures: [], cats: [], plants: [], overrides: [], alternatives: [], observations: [],
    assumptions: { ...DEFAULT_ASSUMPTIONS }, building: null, web: { sampleId: id }, extra: {}
  };
}

export function buildSample(id: string, catalog: Catalog): Project | undefined {
  if (id === 'lean-to-window') {
    const p = base(id, 'Lean-to on the back wall');
    const wall = houseWall([0, 0], [9, 0], 2.7, [
      { kind: 'window', offset: 3.0, width: 0.9, height: 1.2, sill: 0.9, name: 'Living room window' },
      { kind: 'door', offset: 6.6, width: 0.9, height: 2.03, sill: 0, name: 'Back door' },
      { kind: 'dryer-vent', offset: 0.6, width: 0.15, height: 0.15, sill: 0.5, name: 'Dryer vent' }
    ]);
    wall.id = stableId('sample:lean-to-window:wall');
    wall.openings = wall.openings.map((o, i) => ({ ...o, id: stableId(`sample:lean-to-window:wall-opening:${i}`) }));
    p.site.walls = [wall];
    p.site.ground = 'concrete';
    const s = stable(newStructure('lean-to', catalog, { wall, opening: wall.openings[0], name: 'Window lean-to' }), 'lean-to-window:s');
    s.furnishings.push(
      { id: '', componentId: 'ramp', side: 'right', offset: 0.05, mountHeight: 0.9, length: 1.05 } as Furnishing,
      { id: '', componentId: 'planter-small', side: 'front', offset: 1.85, mountHeight: 0 } as Furnishing,
      { id: '', componentId: 'planter-large', side: 'left', offset: 0.05, mountHeight: 0 } as Furnishing
    );
    stable(s, 'lean-to-window:s');
    p.structures = [s];
    p.cats = [cat('miso', 'Miso', { escapeRisk: 'high' }), cat('juniper', 'Juniper', { size: 'small' })];
    const planters = s.furnishings.filter((f) => f.componentId.startsWith('planter'));
    p.plants = [
      { id: stableId('sample:lean-to-window:plant:0'), plantId: 'spider-plant', structureId: s.id, furnishingId: planters[0].id },
      { id: stableId('sample:lean-to-window:plant:1'), plantId: 'rosemary', structureId: s.id, furnishingId: planters[1].id },
      { id: stableId('sample:lean-to-window:plant:2'), plantId: 'boston-fern', structureId: s.id, furnishingId: planters[1].id }
    ] as PlantPlacement[];
    confirm(p);
    return finish(p, catalog);
  }
  if (id === 'garden-retreat') {
    const p = base(id, 'Garden retreat with tunnel');
    p.region = { country: 'US', state: 'CA', climate: { snowLoad: 'none', wind: 'normal', hot: true, rainy: false } };
    const wall = houseWall([0, 0], [12, 0], 2.7, [
      { kind: 'window', offset: 2.0, width: 0.6, height: 0.9, sill: 0.9, name: 'Laundry window' },
      { kind: 'patio-door', offset: 7.0, width: 1.8, height: 2.03, sill: 0, name: 'Patio door' }
    ]);
    wall.id = stableId('sample:garden-retreat:wall');
    wall.openings = wall.openings.map((o, i) => ({ ...o, id: stableId(`sample:garden-retreat:wall-opening:${i}`) }));
    p.site.walls = [wall];
    p.site.obstacles = [{ id: stableId('sample:garden-retreat:tree'), kind: 'tree', x: 7.5, y: 6.5, width: 1.2, depth: 1.2, rotation: 0, height: 5, name: 'Maple' }];
    const s = stable(newStructure('freestanding', catalog, { x: 1.2, y: 3.6, name: 'Garden catio' }), 'garden-retreat:s');
    s.lowHeight = 1.95;
    s.roof = { kind: 'partial', coverFraction: 0.5, materialId: 'roof-polycarb-corrugated' };
    s.openings.push({ id: '', kind: 'cat-door', side: 'back', offset: 0.975, width: 0.25, height: 0.3, sill: 0.1 } as StructureOpening);
    s.furnishings.push(
      { id: '', componentId: 'ramp', side: 'left', offset: 0.05, mountHeight: 0.8, length: 1.1 } as Furnishing,
      { id: '', componentId: 'hammock', side: 'front', offset: 1.75, mountHeight: 1.1 } as Furnishing,
      { id: '', componentId: 'litter-annex', side: 'left', offset: 0.95, mountHeight: 0 } as Furnishing
    );
    stable(s, 'garden-retreat:s');
    // Tunnel: from the laundry window (a riser climbs to its 0.9 m sill) straight out into the catio's back cat door.
    const t = stable(newStructure('tunnel', catalog, { x: 2.3, y: 0, rotation: 0, name: 'Tunnel run' }), 'garden-retreat:t');
    t.path = [[0, 0], [0, 3.6]];
    t.base = { kind: 'pavers' };
    t.openings = [{ id: stableId('sample:garden-retreat:t:opening:0'), kind: 'window-access', side: 'back', offset: 0, width: 0.457, height: 0.457, sill: 0.9 }];
    p.structures = [s, t];
    p.cats = [cat('pepper', 'Pepper', {}), cat('biscuit', 'Biscuit', { ageClass: 'senior', mobility: 'reduced', climber: false }), cat('olive', 'Olive', { escapeRisk: 'low' })];
    confirm(p);
    return finish(p, catalog);
  }
  if (id === 'window-box') {
    const p = base(id, 'Window box');
    p.region = { country: 'US', state: 'NY', climate: { snowLoad: 'light', wind: 'normal', hot: false, rainy: false } };
    const wall = houseWall([0, 0], [6, 0], 2.7, [{ kind: 'window', offset: 2.6, width: 0.71, height: 1.1, sill: 0.9, name: 'Kitchen window' }]);
    wall.id = stableId('sample:window-box:wall');
    wall.openings = wall.openings.map((o, i) => ({ ...o, id: stableId(`sample:window-box:wall-opening:${i}`) }));
    p.site.walls = [wall];
    const s = stable(newStructure('window-box', catalog, { wall, opening: wall.openings[0], name: 'Window box' }), 'window-box:s');
    s.furnishings.push({ id: '', componentId: 'bed', side: 'front', offset: 0.35, mountHeight: 0 } as Furnishing);
    stable(s, 'window-box:s');
    p.structures = [s];
    p.cats = [cat('mochi', 'Mochi', { size: 'small' })];
    confirm(p);
    return finish(p, catalog);
  }
  return undefined;
}

function finish(p: Project, catalog: Catalog): Project {
  p.catalogVersion = catalog.version;
  return p;
}

/** A fresh, editable copy of a sample for the visitor's library (new project id, `web.sampleId` kept). */
export function sampleCopy(id: string, catalog: Catalog): Project | undefined {
  const p = buildSample(id, catalog);
  if (!p) return undefined;
  const now = new Date().toISOString();
  return { ...clone(p), id: uid(), createdAt: now, updatedAt: now, web: { ...p.web, sampleId: id } };
}
