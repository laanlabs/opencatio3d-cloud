// One Catio Quest session: the scenario, the layout being built (a production Project), selection,
// undo, and the live generator/check results the build screen shows (cost, open issues). "Let them
// explore" freezes an evaluation (simulation + scores) that the explore and results screens share.
import { catalog } from '../catalog/catalog';
import type { Furnishing, Project, StructureOpening } from '../model/types';
import { generate, type Assembly } from '../generate/assembly';
import { runChecks, type Finding } from '../analysis/checks';
import { applyPiece, mainStructure, removeItem, setSize, updateFurnishing, updateOpening, type SizeField } from './design';
import { evaluate, withHousehold } from './evaluate';
import { gameCost, gameFindings } from './score';
import type { Piece } from './pieces';
import type { Scenario } from './types';
import { clearDraft, readDraft, writeDraft } from './progress';
import { track } from '../analytics';

export type Stage = 'intro' | 'build' | 'explore' | 'results';

export class QuestGame {
  readonly sc: Scenario = null as unknown as Scenario;
  layout = $state.raw<Project>(null as unknown as Project);
  stage = $state<Stage>('intro');
  selected = $state<string | null>(null);
  note = $state<{ text: string; id: number } | null>(null);
  evaluation = $state.raw<ReturnType<typeof evaluate> | null>(null);
  attempts = $state(0);
  private history: Project[] = [];
  undoCount = $state(0);

  assembly = $derived<Assembly>(generate(withHousehold(this.layout, this.sc), catalog));
  findings = $derived<Finding[]>(runChecks(withHousehold(this.layout, this.sc), catalog, this.assembly));
  issues = $derived(gameFindings(this.findings).filter((f) => f.severity === 'blocker' || f.severity === 'warning'));
  cost = $derived(gameCost(this.assembly));
  structure = $derived(mainStructure(this.layout));

  constructor(sc: Scenario) {
    this.sc = sc;
    const draft = readDraft(sc.id);
    this.layout = draft ?? sc.start();
    if (draft) this.stage = 'build';
  }

  private lastKey = '';
  private lastAt = 0;

  /** Records an edit. Rapid edits to the same thing (a slider drag) merge into one undo step. */
  private commit(next: Project, note?: string, mergeKey = '') {
    if (next !== this.layout) {
      const now = Date.now();
      const merge = mergeKey && mergeKey === this.lastKey && now - this.lastAt < 900;
      this.lastKey = mergeKey;
      this.lastAt = now;
      if (!merge) this.history.push(this.layout);
      if (this.history.length > 80) this.history.shift();
      this.undoCount = this.history.length;
      this.layout = next;
      writeDraft(this.sc.id, next);
      this.evaluation = null;
    }
    if (note) this.say(note);
  }

  say(text: string) { this.note = { text, id: (this.note?.id ?? 0) + 1 }; }

  apply(pc: Piece): string | undefined {
    const before = this.layout;
    const r = applyPiece(before, pc, catalog, undefined, this.sc.templates);
    this.commit(r.project, r.note ?? (r.project !== before ? `${pc.icon} ${pc.name} added.` : undefined));
    if (r.selectId) this.selected = r.selectId;
    return r.project !== before ? r.selectId ?? '' : undefined;
  }

  moveFurnishing(id: string, patch: Partial<Furnishing>) {
    const r = updateFurnishing(this.layout, id, patch, catalog);
    this.commit(r.project, r.note, `f:${id}`);
  }

  setOpening(id: string, patch: Partial<StructureOpening>) { this.commit(updateOpening(this.layout, id, patch), undefined, `o:${id}`); }
  remove(id: string) { this.commit(removeItem(this.layout, id)); if (this.selected === id) this.selected = null; }
  resize(field: SizeField, v: number) { this.commit(setSize(this.layout, field, v, catalog), undefined, `size:${field}`); }

  undo() {
    const prev = this.history.pop();
    if (!prev) return;
    this.layout = prev;
    this.undoCount = this.history.length;
    this.evaluation = null;
    writeDraft(this.sc.id, prev);
  }

  restart() {
    this.history = [];
    this.undoCount = 0;
    this.layout = this.sc.start();
    this.selected = null;
    this.evaluation = null;
    clearDraft(this.sc.id);
    this.stage = 'build';
  }

  explore() {
    this.evaluation = evaluate(this.sc, this.layout, catalog);
    this.attempts++;
    this.stage = 'explore';
    track('quest_explore', { scenario: this.sc.daily ? 'daily' : this.sc.id });
  }

  furnishing(id: string | null) { return id ? this.structure?.furnishings.find((f) => f.id === id) : undefined; }
  opening(id: string | null) { return id ? this.structure?.openings.find((o) => o.id === id) : undefined; }
}
