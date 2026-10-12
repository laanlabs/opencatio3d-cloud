// Project → Assembly: every structure's parts, build labels, the lumber cut plan, the bill of
// materials, the cost range and the assembly steps. Pure and deterministic; the same function runs on
// iOS (EXPORT_FORMAT.md "Generator algorithms") and its output is pinned by golden fixtures.
import type { Catalog, Material } from '../catalog/catalog';
import type { Project, Structure } from '../model/types';
import { stableId } from '../model/types';
import { STEP_ORDER, ceilE, r2, r3, type Part, type StepKey } from './parts';
import { generateStructure, stockFor } from './structure';
export { stockFor };

export interface Cut { partId: string; label: string; length: number }
export interface Bin { stock: number; cuts: Cut[]; offcut: number }
export interface CutMaterial { materialId: string; bins: Bin[]; overlong: Cut[] }
export interface CutPlan { kerf: number; materials: CutMaterial[] }

export interface BomLine {
  /** `${materialId}` or `${materialId}@${stock}` for lumber. */
  key: string;
  materialId: string;
  name: string;
  category: string;
  unit: string;
  qty: number;
  stockLength?: number;
  unitLow: number;
  unitHigh: number;
  low: number;
  high: number;
  /** e.g. "38.2 m of roll", "412 pcs". */
  detail?: string;
}

export interface Step {
  id: string;
  structureId: string;
  key: StepKey;
  order: number;
  title: string;
  partIds: string[];
  checklist: string[];
}

export interface StructureInfo {
  id: string;
  letter: string;
  name: string;
  conceptOnly: boolean;
  unsupported: string[];
  skippedOpenings: string[];
  skippedFurnishings: string[];
}

export interface Assembly {
  catalogVersion: string;
  pricesAsOf: string;
  currency: string;
  structures: StructureInfo[];
  parts: Part[];
  cuts: CutPlan;
  bom: BomLine[];
  cost: { low: number; high: number; currency: string };
  steps: Step[];
  /** True when any structure is concept-only or outside supported sizes: no build package. */
  conceptOnly: boolean;
}

export const CATEGORY_ORDER = ['lumber', 'mesh', 'roof', 'sheet', 'hardware', 'fasteners', 'base', 'enrichment', 'kits'];

export const letterFor = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `S${i + 1}-`);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Labels members, panels, hardware, base items and kits in build order: step, then key. Fasteners stay unlabelled. */
function label(parts: Part[], letter: string) {
  const numbered = parts.filter((p) => p.kind !== 'connector').sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step) || cmp(a.key, b.key));
  numbered.forEach((p, i) => (p.label = `${letter}${i + 1}`));
}

/**
 * First-fit decreasing per lumber material. Pieces sort by length (desc) then part id; a piece goes into
 * the first open bin where used + kerf × cuts + length ≤ longest stock. Each bin is then bought as the
 * shortest stock length ≥ used + kerf × (cuts − 1). Pieces longer than the longest stock are overlong.
 */
export function cutPlan(parts: Part[], cat: Catalog, stockLengths: number[], kerf: number): CutPlan {
  const byMat = new Map<string, Cut[]>();
  for (const p of parts) {
    if (p.kind !== 'member' || cat.material(p.materialId)?.kind !== 'lumber') continue;
    for (let q = 0; q < p.qty; q++) {
      const list = byMat.get(p.materialId) ?? [];
      list.push({ partId: p.id, label: p.label ?? '', length: p.length ?? 0 });
      byMat.set(p.materialId, list);
    }
  }
  const materials: CutMaterial[] = [];
  for (const materialId of [...byMat.keys()].sort(cmp)) {
    const stocks = stockFor(cat.material(materialId)!, stockLengths);
    const longest = Math.max(...stocks);
    const pieces = byMat.get(materialId)!.sort((a, b) => b.length - a.length || cmp(a.partId, b.partId));
    const open: { cuts: Cut[]; used: number }[] = [];
    const overlong: Cut[] = [];
    for (const pc of pieces) {
      if (pc.length > longest + 1e-9) { overlong.push(pc); continue; }
      const bin = open.find((b) => b.used + kerf * b.cuts.length + pc.length <= longest + 1e-9);
      if (bin) { bin.cuts.push(pc); bin.used += pc.length; }
      else open.push({ cuts: [pc], used: pc.length });
    }
    const bins = open.map((b) => {
      const need = b.used + kerf * (b.cuts.length - 1);
      const stock = stocks.find((s) => s >= need - 1e-9) ?? longest;
      return { stock, cuts: b.cuts, offcut: r3(stock - need) };
    });
    materials.push({ materialId, bins, overlong });
  }
  return { kerf, materials };
}

