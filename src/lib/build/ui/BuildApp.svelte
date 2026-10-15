<script lang="ts">
  // Build mode (#/build/<projectId>): the assembly steps one at a time, with the parts for each step,
  // a 3D view that grows as steps are done, and checks to tick before a step counts as done.
  // Progress saves with the catio (`web.build`, see ../progress). Without a clean check the design is a
  // concept, and the page says so on every step.
  import { untrack } from 'svelte';
  import type { Project } from '../../model/types';
  import { catalog } from '../../catalog/catalog';
  import { generate } from '../../generate/assembly';
  import { activeBlockers, runChecks } from '../../analysis/checks';
  import { saveProject } from '../../io/storage';
  import { partSize, roleName } from '../../generate/roles';
  import { track } from '../../analytics';
  import { allChecked, designChanged, firstOpen, isDone, prune, readProgress, setDone, stepParts, toggleCheck, withProgress, type BuildProgress } from '../progress';
  import StepView from './StepView.svelte';

  let { project: initial }: { project: Project } = $props();
  // App remounts this view on every hash change, so the project is read once; `saved` carries the
  // progress written back to storage.
  const project = untrack(() => initial);
  let saved = project;
  const a = generate(project, catalog);
  const blockers = activeBlockers(runChecks(project, catalog, a));
  const ready = blockers.length === 0 && project.structures.length > 0;
  const u = project.units;
  const steps = a.steps;
  const letter = (id: string) => a.structures.find((s) => s.id === id)?.letter ?? '';
  const structName = (id: string) => project.structures.find((s) => s.id === id)?.name ?? '';
  const matName = (id: string) => catalog.material(id)?.name ?? id;

  const resumed = prune(readProgress(project), steps);
  let progress = $state<BuildProgress>(resumed);
  const changed = designChanged(project, resumed);
  let index = $state(Math.max(0, steps.findIndex((s) => s.id === (resumed.current ?? firstOpen(steps, resumed)?.id))));
  let whole = $state(false);
  let saveState = $state<'saved' | 'saving' | 'error'>('saved');
  const step = $derived(steps[index]);
  const parts = $derived(step ? stepParts(a, step) : { labelled: [], fasteners: [] });
  const doneCount = $derived(steps.filter((s) => isDone(progress, s)).length);
  const finished = $derived(steps.length > 0 && doneCount === steps.length);
  let heading = $state<HTMLHeadingElement>();
  let online = $state(typeof navigator === 'undefined' || navigator.onLine);

  track('build_mode', { steps: steps.length, ready, resumed: resumed.done.length > 0 });

  // Ticks are rare, so each one is written straight away (in order), and none is lost if the tab closes.
  let writing = Promise.resolve();
  function save(next: BuildProgress) {
    progress = next;
    const snapshot = (saved = withProgress(saved, next));
    saveState = 'saving';
    writing = writing.then(() => saveProject(snapshot)).then(() => { if (snapshot === saved) saveState = 'saved'; }, () => { saveState = 'error'; });
  }

  function go(i: number) {
    index = Math.max(0, Math.min(steps.length - 1, i));
    whole = false;
    save({ ...progress, current: steps[index]?.id });
    queueMicrotask(() => heading?.focus());
  }

  function tick(i: number) { if (step) save(toggleCheck(project, progress, step.id, i)); }

  function finishStep() {
    if (!step || !allChecked(progress, step)) return;
    const next = setDone(project, progress, steps, step, true);
    track('build_step_done', { step: step.key });
    if (next.finishedAt && !progress.finishedAt) track('build_finish', { steps: steps.length });
    save(next);
    const open = firstOpen(steps.slice(index + 1), next) ?? firstOpen(steps, next);
    if (open) go(steps.indexOf(open));
    else whole = true;
  }

  function reopen() { if (step) save(setDone(project, progress, steps, step, false)); }
</script>

<svelte:window ononline={() => (online = true)} onoffline={() => (online = false)} />

