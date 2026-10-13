// "Let them explore": a deterministic afternoon in the catio. Each cat is an agent with needs (rest,
// lookout, hiding, play, scratching, water, litter, greens, comfort) weighted by its personality. Every
// tick needs drain; a free cat picks the spot that best meets its most pressing need among the spots it
// can actually reach (its jump reach decides which edges of the navigation graph it may take), walks or
// jumps there and stays a while. Weather, a bird visit, cleaning time and escape tests happen on a fixed
// timeline. Randomness comes only from mulberry32 seeded by (seed, layout), so the same design and seed
// always produce the same event log — the result screen can explain exactly what happened and why.
import type { Catalog } from '../catalog/catalog';
import type { Project, Vec3 } from '../model/types';
import { activeBlockers, ESCAPE_OPENING, KITTEN_OPENING, type Finding } from '../analysis/checks';
import { meshMaterial } from '../generate/structure';
import { NEEDS, type Climate, type Need, type PersonalityId, type QuestCat } from './types';
import { PERSONALITIES, capsFor } from './personalities';
import { buildNav, deadEnds, pathTo, routesUp, shortestPaths, type Caps, type NavGraph } from './nav';
import { mainStructure } from './design';
import { hashSeed, mulberry32 } from './rng';

export const TICKS = 240;
/** Real seconds of afternoon per tick (for the clock on screen). */
export const TICK_SECONDS = 15;

export type Pose = 'walk' | 'jump' | 'sit' | 'loaf' | 'sleep' | 'scratch' | 'drink' | 'toilet' | 'hide' | 'sniff' | 'play' | 'lookout' | 'groom' | 'paw' | 'gone' | 'inside';

export interface Seg {
  t0: number;
  t1: number;
  from: Vec3;
  to: Vec3;
  pose: Pose;
  node: number;
  need?: Need;
  q?: number;
}

export type Tone = 'good' | 'info' | 'bad';
export interface SimEvent { t: number; cat: string; kind: string; emoji: string; text: string; tone: Tone; node?: number }

export interface WeatherSpan { kind: 'sun' | 'rain' | 'bird' | 'clean'; t0: number; t1: number }

export interface CatStats {
  id: string;
  name: string;
  personality: PersonalityId;
  happiness: number;
  needs: Record<Need, number>;
  frustrated: Need[];
  escaped: boolean;
  nearMiss: boolean;
  conflicts: number;
  cornered: number;
  wetTicks: number;
  hotTicks: number;
  nibbled: string[];
  reachable: number;
}

export interface SimStats {
  cats: CatStats[];
  visits: number[];
  /** Furnishing spots no cat could reach. */
  unreachable: number[];
  /** Spots some cat could reach but nobody used. */
  neglected: number[];
  deadEnds: number[];
  routesUp: number;
  conflicts: number;
  cornered: number;
  escapes: number;
  nearMisses: number;
  hazardNibbles: number;
  wentInside: number;
  noEntry: boolean;
}

export interface SimResult {
  seed: string;
  ticks: number;
  graph: NavGraph | null;
  cats: { id: string; name: string; coat: string; personality: PersonalityId; caps: Caps }[];
  tracks: Record<string, Seg[]>;
  events: SimEvent[];
  weather: WeatherSpan[];
  stats: SimStats;
}

