// Catio Prowl game state: the cat, the things it can knock off, toy mice, a visiting bird, the day's
// to-do list and what the cat can do where it stands. Framework-free; the UI calls `update` every frame
// and reads `prompt`, `tasks` and the queued `messages`. Progress per space lives in localStorage.
import type { Catalog } from '../catalog/catalog';
import type { Vec2, Vec3 } from '../model/types';
import type { Pose } from '../quest/sim';
import { type CatState, type LeapTarget, type MoveInput, HEAD, groundAt, inRect, leapTarget, newCat, regionAt, step } from './physics';
import type { Item, Region, Spot, World } from './world';

export type TaskId = 'sill' | 'tunnel' | 'catio' | 'perch' | 'bird' | 'knock' | 'scratch' | 'toys' | 'drink' | 'sniff' | 'nap';
export interface Task { id: TaskId; title: string; goal: number }
export interface Progress { done: TaskId[]; toys: string[]; knocked: string[]; sniffed: string[]; finishedAt?: string }

export interface ItemState { item: Item; p: Vec3; v: Vec3; spin: number; angle: number; state: 'rest' | 'falling' | 'down'; fromY: number }
export type Action =
  | { kind: 'knock'; item: ItemState; label: string }
  | { kind: 'watch'; label: string }
  | { kind: 'spot'; spot: Spot; label: string };
export type Busy = { kind: 'scratch' | 'sofa' | 'drink' | 'eat' | 'sniff' | 'watch' | 'nap' | 'swipe'; t: number; T: number; spot?: Spot };
export type Message = { text: string; tone: 'info' | 'good' | 'task' | 'warn'; sound?: 'meow' | 'crash' | 'chirp' | 'ding' | 'purr' | 'thud' };

const KEY = 'oc3d-prowl-progress-v1';
const BIRD_FIRST = 18, BIRD_STAY = 22, BIRD_AWAY = 30;

export function tasksFor(w: World): Task[] {
  const t: Task[] = [];
  if (w.home) t.push({ id: 'sill', title: 'Hop up to the window', goal: 1 });
  if (w.tunnels.length) t.push({ id: 'tunnel', title: w.tunnels.length > 1 ? 'Run the length of a tunnel' : 'Run the length of the tunnel', goal: 1 });
  if (w.home) t.push({ id: 'catio', title: 'Go out into the catio', goal: 1 });
  if (w.catio.perchId) t.push({ id: 'perch', title: 'Reach the highest perch in the catio', goal: 1 });
  t.push({ id: 'bird', title: 'Watch a bird from the catio', goal: 1 });
  if (w.items.length) t.push({ id: 'knock', title: 'Knock 3 things off the furniture', goal: Math.min(3, w.items.length) });
  if (w.spots.some((s) => s.kind === 'scratch')) t.push({ id: 'scratch', title: 'Sharpen your claws on a scratching post', goal: 1 });
  if (w.toys.length) t.push({ id: 'toys', title: `Find all ${w.toys.length} toy mice`, goal: w.toys.length });
  if (w.spots.some((s) => s.kind === 'drink')) t.push({ id: 'drink', title: 'Have a drink of water', goal: 1 });
  const plants = new Set(w.spots.filter((s) => s.kind === 'plant').map((s) => s.id)).size;
  if (plants) t.push({ id: 'sniff', title: plants === 1 ? 'Sniff the plants' : `Sniff the plants in ${Math.min(3, plants)} pots`, goal: Math.min(3, plants) });
  t.push({ id: 'nap', title: w.spots.some((s) => s.kind === 'nap' && s.sunny) ? 'Nap in a sunbeam' : 'Curl up for a nap', goal: 1 });
  return t;
}

export function readAll(): Record<string, Progress> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw === 'object') return raw;
  } catch { /* storage blocked or damaged */ }
  return {};
}
function readProgress(id: string): Progress {
  const p = readAll()[id];
  const arr = (x: unknown) => (Array.isArray(x) ? x.filter((y) => typeof y === 'string') : []);
  return p ? { done: arr(p.done) as TaskId[], toys: arr(p.toys), knocked: arr(p.knocked), sniffed: arr(p.sniffed), finishedAt: typeof p.finishedAt === 'string' ? p.finishedAt : undefined } : { done: [], toys: [], knocked: [], sniffed: [] };
}
function writeProgress(id: string, p: Progress) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [id]: p })); } catch { /* not remembered this time */ }
}

