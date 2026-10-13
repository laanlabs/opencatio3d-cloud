// The Daily Challenge: a household, site, climate and budget generated from the UTC date. Same date →
// same challenge for everyone, with no server: everything comes from mulberry32 seeded by the date.
import type { TemplateId } from '../model/types';
import { stableId } from '../model/types';
import { COATS, questCat } from './personalities';
import { pick, rngFor } from './rng';
import { GOALS, HOT, MILD, RAINY, questSite, questStructure } from './scenarios';
import { PERSONALITY_IDS, type Goal, type PersonalityId, type Scenario } from './types';

const NAMES = ['Ziggy', 'Marmalade', 'Pickles', 'Noodle', 'Waffles', 'Pumpkin', 'Clementine', 'Basil', 'Fig', 'Tofu', 'Socks', 'Dumpling', 'Hazel', 'Moose', 'Pepita', 'Turnip', 'Kiwi', 'Bramble'];
const BIOS: Record<PersonalityId, string> = {
  explorer: 'Up every wall; tests every gap.',
  shy: 'Needs a quiet place to hide.',
  lounger: 'A senior who loves a sunny bed.',
  boss: 'Claims the best seat in the house.',
  kitten: 'Tiny, fast and into everything.',
  nibbler: 'Tastes every plant.'
};

/** Today's date as YYYY-MM-DD in UTC (so everyone shares one challenge per day). */
export const utcDate = (d = new Date()) => d.toISOString().slice(0, 10);

export function dailyScenario(date: string): Scenario {
  const rng = rngFor(`quest-daily:${date}`);
  const template = pick(rng, ['lean-to', 'lean-to', 'freestanding', 'freestanding', 'window-box'] as TemplateId[]);
  const nCats = template === 'window-box' ? 1 : 1 + Math.floor(rng() * 3);
  const climate = pick(rng, [MILD, MILD, HOT, RAINY]);
  const names = [...NAMES];
  const used = new Set<PersonalityId>();
  const cats = Array.from({ length: nCats }, (_, i) => {
    const name = names.splice(Math.floor(rng() * names.length), 1)[0];
    let per = pick(rng, PERSONALITY_IDS);
    if (used.has(per) && (per === 'boss' || per === 'lounger')) per = 'explorer';
    if (template === 'window-box' && (per === 'lounger' || per === 'boss')) per = 'explorer';
    used.add(per);
    return questCat(stableId(`quest:daily:${date}:cat:${i}`), name, per, COATS[Math.floor(rng() * COATS.length)], BIOS[per], per === 'explorer' ? { escapeRisk: rng() < 0.4 ? 'high' : 'medium' } : {});
  });
  const budget = template === 'window-box' ? 550 + 50 * Math.floor(rng() * 4) : 1500 + 250 * Math.floor(rng() * 7);
  const goals: Goal[] = [GOALS.budget(budget), GOALS.restForAll(nCats)];
  if (climate.hot) goals.push({ id: 'shade', label: 'A shady place to rest', test: (e) => (e.sim.graph?.nodes ?? []).some((n) => n.shade >= 0.5 && (n.tags.rest ?? 0) >= 0.6) });
  if (climate.rainy) goals.push({ id: 'dry', label: 'A dry place to rest when it rains', test: (e) => (e.sim.graph?.nodes ?? []).some((n) => n.dry && (n.tags.rest ?? 0) >= 0.6) });
  if (cats.some((c) => c.escapeRisk === 'high')) goals.push(GOALS.noEscapes());
  const key = `daily-${date}`;
  const keepFurn = Math.floor(rng() * 3);
  const pretty = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  return {
    id: key,
    title: `Daily Challenge · ${pretty}`,
    tagline: `${nCats === 1 ? 'One cat' : `${nCats} cats`}, a ${template.replace('-', ' ')}, ${climate.label.toLowerCase()} weather.`,
    story: `Today’s household: ${cats.map((c) => c.name).join(', ')}. Build them a catio that keeps everyone in, happy and comfortable — within $${budget.toLocaleString('en-US')}. Everyone playing today gets the same challenge.`,
    difficulty: nCats >= 3 || climate !== MILD ? 2 : 1,
    cats, climate, budget,
    templates: template === 'window-box' ? ['window-box'] : ['lean-to', 'freestanding'],
    constraints: [`Budget: $${budget.toLocaleString('en-US')}`, `${climate.label} weather`],
    goals,
    pass: 62, minSafety: 60,
    seed: `quest:${key}`,
    daily: true,
    start: () => questStructure(questSite(key), key, template, (s) => { s.furnishings = s.furnishings.slice(0, keepFurn); })
  };
}
