<script lang="ts">
  // Structure workspace: add structures from templates, then size them, set roof and base, and attach
  // them to a house wall. Limits come from the catalog template; outside them the design is concept-only.
  import type { Editor } from './editor.svelte';
  import type { BaseKind, RoofKind, Structure, TemplateId, Vec2 } from '../model/types';
  import { frontHeight } from '../model/types';
  import LengthInput from './LengthInput.svelte';
  import { fmtLen } from '../model/units';
  import { polylineLength } from '../model/geometry';

  let { editor }: { editor: Editor } = $props();
  const p = $derived(editor.project);
  const s = $derived(editor.current);
  const t = $derived(s ? editor.cat.template(s.template) : undefined);
  const info = $derived(s ? editor.assembly.structures.find((x) => x.id === s.id) : undefined);
  const ADD: TemplateId[] = ['lean-to', 'window-box', 'freestanding', 'tunnel', 'porch-infill', 'balcony-concept'];
  const ROOFS: { id: RoofKind; name: string }[] = [{ id: 'mesh', name: 'Mesh' }, { id: 'partial', name: 'Part covered' }, { id: 'polycarbonate', name: 'Polycarbonate' }, { id: 'corrugated', name: 'Steel' }];
  const BASES: { id: BaseKind; name: string }[] = [{ id: 'pavers', name: 'Pavers' }, { id: 'ground-skirt', name: 'Ground skirt' }, { id: 'deck', name: 'On a deck' }, { id: 'raised-floor', name: 'Raised floor' }, { id: 'none', name: 'On concrete' }];

  const set = (patch: Partial<Structure>) => s && editor.updateStructure(s.id, patch);
  const lim = (k: 'width' | 'depth' | 'height' | 'lowHeight' | 'elevation') => t?.limits[k];
  const range = (k: 'width' | 'depth' | 'height' | 'lowHeight' | 'elevation') => {
    const r = lim(k);
    return r ? `${fmtLen(r[0], editor.units, true)}–${fmtLen(r[1], editor.units, true)}` : '';
  };
  function setPath(i: number, axis: 0 | 1, v: number) {
    if (!s?.path) return;
    set({ path: s.path.map((q, j) => (j === i ? (axis ? [q[0], v] : [v, q[1]]) : q)) as Vec2[] });
  }
  function addBend() {
    if (!s?.path) return;
    const last = s.path[s.path.length - 1], prev = s.path[s.path.length - 2] ?? [0, 0];
    const d: Vec2 = [last[0] - prev[0], last[1] - prev[1]];
    const L = Math.hypot(d[0], d[1]) || 1;
    // Turn right 90° and run 1.5 m.
    set({ path: [...s.path, [last[0] - (d[1] / L) * 1.5, last[1] + (d[0] / L) * 1.5]] });
  }
  const wall = $derived(s ? p.site.walls.find((w) => w.id === s.hostWallId) : undefined);
</script>