const SAFETY: Record<string, string> = {
  'known-hazard': 'toxic to cats (ASPCA lists it) — in a real catio, swap it for a cat-safe plant',
  'no-known-issue': 'not listed as toxic to cats by the ASPCA',
  conflicting: 'sources disagree on whether it is safe for cats',
  'insufficient-data': 'its safety for cats is not confirmed — check before you plant it'
};

export class Prowl {
  readonly world: World;
  readonly tasks: Task[];
  readonly cat: CatState;
  readonly items: ItemState[];
  progress: Progress;
  time = 0;
  busy: Busy | null = null;
  target: LeapTarget | null = null;
  action: Action | null = null;
  idle = 0;
  /** Sneaking (for the 3D view's posture) and when the cat last meowed (for its mouth). */
  sneak = false;
  meowAt = -10;
  messages: Message[] = [];
  bird = { here: false, next: BIRD_FIRST, leaving: 0 };
  finished = false;
  private catalog: Catalog;
  private lastRegion: Region | null = null;
  /** The tunnel end the cat came in by (tunnel index, end index), until it reaches the other end. */
  private tunnelFrom: [number, number] | null = null;
  private tunnelSaid = -100;

  constructor(world: World, catalog: Catalog, fresh = false) {
    this.world = world;
    this.catalog = catalog;
    this.tasks = tasksFor(world);
    this.progress = fresh ? { done: [], toys: [], knocked: [], sniffed: [] } : readProgress(world.id);
    if (this.progress.finishedAt) this.progress = { done: [], toys: [], knocked: [], sniffed: [] };
    this.cat = newCat(world.start.p, world.start.heading, world);
    this.items = world.items.map((item) => ({ item, p: [...item.p], v: [0, 0, 0], spin: 0, angle: 0, state: 'rest', fromY: item.p[1] }));
    this.lastRegion = regionAt(world, this.cat.p);
  }

  get toysLeft() { return this.world.toys.filter((t) => !this.progress.toys.includes(t.id)); }
  count(id: TaskId): number {
    switch (id) {
      case 'knock': return this.progress.knocked.length;
      case 'toys': return this.progress.toys.length;
      case 'sniff': return this.progress.sniffed.length;
      default: return this.progress.done.includes(id) ? 1 : 0;
    }
  }
  isDone = (t: Task) => this.progress.done.includes(t.id);
  get doneCount() { return this.tasks.filter(this.isDone).length; }

  private say(text: string, tone: Message['tone'] = 'info', sound?: Message['sound']) { this.messages.push({ text, tone, sound }); }

  private complete(id: TaskId) {
    if (this.progress.done.includes(id)) return;
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return;
    this.progress.done.push(id);
    this.say(`✓ ${task.title}`, 'task', 'ding');
    if (this.tasks.every(this.isDone)) {
      this.progress.finishedAt = new Date().toISOString();
      this.finished = true;
    }
    this.save();
  }

  save() { writeProgress(this.world.id, this.progress); }

  /** Where the cat is, in words (for the status line and screen readers). */
  get whereabouts(): string {
    const s = this.world.surfaces.find((x) => x.id === this.cat.surfaceId);
    if (this.cat.leap) return 'Mid-leap';
    if (!s) return '';
    const h = s.kind === 'floor' ? '' : ` · ${this.cat.p[1] < 1 ? Math.round(this.cat.p[1] * 100) + ' cm' : this.cat.p[1].toFixed(1) + ' m'} up`;
    return `On ${s.label}${h}`;
  }

  /** The pose for the 3D view. */
  pose(): { pose: Pose; k: number } {
    if (this.cat.leap) return { pose: 'jump', k: Math.min(1, this.cat.leap.t / this.cat.leap.T) };
    if (this.busy) {
      const b = this.busy.kind;
      const pose: Pose = b === 'scratch' || b === 'sofa' ? 'scratch' : b === 'drink' || b === 'eat' ? 'drink' : b === 'sniff' ? 'sniff' : b === 'watch' ? 'lookout' : b === 'nap' ? 'sleep' : 'sit';
      return { pose, k: this.busy.t / this.busy.T };
    }
    if (!this.cat.ground) return { pose: 'jump', k: 0.5 };
    if (Math.hypot(this.cat.v[0], this.cat.v[1]) > 0.08) return { pose: 'walk', k: 0 };
    return { pose: this.idle > 9 ? 'loaf' : this.idle > 1.2 ? 'sit' : 'walk', k: 0 };
  }

