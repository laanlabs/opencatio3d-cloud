// Local progress for Catio Quest: best score and stars per scenario, earned badges, and the layout in
// progress for each scenario. Lives only in this browser (localStorage); every read and write is
// guarded, so a private window or blocked storage just means progress isn't remembered.
import type { Project } from '../model/types';
import type { Scenario, Scores } from './types';

const KEY = 'oc3d-quest-progress-v1';
const DRAFT = (id: string) => `oc3d-quest-draft-v1:${id}`;

export interface Best { overall: number; stars: number; at: string }
export interface Progress { best: Record<string, Best>; badges: string[] }

export function readProgress(): Progress {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw === 'object' && raw.best && typeof raw.best === 'object') return { best: raw.best, badges: Array.isArray(raw.badges) ? raw.badges.filter((b: unknown) => typeof b === 'string') : [] };
  } catch { /* storage blocked or damaged: start fresh */ }
  return { best: {}, badges: [] };
}

function write(p: Progress) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* not remembered this time */ }
}

export const BADGES: Record<string, { name: string; icon: string; how: string }> = {
  first: { name: 'First catio', icon: '🏅', how: 'Pass any scenario.' },
  perfect: { name: 'Three stars', icon: '🌟', how: 'Get three stars on a scenario.' },
  houdini: { name: 'Escape-proof', icon: '🔐', how: 'Pass the Escape-Risk Repair Challenge.' },
  gardener: { name: 'Cat-safe gardener', icon: '🌿', how: 'Pass the Cat-Safe Planted Catio.' },
  daily: { name: 'Daily builder', icon: '📅', how: 'Pass a Daily Challenge.' },
  all: { name: 'Catio master', icon: '🏆', how: 'Pass every scenario.' }
};

/** Records a result; returns badges earned for the first time. */
export function recordResult(sc: Scenario, r: Scores, allIds: string[], now = new Date().toISOString()): string[] {
  const p = readProgress();
  const prev = p.best[sc.id];
  if (!prev || r.overall > prev.overall || r.stars > prev.stars) p.best[sc.id] = { overall: Math.max(r.overall, prev?.overall ?? 0), stars: Math.max(r.stars, prev?.stars ?? 0), at: now };
  const earned: string[] = [];
  const give = (b: string, cond: boolean) => { if (cond && !p.badges.includes(b)) { p.badges.push(b); earned.push(b); } };
  give('first', r.passed);
  give('perfect', r.stars === 3);
  give('houdini', r.passed && sc.id === 'escape-risk-repair');
  give('gardener', r.passed && sc.id === 'cat-safe-planted');
  give('daily', r.passed && !!sc.daily);
  give('all', allIds.every((id) => (p.best[id]?.stars ?? 0) >= 1));
  write(p);
  return earned;
}

/** Scenarios open up as you pass the ones before them; the first three are open from the start. */
export function isUnlocked(ids: string[], id: string, p: Progress): boolean {
  const i = ids.indexOf(id);
  if (i < 3) return true;
  return (p.best[ids[i - 1]]?.stars ?? 0) >= 1 || (p.best[id]?.stars ?? 0) >= 1;
}

export function readDraft(id: string): Project | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT(id)) ?? 'null');
    return raw && typeof raw === 'object' && Array.isArray(raw.structures) ? (raw as Project) : null;
  } catch { return null; }
}
export function writeDraft(id: string, p: Project) {
  try { localStorage.setItem(DRAFT(id), JSON.stringify(p)); } catch { /* not remembered */ }
}
export function clearDraft(id: string) {
  try { localStorage.removeItem(DRAFT(id)); } catch { /* nothing to clear */ }
}