<section>
  <h3>Add a structure</h3>
  <div class="adds">
    {#each ADD as id (id)}
      {@const tt = editor.cat.template(id)!}
      <button class="btn small" disabled={editor.readonly} onclick={() => (editor.placing = { kind: 'structure', template: id })} title={tt.summary}>{tt.name.replace(' (concept)', '')}{tt.conceptOnly ? ' ·concept' : ''}</button>
    {/each}
  </div>
  <p class="muted small">Pick one, then place it in the plan. Attached types snap to the nearest house wall and window.</p>
</section>

{#if p.structures.length > 1}
  <section>
    <h3>Structures</h3>
    <div class="row">
      {#each p.structures as x (x.id)}
        <button class="chip" class:on={s?.id === x.id} onclick={() => (editor.selection = { kind: 'structure', id: x.id })}>{x.name}</button>
      {/each}
    </div>
  </section>
{/if}

{#if s && t}
  <section>
    <div class="row between">
      <h3>{s.name}</h3>
      {#if t.conceptOnly}<span class="badge warning">Concept only</span>{/if}
    </div>
    <label class="field">Name <input type="text" value={s.name} disabled={editor.readonly} onchange={(e) => set({ name: (e.currentTarget as HTMLInputElement).value })} /></label>
    {#if info?.unsupported.length}<p class="warn" role="status">Outside supported sizes: {info.unsupported.join('; ')}. Shown as a concept until fixed.</p>{/if}

    {#if s.template === 'tunnel'}
      <div class="grid2">
        <label class="field">Width <LengthInput value={s.width} units={editor.units} disabled={editor.readonly} onchange={(v) => set({ width: v })} label="Tunnel width" /></label>
        <label class="field">Height <LengthInput value={s.height} units={editor.units} disabled={editor.readonly} onchange={(v) => set({ height: v })} label="Tunnel height" /></label>
      </div>
      <p class="muted small">Length {fmtLen(polylineLength(s.path ?? []), editor.units)} · points are relative to the start.</p>
      {#each s.path ?? [] as q, i}
        <div class="grid3 pt">
          <span class="muted small">{i === 0 ? 'Start' : `Point ${i + 1}`}</span>
          <LengthInput value={q[0]} units={editor.units} min={-100} disabled={editor.readonly || i === 0} onchange={(v) => setPath(i, 0, v)} label="Point {i + 1} across" />
          <LengthInput value={q[1]} units={editor.units} min={-100} disabled={editor.readonly || i === 0} onchange={(v) => setPath(i, 1, v)} label="Point {i + 1} along" />
        </div>
      {/each}
      <div class="row">
        <button class="btn small" disabled={editor.readonly} onclick={addBend}>Add a bend</button>
        {#if (s.path?.length ?? 0) > 2}<button class="btn small" disabled={editor.readonly} onclick={() => set({ path: s.path!.slice(0, -1) })}>Remove last point</button>{/if}
      </div>
    {:else}
      <div class="grid2">
        <label class="field">Width <span class="lim">{range('width')}</span><LengthInput value={s.width} units={editor.units} disabled={editor.readonly} onchange={(v) => set({ width: v })} label="Width" /></label>
        <label class="field">Depth <span class="lim">{range('depth')}</span><LengthInput value={s.depth} units={editor.units} disabled={editor.readonly} onchange={(v) => set({ depth: v })} label="Depth" /></label>
        <label class="field">{t.attached ? 'Height at wall' : 'Back height'} <span class="lim">{range('height')}</span><LengthInput value={s.height} units={editor.units} disabled={editor.readonly} onchange={(v) => set({ height: v, ...(frontHeight(s) > v ? { lowHeight: v } : {}) })} label="Back height" /></label>
        <label class="field">Front height <LengthInput value={frontHeight(s)} units={editor.units} disabled={editor.readonly} onchange={(v) => set({ lowHeight: v })} label="Front height" /></label>
        {#if lim('elevation')}<label class="field">Above ground <span class="lim">{range('elevation')}</span><LengthInput value={s.elevation ?? 0} units={editor.units} disabled={editor.readonly} onchange={(v) => set({ elevation: v })} label="Elevation" /></label>{/if}
        {#if !t.attached}<label class="field">Rotation° <input type="number" step="15" value={Math.round(s.rotation)} disabled={editor.readonly} onchange={(e) => set({ rotation: Number((e.currentTarget as HTMLInputElement).value) || 0 })} /></label>{/if}
      </div>
    {/if}

    {#if t.attached}
      <div class="grid2">
        <label class="field">House wall
          <select value={s.hostWallId ?? ''} disabled={editor.readonly || !p.site.walls.length} onchange={(e) => editor.reattach(s.id, (e.currentTarget as HTMLSelectElement).value)}>
            {#if !s.hostWallId}<option value="">Not attached</option>{/if}
            {#each p.site.walls as w2, i (w2.id)}<option value={w2.id}>Wall {i + 1} ({fmtLen(Math.hypot(w2.b[0] - w2.a[0], w2.b[1] - w2.a[1]), editor.units, true)})</option>{/each}
          </select>
        </label>
        {#if wall}
          <label class="field">Centre on
            <select value={s.hostOpeningId ?? ''} disabled={editor.readonly} onchange={(e) => editor.reattach(s.id, wall.id, (e.currentTarget as HTMLSelectElement).value || undefined)}>
              <option value="">Middle of the wall</option>
              {#each wall.openings.filter((o) => o.kind === 'window' || o.kind === 'door' || o.kind === 'patio-door') as o (o.id)}<option value={o.id}>{o.name || o.kind}</option>{/each}
            </select>
          </label>
        {/if}
      </div>
    {/if}
  </section>

  {#if s.template !== 'tunnel'}
    <section>
      <h3>Roof</h3>
      <div class="seg wrap" role="group" aria-label="Roof">
        {#each ROOFS as r (r.id)}<button aria-pressed={s.roof.kind === r.id} disabled={editor.readonly} onclick={() => set({ roof: { ...s.roof, kind: r.id, ...(r.id === 'partial' && s.roof.coverFraction == null ? { coverFraction: 0.5 } : {}) } })}>{r.name}</button>{/each}
      </div>
      {#if s.roof.kind === 'partial'}
        <label class="field">Covered from the high side: {Math.round((s.roof.coverFraction ?? 0.5) * 100)}%
          <input type="range" min="0.2" max="1" step="0.05" value={s.roof.coverFraction ?? 0.5} disabled={editor.readonly} onchange={(e) => set({ roof: { ...s.roof, coverFraction: Number((e.currentTarget as HTMLInputElement).value) } })} />
        </label>
      {/if}
      {#if s.roof.kind !== 'mesh'}<p class="muted small">Slope {Math.round(((s.height - frontHeight(s)) / s.depth) * 1200) / 100}″ per foot — solid panels need at least 1″.</p>{/if}
    </section>
  {/if}

  <section>
    <h3>Base</h3>
    <select value={s.base.kind} disabled={editor.readonly} aria-label="Base" onchange={(e) => set({ base: { ...s.base, kind: (e.currentTarget as HTMLSelectElement).value as BaseKind } })}>
      {#each BASES as b (b.id)}<option value={b.id}>{b.name}</option>{/each}
    </select>
    {#if s.base.kind === 'ground-skirt'}
      <label class="field">Skirt width <LengthInput value={s.base.skirtDepth ?? 0.3} units={editor.units} disabled={editor.readonly} onchange={(v) => set({ base: { ...s.base, skirtDepth: v } })} label="Skirt width" /></label>
    {/if}
  </section>
{:else if p.structures.length}
  <p class="muted">Select a structure in the plan or 3D view to edit it.</p>
{/if}

<style>
  section { padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 0; font-size: 14px; }
  .adds { display: flex; flex-wrap: wrap; gap: 6px; }
  .small { font-size: 12px; margin: 0; }
  .between { justify-content: space-between; }
  .lim { font-weight: 400; color: var(--muted); font-size: 11px; }
  .warn { margin: 0; background: #fdf0dc; color: var(--warning); padding: 8px 10px; border-radius: 8px; font-size: 12px; }
  .pt { align-items: center; }
  .seg.wrap { flex-wrap: wrap; }
  p.muted:not(.small) { padding: 12px 14px; }
</style>
