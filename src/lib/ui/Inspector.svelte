<script lang="ts">
  // The selected item at a glance, with the actions that apply to it. Detailed editing lives in the
  // workspace panels; this jumps there.
  import type { Editor } from './editor.svelte';
  import type { SiteObstacle, Structure, StructureOpening, Furnishing, HostWall, WallOpening, Workspace } from '../model/types';
  import { frontHeight } from '../model/types';
  import LengthInput from './LengthInput.svelte';
  import { fmtLen } from '../model/units';

  let { editor, onclose }: { editor: Editor; onclose?: () => void } = $props();
  const sel = $derived(editor.selection);
  const item = $derived(sel ? editor.find(sel) : undefined);
  const s = $derived(editor.selectedStructure);
  const findings = $derived(sel ? editor.findings.filter((f) => f.status === 'open' && f.targetIds.includes(sel.id) && f.severity !== 'info') : []);
  const go = (w: Workspace) => editor.setWorkspace(w);
  const OPEN_NAME: Record<string, string> = { 'human-door': 'Human door', 'cat-door': 'Cat door', 'window-access': 'Window insert', 'cleaning-hatch': 'Cleaning hatch', vestibule: 'Vestibule' };
</script>

{#if sel && item}
  <div class="insp">
    <header>
      <h3>
        {#if sel.kind === 'structure'}{(item as Structure).name}
        {:else if sel.kind === 'opening'}{OPEN_NAME[(item as StructureOpening).kind]}
        {:else if sel.kind === 'furnishing'}{editor.cat.component((item as Furnishing).componentId)?.name ?? 'Item'}
        {:else if sel.kind === 'wall'}House wall
        {:else if sel.kind === 'wall-opening'}{(item as WallOpening).name || (item as WallOpening).kind}
        {:else if sel.kind === 'obstacle'}{(item as SiteObstacle).name || (item as SiteObstacle).kind}
        {:else}Plant{/if}
      </h3>
      {#if onclose}<button class="x" onclick={onclose} aria-label="Close details">×</button>{/if}
    </header>

    {#if sel.kind === 'structure'}
      {@const st = item as Structure}
      <p class="muted">{editor.cat.template(st.template)?.name} · {st.template === 'tunnel' ? `${fmtLen(st.width, editor.units)} × ${fmtLen(st.height, editor.units)} section` : `${fmtLen(st.width, editor.units)} × ${fmtLen(st.depth, editor.units)} × ${fmtLen(st.height, editor.units)}${frontHeight(st) !== st.height ? `–${fmtLen(frontHeight(st), editor.units)}` : ''}`}</p>
      <div class="row">
        <button class="btn small" onclick={() => go('structure')}>Size & roof</button>
        <button class="btn small" onclick={() => go('access')}>Doors</button>
        <button class="btn small" onclick={() => go('enrichment')}>Shelves & cats</button>
        <button class="btn small" onclick={() => go('materials')}>Materials</button>
      </div>
      {#if !editor.readonly}
        <div class="row">
          {#if !st.hostWallId}<button class="btn small" onclick={() => editor.rotateSelected(15)}>Rotate 15°</button>{/if}
          <button class="btn small" onclick={() => editor.duplicateSelected()}>Duplicate</button>
          <button class="btn small danger" onclick={() => editor.removeSelected()}>Delete</button>
        </div>
      {/if}
    {:else if sel.kind === 'obstacle'}
      {@const o = item as SiteObstacle}
      <div class="grid2">
        <label class="field">Width <LengthInput value={o.width} units={editor.units} disabled={editor.readonly} onchange={(v) => editor.updateObstacle(o.id, { width: v })} label="Width" /></label>
        <label class="field">Depth <LengthInput value={o.depth} units={editor.units} disabled={editor.readonly} onchange={(v) => editor.updateObstacle(o.id, { depth: v })} label="Depth" /></label>
      </div>
      <label class="field">Label <input type="text" value={o.name ?? ''} disabled={editor.readonly} onchange={(e) => editor.updateObstacle(o.id, { name: (e.currentTarget as HTMLInputElement).value || undefined })} /></label>
      {#if !editor.readonly}<button class="btn small danger" onclick={() => editor.removeSelected()}>Delete</button>{/if}
    {:else if sel.kind === 'opening'}
      <p class="muted">On {s?.name}. Edit it in Doors & access.</p>
      <div class="row"><button class="btn small" onclick={() => go('access')}>Edit</button>{#if !editor.readonly}<button class="btn small danger" onclick={() => editor.removeSelected()}>Delete</button>{/if}</div>
    {:else if sel.kind === 'furnishing'}
      <p class="muted">In {s?.name}. Edit it in Enrichment.</p>
      <div class="row"><button class="btn small" onclick={() => go('enrichment')}>Edit</button>{#if !editor.readonly}<button class="btn small danger" onclick={() => editor.removeSelected()}>Delete</button>{/if}</div>
    {:else if sel.kind === 'wall' || sel.kind === 'wall-opening'}
      <p class="muted">{sel.kind === 'wall' ? `${fmtLen(Math.hypot((item as HostWall).b[0] - (item as HostWall).a[0], (item as HostWall).b[1] - (item as HostWall).a[1]), editor.units)} long, ${fmtLen((item as HostWall).height, editor.units)} high.` : 'Edit windows, doors, vents and meters in Site.'}</p>
      <div class="row"><button class="btn small" onclick={() => go('site')}>Edit in Site</button>{#if !editor.readonly}<button class="btn small danger" onclick={() => editor.removeSelected()}>Delete</button>{/if}</div>
    {/if}

    {#if findings.length}
      <ul class="fl">
        {#each findings as f (f.id)}<li><span class="badge {f.severity}">{f.severity}</span> {f.title}</li>{/each}
      </ul>
      <button class="btn small" onclick={() => go('checks')}>See checks</button>
    {/if}
  </div>
{/if}

<style>
  .insp { padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
  header { display: flex; justify-content: space-between; align-items: center; }
  h3 { margin: 0; font-size: 15px; text-transform: none; }
  p { margin: 0; font-size: 13px; }
  .x { border: 0; background: none; font-size: 22px; cursor: pointer; color: var(--muted); width: 32px; height: 32px; }
  .fl { list-style: none; margin: 0; padding: 0; font-size: 12px; display: flex; flex-direction: column; gap: 4px; }
</style>
