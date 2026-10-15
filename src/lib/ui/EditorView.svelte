<script lang="ts">
  // The planner: top bar, workspace rail + panel, plan/3D viewport and the selection inspector.
  // On phones the panel becomes a bottom sheet and the rail a bottom tab bar.
  import { onMount } from 'svelte';
  import type { Project, ViewMode, Workspace } from '../model/types';
  import { Editor } from './editor.svelte';
  import PlanView from './PlanView.svelte';
  import Viewer3D from './Viewer3D.svelte';
  import SitePanel from './SitePanel.svelte';
  import StructurePanel from './StructurePanel.svelte';
  import AccessPanel from './AccessPanel.svelte';
  import EnrichmentPanel from './EnrichmentPanel.svelte';
  import MaterialsPanel from './MaterialsPanel.svelte';
  import ChecksPanel from './ChecksPanel.svelte';
  import OutputPanel from './OutputPanel.svelte';
  import Inspector from './Inspector.svelte';
  import Dialog from './Dialog.svelte';
  import Logo from './Logo.svelte';
  import { download, dataUrlToBlob } from '../io/download';
  import { fileName, sortedJson, toOpenPlan } from '../io/openplan';
  import { bomCsv, cutListCsv } from '../io/csv';
  import { iosImportUrl, shareUrl, transferJson } from '../io/transfer';
  import { sendToOpenPlan } from '../io/handoff';
  import { saveProject } from '../io/storage';
  import { planSvg, svgToPng } from '../scene/drawings';
  import { tally } from '../analysis/checks';
  import { clone, uid } from '../model/types';
  import { track } from '../analytics';

  let { project, readonly = false, workspace }: { project: Project; readonly?: boolean; workspace?: Workspace } = $props();

  // svelte-ignore state_referenced_locally
  const editor = new Editor(project, { readonly });
  // svelte-ignore state_referenced_locally
  if (workspace) editor.workspace = workspace;
  let plan: PlanView | undefined = $state();
  let viewer: Viewer3D | undefined = $state();
  let narrow = $state(false);
  let sheet = $state(false);
  let share = $state<{ url: string; kind: 'view' | 'ios' } | null>(null);
  let copied = $state(false);
  let renaming = $state(false);
  let importNote = $state('');

  const p = $derived(editor.project);
  const counts = $derived(tally(editor.findings));
  const WS: { id: Workspace; name: string; icon: string }[] = [
    { id: 'site', name: 'Site', icon: 'M3 20h18M5 20V10l7-5 7 5v10M9 20v-6h6v6' },
    { id: 'structure', name: 'Structure', icon: 'M4 20V9l8-4 8 4v11M4 9h16M8 20V9M12 20V5M16 20V9M4 14h16' },
    { id: 'access', name: 'Doors', icon: 'M6 21V3h12v18M6 21h12M14 12h1' },
    { id: 'enrichment', name: 'Cats & plants', icon: 'M5 19c0-4 3-7 7-7s7 3 7 7M8 9l-2-5 4 3M16 9l2-5-4 3M9 11h.01M15 11h.01' },
    { id: 'materials', name: 'Materials', icon: 'M3 7h18M3 12h18M3 17h18M7 4v16M12 4v16M17 4v16' },
    { id: 'checks', name: 'Checks', icon: 'M5 12l4 4L19 6' },
    { id: 'output', name: 'Output', icon: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7' }
  ];
  const VIEWS: { id: ViewMode; name: string }[] = [{ id: '2d', name: 'Plan' }, { id: '3d', name: '3D' }, { id: 'split', name: 'Split' }];

  // Placing happens in the plan: when a tool is picked, show the plan and, on phones, get the sheet out of the way.
  $effect(() => {
    if (!editor.placing) return;
    if (editor.view === '3d') editor.setView(narrow ? '2d' : 'split');
    if (narrow) sheet = false;
  });

  function pick(w: Workspace) {
    editor.setWorkspace(w);
    if (narrow) sheet = true;
  }

  function onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable], [role="dialog"]') || e.defaultPrevented) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); editor.redo(); return; }
    if (mod || e.altKey) return;
    if (e.key === 'Escape') { if (editor.placing) editor.placing = null; else if (sheet) sheet = false; else editor.selection = null; return; }
    if (['1', '2', '3'].includes(e.key)) { editor.setView((['2d', '3d', 'split'] as const)[Number(e.key) - 1]); return; }
    if (editor.readonly || !editor.selection) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); editor.removeSelected(); }
    else if (e.key.toLowerCase() === 'd') editor.duplicateSelected();
    else if (e.key.toLowerCase() === 'r') editor.rotateSelected(e.shiftKey ? -15 : 15);
    else if (e.key.startsWith('Arrow') && plan) {
      e.preventDefault();
      const f = e.shiftKey ? 4 : 1;
      plan.nudge(e.key === 'ArrowLeft' ? -f : e.key === 'ArrowRight' ? f : 0, e.key === 'ArrowUp' ? -f : e.key === 'ArrowDown' ? f : 0);
    }
  }

  onMount(() => {
    const mq = matchMedia('(max-width: 860px)');
    const set = () => { narrow = mq.matches; if (narrow && editor.view === 'split') editor.view = '3d'; };
    set();
    mq.addEventListener('change', set);
    const flush = () => { void editor.flush(); };
    const onHidden = () => { if (document.hidden) flush(); };
    addEventListener('pagehide', flush);
    addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onHidden);
    try { importNote = sessionStorage.getItem('oc3d-import-note') ?? ''; sessionStorage.removeItem('oc3d-import-note'); } catch { /* storage blocked */ }
    if (importNote) editor.notify(importNote);
    return () => {
      mq.removeEventListener('change', set);
      removeEventListener('pagehide', flush);
      removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onHidden);
      flush();
    };
  });

  async function ensure3d() {
    if (!viewer) { editor.setView(narrow ? '3d' : 'split'); await new Promise((r) => setTimeout(r, 400)); }
    return viewer;
  }

  async function exportAs(kind: 'print' | 'build' | 'bom' | 'cuts' | 'json' | 'plan' | 'png' | 'glb' | 'share' | 'ios' | 'openplan') {
    track('export', { kind });
    const pr = editor.project, a = editor.assembly;
    try {
      switch (kind) {
        case 'print': await editor.flush(); location.hash = `#/print/${pr.id}`; return;
        case 'build': await editor.flush(); location.hash = `#/build/${pr.id}`; return;
        case 'bom': download(fileName(pr, 'shopping-list', 'csv'), bomCsv(a), 'text/csv;charset=utf-8'); return;
        case 'cuts': download(fileName(pr, 'cut-list', 'csv'), cutListCsv(a), 'text/csv;charset=utf-8'); return;
        case 'json': download(fileName(pr, 'opencatio3d', 'json'), JSON.stringify(toOpenPlan(pr, editor.cat), null, 2), 'application/json'); return;
        case 'plan': download(fileName(pr, 'plan', 'png'), await svgToPng(planSvg(pr, a, editor.units, { width: 2400 }), 2400)); return;
        case 'png': { const v = await ensure3d(); if (v) download(fileName(pr, '3d', 'png'), await dataUrlToBlob(v.screenshot())); return; }
        case 'glb': { const v = await ensure3d(); if (v) download(fileName(pr, 'model', 'glb'), await v.exportGlb()); return; }
        case 'share': share = { url: await shareUrl(pr, editor.cat), kind: 'view' }; copied = false; return;
        case 'ios': share = { url: await iosImportUrl(pr, editor.cat), kind: 'ios' }; copied = false; return;
        case 'openplan': {
          try { window.open(await sendToOpenPlan(transferJson(pr, editor.cat)), '_blank', 'noopener'); }
          catch (e) {
            download(fileName(pr, 'openplan3d', 'json'), sortedJson(toOpenPlan(pr, editor.cat, { embedWebProject: false })), 'application/json');
            editor.notify(`${e instanceof Error ? e.message : 'OpenPlan3D could not be reached.'} Downloaded the file instead — use Import JSON in OpenPlan3D.`);
          }
          return;
        }
      }
    } catch (e) {
      editor.notify(e instanceof Error ? e.message : 'Export failed');
    }
  }

  async function copyLink() {
    if (!share) return;
    try { await navigator.clipboard.writeText(share.url); copied = true; } catch { copied = false; }
  }

  async function makeEditableCopy() {
    const now = new Date().toISOString();
    const copy: Project = { ...clone(editor.project), id: uid(), name: `${editor.project.name} (copy)`, createdAt: now, updatedAt: now };
    await saveProject(copy);
    location.hash = `#/p/${copy.id}`;
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="editor" class:narrow>
  <header class="bar">
    <a href="#/" class="home" aria-label="All catios"><Logo size={26} /></a>
    {#if renaming && !editor.readonly}
      <!-- svelte-ignore a11y_autofocus -->
      <input class="name" type="text" value={p.name} aria-label="Project name" autofocus onblur={(e) => { editor.rename((e.currentTarget as HTMLInputElement).value.trim() || p.name); renaming = false; }} onkeydown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.currentTarget as HTMLInputElement).blur(); }} />
    {:else}
      <button class="title" onclick={() => (renaming = !editor.readonly)} title={editor.readonly ? '' : 'Rename'}>{p.name}</button>
    {/if}
    {#if editor.readonly}<span class="badge info">View only</span>{:else}<span class="save muted" role="status">{editor.saveState === 'saving' ? 'Saving…' : editor.saveState === 'error' ? 'Not saved' : 'Saved'}</span>{/if}
    <div class="spacer"></div>
    {#if !editor.readonly}
      <button class="btn small icon" onclick={() => editor.undo()} disabled={!editor.undoCount} aria-label="Undo" title="Undo (⌘Z)">↶</button>
      <button class="btn small icon" onclick={() => editor.redo()} disabled={!editor.redoCount} aria-label="Redo" title="Redo (⇧⌘Z)">↷</button>
    {/if}
    <div class="seg views" role="group" aria-label="View">
      {#each VIEWS as v (v.id)}{#if !(narrow && v.id === 'split')}<button aria-pressed={editor.view === v.id} onclick={() => editor.setView(v.id)}>{v.name}</button>{/if}{/each}
    </div>
    {#if editor.readonly}
      <button class="btn small primary" onclick={makeEditableCopy}>Make an editable copy</button>
    {:else}
      <button class="btn small primary" onclick={() => pick('output')}>{editor.buildReady ? 'Build plan' : 'Output'}</button>
    {/if}
  </header>

  <div class="body">
    <nav class="rail" aria-label="Workspaces">
      {#each WS as w (w.id)}
        <button class:on={editor.workspace === w.id} aria-current={editor.workspace === w.id ? 'page' : undefined} onclick={() => pick(w.id)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={w.icon} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
          <span>{w.name}</span>
          {#if w.id === 'checks' && counts.blocker + counts.warning}<i class="dot" class:red={counts.blocker > 0}>{counts.blocker + counts.warning}</i>{/if}
        </button>
      {/each}
    </nav>

    <aside class="panel" class:open={sheet} aria-label="{WS.find((w) => w.id === editor.workspace)?.name} panel">
      {#if narrow}<div class="sheet-head"><strong>{WS.find((w) => w.id === editor.workspace)?.name}</strong><button class="btn small" onclick={() => (sheet = false)}>Done</button></div>{/if}
      {#if editor.workspace === 'site'}<SitePanel {editor} />
      {:else if editor.workspace === 'structure'}<StructurePanel {editor} />
      {:else if editor.workspace === 'access'}<AccessPanel {editor} />
      {:else if editor.workspace === 'enrichment'}<EnrichmentPanel {editor} />
      {:else if editor.workspace === 'materials'}<MaterialsPanel {editor} />
      {:else if editor.workspace === 'checks'}<ChecksPanel {editor} />
      {:else}<OutputPanel {editor} onexport={exportAs} />{/if}
    </aside>

    <main class="viewport view-{editor.view}">
      {#if editor.view !== '3d'}<div class="pane"><PlanView {editor} bind:this={plan} /></div>{/if}
      {#if editor.view !== '2d'}<div class="pane"><Viewer3D {editor} bind:this={viewer} compact={editor.view === 'split'} /></div>{/if}
      {#if !p.structures.length && !editor.readonly && !editor.placing}
        <div class="empty">
          <p><strong>Start with a structure.</strong> Choose one in Structure, then place it in the plan — attached catios snap to the house wall and window.</p>
          <button class="btn primary small" onclick={() => { pick('structure'); editor.placing = { kind: 'structure', template: 'lean-to' }; }}>Place a lean-to</button>
        </div>
      {/if}
    </main>

    {#if editor.selection && !narrow}
      <aside class="inspector" aria-label="Selection"><Inspector {editor} onclose={() => (editor.selection = null)} /></aside>
    {/if}
  </div>
  {#if narrow && editor.selection && !sheet}
    <div class="mini"><Inspector {editor} onclose={() => (editor.selection = null)} /></div>
  {/if}

  {#if editor.toast}<div class="toast" role="status">{editor.toast.text}</div>{/if}
</div>

{#if share}
  <Dialog title={share.kind === 'view' ? 'Share a view-only link' : 'Open on iPhone or iPad'} onclose={() => (share = null)}>
    {#if share.kind === 'view'}
      <p class="small">Anyone with the link sees this design read-only. The whole design travels inside the link — nothing is uploaded.</p>
    {:else}
      <p class="small">Open this link on a device with the OpenCatio3D app installed (or AirDrop it). The design travels inside the link.</p>
    {/if}
    <textarea readonly rows="4" class="link" aria-label="Link">{share.url}</textarea>
    {#if share.url.length > 8000}<p class="small muted">This link is long; some messaging apps cut long links. Email or the project file is more reliable.</p>{/if}
    <div class="row end">
      {#if share.kind === 'view'}<a class="btn" href={share.url} target="_blank" rel="noopener">Open</a>{/if}
      <button class="btn primary" onclick={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
    </div>
  </Dialog>
{/if}

<style>
  .editor { position: fixed; inset: 0; display: flex; flex-direction: column; background: var(--bg); }
  .bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--panel); min-height: 52px; }
  .home { display: inline-flex; }
  .title { border: 0; background: none; font-weight: 700; font-size: 15px; cursor: text; padding: 4px 6px; border-radius: 6px; max-width: 32vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); }
  .title:hover { background: var(--bg); }
  .name { font-weight: 700; max-width: 40vw; }
  .save { font-size: 12px; }
  .spacer { flex: 1; }
  .icon { width: 34px; padding: 0; font-size: 16px; }
  .body { flex: 1; display: flex; min-height: 0; }
  .rail { width: 76px; display: flex; flex-direction: column; gap: 2px; padding: 6px; border-right: 1px solid var(--border); background: var(--panel); overflow-y: auto; }
  .rail button { position: relative; border: 0; background: none; border-radius: 10px; padding: 8px 2px; display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 11px; font-weight: 600; color: var(--muted); cursor: pointer; }
  .rail button svg { width: 22px; height: 22px; }
  .rail button:hover { background: var(--bg); color: var(--ink); }
  .rail button.on { background: var(--accent-bg); color: var(--dusk-dark); }
  .dot { position: absolute; top: 4px; right: 8px; font-style: normal; background: var(--warning); color: #fff; border-radius: 999px; font-size: 10px; min-width: 16px; height: 16px; line-height: 16px; padding: 0 4px; }
  .dot.red { background: var(--blocker); }
  .panel { width: 340px; flex: none; overflow-y: auto; background: var(--panel); border-right: 1px solid var(--border); }
  .viewport { flex: 1; min-width: 0; position: relative; display: grid; }
  .viewport.view-split { grid-template-rows: 1fr 1fr; }
  @media (min-width: 1300px) { .viewport.view-split { grid-template-rows: none; grid-template-columns: 1fr 1fr; } }
  .pane { position: relative; min-height: 0; min-width: 0; border-bottom: 1px solid var(--border); }
  .inspector { width: 270px; flex: none; overflow-y: auto; background: var(--panel); border-left: 1px solid var(--border); }
  .empty { position: absolute; left: 50%; top: 16px; transform: translateX(-50%); background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 12px 14px; max-width: min(460px, calc(100% - 32px)); font-size: 13px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .empty p { margin: 0; }
  .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--dusk-dark); color: #fff; padding: 10px 16px; border-radius: 10px; font-size: 13px; box-shadow: var(--shadow); z-index: 90; max-width: calc(100vw - 32px); }
  .link { width: 100%; font-family: var(--mono); font-size: 11px; resize: none; }
  .small { font-size: 13px; }
  .end { justify-content: flex-end; margin-top: 10px; }

  /* Phones and small tablets: full-bleed viewport, tab bar at the bottom, panel as a sheet. */
  .narrow .body { flex-direction: column-reverse; }
  .narrow .rail { width: auto; flex-direction: row; border-right: 0; border-top: 1px solid var(--border); overflow-x: auto; padding: 4px; padding-bottom: max(4px, env(safe-area-inset-bottom)); }
  .narrow .rail button { flex: 1; min-width: 50px; padding: 6px 1px; font-size: 10px; }
  .narrow .panel { position: fixed; left: 0; right: 0; bottom: 0; height: 72vh; width: auto; z-index: 50; border-radius: 16px 16px 0 0; box-shadow: var(--shadow); transform: translateY(105%); transition: transform .2s ease; border: 0; }
  .narrow .panel.open { transform: none; }
  .sheet-head { position: sticky; top: 0; z-index: 1; display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: var(--panel); border-bottom: 1px solid var(--border); }
  .narrow .views { order: 0; }
  .narrow .title { max-width: 30vw; }
  .narrow .save { display: none; }
  .mini { position: fixed; left: 8px; right: 8px; bottom: 74px; z-index: 40; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); max-height: 40vh; overflow: auto; }
</style>
