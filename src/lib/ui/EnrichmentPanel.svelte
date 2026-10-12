<script lang="ts">
  // Enrichment workspace: the household's cats, shelves/ramps/beds/resources in the selected structure,
  // and plants (with their safety status from the reviewed source).
  import type { Editor } from './editor.svelte';
  import type { Cat, Furnishing, Side } from '../model/types';
  import LengthInput from './LengthInput.svelte';
  import { SAFETY_LABEL } from '../catalog/catalog';
  import { layoutFor, sideLength } from '../generate/structure';

  let { editor }: { editor: Editor } = $props();
  const p = $derived(editor.project);
  const s = $derived(editor.current);
  const info = $derived(s ? editor.assembly.structures.find((x) => x.id === s.id) : undefined);
  let query = $state('');
  let safeOnly = $state(false);

  const plants = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return editor.cat.plants
      .filter((pl) => !safeOnly || pl.catSafety === 'no-known-issue')
      .filter((pl) => !q || pl.name.toLowerCase().includes(q) || pl.scientificName.toLowerCase().includes(q) || pl.commonNames.some((c) => c.toLowerCase().includes(q)))
      .slice(0, q ? 40 : 12);
  });
  const planters = $derived(s ? s.furnishings.filter((f) => editor.cat.component(f.componentId)?.category === 'planter') : []);
  const badge = (safety: string, level?: string) => (safety === 'known-hazard' ? (level === 'severe' ? 'blocker' : 'warning') : safety === 'no-known-issue' ? 'ok' : 'advisory');

  function addFurnishing(componentId: string) {
    if (!s) return;
    const c = editor.cat.component(componentId)!;
    const lay = layoutFor(s.template);
    const side: Side | 'span' = c.mount === 'span' ? 'span' : (lay.framed.find((x) => x !== 'back' || s.template === 'window-box') ?? 'front');
    const L = side === 'span' ? s.depth : sideLength(side, s.width, s.depth);
    const used = s.furnishings.filter((f) => f.side === side).length;
    const len = c.mount === 'span' ? s.width - 0.08 : c.defaults.length;
    const f: Omit<Furnishing, 'id'> = { componentId, side, offset: side === 'span' ? s.depth / 2 : Math.max(0, Math.min(L - len, 0.1 + used * 0.35)), mountHeight: c.defaults.mountHeight, ...(c.recipe.startsWith('board') ? { length: len } : {}) };
    editor.addFurnishing(s.id, f);
  }
  const up = (f: Furnishing, patch: Partial<Furnishing>) => s && editor.updateFurnishing(s.id, f.id, patch);
  const upCat = (c: Cat, patch: Partial<Cat>) => editor.updateCat(c.id, patch);
  const sideName = (sd: string) => (sd === 'span' ? 'Across' : sd[0].toUpperCase() + sd.slice(1));
</script>

