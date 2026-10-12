// Focused rule tests: each scenario starts from a clean sample and changes one thing.
import { describe, expect, it } from 'vitest';
import { cat, rulesCase, sampleCase } from './helpers';
import { generate } from '../src/lib/generate/assembly';
import { activeBlockers, runChecks } from '../src/lib/analysis/checks';
import type { Project } from '../src/lib/model/types';
import { clone } from '../src/lib/model/types';

const ids = (p: Project) => runChecks(p, cat, generate(p, cat)).map((f) => f.ruleId);
const lean = () => clone(sampleCase('lean-to-window'));

describe('checks', () => {
  it('the samples have no blockers or warnings', () => {
    for (const s of ['lean-to-window', 'garden-retreat', 'window-box']) {
      const p = sampleCase(s);
      const f = runChecks(p, cat, generate(p, cat));
      expect(f.filter((x) => x.severity === 'blocker' || x.severity === 'warning').map((x) => x.ruleId), s).toEqual([]);
    }
  });

  it('never uses "safe" or "approved" in a finding', () => {
    const p = rulesCase();
    for (const f of runChecks(p, cat, generate(p, cat))) expect(`${f.title} ${f.message} ${f.remediation}`).not.toMatch(/\b(safe|approved)\b/i);
  });

  it('mesh openings: 2×4 fence blocks; 1×1 warns only with a kitten', () => {
    const p = lean();
    p.structures[0].mesh = { materialId: 'mesh-2x4-14ga-fence-48' };
    expect(ids(p)).toContain('CAT-ENC-001');
    const q = lean();
    expect(ids(q)).not.toContain('CAT-ENC-002');
    q.cats[0].ageClass = 'kitten';
    expect(ids(q)).toContain('CAT-ENC-002');
    q.structures[0].mesh = { materialId: 'mesh-half-1-16ga-gaw-36' };
    expect(ids(q)).not.toContain('CAT-ENC-002');
  });

  it('a resized structure loses its confirmation (CAT-DIM-001)', () => {
    const p = lean();
    expect(ids(p)).not.toContain('CAT-DIM-001');
    p.structures[0].width += 0.3;
    expect(ids(p)).toContain('CAT-DIM-001');
  });

  it('a dryer vent inside the catio blocks; outside it does not', () => {
    const p = lean();
    const vent = p.site.walls[0].openings.find((o) => o.kind === 'dryer-vent')!;
    expect(ids(p)).not.toContain('CAT-HOME-001');
    vent.offset = 3.5;
    expect(ids(p)).toContain('CAT-HOME-001');
  });

  it('a window only partly inside opens a gap (CAT-ENC-004) unless an insert serves it', () => {
    const p = lean();
    const s = p.structures[0];
    p.site.walls[0].openings.push({ id: 'w2', kind: 'window', offset: s.x + s.width - 0.3, width: 0.9, height: 1, sill: 0.9 });
    expect(ids(p)).toContain('CAT-ENC-004');
  });

  it('door latches, self-closers and gravity latches', () => {
    const p = lean();
    const door = p.structures[0].openings.find((o) => o.kind === 'human-door')!;
    door.latch = null;
    door.selfClosing = false;
    expect(ids(p)).toEqual(expect.arrayContaining(['CAT-ACC-001', 'CAT-ACC-002']));
    door.latch = 'gravity';
    expect(ids(p)).toContain('CAT-ACC-003');
  });

  it('plants: lilies block, catnip warns, cat grass is unknown', () => {
    const p = lean();
    p.plants[0].plantId = 'lily';
    p.plants[1].plantId = 'catnip';
    p.plants[2].plantId = 'cat-grass-oat';
    const r = ids(p);
    expect(r).toEqual(expect.arrayContaining(['CAT-PLT-001', 'CAT-PLT-002', 'CAT-PLT-003']));
  });

  it('acknowledgements settle warnings; professional reviews settle reviewable blockers only', () => {
    const p = rulesCase();
    const before = runChecks(p, cat, generate(p, cat));
    const egress = before.find((f) => f.ruleId === 'CAT-HOME-003')!;
    const dryer = before.find((f) => f.ruleId === 'CAT-HOME-001')!;
    const warn = before.find((f) => f.ruleId === 'CAT-WX-004')!;
    p.overrides = [
      { ruleId: egress.ruleId, targetId: egress.targetIds[0], kind: 'professional-review', note: 'Fire marshal OK', at: '2026-10-12' },
      { ruleId: dryer.ruleId, targetId: dryer.targetIds[0], kind: 'professional-review', note: 'nope', at: '2026-10-12' },
      { ruleId: warn.ruleId, targetId: warn.targetIds[0], kind: 'acknowledge', note: 'Sheltered corner', at: '2026-10-12' }
    ];
    const after = runChecks(p, cat, generate(p, cat));
    expect(after.find((f) => f.id === egress.id)!.status).toBe('reviewed');
    expect(after.find((f) => f.id === dryer.id)!.status).toBe('open');
    expect(after.find((f) => f.id === warn.id)!.status).toBe('acknowledged');
    expect(activeBlockers(after).some((f) => f.id === egress.id)).toBe(false);
  });

  it('senior cats need small steps or a ramp', () => {
    const p = lean();
    p.cats[0].ageClass = 'senior';
    p.structures[0].furnishings = p.structures[0].furnishings.filter((f) => f.componentId !== 'ramp');
    expect(ids(p)).toContain('CAT-MOB-001');
  });
});
