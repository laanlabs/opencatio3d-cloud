// Generator properties: determinism, stable ids, cut-plan invariants and monotone resizing.
import { describe, expect, it } from 'vitest';
import { allCases, cat, templateCase } from './helpers';
import { generate, cutPlan } from '../src/lib/generate/assembly';
import { bayCount, stockFor } from '../src/lib/generate/structure';
import { OVERLAP } from '../src/lib/generate/parts';
import type { Project } from '../src/lib/model/types';
import { clone } from '../src/lib/model/types';

const resized = (p: Project, patch: Record<string, number>) => {
  const q = clone(p);
  Object.assign(q.structures[0], patch);
  return q;
};

describe('generator', () => {
  for (const c of allCases()) {
    it(`${c.name}: deterministic, unique ids, valid cut plan and BOM`, () => {
      const a = generate(c.project, cat), b = generate(clone(c.project), cat);
      expect(b).toEqual(a);
      const ids = a.parts.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const m of a.cuts.materials) {
        const mat = cat.material(m.materialId)!;
        const stocks = stockFor(mat, c.project.assumptions.stockLengths);
        for (const bin of m.bins) {
          expect(stocks).toContain(bin.stock);
          const used = bin.cuts.reduce((s, x) => s + x.length, 0) + a.cuts.kerf * (bin.cuts.length - 1);
          expect(used).toBeLessThanOrEqual(bin.stock + 1e-9);
          expect(bin.offcut).toBeGreaterThanOrEqual(-1e-9);
          for (const x of bin.cuts) expect(x.length).toBeLessThanOrEqual(bin.stock + 1e-9);
          // The bin is the shortest stock that fits.
          expect(stocks.filter((s) => s < bin.stock && s >= used - 1e-9)).toEqual([]);
        }
      }
      for (const p of a.parts) {
        expect(p.qty).toBeGreaterThan(0);
        if (p.kind === 'panel' && p.role !== 'mesh-skirt' && cat.material(p.materialId)?.kind === 'mesh') expect(p.width!).toBeLessThanOrEqual(cat.material(p.materialId)!.rollWidth! + 1e-9);
      }
      for (const l of a.bom) { expect(l.qty).toBeGreaterThan(0); expect(l.low).toBeLessThanOrEqual(l.high); }
      expect(a.cost.low).toBeLessThanOrEqual(a.cost.high);
      // Every non-fastener part is labelled; labels are unique per structure.
      const labels = a.parts.filter((p) => p.kind !== 'connector').map((p) => p.label);
      expect(labels.every(Boolean)).toBe(true);
      expect(new Set(labels).size).toBe(labels.length);
    });
  }

  it('part ids are stable when unrelated things change', () => {
    const p = templateCase('freestanding', 'default');
    const a = generate(p, cat);
    const q = clone(p);
    q.cats = [];
    q.name = 'Renamed';
    expect(generate(q, cat).parts.map((x) => x.id)).toEqual(a.parts.map((x) => x.id));
  });

  it('wider structures never need fewer studs, panels or dollars', () => {
    const base = templateCase('freestanding', 'default');
    let prev = generate(base, cat);
    for (const w of [2.8, 3.4, 4.2, 5.1, 6]) {
      const a = generate(resized(base, { width: w }), cat);
      const count = (x: typeof a, role: string) => x.parts.filter((p) => p.role === role).length;
      expect(count(a, 'stud')).toBeGreaterThanOrEqual(count(prev, 'stud'));
      expect(count(a, 'mesh-wall')).toBeGreaterThanOrEqual(count(prev, 'mesh-wall'));
      expect(a.cost.low).toBeGreaterThanOrEqual(prev.cost.low);
      prev = a;
    }
  });

  it('bays keep the pitch under the post spacing and the mesh within the roll', () => {
    for (const L of [0.5, 1.2, 1.21, 2.438, 3.7, 6]) {
      const n = bayCount(L, 1.2, 1.219);
      expect(L / n).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(L / n + OVERLAP).toBeLessThanOrEqual(1.219 + 1e-9);
      if (n > 1) expect(L / (n - 1) > 1.2 || L / (n - 1) + OVERLAP > 1.219).toBe(true);
    }
  });

  it('cut plan packs first-fit decreasing with kerf and buys the shortest stock that fits', () => {
    const mk = (id: string, length: number) => ({ id, structureId: 's', key: id, kind: 'member' as const, role: 'stud', materialId: 'lumber-2x4-spf', qty: 1, step: 'walls' as const, length, label: id });
    const plan = cutPlan([mk('a', 1.2), mk('b', 1.2), mk('c', 2.4), mk('d', 0.5), mk('e', 5.0)], cat, [], 0.003);
    const m = plan.materials[0];
    expect(m.overlong.map((x) => x.partId)).toEqual(['e']);
    // Longest 2×4 stock is 16 ft: c + a + b share one board (bought as 16 ft), d gets the shortest (8 ft).
    expect(m.bins.map((b) => [b.stock, b.cuts.map((x) => x.partId)])).toEqual([[4.877, ['c', 'a', 'b']], [2.438, ['d']]]);
  });

  it('spans longer than any stock are spliced, not overlong', () => {
    const p = templateCase('lean-to', 'max');
    const a = generate(p, cat);
    expect(a.cuts.materials.every((m) => m.overlong.length === 0)).toBe(true);
    expect(a.parts.some((x) => /plate-bottom:p1$/.test(x.key))).toBe(true);
  });

  it('honours the project stock lengths', () => {
    const p = templateCase('freestanding', 'default');
    p.assumptions.stockLengths = [3.048];
    const a = generate(p, cat);
    for (const m of a.cuts.materials.filter((x) => cat.material(x.materialId)?.stockLengths?.includes(3.048))) for (const b of m.bins) expect(b.stock).toBe(3.048);
  });

  it('concept-only templates still draw but never count as buildable', () => {
    const a = generate(templateCase('porch-infill', 'default'), cat);
    expect(a.parts.length).toBeGreaterThan(20);
    expect(a.conceptOnly).toBe(true);
  });
});
