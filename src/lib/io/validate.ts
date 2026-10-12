// Type validation for projects from outside this editor: imported files, transfer links and whatever
// is already stored in IndexedDB. `normalizeProject` (io/openplan.ts) fills missing keys and then calls
// `sanitizeProject`, which makes sure every remaining value has the shape the planner relies on. It
// never rewrites data a producer wrote correctly: unchanged entries come back as the same objects.
// Anything it cannot repair is dropped and described in `dropped`, e.g. "1 structure with invalid sizes".
import type { Catalog } from '../catalog/catalog';
import type { Project, Structure } from '../model/types';
import { DEFAULT_ASSUMPTIONS, GROUND_KINDS, SCHEMA, TEMPLATE_IDS, clone, uid } from '../model/types';

type Json = Record<string, any>;

export interface SanitizeReport { dropped: string[]; count: number }
export interface SanitizeResult extends SanitizeReport { project: Project }

let last: SanitizeReport = { dropped: [], count: 0 };
/** Returns, and clears, the report of the most recent `sanitizeProject` call. */
export function takeSanitizeReport(): SanitizeReport {
  const r = last;
  last = { dropped: [], count: 0 };
  return r;
}

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pos = (v: unknown): v is number => finite(v) && v > 0;
const isPt = (v: unknown) => Array.isArray(v) && v.length >= 2 && finite(v[0]) && finite(v[1]);
const goodId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Filters a list, counting dropped entries per reason. Returns the same array when nothing changed. */
function keep<T>(list: unknown, ok: (x: any) => boolean, what: string, rep: SanitizeReport, fix?: (x: any) => T): T[] {
  if (!Array.isArray(list)) {
    if (list != null) { rep.dropped.push(`${what} list that could not be read`); rep.count++; }
    return [];
  }
  let changed = false;
  const out: T[] = [];
  let bad = 0;
  for (const x of list) {
    if (!isObj(x) || !ok(x)) { bad++; changed = true; continue; }
    const y = fix ? fix(x) : (x as T);
    if (y !== x) changed = true;
    out.push(y);
  }
  if (bad) { rep.dropped.push(`${plural(bad, what)} that could not be read`); rep.count += bad; }
  return changed ? out : (list as T[]);
}

function sanitizeStructure(s: Json, cat: Catalog | undefined, rep: SanitizeReport): Structure | null {
  if (!goodId(s.id) || !TEMPLATE_IDS.includes(s.template) || !finite(s.x) || !finite(s.y) || !pos(s.width) || !pos(s.height)) return null;
  if (s.template !== 'tunnel' && !pos(s.depth)) return null;
  const t = cat?.template(s.template);
  const d = t ? clone(t.defaults) : undefined;
  let out: Json = s;
  const set = (k: string, v: unknown) => { if (out === s) out = { ...s }; out[k] = v; };
  if (!finite(s.rotation)) set('rotation', 0);
  if (typeof s.name !== 'string') set('name', t?.name ?? 'Structure');
  if (s.template === 'tunnel') {
    const path = Array.isArray(s.path) ? s.path.filter(isPt).map((p: number[]) => [p[0], p[1]]) : [];
    if (path.length < 2) return null;
    if (!Array.isArray(s.path) || path.length !== s.path.length) set('path', path);
    if (!pos(s.depth)) set('depth', 1);
  }
  if (s.lowHeight != null && !pos(s.lowHeight)) set('lowHeight', s.height);
  if (s.elevation != null && !(finite(s.elevation) && s.elevation >= 0)) set('elevation', 0);
  if (!isObj(s.frame) || !['wood-2x2', 'wood-2x3', 'wood-2x4'].includes(s.frame.profile) || !pos(s.frame.maxPostSpacing) || !pos(s.frame.railSpacing)) set('frame', { ...(d?.frame ?? { profile: 'wood-2x3', materialId: 'lumber-2x3-pt', maxPostSpacing: 1.2, railSpacing: 0.9 }), ...(isObj(s.frame) && typeof s.frame.materialId === 'string' ? { materialId: s.frame.materialId } : {}) });
  if (!isObj(s.mesh) || typeof s.mesh.materialId !== 'string') set('mesh', d?.mesh ?? { materialId: 'mesh-1x1-16ga-gaw-48' });
  if (!isObj(s.roof) || !['mesh', 'corrugated', 'polycarbonate', 'partial'].includes(s.roof.kind)) set('roof', d?.roof ?? { kind: 'mesh' });
  if (!isObj(s.base) || !['ground-skirt', 'pavers', 'deck', 'raised-floor', 'none'].includes(s.base.kind)) set('base', d?.base ?? { kind: 'none' });
  const openings = keep(s.openings, (o) => goodId(o.id) && ['human-door', 'cat-door', 'window-access', 'cleaning-hatch', 'vestibule'].includes(o.kind) && ['back', 'front', 'left', 'right'].includes(o.side) && finite(o.offset) && pos(o.width) && pos(o.height), 'opening', rep);
  if (openings !== s.openings) set('openings', openings);
  const furnishings = keep(s.furnishings, (f) => goodId(f.id) && typeof f.componentId === 'string' && ['back', 'front', 'left', 'right', 'span'].includes(f.side) && finite(f.offset) && finite(f.mountHeight), 'furnishing', rep);
  if (furnishings !== s.furnishings) set('furnishings', furnishings);
  return out as Structure;
}

