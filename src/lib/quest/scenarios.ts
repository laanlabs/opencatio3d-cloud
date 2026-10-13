// The launch scenarios (plan 05): a household with needs, a site, a budget and a climate, a starting
// layout built with the planner's own factories (stable ids, so every run is reproducible), and goals that
// teach one idea each. Reference solutions that pass every scenario live in tests/quest.test.ts.
import { catalog } from '../catalog/catalog';
import type { Furnishing, PlantPlacement, Project, Structure, TemplateId } from '../model/types';
import { DEFAULT_ASSUMPTIONS, SCHEMA, stableId } from '../model/types';
import { houseWall, newStructure } from '../site/templates';
import { meshMaterial } from '../generate/structure';
import { activeBlockers } from '../analysis/checks';
import { mainStructure } from './design';
import { COATS, questCat } from './personalities';
import { scoreFor } from './score';
import { canTraverse } from './nav';
import type { Climate, Evaluation, Goal, QuestCat, Scenario } from './types';

export const MILD: Climate = { label: 'Mild', snowLoad: 'none', wind: 'normal', hot: false, rainy: false };
export const HOT: Climate = { label: 'Hot and sunny', snowLoad: 'none', wind: 'normal', hot: true, rainy: false };
export const RAINY: Climate = { label: 'Rainy', snowLoad: 'none', wind: 'normal', hot: false, rainy: true };

const AT = '2026-10-12T12:00:00.000Z';

/** A fresh layout: one house wall with a window (and a back door), ground, no structures yet. */
export function questSite(key: string, opts: { window?: { offset: number; width: number; height: number; sill: number }; ground?: Project['site']['ground'] } = {}): Project {
  const win = opts.window ?? { offset: 3.0, width: 0.9, height: 1.2, sill: 0.9 };
  const wall = houseWall([0, 0], [9, 0], 2.7, [
    { kind: 'window', ...win, name: 'Window' },
    { kind: 'door', offset: 7.2, width: 0.9, height: 2.03, sill: 0, name: 'Back door' }
  ]);
  wall.id = stableId(`quest:${key}:wall`);
  wall.openings = wall.openings.map((o, i) => ({ ...o, id: stableId(`quest:${key}:wall-opening:${i}`) }));
  return {
    schema: SCHEMA, id: stableId(`quest:${key}`), name: 'Catio Quest layout', createdAt: AT, updatedAt: AT, catalogVersion: catalog.version, captureSource: 'quest',
    units: 'imperial', currency: 'USD', region: { country: 'US' },
    site: { northDeg: 0, ground: opts.ground ?? 'grass', walls: [wall], obstacles: [], measurements: [] },
    structures: [], cats: [], plants: [], overrides: [], alternatives: [], observations: [],
    assumptions: { ...DEFAULT_ASSUMPTIONS }, building: null, web: {}, extra: {}
  };
}

/** Adds a structure of `template` (attached over the window when it can be), with stable ids. */
export function questStructure(p: Project, key: string, template: TemplateId, patch: (s: Structure) => void = () => {}): Project {
  const wall = p.site.walls[0];
  const t = catalog.template(template)!;
  const s = newStructure(template, catalog, t.attached ? { wall, opening: wall.openings[0] } : { x: 1.2, y: 2.6 });
  s.id = stableId(`quest:${key}:s`);
  s.name = t.name;
  patch(s);
  s.openings = s.openings.map((o, i) => ({ ...o, id: stableId(`quest:${key}:s:opening:${i}`) }));
  s.furnishings = s.furnishings.map((f, i) => ({ ...f, id: stableId(`quest:${key}:s:furnishing:${i}`) }));
  return { ...p, structures: [s] };
}

const cat = (scenario: string, name: string, personality: QuestCat['personality'], coat: number, bio: string, patch: Partial<QuestCat> = {}) =>
  questCat(stableId(`quest:${scenario}:cat:${name}`), name, personality, COATS[coat % COATS.length], bio, patch);

