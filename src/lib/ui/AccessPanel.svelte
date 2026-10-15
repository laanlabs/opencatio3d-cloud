<script lang="ts">
  // Access workspace: human doors, cat doors, window inserts, cleaning hatches and vestibules on the
  // selected structure. Anything that does not fit its wall is left out of the build (CAT-BLD-006).
  import type { Editor } from './editor.svelte';
  import type { Latch, OpeningKind, Side, StructureOpening } from '../model/types';
  import { frontHeight } from '../model/types';
  import LengthInput from './LengthInput.svelte';
  import { layoutFor, sideLength } from '../generate/structure';
  import { distToSegment, toPlan, wallDir } from '../model/geometry';

  let { editor }: { editor: Editor } = $props();
  const s = $derived(editor.current);
  const info = $derived(s ? editor.assembly.structures.find((x) => x.id === s.id) : undefined);
  const NAMES: Record<OpeningKind, string> = { 'human-door': 'Human door', 'cat-door': 'Cat door', 'window-access': 'Window insert', 'cleaning-hatch': 'Cleaning hatch', vestibule: 'Vestibule' };
  const LATCHES: { id: Latch | ''; name: string }[] = [{ id: 'hasp', name: 'Hasp (padlockable)' }, { id: 'slide-bolt', name: 'Slide bolt' }, { id: 'keyed', name: 'Keyed latch' }, { id: 'gravity', name: 'Gravity latch' }, { id: '', name: 'No latch' }];

  /** Sill of the house window within 0.35 m of a tunnel's start, where its window insert goes (0: none). */
  function startWindowSill(st: NonNullable<typeof s>): number {
    const p0 = st.path?.[0];
    if (!p0) return 0;
    const E = toPlan(st, p0[0], p0[1]);
    for (const w of editor.project.site.walls) {
      const d = wallDir(w);
      for (const o of w.openings) {
        if (o.kind !== 'window') continue;
        const a: [number, number] = [w.a[0] + d[0] * o.offset, w.a[1] + d[1] * o.offset];
        if (distToSegment(E, a, [a[0] + d[0] * o.width, a[1] + d[1] * o.width]) <= 0.35) return o.sill;
      }
    }
    return 0;
  }

  function defaults(kind: OpeningKind): Omit<StructureOpening, 'id'> {
    const st = s!;
    const tunnel = st.template === 'tunnel';
    const side: Side = kind === 'window-access' || (tunnel && kind === 'cat-door') ? 'back' : 'front';
    const L = tunnel ? st.width : sideLength(side, st.width, st.depth);
    switch (kind) {
      case 'human-door': { const w = Math.min(0.762, L - 0.3); return { kind, side, offset: (L - w) / 2, width: w, height: Math.min(1.829, frontHeight(st) - 0.2), swing: 'out', hinge: 'left', latch: 'hasp', selfClosing: true }; }
      case 'cleaning-hatch': { const w = Math.min(0.5, L - 0.2); return { kind, side, offset: (L - w) / 2, width: w, height: Math.min(0.4, frontHeight(st) - 0.25), sill: 0.1, swing: 'out', hinge: 'left', latch: 'slide-bolt' }; }
      case 'cat-door': return tunnel ? { kind, side: 'front', offset: 0, width: Math.min(0.25, st.width), height: Math.min(0.3, st.height), sill: 0 } : { kind, side, offset: Math.max(0.1, L / 2 - 0.125), width: 0.25, height: 0.3, sill: 0.1 };
      case 'window-access': return { kind, side: 'back', offset: Math.max(0, L / 2 - 0.4), width: Math.min(0.8, L), height: Math.min(0.9, st.height), sill: tunnel ? startWindowSill(st) : 0.9 };
      case 'vestibule': { const w = Math.min(1.1, st.width); return { kind, side: 'front', offset: Math.max(0, (st.width - w) / 2), width: w, height: Math.min(2.0, frontHeight(st)), depth: 0.9, latch: 'hasp' }; }
    }
  }
  const kinds = $derived<OpeningKind[]>(!s ? [] : s.template === 'tunnel' ? ['cat-door', 'window-access'] : layoutFor(s.template).houseBack ? ['human-door', 'cleaning-hatch', 'cat-door', 'window-access', 'vestibule'] : ['human-door', 'cleaning-hatch', 'cat-door', 'vestibule']);
  const sides = $derived<Side[]>(!s ? [] : s.template === 'tunnel' ? ['back', 'front'] : layoutFor(s.template).meshed);
  const up = (o: StructureOpening, patch: Partial<StructureOpening>) => s && editor.updateOpening(s.id, o.id, patch);
  const sideName = (sd: Side) => (s?.template === 'tunnel' ? (sd === 'back' ? 'Start' : 'End') : sd[0].toUpperCase() + sd.slice(1));
