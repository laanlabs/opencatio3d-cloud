<script lang="ts">
  let { size = 28, word = false }: { size?: number; word?: boolean } = $props();
</script>

<span class="logo">
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--dusk)" />
    <path d="M7 26V14l4.5-6 2.5 4h4l2.5-4 4.5 6v12z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" />
    <path d="M11 18h10M11 22h10M14 15v11M18 15v11" stroke="var(--sun)" stroke-width="1.3" stroke-linecap="round" />
  </svg>
  {#if word}<span class="word">OpenCatio<b>3D</b></span>{/if}
</span>

<style>
  .logo { display: inline-flex; align-items: center; gap: 8px; color: var(--ink); }
  .word { font-weight: 800; font-size: 17px; letter-spacing: -.02em; }
  .word b { color: var(--cedar); font-weight: 800; }
</style>
