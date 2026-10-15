// Catio Prowl movement: a cat-sized cylinder that walks on surfaces, steps up small heights, falls off
// edges and is kept inside the world's volumes. Leaps are "context" leaps (as in third-person cat games):
// the ledge the cat faces is found ahead of time and shown, and one key or tap carries the cat there
// along an arc that is checked against walls, solid furniture and boards. No browser APIs: tested in node.
import type { Vec2, Vec3 } from '../model/types';
import type { Rect, Region, Surface, Volume, World } from './world';

export const R = 0.11; // body radius
export const HEAD = 0.26; // standing height (solid furniture)
export const CROUCH = 0.2; // headroom a cat needs under a roof or ceiling: cats crouch
export const STEP = 0.14; // walks up this without a leap
export const MAX_UP = 1.6;
export const MAX_REACH = 1.9;
const G = 9.8;

export interface Leap { from: Vec3; to: Vec3; t: number; T: number; up: boolean; apex: number; surfaceId: string; h0?: number; h1?: number }
export interface CatState {
  p: Vec3;
  v: Vec2;
  vy: number;
  heading: number;
  ground: boolean;
  surfaceId: string | null;
  leap: Leap | null;
}
export interface MoveInput { move: Vec2; sneak?: boolean; jump?: boolean }
export interface LeapTarget { p: Vec3; surface: Surface; kind: 'up' | 'down' | 'across'; apex: number }
export type StepEvent = { type: 'leap'; target: LeapTarget } | { type: 'hop' } | { type: 'land'; drop: number; surfaceId: string | null };

// ---------- geometry ----------

/** Point in an oriented rectangle, shrunk by `margin` (negative grows it). */
export function inRect(r: Rect, x: number, z: number, margin = 0): boolean {
  const dx = x - r.c[0], dz = z - r.c[1];
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  const lx = dx * c + dz * s, lz = -dx * s + dz * c;
  return Math.abs(lx) <= r.h[0] - margin && Math.abs(lz) <= r.h[1] - margin;
}

/** Clamp a point into an oriented rectangle shrunk by `margin` (to its centre if it is too small). */
export function clampInto(r: Rect, x: number, z: number, margin: number): Vec2 {
  const dx = x - r.c[0], dz = z - r.c[1];
  const c = Math.cos(r.yaw), s = Math.sin(r.yaw);
  let lx = dx * c + dz * s, lz = -dx * s + dz * c;
  const mx = Math.max(0, r.h[0] - margin), mz = Math.max(0, r.h[1] - margin);
  lx = Math.max(-mx, Math.min(mx, lx));
  lz = Math.max(-mz, Math.min(mz, lz));
  return [r.c[0] + lx * c - lz * s, r.c[1] + lx * s + lz * c];
}

export function topAt(s: Surface, x: number, z: number): number {
  if (s.low === undefined) return s.top;
  const lx = (x - s.c[0]) * Math.cos(s.yaw) + (z - s.c[1]) * Math.sin(s.yaw);
  const t = Math.max(0, Math.min(1, (lx + s.h[0]) / (2 * s.h[0])));
  return s.low + (s.top - s.low) * t;
}

