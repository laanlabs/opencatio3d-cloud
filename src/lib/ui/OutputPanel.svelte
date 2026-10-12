<script lang="ts">
  // Output workspace: cost range, shopping list, cut plan summary, build steps and every export.
  // The build package (print/PDF) is available once no blockers are open; otherwise it prints as a
  // watermarked concept. Exports are callbacks so EditorView owns downloads and the share dialog.
  import type { Editor } from './editor.svelte';
  import { fmtLen, fmtStock, money, moneyRange } from '../model/units';

  let { editor, onexport }: { editor: Editor; onexport: (kind: 'print' | 'bom' | 'cuts' | 'json' | 'plan' | 'png' | 'glb' | 'share' | 'ios' | 'openplan') => void } = $props();
  const a = $derived(editor.assembly);
  const units = $derived(editor.units);
  const letter = (id: string) => a.structures.find((s) => s.id === id)?.letter ?? '';
  let altName = $state('');
</script>

<section class="gate" class:ready={editor.buildReady}>
  {#if !editor.project.structures.length}
    <p>Add a structure to see its materials and build plan.</p>
  {:else if editor.buildReady}
    <p><strong>Build package ready.</strong> Plans, cut list, shopping list and steps for confirmed dimensions.</p>
  {:else}
    <p><strong>Concept only for now.</strong> {editor.blockers.length} {editor.blockers.length === 1 ? 'item blocks' : 'items block'} the build package:</p>
    <ul>{#each editor.blockers.slice(0, 5) as b (b.id)}<li><button class="link" onclick={() => { editor.selectTarget(b); editor.setWorkspace(b.ruleId === 'CAT-DIM-001' ? 'site' : 'checks'); }}>{b.title}</button></li>{/each}</ul>
  {/if}
  <div class="row">
    <button class="btn primary" onclick={() => onexport('print')} disabled={!editor.project.structures.length}>{editor.buildReady ? 'Open build package' : 'Preview package (concept)'}</button>
  </div>
</section>

{#if editor.project.structures.length}
  <section>
    <h3>Estimated cost</h3>
    <p class="cost">{moneyRange(a.cost.low, a.cost.high, a.cost.currency)}</p>
    <p class="muted small">Materials only, indicative US prices ({a.pricesAsOf}). Excludes tools, finishes, delivery and tax.</p>
  </section>

  <section>
    <h3>Shopping list</h3>
    <table>
      <thead><tr><th>Qty</th><th>Item</th><th class="num">Cost</th></tr></thead>
      <tbody>
        {#each a.bom as l (l.key)}
          <tr><td class="num">{l.qty}</td><td>{l.name}{l.stockLength ? ` — ${fmtStock(l.stockLength, units)}` : ''}{#if l.detail}<span class="muted"> · {l.detail}</span>{/if}</td><td class="num">{money(l.low)}–{money(l.high).slice(1)}</td></tr>
        {/each}
      </tbody>
    </table>
    <div class="row"><button class="btn small" onclick={() => onexport('bom')}>Download CSV</button></div>
  </section>

  <section>
    <h3>Cut plan</h3>
    {#each a.cuts.materials as m (m.materialId)}
      {@const mat = editor.cat.material(m.materialId)}
      <p class="small"><strong>{mat?.name}</strong>: {m.bins.length} pieces, {m.bins.reduce((n, b) => n + b.cuts.length, 0)} cuts, {fmtLen(m.bins.reduce((x, b) => x + b.offcut, 0), units)} offcut{#if m.overlong.length}<span class="badge blocker"> {m.overlong.length} too long</span>{/if}</p>
    {/each}
    <div class="row"><button class="btn small" onclick={() => onexport('cuts')}>Download cut list CSV</button></div>
  </section>

  <section>
    <h3>Build steps</h3>
    <ol class="steps">
      {#each a.steps as st (st.id)}<li><strong>{letter(st.structureId)} · {st.title}</strong> <span class="muted small">{st.partIds.length} parts</span></li>{/each}
    </ol>
  </section>
{/if}

<section>
  <h3>Share and export</h3>
  <div class="exports">
    <button class="btn small" onclick={() => onexport('share')}>Share a view-only link</button>
    <button class="btn small" onclick={() => onexport('ios')}>Open on iPhone / iPad</button>
    <button class="btn small" onclick={() => onexport('json')}>Project file (.json)</button>
    <button class="btn small" onclick={() => onexport('plan')}>Plan image</button>
    <button class="btn small" onclick={() => onexport('png')}>3D image</button>
    <button class="btn small" onclick={() => onexport('glb')}>3D model (.glb)</button>
    <button class="btn small" onclick={() => onexport('openplan')}>Open in OpenPlan3D</button>
  </div>
</section>

{#if !editor.readonly}
  <section>
    <h3>Design options</h3>
    <div class="row">
      <input type="text" placeholder="Option name" aria-label="Option name" bind:value={altName} />
      <button class="btn small" onclick={() => { editor.saveAlternative(altName); altName = ''; }}>Save current</button>
    </div>
    {#each editor.project.alternatives as alt (alt.id)}
      <div class="row between"><span>{alt.name}</span><span class="row"><button class="btn small" onclick={() => editor.restoreAlternative(alt.id)}>Restore</button><button class="btn small danger" onclick={() => editor.deleteAlternative(alt.id)}>Delete</button></span></div>
    {/each}
  </section>
{/if}

<style>
  section { padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 0; font-size: 14px; }
  .gate { background: #fdf6ea; }
  .gate.ready { background: #e9f3ec; }
  .gate p { margin: 0; font-size: 13px; }
  .gate ul { margin: 0; padding-left: 18px; font-size: 13px; }
  .link { border: 0; background: none; padding: 0; color: var(--cedar); text-decoration: underline; cursor: pointer; text-align: left; }
  .cost { font-size: 22px; font-weight: 800; margin: 0; }
  .small { font-size: 12px; margin: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: var(--muted); font-weight: 600; border-bottom: 1px solid var(--border); padding: 4px; }
  td { border-bottom: 1px solid var(--border); padding: 4px; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .steps { margin: 0; padding-left: 20px; font-size: 13px; display: flex; flex-direction: column; gap: 4px; }
  .exports { display: flex; flex-wrap: wrap; gap: 6px; }
  .between { justify-content: space-between; }
  input[type='text'] { flex: 1; }
</style>
