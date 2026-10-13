<script lang="ts">
  // Inspector: edit the selected piece (wall, position, height, latch…) or, with nothing selected, the
  // catio itself (shape and size). Every control is a labelled input, so the whole game can be played
  // without dragging.
  import { catalog, SAFETY_LABEL } from '../../catalog/catalog';
  import type { Furnishing, Latch, Side, StructureOpening, Units } from '../../model/types';
  import { LATCHES } from '../../model/types';
  import { fmtLen } from '../../model/units';
  import { furnishingFits, sideLength } from '../../generate/structure';
  import { rampRun, sidesFor, type SizeField } from '../design';
  import { PIECES } from '../pieces';
  import type { QuestGame } from '../game.svelte';

  let { game, units }: { game: QuestGame; units: Units } = $props();

  const s = $derived(game.structure!);
  const f = $derived(game.furnishing(game.selected));
  const o = $derived(game.opening(game.selected));
  const comp = $derived(f ? catalog.component(f.componentId) : undefined);
  const pieceFor = (componentId: string) => PIECES.find((p) => p.action.kind === 'furnishing' && p.action.componentId === componentId);
  const t = $derived(catalog.template(s.template)!);
  const SIDE_NAME: Record<Side, string> = { back: 'Back', front: 'Front', left: 'Left', right: 'Right' };
  const OPEN_NAME: Record<string, string> = { 'human-door': 'People door', 'cat-door': 'Cat door', 'window-access': 'Window insert', 'cleaning-hatch': 'Cleaning hatch', vestibule: 'Vestibule' };
  const LATCH_NAME: Record<string, string> = { hasp: 'Hasp (padlockable)', 'slide-bolt': 'Slide bolt', gravity: 'Gravity latch', keyed: 'Keyed lock' };

  const lenOf = (x: Furnishing) => (x.componentId === 'ramp' ? rampRun(x) : x.length ?? comp?.defaults.length ?? 0.5);
  const maxOffset = $derived(f && f.side !== 'span' ? Math.max(0, sideLength(f.side as Side, s.width, s.depth) - lenOf(f)) : s.depth - 0.1);
  const hRange = $derived<[number, number]>(comp?.limits?.mountHeight ? [comp.limits.mountHeight[0], Math.min(comp.limits.mountHeight[1], Math.max(comp.limits.mountHeight[0], Math.min(s.height, s.lowHeight ?? s.height) - 0.1))] : [0.2, Math.max(0.3, Math.min(s.height, s.lowHeight ?? s.height) - 0.1)]);
  const heightEditable = $derived(!!comp && (comp.mount !== 'floor' || comp.recipe === 'post-scratcher'));
  const plants = $derived(f ? game.layout.plants.filter((p) => p.furnishingId === f.id) : []);

  const SIZES: { field: SizeField; label: string }[] = [{ field: 'width', label: 'Width' }, { field: 'depth', label: 'Depth' }, { field: 'height', label: 'Height' }];
  const step = 0.05;
</script>