<div class="build">
  <header class="bar">
    <a class="btn small" href="#/p/{project.id}">← Planner</a>
    <div class="title">
      <h1>Build {project.name}</h1>
      <span class="muted small">{doneCount} of {steps.length} steps done{saveState === 'error' ? ' · not saved — this browser blocked storage' : ''}</span>
    </div>
    <a class="btn small" href="#/print/{project.id}">Build package</a>
  </header>
  <main class="main">
  <div class="meter" role="progressbar" aria-label="Steps done" aria-valuemin="0" aria-valuemax={steps.length} aria-valuenow={doneCount}><span style="width:{steps.length ? (doneCount / steps.length) * 100 : 0}%"></span></div>

  {#if !ready}
    <p class="banner concept"><strong>Concept only.</strong> {blockers.length} {blockers.length === 1 ? 'item blocks' : 'items block'} the build package — fix {blockers.length === 1 ? 'it' : 'them'} in the <a href="#/p/{project.id}">planner</a> before you buy or cut anything. You can still walk through the steps.</p>
  {/if}
  {#if !online}
    <p class="banner" role="status">You’re offline. Build mode keeps working, and your ticks save on this device.</p>
  {/if}
  {#if changed}
    <p class="banner">The design was changed after you started building. Your ticks are kept — check finished steps against the new parts list.</p>
  {/if}

  {#if !steps.length}
    <div class="empty"><p>This catio has no structures to build yet.</p><a class="btn primary" href="#/p/{project.id}">Back to the planner</a></div>
  {:else}
    <div class="body">
      <div class="three">
        <StepView {project} assembly={a} cat={catalog} {step} {whole} />
        <div class="legend" aria-hidden="true">
          {#if whole}The finished catio{:else}<span class="sw now"></span> this step <span class="sw done"></span> already built{/if}
        </div>
        <button class="btn small whole" aria-pressed={whole} onclick={() => (whole = !whole)}>{whole ? 'Back to this step' : 'See it finished'}</button>
      </div>

      <aside class="panel">
        <details class="all" open={false}>
          <summary>All steps</summary>
          <ol>
            {#each steps as s, i (s.id)}
              <li class:here={i === index}><button class="link" onclick={() => go(i)} aria-current={i === index ? 'step' : undefined}><span class="tick" class:on={isDone(progress, s)} aria-hidden="true">{isDone(progress, s) ? '✓' : i + 1}</span>{letter(s.structureId)} · {s.title}<span class="sr-only">{isDone(progress, s) ? ' — done' : ''}</span></button></li>
            {/each}
          </ol>
        </details>

        {#if finished && whole}
          <section class="step done-card">
            <h2 tabindex="-1">Built — every step is done</h2>
            <p>Before the cats go in:</p>
            <ul>
              <li>Walk the inside at cat height: no gaps, sharp wire or loose staples</li>
              <li>Let the cats explore with you there for the first few visits</li>
              <li>Water, shade and a hiding place from day one</li>
              <li>Know how you will bring every cat inside fast (storm, fire, predator)</li>
            </ul>
            <p class="muted small">Monthly and seasonal checks are under “Living with your catio” in the <a href="#/print/{project.id}">build package</a>.</p>
            <div class="row"><a class="btn" href="#/prowl/p/{project.id}">Explore it in Catio Prowl</a></div>
          </section>
        {:else if step}
          <section class="step" aria-labelledby="step-h">
            <p class="eyebrow">Step {index + 1} of {steps.length} · {letter(step.structureId)} {structName(step.structureId)}</p>
            <h2 id="step-h" tabindex="-1" bind:this={heading}>{step.title}{#if isDone(progress, step)} <span class="badge">Done</span>{/if}</h2>

            {#if parts.labelled.length || parts.fasteners.length}
              <h3>Parts</h3>
              {#if parts.labelled.length}
                <table>
                  <thead><tr><th>Label</th><th>Part</th><th>Size</th><th class="num">Qty</th></tr></thead>
                  <tbody>
                    {#each parts.labelled as p (p.id)}
                      <tr><td><b>{p.label}</b></td><td>{roleName(p)}<div class="muted small">{matName(p.materialId)}</div></td><td>{partSize(p, u)}</td><td class="num">{p.qty}</td></tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
              {#if parts.fasteners.length}
                <p class="small fasteners"><b>Fixings:</b> {parts.fasteners.map((f) => `${f.qty} × ${matName(f.materialId)}`).join(' · ')}</p>
              {/if}
            {/if}

            <h3>Check before moving on</h3>
            <ul class="checks">
              {#each step.checklist as c, i (i)}
                <li><label><input type="checkbox" checked={progress.checked[step.id]?.includes(i) ?? false} onchange={() => tick(i)} /> <span>{c}</span></label></li>
              {/each}
            </ul>

            <div class="row">
              <button class="btn" onclick={() => go(index - 1)} disabled={index === 0}>← Back</button>
              {#if isDone(progress, step)}
                <button class="btn" onclick={reopen}>Not done yet</button>
                {#if index < steps.length - 1}<button class="btn primary" onclick={() => go(index + 1)}>Next step →</button>{/if}
              {:else}
                <button class="btn primary" onclick={finishStep} disabled={!allChecked(progress, step)}>{index < steps.length - 1 ? 'Step done — next →' : 'Last step done'}</button>
              {/if}
            </div>
            {#if !isDone(progress, step) && !allChecked(progress, step)}<p class="muted small">Tick every check to finish this step.</p>{/if}
          </section>
        {/if}
      </aside>
    </div>
  {/if}
  </main>
</div>

<style>
  .build { min-height: 100dvh; display: flex; flex-direction: column; background: var(--bg); }
  .bar { display: flex; align-items: center; gap: 10px; padding: max(8px, env(safe-area-inset-top)) 12px 8px; border-bottom: 1px solid var(--line); background: var(--panel); }
  .title { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .title h1 { font-size: 16px; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .main { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .meter { height: 4px; background: var(--line); }
  .meter span { display: block; height: 100%; background: var(--leaf); transition: width .3s; }
  .banner { margin: 0; padding: 8px 14px; font-size: 13px; background: var(--accent-bg); border-bottom: 1px solid var(--line); }
  .banner.concept { background: #fdf0e0; }
  .body { flex: 1; display: grid; grid-template-columns: minmax(0, 1fr) min(420px, 42vw); min-height: 0; }
  .three { position: relative; min-height: 320px; }
  .legend { position: absolute; left: 10px; top: 10px; background: rgba(255, 255, 255, .9); border-radius: 10px; padding: 4px 10px; font-size: 12px; display: flex; align-items: center; gap: 6px; }
  .sw { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
  .sw.now { background: #e8a93a; }
  .sw.done { background: #b9a477; margin-left: 6px; }
  .whole { position: absolute; right: 10px; bottom: 10px; }
  .panel { border-left: 1px solid var(--line); background: var(--panel); overflow: auto; padding: 12px 16px 24px; max-height: calc(100dvh - 60px); }
  .all summary { cursor: pointer; font-weight: 700; font-size: 13px; padding: 4px 0; }
  .all ol { list-style: none; margin: 6px 0 10px; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  .all li button { background: none; border: 0; color: inherit; font: inherit; cursor: pointer; display: flex; gap: 8px; align-items: center; width: 100%; text-align: left; padding: 4px 6px; border-radius: 8px; font-size: 13px; }
  .all li.here button { background: var(--accent-bg); font-weight: 700; }
  .tick { flex: none; width: 20px; height: 20px; border-radius: 50%; border: 1.5px solid var(--mesh); display: grid; place-items: center; font-size: 11px; font-weight: 700; }
  .tick.on { background: var(--leaf); border-color: var(--leaf); color: #fff; }
  .step h2 { font-size: 20px; margin: 2px 0 8px; outline: none; }
  .step h3 { font-size: 13px; margin: 14px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .eyebrow { margin: 6px 0 0; font-size: 12px; color: var(--cedar); font-weight: 700; }
  .badge { font-size: 11px; background: var(--leaf); color: #fff; border-radius: 999px; padding: 2px 8px; vertical-align: middle; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-size: 11px; color: var(--muted); font-weight: 600; }
  .num { text-align: right; }
  .fasteners { margin: 8px 0 0; }
  .checks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .checks label { display: flex; gap: 10px; align-items: flex-start; font-size: 14px; cursor: pointer; padding: 6px 8px; border-radius: 10px; background: var(--bg); }
  .checks input { width: 20px; height: 20px; flex: none; margin: 1px 0 0; accent-color: var(--leaf); }
  .row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
  .done-card ul { padding-left: 18px; font-size: 14px; }
  .empty { padding: 40px 16px; text-align: center; }
  @media (max-width: 760px) {
    .body { grid-template-columns: 1fr; grid-template-rows: 42vh auto; }
    .three { min-height: 0; }
    .panel { border-left: 0; border-top: 1px solid var(--line); max-height: none; }
  }
</style>
