<script lang="ts">
  // Modal dialog: focus moves in on open and back to the opener on close; Escape and the backdrop close it;
  // Tab stays inside.
  import { onMount, type Snippet } from 'svelte';
  let { title, onclose, children, wide = false }: { title: string; onclose: () => void; children: Snippet; wide?: boolean } = $props();
  let box: HTMLDivElement;
  const opener = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
  const focusables = () => [...box.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')];
  onMount(() => {
    (focusables()[0] ?? box).focus();
    return () => opener?.focus?.();
  });
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); onclose(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
  <div class="dialog" class:wide bind:this={box} role="dialog" aria-modal="true" aria-label={title} tabindex="-1" onkeydown={onKey}>
    <header>
      <h2>{title}</h2>
      <button class="x" onclick={onclose} aria-label="Close">×</button>
    </header>
    <div class="body">{@render children()}</div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(24, 36, 58, .35); z-index: 100; display: grid; place-items: center; padding: 16px; }
  .dialog { background: var(--panel); border-radius: 14px; box-shadow: var(--shadow); width: min(480px, 100%); max-height: calc(100vh - 32px); overflow: auto; outline: none; }
  .dialog.wide { width: min(760px, 100%); }
  header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 0; }
  h2 { margin: 0; font-size: 17px; }
  .x { border: 0; background: none; font-size: 24px; line-height: 1; cursor: pointer; color: var(--ink-soft); width: 36px; height: 36px; border-radius: 8px; }
  .x:hover { background: var(--bg); }
  .body { padding: 12px 16px 16px; }
</style>