  update(dt: number, input: MoveInput) {
    dt = Math.max(0, Math.min(dt, 0.05));
    this.time += dt;
    this.sneak = !!input.sneak;
    this.updateBird(dt);
    this.updateItems(dt);
    if (this.busy) {
      this.busy.t += dt;
      if (this.busy.t >= this.busy.T) this.finishBusy();
      this.target = null;
      this.action = null;
      return;
    }
    const moving = Math.hypot(input.move[0], input.move[1]) > 0.05;
    this.idle = moving || !this.cat.ground ? 0 : this.idle + dt;
    for (const e of step(this.world, this.cat, input, dt)) {
      if (e.type === 'land' && e.drop > 1.2) this.say('Thud. Landed on all four paws.', 'info', 'thud');
    }
    this.target = this.cat.ground && !this.cat.leap ? leapTarget(this.world, this.cat) : null;
    this.action = this.cat.ground && !this.cat.leap ? this.findAction() : null;
    this.checkPlace();
  }

  private checkPlace() {
    const c = this.cat;
    if (c.leap || !c.ground) return;
    const sid = c.surfaceId;
    if (sid && (sid === this.world.sillId || sid === 'sill-out')) this.complete('sill');
    const region = regionAt(this.world, c.p);
    if (region === 'catio' && this.lastRegion !== 'catio' && this.world.home) this.say('Out in the catio. Fresh air, and no way out.', 'good');
    if (region === 'catio') this.complete('catio');
    this.checkTunnel(region);
    this.lastRegion = region;
    if (this.world.catio.perchId && sid === this.world.catio.perchId) this.complete('perch');
    for (const t of this.world.toys) {
      if (this.progress.toys.includes(t.id)) continue;
      if (Math.hypot(t.p[0] - c.p[0], t.p[2] - c.p[2]) < 0.3 && Math.abs(t.p[1] - c.p[1]) < 0.25) {
        this.progress.toys.push(t.id);
        const left = this.world.toys.length - this.progress.toys.length;
        this.say(left ? `Found a toy mouse ${t.where}. ${left} to go.` : 'Found every toy mouse!', 'good', 'chirp');
        if (!left) this.complete('toys');
        this.save();
      }
    }
  }

  /** Running a tunnel: in at one end, out at the other. */
  private checkTunnel(region: Region | null) {
    const c = this.cat;
    const near = (q: Vec3) => Math.hypot(q[0] - c.p[0], q[2] - c.p[2]);
    if (region === 'tunnel' && this.lastRegion !== 'tunnel') {
      let best: [number, number] | null = null, bd = Infinity;
      this.world.tunnels.forEach((t, i) => t.ends.forEach((e, j) => { const d = near(e); if (d < bd) { bd = d; best = [i, j]; } }));
      if (best && bd < 1.2) this.tunnelFrom = best;
      if (this.time - this.tunnelSaid > 30) {
        this.tunnelSaid = this.time;
        this.say(this.lastRegion === 'catio' ? 'Back into the tunnel. Home is at the other end.' : 'Into the tunnel. Low, narrow, and all yours.', 'info');
      }
    }
    if (!this.tunnelFrom) return;
    const [i, j] = this.tunnelFrom;
    const t = this.world.tunnels[i];
    if (near(t.ends[1 - j]) < 0.6) {
      this.tunnelFrom = null;
      if (!this.progress.done.includes('tunnel')) this.say(`Ran all ${t.length.toFixed(1)} m of the tunnel.`, 'good');
      this.complete('tunnel');
    } else if (region !== 'tunnel' && near(t.ends[j]) < 1.2) this.tunnelFrom = null;
  }

  private lookout(): boolean {
    const c = this.cat;
    if (regionAt(this.world, c.p) !== 'catio') return false;
    return this.world.catio.elevated || c.p[1] >= this.world.catio.floor + 0.5;
  }

