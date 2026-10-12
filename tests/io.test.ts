// Transfer links, routes, CSV, validation and units.
import { describe, expect, it } from 'vitest';
import { cat, sampleCase } from './helpers';
import { decodePayload, encodePayload, MAX_PAYLOAD_CHARS, shareUrl } from '../src/lib/io/transfer';
import { newProjectOptions, parseRoute, parseWorkspace } from '../src/lib/io/routes';
import { bomCsv, cell, cutListCsv } from '../src/lib/io/csv';
import { generate } from '../src/lib/generate/assembly';
import { normalizeProject } from '../src/lib/io/openplan';
import { takeSanitizeReport } from '../src/lib/io/validate';
import { fmtLen, localeUnits, parseLen } from '../src/lib/model/units';
import { summarizeProjects } from '../src/lib/io/storage';

describe('transfer links', () => {
  it('round-trips a payload', async () => {
    const j = { a: [1, 2, 3], s: 'catio ✓' };
    expect(await decodePayload(await encodePayload(j))).toEqual(j);
  });
  it('rejects oversized payloads and deflate bombs', async () => {
    await expect(decodePayload('A'.repeat(MAX_PAYLOAD_CHARS + 1))).rejects.toThrow(/too large/);
    const bomb = await encodePayload({ x: 'a'.repeat(200000) });
    await expect(decodePayload(bomb, 50000)).rejects.toThrow(/too large/);
  });
  it('share links open on the planner origin', async () => {
    const url = await shareUrl(sampleCase('window-box'), cat, 'https://app.opencatio3d.com');
    expect(url).toMatch(/^https:\/\/app\.opencatio3d\.com\/#\/view\/v1\/[A-Za-z0-9_-]+$/);
  });
});

describe('routes', () => {
  it('parses hashes', () => {
    expect(parseRoute('#/p/abc?ws=checks')).toMatchObject({ head: 'p', rest: ['abc'] });
    expect(parseWorkspace(new URLSearchParams('ws=checks'))).toBe('checks');
    expect(parseWorkspace(new URLSearchParams('ws=evil'))).toBeUndefined();
    expect(parseRoute('#/view/v1/a/b').rest).toEqual(['v1', 'a', 'b']);
  });
  it('validates #/new options from the website', () => {
    expect(newProjectOptions(new URLSearchParams('template=window-box&units=metric&cats=3&name=Mochi%27s'), 'imperial')).toEqual({ name: "Mochi's", units: 'metric', template: 'window-box', cats: 3 });
    expect(newProjectOptions(new URLSearchParams('template=rocket&units=parsecs&cats=99&name=%00%01'), 'imperial')).toEqual({ name: 'My catio', units: 'imperial', template: 'lean-to', cats: 1 });
  });
});

describe('csv', () => {
  it('guards formulas and quotes', () => {
    expect(cell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(cell(-3)).toBe('-3');
    expect(cell('a,"b"')).toBe('"a,""b"""');
  });
  it('writes the shopping list and cut list with a BOM and CRLF', () => {
    const a = generate(sampleCase('lean-to-window'), cat);
    const b = bomCsv(a), c = cutListCsv(a);
    expect(b.startsWith('﻿category,material_id')).toBe(true);
    expect(b.split('\r\n').length).toBe(a.bom.length + 2);
    expect(c.split('\r\n').length).toBe(a.cuts.materials.reduce((n, m) => n + m.bins.reduce((k, x) => k + x.cuts.length, 0), 0) + 2);
  });
});

describe('validation', () => {
  it('repairs or drops damaged data and reports it', () => {
    const p: any = JSON.parse(JSON.stringify(sampleCase('lean-to-window')));
    p.structures.push({ id: 'bad', template: 'lean-to', x: 'nope' });
    p.structures[0].openings.push({ id: 'o', kind: 'portal' });
    p.structures[0].frame = null;
    p.cats.push({ id: 'c', name: 5, ageClass: 'dragon' });
    p.assumptions.kerf = -1;
    const q = normalizeProject(p, cat);
    const r = takeSanitizeReport();
    expect(q.structures).toHaveLength(1);
    expect(q.structures[0].openings.every((o) => o.kind !== ('portal' as any))).toBe(true);
    expect(q.structures[0].frame.profile).toBe('wood-2x3');
    expect(q.cats[2]).toMatchObject({ name: 'Cat', ageClass: 'adult' });
    expect(q.assumptions.kerf).toBe(0.003);
    expect(r.count).toBeGreaterThanOrEqual(2);
  });
  it('leaves a valid project untouched (same objects)', () => {
    const p = normalizeProject(sampleCase('garden-retreat'), cat);
    const q = normalizeProject(p, cat);
    expect(q.structures).toBe(p.structures);
    expect(q.site.walls).toBe(p.site.walls);
  });
  it('library rows tolerate damaged records', () => {
    const rows = summarizeProjects([['a', { name: 'A', updatedAt: '2026-10-12', structures: [{ template: 'lean-to' }] }], ['b', 'junk'], ['c', null]]);
    expect(rows).toEqual([{ id: 'a', name: 'A', updatedAt: '2026-10-12', structures: 1, templates: ['lean-to'] }]);
  });
});

describe('units', () => {
  it('formats to the nearest ⅛″', () => {
    expect(fmtLen(2.438, 'imperial')).toBe('8′');
    expect(fmtLen(2.4, 'imperial')).toBe('7′ 10½″');
    expect(fmtLen(0.0254 * 36.5, 'imperial')).toBe('3′ ½″');
    expect(fmtLen(0.75, 'metric')).toBe('75 cm');
    expect(fmtLen(2.438, 'metric')).toBe('2.44 m');
  });
  it('parses feet, inches and fractions', () => {
    expect(parseLen("8' 6 1/2\"", 'imperial')).toBeCloseTo((8 * 12 + 6.5) * 0.0254, 9);
    expect(parseLen('36½in', 'imperial')).toBeCloseTo(36.5 * 0.0254, 9);
    expect(parseLen('8', 'imperial')).toBeCloseTo(8 * 0.3048, 9);
    expect(parseLen('2.4', 'metric')).toBe(2.4);
    expect(parseLen('40cm', 'imperial')).toBeCloseTo(0.4, 9);
    expect(parseLen('3/0in', 'imperial')).toBeNull();
    expect(parseLen('banana', 'metric')).toBeNull();
  });
  it('defaults US locales to imperial', () => {
    expect(localeUnits('en-US')).toBe('imperial');
    expect(localeUnits('en-GB')).toBe('metric');
  });
});
