<script lang="ts">
  // Materials workspace: frame lumber, mesh and roof panels for the selected structure, and the
  // project's buying assumptions (stock lengths, saw kerf, waste, fastener overage).
  import type { Editor } from './editor.svelte';
  import type { Profile } from '../model/types';
  import { PROFILES } from '../model/types';
  import LengthInput from './LengthInput.svelte';
  import { fmtLen, fmtStock, money } from '../model/units';

  let { editor }: { editor: Editor } = $props();
  const p = $derived(editor.project);
  const s = $derived(editor.current);
  const meshes = $derived(editor.cat.ofKind('mesh'));
  const roofs = $derived(editor.cat.ofKind('roof-panel'));
  const lumber = $derived(editor.cat.ofKind('lumber').filter((m) => m.profile?.startsWith('wood-2x')));
  const allStock = $derived([...new Set(lumber.flatMap((m) => m.stockLengths ?? []))].sort((a, b) => a - b));
  const PROFILE_NAME: Record<Profile, string> = { 'wood-2x2': '2×2', 'wood-2x3': '2×3', 'wood-2x4': '2×4' };
  const ins = (m: number) => `${Math.round((m / 0.0254) * 100) / 100}″`;

  function setProfile(profile: Profile) {
    if (!s) return;
    const m = editor.cat.lumberFor(profile)[0];
    editor.updateStructure(s.id, { frame: { ...s.frame, profile, materialId: m?.id ?? s.frame.materialId } });
  }
  function toggleStock(len: number, on: boolean) {
    const cur = p.assumptions.stockLengths.length ? p.assumptions.stockLengths : allStock;
    const next = on ? [...new Set([...cur, len])].sort((a, b) => a - b) : cur.filter((x) => Math.abs(x - len) > 0.001);
    editor.setAssumptions({ stockLengths: next.length === allStock.length ? [] : next });
  }
  const stockOn = (len: number) => !p.assumptions.stockLengths.length || p.assumptions.stockLengths.some((x) => Math.abs(x - len) < 0.01);
</script>

{#if s && s.template !== 'tunnel'}
  <section>
    <h3>Frame — {s.name}</h3>
    <div class="seg" role="group" aria-label="Lumber size">
      {#each PROFILES as pr}<button aria-pressed={s.frame.profile === pr} disabled={editor.readonly} onclick={() => setProfile(pr)}>{PROFILE_NAME[pr]}</button>{/each}
    </div>
    <label class="field">Lumber
      <select value={s.frame.materialId} disabled={editor.readonly} onchange={(e) => editor.updateStructure(s.id, { frame: { ...s.frame, materialId: (e.currentTarget as HTMLSelectElement).value } })}>
        {#each editor.cat.lumberFor(s.frame.profile) as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
      </select>
    </label>
    <div class="grid2">
      <label class="field">Max post spacing <LengthInput value={s.frame.maxPostSpacing} units={editor.units} disabled={editor.readonly} onchange={(v) => editor.updateStructure(s.id, { frame: { ...s.frame, maxPostSpacing: v } })} label="Max post spacing" /></label>
      <label class="field">Rail spacing <LengthInput value={s.frame.railSpacing} units={editor.units} disabled={editor.readonly} onchange={(v) => editor.updateStructure(s.id, { frame: { ...s.frame, railSpacing: v } })} label="Rail spacing" /></label>
    </div>
  </section>
{:else if s}
  <section>
    <h3>Frame — {s.name}</h3>
    <label class="field">Lumber
      <select value={s.frame.materialId} disabled={editor.readonly} onchange={(e) => { const m = editor.cat.material((e.currentTarget as HTMLSelectElement).value); if (m) editor.updateStructure(s.id, { frame: { ...s.frame, materialId: m.id, profile: m.profile as Profile } }); }}>
        {#each lumber as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
      </select>
    </label>
  </section>
{/if}

{#if s}
  <section>
    <h3>Mesh</h3>
    <div class="opts">
      {#each meshes as m (m.id)}
        <label class="opt" class:on={s.mesh.materialId === m.id}>
          <input type="radio" name="mesh" checked={s.mesh.materialId === m.id} disabled={editor.readonly} onchange={() => editor.updateStructure(s.id, { mesh: { ...s.mesh, materialId: m.id } })} />
          <span><strong>{ins(m.opening![0])} × {ins(m.opening![1])}, {m.gauge}-gauge</strong> · {m.coating?.replace(/-/g, ' ')} · {fmtLen(m.rollWidth!, editor.units, true)} roll<br /><span class="muted">{money(m.price![0])}–{money(m.price![1])} a roll{m.notes ? ` · ${m.notes}` : ''}</span></span>
        </label>
      {/each}
    </div>
  </section>
  {#if s.roof.kind !== 'mesh'}
    <section>
      <h3>Roof panels</h3>
      <select value={s.roof.materialId ?? ''} aria-label="Roof panel" disabled={editor.readonly} onchange={(e) => editor.updateStructure(s.id, { roof: { ...s.roof, materialId: (e.currentTarget as HTMLSelectElement).value } })}>
        {#each roofs as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
      </select>
    </section>
  {/if}
{:else}
  <p class="muted pad">Select a structure to choose its lumber, mesh and roof panels.</p>
{/if}

<section>
  <h3>Buying assumptions</h3>
  <p class="muted small">Lumber lengths you can buy:</p>
  <div class="row">
    {#each allStock as len}<label class="check"><input type="checkbox" checked={stockOn(len)} disabled={editor.readonly} onchange={(e) => toggleStock(len, (e.currentTarget as HTMLInputElement).checked)} /> {fmtStock(len, editor.units)}</label>{/each}
  </div>
  <div class="grid3">
    <label class="field">Saw kerf <LengthInput value={p.assumptions.kerf} units={editor.units} max={0.02} disabled={editor.readonly} onchange={(v) => editor.setAssumptions({ kerf: v })} label="Saw kerf" /></label>
    <label class="field">Mesh & sheet waste % <input type="number" min="0" max="50" value={Math.round(p.assumptions.wasteFactor * 100)} disabled={editor.readonly} onchange={(e) => editor.setAssumptions({ wasteFactor: Math.min(0.5, Math.max(0, Number((e.currentTarget as HTMLInputElement).value) / 100)) })} /></label>
    <label class="field">Extra fasteners % <input type="number" min="0" max="50" value={Math.round(p.assumptions.fastenerOverage * 100)} disabled={editor.readonly} onchange={(e) => editor.setAssumptions({ fastenerOverage: Math.min(0.5, Math.max(0, Number((e.currentTarget as HTMLInputElement).value) / 100)) })} /></label>
  </div>
  <p class="muted small">Prices are indicative US ranges as of {editor.cat.pricesAsOf}; check local prices before you buy.</p>
</section>

<style>
  section { padding: 12px 14px; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 0; font-size: 14px; }
  .small { font-size: 12px; margin: 0; }
  .pad { padding: 12px 14px; }
  .opts { display: flex; flex-direction: column; gap: 6px; }
  .opt { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; padding: 8px; border: 1px solid var(--border); border-radius: 10px; cursor: pointer; }
  .opt.on { border-color: var(--dusk); background: var(--accent-bg); }
  .opt input { margin-top: 2px; accent-color: var(--dusk); }
</style>