const DECAY = 0.0035;
/** Needs a house-connected catio can leave to the house (water, litter, the indoor scratcher). */
const INDOORS = new Set<Need>(['drink', 'toilet', 'scratch']);
const GAIN: Record<Need, number> = { rest: 0.9, lookout: 0.9, hide: 1, play: 0.9, scratch: 1, drink: 1.2, toilet: 1.2, greens: 0.9, comfort: 0.8 };
const DURATION: Record<Need, [number, number]> = { rest: [26, 44], lookout: [16, 26], hide: [22, 36], play: [9, 15], scratch: [5, 8], drink: [4, 6], toilet: [7, 9], greens: [5, 8], comfort: [16, 24] };
const POSE: Record<Need, Pose> = { rest: 'loaf', lookout: 'lookout', hide: 'hide', play: 'play', scratch: 'scratch', drink: 'drink', toilet: 'toilet', greens: 'sniff', comfort: 'loaf' };
const NEED_WORDS: Record<Need, string> = { rest: 'a comfy place to rest', lookout: 'a high lookout', hide: 'somewhere to hide', play: 'room to play', scratch: 'something to scratch', drink: 'water', toilet: 'a litter box', greens: 'something green to sniff', comfort: 'shelter from the weather' };

export function weatherFor(climate: Climate): WeatherSpan[] {
  const w: WeatherSpan[] = [];
  if (climate.hot) w.push({ kind: 'sun', t0: 50, t1: 170 });
  if (climate.rainy) w.push({ kind: 'rain', t0: 105, t1: 175 });
  w.push({ kind: 'bird', t0: 85, t1: 105 });
  w.push({ kind: 'clean', t0: 185, t1: 196 });
  return w;
}

const active = (w: WeatherSpan[], kind: WeatherSpan['kind'], t: number) => w.some((x) => x.kind === kind && t >= x.t0 && t < x.t1);

interface Agent {
  c: QuestCat;
  caps: Caps;
  idx: number;
  node: number;
  busyUntil: number;
  s: Record<Need, number>;
  segs: Seg[];
  happy: number;
  avg: Record<Need, number>;
  frustrated: Set<Need>;
  said: Set<string>;
  escaped: boolean;
  nearMiss: boolean;
  testedEscape: boolean;
  conflicts: number;
  cornered: number;
  wet: number;
  hot: number;
  nibbled: string[];
  /** Spot to avoid after being chased off, until the given tick. */
  avoid: { node: number; until: number } | null;
  inside: boolean;
  arrived: boolean;
}

/**
 * Runs the afternoon. `findings` are the real checks for the same project (they decide which escape
 * routes exist); `seed` is usually the scenario's.
 */
