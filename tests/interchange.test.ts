// OpenPlan3D interchange: round trips, plain OpenPlan3D imports, unknown keys and link privacy.
import { describe, expect, it } from 'vitest';
import { cat, rulesCase, sampleCase } from './helpers';
import { fromOpenPlan, isOpenPlanJson, toOpenPlan, wallsFromBuilding } from '../src/lib/io/openplan';
import { transferJson } from '../src/lib/io/transfer';
import { clone } from '../src/lib/model/types';

const strip = (p: any) => JSON.parse(JSON.stringify(p));

describe('interchange', () => {
  it('web → web keeps the project exactly (embedded web project)', () => {
    const p = sampleCase('garden-retreat');
    expect(strip(fromOpenPlan(strip(toOpenPlan(p, cat)), cat))).toEqual(strip(p));
  });

  it('the block alone (what iOS reads and writes) round-trips the project', () => {
    const p = rulesCase();
    const j = strip(toOpenPlan(p, cat, { embedWebProject: false }));
    expect(j.opencatio3d.webProject).toBeUndefined();
    j.opencatio3d.producer = 'ios';
    const back = fromOpenPlan(j, cat);
    expect(strip({ ...back, extra: {} })).toEqual(strip({ ...p, extra: {} }));
  });

  it('keeps unknown keys on the block, structures, openings and cats', () => {
    const p = sampleCase('lean-to-window');
    const j = strip(toOpenPlan(p, cat, { embedWebProject: false }));
    j.opencatio3d.futureField = { a: 1 };
    j.opencatio3d.structures[0].iosOnly = 'x';
    j.opencatio3d.structures[0].openings[0].hardwareSku = 'H-1';
    j.opencatio3d.cats[0].microchip = '985';
    const back = fromOpenPlan(j, cat);
    expect(back.extra.futureField).toEqual({ a: 1 });
    expect(back.structures[0].iosOnly).toBe('x');
    expect(back.structures[0].openings[0].hardwareSku).toBe('H-1');
    expect(back.cats[0].microchip).toBe('985');
    const again = strip(toOpenPlan(back, cat, { embedWebProject: false }));
    expect(again.opencatio3d.futureField).toEqual({ a: 1 });
  });

  it('exports house walls, windows, doors and one object per structure (tunnels per segment)', () => {
    const p = sampleCase('garden-retreat');
    const j = toOpenPlan(p, cat);
    expect(isOpenPlanJson(j)).toBe(true);
    expect(j.walls).toHaveLength(1);
    expect(j.windows).toHaveLength(1);
    expect(j.doors.map((d: any) => d.style)).toEqual(['patio']);
    expect(j.objects.map((o: any) => Object.keys(o.category)[0])).toEqual(['greenhouse', 'greenhouse_small']);
    for (const o of [...j.walls, ...j.windows, ...j.doors, ...j.objects]) {
      expect(o.transform).toHaveLength(16);
      expect(o.dimensions.every((x: number) => x > 0)).toBe(true);
    }
    for (const o of [...j.windows, ...j.doors]) expect(o.parentIdentifier).toBe(j.walls[0].identifier);
  });

  it('house walls survive a trip through plain OpenPlan3D arrays', () => {
    const p = sampleCase('lean-to-window');
    const j = toOpenPlan(p, cat);
    const walls = wallsFromBuilding({ walls: j.walls, doors: j.doors, windows: j.windows, openings: [], sections: [], stories: [], floors: [], defaults: {} });
    const w0 = p.site.walls[0], w1 = walls[0];
    expect(w1.a[0]).toBeCloseTo(w0.a[0], 4);
    expect(w1.b[1]).toBeCloseTo(w0.b[1], 4);
    const win = w1.openings.find((o) => o.kind === 'window')!, win0 = w0.openings.find((o) => o.kind === 'window')!;
    expect(win.offset).toBeCloseTo(win0.offset, 4);
    expect(win.sill).toBeCloseTo(win0.sill, 4);
  });

  it('imports a plain OpenPlan3D plan as house walls with no structures', () => {
    const p = sampleCase('lean-to-window');
    const plain: any = strip(toOpenPlan(p, cat));
    delete plain.opencatio3d;
    plain.objects = [{ identifier: 'sofa', dimensions: [2, 0.8, 0.9], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 0.4, -2, 1], category: { sofa: {} } }];
    const q = fromOpenPlan(plain, cat);
    expect(q.structures).toEqual([]);
    expect(q.site.walls).toHaveLength(1);
    expect(q.building?.objects).toHaveLength(1);
    expect(q.captureSource).toBe('openplan');
  });

  it('links carry no embedded web project and no photo file names', () => {
    const p = clone(sampleCase('window-box'));
    p.observations = [{ id: 'o', kind: 'photo', createdAt: '2026-10-12', author: 'ios', photoFile: 'IMG_0001.heic', text: 'gap here' }];
    const j = transferJson(p, cat);
    expect(j.opencatio3d.webProject).toBeUndefined();
    expect(j.opencatio3d.observations[0].photoFile).toBeUndefined();
    expect(j.opencatio3d.observations[0].text).toBe('gap here');
  });
});
