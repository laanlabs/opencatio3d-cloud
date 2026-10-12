// Parity fixtures shared with opencatio3d-ios (EXPORT_FORMAT.md "Parity fixtures").
//   tests/fixtures/web/<case>.openplan3d.json  — what the web exports (iOS imports it and must reproduce…)
//   tests/fixtures/web/<case>.expected.json    — …this generator + checks output exactly.
//   tests/fixtures/ios/<case>.openplan3d.json + .expected.json — written by the iOS InteropTests; checked here when present.
// Regenerate the web side with `npm run fixtures` (OC3D_WRITE_FIXTURES=1) after an intended change.
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allCases, cat, summarize } from './helpers';
import { fromOpenPlan, sortedJson, toOpenPlan } from '../src/lib/io/openplan';

const dir = join(__dirname, 'fixtures');
const WRITE = process.env.OC3D_WRITE_FIXTURES === '1';

describe('web parity fixtures', () => {
  const cases = allCases();
  if (WRITE) mkdirSync(join(dir, 'web'), { recursive: true });
  for (const c of cases) {
    it(c.name, () => {
      const file = toOpenPlan(c.project, cat, { embedWebProject: false });
      const expected = summarize(c.project);
      const fp = join(dir, 'web', `${c.name}.openplan3d.json`), ep = join(dir, 'web', `${c.name}.expected.json`);
      if (WRITE) {
        writeFileSync(fp, sortedJson(file, 1) + '\n');
        writeFileSync(ep, sortedJson(expected, 1) + '\n');
      }
      expect(JSON.parse(readFileSync(fp, 'utf8'))).toEqual(JSON.parse(sortedJson(file)));
      expect(JSON.parse(readFileSync(ep, 'utf8'))).toEqual(JSON.parse(sortedJson(expected)));
      // What iOS reads back (the block, no embedded web project) generates the same output.
      expect(summarize(fromOpenPlan(file, cat))).toEqual(expected);
    });
  }
});

const iosDir = join(dir, 'ios');
const iosCases = existsSync(iosDir) ? readdirSync(iosDir).filter((f) => f.endsWith('.openplan3d.json')) : [];
describe.skipIf(!iosCases.length)('iOS parity fixtures', () => {
  for (const f of iosCases) {
    it(f, () => {
      const p = fromOpenPlan(JSON.parse(readFileSync(join(iosDir, f), 'utf8')), cat);
      const expected = JSON.parse(readFileSync(join(iosDir, f.replace('.openplan3d.json', '.expected.json')), 'utf8'));
      expect(JSON.parse(sortedJson(summarize(p)))).toEqual(expected);
    });
  }
});
