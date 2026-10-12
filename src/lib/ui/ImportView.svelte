<script lang="ts">
  // Import from a transfer link (#/import/v1/<payload>, e.g. from the iOS app): show what arrives, then
  // open it as a new project, replace the saved copy, or keep both.
  import { onMount } from 'svelte';
  import type { Project } from '../model/types';
  import { uid } from '../model/types';
  import { catalog } from '../catalog/catalog';
  import { decodePayload } from '../io/transfer';
  import { fromOpenPlan, isOpenPlanJson, isWebProject } from '../io/openplan';
  import { takeSanitizeReport } from '../io/validate';
  import { loadProject, saveProject } from '../io/storage';
  import MiniPlan from './MiniPlan.svelte';
  import { track } from '../analytics';

  let { version, payload }: { version: string; payload: string } = $props();
  let project = $state<Project | null>(null);
  let existing = $state<Project | null>(null);
  let error = $state('');
  let dropped = $state<string[]>([]);

  onMount(async () => {
    try {
      if (version !== 'v1') throw new Error('This link was made by a newer version of OpenCatio3D. Update the app or open it on opencatio3d.com.');
      const j = await decodePayload(payload);
      if (!isWebProject(j) && !isOpenPlanJson(j)) throw new Error('This link does not contain a catio.');
      project = fromOpenPlan(j as Record<string, unknown>, catalog);
      dropped = takeSanitizeReport().dropped;
      existing = (await loadProject(project.id).catch(() => undefined)) ?? null;
    } catch (e) {
      error = e instanceof Error && !(e instanceof SyntaxError) ? e.message : 'This link is incomplete or damaged.';
    }
  });

  async function open(mode: 'new' | 'replace' | 'both') {
    if (!project) return;
    const p = mode === 'both' ? { ...project, id: uid(), name: `${project.name} (from link)` } : project;
    await saveProject(p);
    track('import', { kind: 'link', mode });
    location.replace(`#/p/${p.id}`);
  }
</script>

<div class="imp">
  {#if error}
    <h2>Couldn’t open this link</h2>
    <p>{error}</p>
    <a class="btn primary" href="#/">Go to your catios</a>
  {:else if !project}
    <p class="muted">Reading the link…</p>
  {:else}
    <h2>Open “{project.name}”?</h2>
    <MiniPlan {project} height={160} />
    <p class="muted">{project.structures.length} {project.structures.length === 1 ? 'structure' : 'structures'} · {project.cats.length} {project.cats.length === 1 ? 'cat' : 'cats'}{project.captureSource === 'ios' ? ' · from the iOS app' : ''}</p>
    {#if dropped.length}<p class="warn">Some parts of the link could not be read and were left out: {dropped.join(', ')}.</p>{/if}
    <div class="row">
      {#if existing}
        <button class="btn primary" onclick={() => open('replace')}>Replace my saved copy</button>
        <button class="btn" onclick={() => open('both')}>Keep both</button>
      {:else}
        <button class="btn primary" onclick={() => open('new')}>Open in the planner</button>
      {/if}
      <a class="btn" href="#/">Cancel</a>
    </div>
  {/if}
</div>

<style>
  .imp { max-width: 520px; margin: 12vh auto; padding: 24px; display: flex; flex-direction: column; gap: 12px; }
  h2 { margin: 0; }
  .warn { background: #fdf0dc; color: var(--warning); padding: 8px 10px; border-radius: 8px; font-size: 13px; }
</style>