export function simulate(p: Project, cat: Catalog, cats: QuestCat[], climate: Climate, findings: Finding[], seed: string): SimResult {
  const graph = buildNav(p, cat);
  const weather = weatherFor(climate);
  const rng = mulberry32(hashSeed(`${seed}|${graph ? graph.nodes.length : 0}|${graph ? graph.edges.length : 0}`));
  const events: SimEvent[] = [];
  const say = (a: Agent, t: number, kind: string, emoji: string, text: string, tone: Tone, node?: number, once = true) => {
    if (once && a.said.has(kind)) return;
    a.said.add(kind);
    events.push({ t, cat: a.c.id, kind, emoji, text, tone, ...(node != null ? { node } : {}) });
  };
  const agents: Agent[] = cats.map((c, idx) => ({
    c, caps: capsFor(c), idx, node: graph?.entry ?? 0, busyUntil: idx * 4, s: Object.fromEntries(NEEDS.map((n) => [n, 0.55 + rng() * 0.3])) as Record<Need, number>,
    segs: [], happy: 0, avg: Object.fromEntries(NEEDS.map((n) => [n, 0])) as Record<Need, number>, frustrated: new Set(), said: new Set(), escaped: false, nearMiss: false,
    testedEscape: false, conflicts: 0, cornered: 0, wet: 0, hot: 0, nibbled: [], avoid: null, inside: false, arrived: false
  }));
  const s = mainStructure(p);
  const emptyStats = (noEntry: boolean): SimStats => ({ cats: agents.map((a) => catStats(a, 0)), visits: [], unreachable: [], neglected: [], deadEnds: [], routesUp: 0, conflicts: 0, cornered: 0, escapes: 0, nearMisses: 0, hazardNibbles: 0, wentInside: 0, noEntry });
  if (!graph || !s) return { seed, ticks: TICKS, graph, cats: agents.map((a) => ({ id: a.c.id, name: a.c.name, coat: a.c.coat, personality: a.c.personality, caps: a.caps })), tracks: {}, events, weather, stats: emptyStats(true) };

  const g: NavGraph = graph;
  const visits = new Array(g.nodes.length).fill(0);
  const dead = new Set(deadEnds(g));
  const start = g.entry ?? g.nodes.findIndex((n) => n.kind === 'floor');
  if (g.entry == null) for (const a of agents) say(a, 0, 'no-entry', '🚪', `${a.c.name} had to be carried in — there’s no cat entrance or door.`, 'bad');
  for (const a of agents) a.node = start;

  // Escape routes, decided by the real checks and the mesh.
  const mesh = meshMaterial(s, cat);
  const shortSide = Math.min(...((mesh.opening ?? [0.0254, 0.0254]) as number[]));
  const ids = new Set(activeBlockers(findings).map((f) => f.ruleId).concat(findings.filter((f) => f.status === 'open').map((f) => f.ruleId)));
  const door = s.openings.find((o) => o.kind === 'human-door');
  const unlatched = s.openings.find((o) => (o.kind === 'human-door' || o.kind === 'cleaning-hatch' || o.kind === 'vestibule') && !o.latch);
  const vestibule = s.openings.some((o) => o.kind === 'vestibule');
  const escapeProne = (a: Agent) => a.c.escapeRisk === 'high' || (a.c.escapeRisk === 'medium' && PERSONALITIES[a.c.personality].escapeDrive >= 0.5);

  const occupancy = (node: number, t: number, except: Agent) => agents.filter((o) => o !== except && !o.escaped && o.segs.some((sg) => sg.node === node && sg.pose !== 'walk' && sg.pose !== 'jump' && t >= sg.t0 && t < sg.t1));

  const pos = (n: number): Vec3 => g.nodes[n].pos;
  const addSeg = (a: Agent, seg: Seg) => { if (seg.t1 > seg.t0) a.segs.push(seg); };
  /** Moves along a path from a.node, returning the arrival tick. */
  const travel = (a: Agent, t: number, path: { nodes: number[]; edges: number[] }): number => {
    let at = t, from = a.node;
    path.nodes.forEach((to, k) => {
      const e = g.edges[path.edges[k]];
      const dy = Math.abs(pos(to)[1] - pos(from)[1]);
      const dur = e.kind === 'jump' ? (dy > 1 ? 4 : 3) : e.kind === 'ramp' ? Math.max(3, Math.ceil(e.len / 0.2)) : Math.max(2, Math.ceil(e.len / (e.kind === 'plank' ? 0.3 : 0.25)));
      addSeg(a, { t0: at, t1: at + dur, from: pos(from), to: pos(to), pose: e.kind === 'jump' ? 'jump' : 'walk', node: to });
      at += dur;
      from = to;
    });
    a.node = from;
    return at;
  };
  const stay = (a: Agent, t0: number, t1: number, pose: Pose, need?: Need, q?: number) => addSeg(a, { t0, t1: Math.min(TICKS, t1), from: pos(a.node), to: pos(a.node), pose, node: a.node, ...(need ? { need, q } : {}) });
  const leave = (a: Agent, t: number, pose: 'gone' | 'inside', until = TICKS) => { stay(a, t, until, pose); a.busyUntil = until; if (pose === 'gone') a.escaped = true; };

  /** Walks to the floor by the front mesh (an escape or a mesh test), returning the arrival tick. */
  const toWall = (a: Agent, t: number): number => {
    const paths = shortestPaths(g, a.node, a.caps);
    const spot = g.nodes.filter((n) => n.kind === 'floor' && paths.dist[n.i] < Infinity).sort((x, y) => y.pos[2] - x.pos[2] || Math.abs(x.pos[0] - g.W / 2) - Math.abs(y.pos[0] - g.W / 2) || x.i - y.i)[0];
    return spot ? travel(a, t, pathTo(paths, spot.i)) : t;
  };

  function interruptAt(o: Agent, t: number) {
    o.segs = o.segs.filter((sg) => sg.t0 < t).map((sg) => (sg.t1 > t ? { ...sg, t1: t } : sg));
    const last = o.segs[o.segs.length - 1];
    if (last) o.node = last.node;
    o.busyUntil = t;
  }

  /** Cleaning time: a human opens the door. Escape-prone cats try to dash. */
  function cleaningTime(t: number) {
    if (!door) return;
    for (const a of agents) {
      if (a.escaped || a.inside || !escapeProne(a) || t < a.idx * 4) continue;
      interruptAt(a, t);
      if (vestibule) { say(a, t, 'vestibule', '🔐', `${a.c.name} tried a door dash at cleaning time — the vestibule stopped it.`, 'good'); continue; }
      if (!door.selfClosing) {
        say(a, t, 'escape', '🏃', `${a.c.name} dashed out while the door stood open. A self-closing door (and a vestibule) prevents this.`, 'bad');
        leave(a, toWall(a, t), 'gone');
        continue;
      }
      a.nearMiss = true;
      say(a, t, 'near-miss', '😬', `${a.c.name} nearly slipped past your legs at cleaning time. A vestibule makes door dashes impossible.`, 'bad');
    }
  }

  const homeReachable = (a: Agent, paths: { dist: number[] }) => g.entry != null && g.entryKind !== 'door' && paths.dist[g.entry] < Infinity;

  function decide(a: Agent, t: number) {
    const per = PERSONALITIES[a.c.personality];
    // Back from inside after the rain.
    if (a.inside) { a.inside = false; }
    // First arrival.
    if (!a.arrived) {
      a.arrived = true;
      if (g.entryKind === 'window' || g.entryKind === 'cat-door') say(a, t, 'arrive', '🐾', `${a.c.name} steps out through the ${g.entryKind === 'window' ? 'window' : 'cat door'} to explore.`, 'info');
      if (g.entryKind === 'door' && a.idx === 0) say(a, t, 'carried', '🤲', `${a.c.name} was carried in through the people door — a cat door or window insert lets cats come and go.`, 'info');
    }
    // Escape test (once), by the real flaws.
    if (!a.testedEscape && escapeProne(a) && t >= 30 + a.idx * 12) {
      a.testedEscape = true;
      const arrive = toWall(a, t);
      if (shortSide >= ESCAPE_OPENING - 1e-9) {
        say(a, arrive, 'escape', '🏃', `${a.c.name} squeezed out through the ${Math.round(shortSide / 0.0254)}″ mesh! Openings this big let cats through.`, 'bad');
        return leave(a, arrive, 'gone');
      }
      if (a.c.ageClass === 'kitten' && shortSide > KITTEN_OPENING + 1e-9) {
        say(a, arrive, 'escape', '🏃', `${a.c.name} is small enough to slip through this mesh! Kittens need ½″ openings.`, 'bad');
        return leave(a, arrive, 'gone');
      }
      if (ids.has('CAT-ENC-004')) {
        say(a, arrive, 'escape', '🏃', `${a.c.name} found the gap beside the house window and slipped out.`, 'bad');
        return leave(a, arrive, 'gone');
      }
      if (unlatched) {
        say(a, arrive, 'escape', '🏃', `${a.c.name} pushed the unlatched ${unlatched.kind === 'cleaning-hatch' ? 'hatch' : 'door'} open and wandered off.`, 'bad');
        return leave(a, arrive, 'gone');
      }
      say(a, arrive, 'mesh-held', '🛡️', `${a.c.name} tested every wall. The mesh held!`, 'good');
      stay(a, arrive, arrive + 5, 'paw');
      a.busyUntil = arrive + 5;
      return;
    }
    // Rain: get dry, or go back in.
    if (active(weather, 'rain', t) && !g.nodes[a.node].dry) {
      const paths = shortestPaths(g, a.node, a.caps);
      const dry = g.nodes.filter((n) => n.dry && n.kind !== 'entry' && paths.dist[n.i] < Infinity && occupancy(n.i, t, a).length < n.capacity).sort((x, y) => paths.dist[x.i] - paths.dist[y.i] || x.i - y.i)[0];
      if (dry) {
        const arrive = travel(a, t, pathTo(paths, dry.i));
        say(a, arrive, 'dry', '☔', `${a.c.name} waited out the shower somewhere dry.`, 'good');
        const end = Math.min(TICKS, arrive + 20);
        stay(a, arrive, end, 'loaf', 'comfort', 1);
        a.busyUntil = end;
        return;
      }
      if (g.entry != null && g.entryKind !== 'door' && paths.dist[g.entry] < Infinity) {
        const arrive = travel(a, t, pathTo(paths, g.entry));
        say(a, arrive, 'went-inside', '🌧️', `Nowhere dry — ${a.c.name} went back indoors until the rain stopped.`, 'bad');
        const end = weather.find((w) => w.kind === 'rain')!.t1;
        a.inside = true;
        return leave(a, arrive, 'inside', end);
      }
      say(a, t, 'soaked', '💦', `${a.c.name} got soaked — there’s no dry corner.`, 'bad');
    }
    // Choose the best (need, spot).
    const paths = shortestPaths(g, a.node, a.caps);
    const bird = active(weather, 'bird', t), sun = active(weather, 'sun', t), rain = active(weather, 'rain', t);
    let best: { need: Need; node: number; v: number } | null = null;
    const urgencies = NEEDS.map((n) => ({ n, u: per.needs[n] * (1 - a.s[n]) + (bird && n === 'lookout' && per.needs.lookout >= 0.5 ? 0.45 : 0) })).sort((x, y) => y.u - x.u || NEEDS.indexOf(x.n) - NEEDS.indexOf(y.n));
    for (const { n, u } of urgencies) {
      if (u <= 0.01 || n === 'comfort') continue;
      let any = false, reachable = false;
      for (const node of g.nodes) {
        const q = node.tags[n] ?? 0;
        if (q <= 0) continue;
        any = true;
        const dist = paths.dist[node.i];
        if (dist === Infinity) continue;
        reachable = true;
        const occ = occupancy(node.i, t + Math.round(dist), a);
        const blocked = occ.length >= node.capacity && !occ.every((o) => PERSONALITIES[o.c.personality].rank < per.rank && per.id === 'boss');
        if (blocked && node.kind !== 'floor') continue;
        if (a.avoid && a.avoid.node === node.i && t < a.avoid.until) continue;
        let w = 1;
        // Even the boss prefers a free spot; it only pushes in when nothing else is nearly as good.
        const crowd = occ.length >= node.capacity && node.kind !== 'floor' ? 0.22 : 0;
        if (sun && per.needs.comfort >= 0.4) w *= 0.55 + 0.45 * node.shade;
        if (rain) w *= node.dry ? 1 : 0.3;
        const v = u * q * w - 0.01 * dist - crowd + rng() * 0.05;
        if (!best || v > best.v) best = { need: n, node: node.i, v };
      }
      if (u > 0.3 && !reachable && INDOORS.has(n) && homeReachable(a, paths)) {
        // Window and cat-door catios connect to the house: water, litter and a scratcher are indoors.
        const arrive = travel(a, t, pathTo(paths, g.entry!));
        say(a, arrive, `indoors-${n}`, '🏠', `${a.c.name} popped indoors for ${NEED_WORDS[n]}.`, 'info');
        const end = Math.min(TICKS, arrive + 14);
        a.s[n] = Math.min(1, a.s[n] + 0.8);
        a.inside = true;
        return leave(a, arrive, 'inside', end);
      }
      if (u > 0.3 && !reachable && !a.frustrated.has(n)) {
        a.frustrated.add(n);
        say(a, t, `frustrated-${n}`, any ? '😿' : '❓', any ? `${a.c.name} wants ${NEED_WORDS[n]} but can’t get up there${a.caps.up < 0.7 ? ' — big step-ups are hard for seniors' : ''}.` : `${a.c.name} is looking for ${NEED_WORDS[n]} — there isn’t one.`, 'bad');
      }
    }
    if (!best || best.v <= 0.02) {
      const end = t + 6 + Math.floor(rng() * 4);
      stay(a, t, end, 'groom');
      a.busyUntil = end;
      return;
    }
    const target = g.nodes[best.node];
    const path = pathTo(paths, best.node);
    const arrive = path.nodes.length ? travel(a, t, path) : t;
    // Conflicts at the spot.
    const occ = occupancy(best.node, arrive, a);
    if (occ.length >= target.capacity && target.kind !== 'floor' && per.id !== 'boss') {
      // Taken: wait a moment, then pick somewhere else.
      a.avoid = { node: best.node, until: arrive + 30 };
      stay(a, arrive, arrive + 3, 'groom');
      a.busyUntil = arrive + 3;
      return;
    }
    if (occ.length >= target.capacity && target.kind !== 'floor') {
      const victim = occ.sort((x, y) => PERSONALITIES[x.c.personality].rank - PERSONALITIES[y.c.personality].rank || x.idx - y.idx)[0];
      victim.conflicts++;
      a.conflicts++;
      const isDead = dead.has(best.node);
      if (isDead) {
        victim.cornered++;
        say(victim, arrive, `cornered-${arrive}`, '😾', `${a.c.name} cornered ${victim.c.name} on the ${target.label} — a dead end with only one way off.`, 'bad', best.node, false);
      } else say(victim, arrive, `hiss-${arrive}`, '💢', `${a.c.name} chased ${victim.c.name} off the ${target.label}.`, 'bad', best.node, false);
      interruptAt(victim, arrive);
      victim.avoid = { node: best.node, until: arrive + 40 };
    }
    const [lo, hi] = DURATION[best.need];
    let dur = lo + Math.floor(rng() * (hi - lo + 1));
    const q = target.tags[best.need] ?? 0.5;
    let pose = POSE[best.need];
    if (best.need === 'rest' && (target.kind === 'bed' || target.kind === 'hammock' || target.kind === 'cubby') && per.needs.rest >= 0.6) { pose = 'sleep'; dur += 10; }
    if (best.need === 'rest' && target.pos[1] > 0.5 && per.needs.lookout >= 0.5) pose = 'sit';
    stay(a, arrive, arrive + dur, pose, best.need, q);
    a.busyUntil = Math.min(TICKS, arrive + dur);
    visits[best.node]++;
    // Moments worth a bubble.
    if (bird && best.need === 'lookout' && (target.tags.lookout ?? 0) >= 0.5) say(a, arrive, 'bird', '🐦', `${a.c.name} spotted a bird from the ${target.label}!`, 'good', best.node);
    if (best.need === 'hide' && target.kind === 'cubby') say(a, arrive, 'hide', '📦', `${a.c.name} tucked into the hideaway.`, 'good', best.node);
    if (best.need === 'scratch') say(a, arrive, 'scratch', '🪵', `${a.c.name} had a good long scratch.`, 'good', best.node);
    if (best.need === 'greens' && target.furnishingId) {
      for (const pl of p.plants.filter((x) => x.furnishingId === target.furnishingId)) {
        const plant = cat.plant(pl.plantId);
        if (!plant) continue;
        if (per.nibbles && plant.catSafety === 'known-hazard') {
          a.nibbled.push(plant.id);
          say(a, arrive, `nibble-${plant.id}`, '🚑', `${a.c.name} chewed the ${plant.name.toLowerCase()} — ${plant.hazardLevel === 'severe' ? 'an emergency vet visit' : 'call the vet'}. It’s listed as toxic to cats.`, 'bad', best.node);
        } else if (per.nibbles && plant.catSafety !== 'no-known-issue') say(a, arrive, `nibble-${plant.id}`, '❔', `${a.c.name} nibbled the ${plant.name.toLowerCase()}. Its safety for cats isn’t established.`, 'info', best.node);
        else say(a, arrive, `sniff-${plant.id}`, '🌱', `${a.c.name} ${per.nibbles ? 'nibbled' : 'sniffed'} the ${plant.name.toLowerCase()}${plant.catSafety === 'no-known-issue' ? ' — not on the ASPCA toxic list' : ''}.`, plant.catSafety === 'no-known-issue' ? 'good' : 'info', best.node);
      }
    }
  }

  // ---------- the afternoon ----------
  const rainStart = weather.find((w) => w.kind === 'rain')?.t0;
  const cleanStart = weather.find((w) => w.kind === 'clean')!.t0;
  for (let t = 0; t < TICKS; t++) {
    const sun = active(weather, 'sun', t), rain = active(weather, 'rain', t);
    if (t === cleanStart) cleaningTime(t);
    if (t === rainStart) for (const a of agents) {
      const sg = a.segs.find((x) => t >= x.t0 && t < x.t1);
      if (!a.escaped && !a.inside && sg && !g.nodes[sg.node].dry && sg.pose !== 'walk' && sg.pose !== 'jump') interruptAt(a, t);
    }
    for (const a of agents) {
      if (a.escaped) continue;
      if (t >= a.busyUntil && t >= a.idx * 4) decide(a, t);
      // Effects of this tick.
      const seg = a.segs.find((sg) => t >= sg.t0 && t < sg.t1);
      const per = PERSONALITIES[a.c.personality];
      for (const n of NEEDS) if (n !== 'comfort') a.s[n] = Math.max(0, a.s[n] - DECAY * (0.5 + per.needs[n]));
      if (seg?.need && seg.need !== 'comfort') {
        const dur = seg.t1 - seg.t0;
        a.s[seg.need] = Math.min(1, a.s[seg.need] + (GAIN[seg.need] * (seg.q ?? 0.5)) / Math.max(4, dur) * 1.6);
      }
      const here = seg && seg.pose !== 'inside' && seg.pose !== 'gone' ? g.nodes[seg.node] : null;
      if (here && sun && here.shade < 0.5 && per.needs.comfort >= 0.4) { a.s.comfort = Math.max(0, a.s.comfort - 0.012); a.hot++; if (a.hot === 25) say(a, t, 'hot', '🥵', `${a.c.name} is too hot — no shade here.`, 'bad'); }
      else if (here && rain && !here.dry) { a.s.comfort = Math.max(0, a.s.comfort - 0.02); a.wet++; }
      else a.s.comfort = Math.min(1, a.s.comfort + 0.004);
      // Happiness: weighted mean satisfaction this tick.
      let num = 0, den = 0;
      for (const n of NEEDS) { num += per.needs[n] * a.s[n]; den += per.needs[n]; a.avg[n] += a.s[n] / TICKS; }
      a.happy += num / den / TICKS;
    }
  }
  // Escaped cats were not happy for the rest of the afternoon.
  for (const a of agents) if (a.escaped) say(a, TICKS - 1, 'found', '🏡', `${a.c.name} was found later, hiding under the neighbour’s deck. Real escapes don’t always end this well.`, 'info');

  // ---------- what the afternoon showed ----------
  const everReach = new Set<number>();
  const reachableBy = agents.map((a) => {
    const d = shortestPaths(g, start, a.caps).dist;
    const r = g.nodes.filter((n) => d[n.i] < Infinity).map((n) => n.i);
    r.forEach((i) => everReach.add(i));
    return r.length;
  });
  const furnNodes = g.nodes.filter((n) => n.furnishingId && n.kind !== 'bridge');
  const unreachable = furnNodes.filter((n) => !everReach.has(n.i)).map((n) => n.i);
  const usedFurn = new Set(g.nodes.filter((n) => visits[n.i] > 0).map((n) => n.furnishingId));
  const neglected = furnNodes.filter((n) => everReach.has(n.i) && !usedFurn.has(n.furnishingId)).map((n) => n.i);
  const stats: SimStats = {
    cats: agents.map((a, i) => catStats(a, reachableBy[i])),
    visits, unreachable, neglected, deadEnds: [...dead], routesUp: routesUp(g),
    conflicts: agents.reduce((x, a) => x + a.conflicts, 0) / 2,
    cornered: agents.reduce((x, a) => x + a.cornered, 0),
    escapes: agents.filter((a) => a.escaped).length,
    nearMisses: agents.filter((a) => a.nearMiss).length,
    hazardNibbles: agents.reduce((x, a) => x + a.nibbled.length, 0),
    wentInside: events.filter((e) => e.kind === 'went-inside').length,
    noEntry: g.entry == null
  };
  events.sort((x, y) => x.t - y.t || (x.cat < y.cat ? -1 : x.cat > y.cat ? 1 : 0) || (x.kind < y.kind ? -1 : 1));
  const tracks: Record<string, Seg[]> = {};
  for (const a of agents) tracks[a.c.id] = a.segs.map((sg) => ({ ...sg, t1: Math.min(TICKS, sg.t1) })).filter((sg) => sg.t1 > sg.t0);
  return { seed, ticks: TICKS, graph: g, cats: agents.map((a) => ({ id: a.c.id, name: a.c.name, coat: a.c.coat, personality: a.c.personality, caps: a.caps })), tracks, events, weather, stats };
}

