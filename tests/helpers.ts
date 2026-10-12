// Shared test helpers: deterministic projects (stable ids, fixed timestamps) for every template at its
// min/default/max sizes, the samples, and a rules case — plus `summarize`, the generator/check output
// pinned by the golden and iOS parity fixtures (EXPORT_FORMAT.md "Parity fixtures").
import { catalog } from '../src/lib/catalog/catalog';
import type { Project, Structure, TemplateId } from '../src/lib/model/types';
import { TEMPLATE_IDS, stableId } from '../src/lib/model/types';
import { generate } from '../src/lib/generate/assembly';
import { runChecks } from '../src/lib/analysis/checks';
import { houseWall, measurementsFor, newCat, newProject, newStructure } from '../src/lib/site/templates';
import { SAMPLES, buildSample } from '../src/lib/site/samples';

export const cat = catalog;
export const AT = '2026-10-12T12:00:00.000Z';

/** Rewrites every random id in a project to a stable one derived from `key` and position. */
export function det(p: Project, key: string): Project {
  const id = (s: string) => stableId(`test:${key}:${s}`);
  const wallIds = new Map<string, string>();
  const openIds = new Map<string, string>();
  p.site.walls = p.site.walls.map((w, i) => {
    const nid = id(`wall${i}`);
    wallIds.set(w.id, nid);
    return { ...w, id: nid, openings: w.openings.map((o, j) => { const oid = id(`wall${i}:o${j}`); openIds.set(o.id, oid); return { ...o, id: oid }; }) };
  });
  const sIds = new Map<string, string>();
  const fIds = new Map<string, string>();
  p.structures = p.structures.map((s, i) => {
    const nid = id(`s${i}`);
    sIds.set(s.id, nid);
    return {
      ...s, id: nid,
      ...(s.hostWallId ? { hostWallId: wallIds.get(s.hostWallId) ?? s.hostWallId } : {}),
      ...(s.hostOpeningId ? { hostOpeningId: openIds.get(s.hostOpeningId) ?? s.hostOpeningId } : {}),
      openings: s.openings.map((o, j) => ({ ...o, id: id(`s${i}:o${j}`) })),
      furnishings: s.furnishings.map((f, j) => { const fid = id(`s${i}:f${j}`); fIds.set(f.id, fid); return { ...f, id: fid }; })
    };
  });
  p.site.measurements = p.site.measurements.map((m, i) => ({ ...m, id: id(`m${i}`), targetId: sIds.get(m.targetId) ?? m.targetId }));
  p.site.obstacles = p.site.obstacles.map((o, i) => ({ ...o, id: id(`obst${i}`) }));
  p.cats = p.cats.map((c, i) => ({ ...c, id: id(`cat${i}`) }));
  p.plants = p.plants.map((pl, i) => ({ ...pl, id: id(`plant${i}`), ...(pl.structureId ? { structureId: sIds.get(pl.structureId) } : {}), ...(pl.furnishingId ? { furnishingId: fIds.get(pl.furnishingId) } : {}) }));
  return { ...p, id: id('project'), createdAt: AT, updatedAt: AT };
}

/** Confirms every key dimension at its current value. */
export function confirmAll(p: Project): Project {
  p.site.measurements = p.structures.flatMap(measurementsFor).map((m, i) => ({ ...m, id: stableId(`test:${p.id}:m${i}`), source: 'tape', confirmed: true }));
  return p;
}

/** A project holding one structure of `template`, sized min / default / max per the catalog limits. */
export function templateCase(template: TemplateId, size: 'min' | 'default' | 'max'): Project {
  const t = cat.template(template)!;
  const p = newProject({ template, units: 'imperial', name: `${template} ${size}` }, cat);
  const s = p.structures[0];
  if (size !== 'default') {
    const k = size === 'min' ? 0 : 1;
    const L = t.limits;
    if (template === 'tunnel') {
      s.width = L.width![k]; s.height = L.height![k];
      s.path = size === 'min' ? [[0, 0], [L.pathLength![0], 0]] : [[0, 0], [8, 0], [8, 6], [14, 6]];
      s.openings = [];
    } else {
      s.width = L.width![k]; s.depth = L.depth![k]; s.height = L.height![k];
      s.lowHeight = size === 'min' ? L.lowHeight![0] : Math.min(L.height![1], L.lowHeight![1]) - 0.3;
      if (L.elevation) s.elevation = size === 'min' ? L.elevation[0] : Math.min(L.elevation[1], 1.5);
      // Re-fit default openings and furnishings: keep only what still fits after resizing (the generator skips the rest).
    }
  }
  confirmAll(p);
  return det(p, `${template}-${size}`);
}

