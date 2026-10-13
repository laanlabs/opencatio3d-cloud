// Catio Quest: determinism of the simulated afternoon and the scores, sanity of the scoring, a
// reference solution that passes every scenario, the daily challenge, and conversion into a real project.
import { describe, expect, it } from 'vitest';
import { catalog } from '../src/lib/catalog/catalog';
import type { Project } from '../src/lib/model/types';
import { stableId } from '../src/lib/model/types';
import { generate } from '../src/lib/generate/assembly';
import { runChecks } from '../src/lib/analysis/checks';
import { sanitizeProject } from '../src/lib/io/validate';
import { SCENARIOS, scenario } from '../src/lib/quest/scenarios';
import { evaluate } from '../src/lib/quest/evaluate';
import { applyPiece, mainStructure, removeItem, updateOpening, updateFurnishing, autoPlace } from '../src/lib/quest/design';
import { PIECES, piece } from '../src/lib/quest/pieces';
import { dailyScenario } from '../src/lib/quest/daily';
import { toPlannerProject } from '../src/lib/quest/convert';
import { buildNav } from '../src/lib/quest/nav';
import { simulate } from '../src/lib/quest/sim';
import { gameCost } from '../src/lib/quest/score';

/** Deterministic ids for test layouts. */
function idGen(key: string) {
  let n = 0;
  return () => stableId(`test:quest:${key}:${n++}`);
}

/** Applies tray pieces by id, failing loudly if one is refused. */
function build(p: Project, ids: string[], key: string, allowed?: Parameters<typeof applyPiece>[4]): Project {
  const gen = idGen(key);
  for (const id of ids) {
    const pc = piece(id);
    if (!pc) throw new Error(`no piece ${id}`);
    const r = applyPiece(p, pc, catalog, gen, allowed);
    if (r.project === p) throw new Error(`${id} refused: ${r.note}`);
    p = r.project;
  }
  return p;
}

const door = (p: Project) => mainStructure(p)!.openings.find((o) => o.kind === 'human-door')!;

/** A layout that passes each scenario. */
export const SOLUTIONS: Record<string, (p: Project) => Project> = {
  'window-under-500': (p) => build(p, ['f-bed'], 'w500'),
  'three-cats-peace': (p) => build(p, ['f-shelf', 'f-shelf', 'f-hammock', 'f-cubby', 'f-bed', 'f-water', 'f-scratcher', 'f-ramp'], 'peace'),
  'senior-access': (p) => build(p, ['f-ramp', 'roof-partial'], 'senior'),
  'rainy-retreat': (p) => build(p, ['roof-partial', 'base-pavers', 'f-hammock'], 'rainy'),
  'escape-risk-repair': (p) => {
    p = build(p, ['mesh-1x1', 'f-cubby'], 'escape');
    p = updateOpening(p, door(p).id, { latch: 'slide-bolt', selfClosing: true });
    return build(p, ['open-vestibule'], 'escape2');
  },
  'cat-safe-planted': (p) => {
    for (const pl of [...p.plants]) p = removeItem(p, pl.id);
    return build(p, ['p-spider', 'p-fern', 'p-rosemary', 'p-areca'], 'planted');
  },
  'shelter-makeover': (p) => build(p, ['mesh-half', 'f-bed', 'f-hammock', 'f-shelf', 'f-water', 'base-pavers', 'f-ramp'], 'shelter')
};

describe('Catio Quest content', () => {
  it('has at least five scenarios, six personalities and 30–40 tray pieces from the real catalog', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(5);
    expect(PIECES.length).toBeGreaterThanOrEqual(30);
    expect(PIECES.length).toBeLessThanOrEqual(40);
    for (const pc of PIECES) {
      const a = pc.action;
      if (a.kind === 'mesh') expect(catalog.material(a.materialId)?.kind).toBe('mesh');
      if (a.kind === 'furnishing') expect(catalog.component(a.componentId)).toBeTruthy();
      if (a.kind === 'plant') expect(catalog.plant(a.plantId)).toBeTruthy();
      if (a.kind === 'template') expect(catalog.template(a.template)).toBeTruthy();
    }
  });

  it('every starting layout is valid for the planner', () => {
    for (const sc of SCENARIOS) {
      const p = sc.start();
      expect(sanitizeProject(p, catalog).count).toBe(0);
      expect(generate(p, catalog).parts.length).toBeGreaterThan(10);
    }
  });
});