function catStats(a: Agent, reachable: number): CatStats {
  return {
    id: a.c.id, name: a.c.name, personality: a.c.personality, happiness: Math.round(a.happy * 1000) / 1000,
    needs: Object.fromEntries(NEEDS.map((n) => [n, Math.round(a.avg[n] * 1000) / 1000])) as Record<Need, number>,
    frustrated: [...a.frustrated], escaped: a.escaped, nearMiss: a.nearMiss, conflicts: a.conflicts, cornered: a.cornered,
    wetTicks: a.wet, hotTicks: a.hot, nibbled: a.nibbled, reachable
  };
}

/** Where a cat is at time t (structure-local), its pose, and the current segment. */
export function catAt(segs: Seg[], t: number): { pos: Vec3; pose: Pose; seg?: Seg; k: number } {
  const seg = segs.find((sg) => t >= sg.t0 && t < sg.t1) ?? (t >= (segs[segs.length - 1]?.t1 ?? 0) ? segs[segs.length - 1] : segs[0]);
  if (!seg) return { pos: [0, 0, 0], pose: 'gone', k: 0 };
  const k = Math.max(0, Math.min(1, (t - seg.t0) / Math.max(1e-6, seg.t1 - seg.t0)));
  const lerp = (i: number) => seg.from[i] + (seg.to[i] - seg.from[i]) * k;
  let y = lerp(1);
  if (seg.pose === 'jump') y += Math.sin(Math.PI * k) * (0.25 + Math.abs(seg.to[1] - seg.from[1]) * 0.3);
  return { pos: [lerp(0), y, lerp(2)], pose: seg.pose, seg, k };
}

export const timeLabel = (t: number) => {
  const mins = 13 * 60 + Math.floor((t * TICK_SECONDS) / 60);
  const h = Math.floor(mins / 60), m = mins % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'pm' : 'am'}`;
};
