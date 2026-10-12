// Feeds this app's exporter output through OpenPlan3D's real importer (validateRoomPlan +
// createProjectFromRoomPlan from the sibling ../../openplan/openPlan3D-cloud checkout). vite.config.ts
// runs this file as the `openplan` vitest project with OpenPlan3D's $lib aliases; it is skipped when
// the checkout (with node_modules) is missing. Override the location with OPENPLAN3D_DIR.
import { describe, expect, it } from 'vitest';
// @ts-ignore — resolved through the openplan project's $lib alias, not this repo's tsconfig
import { isRoomPlanJson, validateRoomPlan } from '$lib/utils/roomplanValidation';
// @ts-ignore
import { createProjectFromRoomPlan } from '$lib/utils/roomplanImport';
import { toOpenPlan } from '../src/lib/io/openplan';
import { allCases, cat } from './helpers';

describe('OpenCatio3D exports import into OpenPlan3D', () => {
  for (const c of allCases()) {
    it(c.name, () => {
      const data = JSON.parse(JSON.stringify(toOpenPlan(c.project, cat, { embedWebProject: false })));
      expect(isRoomPlanJson(data)).toBe(true);
      expect(() => validateRoomPlan(data)).not.toThrow();
      const op = createProjectFromRoomPlan(data, c.project.name) as any;
      const floor = op.floors.find((f: any) => f.level === 0) ?? op.floors[0];
      expect(floor.walls).toHaveLength(data.walls.length);
      expect(floor.windows).toHaveLength(data.windows.length);
      expect(floor.doors).toHaveLength(data.doors.length);
      const byId = new Map(floor.furniture.map((f: any) => [f.id, f]));
      for (const o of data.objects) {
        const f: any = byId.get(o.identifier);
        expect(f, o.identifier).toBeTruthy();
        expect(f.catalogId).toBe(Object.keys(o.category)[0]);
        expect(f.width).toBeCloseTo(o.dimensions[0] * 100, 1);
        expect(f.depth).toBeCloseTo(o.dimensions[2] * 100, 1);
      }
    });
  }
});