describe('simulation', () => {
  it('same layout + seed → identical afternoon (event log and tracks)', () => {
    for (const sc of SCENARIOS) {
      const a = evaluate(sc, sc.start(), catalog), b = evaluate(sc, sc.start(), catalog);
      expect(JSON.stringify(a.sim.events)).toBe(JSON.stringify(b.sim.events));
      expect(JSON.stringify(a.sim.tracks)).toBe(JSON.stringify(b.sim.tracks));
      expect(a.result).toEqual(b.result);
    }
  });

  it('a different seed plays a different afternoon', () => {
    const sc = scenario('three-cats-peace')!;
    const p = sc.start();
    const f = runChecks(p, catalog, generate(p, catalog));
    const a = simulate(p, catalog, sc.cats, sc.climate, f, 'one'), b = simulate(p, catalog, sc.cats, sc.climate, f, 'two');
    expect(JSON.stringify(a.tracks)).not.toBe(JSON.stringify(b.tracks));
  });

  it('cats only take edges they can (a senior never jumps more than her reach)', () => {
    const sc = scenario('senior-access')!;
    const e = evaluate(sc, sc.start(), catalog);
    const biscuit = e.sim.cats.find((c) => c.name === 'Biscuit')!;
    for (const sg of e.sim.tracks[biscuit.id]) if (sg.pose === 'jump') {
      const dy = sg.to[1] - sg.from[1];
      expect(dy <= biscuit.caps.up + 1e-9 && -dy <= biscuit.caps.down + 1e-9).toBe(true);
    }
  });

  it('builds the navigation graph from the real furnishings', () => {
    const sc = scenario('three-cats-peace')!;
    const p = SOLUTIONS[sc.id](sc.start());
    const g = buildNav(p, catalog)!;
    const s = mainStructure(p)!;
    for (const f of s.furnishings) expect(g.nodes.some((n) => n.furnishingId === f.id)).toBe(true);
    expect(g.entryKind).toBe('window');
  });
});

describe('scoring', () => {
  it('adding shade improves Weather in a hot scenario', () => {
    const sc = scenario('senior-access')!;
    const base = build(sc.start(), ['f-ramp', 'roof-mesh'], 'shade0');
    const shaded = build(base, ['roof-steel'], 'shade1');
    expect(evaluate(sc, shaded, catalog).result.scores.weather.value).toBeGreaterThan(evaluate(sc, base, catalog).result.scores.weather.value);
  });

  it('removing the ramp lowers Happiness for the senior', () => {
    const sc = scenario('senior-access')!;
    const withRamp = SOLUTIONS[sc.id](sc.start());
    const ramp = mainStructure(withRamp)!.furnishings.find((f) => f.componentId === 'ramp')!;
    const without = removeItem(withRamp, ramp.id);
    const a = evaluate(sc, withRamp, catalog), b = evaluate(sc, without, catalog);
    expect(b.result.scores.happiness.value).toBeLessThan(a.result.scores.happiness.value);
    // The mechanism: without the ramp Biscuit can't get down from the window ledge.
    expect(b.sim.stats.cats.find((c) => c.name === 'Biscuit')!.reachable).toBeLessThan(a.sim.stats.cats.find((c) => c.name === 'Biscuit')!.reachable);
    expect(b.result.goals.find((g) => g.id === 'biscuit-in')!.met).toBe(false);
  });

  it('a toxic plant costs Safety and Style', () => {
    const sc = scenario('cat-safe-planted')!;
    const good = SOLUTIONS[sc.id](sc.start());
    const bad = build(good, ['p-lily'], 'lily');
    const a = evaluate(sc, good, catalog).result, b = evaluate(sc, bad, catalog).result;
    expect(b.scores.safety.value).toBeLessThan(a.scores.safety.value);
    expect(b.scores.style.value).toBeLessThan(a.scores.style.value);
  });

  it('budget uses the generator’s best-price estimate', () => {
    const sc = scenario('window-under-500')!;
    const e = evaluate(sc, sc.start(), catalog);
    expect(gameCost(e.assembly)).toBe(e.assembly.cost.low);
  });

  it('the flawed Escape-Risk starting design fails Safety, and Houdini gets out', () => {
    const sc = scenario('escape-risk-repair')!;
    const e = evaluate(sc, sc.start(), catalog);
    expect(e.result.scores.safety.value).toBeLessThan(sc.minSafety);
    expect(e.result.passed).toBe(false);
    expect(e.sim.stats.escapes).toBeGreaterThan(0);
  });

  for (const sc of SCENARIOS) {
    it(`reference solution passes “${sc.title}”`, () => {
      const e = evaluate(sc, SOLUTIONS[sc.id](sc.start()), catalog);
      const r = e.result;
      const why = `overall ${r.overall}/${sc.pass}, ${Object.values(r.scores).map((s) => `${s.key} ${s.value}`).join(', ')}; goals ${r.goals.map((g) => `${g.met ? '✓' : '✗'} ${g.label}`).join('; ')}`;
      expect(r.passed, why).toBe(true);
      expect(r.stars).toBeGreaterThanOrEqual(1);
    });
    it(`the untouched start does not pass “${sc.title}”`, () => {
      expect(evaluate(sc, sc.start(), catalog).result.passed).toBe(false);
    });
  }
});

