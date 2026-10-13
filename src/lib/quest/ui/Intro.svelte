<script lang="ts">
  // Meet the household: who the cats are, what they need, the site, budget, weather and goals.
  import { onMount } from 'svelte';
  import type { Scenario } from '../types';
  import { PERSONALITIES } from '../personalities';
  import { money } from '../../model/units';
  import CatFace from './CatFace.svelte';

  let { sc, onstart, onback, resumed = false }: { sc: Scenario; onstart: () => void; onback: () => void; resumed?: boolean } = $props();
  let heading: HTMLHeadingElement;
  onMount(() => heading?.focus());
  const NEEDS: Record<string, string> = { rest: 'naps', lookout: 'a high lookout', hide: 'a hiding place', play: 'play', scratch: 'scratching', drink: 'water', toilet: 'a litter box', greens: 'greenery', comfort: 'shelter from weather' };
  const topNeeds = (id: keyof typeof PERSONALITIES) => Object.entries(PERSONALITIES[id].needs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n]) => NEEDS[n]);
</script>

<div class="intro">
  <header class="top"><button class="btn small" onclick={onback}>← All scenarios</button></header>
  <main>
    <p class="eyebrow">{sc.daily ? 'Daily Challenge' : 'Catio Quest'}</p>
    <h1 bind:this={heading} tabindex="-1">{sc.title}</h1>
    <p class="story">{sc.story}</p>

    <h2>Meet the household</h2>
    <ul class="cats">
      {#each sc.cats as c (c.id)}
        {@const per = PERSONALITIES[c.personality]}
        <li class="cat">
          <CatFace coat={c.coat} size={64} mood="happy" />
          <div>
            <strong>{c.name}</strong> <span class="per">{per.emoji} {per.name}</span>
            <p>{c.bio}</p>
            <p class="muted small">Loves {topNeeds(c.personality).join(', ')}.{c.ageClass === 'senior' ? ' Senior.' : ''}{c.ageClass === 'kitten' ? ' Kitten.' : ''}{c.mobility !== 'full' ? ' Can’t jump high.' : ''}{c.escapeRisk === 'high' ? ' Escape artist!' : ''}</p>
          </div>
        </li>
      {/each}
    </ul>

    <div class="cols">
      <section>
        <h2>Goals</h2>
        <ul class="goals">{#each sc.goals as g (g.id)}<li>🎯 {g.label}</li>{/each}</ul>
        <p class="muted small">Pass with {sc.pass}+ overall, every goal met, and Safety of at least {sc.minSafety}.</p>
      </section>
      <section>
        <h2>The site</h2>
        <ul class="facts">
          {#each sc.constraints as c}<li>{c}</li>{/each}
          <li>Weather: {sc.climate.label}</li>
          {#if sc.budget}<li>Budget: {money(sc.budget)} (best-price estimate)</li>{/if}
        </ul>
      </section>
    </div>

    <div class="go">
      <button class="btn primary big" onclick={onstart}>{resumed ? 'Keep building →' : 'Start building →'}</button>
    </div>
  </main>
</div>

<style>
  .intro { min-height: 100vh; background: var(--bg); }
  .top { padding: 10px 14px; background: var(--panel); border-bottom: 1px solid var(--border); }
  main { width: min(860px, 100%); margin: 0 auto; padding: 8px 16px 48px; }
  .eyebrow { margin: 22px 0 0; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--cedar); }
  h1 { font-size: clamp(26px, 4.4vw, 38px); margin: 6px 0 8px; outline: none; }
  .story { font-size: 16px; color: var(--body); }
  h2 { font-size: 17px; margin: 24px 0 10px; }
  .cats { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
  .cat { display: flex; gap: 12px; align-items: flex-start; background: var(--panel); border: 1px solid var(--border); border-radius: 16px; padding: 12px; }
  .cat p { margin: 4px 0 0; font-size: 13px; }
  .per { font-size: 12px; font-weight: 700; color: var(--cedar); }
  .small { font-size: 12px; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .goals, .facts { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .facts li::before { content: '• '; color: var(--cedar); }
  .go { margin-top: 24px; }
  @media (max-width: 640px) { .cols { grid-template-columns: 1fr; } }
</style>