function inPoly(poly: Vec2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export const ceilAt = (v: Volume, x: number, z: number) => v.ceil[0] + v.ceil[1] * x + v.ceil[2] * z;

/** Ceiling over a body at (x, y, z): the lowest of the highest ceilings over its centre and edges. */
export function headroom(w: World, x: number, y: number, z: number, rad = R): number {
  const pts: Vec2[] = [[x, z], [x + rad, z], [x - rad, z], [x, z + rad], [x, z - rad]];
  let low = Infinity;
  for (const [px, pz] of pts) {
    let hi = -Infinity;
    for (const v of w.volumes) if (y >= v.y0 - 0.03 && inPoly(v.poly, px, pz)) hi = Math.max(hi, ceilAt(v, px, pz));
    if (hi > -Infinity) low = Math.min(low, hi);
  }
  return low;
}

/** A point inside some volume, clear of its floor and ceiling (for the camera: walls, mesh and roofs). */
export const inVolumes = (w: World, x: number, y: number, z: number, pad = 0.04, wide = false) =>
  (wide ? w.cameraVolumes : w.volumes).some((v) => inPoly(v.poly, x, z) && y > v.y0 + pad && y < ceilAt(v, x, z) - pad);

/** A point inside solid furniture (grown by `pad`). */
export const inFurnitureAt = (w: World, x: number, y: number, z: number, pad = 0.04) =>
  w.surfaces.some((s) => s.solid && y < s.top + pad && y > s.bottom - pad && inRect(s, x, z, -pad));

/** A point inside some volume, clear of its floor and ceiling and outside solid furniture (for the camera). */
export function openAir(w: World, x: number, y: number, z: number, pad = 0.04, wide = false): boolean {
  return inVolumes(w, x, y, z, pad, wide) && !inFurnitureAt(w, x, y, z, pad);
}

/** Whether a body standing at (x, y, z) with radius `rad` fits inside the union of volumes. */
export function contained(w: World, x: number, y: number, z: number, rad = R, height = CROUCH): boolean {
  const pts: Vec2[] = rad > 0 ? [[x, z], [x + rad, z], [x - rad, z], [x, z + rad], [x, z - rad]] : [[x, z]];
  return pts.every(([px, pz]) => w.volumes.some((v) => y >= v.y0 - 0.03 && inPoly(v.poly, px, pz) && y + height <= ceilAt(v, px, pz) + 1e-6));
}

/** Highest surface top under (x, z) that is at or below `maxY`. */
export function groundAt(w: World, x: number, z: number, maxY: number): { y: number; surface: Surface | null } {
  let y = -Infinity;
  let surface: Surface | null = null;
  for (const s of w.surfaces) {
    if (!inRect(s, x, z)) continue;
    const t = topAt(s, x, z);
    if (t <= maxY + 1e-6 && t > y) { y = t; surface = s; }
  }
  return { y, surface };
}

/** A board (a shelf, ramp, bridge, hammock or window ledge) through a body at (x, y, z): it only carries a cat,
 *  but between a step above its paws and its head it is in the way. A cat lined up with a ramp's foot (centre
 *  at cx, cz) walks up onto it rather than into it. */
function boardIn(s: Surface, x: number, z: number, y: number, rad: number, cx: number, cz: number): boolean {
  if (s.solid || s.kind === 'floor' || s.kind === 'post' || !inRect(s, x, z, -rad)) return false;
  if (s.low === undefined) return s.top > y + STEP && s.bottom < y + HEAD;
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  const hi = topAt(s, x + c * rad, z + sn * rad), lo = topAt(s, x - c * rad, z - sn * rad) - (s.thick ?? 0.03);
  if (hi <= y + STEP || lo >= y + HEAD) return false;
  const across = -(cx - s.c[0]) * sn + (cz - s.c[1]) * c;
  return !(Math.abs(across) <= s.h[1] && topAt(s, cx, cz) <= y + STEP + 0.01);
}

/** Solid furniture taller than a step, or a board, in the way of a body at (x, y, z); (cx, cz) is the cat's centre. */
export function blocked(w: World, x: number, z: number, y: number, rad = R, cx = x, cz = z): boolean {
  return w.surfaces.some((s) => (s.solid ? s.top > y + STEP && s.bottom < y + HEAD && inRect(s, x, z, -rad) : boardIn(s, x, z, y, rad, cx, cz)));
}

const canStand = (w: World, x: number, z: number, y: number) => contained(w, x, y, z) && !blocked(w, x, z, y);

/** The cat's body beyond the centre cylinder, as circles along its heading: nose, chest and hips
 *  (forward distance from the centre, radius). The tail is left out: it bends out of the way. */
export const BODY: readonly [number, number][] = [[0.25, 0.035], [0.13, 0.06], [-0.15, 0.06]];

/** Plan points of the body samples for a cat at (x, z) facing `heading`. */
export function bodyPoints(x: number, z: number, heading: number): [number, number, number][] {
  const fx = Math.sin(heading), fz = Math.cos(heading);
  return BODY.map(([d, r]) => [x + fx * d, z + fz * d, r]);
}

/** Whether the nose, chest and hips are inside the volumes (walls, mesh, roofs). */
export const wallsClear = (w: World, x: number, z: number, y: number, heading: number) =>
  bodyPoints(x, z, heading).every(([px, pz, r]) => contained(w, px, y, pz, r, CROUCH * 0.75));

/** Which of the nose, chest and hips (bits 1, 2, 4) are in solid furniture or a board. */
export const inFurniture = (w: World, x: number, z: number, y: number, heading: number) =>
  bodyPoints(x, z, heading).reduce((m, [px, pz, r], i) => (blocked(w, px, pz, y, r, x, z) ? m | (1 << i) : m), 0);

/** Whether the nose, chest and hips are clear of solid furniture and boards, and inside the volumes. */
export const bodyClear = (w: World, x: number, z: number, y: number, heading: number) => wallsClear(w, x, z, y, heading) && !inFurniture(w, x, z, y, heading);

/** A cat standing there, centre and body. */
export const fits = (w: World, x: number, z: number, y: number, heading: number) => canStand(w, x, z, y) && bodyClear(w, x, z, y, heading);

/** Push a standing cat whose body pokes into something (after a turn or a landing) back out: the nearest
 *  spot within 15 cm, on the same surface, where it fits. Null when there is none (a tight tunnel). */
export function unpoke(w: World, st: CatState, onGround = true, reach = 0.15): Vec2 | null {
  const [x, y, z] = st.p;
  if (bodyClear(w, x, z, y, st.heading)) return null;
  const fx = Math.sin(st.heading), fz = Math.cos(st.heading);
  for (let k = 0.02; k <= reach + 1e-9; k += 0.02) {
    for (const [ax, az] of [[-fx, -fz], [fx, fz], [fz, -fx], [-fz, fx], [-fx + fz, -fz - fx], [-fx - fz, -fz + fx]] as Vec2[]) {
      const m = Math.hypot(ax, az);
      const qx = x + (ax / m) * k, qz = z + (az / m) * k;
      if (!fits(w, qx, qz, y, st.heading)) continue;
      if (!onGround) {
        // Falling: it has to fit where it lands as well (a tunnel riser is too short for that: it squeezes).
        const g = groundAt(w, qx, qz, y + 0.02);
        if (!g.surface || fits(w, qx, qz, g.y, st.heading) || regionAt(w, [qx, g.y, qz]) === 'tunnel') return [qx, qz];
        continue;
      }
      const g = groundAt(w, qx, qz, y + 0.01);
      if (g.surface && Math.abs(g.y - y) < 0.01) return [qx, qz];
    }
  }
  return null;
}

// ---------- leaps ----------

/** Position along a leap at k ∈ [0, 1]: up-leaps rise first and travel late, so they clear the edge they land on. */
export function leapPos(l: Pick<Leap, 'from' | 'to' | 'up' | 'apex'>, k: number): Vec3 {
  const { from, to, up } = l;
  const e = up ? Math.pow(k, 2.2) : k;
  const top = l.apex;
  const kr = up ? 0.62 : 0.28;
  const y = k < kr ? from[1] + (top - from[1]) * Math.sin((k / kr) * (Math.PI / 2)) : top + (to[1] - top) * Math.pow((k - kr) / (1 - kr), 2);
  return [from[0] + (to[0] - from[0]) * e, y, from[2] + (to[2] - from[2]) * e];
}

function pathClear(w: World, from: Vec3, to: Vec3, up: boolean, apex: number, target: Surface, current: string | null): boolean {
  for (let k = 0.1; k < 0.95; k += 0.1) {
    const q = leapPos({ from, to, up, apex }, k);
    if (!contained(w, q[0], q[1], q[2], R * 0.7, CROUCH * 0.9)) return false;
    for (const s of w.surfaces) {
      if (s.id === target.id || s.id === current) continue;
      if (s.solid) {
        if (q[1] < s.top - 0.03 && q[1] + HEAD * 0.8 > s.bottom && inRect(s, q[0], q[2], -0.04)) return false;
      } else if (s.kind !== 'floor' && inRect(s, q[0], q[2], -0.02)) {
        const t = topAt(s, q[0], q[2]);
        if (q[1] < t - 0.01 && q[1] + HEAD > t - 0.05) return false; // a board through the body
      }
    }
  }
  return true;
}

/** The ledge the cat would leap to, facing `heading`: nearest upward ledge first, then across a gap, then down. */
export function leapTarget(w: World, st: CatState): LeapTarget | null {
  if (!st.ground || st.leap) return null;
  const [x, y, z] = st.p;
  const fx = Math.sin(st.heading), fz = Math.cos(st.heading);
  const rx = fz, rz = -fx;
  let best = null as { t: LeapTarget; score: number } | null;
  for (let d = 0.3; d <= MAX_REACH + 1e-9; d += 0.1) {
    for (const lat of [0, -0.16, 0.16]) {
      const px = x + fx * d + rx * lat, pz = z + fz * d + rz * lat;
      for (const s of w.surfaces) {
        // A ramp can be hopped onto from the side (a steep one has no foot to walk onto), but not along itself.
        if (s.kind === 'post' || (s.low !== undefined && s.id === st.surfaceId) || !inRect(s, px, pz, 0.04)) continue;
        const ty = topAt(s, px, pz);
        if (s.id === st.surfaceId && Math.abs(ty - y) < 0.05) continue;
        const dy = ty - y;
        if (dy > MAX_UP || dy < -3) continue;
        let kind: LeapTarget['kind'] = dy > STEP ? 'up' : dy < -0.35 ? 'down' : 'across';
        if (kind === 'across') {
          // Only a leap if there is a drop in between; otherwise the cat can just walk there.
          const mx = (x + px) / 2, mz = (z + pz) / 2;
          if (groundAt(w, mx, mz, y + STEP).y > y - 0.3) continue;
        }
        if (kind !== 'up' && d < 0.45) continue;
        let [lx, lz] = clampInto(s, px, pz, Math.min(0.12, Math.min(s.h[0], s.h[1]) * 0.6));
        // A narrow board against a wall (a ramp up the mesh): land on its near side, where the body fits.
        for (let k = 0.03, m = Math.hypot(x - lx, z - lz); k <= 0.09 + 1e-9 && m > 0.1 && !canStand(w, lx, lz, topAt(s, lx, lz)); k += 0.03) {
          const qx = lx + ((x - lx) / m) * 0.03, qz = lz + ((z - lz) / m) * 0.03;
          if (!inRect(s, qx, qz, 0.02)) break;
          [lx, lz] = [qx, qz];
        }
        const ly = topAt(s, lx, lz);
        if (groundAt(w, lx, lz, ly + 0.01).surface?.id !== s.id) continue; // something else sits on top there
        if (!canStand(w, lx, lz, ly)) continue;
        // No room for the body (a shelf just above), except in a tunnel riser, which is shorter than a cat anyway.
        if (landingHeading(w, [lx, ly, lz], Math.atan2(lx - x, lz - z)) === null && regionAt(w, [lx, ly, lz]) !== 'tunnel') continue;
        const up = ly > y + 0.05;
        // Arc height: a little above the higher end, lowered to fit under a catio roof.
        const hi = Math.max(y, ly);
        let room = Infinity;
        for (let f = 0; f <= 1.001; f += 0.25) room = Math.min(room, headroom(w, x + (lx - x) * f, hi, z + (lz - z) * f, R * 0.7));
        const apex = Math.min(hi + (up ? 0.2 : 0.16), room - CROUCH * 0.9 - 0.01);
        if (apex < hi + 0.02) continue;
        if (!pathClear(w, [x, y, z], [lx, ly, lz], up, apex, s, st.surfaceId)) continue;
        const score = (kind === 'up' ? 0 : kind === 'across' ? 3 : 6) + d - (kind === 'up' ? 0.15 * dy : 0) + Math.abs(lat);
        if (!best || score < best.score) best = { t: { p: [lx, ly, lz], surface: s, kind, apex }, score };
      }
    }
    if (best && best.t.kind === 'up' && d > Math.hypot(best.t.p[0] - x, best.t.p[2] - z) + 0.3) break;
  }
  return best?.t ?? null;
}

/** The heading nearest `h` in which a cat standing at p fits nose to hips (it lands turned along a narrow
 *  shelf or a window seat rather than with its nose in the wall); null when none does. */
export function landingHeading(w: World, p: Vec3, h: number): number | null {
  for (let k = 0; k <= 9; k++) for (const sg of k ? [1, -1] : [1]) if (bodyClear(w, p[0], p[2], p[1], h + sg * k * 0.35)) return h + sg * k * 0.35;
  return null;
}

export function startLeap(st: CatState, t: LeapTarget, w?: World) {
  const from: Vec3 = [...st.p];
  const dist = Math.hypot(t.p[0] - from[0], t.p[2] - from[2]);
  if (dist > 0.05) st.heading = Math.atan2(t.p[0] - from[0], t.p[2] - from[2]);
  const h1 = (w ? landingHeading(w, t.p, st.heading) : null) ?? st.heading;
  st.leap = { from, to: t.p, t: 0, T: 0.32 + 0.12 * dist + 0.1 * Math.abs(t.p[1] - from[1]), up: t.p[1] > from[1] + 0.05, apex: t.apex, surfaceId: t.surface.id, h0: st.heading, h1 };
  st.ground = false;
  st.v = [0, 0];
}

// ---------- stepping ----------

export function newCat(p: Vec3, heading: number, w: World): CatState {
  const g = groundAt(w, p[0], p[2], p[1] + STEP);
  return { p: [p[0], g.surface ? g.y : p[1], p[2]], v: [0, 0], vy: 0, heading, ground: true, surfaceId: g.surface?.id ?? null, leap: null };
}

function turnToward(a: number, b: number, max: number) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + Math.max(-max, Math.min(max, d));
}

