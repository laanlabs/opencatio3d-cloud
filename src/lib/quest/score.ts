// Catio Quest scoring: seven deterministic 0–100 scores from the real checks, the generator's assembly
// and the simulated afternoon. Every point lost comes with a plain-words note, and every score has tips
// that teach the real design move (the checks' own remediation text where one applies).
import type { Catalog } from '../catalog/catalog';
import type { Finding } from '../analysis/checks';
import type { Assembly } from '../generate/assembly';
import type { Project } from '../model/types';
import { money } from '../model/units';
import { mainStructure } from './design';
import { PERSONALITIES } from './personalities';
import type { SimResult } from './sim';
import { SCORE_KEYS, type Evaluation, type Need, type Scenario, type Score, type ScoreKey, type Scores } from './types';

export const SCORE_LABEL: Record<ScoreKey, string> = { safety: 'Safety', happiness: 'Happiness', social: 'Social flow', weather: 'Weather', buildability: 'Buildability', budget: 'Budget', style: 'Style' };
export const SCORE_ICON: Record<ScoreKey, string> = { safety: '🛡️', happiness: '😻', social: '🤝', weather: '⛅', buildability: '🔨', budget: '💰', style: '🌿' };

/** Kid-friendly wording for the checks the game shows; anything else uses the rule's own title. */
export const GAME_WORDS: Record<string, string> = {
  'CAT-ENC-001': 'The mesh holes are big enough for a cat to squeeze through.',
  'CAT-ENC-002': 'Kittens can fit through this mesh.',
  'CAT-ENC-003': 'This mesh is thin wire — a determined cat could bend it.',
  'CAT-ENC-004': 'A house window sticks out past the catio edge, leaving a gap.',
  'CAT-ENC-006': 'An escape artist lives here and there’s no vestibule (double door).',
  'CAT-ACC-001': 'A door or hatch has no latch.',
  'CAT-ACC-002': 'The people door doesn’t close by itself.',
  'CAT-ACC-003': 'A gravity latch on an outward door can pop open.',
  'CAT-ACC-004': 'The people door is small for cleaning.',
  'CAT-ACC-005': 'There’s no way in to clean.',
  'CAT-ACC-006': 'No cat entrance from the house.',
  'CAT-MAT-001': 'Wire galvanized before welding rusts at the welds sooner.',
  'CAT-MAT-002': 'Untreated wood is touching the ground and will rot.',
  'CAT-MAT-003': 'Treated wood is within chewing reach.',
  'CAT-GND-001': 'Soft ground with no dig barrier — something could tunnel in or out.',
  'CAT-GND-002': 'The freestanding frame isn’t anchored.',
  'CAT-WX-001': 'No shade in a hot climate.',
  'CAT-WX-002': 'No cover from sun or rain.',
  'CAT-WX-003': 'Heavy snow could load the roof.',
  'CAT-WX-004': 'High winds here.',
  'CAT-WEL-001': 'Nowhere to rest or hide.',
  'CAT-WEL-002': 'Only one perch height.',
  'CAT-WEL-003': 'One perch for several cats.',
  'CAT-WEL-004': 'Nothing to scratch.',
  'CAT-WEL-005': 'No water.',
  'CAT-WEL-006': 'The litter box is next to the water.',
  'CAT-MOB-001': 'Big step-ups for a senior cat — add a ramp or in-between shelves.',
  'CAT-PLT-001': 'A plant here can seriously harm cats.',
  'CAT-PLT-002': 'A plant here is listed as toxic to cats.',
  'CAT-PLT-003': 'A plant here has unknown safety for cats.',
  'CAT-BLD-001': 'The frame spans are long for this lumber.',
  'CAT-BLD-002': 'The solid roof is nearly flat — rain will pool.',
  'CAT-BLD-006': 'An opening doesn’t fit its wall.',
  'CAT-BLD-007': 'Something doesn’t fit where it’s placed.',
  'CAT-HOME-001': 'A dryer vent blows into the catio.',
  'CAT-ELEV-001': 'This catio is raised off the ground.',
  'CAT-DIM-002': 'The catio overlaps something in the yard.'
};

