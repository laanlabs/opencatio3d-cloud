<script lang="ts">
  // "Let them explore": plays the simulated afternoon in 3D with speech bubbles over the cats and a
  // running feed of what happened. Play/pause, 1×/2×/4×, restart and skip. With reduced motion (or no
  // WebGL) it shows a static summary of the afternoon instead of an animation.
  import { onMount } from 'svelte';
  import { catalog } from '../../catalog/catalog';
  import type { QuestGame } from '../game.svelte';
  import { TICKS, timeLabel, type SimEvent } from '../sim';
  import { createQuestScene, type QuestScene } from '../render';
  import CatFace from './CatFace.svelte';

  let { game, ondone, onback }: { game: QuestGame; ondone: () => void; onback: () => void } = $props();

  const ev = $derived(game.evaluation!);
  const sim = $derived(ev.sim);
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let host: HTMLDivElement;
  let scene: QuestScene | undefined;
  let webgl = $state(true);
  let animate = $state(!reduce);
  let playing = $state(!reduce);
  let speed = $state(1);
  let t = $state(0);
  let bubbles = $state<{ id: string; x: number; y: number; ev: SimEvent }[]>([]);
  let announce = $state('');
  let raf = 0;
  let last = 0;

  const catById = $derived(Object.fromEntries(game.sc.cats.map((c) => [c.id, c])));
  const shown = $derived(sim.events.filter((e) => e.t <= t));
  const weatherNow = $derived(sim.weather.filter((w) => t >= w.t0 && t < w.t1 && w.kind !== 'clean').map((w) => (w.kind === 'rain' ? '🌧️ Rain shower' : w.kind === 'sun' ? '☀️ Hot sun' : '🐦 A bird visits')));
  let lastAnnounced = -1;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (playing) {
      t = Math.min(TICKS, t + dt * 8 * speed);
      if (t >= TICKS) { playing = false; }
    }
    if (!scene) return;
    scene.setTime(t);
    scene.render();
    const pos = scene.catScreen();
    bubbles = sim.events.filter((e) => t >= e.t && t < e.t + 16 && pos[e.cat]?.visible && e.tone !== 'info').slice(-4).map((e) => ({ id: `${e.cat}:${e.t}:${e.kind}`, x: pos[e.cat].x, y: pos[e.cat].y, ev: e }));
    const newest = shown.filter((e) => e.tone !== 'info').at(-1);
    if (newest && newest.t !== lastAnnounced) { lastAnnounced = newest.t; announce = newest.text; }
  }

  function start3d() {
    animate = true;
    try {
      scene = createQuestScene(host, ev.project, ev.assembly, sim, catalog, reduce);
    } catch (e) {
      console.warn('Catio Quest: WebGL is not available.', e);
      webgl = false;
      return;
    }
    const ro = new ResizeObserver(() => { if (host.clientWidth && host.clientHeight) scene?.resize(host.clientWidth, host.clientHeight); });
    ro.observe(host);
    scene.resize(host.clientWidth || 600, host.clientHeight || 400);
    raf = requestAnimationFrame(frame);
    cleanup = () => { ro.disconnect(); };
  }
  let cleanup = () => {};

  onMount(() => {
    if (!reduce) start3d();
    return () => { cancelAnimationFrame(raf); cleanup(); scene?.dispose(); scene = undefined; };
  });

  const restart = () => { t = 0; playing = true; };
  const skip = () => { t = TICKS; playing = false; ondone(); };
  const toneIcon = (e: SimEvent) => (e.tone === 'bad' ? 'bad' : e.tone === 'good' ? 'good' : 'info');
</script>

