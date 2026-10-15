// Build mode progress: which checks are ticked and which steps are done. It lives in the project's
// web block (`web.build`), so it is saved with the catio and travels in its file (iOS keeps `web`
// verbatim); share links drop it with the rest of `web`. Step ids are stable (structure id + step
// key), so progress survives edits to the design; a later edit is flagged so the builder re-checks.
// Saving progress never changes `updatedAt`, which stays the design's version.
import type { Project } from '../model/types';
import type { Assembly, Step } from '../generate/assembly';
import type { Part } from '../generate/parts';
import { byLabel } from '../generate/roles';

export interface BuildProgress {
  /** Ticked checklist items by step id (indexes into the step's checklist). */
  checked: Record<string, number[]>;
  /** Steps marked done, in the order they were finished. */
  done: string[];
  /** The step on screen. */
  current?: string;
  /** The design version (`updatedAt`) when building started. */
  designAt?: string;
  startedAt?: string;
  finishedAt?: string;
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** Reads `web.build` leniently: anything malformed counts as not started. */
export function readProgress(p: Project): BuildProgress {
  const raw = (p.web?.build ?? {}) as Record<string, unknown>;
  const checked: Record<string, number[]> = {};
  if (raw.checked && typeof raw.checked === 'object') {
    for (const [k, v] of Object.entries(raw.checked as Record<string, unknown>)) {
      if (Array.isArray(v)) checked[k] = [...new Set(v.filter((i): i is number => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b);
    }
  }
  return { checked, done: [...new Set(strings(raw.done))], current: str(raw.current), designAt: str(raw.designAt), startedAt: str(raw.startedAt), finishedAt: str(raw.finishedAt) };
}

export const withProgress = (p: Project, b: BuildProgress): Project => ({ ...p, web: { ...p.web, build: JSON.parse(JSON.stringify(b)) } });

/** Stamps the start the first time anything is ticked. */
function started(p: Project, b: BuildProgress): BuildProgress {
  return b.startedAt ? b : { ...b, startedAt: new Date().toISOString(), designAt: p.updatedAt };
}

export function toggleCheck(p: Project, b: BuildProgress, stepId: string, i: number): BuildProgress {
  const have = b.checked[stepId] ?? [];
  const next = have.includes(i) ? have.filter((x) => x !== i) : [...have, i].sort((x, y) => x - y);
  // Unticking a check reopens its step.
  const done = have.includes(i) ? b.done.filter((d) => d !== stepId) : b.done;
  return { ...started(p, b), checked: { ...b.checked, [stepId]: next }, done, finishedAt: done.length === b.done.length ? b.finishedAt : undefined };
}

export const allChecked = (b: BuildProgress, st: Step) => st.checklist.every((_, i) => b.checked[st.id]?.includes(i));

/** Marks a step done (only once every check is ticked) or reopens it; stamps the finish when all are done. */
export function setDone(p: Project, b: BuildProgress, steps: Step[], st: Step, done: boolean): BuildProgress {
  if (done && !allChecked(b, st)) return b;
  const list = done ? (b.done.includes(st.id) ? b.done : [...b.done, st.id]) : b.done.filter((d) => d !== st.id);
  const finished = steps.length > 0 && steps.every((s) => list.includes(s.id));
  return { ...started(p, b), done: list, finishedAt: finished ? b.finishedAt ?? new Date().toISOString() : undefined };
}

/** Forgets steps the design no longer has (a removed structure, a step that no longer applies). */
export function prune(b: BuildProgress, steps: Step[]): BuildProgress {
  const ids = new Set(steps.map((s) => s.id));
  const checked = Object.fromEntries(Object.entries(b.checked).filter(([k]) => ids.has(k)));
  return { ...b, checked, done: b.done.filter((d) => ids.has(d)), current: b.current && ids.has(b.current) ? b.current : undefined };
}

export const isDone = (b: BuildProgress, st: Step) => b.done.includes(st.id);
export const firstOpen = (steps: Step[], b: BuildProgress) => steps.find((s) => !isDone(b, s));

/** The design was edited after building started. */
export const designChanged = (p: Project, b: BuildProgress) => !!b.designAt && !!p.updatedAt && p.updatedAt > b.designAt;

/** Parts already in place when `step` starts: every earlier step's parts (steps run structure by structure). */
export function builtBefore(steps: Step[], step: Step): Set<string> {
  const out = new Set<string>();
  for (const s of steps) {
    if (s.id === step.id) break;
    for (const id of s.partIds) out.add(id);
  }
  return out;
}

export interface StepParts {
  /** Labelled parts in label order. */
  labelled: Part[];
  /** Screws, washers and staples, added up per material. */
  fasteners: { materialId: string; qty: number }[];
}

export function stepParts(a: Assembly, st: Step): StepParts {
  const ids = new Set(st.partIds);
  const mine = a.parts.filter((p) => ids.has(p.id));
  const labelled = mine.filter((p) => p.label).sort(byLabel);
  const qty = new Map<string, number>();
  for (const p of mine) if (!p.label) qty.set(p.materialId, (qty.get(p.materialId) ?? 0) + p.qty);
  return { labelled, fasteners: [...qty].map(([materialId, q]) => ({ materialId, qty: q })).sort((x, y) => (x.materialId < y.materialId ? -1 : 1)) };
}
