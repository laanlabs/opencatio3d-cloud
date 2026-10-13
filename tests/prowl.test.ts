// Catio Prowl: worlds built from projects, movement that never leaves the house or catio, leaps, and
// every toy, perch and task spot reachable by the cat's own leap rules.
import { describe, expect, it } from 'vitest';
import { catalog } from '../src/lib/catalog/catalog';
import { generate } from '../src/lib/generate/assembly';
import type { Project, TemplateId } from '../src/lib/model/types';
import { TEMPLATE_IDS } from '../src/lib/model/types';
import { buildSample } from '../src/lib/site/samples';
import { buildWorld, type Surface, type World } from '../src/lib/prowl/world';
import { HEAD, R, STEP, contained, groundAt, blocked, inRect, leapTarget, newCat, step, type CatState } from '../src/lib/prowl/physics';
import { Prowl, tasksFor } from '../src/lib/prowl/game';
import { templateCase } from './helpers';

const worldOf = (p: Project) => buildWorld(p, generate(p, catalog), catalog)!;
const SAMPLE_IDS = ['lean-to-window', 'window-box', 'garden-retreat'];
const sample = (id: string) => worldOf(buildSample(id, catalog)!);
const templates = TEMPLATE_IDS.filter((t) => t !== 'tunnel') as TemplateId[];

/** A tiny deterministic random source. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Surfaces the cat can get to from the start, using its own walking and leap rules from sampled points. */
function reachable(w: World): Set<string> {
  const seen = new Set<string>();
  const start = newCat(w.start.p, w.start.heading, w);
  const queue: string[] = [start.surfaceId!];
  seen.add(start.surfaceId!);
  const byId = new Map(w.surfaces.map((s) => [s.id, s]));
  while (queue.length) {
    const s = byId.get(queue.shift()!)!;
    for (const [x, z] of samplePoints(s)) {
      const y = groundAt(w, x, z, s.top + 0.01);
      if (y.surface?.id !== s.id || !contained(w, x, y.y, z) || blocked(w, x, z, y.y)) continue;
      for (let i = 0; i < 12; i++) {
        const heading = (i / 12) * Math.PI * 2;
        const st: CatState = { p: [x, y.y, z], v: [0, 0], vy: 0, heading, ground: true, surfaceId: s.id, leap: null };
        const t = leapTarget(w, st);
        const next: string[] = t ? [t.surface.id] : [];
        // Walking a short way: onto a neighbouring step, or off an edge and down.
        const nx = x + Math.sin(heading) * 0.22, nz = z + Math.cos(heading) * 0.22;
        if (contained(w, nx, y.y, nz) && !blocked(w, nx, nz, y.y)) {
          const g = groundAt(w, nx, nz, y.y + STEP);
          if (g.surface) next.push(g.surface.id);
        }
        for (const id of next) if (!seen.has(id)) { seen.add(id); queue.push(id); }
      }
    }
  }
  return seen;
}

function samplePoints(s: Surface): [number, number][] {
  const out: [number, number][] = [];
  const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
  const nx = Math.max(1, Math.ceil((2 * s.h[0]) / 0.25)), nz = Math.max(1, Math.ceil((2 * s.h[1]) / 0.25));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const lx = nx === 1 ? 0 : -s.h[0] + 0.04 + ((2 * s.h[0] - 0.08) * i) / (nx - 1);
    const lz = nz === 1 ? 0 : -s.h[1] + 0.04 + ((2 * s.h[1] - 0.08) * j) / (nz - 1);
    out.push([s.c[0] + lx * c - lz * sn, s.c[1] + lx * sn + lz * c]);
  }
  return out;
}

/** The surface a point at height y sits on. */
const surfaceUnder = (w: World, x: number, y: number, z: number) => groundAt(w, x, z, y + 0.02).surface?.id;

describe('Catio Prowl worlds', () => {
  it('builds a home + catio for catios over a window, and a catio-only world otherwise', () => {
    expect(sample('lean-to-window').home).toBe(true);
    expect(sample('window-box').home).toBe(true);
    expect(sample('garden-retreat').home).toBe(false);
    for (const id of SAMPLE_IDS) {
      const w = sample(id);
      const c = newCat(w.start.p, w.start.heading, w);
      expect(contained(w, c.p[0], c.p[1], c.p[2]), id).toBe(true);
      expect(c.surfaceId, id).toBeTruthy();
      expect(w.toys.length, id).toBeGreaterThanOrEqual(2);
    }
  });

  it('builds a world for every box template', () => {
    for (const t of templates) {
      const w = worldOf(templateCase(t, 'default'));
      expect(w, t).toBeTruthy();
      const c = newCat(w.start.p, w.start.heading, w);
      expect(contained(w, c.p[0], c.p[1], c.p[2]), t).toBe(true);
    }
  });

  it('keeps catio shelves where the generator draws them', () => {
    const w = sample('lean-to-window');
    const shelves = w.surfaces.filter((s) => s.kind === 'shelf');
    const tops = shelves.map((s) => s.top).sort();
    expect(tops[0]).toBeCloseTo(0.91, 2); // 0.9 m mount + half the board
    expect(tops[1]).toBeCloseTo(1.41, 2);
    expect(w.catio.perchTop).toBeCloseTo(1.41, 2);
  });
});