/** Which score a rule counts against. Measurement confirmation is a planner step, not a game one. */
export function scoreFor(ruleId: string): ScoreKey | null {
  if (ruleId === 'CAT-DIM-001' || ruleId === 'CAT-MAT-004' || ruleId === 'CAT-PLT-004') return null;
  if (ruleId.startsWith('CAT-WX')) return 'weather';
  if (ruleId.startsWith('CAT-BLD') || ruleId === 'CAT-ACC-005' || ruleId === 'CAT-DIM-002') return 'buildability';
  if (ruleId.startsWith('CAT-WEL') || ruleId.startsWith('CAT-MOB') || ruleId === 'CAT-ACC-006') return 'happiness';
  return 'safety';
}

export const gameFindings = (fs: Finding[]) => fs.filter((f) => f.status === 'open' && scoreFor(f.ruleId) !== null);
export const findingText = (f: Finding) => GAME_WORDS[f.ruleId] ?? f.title;

const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
const PENALTY: Record<ScoreKey, Record<string, number>> = {
  safety: { blocker: 30, warning: 12, advisory: 4, info: 0 },
  happiness: { blocker: 20, warning: 10, advisory: 4, info: 0 },
  social: { blocker: 0, warning: 0, advisory: 0, info: 0 },
  weather: { blocker: 30, warning: 22, advisory: 10, info: 0 },
  buildability: { blocker: 35, warning: 12, advisory: 5, info: 0 },
  budget: { blocker: 0, warning: 0, advisory: 0, info: 0 },
  style: { blocker: 0, warning: 0, advisory: 0, info: 0 }
};

const NEED_TIP: Record<Need, string> = {
  rest: 'Add a bed, hammock or a wide shelf to rest on.',
  lookout: 'Add a high shelf, hammock or bridge near the mesh for a lookout.',
  hide: 'Add a hideaway cube — every cat needs somewhere to retreat.',
  play: 'Leave open floor and add a bridge or ramp to play on.',
  scratch: 'Add a sisal scratching post.',
  drink: 'Add a water bowl in the shade.',
  toilet: 'Add a litter box in its own enclosure, away from water.',
  greens: 'Add a planter with cat-friendly plants.',
  comfort: 'Add roof cover for shade and a dry corner.'
};

function fromFindings(key: ScoreKey, fs: Finding[], cat: Catalog, score: { v: number; notes: string[]; tips: string[] }) {
  for (const f of gameFindings(fs)) {
    if (scoreFor(f.ruleId) !== key) continue;
    const pen = PENALTY[key][f.severity] ?? 0;
    if (!pen) continue;
    score.v -= pen;
    score.notes.push(`−${pen} ${findingText(f)}`);
    const r = cat.rule(f.ruleId);
    if (r && !score.tips.includes(r.remediation)) score.tips.push(r.remediation);
  }
}

