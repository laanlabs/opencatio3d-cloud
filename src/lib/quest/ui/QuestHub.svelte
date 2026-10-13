<script lang="ts">
  // Catio Quest hub: the scenarios (with stars earned in this browser), today's Daily Challenge and
  // badges. Everything is free; scenarios open up by playing, nothing is bought.
  import Logo from '../../ui/Logo.svelte';
  import { SCENARIOS } from '../scenarios';
  import { dailyScenario, utcDate } from '../daily';
  import { BADGES, isUnlocked, readProgress } from '../progress';
  import CatFace from './CatFace.svelte';

  const progress = readProgress();
  const ids = SCENARIOS.map((s) => s.id);
  const today = utcDate();
  const daily = dailyScenario(today);
  const best = (id: string) => progress.best[id];
  const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(3 - n);
  const DIFF = ['', 'Easy', 'Medium', 'Tricky'];
</script>

<div class="hub">
  <header class="top">
    <a href="#/" class="brand" aria-label="OpenCatio3D planner"><Logo word /></a>
    <span class="links"><a class="btn small" href="#/prowl">Play Catio Prowl</a> <a class="btn small" href="#/">Open the planner</a></span>
  </header>
  <main>
    <section class="intro">
      <p class="eyebrow">A free game from OpenCatio3D</p>
      <h1>Catio Quest — build their dream catio</h1>
      <p class="lede">Meet a household of cats, build them a catio with real parts, then <strong>let them explore</strong>. They’ll show you what works: the high lookout, the hideaway, the gap they squeezed through. Fix it, score stars, and take your favourite into the real planner.</p>
    </section>

    <a class="daily" href="#/quest/daily">
      <span class="d-ico" aria-hidden="true">📅</span>
      <span class="d-body">
        <strong>Daily Challenge · {today}</strong>
        <span>{daily.tagline} Same challenge for everyone today.</span>
        <span class="d-cats">{#each daily.cats as c (c.id)}<CatFace coat={c.coat} size={26} label={c.name} />{/each}</span>
      </span>
      <span class="d-go">{best(daily.id) ? stars(best(daily.id).stars) : 'Play →'}</span>
    </a>

    <h2>Scenarios</h2>
    <ol class="grid">
      {#each SCENARIOS as sc, i (sc.id)}
        {@const open = isUnlocked(ids, sc.id, progress)}
        {@const b = best(sc.id)}
        <li>
          {#if open}
            <a class="card" href="#/quest/{sc.id}">
              <span class="num">{i + 1}</span>
              <strong>{sc.title}</strong>
              <span class="tag">{sc.tagline}</span>
              <span class="cats">{#each sc.cats as c (c.id)}<CatFace coat={c.coat} size={28} label={c.name} />{/each}</span>
              <span class="meta"><span class="diff">{DIFF[sc.difficulty]}</span>{#if b}<span class="stars" aria-label="{b.stars} stars, best score {b.overall}">{stars(b.stars)} · {b.overall}</span>{/if}</span>
            </a>
          {:else}
            <div class="card locked" aria-disabled="true">
              <span class="num">🔒</span>
              <strong>{sc.title}</strong>
              <span class="tag">Pass “{SCENARIOS[i - 1].title}” to open this one.</span>
            </div>
          {/if}
        </li>
      {/each}
    </ol>

    <h2>Badges</h2>
    <ul class="badges">
      {#each Object.entries(BADGES) as [id, bd] (id)}
        <li class:got={progress.badges.includes(id)}><span aria-hidden="true">{bd.icon}</span> <strong>{bd.name}</strong><span class="muted">{progress.badges.includes(id) ? 'Earned' : bd.how}</span></li>
      {/each}
    </ul>

    <p class="fine">Progress is saved only in this browser. No account, no ads, nothing to buy. Game layouts are concepts — the scoring teaches real catio design (from the same safety checks as the planner), but a game result isn’t a build plan or a safety certification.</p>
  </main>
</div>

<style>
  .hub { min-height: 100vh; background: var(--bg); }
  .top { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: var(--panel); border-bottom: 1px solid var(--border); }
  .brand { text-decoration: none; }
  main { width: min(1040px, 100%); margin: 0 auto; padding: 8px 16px 48px; }
  .eyebrow { margin: 24px 0 0; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--cedar); }
  h1 { font-size: clamp(26px, 4.4vw, 40px); line-height: 1.12; margin: 6px 0 10px; }
  .lede { font-size: 16px; max-width: 44em; color: var(--body); }
  h2 { font-size: 18px; margin: 28px 0 12px; }
  .daily { display: flex; align-items: center; gap: 14px; padding: 14px 16px; border-radius: 16px; background: var(--dusk); color: #fff; text-decoration: none; margin-top: 16px; }
  .daily:hover { background: var(--dusk-dark); }
  .d-ico { font-size: 30px; }
  .d-body { flex: 1; display: flex; flex-direction: column; gap: 3px; }
  .d-body span { font-size: 13px; color: #dfe6ef; }
  .d-cats { display: flex; gap: 2px; }
  .d-go { font-weight: 800; color: var(--sun); white-space: nowrap; }
  .grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .card { height: 100%; display: flex; flex-direction: column; gap: 6px; padding: 14px; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); text-decoration: none; color: var(--ink); position: relative; }
  a.card:hover { border-color: var(--dusk); box-shadow: var(--shadow); }
  .card.locked { opacity: .65; }
  .num { font-size: 12px; font-weight: 800; color: var(--cedar); }
  .tag { font-size: 13px; color: var(--body); }
  .cats { display: flex; gap: 2px; }
  .meta { display: flex; justify-content: space-between; align-items: center; margin-top: auto; font-size: 12px; }
  .diff { font-weight: 700; color: var(--muted); }
  .stars { color: var(--sun); font-weight: 700; letter-spacing: 1px; }
  .badges { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
  .badges li { display: grid; grid-template-columns: 28px 1fr; gap: 0 6px; padding: 10px; border-radius: 12px; border: 1px dashed var(--border); font-size: 13px; }
  .badges li:not(.got) span:first-child { opacity: .5; filter: grayscale(1); }
  .badges li.got { opacity: 1; border-style: solid; background: var(--panel); }
  .badges li span:first-child { grid-row: span 2; font-size: 20px; }
  .fine { margin-top: 28px; font-size: 12px; color: var(--muted); max-width: 52em; }
</style>