  private findAction(): Action | null {
    const c = this.cat;
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    let best: { a: Action; d: number } | null = null;
    for (const it of this.items) {
      if (it.state !== 'rest') continue;
      const dx = it.p[0] - c.p[0], dz = it.p[2] - c.p[2];
      const d = Math.hypot(dx, dz);
      if (d < 0.45 && Math.abs(it.p[1] - c.p[1]) < 0.12 && (d < 0.2 || (dx * fx + dz * fz) / d > -0.2)) {
        if (!best || d < best.d) best = { a: { kind: 'knock', item: it, label: `Knock ${it.item.label} off` }, d };
      }
    }
    if (best) return best.a;
    const watch = this.bird.here && this.lookout();
    // Until the bird has been watched once, watching it comes first.
    if (watch && !this.progress.done.includes('bird')) return { kind: 'watch', label: 'Watch the bird' };
    for (const s of this.world.spots) {
      // Naps happen on the bed or in the sunbeam itself; the rest can be reached from beside them.
      const dyMax = s.kind === 'nap' ? 0.06 : 0.25;
      const near = s.area ? inRect(s.area, c.p[0], c.p[2]) && Math.abs(c.p[1] - s.p[1]) < dyMax : Math.hypot(s.p[0] - c.p[0], s.p[2] - c.p[2]) < s.r && Math.abs(c.p[1] - s.p[1]) < dyMax;
      if (!near) continue;
      const d = Math.hypot(s.p[0] - c.p[0], s.p[2] - c.p[2]) + (s.area ? 0.5 : 0);
      const label = s.kind === 'scratch' ? `Scratch ${s.label}` : s.kind === 'sofa' ? 'Scratch the sofa' : s.kind === 'drink' ? 'Have a drink' : s.kind === 'eat' ? 'Have a snack' : s.kind === 'plant' ? `Sniff the ${s.label}` : `Nap ${s.sunny ? 'in the sun' : 'here'}`;
      if (!best || d < best.d) best = { a: { kind: 'spot', spot: s, label }, d };
    }
    return best?.a ?? (watch ? { kind: 'watch', label: 'Watch the bird' } : null);
  }

  /** The action key: knock, watch, scratch, drink, sniff or nap — whatever is here. */
  act() {
    const a = this.action;
    if (!a || this.busy) return;
    if (a.kind === 'knock') {
      const it = a.item;
      const fx = Math.sin(this.cat.heading), fz = Math.cos(this.cat.heading);
      let dx = it.p[0] - this.cat.p[0], dz = it.p[2] - this.cat.p[2];
      const d = Math.hypot(dx, dz) || 1;
      dx = dx / d * 0.5 + fx * 0.5; dz = dz / d * 0.5 + fz * 0.5;
      it.v = [dx * 2, 0.8, dz * 2];
      it.spin = 6 + Math.random() * 4;
      it.state = 'falling';
      it.fromY = it.p[1];
      this.busy = { kind: 'swipe', t: 0, T: 0.35 };
      return;
    }
    if (a.kind === 'watch') {
      const bp = this.world.catio.birdPerch;
      this.cat.heading = Math.atan2(bp[0] - this.cat.p[0], bp[2] - this.cat.p[2]);
      this.busy = { kind: 'watch', t: 0, T: 3 };
      return;
    }
    const s = a.spot;
    const T = s.kind === 'nap' ? 3.5 : s.kind === 'plant' ? 1.4 : 1.8;
    const kind: Busy['kind'] = s.kind === 'plant' ? 'sniff' : s.kind;
    this.busy = { kind, t: 0, T, spot: s };
    if (s.kind === 'nap') this.say('Zzz…', 'info', 'purr');
    if (s.kind === 'scratch' || s.kind === 'sofa') this.cat.heading = Math.atan2(s.p[0] - this.cat.p[0], s.p[2] - this.cat.p[2]);
  }

  meow() {
    if (this.busy && this.busy.kind !== 'swipe') return;
    this.meowAt = this.time;
    this.say('Meow!', 'info', 'meow');
    if (this.bird.here) {
      const bp = this.world.catio.birdPerch;
      if (Math.hypot(bp[0] - this.cat.p[0], bp[2] - this.cat.p[2]) < 7) {
        this.bird.here = false;
        this.bird.leaving = 1;
        this.bird.next = this.time + 20;
        this.say('The bird flew off. Next time, watch quietly.', 'warn');
      }
    }
  }