/** One project that trips as many rules as possible at once. */
export function rulesCase(): Project {
  const p = newProject({ template: 'blank', units: 'imperial', name: 'All rules' }, cat);
  p.region = { country: 'US', climate: { snowLoad: 'heavy', wind: 'high', hot: true, rainy: true } };
  p.site.ground = 'soil';
  const wall = houseWall([0, 0], [12, 0], 2.4, [
    { kind: 'window', offset: 0.5, width: 1.2, height: 1.2, sill: 0.8, egress: true, name: 'Bedroom' },
    { kind: 'dryer-vent', offset: 2.2, width: 0.15, height: 0.15, sill: 0.4 },
    { kind: 'meter', offset: 2.6, width: 0.35, height: 0.45, sill: 1.0 },
    { kind: 'vent', offset: 3.1, width: 0.25, height: 0.25, sill: 0.3 },
    { kind: 'downspout', offset: 1.3, width: 0.1, height: 2.4, sill: 0 },
    { kind: 'window', offset: 6.5, width: 1.0, height: 1.0, sill: 1.6 },
    { kind: 'window', offset: 3.3, width: 0.8, height: 1.0, sill: 0.8, name: 'Straddled window' }
  ]);
  p.site.walls = [wall];
  p.site.obstacles = [{ id: 'x', kind: 'tree', x: 9, y: 4, width: 2, depth: 2, rotation: 0, height: 5 }];
  // Lean-to over the egress window, dryer vent, meter and vent; 2×4 fence mesh; gravity latch; no self-closer; flat polycarbonate roof.
  const a = newStructure('lean-to', cat, { wall, opening: wall.openings[0] });
  a.x = 0.3; a.width = 3.2; a.height = 2.6; a.lowHeight = 2.6;
  a.mesh = { materialId: 'mesh-2x4-14ga-fence-48' };
  a.roof = { kind: 'polycarbonate', materialId: 'roof-polycarb-corrugated' };
  a.base = { kind: 'none' };
  a.frame = { profile: 'wood-2x3', materialId: 'lumber-2x3-spf', maxPostSpacing: 1.5, railSpacing: 0.9 };
  a.openings = [
    { id: 'o1', kind: 'human-door', side: 'front', offset: 0.5, width: 0.5, height: 1.4, swing: 'out', hinge: 'left', latch: 'gravity', selfClosing: false },
    { id: 'o2', kind: 'cleaning-hatch', side: 'right', offset: 0.2, width: 0.4, height: 0.3, sill: 0.2, latch: null },
    { id: 'o3', kind: 'cat-door', side: 'front', offset: 2.9, width: 0.6, height: 0.3, sill: 0.1 }
  ];
  a.furnishings = [
    { id: 'f1', componentId: 'shelf', side: 'left', offset: 0.1, mountHeight: 1.6, length: 0.6 },
    { id: 'f2', componentId: 'litter-annex', side: 'front', offset: 1.2, mountHeight: 0 },
    { id: 'f3', componentId: 'water-station', side: 'front', offset: 2.1, mountHeight: 0 },
    { id: 'f4', componentId: 'shelf', side: 'right', offset: 1.0, mountHeight: 1.0, length: 2.0 },
    { id: 'f5', componentId: 'planter-small', side: 'left', offset: 0.8, mountHeight: 0 }
  ];
  // Freestanding over the tree, too big and too tall, untreated frame on soil with a ground skirt, hardware cloth, mesh roof.
  const b = newStructure('freestanding', cat, { x: 7, y: 3 });
  b.width = 6.5; b.depth = 4.0; b.height = 3.0; b.lowHeight = 3.0;
  b.mesh = { materialId: 'mesh-hwcloth-19ga-36' };
  b.frame = { profile: 'wood-2x2', materialId: 'lumber-2x2-cedar', maxPostSpacing: 1.2, railSpacing: 0.9 };
  b.base = { kind: 'ground-skirt', skirtDepth: 0.3 };
  b.furnishings = [];
  b.openings = [];
  // A tunnel that goes nowhere, a raised window box, a balcony concept, and galvanized-before-welding mesh.
  const c = newStructure('tunnel', cat, { x: 4, y: 12 });
  c.mesh = { materialId: 'mesh-1x2-16ga-gbw-48' };
  c.base = { kind: 'pavers' };
  const d = newStructure('window-box', cat, { wall, opening: wall.openings[5] });
  d.elevation = 2.0;
  const e = newStructure('balcony-concept', cat, { x: 0, y: 9 });
  p.structures = [a, b, c, d, e];
  p.cats = [newCat('Kit', { ageClass: 'kitten', escapeRisk: 'high' }), newCat('Gran', { ageClass: 'senior', mobility: 'limited', size: 'small' })];
  p.plants = [
    { id: 'p1', plantId: 'lily', structureId: a.id, furnishingId: 'f5' },
    { id: 'p2', plantId: 'catnip', structureId: a.id, furnishingId: 'f5' },
    { id: 'p3', plantId: 'cat-grass-oat', structureId: a.id, furnishingId: 'f5' },
    { id: 'p4', plantId: 'not-a-plant', structureId: a.id }
  ];
  p.site.measurements = [];
  return det(p, 'all-rules');
}

