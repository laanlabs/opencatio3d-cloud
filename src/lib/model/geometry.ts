// Plan geometry in metres. Polygons are [x, y] arrays, open (first ≠ last), either winding.
// Structure transforms: local (u, v) → plan (x, y) = origin + u·(cos r, sin r) + v·(−sin r, cos r).
import type { HostWall, Polygon, Structure, Vec2 } from './types';

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const rad = (d: number) => (d * Math.PI) / 180;
export const deg = (r: number) => (r * 180) / Math.PI;
export type { Polygon };

export function signedArea(poly: Polygon): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}
export const polygonArea = (poly: Polygon) => Math.abs(signedArea(poly));

/** Strict interior test (ray casting). Points exactly on an edge may go either way. */
export function pointInPolygon(p: Vec2, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function bbox(points: Vec2[]): { min: Vec2; max: Vec2 } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { min: [x0, y0], max: [x1, y1] };
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const L2 = d[0] * d[0] + d[1] * d[1];
  const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / L2)) : 0;
  return dist(p, add(a, scale(d, t)));
}

export const polylineLength = (pts: Vec2[]) => pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);

/** Rectangle corners for a centre / size / rotation (degrees), as drawn in plan. */
export function rectCorners(cx: number, cy: number, w: number, d: number, rotationDeg: number): Vec2[] {
  const r = rad(rotationDeg), c = Math.cos(r), s = Math.sin(r);
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as Vec2[]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as Vec2);
}

/** Separating-axis overlap test for two convex polygons (touching edges do not count). */
export function convexOverlap(a: Polygon, b: Polygon): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const n: Vec2 = [q[1] - p[1], p[0] - q[0]];
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const v of a) { const d = dot(n, v); a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const v of b) { const d = dot(n, v); b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      if (a1 <= b0 + 1e-9 || b1 <= a0 + 1e-9) return false;
    }
  }
  return true;
}

// ---------- structures ----------

/** Plan point of a structure-local (u, v). */
export function toPlan(s: Pick<Structure, 'x' | 'y' | 'rotation'>, u: number, v: number): Vec2 {
  const r = rad(s.rotation), c = Math.cos(r), sn = Math.sin(r);
  return [s.x + u * c - v * sn, s.y + u * sn + v * c];
}

/** Structure-local (u, v) of a plan point. */
export function toLocal(s: Pick<Structure, 'x' | 'y' | 'rotation'>, p: Vec2): Vec2 {
  const r = rad(s.rotation), c = Math.cos(r), sn = Math.sin(r);
  const dx = p[0] - s.x, dy = p[1] - s.y;
  return [dx * c + dy * sn, -dx * sn + dy * c];
}

/** Plan footprint. Boxes: the w × d rectangle. Tunnels: the outline of every segment (one quad each). */
export function footprints(s: Structure): Polygon[] {
  if (s.template === 'tunnel' && s.path && s.path.length >= 2) {
    const out: Polygon[] = [];
    const h = s.width / 2;
    for (let i = 0; i < s.path.length - 1; i++) {
      const a = s.path[i], b = s.path[i + 1];
      const L = dist(a, b) || 1;
      const n: Vec2 = [-(b[1] - a[1]) / L * h, (b[0] - a[0]) / L * h];
      out.push(([add(a, n), add(b, n), sub(b, n), sub(a, n)] as Vec2[]).map(([u, v]) => toPlan(s, u, v)));
    }
    return out;
  }
  return [([[0, 0], [s.width, 0], [s.width, s.depth], [0, s.depth]] as Vec2[]).map(([u, v]) => toPlan(s, u, v))];
}

export const footprintArea = (s: Structure) => footprints(s).reduce((a, p) => a + polygonArea(p), 0);

// ---------- host walls ----------

export function wallDir(w: HostWall): Vec2 {
  const L = dist(w.a, w.b) || 1;
  return [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
}
/** Outdoor normal of a house wall. */
export function wallNormal(w: HostWall): Vec2 {
  const d = wallDir(w);
  return [-d[1], d[0]];
}
export const wallAngle = (w: HostWall) => deg(Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]));
/** Distance of plan point p along the wall from `a`. */
export const alongWall = (w: HostWall, p: Vec2) => dot(sub(p, w.a), wallDir(w));

export function snapTo(v: number, step: number) {
  return step > 0 ? Math.round(v / step) * step : v;
}