<section>
  <h3>Cats</h3>
  <p class="muted small">Only what changes the advice: age, mobility, size and whether they rush doors.</p>
  {#each p.cats as c (c.id)}
    <div class="cat">
      <input type="text" value={c.name} aria-label="Cat name" disabled={editor.readonly} onchange={(e) => upCat(c, { name: (e.currentTarget as HTMLInputElement).value })} />
      <div class="grid2">
        <select value={c.ageClass} aria-label="Age" disabled={editor.readonly} onchange={(e) => upCat(c, { ageClass: (e.currentTarget as HTMLSelectElement).value as Cat['ageClass'] })}><option value="kitten">Kitten</option><option value="adult">Adult</option><option value="senior">Senior</option></select>
        <select value={c.mobility} aria-label="Mobility" disabled={editor.readonly} onchange={(e) => upCat(c, { mobility: (e.currentTarget as HTMLSelectElement).value as Cat['mobility'] })}><option value="full">Agile</option><option value="reduced">Some stiffness</option><option value="limited">Limited mobility</option></select>
        <select value={c.size} aria-label="Size" disabled={editor.readonly} onchange={(e) => upCat(c, { size: (e.currentTarget as HTMLSelectElement).value as Cat['size'] })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select>
        <select value={c.escapeRisk} aria-label="Door dashing" disabled={editor.readonly} onchange={(e) => upCat(c, { escapeRisk: (e.currentTarget as HTMLSelectElement).value as Cat['escapeRisk'] })}><option value="low">Calm at doors</option><option value="medium">Curious at doors</option><option value="high">Dashes for doors</option></select>
      </div>
      <button class="btn small danger" disabled={editor.readonly} onclick={() => editor.removeCat(c.id)}>Remove {c.name}</button>
    </div>
  {/each}
  <button class="btn small" disabled={editor.readonly} onclick={() => editor.addCat()}>Add a cat</button>
</section>

{#if s && s.template !== 'tunnel'}
  <section>
    <h3>In {s.name}</h3>
    <div class="row">
      {#each editor.cat.components as c (c.id)}<button class="btn small" disabled={editor.readonly} onclick={() => addFurnishing(c.id)}>{c.name}</button>{/each}
    </div>
  </section>
  {#each s.furnishings as f (f.id)}
    {@const c = editor.cat.component(f.componentId)}
    {#if c}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions, a11y_no_static_element_interactions -->
      <section class:sel={editor.selection?.id === f.id} onclick={() => (editor.selection = { kind: 'furnishing', id: f.id, structureId: s.id })}>
        <div class="row between"><h3>{c.name}</h3>{#if info?.skippedFurnishings.includes(f.id)}<span class="badge warning">Doesn’t fit</span>{/if}</div>
        <div class="grid2">
          <label class="field">Where <select value={f.side} disabled={editor.readonly} onchange={(e) => up(f, { side: (e.currentTarget as HTMLSelectElement).value as Side | 'span' })}>
            {#each c.mount === 'span' ? ['span'] : ['back', 'front', 'left', 'right'] as sd}<option value={sd}>{sideName(sd)}</option>{/each}
          </select></label>
          <label class="field">{f.side === 'span' ? 'From the back' : 'Along the side'} <LengthInput value={f.offset} units={editor.units} disabled={editor.readonly} onchange={(v) => up(f, { offset: v })} label="Offset" /></label>
          {#if c.mount !== 'floor' || c.recipe === 'post-scratcher'}<label class="field">{c.recipe === 'post-scratcher' ? 'Height' : 'Mounted at'} <LengthInput value={f.mountHeight} units={editor.units} disabled={editor.readonly} onchange={(v) => up(f, { mountHeight: v })} label="Height" /></label>{/if}
          {#if c.recipe.startsWith('board')}<label class="field">Length <LengthInput value={f.length ?? c.defaults.length} units={editor.units} disabled={editor.readonly} onchange={(v) => up(f, { length: v })} label="Length" /></label>{/if}
        </div>
        <p class="muted small">{c.ratedUse}</p>
      </section>
    {/if}
  {/each}
{:else if !s}
  <p class="muted pad">Select a structure to add shelves, ramps, beds and planters.</p>
{/if}

<section>
  <h3>Plants</h3>
  <p class="muted small">Safety status is from the ASPCA plant list as reviewed on the date shown. Lists are not exhaustive; “no known issue” is not a guarantee.</p>
  <div class="row">
    <input type="search" placeholder="Search plants" aria-label="Search plants" bind:value={query} />
    <label class="check"><input type="checkbox" bind:checked={safeOnly} /> No known issue only</label>
  </div>
  <ul class="plants">
    {#each plants as pl (pl.id)}
      <li>
        <div>
          <strong>{pl.name}</strong> <em class="muted">{pl.scientificName}</em>
          <span class="badge {badge(pl.catSafety, pl.hazardLevel)}">{SAFETY_LABEL[pl.catSafety]}{pl.hazardLevel === 'severe' ? ' · severe' : ''}</span>
          {#if pl.notes}<div class="muted small">{pl.notes}</div>{/if}
          {#if pl.sources[0]?.url}<a class="small" href={pl.sources[0].url} target="_blank" rel="noopener">Source</a>{/if}
        </div>
        {#if s && planters.length}
          <button class="btn small" disabled={editor.readonly} onclick={() => editor.addPlant(pl.id, s.id, planters[0].id)}>Plant</button>
        {/if}
      </li>
    {/each}
  </ul>
  {#if s && !planters.length && s.template !== 'tunnel'}<p class="muted small">Add a planter above to plant into it.</p>{/if}
  {#if p.plants.length}
    <h3>Planted</h3>
    <ul class="plants">
      {#each p.plants as pp (pp.id)}
        {@const pl = editor.cat.plant(pp.plantId)}
        <li><span>{pl?.name ?? pp.plantId} {#if pl}<span class="badge {badge(pl.catSafety, pl.hazardLevel)}">{SAFETY_LABEL[pl.catSafety]}</span>{/if}</span><button class="btn small danger" disabled={editor.readonly} onclick={() => editor.removePlant(pp.id)}>Remove</button></li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  section { padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
  section.sel { background: #fffaf0; }
  h3 { margin: 0; font-size: 14px; }
  .between { justify-content: space-between; }
  .small { font-size: 12px; margin: 0; }
  .pad { padding: 12px 14px; }
  .cat { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--border); border-radius: 10px; }
  .cat .btn { align-self: flex-start; }
  .plants { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .plants li { display: flex; justify-content: space-between; gap: 8px; align-items: flex-start; font-size: 13px; padding: 6px 0; border-top: 1px solid var(--border); }
  .plants em { font-size: 12px; }
  input[type='search'] { flex: 1; }
</style>
