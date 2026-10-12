// Editing session for one project: selection, workspaces, undo/redo, autosave, and the derived
// assembly (parts, BOM, cut list, cost) and findings. Every edit is an immutable spread through
// `edit()`, so the 3D view and derived outputs rebuild only what changed by identity.
import type { Acknowledgement, Cat, Furnishing, HostWall, Project, SiteObstacle, Structure, StructureOpening, TemplateId, Vec2, ViewMode, WallOpening, Workspace } from '../model/types';
import { clone, snapshotOf, uid } from '../model/types';
import { catalog as defaultCatalog, type Catalog } from '../catalog/catalog';
import { generate, type Assembly } from '../generate/assembly';
import { activeBlockers, runChecks, type Finding } from '../analysis/checks';
import { saveProject } from '../io/storage';
import { fieldValue, keyFields, measurementsFor, newCat, newStructure, attachToWall } from '../site/templates';
import { gridStep } from '../model/units';

export type SelKind = 'structure' | 'opening' | 'furnishing' | 'wall' | 'wall-opening' | 'obstacle' | 'plant';
export type Selection = { kind: SelKind; id: string; structureId?: string; wallId?: string } | null;

/** Autosave delay after the last edit (ms). Drags, tab switches and unloads flush immediately. */
export const SAVE_DEBOUNCE_MS = 150;

const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

export class Editor {
  project = $state.raw<Project>(null as unknown as Project);
  readonly cat: Catalog = defaultCatalog;
  selection = $state<Selection>(null);
  workspace = $state<Workspace>('structure');
  view = $state<ViewMode>('split');
  saveState = $state<'saved' | 'saving' | 'error'>('saved');
  toast = $state<{ text: string; id: number } | null>(null);
  /** Plan tool: 'select' or placing a structure/obstacle/wall. */
  placing = $state<{ kind: 'structure'; template: TemplateId } | { kind: 'obstacle'; obstacle: SiteObstacle['kind'] } | { kind: 'wall' } | null>(null);
  readonly = false;

  private undoStack: Project[] = [];
  private redoStack: Project[] = [];
  undoCount = $state(0);
  redoCount = $state(0);
  private dragSnapshot: Project | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  assembly = $derived<Assembly>(generate(this.project, this.cat));
  findings = $derived<Finding[]>(runChecks(this.project, this.cat, this.assembly));
  blockers = $derived(activeBlockers(this.findings));
  /** A build package is available: no open blockers. */
  buildReady = $derived(this.blockers.length === 0 && this.project.structures.length > 0);

  constructor(p: Project, opts: { readonly?: boolean; catalog?: Catalog } = {}) {
    this.project = $state.snapshot(p) as Project;
    this.cat = opts.catalog ?? defaultCatalog;
    this.readonly = !!opts.readonly;
    this.workspace = (p.web?.workspace as Workspace) ?? (p.structures.length ? 'structure' : 'site');
    if (p.web?.view) this.view = p.web.view;
  }

  get units() { return this.project.units; }
  get step() { return gridStep(this.units); }

  // ---------- history ----------

  edit(change: (p: Project) => Project, notice?: string) {
    if (this.readonly) return;
    const before = this.project;
    const after = change(before);
    if (after === before) return;
    this.commit(before, { ...after, updatedAt: new Date().toISOString() });
    if (notice) this.notify(notice);
  }

