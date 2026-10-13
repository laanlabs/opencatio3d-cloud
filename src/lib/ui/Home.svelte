<script lang="ts">
  // Home: start from a template or a sample, reopen a saved catio, or import a file. No three.js here.
  import { onMount } from 'svelte';
  import Logo from './Logo.svelte';
  import MiniPlan from './MiniPlan.svelte';
  import Dialog from './Dialog.svelte';
  import { catalog } from '../catalog/catalog';
  import type { Project, TemplateId } from '../model/types';
  import { clone, uid } from '../model/types';
  import { deleteProject, listProjects, loadProject, saveProject, type ProjectSummary } from '../io/storage';
  import { fromOpenPlan, isOpenPlanJson, isWebProject } from '../io/openplan';
  import { takeSanitizeReport } from '../io/validate';
  import { newProject } from '../site/templates';
  import { SAMPLES, buildSample } from '../site/samples';
  import { localeUnits } from '../model/units';
  import { track } from '../analytics';

  let { notice = '' }: { notice?: string } = $props();

  let projects = $state<ProjectSummary[]>([]);
  let loaded = $state(false);
  let storageError = $state('');
  let message = $state('');
  let confirmDelete = $state<ProjectSummary | null>(null);
  let fileInput: HTMLInputElement;

  const MAIN: TemplateId[] = ['lean-to', 'window-box', 'freestanding', 'tunnel'];
  const ICON: Record<string, string> = {
    'lean-to': 'M4 30V12l24 6v12M4 12h0M8 30V13M14 30V14.5M20 30V16M26 30V17.5',
    'window-box': 'M4 4v26M10 12h16v10H10zM14 12v10M18 12v10M22 12v10M8 24l4-2M28 24l-4-2',
    freestanding: 'M5 30V12h22v18M5 12l11-4 11 4M10 30V12M16 30V8M22 30V12M5 20h22',
    tunnel: 'M3 24h26M3 16h26M3 16v8M29 16v8M9 16v8M15 16v8M21 16v8M27 16v8'
  };
  const samples = SAMPLES.map((s) => ({ ...s, project: buildSample(s.id, catalog)! }));

  async function refresh() {
    try { projects = await listProjects(); storageError = ''; }
    catch { storageError = "This browser can't store projects right now (a private window or blocked storage can cause this). You can still try the samples."; }
    loaded = true;
  }
  onMount(refresh);

  async function start(template: TemplateId | 'blank') {
    const p = newProject({ template, units: localeUnits(), name: template === 'blank' ? 'My catio' : `My ${catalog.template(template)?.name.toLowerCase().replace(/ \(concept\)$/, '')}` }, catalog);
    track('new_project', { template });
    try { await saveProject(p); location.hash = `#/p/${p.id}`; }
    catch { message = "Couldn't save a new project in this browser."; }
  }

  async function duplicate(s: ProjectSummary) {
    const p = await loadProject(s.id);
    if (!p) return;
    const now = new Date().toISOString();
    const copy: Project = { ...clone(p), id: uid(), name: `${p.name} copy`, createdAt: now, updatedAt: now, web: { ...p.web, sampleId: undefined } };
    await saveProject(copy);
    await refresh();
  }

  async function remove(s: ProjectSummary) {
    confirmDelete = null;
    await deleteProject(s.id);
    await refresh();
    message = `Deleted “${s.name}”.`;
  }

  async function importFile(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = '';
    if (!f) return;
    try {
      if (f.size > 20 * 1024 * 1024) throw new Error('That file is too large to be a catio project.');
      const j = JSON.parse(await f.text());
      if (!isWebProject(j) && !isOpenPlanJson(j)) throw new Error('That file is not an OpenCatio3D or OpenPlan3D project.');
      const p = fromOpenPlan(j, catalog, f.name.replace(/\.json$/i, ''));
      const report = takeSanitizeReport();
      if (projects.some((x) => x.id === p.id)) { p.id = uid(); p.name = `${p.name} (imported)`; }
      await saveProject(p);
      track('import', { kind: 'file' });
      if (report.count) sessionStorage.setItem('oc3d-import-note', `Imported, but left out ${report.dropped.join(', ')}.`);
      location.hash = `#/p/${p.id}`;
    } catch (err) {
      message = err instanceof SyntaxError ? 'That file is not valid JSON.' : err instanceof Error ? err.message : 'Import failed.';
    }
  }

  const when = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };
