<script lang="ts">
  // Results: stars, goals, the seven scores with what went into each and how to improve, the safety
  // inspection (the real checks in plain words), then revise, share a card, or continue the layout in
  // the planner as a concept project.
  import { onMount } from 'svelte';
  import { catalog } from '../../catalog/catalog';
  import { saveProject } from '../../io/storage';
  import { track } from '../../analytics';
  import type { QuestGame } from '../game.svelte';
  import { SCORE_ICON, SCORE_LABEL, findingText, gameFindings } from '../score';
  import { SCORE_KEYS, type Scenario } from '../types';
  import { toPlannerProject } from '../convert';
  import { resultCard, shareCard } from '../card';
  import { BADGES, recordResult } from '../progress';
  import { SCENARIOS } from '../scenarios';
  import CatFace from './CatFace.svelte';

  let { game, next, onrevise, onwatch, onhub }: { game: QuestGame; next?: Scenario; onrevise: () => void; onwatch: () => void; onhub: () => void } = $props();

  const ev = $derived(game.evaluation!);
  const r = $derived(ev.result);
  const issues = $derived(gameFindings(ev.findings).filter((f) => f.severity !== 'info'));
  const happyByCat = $derived(Object.fromEntries(ev.sim.stats.cats.map((c) => [c.id, c])));
  let earned = $state<string[]>([]);
  let busy = $state('');
  let message = $state('');
  let heading: HTMLHeadingElement;

  onMount(() => {
    earned = recordResult(game.sc, r, SCENARIOS.map((x) => x.id));
    track('quest_complete', { scenario: game.sc.daily ? 'daily' : game.sc.id, stars: r.stars });
    heading?.focus();
  });

  async function share() {
    busy = 'share';
    try {
      const how = await shareCard(await resultCard(game.sc, ev.project, r), game.sc);
      message = how === 'downloaded' ? 'Result card saved to your downloads.' : 'Shared.';
      track('quest_share', { scenario: game.sc.daily ? 'daily' : game.sc.id });
    } catch { message = 'Couldn’t make the card in this browser.'; }
    busy = '';
  }

  async function continueInPlanner() {
    busy = 'continue';
    try {
      const p = toPlannerProject(game.sc, game.layout, catalog, { result: r });
      await saveProject(p);
      track('quest_continue', { scenario: game.sc.daily ? 'daily' : game.sc.id });
      location.hash = `#/p/${p.id}`;
    } catch { message = 'Couldn’t save a project in this browser (private windows can block storage).'; busy = ''; }
  }
  const tone = (v: number) => (v >= 70 ? 'good' : v >= 45 ? 'mid' : 'low');
</script>

