// Plan bounds of the house, structures and obstacles (camera and thumbnail framing). Kept apart from
// scene/build.ts so Home can use it without loading three.js.
import type { Project } from '../model/types';
import { rad } from '../model/geometry';

/** Bounds of the structures only (falls back to everything when there are none). */
export function structureBounds(p: Project): { min: [number, number]; max: [number, number] } {
  return p.structures.length ? sceneBounds({ ...p, site: { ...p.site, walls: [], obstacles: [] } }) : sceneBounds(p);
}

export function sceneBounds(p: Project): { min: [number, number]; max: [number, number] } {
  const xs: number[] = [], ys: number[] = [];
  const add = (x: number, y: number) => { xs.push(x); ys.push(y); };
  for (const w of p.site.walls) { add(...w.a); add(...w.b); }
  for (const s of p.structures) {
    const r = rad(s.rotation), c = Math.cos(r), sn = Math.sin(r);
    const pts: [number, number][] = s.template === 'tunnel' ? ((s.path ?? [[0, 0]]) as [number, number][]) : [[0, 0], [s.width, 0], [s.width, s.depth], [0, s.depth]];
    for (const [u, v] of pts) add(s.x + u * c - v * sn, s.y + u * sn + v * c);
  }
  for (const o of p.site.obstacles) { add(o.x - o.width / 2, o.y - o.depth / 2); add(o.x + o.width / 2, o.y + o.depth / 2); }
  if (!xs.length) { add(-3, -3); add(3, 3); }
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}