export function sampleCase(id: string): Project {
  const p = buildSample(id, cat)!;
  return { ...p, createdAt: AT, updatedAt: AT };
}

export interface Case { name: string; project: Project }

/** Every parity case, in a stable order. */
export function allCases(): Case[] {
  const out: Case[] = SAMPLES.map((s) => ({ name: `sample-${s.id}`, project: sampleCase(s.id) }));
  for (const t of TEMPLATE_IDS) for (const size of ['min', 'default', 'max'] as const) out.push({ name: `${t}-${size}`, project: templateCase(t, size) });
  out.push({ name: 'all-rules', project: rulesCase() });
  return out;
}

const round = (n: number | undefined) => (n == null ? undefined : Math.round(n * 1e6) / 1e6);

/** Generator + checks output pinned by fixtures (geometry excluded; see EXPORT_FORMAT.md). */
export function summarize(p: Project) {
  const a = generate(p, cat);
  const f = runChecks(p, cat, a);
  return {
    catalogVersion: a.catalogVersion,
    structures: a.structures,
    parts: a.parts.map((x) => ({
      id: x.id, key: x.key, kind: x.kind, role: x.role, materialId: x.materialId, qty: x.qty, step: x.step,
      ...(x.label ? { label: x.label } : {}),
      ...(x.length != null ? { length: round(x.length) } : {}),
      ...(x.width != null ? { width: round(x.width) } : {}),
      ...(x.height != null ? { height: round(x.height) } : {}),
      ...(x.rollLength != null ? { rollLength: round(x.rollLength) } : {}),
      ...(x.area != null ? { area: round(x.area) } : {})
    })),
    cuts: { kerf: a.cuts.kerf, materials: a.cuts.materials.map((m) => ({ materialId: m.materialId, bins: m.bins.map((b) => ({ stock: b.stock, cuts: b.cuts.map((c) => c.partId), offcut: b.offcut })), overlong: m.overlong.map((c) => c.partId) })) },
    bom: a.bom.map((l) => ({ key: l.key, qty: l.qty, low: l.low, high: l.high })),
    cost: { low: a.cost.low, high: a.cost.high },
    steps: a.steps.map((s) => ({ structureId: s.structureId, key: s.key, order: s.order, parts: s.partIds.length })),
    findings: f.map((x) => ({ ruleId: x.ruleId, severity: x.severity, targetIds: x.targetIds, status: x.status }))
  };
}

export const structureOf = (p: Project, i = 0): Structure => p.structures[i];