<div class="results">
  <header class="top">
    <button class="btn small" onclick={onhub}>← All scenarios</button>
    <span class="muted">{game.sc.title}</span>
  </header>
  <main>
    <section class="hero" class:passed={r.passed}>
      <p class="stars" aria-label="{r.stars} of 3 stars">{'★'.repeat(r.stars)}<span class="off">{'☆'.repeat(3 - r.stars)}</span></p>
      <h1 bind:this={heading} tabindex="-1">{r.passed ? (r.stars === 3 ? 'A dream catio!' : 'The cats approve!') : 'Not quite yet'}</h1>
      <p class="overall"><strong>{r.overall}</strong> / 100 <span class="muted">· needs {game.sc.pass} with every goal met and Safety at least {game.sc.minSafety}</span></p>
      <ul class="goals">
        {#each r.goals as g (g.id)}<li class:met={g.met}><span aria-hidden="true">{g.met ? '✅' : '⬜'}</span> {g.label}<span class="sr-only">{g.met ? ' — met' : ' — not yet'}</span></li>{/each}
      </ul>
      <div class="cats">
        {#each game.sc.cats as c (c.id)}
          {@const st = happyByCat[c.id]}
          <div class="cat"><CatFace coat={c.coat} size={44} mood={st?.escaped ? 'sad' : (st?.happiness ?? 0) >= 0.62 ? 'happy' : (st?.happiness ?? 0) < 0.5 ? 'sad' : 'ok'} /><span>{c.name}</span><span class="muted small">{st?.escaped ? 'got out!' : `${Math.round((st?.happiness ?? 0) * 100)}% content`}</span></div>
        {/each}
      </div>
      {#if earned.length}
        <p class="badges" role="status">New badge{earned.length === 1 ? '' : 's'}: {#each earned as b}<span class="badge ok">{BADGES[b].icon} {BADGES[b].name}</span> {/each}</p>
      {/if}
      <div class="acts">
        <button class="btn primary big" onclick={onrevise}>✏️ Revise the design</button>
        <button class="btn big" onclick={onwatch}>▶ Watch again</button>
        <button class="btn big" onclick={share} disabled={busy === 'share'}>📤 Share result card</button>
        <button class="btn big" onclick={continueInPlanner} disabled={busy === 'continue'}>🏗️ Continue in OpenCatio3D</button>
        {#if r.passed && next}<a class="btn big" href="#/quest/{next.id}">Next: {next.title} →</a>{/if}
      </div>
      {#if message}<p role="status" class="msg">{message}</p>{/if}
      <p class="muted small">“Continue in OpenCatio3D” copies this layout into the planner as a concept. Measure your real space and confirm the dimensions there before building — a game layout is not a build plan.</p>
    </section>

    <section aria-labelledby="scores-h">
      <h2 id="scores-h">Scores</h2>
      <div class="scores">
        {#each SCORE_KEYS as k}
          {@const sc = r.scores[k]}
          <details class="score {tone(sc.value)}" open={sc.value < 70}>
            <summary>
              <span class="si" aria-hidden="true">{SCORE_ICON[k]}</span>
              <span class="sl">{SCORE_LABEL[k]}</span>
              <span class="bar" aria-hidden="true"><span style="width:{sc.value}%"></span></span>
              <strong class="sv">{sc.value}</strong>
            </summary>
            <ul class="notes">{#each sc.notes as n}<li>{n}</li>{/each}</ul>
            {#if sc.tips.length}<p class="tips-h">How to improve</p><ul class="tips">{#each sc.tips as tip}<li>{tip}</li>{/each}</ul>{/if}
          </details>
        {/each}
      </div>
    </section>

    <section aria-labelledby="insp-h">
      <h2 id="insp-h">Safety inspection</h2>
      <p class="muted small">The same checks the OpenCatio3D planner runs, in plain words. They are guidance, not certification.</p>
      {#if issues.length}
        <ul class="insp">
          {#each issues as f (f.id)}
            <li><span class="badge {f.severity}">{f.severity}</span> <strong>{findingText(f)}</strong><br /><span class="muted">Fix: {f.remediation}</span></li>
          {/each}
        </ul>
      {:else}<p>No issue detected by the current rules.</p>{/if}
    </section>
  </main>
</div>

<style>
  .results { min-height: 100vh; background: var(--bg); }
  .top { display: flex; gap: 10px; align-items: center; padding: 10px 14px; background: var(--panel); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 4; }
  main { width: min(980px, 100%); margin: 0 auto; padding: 16px 16px 48px; }
  .hero { background: var(--panel); border: 1px solid var(--border); border-radius: 18px; padding: 20px; text-align: center; }
  .hero.passed { border-color: var(--leaf); }
  .stars { font-size: 44px; color: var(--sun); margin: 0; letter-spacing: 4px; }
  .stars .off { color: var(--line); }
  h1 { margin: 4px 0; font-size: clamp(24px, 4vw, 34px); outline: none; }
  .overall { margin: 4px 0 12px; }
  .overall strong { font-size: 28px; }
  .goals { list-style: none; padding: 0; margin: 0 auto 12px; display: inline-flex; flex-direction: column; gap: 4px; text-align: left; }
  .goals li { color: var(--muted); }
  .goals li.met { color: var(--ink); }
  .cats { display: flex; justify-content: center; gap: 18px; flex-wrap: wrap; margin: 8px 0 14px; }
  .cat { display: flex; flex-direction: column; align-items: center; font-weight: 700; font-size: 13px; }
  .small { font-size: 12px; }
  .badges { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; align-items: center; }
  .acts { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; margin: 10px 0; }
  .msg { font-weight: 600; }
  h2 { font-size: 18px; margin: 28px 0 10px; }
  .scores { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; }
  .score { background: var(--panel); border: 1px solid var(--border); border-radius: 14px; padding: 10px 12px; }
  .score summary { display: grid; grid-template-columns: 26px 1fr 90px 34px; gap: 8px; align-items: center; cursor: pointer; list-style: none; }
  .score summary::-webkit-details-marker { display: none; }
  .si { font-size: 20px; }
  .sl { font-weight: 700; }
  .bar { height: 8px; background: var(--line); border-radius: 99px; overflow: hidden; }
  .bar span { display: block; height: 100%; border-radius: 99px; background: var(--leaf); }
  .mid .bar span { background: var(--sun); }
  .low .bar span { background: var(--blocker); }
  .sv { text-align: right; }
  .notes, .tips { margin: 8px 0 0; padding-left: 18px; font-size: 13px; }
  .tips-h { margin: 8px 0 0; font-size: 12px; font-weight: 700; color: var(--leaf); }
  .insp { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 8px; font-size: 13px; }
  .insp li { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 10px 12px; }
</style>
