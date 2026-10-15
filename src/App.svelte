<script lang="ts">
  import { onMount } from 'svelte';
  import Home from './lib/ui/Home.svelte';
  import ConsentBanner from './lib/ui/ConsentBanner.svelte';
  import { trackScreen, type Screen } from './lib/analytics';
  import type { Project, Workspace } from './lib/model/types';
  import { findSampleCopies, loadProject, saveProject } from './lib/io/storage';
  import { decodePayload } from './lib/io/transfer';
  import { fromOpenPlan, isOpenPlanJson, isWebProject } from './lib/io/openplan';
  import { newProjectOptions, parseRoute, parseWorkspace } from './lib/io/routes';
  import { catalog } from './lib/catalog/catalog';
  import { sampleCopy } from './lib/site/samples';
  import { newProject } from './lib/site/templates';
  import { localeUnits } from './lib/model/units';

  // The editor (with three.js), build package and import page load on demand, so Home stays light.
  const loadEditor = () => import('./lib/ui/EditorView.svelte');
  const loadPrint = () => import('./lib/ui/PrintView.svelte');
  const loadBuild = () => import('./lib/build/ui/BuildApp.svelte');
  const loadImport = () => import('./lib/ui/ImportView.svelte');
  // Catio Quest (the game) is its own chunk too.
  const loadQuest = () => import('./lib/quest/ui/QuestApp.svelte');
  // Catio Prowl (be the cat) likewise.
  const loadProwl = () => import('./lib/prowl/ui/ProwlApp.svelte');

  type Route =
    | { name: 'home' }
    | { name: 'editor'; project: Project; workspace?: Workspace }
    | { name: 'print'; project: Project }
    | { name: 'build'; project: Project }
    | { name: 'view'; project: Project }
    | { name: 'import'; version: string; payload: string }
    | { name: 'quest'; arg: string }
    | { name: 'prowl'; arg: string }
    | { name: 'loading' }
    | { name: 'missing'; message: string };

  let route = $state<Route>({ name: 'loading' });
  let key = $state(0);
  let homeNotice = $state('');
  let seq = 0;

  const STORAGE_MESSAGE = "This browser can't open its saved catios right now (a private window or blocked storage can cause this). Nothing was deleted.";

  async function resolve() {
    const mine = ++seq;
    const { head, rest, query } = parseRoute(location.hash);
    const arg = decodeURIComponent(rest.join('/'));
    try {
      if (head === 'p' || head === 'print' || head === 'build') {
        let project: Project | undefined;
        try { project = await loadProject(arg); } catch { return finish(mine, { name: 'missing', message: STORAGE_MESSAGE }); }
        if (!project) return finish(mine, { name: 'missing', message: 'This catio is not in this browser. Projects are stored locally — open it on the device where you made it, or import its file.' });
        if (head === 'print') return finish(mine, { name: 'print', project });
        if (head === 'build') return finish(mine, { name: 'build', project });
        const workspace = parseWorkspace(query);
        if (query.toString()) history.replaceState(null, '', `#/p/${project.id}`);
        return finish(mine, { name: 'editor', project, workspace });
      }
      if (head === 'new') {
        const p = newProject(newProjectOptions(query, localeUnits()), catalog);
        await saveProject(p);
        location.replace(`#/p/${p.id}`);
        return;
      }
      if (head === 'sample') {
        // Reuse the visitor's untouched copy rather than piling up duplicates; an edited copy stays theirs.
        const copies = await findSampleCopies(arg).catch(() => []);
        const pristine = copies.find((c) => c.createdAt && c.createdAt === c.updatedAt);
        if (pristine) { location.replace(`#/p/${pristine.id}`); return; }
        const p = sampleCopy(arg, catalog);
        if (p) {
          await saveProject(p);
          location.replace(`#/p/${p.id}`);
          return;
        }
        homeNotice = `There's no sample catio called “${arg}”. Pick one of the samples below.`;
        history.replaceState(null, '', '#/');
        return finish(mine, { name: 'home' });
      }
      if (head === 'quest') return finish(mine, { name: 'quest', arg: rest[0] ?? '' });
      if (head === 'prowl') return finish(mine, { name: 'prowl', arg: rest.join('/') });
      if (head === 'import' && rest.length >= 2) return finish(mine, { name: 'import', version: rest[0], payload: rest.slice(1).join('/') });
      if (head === 'view' && rest.length >= 2) {
        try {
          if (rest[0] !== 'v1') throw new Error('unsupported');
          const j = await decodePayload(rest.slice(1).join('/'));
          if (!isWebProject(j) && !isOpenPlanJson(j)) throw new Error('not a catio');
          return finish(mine, { name: 'view', project: fromOpenPlan(j as Record<string, unknown>, catalog) });
        } catch (e) {
          const tooLarge = e instanceof Error && /too large/i.test(e.message);
          return finish(mine, { name: 'missing', message: tooLarge ? 'This link is too large to open.' : 'This share link is incomplete or damaged.' });
        }
      }
      if (route.name !== 'home') homeNotice = '';
      finish(mine, { name: 'home' });
    } catch {
      if (mine === seq) { route = { name: 'missing', message: STORAGE_MESSAGE }; key++; }
    }
  }

  function finish(mine: number, r: Route) {
    if (mine !== seq) return; // a newer navigation won
    route = r;
    key++;
    const screens: Record<string, Screen> = { home: 'home', editor: 'editor', view: 'view', print: 'print', build: 'build', import: 'import', missing: 'missing', quest: 'quest', prowl: 'prowl' };
    if (screens[r.name]) trackScreen(screens[r.name]);
    document.title = 'project' in r ? `${r.project.name} — OpenCatio3D` : r.name === 'quest' ? 'Catio Quest — build their dream catio · OpenCatio3D' : r.name === 'prowl' ? 'Catio Prowl — a day in the life of your cat · OpenCatio3D' : 'OpenCatio3D — design a safe, buildable catio in 3D';
  }

  function downloadProject(p: Project) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }));
    a.download = `${p.name.replace(/[^\w-]+/g, '-') || 'catio'}-opencatio3d.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  onMount(() => {
    resolve();
    addEventListener('hashchange', resolve);
    return () => removeEventListener('hashchange', resolve);
  });
</script>

{#snippet failedSnippet(project: Project | undefined)}
  <div class="missing">
    <h2>This catio could not be opened</h2>
    <p>Something in it is damaged or unexpected. Your other projects are not affected.</p>
    <div class="acts">
      <a class="btn primary" href="#/">Back to your catios</a>
      {#if project}<button class="btn" onclick={() => downloadProject(project)}>Download project file</button>{/if}
    </div>
  </div>
{/snippet}

{#key key}
  {#if route.name === 'home'}
    <Home notice={homeNotice} />
  {:else if route.name === 'editor' || route.name === 'view'}
    {@const r = route}
    <svelte:boundary>
      {#await loadEditor()}
        <p class="loading muted">Loading the planner…</p>
      {:then { default: EditorView }}
        <EditorView project={r.project} readonly={r.name === 'view'} workspace={r.name === 'editor' ? r.workspace : undefined} />
      {/await}
      {#snippet failed()}{@render failedSnippet(r.project)}{/snippet}
    </svelte:boundary>
  {:else if route.name === 'import'}
    {@const r = route}
    {#await loadImport()}
      <p class="loading muted">Loading…</p>
    {:then { default: ImportView }}
      <ImportView version={r.version} payload={r.payload} />
    {/await}
  {:else if route.name === 'quest'}
    {@const r = route}
    <svelte:boundary>
      {#await loadQuest()}
        <p class="loading muted">Loading Catio Quest…</p>
      {:then { default: QuestApp }}
        <QuestApp arg={r.arg} />
      {/await}
      {#snippet failed()}
        <div class="missing"><h2>Catio Quest hit a snag</h2><p>Something went wrong loading the game. Your saved catios are not affected.</p><a class="btn primary" href="#/quest">Back to Catio Quest</a></div>
      {/snippet}
    </svelte:boundary>
  {:else if route.name === 'prowl'}
    {@const r = route}
    <svelte:boundary>
      {#await loadProwl()}
        <p class="loading muted">Loading Catio Prowl…</p>
      {:then { default: ProwlApp }}
        <ProwlApp arg={r.arg} />
      {/await}
      {#snippet failed()}
        <div class="missing"><h2>Catio Prowl hit a snag</h2><p>Something went wrong loading the game. Your saved catios are not affected.</p><a class="btn primary" href="#/prowl">Back to Catio Prowl</a></div>
      {/snippet}
    </svelte:boundary>
  {:else if route.name === 'build'}
    {@const r = route}
    <svelte:boundary>
      {#await loadBuild()}
        <p class="loading muted">Laying out the steps…</p>
      {:then { default: BuildApp }}
        <BuildApp project={r.project} />
      {/await}
      {#snippet failed()}{@render failedSnippet(r.project)}{/snippet}
    </svelte:boundary>
  {:else if route.name === 'print'}
    {@const r = route}
    <svelte:boundary>
      {#await loadPrint()}
        <p class="loading muted">Preparing the build package…</p>
      {:then { default: PrintView }}
        <PrintView project={r.project} />
      {/await}
      {#snippet failed()}{@render failedSnippet(r.project)}{/snippet}
    </svelte:boundary>
  {:else if route.name === 'missing'}
    <div class="missing">
      <h2>Catio not found</h2>
      <p>{route.message}</p>
      <a class="btn primary" href="#/">Go to your catios</a>
    </div>
  {:else}
    <p class="loading muted">Loading…</p>
  {/if}
{/key}

{#if route.name !== 'print'}<ConsentBanner />{/if}

<style>
  .missing { max-width: 520px; margin: 15vh auto; padding: 24px; text-align: center; }
  .acts { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
  .loading { text-align: center; margin-top: 30vh; }
</style>