</script>

<div class="home">
  <header class="top">
    <a href="https://opencatio3d.com" class="brand" aria-label="OpenCatio3D home page"><Logo word /></a>
    <nav>
      <a href="https://opencatio3d.com/guides" target="_blank" rel="noopener">Guides</a>
      <button class="btn small" onclick={() => fileInput.click()}>Import file…</button>
      <input type="file" accept=".json,application/json" bind:this={fileInput} onchange={importFile} hidden />
    </nav>
  </header>

  <main>
    <section class="hero">
      <h1>Design a safe, buildable catio around your home — in 3D.</h1>
      <p class="lede">Fit it to your real space, check common risks, and get a practical material plan: cut list, shopping list, cost range and build steps. Free, in your browser — nothing to sign up for.</p>
      {#if notice}<p class="notice" role="status">{notice}</p>{/if}
      {#if message}<p class="notice" role="status">{message}</p>{/if}
    </section>

    <section aria-labelledby="start-h">
      <h2 id="start-h">Start a catio</h2>
      <div class="templates">
        {#each MAIN as id (id)}
          {@const t = catalog.template(id)!}
          <button class="tcard" onclick={() => start(id)}>
            <svg viewBox="0 0 32 32" aria-hidden="true"><path d={ICON[id]} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <strong>{t.name}</strong>
            <span>{t.summary}</span>
          </button>
        {/each}
      </div>
      <p class="more">
        Concept only: <button class="link" onclick={() => start('porch-infill')}>porch infill</button> · <button class="link" onclick={() => start('balcony-concept')}>balcony</button> · or <button class="link" onclick={() => start('blank')}>start with just the house wall</button>.
      </p>
    </section>

    <a class="quest" href="#/quest">
      <span class="q-ico" aria-hidden="true">🐾</span>
      <span class="q-body"><strong>Catio Quest — the game</strong><span>Build a catio for a household of cats, then let them explore. Seven scenarios and a daily challenge. Free, no account.</span></span>
      <span class="q-go">Play →</span>
    </a>

    <section aria-labelledby="samples-h">
      <h2 id="samples-h">Explore a sample</h2>
      <div class="samples">
        {#each samples as s (s.id)}
          <a class="scard" href="#/sample/{s.id}">
            <MiniPlan project={s.project} height={110} />
            <strong>{s.name}</strong>
            <span>{s.blurb}</span>
          </a>
        {/each}
      </div>
    </section>

    <section aria-labelledby="mine-h">
      <h2 id="mine-h">Your catios</h2>
      {#if storageError}
        <p class="muted">{storageError}</p>
      {:else if !loaded}
        <p class="muted">Loading…</p>
      {:else if !projects.length}
        <p class="muted">Nothing saved yet. Projects are stored in this browser only; export a file to move one to another device.</p>
      {:else}
        <ul class="list">
          {#each projects as s (s.id)}
            <li>
              <a href="#/p/{s.id}" class="name">{s.name}</a>
              <span class="muted meta">{s.structures} {s.structures === 1 ? 'structure' : 'structures'}{s.updatedAt ? ` · ${when(s.updatedAt)}` : ''}</span>
              <span class="acts">
                <button class="btn small" onclick={() => duplicate(s)}>Duplicate</button>
                <button class="btn small danger" onclick={() => (confirmDelete = s)}>Delete</button>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </main>

  <footer>
    <p>OpenCatio3D gives planning guidance, not certification. Checks report what the current rules detect; local codes, HOA or landlord rules, structural and veterinary questions need the right professional.</p>
    <p><a href="https://opencatio3d.com/privacy">Privacy</a> · <a href="https://opencatio3d.com/terms">Terms</a> · <a href="https://opencatio3d.com/trust#methodology">How the checks work</a></p>
  </footer>
</div>

{#if confirmDelete}
  {@const s = confirmDelete}
  <Dialog title="Delete “{s.name}”?" onclose={() => (confirmDelete = null)}>
    <p>This removes it from this browser. Exported files and shared links are not affected.</p>
    <div class="row end">
      <button class="btn" onclick={() => (confirmDelete = null)}>Cancel</button>
      <button class="btn primary" onclick={() => remove(s)}>Delete</button>
    </div>
  </Dialog>
{/if}

<style>
  .home { min-height: 100vh; display: flex; flex-direction: column; }
  .top { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); background: var(--panel); position: sticky; top: 0; z-index: 5; }
  .brand { text-decoration: none; }
  nav { display: flex; align-items: center; gap: 12px; }
  nav a { color: var(--ink); font-weight: 600; text-decoration: none; }
  main { width: min(1080px, 100%); margin: 0 auto; padding: 8px 16px 40px; flex: 1; }
  .hero h1 { font-size: clamp(26px, 4.4vw, 40px); line-height: 1.12; margin: 28px 0 10px; max-width: 18em; }
  .lede { font-size: 16px; color: var(--body); max-width: 40em; margin: 0 0 8px; }
  .notice { background: var(--cedar-tint); border-radius: 10px; padding: 10px 12px; }
  h2 { font-size: 18px; margin: 32px 0 12px; }
  .templates { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .tcard { text-align: left; display: flex; flex-direction: column; gap: 6px; padding: 14px; border: 1px solid var(--border); border-radius: 14px; background: var(--panel); cursor: pointer; color: var(--ink); }
  .tcard:hover { border-color: var(--dusk); box-shadow: var(--shadow); }
  .tcard svg { width: 44px; height: 44px; color: var(--cedar); }
  .tcard strong { font-size: 15px; }
  .tcard span, .scard span { font-size: 13px; color: var(--body); }
  .more { font-size: 13px; color: var(--muted); }
  .link { border: 0; background: none; padding: 0; color: var(--cedar); text-decoration: underline; cursor: pointer; font-size: 13px; }
  .quest { display: flex; align-items: center; gap: 14px; margin-top: 28px; padding: 14px 16px; border-radius: 16px; background: var(--dusk); color: #fff; text-decoration: none; }
  .quest:hover { background: var(--dusk-dark); }
  .q-ico { font-size: 30px; }
  .q-body { flex: 1; display: flex; flex-direction: column; gap: 3px; }
  .q-body span { font-size: 13px; color: #dfe6ef; }
  .q-go { font-weight: 800; color: var(--sun); white-space: nowrap; }
  .samples { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .scard { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--border); border-radius: 14px; background: var(--panel); text-decoration: none; color: var(--ink); }
  .scard:hover { border-color: var(--dusk); box-shadow: var(--shadow); }
  .list { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 12px; background: var(--panel); }
  .list li { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-top: 1px solid var(--border); flex-wrap: wrap; }
  .list li:first-child { border-top: 0; }
  .name { font-weight: 700; color: var(--ink); text-decoration: none; }
  .name:hover { text-decoration: underline; }
  .meta { font-size: 12px; }
  .acts { margin-left: auto; display: flex; gap: 6px; }
  footer { border-top: 1px solid var(--border); padding: 16px; font-size: 12px; color: var(--muted); text-align: center; }
  footer p { margin: 4px auto; max-width: 60em; }
  .end { justify-content: flex-end; margin-top: 12px; }
</style>