describe('design edits', () => {
  it('auto-placed furnishings always fit the generator', () => {
    const sc = scenario('rainy-retreat')!;
    let p = sc.start();
    const gen = idGen('fill');
    for (let i = 0; i < 12; i++) {
      const s = mainStructure(p)!;
      const f = autoPlace(s, i % 2 ? 'shelf' : 'hammock', catalog, gen());
      if (!f) break;
      p = { ...p, structures: [{ ...s, furnishings: [...s.furnishings, f] }] };
    }
    const a = generate(p, catalog);
    expect(a.structures[0].skippedFurnishings).toEqual([]);
  });

  it('moving a furnishing clamps it to its wall', () => {
    const sc = scenario('three-cats-peace')!;
    const p = SOLUTIONS[sc.id](sc.start());
    const f = mainStructure(p)!.furnishings.find((x) => x.componentId === 'shelf')!;
    const moved = updateFurnishing(p, f.id, { offset: 99 }, catalog).project;
    const g = mainStructure(moved)!.furnishings.find((x) => x.id === f.id)!;
    expect(g.offset).toBeLessThan(mainStructure(p)!.width + mainStructure(p)!.depth);
  });

  it('switching template keeps what fits and stays valid', () => {
    const sc = scenario('three-cats-peace')!;
    const p = build(SOLUTIONS[sc.id](sc.start()), ['tpl-freestanding'], 'switch', sc.templates);
    expect(mainStructure(p)!.template).toBe('freestanding');
    expect(generate(p, catalog).structures[0].skippedFurnishings).toEqual([]);
  });

  it('refuses a template the scenario doesn’t allow', () => {
    const sc = scenario('window-under-500')!;
    const p = sc.start();
    expect(applyPiece(p, piece('tpl-freestanding')!, catalog, idGen('x'), sc.templates).project).toBe(p);
  });
});

describe('daily challenge', () => {
  it('is the same for a given date and differs between dates', () => {
    const a = dailyScenario('2026-10-12'), b = dailyScenario('2026-10-12'), c = dailyScenario('2026-10-13');
    const shape = (s: ReturnType<typeof dailyScenario>) => JSON.stringify({ cats: s.cats, climate: s.climate, budget: s.budget, start: s.start(), goals: s.goals.map((g) => g.id) });
    expect(shape(a)).toBe(shape(b));
    expect(shape(a)).not.toBe(shape(c));
    expect(JSON.stringify(evaluate(a, a.start(), catalog).sim.events)).toBe(JSON.stringify(evaluate(b, b.start(), catalog).sim.events));
  });

  it('a month of dailies all start valid and can be evaluated', () => {
    for (let d = 1; d <= 30; d++) {
      const sc = dailyScenario(`2026-11-${String(d).padStart(2, '0')}`);
      const e = evaluate(sc, sc.start(), catalog);
      expect(e.result.overall).toBeGreaterThanOrEqual(0);
      expect(sc.cats.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('continue in OpenCatio3D', () => {
  for (const sc of SCENARIOS) {
    it(`converts “${sc.title}” into a valid, concept-only planner project`, () => {
      const layout = SOLUTIONS[sc.id](sc.start());
      const p = toPlannerProject(sc, layout, catalog, { now: '2026-10-12T12:00:00.000Z', id: stableId(`convert:${sc.id}`) });
      expect(p.captureSource).toBe('quest');
      expect(sanitizeProject(p, catalog).count).toBe(0);
      expect(p.cats.map((c) => c.name)).toEqual(sc.cats.map((c) => c.name));
      const a = generate(p, catalog);
      expect(a.parts.length).toBeGreaterThan(10);
      const f = runChecks(p, catalog, a);
      // Unconfirmed dimensions keep it a concept until someone measures.
      expect(f.some((x) => x.ruleId === 'CAT-DIM-001' && x.status === 'open')).toBe(true);
      expect(JSON.parse(JSON.stringify(p))).toEqual(p);
    });
  }
});
