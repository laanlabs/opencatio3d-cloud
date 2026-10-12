<script lang="ts">
  // Site workspace: units, ground, climate, house walls with their windows/doors/vents/utilities,
  // obstacles, and the measurement confirmations that unlock build outputs (CAT-DIM-001).
  import type { Editor } from './editor.svelte';
  import type { GroundKind, HostWall, ObstacleKind, WallOpening, WallOpeningKind } from '../model/types';
  import { WALL_OPENING_KINDS } from '../model/types';
  import LengthInput from './LengthInput.svelte';
  import { fmtLen } from '../model/units';
  import { unconfirmed } from '../analysis/checks';
  import { keyFields } from '../site/templates';

  let { editor }: { editor: Editor } = $props();
  const p = $derived(editor.project);
  const climate = $derived(p.region?.climate ?? { snowLoad: 'none', wind: 'normal', hot: false, rainy: false });
  const GROUNDS: { id: GroundKind; name: string }[] = [{ id: 'grass', name: 'Grass' }, { id: 'soil', name: 'Soil / mulch' }, { id: 'concrete', name: 'Concrete' }, { id: 'pavers', name: 'Patio pavers' }, { id: 'deck', name: 'Deck' }];
  const OPEN_NAMES: Record<WallOpeningKind, string> = { window: 'Window', door: 'Door', 'patio-door': 'Patio door', vent: 'Vent', 'dryer-vent': 'Dryer vent', utility: 'Utility box', downspout: 'Downspout', meter: 'Meter' };
  const OBST: { id: ObstacleKind; name: string }[] = [{ id: 'tree', name: 'Tree' }, { id: 'ac-unit', name: 'AC unit' }, { id: 'hose-bib', name: 'Hose bib' }, { id: 'steps', name: 'Steps' }, { id: 'no-build', name: 'No-build zone' }, { id: 'other', name: 'Other' }];
  const len = (w: HostWall) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  function setLength(w: HostWall, L: number) {
    const d = [(w.b[0] - w.a[0]) / (len(w) || 1), (w.b[1] - w.a[1]) / (len(w) || 1)];
    editor.updateWall(w.id, { b: [w.a[0] + d[0] * L, w.a[1] + d[1] * L] });
  }
  function addOpening(w: HostWall, kind: WallOpeningKind) {
    const size: Record<string, [number, number, number]> = { window: [0.9, 1.2, 0.9], door: [0.9, 2.03, 0], 'patio-door': [1.8, 2.03, 0], vent: [0.25, 0.25, 0.4], 'dryer-vent': [0.15, 0.15, 0.5], utility: [0.4, 0.5, 0.9], downspout: [0.1, w.height, 0], meter: [0.35, 0.45, 1.2] };
    const [width, height, sill] = size[kind];
    editor.addWallOpening(w.id, { kind, offset: Math.max(0, len(w) / 2 - width / 2), width, height, sill } as Omit<WallOpening, 'id'>);
  }
  const upO = (w: HostWall, o: WallOpening, patch: Partial<WallOpening>) => editor.updateWallOpening(w.id, o.id, patch);
  let addKind = $state<WallOpeningKind>('window');
</script>