  private finishBusy() {
    const b = this.busy!;
    this.busy = null;
    switch (b.kind) {
      case 'scratch': this.say('Scritch scritch. Claws sharp.', 'good'); this.complete('scratch'); break;
      case 'sofa': this.say('Not the sofa! That’s what the scratching post is for.', 'warn'); break;
      case 'drink': this.say('Lap lap lap. Fresh water.', 'good'); this.complete('drink'); break;
      case 'eat': this.say('Crunch. A snack between adventures.', 'good'); break;
      case 'watch':
        if (this.bird.here) { this.say('Chattered at the bird through the mesh. It never knew.', 'good'); this.complete('bird'); }
        break;
      case 'sniff': {
        const s = b.spot!;
        for (const id of s.plantIds ?? []) {
          const plant = this.catalog.plant(id);
          if (plant) this.say(`${plant.name}: ${SAFETY[plant.catSafety] ?? 'safety unknown'}.`, plant.catSafety === 'known-hazard' ? 'warn' : 'info');
        }
        if (!this.progress.sniffed.includes(s.id)) this.progress.sniffed.push(s.id);
        const goal = this.tasks.find((t) => t.id === 'sniff')?.goal ?? 1;
        if (this.progress.sniffed.length >= goal) this.complete('sniff');
        this.save();
        break;
      }
      case 'nap': {
        const s = b.spot!;
        const anySunny = this.world.spots.some((x) => x.kind === 'nap' && x.sunny);
        if (s.sunny || !anySunny) this.complete('nap');
        else this.say('A nice nap, but a sunbeam would be warmer.', 'info');
        break;
      }
    }
  }

  private updateItems(dt: number) {
    for (const it of this.items) {
      if (it.state !== 'falling') continue;
      const before = it.p[1];
      it.v[1] -= 9.8 * dt;
      const nx = it.p[0] + it.v[0] * dt, nz = it.p[2] + it.v[2] * dt;
      const inside = this.world.volumes.some((v) => insideXZ(v.poly, nx, nz));
      if (inside) { it.p[0] = nx; it.p[2] = nz; } else { it.v[0] = 0; it.v[2] = 0; }
      it.p[1] += it.v[1] * dt;
      it.angle += it.spin * dt;
      const g = groundAt(this.world, it.p[0], it.p[2], before + 0.01);
      if (g.surface && it.p[1] <= g.y && it.v[1] <= 0) {
        it.p[1] = g.y;
        const drop = it.fromY - g.y;
        const sliding = Math.hypot(it.v[0], it.v[2]);
        if (drop <= 0.25 && sliding > 0.15) {
          // Still on the same top: slide (and maybe over the edge).
          const f = Math.max(0, 1 - (2.5 * dt) / sliding);
          it.v = [it.v[0] * f, 0, it.v[2] * f];
          continue;
        }
        if (drop > 0.25) {
          it.state = 'down';
          it.angle = Math.PI / 2;
          if (!this.progress.knocked.includes(it.item.id)) this.progress.knocked.push(it.item.id);
          const goal = this.tasks.find((t) => t.id === 'knock')?.goal ?? 3;
          this.say(`Crash! ${cap(it.item.label)} is on the floor.`, 'good', 'crash');
          if (this.progress.knocked.length >= goal) this.complete('knock');
          this.save();
        } else { it.state = 'rest'; it.angle = 0; it.v = [0, 0, 0]; }
      }
    }
  }

  private updateBird(dt: number) {
    if (this.bird.leaving > 0) this.bird.leaving = Math.max(0, this.bird.leaving - dt);
    if (!this.bird.here && this.time >= this.bird.next) {
      this.bird.here = true;
      this.bird.next = this.time + BIRD_STAY;
      this.say('A bird landed just outside the catio.', 'info', 'chirp');
    } else if (this.bird.here && this.time >= this.bird.next && !(this.busy?.kind === 'watch')) {
      this.bird.here = false;
      this.bird.leaving = 1;
      this.bird.next = this.time + BIRD_AWAY;
    }
  }

  /** Camera-relative movement → world movement (camera yaw: direction the camera looks along, in the XZ plane). */
  static relative(stick: Vec2, camYaw: number): Vec2 {
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = -fz, rz = fx;
    return [stick[1] * fx + stick[0] * rx, stick[1] * fz + stick[0] * rz];
  }

  restart() {
    this.progress = { done: [], toys: [], knocked: [], sniffed: [] };
    this.save();
  }

  static height = HEAD;
}

function insideXZ(poly: Vec2[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