</script>

{#if !s}
  <p class="muted pad">Select a structure to add doors and openings.</p>
{:else}
  <section>
    <h3>Add to {s.name}</h3>
    <div class="row">
      {#each kinds as k (k)}<button class="btn small" disabled={editor.readonly} onclick={() => editor.addOpening(s.id, defaults(k))}>{NAMES[k]}</button>{/each}
    </div>
    <p class="muted small">Window inserts fit the house window the cats use; a vestibule is a small airlock in front of the door.</p>
  </section>
  {#each s.openings as o (o.id)}
    {@const skipped = info?.skippedOpenings.includes(o.id)}
    {@const leaf = o.kind === 'human-door' || o.kind === 'cleaning-hatch' || o.kind === 'vestibule'}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions, a11y_no_static_element_interactions -->
    <section class:sel={editor.selection?.id === o.id} onclick={() => (editor.selection = { kind: 'opening', id: o.id, structureId: s.id })}>
      <div class="row between">
        <h3>{NAMES[o.kind]}</h3>
        {#if skipped}<span class="badge blocker">Doesn’t fit</span>{/if}
      </div>
      <div class="grid2">
        {#if o.kind !== 'window-access' || s.template === 'tunnel'}
          <label class="field">Side <select value={o.side} disabled={editor.readonly || o.kind === 'vestibule'} onchange={(e) => up(o, { side: (e.currentTarget as HTMLSelectElement).value as Side })}>{#each sides as sd}<option value={sd}>{sideName(sd)}</option>{/each}</select></label>
        {/if}
        {#if s.template !== 'tunnel'}<label class="field">From the side’s start <LengthInput value={o.offset} units={editor.units} disabled={editor.readonly} onchange={(v) => up(o, { offset: v })} label="Offset" /></label>{/if}
        <label class="field">Width <LengthInput value={o.width} units={editor.units} disabled={editor.readonly} onchange={(v) => up(o, { width: v })} label="Width" /></label>
        <label class="field">Height <LengthInput value={o.height} units={editor.units} disabled={editor.readonly} onchange={(v) => up(o, { height: v })} label="Height" /></label>
        {#if o.kind !== 'human-door' && o.kind !== 'vestibule'}<label class="field">Sill <LengthInput value={o.sill ?? 0} units={editor.units} disabled={editor.readonly} onchange={(v) => up(o, { sill: v })} label="Sill height" /></label>{/if}
        {#if o.kind === 'vestibule'}<label class="field">Depth <LengthInput value={o.depth ?? 0.9} units={editor.units} disabled={editor.readonly} onchange={(v) => up(o, { depth: v })} label="Vestibule depth" /></label>{/if}
      </div>
      {#if leaf}
        <div class="grid2">
          <label class="field">Latch <select value={o.latch ?? ''} disabled={editor.readonly} onchange={(e) => up(o, { latch: ((e.currentTarget as HTMLSelectElement).value || null) as Latch | null })}>{#each LATCHES as l}<option value={l.id}>{l.name}</option>{/each}</select></label>
          {#if o.kind !== 'vestibule'}
            <label class="field">Opens <select value={o.swing ?? 'out'} disabled={editor.readonly} onchange={(e) => up(o, { swing: (e.currentTarget as HTMLSelectElement).value as 'in' | 'out' })}><option value="out">Outward</option><option value="in">Inward</option></select></label>
            <label class="field">Hinges <select value={o.hinge ?? 'left'} disabled={editor.readonly} onchange={(e) => up(o, { hinge: (e.currentTarget as HTMLSelectElement).value as 'left' | 'right' })}><option value="left">Left</option><option value="right">Right</option></select></label>
          {/if}
        </div>
        {#if o.kind === 'human-door'}<label class="check"><input type="checkbox" checked={!!o.selfClosing} disabled={editor.readonly} onchange={(e) => up(o, { selfClosing: (e.currentTarget as HTMLInputElement).checked })} /> Self-closing spring hinges</label>{/if}
      {/if}
      <button class="btn small danger" disabled={editor.readonly} onclick={(e) => { e.stopPropagation(); editor.selection = { kind: 'opening', id: o.id, structureId: s.id }; editor.removeSelected(); }}>Remove</button>
    </section>
  {/each}
{/if}

<style>
  section { padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
  section.sel { background: #fffaf0; }
  h3 { margin: 0; font-size: 14px; }
  .between { justify-content: space-between; }
  .small { font-size: 12px; margin: 0; }
  .pad { padding: 12px 14px; }
  section > .btn.danger { align-self: flex-start; }
</style>