/** Turn a cat toward `goal` by up to `max`. On the ground it does not swing its nose or hips into furniture:
 *  it steps back to make room, turns the other way round, or stops turning. In the air it turns unless that
 *  swings it into furniture where it will land. */
function turn(w: World, st: CatState, goal: number, max: number) {
  const nh = turnToward(st.heading, goal, max);
  if (!st.ground) {
    // In a hop or a fall: turn freely, except into furniture beside the spot it will land on.
    const [x, y, z] = st.p, g = groundAt(w, x, z, y + 0.02).y;
    if (!Number.isFinite(g) || !inFurniture(w, x, z, g, nh)) st.heading = nh;
    return;
  }
  const [x, y, z] = st.p;
  const now = inFurniture(w, x, z, y, st.heading);
  if (!(inFurniture(w, x, z, y, nh) & ~now)) { st.heading = nh; return; }
  const out = unpoke(w, { ...st, heading: nh });
  if (out) { st.heading = nh; st.p = [out[0], y, out[1]]; return; }
  // The other way round, toward a heading it can take here.
  if (inFurniture(w, x, z, y, goal) & ~now) return;
  let d = goal - st.heading;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const lh = st.heading - Math.sign(d || 1) * max;
  if (!(inFurniture(w, x, z, y, lh) & ~now)) st.heading = lh;
}