// ---------- goal helpers ----------

export const cost = (e: Evaluation) => e.assembly.cost.low;
const restSpots = (e: Evaluation) => (e.sim.graph?.nodes ?? []).filter((n) => (n.tags.rest ?? 0) >= 0.6).reduce((x, n) => x + n.capacity, 0);
const safetyBlockers = (e: Evaluation) => activeBlockers(e.findings).filter((f) => scoreFor(f.ruleId) === 'safety');
const catStat = (e: Evaluation, name: string) => e.sim.stats.cats.find((c) => c.name === name);

export const GOALS = {
  budget: (n: number): Goal => ({ id: 'budget', label: `Costs under $${n.toLocaleString('en-US')}`, test: (e) => cost(e) <= n }),
  noEscapes: (): Goal => ({ id: 'no-escapes', label: 'Nobody gets out', test: (e) => e.sim.stats.escapes === 0 }),
  noSafetyBlockers: (): Goal => ({ id: 'no-blockers', label: 'No safety blockers in the inspection', test: (e) => safetyBlockers(e).length === 0 }),
  restForAll: (n: number): Goal => ({ id: 'rest-for-all', label: n === 1 ? 'A cozy place to nap' : `A resting spot for each of the ${n} cats`, test: (e) => restSpots(e) >= n && (e.sim.graph?.nodes ?? []).some((x) => x.kind === 'bed' || x.kind === 'hammock' || x.kind === 'cubby') }),
  windowEntry: (): Goal => ({ id: 'window-entry', label: 'Cats come and go through the window', test: (e) => e.sim.graph?.entryKind === 'window' }),
  lookout: (name: string): Goal => ({ id: 'lookout', label: `${name} gets a lookout`, test: (e) => { const c = catStat(e, name); return !!c && c.needs.lookout >= 0.45 && !c.frustrated.includes('lookout'); } })
};

// ---------- the scenarios ----------