export function scoreDesign(sc: Scenario, e: Evaluation, cat: Catalog): Scores {
  const { project: p, assembly: a, findings: fs, sim } = e;
  const nCats = sc.cats.length;
  const st = sim.stats;
  const out = {} as Record<ScoreKey, Score>;
  const mk = (key: ScoreKey, start = 100) => ({ v: start, notes: [] as string[], tips: [] as string[], key });
  const done = (s: ReturnType<typeof mk>) => { out[s.key] = { key: s.key, value: clamp(s.v), notes: s.notes, tips: s.tips.slice(0, 4) }; };

  // ---------- safety ----------
  const safety = mk('safety');
  fromFindings('safety', fs, cat, safety);
  if (st.escapes) { safety.v -= 25 * st.escapes; safety.notes.push(`−${25 * st.escapes} ${st.escapes === 1 ? 'A cat' : `${st.escapes} cats`} got out during the afternoon.`); }
  if (st.nearMisses) { safety.v -= 6 * st.nearMisses; safety.notes.push(`−${6 * st.nearMisses} Near miss at the door at cleaning time.`); safety.tips.push('Add a vestibule: a second door means the cat can never dash straight outside.'); }
  if (st.hazardNibbles) { safety.v -= 15 * st.hazardNibbles; safety.notes.push(`−${15 * st.hazardNibbles} A cat chewed a toxic plant.`); }
  if (!safety.notes.length) safety.notes.push('No issue detected by the current rules, and nobody got out.');
  done(safety);

  // ---------- happiness ----------
  const hap = mk('happiness', 0);
  const mean = st.cats.length ? st.cats.reduce((x, c) => x + c.happiness, 0) / st.cats.length : 0;
  hap.v = ((mean - 0.35) / 0.45) * 100;
  hap.notes.push(`Needs met over the afternoon: ${Math.round(mean * 100)}%.`);
  for (const c of st.cats) {
    for (const n of c.frustrated) {
      const w = PERSONALITIES[c.personality].needs[n];
      const pen = Math.round(6 + 8 * w);
      hap.v -= pen;
      hap.notes.push(`−${pen} ${c.name} couldn’t get ${n === 'lookout' ? 'to a lookout' : n === 'rest' ? 'a good rest' : n === 'hide' ? 'anywhere to hide' : `what they needed (${n})`}.`);
      if (!hap.tips.includes(NEED_TIP[n])) hap.tips.push(NEED_TIP[n]);
    }
    if (c.escaped) hap.notes.push(`${c.name} spent part of the afternoon lost outside.`);
    const total = sim.graph ? sim.graph.nodes.length : 0;
    const frac = total ? c.reachable / total : 1;
    if (!c.escaped && frac < 0.8) {
      const pen = Math.round(30 * (1 - frac));
      hap.v -= pen;
      hap.notes.push(`−${pen} ${c.name} can only get to ${c.reachable} of ${total} spots in the catio.`);
      const tip = c.personality === 'lounger' || sc.cats.find((x) => x.id === c.id)?.ageClass === 'senior' ? 'Add a ramp, or shelves in small steps (about 30 cm / 12″), so a senior can get around.' : 'Lower the gaps between perches so every cat can get around.';
      if (!hap.tips.includes(tip)) hap.tips.unshift(tip);
    }
  }
  fromFindings('happiness', fs, cat, hap);
  if (st.noEntry) { hap.v -= 15; hap.notes.push('−15 The cats can’t come and go on their own.'); hap.tips.push('Add a window insert or a cat door.'); }
  if (st.unreachable.length && sim.graph) { const pen = 6 * st.unreachable.length; hap.v -= pen; hap.notes.push(`−${pen} ${st.unreachable.length} spot${st.unreachable.length === 1 ? '' : 's'} nobody could reach: ${[...new Set(st.unreachable.map((i) => sim.graph!.nodes[i].label))].join(', ')}.`); hap.tips.push('Lower the step between perches, or add a ramp, so every spot is reachable.'); }
  done(hap);

  // ---------- social flow ----------
  const soc = mk('social');
  const g = sim.graph;
  const restSpots = g ? g.nodes.filter((n) => (n.tags.rest ?? 0) >= 0.6).reduce((x, n) => x + n.capacity, 0) : 0;
  const water = g ? g.nodes.filter((n) => n.kind === 'water').length : 0;
  const perches = g ? g.nodes.filter((n) => n.pos[1] >= 0.5 && n.kind !== 'entry' && n.kind !== 'bridge').length + (g.nodes.some((n) => n.kind === 'bridge') ? 1 : 0) : 0;
  if (nCats >= 2) {
    if (st.conflicts) { const pen = Math.round(10 * st.conflicts); soc.v -= pen; soc.notes.push(`−${pen} ${st.conflicts} squabble${st.conflicts === 1 ? '' : 's'} over the same spot.`); soc.tips.push('Give every cat its own perch and resting spot so nobody has to share.'); }
    if (st.cornered) { soc.v -= 15 * st.cornered; soc.notes.push(`−${15 * st.cornered} A cat was cornered on a dead-end perch.`); soc.tips.push('Give high perches two ways off — a second shelf, a bridge or a ramp.'); }
    const de = st.deadEnds.length;
    if (de) { const pen = Math.min(24, 8 * de); soc.v -= pen; soc.notes.push(`−${pen} ${de} dead-end perch${de === 1 ? '' : 'es'} (only one way off).`); }
    if (restSpots < nCats) { soc.v -= 12; soc.notes.push(`−12 Resting spots for ${restSpots} of ${nCats} cats.`); soc.tips.push('Add a resting spot for every cat (beds, hammocks, wide shelves).'); }
    if (water < 1) { soc.v -= 12; soc.notes.push('−12 No water to share.'); }
    else if (nCats >= 3 && water < 2) { soc.v -= 8; soc.notes.push('−8 One water bowl for three or more cats.'); soc.tips.push('With several cats, put resources (water, beds) in more than one place.'); }
    if (perches < nCats) { soc.v -= 10; soc.notes.push(`−10 Perches for ${perches} of ${nCats} cats.`); }
    if (st.routesUp <= 1) { soc.v -= 15; soc.notes.push('−15 Only one way up: a bottleneck where cats meet head-on.'); soc.tips.push('Add a second way up (another shelf or a ramp at the other end).'); }
    if (soc.notes.length === 0) soc.notes.push('Plenty of routes and spots to go round — no standoffs.');
  } else {
    if (st.routesUp === 0 && mainStructure(p)?.template !== 'window-box') { soc.v -= 20; soc.notes.push('−20 No way up off the floor.'); soc.tips.push('Add shelves at a few heights so there’s a route up.'); }
    const de = st.deadEnds.length;
    if (de > 1) { soc.v -= 5 * (de - 1); soc.notes.push(`−${5 * (de - 1)} Several perches with only one way on and off.`); }
    if (soc.notes.length === 0) soc.notes.push('One cat, room to roam: the routes flow well.');
  }
  done(soc);

  // ---------- weather ----------
  const wx = mk('weather');
  fromFindings('weather', fs, cat, wx);
  const hot = st.cats.reduce((x, c) => x + c.hotTicks, 0) / Math.max(1, st.cats.length);
  const wet = st.cats.reduce((x, c) => x + c.wetTicks, 0) / Math.max(1, st.cats.length);
  if (sc.climate.hot && hot > 10) { const pen = Math.min(30, Math.round(hot / 3)); wx.v -= pen; wx.notes.push(`−${pen} Cats spent ${Math.round((hot * 15) / 60)} minutes in the hot sun.`); wx.tips.push('Cover part of the roof with a solid panel for shade.'); }
  if (sc.climate.rainy && wet > 5) { const pen = Math.min(30, Math.round(wet / 2)); wx.v -= pen; wx.notes.push(`−${pen} Cats got rained on.`); wx.tips.push('A partial or solid roof gives a dry corner when it rains.'); }
  if (st.wentInside) { wx.v -= 10 * st.wentInside; wx.notes.push(`−${10 * st.wentInside} Cats had to go back inside to stay dry.`); }
  const s = mainStructure(p);
  if (sc.climate.rainy && s && (s.base?.kind === 'none' || s.base?.kind === 'ground-skirt') && (p.site.ground === 'soil' || p.site.ground === 'grass')) { wx.v -= 8; wx.notes.push('−8 The floor turns to mud in the rain.'); wx.tips.push('Pavers or a raised floor drain better than bare ground.'); }
  if (!wx.notes.length) wx.notes.push(`Ready for ${sc.climate.label.toLowerCase()} weather.`);
  done(wx);

  // ---------- buildability ----------
  const bld = mk('buildability');
  fromFindings('buildability', fs, cat, bld);
  if (a.conceptOnly && !gameFindings(fs).some((f) => f.ruleId === 'CAT-BLD-004' || f.ruleId === 'CAT-BLD-005')) { bld.v -= 30; bld.notes.push('−30 Concept only: the planner can’t generate a build package for this.'); }
  if (!bld.notes.length) bld.notes.push(`Every part fits: ${a.parts.filter((x) => x.kind === 'member').reduce((n, x) => n + x.qty, 0)} framing pieces, cut from ${a.cuts.materials.reduce((n, m) => n + m.bins.length, 0)} boards.`);
  done(bld);

  // ---------- budget ----------
  const bud = mk('budget');
  const best = gameCost(a);
  const range = `${money(a.cost.low)}–${money(a.cost.high).replace(/^[^\d]+/, '')}`;
  if (sc.budget) {
    if (best > sc.budget) {
      const over = best / sc.budget - 1;
      bud.v -= over * 300;
      bud.notes.push(`Best price ${money(best)} (range ${range}) — ${Math.round(over * 100)}% over the ${money(sc.budget)} budget.`);
      bud.tips.push('Cheaper wins: a smaller footprint, a mesh or half roof, and fewer kits. Shelves are cheaper than beds and hammocks.');
    } else bud.notes.push(`Best price ${money(best)} of the ${money(sc.budget)} budget (range ${range}).`);
  } else bud.notes.push(`Estimated ${range} (no budget limit).`);
  done(bud);

  // ---------- style ----------
  const sty = mk('style', 45);
  const safePlants = p.plants.filter((pl) => cat.plant(pl.plantId)?.catSafety === 'no-known-issue').length;
  const badPlants = p.plants.filter((pl) => cat.plant(pl.plantId)?.catSafety === 'known-hazard').length;
  const kinds = new Set((s?.furnishings ?? []).map((f) => f.componentId).filter((c) => !c.startsWith('planter')));
  sty.v += 10 * Math.min(3, safePlants);
  if (safePlants) sty.notes.push(`+${10 * Math.min(3, safePlants)} Cat-friendly planting.`);
  sty.v += 5 * Math.min(5, kinds.size);
  sty.notes.push(`+${5 * Math.min(5, kinds.size)} Variety: ${kinds.size} kinds of furnishing.`);
  if (badPlants) { sty.v -= 20 * badPlants; sty.notes.push(`−${20 * badPlants} Toxic plants aren’t a good look.`); }
  const themed = sc.theme === 'garden' ? safePlants >= 2 : sc.theme === 'shelter' ? restSpots >= nCats : sc.theme === 'cozy' ? (s?.furnishings ?? []).some((f) => f.componentId === 'bed' || f.componentId === 'hammock') : false;
  if (themed) { sty.v += 10; sty.notes.push('+10 Fits the household’s style.'); }
  if (safePlants === 0) sty.tips.push('Add a planter with a cat-friendly plant such as a spider plant.');
  done(sty);

  // ---------- overall ----------
  const w: Record<ScoreKey, number> = { safety: 3, happiness: 3, social: nCats >= 2 ? 1.5 : 0.75, weather: 1.5, buildability: 1.5, budget: sc.budget ? 1.5 : 0.5, style: 0.5, ...sc.weights };
  const total = SCORE_KEYS.reduce((x, k) => x + w[k], 0);
  const overall = Math.round(SCORE_KEYS.reduce((x, k) => x + out[k].value * w[k], 0) / total);
  const goals = sc.goals.map((gl) => ({ id: gl.id, label: gl.label, met: gl.test(e) }));
  const passed = overall >= sc.pass && out.safety.value >= sc.minSafety && goals.every((x) => x.met);
  const stars = (passed ? (overall >= sc.pass + 15 ? 3 : overall >= sc.pass + 7 ? 2 : 1) : 0) as Scores['stars'];
  return { scores: out, overall, stars, passed, goals };
}

export type { Evaluation };
/** The game's budget figure: the generator's best-price (low) estimate. */
export const gameCost = (a: Assembly) => a.cost.low;
export type { Project, SimResult };
