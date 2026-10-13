<script lang="ts">
  // Catio Prowl, loaded on demand: #/prowl (pick a cat and a space), #/prowl/<sampleId> and
  // #/prowl/p/<projectId> (explore one of your own catios).
  import { untrack } from 'svelte';
  import { catalog } from '../../catalog/catalog';
  import { buildSample } from '../../site/samples';
  import { loadProject } from '../../io/storage';
  import { generate } from '../../generate/assembly';
  import { track } from '../../analytics';
  import { buildWorld } from '../world';
  import { readCat } from '../cat';
  import ProwlHub from './ProwlHub.svelte';
  import PlayView from './PlayView.svelte';

  let { arg = '' }: { arg?: string } = $props();
  // App remounts this component on every hash change, so the route argument is read once.
  const route = untrack(() => arg);

  async function load() {
    const project = route.startsWith('p/') ? await loadProject(route.slice(2)) : buildSample(route, catalog);
    if (!project) return null;
    const assembly = generate(project, catalog);
    const world = buildWorld(project, assembly, catalog);
    if (!world) return null;
    track('prowl_start', { space: route.startsWith('p/') ? 'own' : route });
    return { project, assembly, world };
  }
</script>

{#if !route}
  <ProwlHub />
{:else}
  {#await load()}
    <p class="loading muted">Opening the cat flap…</p>
  {:then loaded}
    {#if loaded}
      <PlayView {...loaded} cat={readCat()} />
    {:else}
      <div class="missing">
        <h1>There’s nothing to explore here</h1>
        <p>That catio couldn’t be found, or it has no catio to walk into (a tunnel on its own, for example).</p>
        <a class="btn primary" href="#/prowl">Pick a space</a>
      </div>
    {/if}
  {:catch}
    <div class="missing"><h1>Catio Prowl hit a snag</h1><p>Your saved catios are not affected.</p><a class="btn primary" href="#/prowl">Back to Catio Prowl</a></div>
  {/await}
{/if}

<style>
  .loading { padding: 40vh 16px 0; text-align: center; }
  .missing { max-width: 520px; margin: 15vh auto; padding: 24px; text-align: center; }
  .missing h1 { font-size: 22px; }
</style>