/** The heading, nearest its own, in which a cat stepping off an edge at (x, z) comes down clear (where it
 *  lands, or within 30 cm of it): it turns as it drops. Null when none does (it stays on the edge). */
function dropHeading(w: World, st: CatState, x: number, z: number): number | null {
  const g = groundAt(w, x, z, st.p[1]);
  if (!g.surface) return st.heading;
  for (let k = 0; k <= 9; k++) for (const sg of k ? [1, -1] : [1]) {
    const h = st.heading + sg * k * 0.35;
    if (!inFurniture(w, x, z, g.y, h) || unpoke(w, { ...st, p: [x, g.y, z], heading: h }, false, 0.3)) return h;
  }
  // A tunnel riser is shorter than a cat: it squeezes down it, as it squeezes through the tunnel.
  return regionAt(w, [x, g.y, z]) === 'tunnel' ? st.heading : null;
}

/** Advance the cat by dt seconds. Returns what happened (leaps, hops, landings). */
export function step(w: World, st: CatState, input: MoveInput, dt: number): StepEvent[] {
  const ev: StepEvent[] = [];
  if (st.leap) {
    const l = st.leap;
    l.t += dt;
    const k = Math.min(1, l.t / l.T);
    st.p = leapPos(l, k);
    // Turn in the air to the landing heading, mostly in the second half.
    if (l.h0 !== undefined && l.h1 !== undefined) { const e = Math.max(0, Math.min(1, (k - 0.3) / 0.6)); st.heading = l.h0 + (l.h1 - l.h0) * e * e * (3 - 2 * e); }
    if (k >= 1) {
      st.p = [...l.to];
      st.leap = null;
      st.ground = true;
      st.vy = 0;
      st.surfaceId = l.surfaceId;
      ev.push({ type: 'land', drop: Math.max(0, l.from[1] - l.to[1]), surfaceId: l.surfaceId });
    }
    return ev;
  }

  // Leap or hop.
  if (input.jump && st.ground) {
    const t = leapTarget(w, st);
    if (t) { startLeap(st, t, w); ev.push({ type: 'leap', target: t }); return ev; }
    st.ground = false;
    st.vy = 2.4;
    ev.push({ type: 'hop' });
  }

  // Walk.
  const [mx, mz] = input.move;
  const mag = Math.min(1, Math.hypot(mx, mz));
  const speed = input.sneak ? 0.65 : 1.7;
  const tv: Vec2 = mag > 0.02 ? [(mx / Math.hypot(mx, mz)) * mag * speed, (mz / Math.hypot(mx, mz)) * mag * speed] : [0, 0];
  const acc = Math.min(1, (st.ground ? 12 : 3) * dt);
  st.v = [st.v[0] + (tv[0] - st.v[0]) * acc, st.v[1] + (tv[1] - st.v[1]) * acc];
  if (mag > 0.05) turn(w, st, Math.atan2(mx, mz), 10 * dt);
  // A turn (or a landing) can leave the nose or hips in a wall or furniture: step back out.
  if (st.ground) { const out = unpoke(w, st); if (out) st.p = [out[0], st.p[1], out[1]]; }
  let [x, y, z] = st.p;
  const dx = st.v[0] * dt, dz = st.v[1] * dt;
  if (dx || dz) {
    // The whole body has to fit, nose to hips, so the cat stops with its nose at a face. Where it does not fit
    // already (turning round in a tunnel) only the centre is checked, so it can always walk out.
    const hd = st.heading;
    const wallsOk = !st.ground || wallsClear(w, x, z, y, hd);
    const stuckIn = st.ground ? inFurniture(w, x, z, y, hd) : 0;
    // In a hop the spot below has to take the cat as well (it lands there): not beside a pot with its chest in it.
    const landsOk = (qx: number, qz: number, h: number) => { const g = groundAt(w, qx, qz, y + 0.02); return !g.surface || (!blocked(w, qx, qz, g.y) && !inFurniture(w, qx, qz, g.y, h)) || regionAt(w, [qx, g.y, qz]) === 'tunnel'; };
    const ok = (qx: number, qz: number, h = hd) => canStand(w, qx, qz, y) && (!wallsOk || wallsClear(w, qx, qz, y, h)) && (inFurniture(w, qx, qz, y, h) & ~stuckIn) === 0 && (st.ground || landsOk(qx, qz, h));
    // The cat turns along the wall it slides on.
    const along = (rx: number, rz: number) => turnToward(hd, Math.atan2(rx, rz), 6 * dt);
    if (ok(x + dx, z + dz)) { x += dx; z += dz; }
    // Slide along an axis only when that is a real part of the move (not a sliver that stops the cat dead).
    else if (Math.abs(dx) > 0.3 * Math.hypot(dx, dz) && ok(x + dx, z, along(dx, 0))) { x += dx; st.v[1] = 0; st.heading = along(dx, 0); }
    else if (Math.abs(dz) > 0.3 * Math.hypot(dx, dz) && ok(x, z + dz, along(0, dz))) { z += dz; st.v[0] = 0; st.heading = along(0, dz); }
    else {
      // Slide along a wall at an angle (tunnels, cat flaps and walls that are not square to the axes).
      const slide = [0.5, -0.5, 1.0, -1.0].map((a) => { const c = Math.cos(a), sn = Math.sin(a); return [(dx * c - dz * sn) * c, (dx * sn + dz * c) * c] as Vec2; }).find(([rx, rz]) => ok(x + rx, z + rz, along(rx, rz)));
      if (slide) { x += slide[0]; z += slide[1]; st.heading = along(slide[0], slide[1]); }
      else {
        // Line up with an opening just to one side (a tunnel mouth, a cat flap) and go through.
        const m = Math.hypot(dx, dz), fx = dx / m, fz = dz / m;
        let shift = 0;
        for (let k = 0.01; k <= 0.12 + 1e-9 && !shift; k += 0.01) for (const sg of [1, -1]) if (ok(x - fz * k * sg + fx * 0.03, z + fx * k * sg + fz * 0.03)) { shift = k * sg; break; }
        const lat = Math.sign(shift) * Math.min(Math.abs(shift), m);
        if (lat && ok(x - fz * lat, z + fx * lat)) { x -= fz * lat; z += fx * lat; } else st.v = [0, 0];
      }
    }
  }

  // Up and down.
  if (st.ground) {
    const g = groundAt(w, x, z, y + STEP);
    if (!g.surface || g.y < y - 0.03) {
      // Stepping off an edge: only where the body can come down clear of what it leaves (not into a tight corner).
      const drop = dropHeading(w, st, x, z);
      if (drop === null) { x = st.p[0]; z = st.p[2]; st.v = [0, 0]; }
      else { st.heading = drop; st.ground = false; st.vy = 0; }
    }
    // Stepping up onto something: the body has to fit there too (no shelf just above the bed it steps onto).
    else if (g.y > y && (!canStand(w, x, z, g.y) || (inFurniture(w, x, z, g.y, st.heading) & ~inFurniture(w, st.p[0], st.p[2], y, st.heading)))) { x = st.p[0]; z = st.p[2]; st.v = [0, 0]; }
    else { y = g.y; st.surfaceId = g.surface.id; }
  }
  if (!st.ground) {
    const before = y;
    st.vy -= G * dt;
    y += st.vy * dt;
    const room = headroom(w, x, before, z);
    if (Number.isFinite(room) && y + CROUCH > room) { y = Math.max(before, room - CROUCH); st.vy = Math.min(0, st.vy); }
    // Dropping off an edge with the front still over it: slide clear as it falls rather than land inside it.
    if (inFurniture(w, x, z, y, st.heading)) { const out = unpoke(w, { ...st, p: [x, y, z] }, false, 0.3); if (out) [x, z] = out; }
    const g = groundAt(w, x, z, Math.max(before, y) + 0.02);
    if (g.surface && y <= g.y) {
      ev.push({ type: 'land', drop: Math.max(0, (st.p[1] ?? before) - g.y), surfaceId: g.surface.id });
      y = g.y;
      st.ground = true;
      st.vy = 0;
      st.surfaceId = g.surface.id;
    } else if (!g.surface) {
      // Nothing below (should not happen inside the volumes): stand where we are.
      st.ground = true;
      st.vy = 0;
    }
  }
  st.p = [x, y, z];
  return ev;
}

/** Which volume region the cat is in (the catio wins where volumes overlap at the window or the cat flap, then a tunnel). */
export function regionAt(w: World, p: Vec3): Region | null {
  const inside = w.volumes.filter((v) => inPoly(v.poly, p[0], p[2]) && p[1] >= v.y0 - 0.03);
  if (inside.some((v) => v.region === 'catio')) return 'catio';
  if (inside.some((v) => v.region === 'tunnel')) return 'tunnel';
  return inside.length ? 'home' : null;
}
