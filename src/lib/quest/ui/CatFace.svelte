<script lang="ts">
  // A small cat face in the cat's coat colour, for household cards, the event feed and results.
  let { coat, size = 40, mood = 'ok', label = '' }: { coat: string; size?: number; mood?: 'ok' | 'happy' | 'sad' | 'sleep'; label?: string } = $props();
  const dark = $derived(/^#([0-9a-f]{2})/i.test(coat) && parseInt(coat.slice(1, 3), 16) + parseInt(coat.slice(3, 5), 16) + parseInt(coat.slice(5, 7), 16) < 260);
  const ink = $derived(dark ? '#f4efe6' : '#2b2b2e');
</script>

<svg viewBox="0 0 48 48" width={size} height={size} role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : 'true'}>
  <path d="M8 20 L10 5 L20 13 Q24 12 28 13 L38 5 L40 20 Q44 30 37 38 Q31 44 24 44 Q17 44 11 38 Q4 30 8 20 Z" fill={coat} stroke="rgba(0,0,0,.25)" stroke-width="1" />
  <path d="M11.5 9 L13 15 L17 13 Z M36.5 9 L35 15 L31 13 Z" fill="#e8a3a3" opacity=".7" />
  {#if mood === 'sleep'}
    <path d="M14 26 q4 3 8 0 M26 26 q4 3 8 0" stroke={ink} stroke-width="2" fill="none" stroke-linecap="round" />
  {:else}
    <ellipse cx="18" cy="25" rx="3" ry={mood === 'happy' ? 2 : 3.6} fill={ink} />
    <ellipse cx="30" cy="25" rx="3" ry={mood === 'happy' ? 2 : 3.6} fill={ink} />
  {/if}
  <path d="M22 31 L26 31 L24 33.5 Z" fill="#d97a86" />
  {#if mood === 'sad'}
    <path d="M20 38 q4 -3 8 0" stroke={ink} stroke-width="1.6" fill="none" stroke-linecap="round" />
  {:else}
    <path d="M24 33.5 q-2 3 -5 2 M24 33.5 q2 3 5 2" stroke={ink} stroke-width="1.4" fill="none" stroke-linecap="round" />
  {/if}
  <path d="M6 29 h9 M6 33 h9 M42 29 h-9 M42 33 h-9" stroke={ink} stroke-width=".9" opacity=".6" />
</svg>