export const SCENARIOS: Scenario[] = [
  {
    id: 'window-under-500',
    title: 'Window Catio Under $500',
    tagline: 'One curious cat, one kitchen window, a tight budget.',
    story: 'Mochi watches the birds from the kitchen sill all day. Her family wants to give her a real window box — fresh air, a perch and a nap spot — without spending more than $500.',
    difficulty: 1,
    cats: [cat('window-under-500', 'Mochi', 'explorer', 0, 'Young, nosy and very interested in birds.', { escapeRisk: 'medium' })],
    climate: MILD,
    budget: 500,
    templates: ['window-box'],
    constraints: ['Apartment-friendly: a window box on the kitchen window', 'Budget: $500'],
    goals: [GOALS.budget(500), GOALS.restForAll(1), GOALS.windowEntry()],
    pass: 60, minSafety: 60, theme: 'cozy',
    seed: 'quest:window-under-500',
    start: () => questStructure(questSite('window-under-500', { window: { offset: 3.0, width: 0.71, height: 1.1, sill: 0.9 } }), 'window-under-500', 'window-box', (s) => { s.furnishings = []; })
  },
  {
    id: 'three-cats-peace',
    title: 'Peaceful Space for Three Cats',
    tagline: 'A bossy cat, a shy cat and a climber — keep the peace.',
    story: 'Tiger rules the house. Pip hides from Tiger. Juniper climbs anything. One shelf won’t do: design a catio with enough perches, resting spots and routes that nobody gets cornered.',
    difficulty: 2,
    cats: [
      cat('three-cats-peace', 'Tiger', 'boss', 6, 'Big orange boss. Wants the best seat.'),
      cat('three-cats-peace', 'Pip', 'shy', 1, 'Small and gentle; avoids Tiger.'),
      cat('three-cats-peace', 'Juniper', 'explorer', 3, 'Up the walls in seconds.', { escapeRisk: 'medium' })
    ],
    climate: MILD,
    budget: 2500,
    templates: ['lean-to', 'freestanding'],
    constraints: ['Back wall of a house with a living-room window', 'Budget: $2,500'],
    goals: [
      { id: 'peace', label: 'Nobody cornered, and at most one squabble', test: (e) => e.sim.stats.conflicts <= 1 && e.sim.stats.cornered === 0 },
      GOALS.restForAll(3),
      { id: 'two-ways-up', label: 'At least two ways up', test: (e) => e.sim.stats.routesUp >= 2 }
    ],
    pass: 62, minSafety: 60, weights: { social: 2.5 },
    seed: 'quest:three-cats-peace',
    start: () => questStructure(questSite('three-cats-peace'), 'three-cats-peace', 'lean-to', (s) => { s.furnishings = s.furnishings.filter((f) => f.componentId === 'water-station' || (f.componentId === 'shelf' && f.side === 'right')); })
  },
  {
    id: 'senior-access',
    title: 'Senior Cat Accessibility',
    tagline: 'Biscuit is 16 and can’t jump like she used to.',
    story: 'Biscuit loves the sun but her hips are stiff: a step up of more than about a foot is too much. The catio already has high shelves for young Olive. Make every part of it reachable for Biscuit too.',
    difficulty: 2,
    cats: [
      cat('senior-access', 'Biscuit', 'lounger', 3, 'Sixteen, stiff, sweet. Loves a sunny bed.'),
      cat('senior-access', 'Olive', 'explorer', 2, 'Young and springy.', { escapeRisk: 'low' })
    ],
    climate: HOT,
    budget: 3000,
    templates: ['lean-to', 'freestanding'],
    constraints: ['Biscuit can step up about 35 cm (14″) at most', 'Hot afternoons'],
    goals: [
      { id: 'biscuit-in', label: 'Biscuit can get down from the window and back', test: (e) => { const c = catStat(e, 'Biscuit'); return !!c && c.reachable >= 3; } },
      { id: 'biscuit-perch', label: 'Biscuit reaches a raised perch', test: (e) => { const g = e.sim.graph; const c = e.sim.cats.find((x) => x.name === 'Biscuit'); if (!g || !c) return false; return g.nodes.some((n) => n.pos[1] >= 0.3 && n.kind !== 'entry' && reachable(e, c.id, n.i)); } },
      { id: 'no-big-steps', label: 'No big step-ups (or a ramp)', test: (e) => !e.findings.some((f) => f.ruleId === 'CAT-MOB-001' && f.status === 'open') }
    ],
    pass: 62, minSafety: 60, theme: 'cozy',
    seed: 'quest:senior-access',
    start: () => questStructure(questSite('senior-access'), 'senior-access', 'lean-to')
  },
  {
    id: 'rainy-retreat',
    title: 'Rainy-Climate Retreat',
    tagline: 'It rains most afternoons. Keep everyone dry.',
    story: 'Pepper and Smokey live where it drizzles half the year. Their open-topped yard catio turns into a puddle. Give them a retreat that stays dry, drains well and still feels outdoors.',
    difficulty: 2,
    cats: [
      cat('rainy-retreat', 'Pepper', 'explorer', 2, 'Black, fast, hates wet paws.', { escapeRisk: 'low' }),
      cat('rainy-retreat', 'Smokey', 'lounger', 1, 'Grey and comfortable. Naps all day.', { ageClass: 'adult', mobility: 'full', climber: true })
    ],
    climate: RAINY,
    budget: 3500,
    templates: ['freestanding', 'lean-to'],
    constraints: ['A rain shower every afternoon', 'Lawn underfoot'],
    goals: [
      { id: 'dry-rest', label: 'A dry place to rest when it rains', test: (e) => (e.sim.graph?.nodes ?? []).some((n) => n.dry && (n.tags.rest ?? 0) >= 0.6) },
      { id: 'stay-out', label: 'Nobody has to go back inside', test: (e) => e.sim.stats.wentInside === 0 },
      { id: 'not-soaked', label: 'Nobody gets soaked', test: (e) => e.sim.stats.cats.every((c) => c.wetTicks <= 8) }
    ],
    pass: 62, minSafety: 60, weights: { weather: 3 },
    seed: 'quest:rainy-retreat',
    start: () => questStructure(questSite('rainy-retreat'), 'rainy-retreat', 'freestanding', (s) => { s.roof = { kind: 'mesh' }; s.base = { kind: 'ground-skirt', skirtDepth: 0.3 }; s.openings.push({ id: '', kind: 'cat-door', side: 'back', offset: 0.6, width: 0.25, height: 0.3, sill: 0.1 } as Structure['openings'][number]); })
  },
  {
    id: 'escape-risk-repair',
    title: 'Escape-Risk Repair Challenge',
    tagline: 'Houdini got out twice last week. Find the flaws and fix them.',
    story: 'A handy neighbour built this catio in a weekend with leftover garden fencing and a door with no latch. Houdini has already escaped twice. Inspect it, find every way out, and fix them.',
    difficulty: 3,
    cats: [
      cat('escape-risk-repair', 'Houdini', 'explorer', 7, 'Tests every gap. Has escaped twice.', { escapeRisk: 'high' }),
      cat('escape-risk-repair', 'Luna', 'shy', 5, 'Would rather stay home, thanks.')
    ],
    climate: MILD,
    budget: 3500,
    templates: ['lean-to'],
    constraints: ['Fix the existing lean-to (keep the shape)', 'Houdini is a high escape risk'],
    goals: [GOALS.noEscapes(), GOALS.noSafetyBlockers(), { id: 'door', label: 'The people door latches and closes itself', test: (e) => { const s = mainStructure(e.project); const d = s?.openings.find((o) => o.kind === 'human-door'); return !!d && !!d.latch && !!d.selfClosing; } }],
    pass: 62, minSafety: 75,
    seed: 'quest:escape-risk-repair',
    start: () => questStructure(questSite('escape-risk-repair'), 'escape-risk-repair', 'lean-to', (s) => {
      s.mesh = { materialId: 'mesh-2x4-14ga-fence-48' };
      s.openings = s.openings.map((o) => (o.kind === 'human-door' ? { ...o, latch: null, selfClosing: false } : o));
    })
  },
  {
    id: 'cat-safe-planted',
    title: 'Cat-Safe Planted Catio',
    tagline: 'A garden catio for a cat who eats plants.',
    story: 'Sage chews every leaf she finds. A neighbour gave the family an Easter lily and some catnip for the new catio. Make it green and lovely — with plants that aren’t listed as toxic to cats.',
    difficulty: 2,
    cats: [
      cat('cat-safe-planted', 'Sage', 'nibbler', 4, 'Tastes every plant. Every one.'),
      cat('cat-safe-planted', 'Clover', 'explorer', 0, 'Likes the high shelf.', { escapeRisk: 'low' })
    ],
    climate: MILD,
    budget: 3000,
    templates: ['lean-to', 'freestanding'],
    constraints: ['Plants must be checked against the ASPCA list', 'Sage chews plants'],
    goals: [
      { id: 'three-plants', label: 'Three plants not listed as toxic', test: (e) => e.project.plants.filter((pl) => catalog.plant(pl.plantId)?.catSafety === 'no-known-issue').length >= 3 },
      { id: 'no-toxic', label: 'No toxic plants', test: (e) => !e.project.plants.some((pl) => catalog.plant(pl.plantId)?.catSafety === 'known-hazard') },
      { id: 'no-vet', label: 'Nobody needs the vet', test: (e) => e.sim.stats.hazardNibbles === 0 }
    ],
    pass: 62, minSafety: 60, theme: 'garden', weights: { style: 1.5 },
    seed: 'quest:cat-safe-planted',
    start: () => {
      const p = questStructure(questSite('cat-safe-planted'), 'cat-safe-planted', 'lean-to', (s) => {
        s.furnishings.push({ id: '', componentId: 'planter-large', side: 'front', offset: 0.1, mountHeight: 0 } as Furnishing);
      });
      const s = p.structures[0];
      const planter = s.furnishings.find((f) => f.componentId === 'planter-large')!;
      const plants: PlantPlacement[] = [
        { id: stableId('quest:cat-safe-planted:plant:0'), plantId: 'easter-lily', structureId: s.id, furnishingId: planter.id },
        { id: stableId('quest:cat-safe-planted:plant:1'), plantId: 'catnip', structureId: s.id, furnishingId: planter.id }
      ];
      return { ...p, plants };
    }
  },
  {
    id: 'shelter-makeover',
    title: 'Shelter Makeover',
    tagline: 'Four shelter cats, donated wire, a small grant.',
    story: 'The rescue got a $2,000 grant and a donated roll of 1″×2″ wire. Two kittens, a regal senior and a climber share the yard catio. Make it kitten-proof, restful for everyone, and easy for volunteers to clean.',
    difficulty: 3,
    cats: [
      cat('shelter-makeover', 'Bean', 'kitten', 0, 'Eight weeks old. Into everything.'),
      cat('shelter-makeover', 'Nori', 'kitten', 2, 'Bean’s sister. Fits through anything.'),
      cat('shelter-makeover', 'Duchess', 'boss', 5, 'Senior queen of the shelter.', { ageClass: 'senior', mobility: 'full', escapeRisk: 'low' }),
      cat('shelter-makeover', 'Rocket', 'explorer', 6, 'Climbs the walls — literally.', { escapeRisk: 'medium' })
    ],
    climate: MILD,
    budget: 2000,
    templates: ['freestanding', 'lean-to'],
    constraints: ['Grant: $2,000', 'Donated wire: 1″ × 2″ (you may swap it)', 'Volunteers clean daily'],
    goals: [
      { id: 'kitten-proof', label: 'Kitten-proof mesh', test: (e) => { const s = mainStructure(e.project); return !!s && Math.min(...(meshMaterial(s, catalog).opening ?? [1, 1])) <= 0.02 + 1e-9; } },
      GOALS.restForAll(4),
      { id: 'clean', label: 'Volunteers can walk in to clean', test: (e) => !!mainStructure(e.project)?.openings.some((o) => o.kind === 'human-door') && !e.findings.some((f) => f.ruleId === 'CAT-ACC-005' && f.status === 'open') },
      GOALS.budget(2000)
    ],
    pass: 60, minSafety: 60, theme: 'shelter',
    seed: 'quest:shelter-makeover',
    start: () => questStructure(questSite('shelter-makeover'), 'shelter-makeover', 'freestanding', (s) => { s.mesh = { materialId: 'mesh-1x2-16ga-gbw-48' }; s.furnishings = s.furnishings.filter((f) => f.componentId !== 'bridge'); })
  }
];

/** Whether the cat with this id can reach node `i` from the way in. */
export function reachable(e: Evaluation, catId: string, i: number): boolean {
  const tr = e.sim.tracks[catId];
  if (tr?.some((s) => s.node === i)) return true;
  const g = e.sim.graph;
  const c = e.sim.cats.find((x) => x.id === catId);
  if (!g || !c || g.entry == null) return false;
  // Breadth-first over edges this cat can take.
  const seen = new Set([g.entry]);
  const q = [g.entry];
  while (q.length) {
    const u = q.shift()!;
    for (const k of g.adj[u]) {
      const ed = g.edges[k];
      const v = ed.a === u ? ed.b : ed.a;
      if (seen.has(v)) continue;
      if (canTraverse(g, ed, u, c.caps)) { seen.add(v); q.push(v); }
    }
  }
  return seen.has(i);
}

export const scenario = (id: string) => SCENARIOS.find((s) => s.id === id);
export const startLayout = (sc: Scenario): Project => sc.start();
export type { Structure };
