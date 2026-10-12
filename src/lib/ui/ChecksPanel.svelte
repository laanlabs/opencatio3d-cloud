<script lang="ts">
  // Checks workspace: findings by severity with the rule's explanation, remedy and sources. Warnings and
  // advisories can be acknowledged with a note; reviewable blockers take a recorded professional review.
  import type { Editor } from './editor.svelte';
  import type { Finding } from '../analysis/checks';
  import { tally } from '../analysis/checks';
  import Dialog from './Dialog.svelte';

  let { editor }: { editor: Editor } = $props();
  const counts = $derived(tally(editor.findings));
  const open = $derived(editor.findings.filter((f) => f.status === 'open'));
  const settled = $derived(editor.findings.filter((f) => f.status !== 'open'));
  const LABEL = { blocker: 'Blocks the build package', warning: 'Warning', advisory: 'Advisory', info: 'Note' } as const;
  let acking = $state<{ f: Finding; kind: 'acknowledge' | 'professional-review' } | null>(null);
  let note = $state('');
  let by = $state('');

  function save() {
    if (!acking || !note.trim()) return;
    editor.acknowledge(acking.f, note.trim(), acking.kind, acking.kind === 'professional-review' ? by.trim() || undefined : undefined);
    acking = null; note = ''; by = '';
  }
</script>

<section class="summary">
  <div class="row">
    <span class="badge blocker">{counts.blocker} blocking</span>
    <span class="badge warning">{counts.warning} warnings</span>
    <span class="badge advisory">{counts.advisory} advisories</span>
  </div>
  {#if !open.some((f) => f.severity !== 'info')}
    <p class="ok"><strong>No issue detected by the current rules.</strong> That is not a safety approval — check local codes and have elevated or attached work reviewed.</p>
  {:else}
    <p class="muted small">Guidance, not certification. Fix what you can; acknowledge only what you understand and accept.</p>
  {/if}
</section>

{#snippet card(f: Finding)}
  <article class="f {f.severity}" class:settled={f.status !== 'open'}>
    <header>
      <span class="badge {f.severity}">{LABEL[f.severity]}</span>
      <code>{f.ruleId}</code>
    </header>
    <h4>{f.title}</h4>
    <p>{f.message}</p>
    <p class="fix"><strong>What to do:</strong> {f.remediation}</p>
    {#if f.sources.length}
      <p class="src">Sources: {#each f.sources as s, i}{#if i}, {/if}<a href={s.url} target="_blank" rel="noopener">{s.title}</a>{/each}</p>
    {/if}
    {#if f.status !== 'open'}<p class="acked">{f.status === 'reviewed' ? 'Professional review recorded' : 'Acknowledged'}: “{f.note}”</p>{/if}
    <div class="row">
      {#if f.targetIds.length}<button class="btn small" onclick={() => editor.selectTarget(f)}>Show</button>{/if}
      {#if !editor.readonly}
        {#if f.status !== 'open'}<button class="btn small" onclick={() => editor.unacknowledge(f)}>Undo</button>
        {:else if f.acknowledgeable}<button class="btn small" onclick={() => (acking = { f, kind: 'acknowledge' })}>Acknowledge…</button>
        {:else if f.reviewable}<button class="btn small" onclick={() => (acking = { f, kind: 'professional-review' })}>Record professional review…</button>{/if}
      {/if}
    </div>
  </article>
{/snippet}

<div class="list">
  {#each open as f (f.id)}{@render card(f)}{/each}
  {#if settled.length}
    <h3>Acknowledged and reviewed</h3>
    {#each settled as f (f.id)}{@render card(f)}{/each}
  {/if}
</div>

{#if acking}
  <Dialog title={acking.kind === 'professional-review' ? 'Record a professional review' : 'Acknowledge this finding'} onclose={() => (acking = null)}>
    <p class="small"><strong>{acking.f.title}.</strong> {acking.kind === 'professional-review' ? 'Who reviewed the design, and what did they confirm?' : 'Say why it is acceptable for your site. The note goes into the build package.'}</p>
    {#if acking.kind === 'professional-review'}<label class="field">Reviewer and role <input type="text" bind:value={by} placeholder="e.g. J. Rivera, licensed contractor" /></label>{/if}
    <label class="field">Note <textarea rows="3" bind:value={note}></textarea></label>
    <div class="row end">
      <button class="btn" onclick={() => (acking = null)}>Cancel</button>
      <button class="btn primary" disabled={!note.trim()} onclick={save}>Save</button>
    </div>
  </Dialog>
{/if}

<style>
  .summary { padding: 12px 14px; border-bottom: 1px solid var(--border); }
  .ok { background: #e3efe6; color: var(--leaf); padding: 10px; border-radius: 10px; font-size: 13px; margin: 8px 0 0; }
  .small { font-size: 12px; }
  .list { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
  h3 { font-size: 13px; margin: 8px 0 0; color: var(--muted); }
  .f { border: 1px solid var(--border); border-left: 4px solid var(--info); border-radius: 10px; padding: 10px; background: var(--panel); font-size: 13px; }
  .f.blocker { border-left-color: var(--blocker); }
  .f.warning { border-left-color: var(--warning); }
  .f.advisory { border-left-color: var(--advisory); }
  .f.settled { opacity: .75; }
  .f header { display: flex; justify-content: space-between; align-items: center; }
  code { font-size: 11px; color: var(--muted); }
  h4 { margin: 6px 0 4px; font-size: 14px; }
  .f p { margin: 4px 0; }
  .fix { color: var(--body); }
  .src { font-size: 12px; color: var(--muted); }
  .acked { font-size: 12px; font-style: italic; }
  .end { justify-content: flex-end; margin-top: 10px; }
  textarea { width: 100%; resize: vertical; }
</style>