<div class="insp">
  {#if f && comp}
    {@const pc = pieceFor(f.componentId)}
    <div class="head">
      <span class="ico" aria-hidden="true">{pc?.icon ?? '▪'}</span>
      <div><h3>{comp.name}</h3><p class="muted small">{pc?.blurb ?? comp.ratedUse}</p></div>
    </div>
    {#if !furnishingFits(s, f, catalog)}<p class="bad small" role="alert">This doesn’t fit here, so it won’t be built. Move it, lower it, or make the catio bigger.</p>{/if}
    {#if f.side !== 'span'}
      <fieldset class="sides"><legend>Wall</legend>
        {#each sidesFor(s, comp.mount) as side}
          <button class="chip" class:on={f.side === side} aria-pressed={f.side === side} onclick={() => game.moveFurnishing(f.id, { side })}>{SIDE_NAME[side]}</button>
        {/each}
      </fieldset>
    {/if}
    <label class="field">{f.side === 'span' ? 'Distance from the back' : 'Position along the wall'} <span class="val">{fmtLen(f.offset, units, true)}</span>
      <input type="range" min="0" max={maxOffset} step={step} value={f.offset} oninput={(e) => game.moveFurnishing(f.id, { offset: +e.currentTarget.value })} />
    </label>
    {#if heightEditable}
      <label class="field">Height <span class="val">{fmtLen(f.mountHeight, units, true)}</span>
        <input type="range" min={hRange[0]} max={hRange[1]} step={step} value={f.mountHeight} oninput={(e) => game.moveFurnishing(f.id, { mountHeight: +e.currentTarget.value })} />
      </label>
    {/if}
    {#if f.componentId === 'shelf'}
      <fieldset class="sides"><legend>Length</legend>
        {#each [0.45, 0.6, 0.9, 1.2] as L}
          <button class="chip" class:on={Math.abs((f.length ?? 0.6) - L) < 0.01} onclick={() => game.moveFurnishing(f.id, { length: L })}>{fmtLen(L, units, true)}</button>
        {/each}
      </fieldset>
    {/if}
    {#if comp.category === 'planter'}
      <h4>Plants</h4>
      {#if plants.length}
        <ul class="plants">
          {#each plants as pl (pl.id)}
            {@const plant = catalog.plant(pl.plantId)}
            <li><span>{plant?.name ?? pl.plantId}</span> <span class="badge {plant?.catSafety === 'known-hazard' ? 'blocker' : plant?.catSafety === 'no-known-issue' ? 'ok' : 'warning'}">{SAFETY_LABEL[plant?.catSafety ?? 'insufficient-data']}</span> <button class="btn small" onclick={() => game.remove(pl.id)} aria-label="Remove {plant?.name ?? 'plant'}">Remove</button></li>
          {/each}
        </ul>
      {:else}<p class="muted small">Empty. Add plants from the Plants tray.</p>{/if}
    {/if}
    <button class="btn danger" onclick={() => game.remove(f.id)}>Remove {comp.name.toLowerCase()}</button>
  {:else if o}
    <div class="head"><span class="ico" aria-hidden="true">🚪</span><div><h3>{OPEN_NAME[o.kind]}</h3><p class="muted small">On the {o.side} wall, {fmtLen(o.width, units, true)} wide.</p></div></div>
    {#if o.kind !== 'window-access' && o.kind !== 'vestibule'}
      <label class="field">Position along the wall <span class="val">{fmtLen(o.offset, units, true)}</span>
        <input type="range" min="0" max={Math.max(0, sideLength(o.side, s.width, s.depth) - o.width)} step={step} value={o.offset} oninput={(e) => game.setOpening(o.id, { offset: +e.currentTarget.value })} />
      </label>
    {/if}
    {#if o.kind === 'human-door' || o.kind === 'cleaning-hatch' || o.kind === 'vestibule'}
      <label class="field">Latch
        <select value={o.latch ?? ''} onchange={(e) => game.setOpening(o.id, { latch: (e.currentTarget.value || null) as Latch | null })}>
          <option value="">No latch</option>
          {#each LATCHES as l}<option value={l}>{LATCH_NAME[l]}</option>{/each}
        </select>
      </label>
      {#if o.kind !== 'cleaning-hatch'}
        <label class="check"><input type="checkbox" checked={!!o.selfClosing} onchange={(e) => game.setOpening(o.id, { selfClosing: e.currentTarget.checked })} /> Self-closing hinges</label>
      {/if}
      <fieldset class="sides"><legend>Opens</legend>
        {#each ['out', 'in'] as sw}<button class="chip" class:on={(o.swing ?? 'out') === sw} onclick={() => game.setOpening(o.id, { swing: sw as StructureOpening['swing'] })}>{sw === 'out' ? 'Outward' : 'Inward'}</button>{/each}
      </fieldset>
    {/if}
    <button class="btn danger" onclick={() => game.remove(o.id)}>Remove {OPEN_NAME[o.kind].toLowerCase()}</button>
  {:else}
    <div class="head"><span class="ico" aria-hidden="true">🏠</span><div><h3>{t.name}</h3><p class="muted small">{t.summary}</p></div></div>
    {#each SIZES as sz}
      {@const lim = t.limits[sz.field]}
      {#if lim}
        <label class="field">{sz.label} <span class="val">{fmtLen(s[sz.field] as number, units, true)}</span>
          <input type="range" min={lim[0]} max={lim[1]} step={step} value={s[sz.field] as number} oninput={(e) => game.resize(sz.field, +e.currentTarget.value)} />
        </label>
      {/if}
    {/each}
    <dl class="facts">
      <dt>Mesh</dt><dd>{catalog.material(s.mesh.materialId)?.name ?? s.mesh.materialId}</dd>
      <dt>Roof</dt><dd>{s.roof.kind === 'partial' ? `Half covered (${(s.roof.materialId ?? '').includes('steel') ? 'steel' : 'clear'})` : s.roof.kind === 'corrugated' ? 'Steel' : s.roof.kind === 'polycarbonate' ? 'Clear polycarbonate' : 'Mesh'}</dd>
      <dt>Floor</dt><dd>{s.base.kind.replace('-', ' ')}</dd>
    </dl>
    <p class="muted small">Tip: select a piece on the plan to move it. Arrow keys slide it, Page Up/Down raise or lower it.</p>
  {/if}
</div>

<style>
  .insp { display: flex; flex-direction: column; gap: 10px; }
  .head { display: flex; gap: 10px; align-items: flex-start; }
  .ico { font-size: 26px; line-height: 1; }
  h3 { margin: 0; font-size: 15px; }
  h4 { margin: 4px 0 0; font-size: 13px; }
  .small { font-size: 12px; margin: 2px 0 0; }
  .bad { color: var(--blocker); background: #fbe7e5; padding: 6px 8px; border-radius: 8px; }
  .val { float: right; color: var(--ink); font-weight: 700; }
  input[type='range'] { width: 100%; accent-color: var(--dusk); min-height: 28px; }
  fieldset { border: 0; padding: 0; margin: 0; display: flex; gap: 6px; flex-wrap: wrap; }
  legend { font-size: 12px; font-weight: 600; color: var(--ink-soft); margin-bottom: 4px; width: 100%; }
  .plants { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .plants li { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 13px; }
  .facts { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 0; font-size: 12px; }
  .facts dt { color: var(--ink-soft); font-weight: 600; }
  .facts dd { margin: 0; text-transform: capitalize; }
</style>
