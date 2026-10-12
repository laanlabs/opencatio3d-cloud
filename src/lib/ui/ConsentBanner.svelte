<script lang="ts">
  // Asks once whether the planner may count visits. Never shown while no measurement id is configured,
  // when the visitor already chose, or when the browser sends Global Privacy Control (that counts as no).
  import { onMount } from 'svelte';
  import { analyticsEnabled, loadAnalytics, readConsent, writeConsent } from '../analytics';

  let open = $state(false);
  onMount(() => {
    if (!analyticsEnabled()) return;
    const c = readConsent();
    if (c === 'granted') loadAnalytics();
    open = c === null;
  });
  function choose(v: 'granted' | 'denied') { writeConsent(v); open = false; }
</script>

{#if open}
  <div class="consent" role="region" aria-label="Analytics consent">
    <p>May we count visits with Google Analytics? We only see which screens are used — never your designs, which stay in this browser. <a href="https://opencatio3d.com/privacy" target="_blank" rel="noopener">Privacy</a></p>
    <div class="acts">
      <button class="btn primary small" onclick={() => choose('granted')}>Allow analytics</button>
      <button class="btn small" onclick={() => choose('denied')}>No thanks</button>
    </div>
  </div>
{/if}

<style>
  .consent { position: fixed; left: 12px; bottom: 12px; z-index: 80; max-width: min(420px, calc(100vw - 24px)); background: var(--panel); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--shadow); padding: 12px 14px; font-size: 13px; }
  .consent p { margin: 0 0 10px; }
  .acts { display: flex; gap: 6px; }
</style>