export function sanitizeProject(p: Project, cat?: Catalog): SanitizeResult {
  const rep: SanitizeReport = { dropped: [], count: 0 };
  let out: Json = p;
  const set = (k: string, v: unknown) => { if (out === p) out = { ...p }; out[k] = v; };
  if (out.schema !== SCHEMA) set('schema', SCHEMA);
  if (!goodId(p.id)) set('id', uid());
  if (typeof p.name !== 'string') set('name', 'Untitled catio');
  if (p.units !== 'metric' && p.units !== 'imperial') set('units', 'imperial');
  if (typeof p.currency !== 'string') set('currency', 'USD');

  const site: Json = isObj(p.site) ? p.site : {};
  let s2: Json = site;
  const setSite = (k: string, v: unknown) => { if (s2 === site) s2 = { ...site }; s2[k] = v; };
  if (!finite(site.northDeg)) setSite('northDeg', 0);
  if (!GROUND_KINDS.includes(site.ground)) setSite('ground', 'grass');
  const walls = keep(site.walls, (w) => goodId(w.id) && isPt(w.a) && isPt(w.b) && pos(w.height), 'house wall', rep, (w: Json) => {
    const openings = keep(w.openings, (o) => goodId(o.id) && typeof o.kind === 'string' && finite(o.offset) && pos(o.width) && pos(o.height) && finite(o.sill), 'wall opening', rep);
    return openings === w.openings ? w : { ...w, openings };
  });
  if (walls !== site.walls) setSite('walls', walls);
  const obstacles = keep(site.obstacles, (o) => goodId(o.id) && finite(o.x) && finite(o.y) && pos(o.width) && pos(o.depth), 'obstacle', rep, (o: Json) => (finite(o.rotation) && finite(o.height) ? o : { ...o, rotation: finite(o.rotation) ? o.rotation : 0, height: finite(o.height) ? o.height : 1 }));
  if (obstacles !== site.obstacles) setSite('obstacles', obstacles);
  const measurements = keep(site.measurements, (m) => goodId(m.id) && typeof m.targetId === 'string' && typeof m.field === 'string' && finite(m.value), 'measurement', rep, (m: Json) => (typeof m.confirmed === 'boolean' ? m : { ...m, confirmed: false }));
  if (measurements !== site.measurements) setSite('measurements', measurements);
  if (s2 !== p.site) set('site', s2);

  let badStructures = 0;
  const structures = Array.isArray(p.structures) ? p.structures.map((s) => (isObj(s) ? sanitizeStructure(s, cat, rep) : null)) : [];
  const kept = structures.filter((s): s is Structure => { if (!s) badStructures++; return !!s; });
  if (badStructures) { rep.dropped.push(`${plural(badStructures, 'structure')} with invalid sizes`); rep.count += badStructures; }
  if (!Array.isArray(p.structures) || badStructures || kept.some((s, i) => s !== p.structures[i])) set('structures', kept);

  const cats = keep(p.cats, (c) => goodId(c.id), 'cat', rep, (c: Json) => {
    const fixed = {
      name: typeof c.name === 'string' ? c.name : 'Cat',
      ageClass: ['kitten', 'adult', 'senior'].includes(c.ageClass) ? c.ageClass : 'adult',
      mobility: ['full', 'reduced', 'limited'].includes(c.mobility) ? c.mobility : 'full',
      size: ['small', 'medium', 'large'].includes(c.size) ? c.size : 'medium',
      climber: typeof c.climber === 'boolean' ? c.climber : true,
      escapeRisk: ['low', 'medium', 'high'].includes(c.escapeRisk) ? c.escapeRisk : 'medium'
    };
    return Object.entries(fixed).every(([k, v]) => c[k] === v) ? c : { ...c, ...fixed };
  });
  if (cats !== p.cats) set('cats', cats);
  const plants = keep(p.plants, (x) => goodId(x.id) && typeof x.plantId === 'string', 'plant', rep);
  if (plants !== p.plants) set('plants', plants);
  const overrides = keep(p.overrides, (o) => typeof o.ruleId === 'string', 'acknowledgement', rep, (o: Json) => (typeof o.targetId === 'string' && (o.kind === 'acknowledge' || o.kind === 'professional-review') ? o : { ...o, targetId: typeof o.targetId === 'string' ? o.targetId : '', kind: o.kind === 'professional-review' ? o.kind : 'acknowledge' }));
  if (overrides !== p.overrides) set('overrides', overrides);
  const alternatives = keep(p.alternatives, (a) => goodId(a.id) && isObj(a.snapshot) && Array.isArray(a.snapshot.structures), 'design option', rep);
  if (alternatives !== p.alternatives) set('alternatives', alternatives);
  const observations = keep(p.observations, (o) => goodId(o.id) && typeof o.kind === 'string', 'note', rep);
  if (observations !== p.observations) set('observations', observations);

  const a: Json = isObj(p.assumptions) ? p.assumptions : {};
  const okA = Array.isArray(a.stockLengths) && a.stockLengths.every(pos) && finite(a.kerf) && a.kerf >= 0 && a.kerf < 0.02 && finite(a.wasteFactor) && a.wasteFactor >= 0 && a.wasteFactor < 1 && finite(a.fastenerOverage) && a.fastenerOverage >= 0 && a.fastenerOverage < 1;
  if (!okA) set('assumptions', {
    ...a,
    stockLengths: Array.isArray(a.stockLengths) ? a.stockLengths.filter(pos) : [],
    kerf: finite(a.kerf) && a.kerf >= 0 && a.kerf < 0.02 ? a.kerf : DEFAULT_ASSUMPTIONS.kerf,
    wasteFactor: finite(a.wasteFactor) && a.wasteFactor >= 0 && a.wasteFactor < 1 ? a.wasteFactor : DEFAULT_ASSUMPTIONS.wasteFactor,
    fastenerOverage: finite(a.fastenerOverage) && a.fastenerOverage >= 0 && a.fastenerOverage < 1 ? a.fastenerOverage : DEFAULT_ASSUMPTIONS.fastenerOverage
  });
  if (!isObj(p.web)) set('web', {});
  if (!isObj(p.extra)) set('extra', {});
  if (p.building != null && !isObj(p.building)) set('building', null);
  last = rep;
  return { project: out as Project, ...rep };
}
