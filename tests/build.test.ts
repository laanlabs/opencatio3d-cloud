// Build mode progress (src/lib/build/progress.ts): ticks, done steps, pruning, the design-changed flag,
// what is already built when a step starts, and the round trip through the project file.
import { describe, expect, it } from 'vitest';
import { cat } from './helpers';
import { buildSample } from '../src/lib/site/samples';
import { generate } from '../src/lib/generate/assembly';
import { allChecked, builtBefore, designChanged, firstOpen, prune, readProgress, setDone, stepParts, toggleCheck, withProgress } from '../src/lib/build/progress';
import { fromOpenPlan, toOpenPlan } from '../src/lib/io/openplan';

const setup = () => {
  const p = buildSample('garden-retreat', cat)!;
  const a = generate(p, cat);
  return { p, a, steps: a.steps };
};

describe('build progress', () => {
  it('starts empty and reads malformed data as not started', () => {
    const { p } = setup();
    expect(readProgress(p)).toMatchObject({ checked: {}, done: [] });
    const bad = { ...p, web: { ...p.web, build: { checked: { x: [1, 'a', -2, 1.5, 0] }, done: 'nope', current: 7 } } };
    expect(readProgress(bad)).toMatchObject({ checked: { x: [0, 1] }, done: [], current: undefined });
  });

  it('needs every check ticked before a step is done, and unticking reopens it', () => {
    const { p, steps } = setup();
    const st = steps[0];
    let b = readProgress(p);
    expect(setDone(p, b, steps, st, true)).toBe(b);
    b = toggleCheck(p, b, st.id, 0);
    expect(b.startedAt).toBeTruthy();
    expect(b.designAt).toBe(p.updatedAt);
    for (let i = 1; i < st.checklist.length; i++) b = toggleCheck(p, b, st.id, i);
    expect(allChecked(b, st)).toBe(true);
    b = setDone(p, b, steps, st, true);
    expect(b.done).toEqual([st.id]);
    expect(firstOpen(steps, b)).toBe(steps[1]);
    b = toggleCheck(p, b, st.id, 0);
    expect(b.done).toEqual([]);
  });

  it('stamps the finish when every step is done', () => {
    const { p, steps } = setup();
    let b = readProgress(p);
    for (const st of steps) {
      st.checklist.forEach((_, i) => (b = toggleCheck(p, b, st.id, i)));
      b = setDone(p, b, steps, st, true);
      expect(!!b.finishedAt).toBe(st === steps[steps.length - 1]);
    }
    expect(firstOpen(steps, b)).toBeUndefined();
    b = setDone(p, b, steps, steps[2], false);
    expect(b.finishedAt).toBeUndefined();
  });

  it('forgets steps the design no longer has and flags later edits', () => {
    const { p, steps } = setup();
    let b = toggleCheck(p, readProgress(p), steps[0].id, 0);
    b = { ...b, done: ['gone', steps[0].id], checked: { ...b.checked, gone: [0] }, current: 'gone' };
    const pr = prune(b, steps);
    expect(pr.done).toEqual([steps[0].id]);
    expect(pr.checked.gone).toBeUndefined();
    expect(pr.current).toBeUndefined();
    expect(designChanged(p, b)).toBe(false);
    expect(designChanged({ ...p, updatedAt: '2999-01-01T00:00:00.000Z' }, b)).toBe(true);
  });

  it('builds up step by step across structures', () => {
    const { a, steps } = setup();
    expect(builtBefore(steps, steps[0]).size).toBe(0);
    const last = steps[steps.length - 1];
    const before = builtBefore(steps, last);
    // Everything except the last step's own parts (an inspection has none).
    expect(before.size).toBe(new Set(steps.slice(0, -1).flatMap((s) => s.partIds)).size);
    expect(new Set(steps.map((s) => s.structureId)).size).toBeGreaterThan(1);
    for (const st of steps) {
      const sp = stepParts(a, st);
      const fastenerQty = sp.fasteners.reduce((n, f) => n + f.qty, 0);
      const ids = new Set(st.partIds);
      expect(sp.labelled.length + a.parts.filter((x) => ids.has(x.id) && !x.label).length).toBe(st.partIds.length);
      expect(fastenerQty).toBe(a.parts.filter((x) => ids.has(x.id) && !x.label).reduce((n, x) => n + x.qty, 0));
      const nums = sp.labelled.map((x) => Number(x.label!.slice(1)));
      expect(nums).toEqual([...nums].sort((x, y) => x - y));
    }
  });

  it('travels in the project file and keeps the design version', () => {
    const { p, steps } = setup();
    const b = toggleCheck(p, readProgress(p), steps[1].id, 1);
    const q = withProgress(p, b);
    expect(q.updatedAt).toBe(p.updatedAt);
    const back = fromOpenPlan(JSON.parse(JSON.stringify(toOpenPlan(q, cat))), cat);
    expect(readProgress(back).checked[steps[1].id]).toEqual([1]);
  });
});