  private commit(before: Project, after: Project) {
    this.undoStack.push(before);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.project = after;
    this.syncCounts();
    this.scheduleSave();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.project);
    this.project = { ...prev, web: this.project.web };
    this.fixSelection();
    this.syncCounts();
    this.scheduleSave();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.project);
    this.project = { ...next, web: this.project.web };
    this.fixSelection();
    this.syncCounts();
    this.scheduleSave();
  }

  private syncCounts() { this.undoCount = this.undoStack.length; this.redoCount = this.redoStack.length; }

  private fixSelection() {
    const s = this.selection;
    if (s && !this.find(s)) this.selection = null;
  }

  /** The selected thing, if it still exists. */
  find(s: NonNullable<Selection>): unknown {
    const p = this.project;
    switch (s.kind) {
      case 'structure': return p.structures.find((x) => x.id === s.id);
      case 'opening': return p.structures.find((x) => x.id === s.structureId)?.openings.find((o) => o.id === s.id);
      case 'furnishing': return p.structures.find((x) => x.id === s.structureId)?.furnishings.find((f) => f.id === s.id);
      case 'wall': return p.site.walls.find((w) => w.id === s.id);
      case 'wall-opening': return p.site.walls.find((w) => w.id === s.wallId)?.openings.find((o) => o.id === s.id);
      case 'obstacle': return p.site.obstacles.find((o) => o.id === s.id);
      case 'plant': return p.plants.find((x) => x.id === s.id);
    }
  }

  private scheduleSave() {
    if (this.readonly) return;
    this.saveState = 'saving';
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.save(), SAVE_DEBOUNCE_MS);
  }

  private async save() {
    const p = this.project;
    try { await saveProject(p); if (this.project === p) this.saveState = 'saved'; }
    catch (e) { console.error(e); this.saveState = 'error'; }
  }

  async flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    if (this.readonly) return;
    await this.save();
  }

  notify(text: string) {
    const id = Date.now();
    this.toast = { text, id };
    setTimeout(() => { if (this.toast?.id === id) this.toast = null; }, 3200);
  }

  /** Begin/continue a live drag; `endDrag` commits it as one undo step. */
  live(change: (p: Project) => Project) {
    if (this.readonly) return;
    if (!this.dragSnapshot) this.dragSnapshot = this.project;
    this.project = change(this.project);
  }
  endDrag() {
    const before = this.dragSnapshot;
    this.dragSnapshot = null;
    if (!before || before === this.project) return;
    this.commit(before, { ...this.project, updatedAt: new Date().toISOString() });
    void this.flush();
  }
  get dragging() { return !!this.dragSnapshot; }

  // ---------- view state (saved, not undoable) ----------

  setWorkspace(w: Workspace) {
    this.workspace = w;
    this.setWeb({ workspace: w });
  }
  setView(v: ViewMode) {
    this.view = v;
    this.setWeb({ view: v });
  }
  private setWeb(patch: Record<string, unknown>) {
    if (this.readonly) return;
    this.project = { ...this.project, web: { ...this.project.web, ...patch } };
    this.scheduleSave();
  }
  setHint(id: string, dismissed: boolean) { this.setWeb({ hints: { ...(this.project.web.hints ?? {}), [id]: dismissed } }); }
  hint(id: string) { return !!this.project.web.hints?.[id]; }

  // ---------- project ----------

  rename(name: string) { this.edit((p) => ({ ...p, name })); }
  setUnits(units: Project['units']) { this.edit((p) => ({ ...p, units })); }
  setRegion(patch: Partial<NonNullable<Project['region']>>) {
    this.edit((p) => ({ ...p, region: { country: 'US', ...(p.region ?? {}), ...patch } }));
  }
  setClimate(patch: Partial<NonNullable<NonNullable<Project['region']>['climate']>>) {
    this.edit((p) => {
      const r = p.region ?? { country: 'US' };
      const c = r.climate ?? { snowLoad: 'none' as const, wind: 'normal' as const, hot: false, rainy: false };
      return { ...p, region: { ...r, climate: { ...c, ...patch } } };
    });
  }
  setSite(patch: Partial<Project['site']>) { this.edit((p) => ({ ...p, site: { ...p.site, ...patch } })); }
  setAssumptions(patch: Partial<Project['assumptions']>) { this.edit((p) => ({ ...p, assumptions: { ...p.assumptions, ...patch } })); }

  // ---------- structures ----------

  get selectedStructure(): Structure | undefined {
    const s = this.selection;
    if (!s) return undefined;
    const id = s.kind === 'structure' ? s.id : s.structureId;
    return this.project.structures.find((x) => x.id === id);
  }

  /** The structure the workspace panels edit: the selected one, else the first. */
  get current(): Structure | undefined {
    return this.selectedStructure ?? this.project.structures[0];
  }

  /** Adds a structure from a template at `at` (plan), attaching it to the nearest house wall when the template is attached. */
  addStructure(template: TemplateId, at?: Vec2) {
    const t = this.cat.template(template);
    const wall = t?.attached ? this.nearestWall(at) : undefined;
    const opening = wall ? this.nearestWindow(wall, at) : undefined;
    const s = newStructure(template, this.cat, wall ? { wall, opening } : { x: at?.[0] ?? 1, y: at?.[1] ?? 2 });
    if (!wall && at) { s.x = at[0] - (template === 'tunnel' ? 0 : s.width / 2); s.y = at[1] - (template === 'tunnel' ? 0 : s.depth / 2); }
    const n = this.project.structures.filter((x) => x.template === template).length;
    if (n) s.name = `${s.name} ${n + 1}`;
    this.edit((p) => ({ ...p, structures: [...p.structures, s], site: { ...p.site, measurements: [...p.site.measurements, ...measurementsFor(s)] } }), `${t?.name ?? 'Structure'} added`);
    this.selection = { kind: 'structure', id: s.id };
    this.placing = null;
    return s;
  }

  private nearestWall(at?: Vec2): HostWall | undefined {
    const walls = this.project.site.walls;
    if (!at || walls.length < 2) return walls[0];
    let best = walls[0], bd = Infinity;
    for (const w of walls) {
      const d = Math.hypot(at[0] - (w.a[0] + w.b[0]) / 2, at[1] - (w.a[1] + w.b[1]) / 2);
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  }
  private nearestWindow(w: HostWall, at?: Vec2): WallOpening | undefined {
    const wins = w.openings.filter((o) => o.kind === 'window');
    if (!wins.length) return undefined;
    if (!at) return wins[0];
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
    const t = ((at[0] - w.a[0]) * (w.b[0] - w.a[0]) + (at[1] - w.a[1]) * (w.b[1] - w.a[1])) / L;
    return wins.reduce((a, b) => (Math.abs(a.offset + a.width / 2 - t) <= Math.abs(b.offset + b.width / 2 - t) ? a : b));
  }

  updateStructure(id: string, patch: Partial<Structure>) {
    this.edit((p) => ({ ...p, structures: p.structures.map((s) => (s.id === id ? clean({ ...s, ...patch }) : s)) }));
  }

  /** Re-seats an attached structure on its wall (after the wall or the structure width moved). */
  reattach(id: string, wallId?: string, openingId?: string) {
    this.edit((p) => {
      const s0 = p.structures.find((x) => x.id === id);
      const wall = p.site.walls.find((w) => w.id === (wallId ?? s0?.hostWallId));
      if (!s0 || !wall) return p;
      const s = clone(s0);
      attachToWall(s, wall, wall.openings.find((o) => o.id === (openingId ?? s0.hostOpeningId)));
      return { ...p, structures: p.structures.map((x) => (x.id === id ? s : x)) };
    });
  }

  moveStructure(id: string, start: Project, delta: Vec2) {
    this.live(() => ({ ...start, structures: start.structures.map((s) => (s.id === id ? { ...s, x: s.x + delta[0], y: s.y + delta[1] } : s)) }));
  }

  // ---------- openings & furnishings ----------

  addOpening(structureId: string, o: Omit<StructureOpening, 'id'>) {
    const op = { ...o, id: uid() } as StructureOpening;
    this.edit((p) => ({ ...p, structures: p.structures.map((s) => (s.id === structureId ? { ...s, openings: [...s.openings, op] } : s)) }));
    this.selection = { kind: 'opening', id: op.id, structureId };
  }
  updateOpening(structureId: string, id: string, patch: Partial<StructureOpening>) {
    this.edit((p) => ({ ...p, structures: p.structures.map((s) => (s.id === structureId ? { ...s, openings: s.openings.map((o) => (o.id === id ? clean({ ...o, ...patch }) : o)) } : s)) }));
  }
  addFurnishing(structureId: string, f: Omit<Furnishing, 'id'>) {
    const fu = { ...f, id: uid() } as Furnishing;
    this.edit((p) => ({ ...p, structures: p.structures.map((s) => (s.id === structureId ? { ...s, furnishings: [...s.furnishings, fu] } : s)) }));
    this.selection = { kind: 'furnishing', id: fu.id, structureId };
    return fu;
  }
  updateFurnishing(structureId: string, id: string, patch: Partial<Furnishing>) {
    this.edit((p) => ({ ...p, structures: p.structures.map((s) => (s.id === structureId ? { ...s, furnishings: s.furnishings.map((f) => (f.id === id ? clean({ ...f, ...patch }) : f)) } : s)) }));
  }

  // ---------- site ----------

  addWall(a: Vec2, b: Vec2) {
    const w: HostWall = { id: uid(), a, b, height: 2.7, openings: [] };
    this.edit((p) => ({ ...p, site: { ...p.site, walls: [...p.site.walls, w] } }), 'House wall added');
    this.selection = { kind: 'wall', id: w.id };
  }
  updateWall(id: string, patch: Partial<HostWall>) {
    this.edit((p) => ({ ...p, site: { ...p.site, walls: p.site.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)) } }));
  }
  addWallOpening(wallId: string, o: Omit<WallOpening, 'id'>) {
    const op = { ...o, id: uid() } as WallOpening;
    this.edit((p) => ({ ...p, site: { ...p.site, walls: p.site.walls.map((w) => (w.id === wallId ? { ...w, openings: [...w.openings, op] } : w)) } }));
    this.selection = { kind: 'wall-opening', id: op.id, wallId };
  }
  updateWallOpening(wallId: string, id: string, patch: Partial<WallOpening>) {
    this.edit((p) => ({ ...p, site: { ...p.site, walls: p.site.walls.map((w) => (w.id === wallId ? { ...w, openings: w.openings.map((o) => (o.id === id ? clean({ ...o, ...patch }) : o)) } : w)) } }));
  }
  addObstacle(kind: SiteObstacle['kind'], at: Vec2) {
    const size = kind === 'tree' ? 1.2 : kind === 'ac-unit' ? 0.9 : kind === 'hose-bib' ? 0.2 : 1;
    const o: SiteObstacle = { id: uid(), kind, x: at[0], y: at[1], width: size, depth: size, rotation: 0, height: kind === 'tree' ? 4 : 1 };
    this.edit((p) => ({ ...p, site: { ...p.site, obstacles: [...p.site.obstacles, o] } }));
    this.selection = { kind: 'obstacle', id: o.id };
    this.placing = null;
  }
  updateObstacle(id: string, patch: Partial<SiteObstacle>) {
    this.edit((p) => ({ ...p, site: { ...p.site, obstacles: p.site.obstacles.map((o) => (o.id === id ? { ...o, ...patch } : o)) } }));
  }
  moveObstacle(id: string, start: Project, delta: Vec2) {
    this.live(() => ({ ...start, site: { ...start.site, obstacles: start.site.obstacles.map((o) => (o.id === id ? { ...o, x: o.x + delta[0], y: o.y + delta[1] } : o)) } }));
  }

  // ---------- measurements ----------

  /** Marks a structure's key dimensions as measured and confirmed at their current values. */
  confirmDimensions(structureId: string, source: 'tape' | 'ar' | 'lidar' = 'tape') {
    this.edit((p) => {
      const s = p.structures.find((x) => x.id === structureId);
      if (!s) return p;
      const others = p.site.measurements.filter((m) => m.targetId !== structureId);
      const mine = keyFields(s).map((field) => ({ ...(p.site.measurements.find((m) => m.targetId === structureId && m.field === field) ?? { id: uid(), targetId: structureId, field }), value: fieldValue(s, field), source, confirmed: true }));
      return { ...p, site: { ...p.site, measurements: [...others, ...mine] } };
    }, 'Dimensions confirmed');
  }
  unconfirmDimensions(structureId: string) {
    this.edit((p) => ({ ...p, site: { ...p.site, measurements: p.site.measurements.map((m) => (m.targetId === structureId ? { ...m, confirmed: false } : m)) } }));
  }

  // ---------- cats & plants ----------

  addCat(patch: Partial<Cat> = {}) {
    const c = newCat(`Cat ${this.project.cats.length + 1}`, patch);
    this.edit((p) => ({ ...p, cats: [...p.cats, c] }));
    return c;
  }
  updateCat(id: string, patch: Partial<Cat>) { this.edit((p) => ({ ...p, cats: p.cats.map((c) => (c.id === id ? { ...c, ...patch } : c)) })); }
  removeCat(id: string) { this.edit((p) => ({ ...p, cats: p.cats.filter((c) => c.id !== id) })); }

  addPlant(plantId: string, structureId?: string, furnishingId?: string) {
    const pl = { id: uid(), plantId, ...(structureId ? { structureId } : {}), ...(furnishingId ? { furnishingId } : {}) };
    this.edit((p) => ({ ...p, plants: [...p.plants, pl] }), `${this.cat.plant(plantId)?.name ?? 'Plant'} added`);
  }
  removePlant(id: string) { this.edit((p) => ({ ...p, plants: p.plants.filter((x) => x.id !== id) })); }

  // ---------- findings ----------

  acknowledge(f: Finding, note: string, kind: Acknowledgement['kind'] = 'acknowledge', by?: string) {
    const targetId = f.targetIds[0] ?? '';
    this.edit((p) => ({ ...p, overrides: [...p.overrides.filter((o) => !(o.ruleId === f.ruleId && o.targetId === targetId)), clean({ ruleId: f.ruleId, targetId, kind, note, by, at: new Date().toISOString() })] }), kind === 'professional-review' ? 'Professional review recorded' : 'Acknowledged');
  }
  unacknowledge(f: Finding) {
    const targetId = f.targetIds[0] ?? '';
    this.edit((p) => ({ ...p, overrides: p.overrides.filter((o) => !(o.ruleId === f.ruleId && o.targetId === targetId)) }));
  }

  /** Selects what a finding is about. */
  selectTarget(f: Finding) {
    const p = this.project;
    for (const id of f.targetIds) {
      if (p.structures.some((s) => s.id === id)) { this.selection = { kind: 'structure', id }; return; }
      for (const s of p.structures) {
        if (s.openings.some((o) => o.id === id)) { this.selection = { kind: 'opening', id, structureId: s.id }; return; }
        if (s.furnishings.some((x) => x.id === id)) { this.selection = { kind: 'furnishing', id, structureId: s.id }; return; }
      }
      if (p.site.obstacles.some((o) => o.id === id)) { this.selection = { kind: 'obstacle', id }; return; }
      for (const w of p.site.walls) if (w.openings.some((o) => o.id === id)) { this.selection = { kind: 'wall-opening', id, wallId: w.id }; return; }
    }
  }

  // ---------- selection actions ----------

  removeSelected() {
    const s = this.selection;
    if (!s) return;
    this.edit((p) => {
      switch (s.kind) {
        case 'structure': return { ...p, structures: p.structures.filter((x) => x.id !== s.id), plants: p.plants.filter((x) => x.structureId !== s.id), site: { ...p.site, measurements: p.site.measurements.filter((m) => m.targetId !== s.id) } };
        case 'opening': return { ...p, structures: p.structures.map((x) => (x.id === s.structureId ? { ...x, openings: x.openings.filter((o) => o.id !== s.id) } : x)) };
        case 'furnishing': return { ...p, structures: p.structures.map((x) => (x.id === s.structureId ? { ...x, furnishings: x.furnishings.filter((f) => f.id !== s.id) } : x)), plants: p.plants.filter((x) => x.furnishingId !== s.id) };
        case 'wall': return { ...p, site: { ...p.site, walls: p.site.walls.filter((w) => w.id !== s.id) } };
        case 'wall-opening': return { ...p, site: { ...p.site, walls: p.site.walls.map((w) => (w.id === s.wallId ? { ...w, openings: w.openings.filter((o) => o.id !== s.id) } : w)) } };
        case 'obstacle': return { ...p, site: { ...p.site, obstacles: p.site.obstacles.filter((o) => o.id !== s.id) } };
        case 'plant': return { ...p, plants: p.plants.filter((x) => x.id !== s.id) };
      }
    }, 'Deleted');
    this.selection = null;
  }

  duplicateSelected() {
    const s = this.selectedStructure;
    if (!s || this.selection?.kind !== 'structure') return;
    const copy: Structure = { ...clone(s), id: uid(), name: `${s.name} copy`, x: s.x + 0.5, y: s.y + 0.5, hostWallId: undefined, hostOpeningId: undefined };
    copy.openings = copy.openings.map((o) => ({ ...o, id: uid() }));
    copy.furnishings = copy.furnishings.map((f) => ({ ...f, id: uid() }));
    this.edit((p) => ({ ...p, structures: [...p.structures, clean(copy)], site: { ...p.site, measurements: [...p.site.measurements, ...measurementsFor(copy)] } }));
    this.selection = { kind: 'structure', id: copy.id };
  }

  rotateSelected(by = 15) {
    const s = this.selectedStructure;
    if (s && this.selection?.kind === 'structure') this.updateStructure(s.id, { rotation: (((s.rotation + by) % 360) + 360) % 360, hostWallId: undefined });
  }

  // ---------- alternatives ----------

  saveAlternative(name: string) {
    const alt = { id: uid(), name: name || `Option ${String.fromCharCode(65 + this.project.alternatives.length)}`, createdAt: new Date().toISOString(), snapshot: snapshotOf(this.project) };
    this.edit((p) => ({ ...p, alternatives: [...p.alternatives, alt] }), `Saved “${alt.name}” as a design option`);
  }
  restoreAlternative(id: string) {
    const alt = this.project.alternatives.find((a) => a.id === id);
    if (!alt) return;
    this.edit((p) => ({ ...p, ...clone(alt.snapshot) }), `Restored “${alt.name}” — undo to go back`);
    this.selection = null;
  }
  deleteAlternative(id: string) { this.edit((p) => ({ ...p, alternatives: p.alternatives.filter((a) => a.id !== id) })); }
}
