// The editing session (runes compiled by the svelte plugin): history, attach, confirm, acknowledge.
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/io/storage', () => ({ saveProject: vi.fn(async () => {}) }));
import { Editor } from '../src/lib/ui/editor.svelte';
import { cat, sampleCase } from './helpers';
import { newProject } from '../src/lib/site/templates';

describe('Editor', () => {
  let e: Editor;
  beforeEach(() => { e = new Editor(newProject({ template: 'blank', units: 'imperial' }, cat)); });

  it('adds an attached structure centred on the nearest window, with undo/redo', () => {
    const s = e.addStructure('lean-to', [2.5, 1]);
    const wall = e.project.site.walls[0];
    expect(s.hostWallId).toBe(wall.id);
    expect(s.hostOpeningId).toBe(wall.openings.find((o) => o.kind === 'window')!.id);
    expect(e.project.structures).toHaveLength(1);
    expect(e.assembly.parts.length).toBeGreaterThan(30);
    e.undo();
    expect(e.project.structures).toHaveLength(0);
    e.redo();
    expect(e.project.structures).toHaveLength(1);
  });

  it('confirming dimensions clears CAT-DIM-001 and resizing brings it back', () => {
    const s = e.addStructure('freestanding', [3, 4]);
    expect(e.blockers.map((f) => f.ruleId)).toContain('CAT-DIM-001');
    e.confirmDimensions(s.id);
    expect(e.blockers.map((f) => f.ruleId)).not.toContain('CAT-DIM-001');
    expect(e.buildReady).toBe(true);
    e.updateStructure(s.id, { width: 3 });
    expect(e.blockers.map((f) => f.ruleId)).toContain('CAT-DIM-001');
  });

  it('a drag is one undo step', () => {
    const s = e.addStructure('freestanding', [3, 4]);
    const start = e.project;
    e.moveStructure(s.id, start, [0.5, 0]);
    e.moveStructure(s.id, start, [1, 0]);
    e.endDrag();
    expect(e.project.structures[0].x).toBeCloseTo(s.x + 1, 9);
    e.undo();
    expect(e.project.structures[0].x).toBeCloseTo(s.x, 9);
  });

  it('acknowledges a warning with a note', () => {
    const ed = new Editor(sampleCase('lean-to-window'));
    ed.setClimate({ wind: 'high' });
    const f = ed.findings.find((x) => x.ruleId === 'CAT-WX-004')!;
    ed.acknowledge(f, 'Sheltered courtyard');
    expect(ed.findings.find((x) => x.id === f.id)!.status).toBe('acknowledged');
    ed.unacknowledge(ed.findings.find((x) => x.id === f.id)!);
    expect(ed.findings.find((x) => x.id === f.id)!.status).toBe('open');
  });

  it('read-only sessions ignore edits', () => {
    const ed = new Editor(sampleCase('window-box'), { readonly: true });
    ed.rename('x');
    ed.addCat();
    expect(ed.project.name).toBe('Window box');
    expect(ed.project.cats).toHaveLength(1);
  });

  it('removing a furnishing removes plants in it', () => {
    const ed = new Editor(sampleCase('lean-to-window'));
    const s = ed.project.structures[0];
    const planter = s.furnishings.find((f) => f.componentId === 'planter-large')!;
    ed.selection = { kind: 'furnishing', id: planter.id, structureId: s.id };
    ed.removeSelected();
    expect(ed.project.plants.every((p) => p.furnishingId !== planter.id)).toBe(true);
  });
});