<section>
  <h3>Project</h3>
  <div class="grid2">
    <label class="field">Units
      <select value={p.units} disabled={editor.readonly} onchange={(e) => editor.setUnits((e.currentTarget as HTMLSelectElement).value as 'metric' | 'imperial')}><option value="imperial">Feet & inches</option><option value="metric">Metric</option></select>
    </label>
    <label class="field">Ground
      <select value={p.site.ground} disabled={editor.readonly} onchange={(e) => editor.setSite({ ground: (e.currentTarget as HTMLSelectElement).value as GroundKind })}>{#each GROUNDS as g}<option value={g.id}>{g.name}</option>{/each}</select>
    </label>
    <label class="field">State / region <input type="text" maxlength="40" value={p.region?.state ?? ''} placeholder="e.g. OR" disabled={editor.readonly} onchange={(e) => editor.setRegion({ state: (e.currentTarget as HTMLInputElement).value.trim() || undefined })} /></label>
    <label class="field">Snow
      <select value={climate.snowLoad} disabled={editor.readonly} onchange={(e) => editor.setClimate({ snowLoad: (e.currentTarget as HTMLSelectElement).value as 'none' | 'light' | 'heavy' })}><option value="none">Rarely</option><option value="light">Light</option><option value="heavy">Heavy</option></select>
    </label>
  </div>
  <div class="row">
    <label class="check"><input type="checkbox" checked={climate.hot} disabled={editor.readonly} onchange={(e) => editor.setClimate({ hot: (e.currentTarget as HTMLInputElement).checked })} /> Hot summers</label>
    <label class="check"><input type="checkbox" checked={climate.rainy} disabled={editor.readonly} onchange={(e) => editor.setClimate({ rainy: (e.currentTarget as HTMLInputElement).checked })} /> Rainy</label>
    <label class="check"><input type="checkbox" checked={climate.wind === 'high'} disabled={editor.readonly} onchange={(e) => editor.setClimate({ wind: (e.currentTarget as HTMLInputElement).checked ? 'high' : 'normal' })} /> Windy site</label>
  </div>
</section>

<section>
  <h3>Measurements</h3>
  <p class="muted small">Build outputs need measured dimensions. Measure on site, adjust the structure, then confirm.</p>
  {#each p.structures as s (s.id)}
    {@const missing = unconfirmed(p, s)}
    <div class="row between meas">
      <span><strong>{s.name}</strong><br /><span class="muted small">{keyFields(s).join(', ')}</span></span>
      {#if missing.length}
        <button class="btn small primary" disabled={editor.readonly} onclick={() => editor.confirmDimensions(s.id)}>Confirm measured</button>
      {:else}
        <span class="row"><span class="badge ok">Confirmed</span><button class="btn small" disabled={editor.readonly} onclick={() => editor.unconfirmDimensions(s.id)}>Undo</button></span>
      {/if}
    </div>
  {:else}
    <p class="muted small">No structures yet.</p>
  {/each}
</section>

<section>
  <div class="row between"><h3>House walls</h3><button class="btn small" disabled={editor.readonly} onclick={() => (editor.placing = { kind: 'wall' })}>Draw a wall</button></div>
  {#each p.site.walls as w, i (w.id)}
    <div class="wall" class:sel={editor.selection?.id === w.id}>
      <div class="grid2">
        <label class="field">Wall {i + 1} length <LengthInput value={len(w)} units={editor.units} disabled={editor.readonly} onchange={(v) => setLength(w, v)} label="Wall length" /></label>
        <label class="field">Height <LengthInput value={w.height} units={editor.units} disabled={editor.readonly} onchange={(v) => editor.updateWall(w.id, { height: v })} label="Wall height" /></label>
      </div>
      {#each w.openings as o (o.id)}
        <details open={editor.selection?.id === o.id}>
          <summary>{o.name || OPEN_NAMES[o.kind]} · {fmtLen(o.offset, editor.units, true)} from the left</summary>
          <div class="grid2">
            <label class="field">Kind <select value={o.kind} disabled={editor.readonly} onchange={(e) => upO(w, o, { kind: (e.currentTarget as HTMLSelectElement).value as WallOpeningKind })}>{#each WALL_OPENING_KINDS as k}<option value={k}>{OPEN_NAMES[k]}</option>{/each}</select></label>
            <label class="field">Label <input type="text" value={o.name ?? ''} disabled={editor.readonly} onchange={(e) => upO(w, o, { name: (e.currentTarget as HTMLInputElement).value || undefined })} /></label>
            <label class="field">From the left <LengthInput value={o.offset} units={editor.units} disabled={editor.readonly} onchange={(v) => upO(w, o, { offset: v })} label="Offset" /></label>
            <label class="field">Width <LengthInput value={o.width} units={editor.units} disabled={editor.readonly} onchange={(v) => upO(w, o, { width: v })} label="Width" /></label>
            <label class="field">Height <LengthInput value={o.height} units={editor.units} disabled={editor.readonly} onchange={(v) => upO(w, o, { height: v })} label="Height" /></label>
            <label class="field">Sill <LengthInput value={o.sill} units={editor.units} disabled={editor.readonly} onchange={(v) => upO(w, o, { sill: v })} label="Sill" /></label>
          </div>
          {#if o.kind === 'window'}<label class="check"><input type="checkbox" checked={!!o.egress} disabled={editor.readonly} onchange={(e) => upO(w, o, { egress: (e.currentTarget as HTMLInputElement).checked || undefined })} /> Bedroom emergency escape window</label>{/if}
          <button class="btn small danger" disabled={editor.readonly} onclick={() => { editor.selection = { kind: 'wall-opening', id: o.id, wallId: w.id }; editor.removeSelected(); }}>Remove</button>
        </details>
      {/each}
      <div class="row">
        <select bind:value={addKind} aria-label="Opening kind">{#each WALL_OPENING_KINDS as k}<option value={k}>{OPEN_NAMES[k]}</option>{/each}</select>
        <button class="btn small" disabled={editor.readonly} onclick={() => addOpening(w, addKind)}>Add to wall {i + 1}</button>
      </div>
    </div>
  {/each}
  <p class="muted small">Mark vents, meters and downspouts too — the checks keep them outside the catio.</p>
</section>

<section>
  <h3>Obstacles</h3>
  <div class="row">{#each OBST as o}<button class="btn small" disabled={editor.readonly} onclick={() => (editor.placing = { kind: 'obstacle', obstacle: o.id })}>{o.name}</button>{/each}</div>
</section>

<style>
  section { padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 0; font-size: 14px; }
  .between { justify-content: space-between; }
  .small { font-size: 12px; margin: 0; }
  .meas { padding: 6px 0; border-top: 1px solid var(--border); }
  .wall { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--border); border-radius: 10px; }
  .wall.sel { border-color: var(--sun); }
  details { border-top: 1px solid var(--border); padding-top: 6px; }
  summary { cursor: pointer; font-size: 13px; font-weight: 600; padding: 4px 0; }
  details .grid2 { margin: 6px 0; }
</style>