<main class="sim">
  <header class="bar">
    <button class="btn small" onclick={onback}>← Back to building</button>
    <h1 class="ttl">Let them explore · {game.sc.title}</h1>
    <button class="btn primary" onclick={skip}>See the results →</button>
  </header>

  <div class="body">
    <div class="viewport" bind:this={host} class:hidden={!animate || !webgl}>
      {#each bubbles as b (b.id)}
        <div class="bubble {b.ev.tone}" style="left:{b.x}px;top:{b.y}px" aria-hidden="true"><span>{b.ev.emoji}</span> {catById[b.ev.cat]?.name}</div>
      {/each}
      {#if animate && webgl}
        <div class="hud">
          <span class="clock">{timeLabel(Math.floor(t))}</span>
          {#each weatherNow as w}<span class="chip-w">{w}</span>{/each}
        </div>
        <div class="controls" role="toolbar" aria-label="Playback">
          <button class="btn small" onclick={() => (playing = !playing)} aria-label={playing ? 'Pause' : 'Play'}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
          {#each [1, 2, 4] as sp}<button class="chip" class:on={speed === sp} aria-pressed={speed === sp} onclick={() => (speed = sp)}>{sp}×</button>{/each}
          <button class="btn small" onclick={restart}>↺ Restart</button>
          <input type="range" min="0" max={TICKS} step="1" value={t} aria-label="Time of afternoon" oninput={(e) => { t = +e.currentTarget.value; playing = false; }} />
        </div>
      {/if}
    </div>
    {#if !animate || !webgl}
      <div class="static">
        <h2>The afternoon, in short</h2>
        <p class="muted">{!webgl ? '3D needs WebGL, which this browser has turned off.' : 'Animations are off because your device asks for reduced motion.'} Here is what happened.</p>
        {#if webgl}<button class="btn" onclick={start3d}>▶ Watch the animation anyway</button>{/if}
      </div>
    {/if}

    <aside class="feed" aria-label="What happened">
      <h2>What happened</h2>
      <ol>
        {#each animate && webgl ? shown.slice().reverse() : sim.events as e (`${e.cat}:${e.t}:${e.kind}`)}
          {@const c = catById[e.cat]}
          <li class={toneIcon(e)}>
            {#if c}<CatFace coat={c.coat} size={26} mood={e.tone === 'bad' ? 'sad' : e.tone === 'good' ? 'happy' : 'ok'} />{/if}
            <div><span class="when">{timeLabel(e.t)}</span> <span aria-hidden="true">{e.emoji}</span> {e.text}</div>
          </li>
        {:else}
          <li class="info"><div>The cats are settling in…</div></li>
        {/each}
      </ol>
    </aside>
  </div>
  <p class="sr-only" aria-live="polite">{announce}</p>
</main>

<style>
  .sim { height: 100vh; height: 100dvh; display: flex; flex-direction: column; background: var(--bg); }
  .bar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: var(--panel); border-bottom: 1px solid var(--border); }
  .ttl { margin: 0; font-size: 15px; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 340px; }
  .viewport { position: relative; overflow: hidden; background: #d9e4ec; touch-action: none; }
  .viewport.hidden { display: none; }
  .viewport :global(canvas) { display: block; width: 100%; height: 100%; }
  .bubble { position: absolute; transform: translate(-50%, -110%); background: #fff; border-radius: 12px; padding: 3px 8px; font-size: 12px; font-weight: 700; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,.18); pointer-events: none; border: 2px solid var(--line); }
  .bubble span { font-size: 16px; }
  .bubble.bad { border-color: var(--blocker); }
  .bubble.good { border-color: var(--leaf); }
  .hud { position: absolute; left: 10px; top: 10px; display: flex; gap: 6px; flex-wrap: wrap; }
  .clock, .chip-w { background: rgba(255,255,255,.92); border-radius: 999px; padding: 4px 10px; font-weight: 700; font-size: 13px; }
  .controls { position: absolute; left: 10px; right: 10px; bottom: 10px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; background: rgba(255,255,255,.9); border-radius: 12px; padding: 6px; }
  .controls input { flex: 1; min-width: 120px; accent-color: var(--dusk); }
  .static { padding: 24px; }
  .feed { border-left: 1px solid var(--border); background: var(--panel); overflow: auto; padding: 12px; }
  .feed h2 { font-size: 15px; margin: 0 0 8px; }
  ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  li { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; padding: 6px 8px; border-radius: 10px; background: var(--bg); }
  li.bad { background: #fbe7e5; }
  li.good { background: #e3efe6; }
  .when { color: var(--muted); font-size: 11px; font-weight: 700; }
  @media (max-width: 900px) {
    .body { grid-template-columns: 1fr; grid-template-rows: minmax(300px, 55vh) 1fr; }
    .feed { border-left: 0; border-top: 1px solid var(--border); }
    .ttl { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  }
</style>