/** Bill of materials from the parts and the cut plan (EXPORT_FORMAT.md "BOM"). */
export function billOfMaterials(parts: Part[], cuts: CutPlan, cat: Catalog, p: Pick<Project, 'assumptions'>): BomLine[] {
  const lines: BomLine[] = [];
  const waste = p.assumptions.wasteFactor ?? 0.1;
  const over = p.assumptions.fastenerOverage ?? 0.1;
  const line = (m: Material, qty: number, price: [number, number], extra: Partial<BomLine> = {}) => {
    if (qty <= 0) return;
    lines.push({ key: m.id, materialId: m.id, name: m.name, category: m.category, unit: m.unit, qty, unitLow: price[0], unitHigh: price[1], low: r2(qty * price[0]), high: r2(qty * price[1]), ...extra });
  };
  // Lumber: one line per (material, stock length) from the cut plan.
  for (const cm of cuts.materials) {
    const m = cat.material(cm.materialId)!;
    const counts = new Map<number, number>();
    for (const b of cm.bins) counts.set(b.stock, (counts.get(b.stock) ?? 0) + 1);
    for (const stock of [...counts.keys()].sort((a, b) => a - b)) {
      const ppm = m.pricePerMeter ?? [0, 0];
      line(m, counts.get(stock)!, [r2(stock * ppm[0]), r2(stock * ppm[1])], { key: `${m.id}@${stock}`, stockLength: stock });
    }
  }
  // Everything else, aggregated by material.
  const agg = new Map<string, { qty: number; roll: number; area: number; length: number }>();
  for (const part of parts) {
    const m = cat.material(part.materialId);
    if (!m || m.kind === 'lumber') continue;
    const a = agg.get(m.id) ?? { qty: 0, roll: 0, area: 0, length: 0 };
    a.qty += part.qty;
    a.roll += (part.rollLength ?? 0) * part.qty;
    a.area += (part.area ?? 0) * part.qty;
    a.length += (part.length ?? 0) * part.qty;
    agg.set(m.id, a);
  }
  for (const id of [...agg.keys()].sort(cmp)) {
    const m = cat.material(id)!;
    const a = agg.get(id)!;
    const price = (m.price ?? [0, 0]) as [number, number];
    switch (m.kind) {
      case 'mesh': line(m, ceilE((a.roll * (1 + waste)) / (m.rollLength ?? 15)), price, { detail: `${r2(a.roll)} m of roll` }); break;
      case 'sheet': line(m, ceilE((a.area * (1 + waste)) / ((m.sheetWidth ?? 1.22) * (m.sheetLength ?? 2.44))), price, { detail: `${r2(a.area)} m²` }); break;
      case 'fastener': line(m, ceilE((a.qty * (1 + over)) / (m.perBox ?? 100)), price, { detail: `${a.qty} pcs` }); break;
      case 'rope': line(m, ceilE(a.length / (m.rollLength ?? 15)), price, { detail: `${r2(a.length)} m` }); break;
      default: line(m, a.qty, price);
    }
  }
  return lines.sort((x, y) => CATEGORY_ORDER.indexOf(x.category) - CATEGORY_ORDER.indexOf(y.category) || cmp(x.materialId, y.materialId) || (x.stockLength ?? 0) - (y.stockLength ?? 0));
}