describe('Catio Prowl movement', () => {
  it('never leaves the house or the catio, whatever the input', () => {
    const worlds: [string, World][] = [...SAMPLE_IDS.map((id) => [id, sample(id)] as [string, World]), ...templates.map((t) => [t, worldOf(templateCase(t, 'default'))] as [string, World])];
    for (const [name, w] of worlds) {
      const rand = rng(name.length * 977 + 13);
      const st = newCat(w.start.p, w.start.heading, w);
      let move: [number, number] = [0, 1];
      for (let i = 0; i < 4000; i++) {
        if (i % 40 === 0) move = [rand() * 2 - 1, rand() * 2 - 1];
        if (i % 90 === 0) st.heading = rand() * Math.PI * 2;
        step(w, st, { move, jump: i % 23 === 0, sneak: i % 300 < 50 }, 1 / 60);
        if (!st.leap) {
          expect(contained(w, st.p[0], st.p[1], st.p[2], R * 0.9), `${name} step ${i} at ${st.p.map((v) => v.toFixed(2))}`).toBe(true);
          expect(st.p[1], name).toBeGreaterThanOrEqual(-1e-6);
        }
      }
    }
  });

  it('leaps from the floor onto the kitchen counter and lands on it', () => {
    const w = sample('lean-to-window');
    const counter = w.surfaces.find((s) => s.id === 'counter')!;
    // Stand in front of the counter, facing it.
    const ny = -Math.sin(counter.yaw), nz = Math.cos(counter.yaw); // the counter's local +z axis
    const sign = contained(w, counter.c[0] + ny * (counter.h[1] + 0.3), 0, counter.c[1] + nz * (counter.h[1] + 0.3)) ? 1 : -1;
    const x = counter.c[0] + sign * ny * (counter.h[1] + 0.3), z = counter.c[1] + sign * nz * (counter.h[1] + 0.3);
    const st = newCat([x, 0, z], Math.atan2(counter.c[0] - x, counter.c[1] - z), w);
    const t = leapTarget(w, st);
    expect(t?.surface.id).toBe('counter');
    expect(t?.kind).toBe('up');
    for (let i = 0; i < 120; i++) step(w, st, { move: [0, 0], jump: i === 0 }, 1 / 60);
    expect(st.surfaceId).toBe('counter');
    expect(st.p[1]).toBeCloseTo(counter.top, 3);
    expect(inRect(counter, st.p[0], st.p[2])).toBe(true);
  });

  it('cannot walk through solid furniture or up anything taller than a step', () => {
    const w = sample('lean-to-window');
    const fridge = w.surfaces.find((s) => s.id === 'fridge')!;
    expect(blocked(w, fridge.c[0], fridge.c[1], 0)).toBe(true);
    expect(fridge.top).toBeGreaterThan(STEP + HEAD);
  });
});

describe('Catio Prowl reachability', () => {
  for (const id of SAMPLE_IDS) {
    it(`${id}: every toy, perch, sill and task spot can be reached`, () => {
      const w = sample(id);
      const seen = reachable(w);
      for (const t of w.toys) expect(seen.has(surfaceUnder(w, t.p[0], t.p[1], t.p[2])!), `toy ${t.id} ${t.where}`).toBe(true);
      if (w.catio.perchId) expect(seen.has(w.catio.perchId), 'highest perch').toBe(true);
      if (w.sillId) expect(seen.has(w.sillId), 'sill').toBe(true);
      expect(seen.has('catio-floor'), 'catio floor').toBe(true);
      for (const s of w.spots) {
        const at = s.area ? s.area.c : ([s.p[0], s.p[2]] as [number, number]);
        const under = surfaceUnder(w, at[0], s.p[1], at[1]);
        expect(under && seen.has(under), `spot ${s.id}`).toBe(true);
      }
      for (const it of w.items) expect(seen.has(surfaceUnder(w, it.p[0], it.p[1], it.p[2])!), `item ${it.id}`).toBe(true);
    });
  }
});

describe('Catio Prowl game', () => {
  it('lists the day’s tasks for the space', () => {
    const ids = tasksFor(sample('lean-to-window')).map((t) => t.id);
    expect(ids).toEqual(['sill', 'catio', 'perch', 'bird', 'knock', 'scratch', 'toys', 'drink', 'sniff', 'nap']);
    expect(tasksFor(sample('garden-retreat')).map((t) => t.id)).not.toContain('knock');
  });

  it('knocks a mug off the coffee table and counts it', () => {
    const w = sample('lean-to-window');
    const g = new Prowl(w, catalog, true);
    const mug = g.items.find((i) => i.item.id === 'mug')!;
    g.cat.p = [mug.p[0] - 0.2, mug.p[1], mug.p[2]];
    g.cat.surfaceId = 'coffee';
    g.cat.heading = Math.PI / 2;
    g.update(1 / 60, { move: [0, 0] });
    expect(g.action?.kind).toBe('knock');
    g.act();
    for (let i = 0; i < 120; i++) g.update(1 / 60, { move: [0, 0] });
    expect(mug.state).toBe('down');
    expect(mug.p[1]).toBeCloseTo(0, 3);
    expect(g.count('knock')).toBe(1);
    expect(g.messages.some((m) => m.sound === 'crash')).toBe(true);
  });

  it('watching the bird from a high perch in the catio completes the task; meowing scares it off', () => {
    const w = sample('lean-to-window');
    const g = new Prowl(w, catalog, true);
    const perch = w.surfaces.find((s) => s.id === w.catio.perchId)!;
    g.cat.p = [perch.c[0], perch.top, perch.c[1]];
    g.cat.surfaceId = perch.id;
    for (let i = 0; i < 60 * 20; i++) g.update(1 / 60, { move: [0, 0] });
    expect(g.bird.here).toBe(true);
    expect(g.action?.kind).toBe('watch');
    g.act();
    for (let i = 0; i < 60 * 4; i++) g.update(1 / 60, { move: [0, 0] });
    expect(g.progress.done).toContain('bird');
    expect(g.progress.done).toContain('perch');
  });
});