export const STEP_TEXT: Record<StepKey, { title: string; checklist: string[] }> = {
  base: { title: 'Prepare the base', checklist: ['Ground is level and firm under every wall', 'Pavers, floor or anchors placed as drawn'] },
  walls: { title: 'Frame the walls', checklist: ['Walls square (diagonals equal within ⅛″ / 3 mm)', 'Studs plumb; every joint screwed and corner-bracketed'] },
  attach: { title: 'Attach to the house', checklist: ['Ledger screws into studs, rim joist or masonry — not siding alone', 'Seal trim closes every gap at the wall'] },
  'roof-frame': { title: 'Frame the roof', checklist: ['Rafters and purlins fastened at both ends', 'Roof slope falls away from the house'] },
  openings: { title: 'Hang doors and fit openings', checklist: ['Doors swing freely with even gaps', 'Latches engage firmly; self-closers pull doors shut from fully open'] },
  mesh: { title: 'Fix the mesh', checklist: ['Every mesh edge lands on a frame member', 'Screws and washers every 6″ (15 cm); no loose edges', 'Cut wire ends filed, folded or covered'] },
  'roof-cover': { title: 'Fit the roof cover', checklist: ['Sheets lapped one corrugation at the sides', 'Roofing screws through the crowns, washers snug, not crushed'] },
  skirt: { title: 'Lay the ground skirt', checklist: ['Skirt fastened to the bottom plate all round', 'Laid flat outward and pinned every 12″ (30 cm)'] },
  furnish: { title: 'Fit shelves and furnishings', checklist: ['Brackets screwed into frame members, never mesh only', 'Each shelf takes a firm push without flexing'] },
  inspect: { title: 'Inspect before the cats go in', checklist: ['Walk the whole enclosure: no gap a finger-width larger than the mesh', 'Check doors, latches, hatches and the house junction from inside and out', 'Remove offcuts, screws and sharp wire from the floor', 'First visits supervised; watch for chewing, stress or escape attempts'] }
};

function steps(s: Structure, parts: Part[]): Step[] {
  const out: Step[] = [];
  for (const key of STEP_ORDER) {
    const mine = parts.filter((p) => p.step === key);
    if (!mine.length && key !== 'inspect') continue;
    out.push({ id: stableId(`${s.id}:step:${key}`), structureId: s.id, key, order: out.length + 1, title: STEP_TEXT[key].title, partIds: mine.map((p) => p.id), checklist: STEP_TEXT[key].checklist });
  }
  return out;
}

export function generate(project: Project, cat: Catalog): Assembly {
  const parts: Part[] = [];
  const structures: StructureInfo[] = [];
  const allSteps: Step[] = [];
  project.structures.forEach((s, i) => {
    const r = generateStructure(s, cat, project);
    const letter = letterFor(i);
    label(r.parts, letter);
    structures.push({ id: s.id, letter, name: s.name, conceptOnly: r.conceptOnly, unsupported: r.unsupported, skippedOpenings: r.skippedOpenings, skippedFurnishings: r.skippedFurnishings });
    parts.push(...r.parts);
    allSteps.push(...steps(s, r.parts));
  });
  const cuts = cutPlan(parts, cat, project.assumptions.stockLengths ?? [], project.assumptions.kerf ?? 0.003);
  const bom = billOfMaterials(parts, cuts, cat, project);
  const low = Math.floor(bom.reduce((a, l) => a + l.low, 0) + 1e-9);
  const high = Math.ceil(bom.reduce((a, l) => a + l.high, 0) - 1e-9);
  return {
    catalogVersion: cat.version,
    pricesAsOf: cat.pricesAsOf,
    currency: cat.currency,
    structures,
    parts,
    cuts,
    bom,
    cost: { low, high, currency: cat.currency },
    steps: allSteps,
    conceptOnly: structures.some((x) => x.conceptOnly || x.unsupported.length > 0)
  };
}

/** Parts belonging to one structure, in label order. */
export const partsOf = (a: Assembly, structureId: string) => a.parts.filter((p) => p.structureId === structureId);
