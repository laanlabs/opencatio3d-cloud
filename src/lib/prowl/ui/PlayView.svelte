<script lang="ts">
  // Catio Prowl play screen: the 3D view, keyboard / mouse / touch controls, the day's to-do list, the
  // prompt for what a leap or the action key will do, toasts, and the end-of-day card.
  import { onMount } from 'svelte';
  import { catalog } from '../../catalog/catalog';
  import type { Project } from '../../model/types';
  import type { Assembly } from '../../generate/assembly';
  import type { World } from '../world';
  import type { PlayerCat } from '../cat';
  import { Prowl, type Message } from '../game';
  import { createProwlScene, type ProwlScene } from '../render';
  import { play } from '../sound';
  import { track } from '../../analytics';

  let { project, assembly, world, cat }: { project: Project; assembly: Assembly; world: World; cat: PlayerCat } = $props();

  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  // svelte-ignore state_referenced_locally
  const game = new Prowl(world, catalog);
  // Test hook: /?prowl-debug#/prowl/… exposes the game to browser tests.
  if (typeof location !== 'undefined' && location.search.includes('prowl-debug')) (window as unknown as { __prowl: Prowl }).__prowl = game;
  // svelte-ignore state_referenced_locally
  const sampleId = project.web?.sampleId as string | undefined;
  // svelte-ignore state_referenced_locally
  const designHref = sampleId ? `#/sample/${sampleId}` : `#/p/${project.id}`;

  let host: HTMLDivElement;
  let scene: ProwlScene | undefined;
  let webgl = $state(true);
  let prompt = $state<{ leap: string; act: string }>({ leap: '', act: '' });
  let where = $state('');
  let toasts = $state<(Message & { id: number })[]>([]);
  let announce = $state('');
  let doneCount = $state(game.doneCount);
  let counts = $state(game.tasks.map((t) => game.count(t.id)));
  let showTasks = $state(!coarse);
  let finished = $state(false);
  let meowAt = $state<{ x: number; y: number } | null>(null);
  let muted = $state(readFlag('oc3d-prowl-muted'));
  let help = $state(!readFlag('oc3d-prowl-helped'));

  function readFlag(k: string) { try { return localStorage.getItem(k) === '1'; } catch { return false; } }
  function writeFlag(k: string, v: boolean) { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* not remembered */ } }

  // ---------- input ----------
  const keys = new Set<string>();
  let jump = false, sneak = false;
  let orbit: [number, number] = [0, 0], zoom = 0, recenter = false;
  let stick: [number, number] = [0, 0];

  function onKey(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select') || (t.closest('button, a') && (e.key === ' ' || e.key === 'Enter'))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', ' '].includes(k)) e.preventDefault();
    if (down) {
      if (help) { dismissHelp(); return; }
      keys.add(k);
      if (e.repeat) return;
      if (k === ' ') jump = true;
      else if (k === 'e' || k === 'Enter') game.act();
      else if (k === 'm') meow();
      else if (k === 'c') recenter = true;
      else if (k === 't') showTasks = !showTasks;
      else if (k === 'Escape') { showTasks = false; }
    } else keys.delete(k);
    sneak = keys.has('Shift');
  }

  function keyVector(): [number, number] {
    const x = (keys.has('d') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('a') || keys.has('ArrowLeft') ? 1 : 0);
    const y = (keys.has('w') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('s') || keys.has('ArrowDown') ? 1 : 0);
    return [x, y];
  }

  // Pointer: drag to look around; on touch screens the lower-left area is a movement stick.
  const pointers = new Map<number, { x: number; y: number; role: 'look' | 'stick'; x0: number; y0: number }>();
  let pinch = 0;
  let stickUi = $state<{ x0: number; y0: number; x: number; y: number } | null>(null);
  function pdown(e: PointerEvent) {
    if (help) dismissHelp();
    host.focus({ preventScroll: true });
    const r = host.getBoundingClientRect();
    const role = e.pointerType === 'touch' && e.clientX - r.left < r.width * 0.45 && e.clientY - r.top > r.height * 0.35 ? 'stick' : 'look';
    host.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, role, x0: e.clientX, y0: e.clientY });
    if (role === 'stick') stickUi = { x0: e.clientX - r.left, y0: e.clientY - r.top, x: e.clientX - r.left, y: e.clientY - r.top };
    const looks = [...pointers.values()].filter((p) => p.role === 'look');
    if (looks.length === 2) pinch = Math.hypot(looks[0].x - looks[1].x, looks[0].y - looks[1].y);
  }
  function pmove(e: PointerEvent) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const looks = [...pointers.values()].filter((q) => q.role === 'look');
    if (p.role === 'stick') {
      const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
      const m = Math.hypot(dx, dy), R = 56;
      stick = m < 6 ? [0, 0] : [(dx / Math.max(m, R)), (-dy / Math.max(m, R))];
      const r = host.getBoundingClientRect();
      stickUi = { x0: p.x0 - r.left, y0: p.y0 - r.top, x: p.x0 - r.left + (m > R ? (dx / m) * R : dx), y: p.y0 - r.top + (m > R ? (dy / m) * R : dy) };
    } else if (looks.length === 2) {
      p.x = e.clientX; p.y = e.clientY;
      const d = Math.hypot(looks[0].x - looks[1].x, looks[0].y - looks[1].y);
      if (pinch) zoom += Math.log(pinch / d);
      pinch = d;
      return;
    } else {
      orbit[0] -= (e.clientX - p.x) * 0.006;
      orbit[1] += (e.clientY - p.y) * 0.004;
    }
    p.x = e.clientX; p.y = e.clientY;
  }
  function pup(e: PointerEvent) {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (p?.role === 'stick') { stick = [0, 0]; stickUi = null; }
    pinch = 0;
  }
  function wheel(e: WheelEvent) { e.preventDefault(); zoom += e.deltaY * 0.0012; }

  function meow() {
    game.meow();
    if (scene) { const s = scene.screenOf([game.cat.p[0], game.cat.p[1] + 0.42, game.cat.p[2]]); meowAt = s.visible ? { x: s.x, y: s.y } : null; }
    setTimeout(() => (meowAt = null), 900);
  }
  function dismissHelp() { help = false; writeFlag('oc3d-prowl-helped', true); }
  function toggleMute() { muted = !muted; writeFlag('oc3d-prowl-muted', muted); }

  let toastId = 0;
  function flush() {
    if (!game.messages.length) return;
    for (const m of game.messages.splice(0)) {
      if (m.sound && !muted) play(m.sound);
      if (m.text === 'Meow!') continue;
      const id = ++toastId;
      toasts = [...toasts.slice(-3), { ...m, id }];
      announce = m.text;
      setTimeout(() => (toasts = toasts.filter((t) => t.id !== id)), m.tone === 'task' ? 3200 : 2600);
    }
    doneCount = game.doneCount;
    counts = game.tasks.map((t) => game.count(t.id));
  }

  // ---------- loop ----------
  onMount(() => {
    try {
      scene = createProwlScene(host, project, assembly, world, catalog, { coat: cat.coat, reduceMotion: reduce });
    } catch {
      webgl = false;
      return;
    }
    const ro = new ResizeObserver(() => scene?.resize(host.clientWidth || 600, host.clientHeight || 400));
    ro.observe(host);
    scene.resize(host.clientWidth || 600, host.clientHeight || 400);
    host.addEventListener('wheel', wheel, { passive: false });
    host.focus({ preventScroll: true });
    let last = performance.now(), raf = 0, slow = 0;
    const frame = (now: number) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); // rAF stamps can precede `last`
      last = now;
      const kv = keyVector();
      const v: [number, number] = kv[0] || kv[1] ? kv : stick;
      const moving = Math.hypot(v[0], v[1]) > 0.05;
      const keyOrbit = (keys.has(',') ? 1 : 0) - (keys.has('.') ? 1 : 0);
      if (keyOrbit) orbit[0] += keyOrbit * dt * 2;
      game.update(dt, { move: Prowl.relative(v, scene!.yaw), sneak, jump });
      jump = false;
      scene!.frame(dt, game, { orbit, zoom, recenter }, moving);
      orbit = [0, 0]; zoom = 0; recenter = false;
      flush();
      slow += dt;
      if (slow > 0.1) {
        slow = 0;
        const leap = game.target ? `Leap to ${game.target.surface.label}` : '';
        const act = game.action?.label ?? '';
        if (leap !== prompt.leap || act !== prompt.act) prompt = { leap, act };
        const w = game.whereabouts;
        if (w && w !== where) where = w;
        if (game.finished && !finished) { finished = true; track('prowl_finish', { space: world.id.startsWith('sample:') ? world.id.slice(7) : 'own' }); }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); host.removeEventListener('wheel', wheel); scene?.dispose(); scene = undefined; };
  });

  function again() { game.restart(); location.reload(); }
  const back = () => (location.hash = '#/prowl');
</script>

<svelte:window onkeydown={(e) => onKey(e, true)} onkeyup={(e) => onKey(e, false)} onblur={() => { keys.clear(); sneak = false; }} />

<main class="play">
  <h1 class="sr-only">Catio Prowl: {cat.name} explores {project.name}</h1>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div class="view" bind:this={host} tabindex="0" role="application"
    aria-label="{cat.name}, your cat. Arrow keys or WASD move, Space leaps to the ringed spot, E does the action shown, M meows, C turns the camera behind your cat."
    onpointerdown={pdown} onpointermove={pmove} onpointerup={pup} onpointercancel={pup}>
    {#if !webgl}<p class="nowebgl">Catio Prowl needs WebGL, which this browser has turned off.</p>{/if}
  </div>

  <header class="bar">
    <button class="btn small" onclick={back} aria-label="Back to Catio Prowl">←</button>
    <div class="title"><strong>{cat.name}</strong><span class="where">{where}</span></div>
    <button class="btn small" onclick={() => (showTasks = !showTasks)} aria-expanded={showTasks} aria-controls="todo">✓ {doneCount}/{game.tasks.length}</button>
    <button class="btn small" onclick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Sound off' : 'Sound on'}>{muted ? '🔇' : '🔊'}</button>
  </header>

  {#if showTasks}
    <section class="todo" id="todo" aria-label="Today’s to-do list">
      <h2>{cat.name}’s day</h2>
      <ul>
        {#each game.tasks as t, i (t.id)}
          <li class:done={counts[i] >= t.goal}><span class="box" aria-hidden="true">{counts[i] >= t.goal ? '✓' : ''}</span><span>{t.title}{#if t.goal > 1 && counts[i] < t.goal} <span class="n">{counts[i]}/{t.goal}</span>{/if}</span><span class="sr-only">{counts[i] >= t.goal ? ' — done' : ''}</span></li>
        {/each}
      </ul>
    </section>
  {/if}

  <div class="prompt" class:coarse aria-hidden="true" hidden={finished}>
    {#if prompt.leap}<span class="pill">{#if !coarse}<kbd>Space</kbd> {/if}{prompt.leap}</span>{/if}
    {#if prompt.act && !coarse}<span class="pill act"><kbd>E</kbd> {prompt.act}</span>{/if}
  </div>

  <div class="toasts" aria-hidden="true">
    {#each toasts as t (t.id)}<p class="toast {t.tone}">{t.text}</p>{/each}
  </div>
  <p class="sr-only" aria-live="polite">{announce}</p>
  {#if meowAt}<span class="bubble" style="left:{meowAt.x}px;top:{meowAt.y}px" aria-hidden="true">Meow!</span>{/if}

  {#if coarse}
    {#if stickUi}<span class="stick" style="left:{stickUi.x0}px;top:{stickUi.y0}px" aria-hidden="true"><span class="nub" style="transform:translate({stickUi.x - stickUi.x0}px,{stickUi.y - stickUi.y0}px)"></span></span>
    {:else}<span class="stick idle" aria-hidden="true"><span class="nub"></span></span>{/if}
    <div class="pad">
      <button class="pb meow" onclick={meow} aria-label="Meow">😺</button>
      <button class="pb act" disabled={!prompt.act} onclick={() => game.act()}>{prompt.act || 'Action'}</button>
      <button class="pb leap" onclick={() => (jump = true)}>Leap</button>
    </div>
  {/if}

  {#if help}
    <div class="help" role="dialog" aria-label="How to play">
      <p><strong>{world.home ? `${cat.name} is waking up in a sunbeam.` : `${cat.name} has the whole catio to explore.`}</strong> {coarse ? 'Today’s list is under ✓ at the top.' : 'Today’s list is in the corner.'}</p>
      {#if coarse}
        <p>Drag in the lower-left to walk. Drag anywhere else to look around. A ring shows where <b>Leap</b> lands.</p>
      {:else}
        <p><kbd>W A S D</kbd> or arrows to walk · <kbd>Space</kbd> leaps to the ring · <kbd>E</kbd> does the action shown · <kbd>M</kbd> meows · drag to look around.</p>
      {/if}
      <button class="btn primary" onclick={dismissHelp}>Let’s go</button>
    </div>
  {/if}

  {#if finished}
    <div class="finish" role="dialog" aria-labelledby="done-h">
      <h2 id="done-h">{cat.name} had a perfect day</h2>
      <p>Everything on the list, and a nap in the sun to finish. {world.home ? 'The catio made the difference: fresh air, birds to watch, and no way out.' : 'Not bad for a few square feet of mesh and lumber.'}</p>
      <div class="row">
        <button class="btn primary" onclick={again}>Explore again</button>
        <a class="btn" href="#/prowl">Pick another space</a>
        <a class="btn" href={designHref}>{sampleId ? 'Design a catio like this' : 'Open in the planner'}</a>
      </div>
    </div>
  {/if}
</main>

<style>
  .play { position: fixed; inset: 0; background: #cfe0ec; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; }
  .view { position: absolute; inset: 0; outline: none; }
  .view:focus-visible { box-shadow: inset 0 0 0 3px var(--sun); }
  .nowebgl { position: absolute; top: 40%; left: 0; right: 0; text-align: center; }
  .bar { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 8px; padding: max(8px, env(safe-area-inset-top)) 12px 8px; background: linear-gradient(rgba(24, 36, 58, .55), rgba(24, 36, 58, 0)); color: #fff; pointer-events: none; }
  .bar > * { pointer-events: auto; }
  .title { flex: 1; min-width: 0; display: flex; flex-direction: column; text-shadow: 0 1px 2px rgba(0, 0, 0, .4); }
  .title strong { font-size: 15px; }
  .where { font-size: 12px; opacity: .92; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .todo { position: absolute; top: 56px; left: 12px; width: min(300px, calc(100% - 24px)); max-height: calc(100% - 180px); overflow: auto; background: rgba(255, 255, 255, .94); border-radius: 14px; padding: 10px 12px; box-shadow: var(--shadow); }
  .todo h2 { font-size: 14px; margin: 0 0 6px; }
  .todo ul { list-style: none; margin: 0; padding: 0; }
  .todo li { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; font-size: 13px; }
  .todo li.done { color: var(--muted); }
  .todo li.done span:nth-child(2) { text-decoration: line-through; }
  .box { flex: none; width: 18px; height: 18px; border-radius: 5px; border: 1.5px solid var(--mesh); display: grid; place-items: center; font-size: 12px; font-weight: 800; color: #fff; }
  li.done .box { background: var(--leaf); border-color: var(--leaf); }
  .n { color: var(--cedar); font-weight: 700; }
  .prompt { position: absolute; left: 0; right: 0; bottom: max(20px, env(safe-area-inset-bottom)); display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; pointer-events: none; padding: 0 12px; }
  .pill { background: rgba(24, 36, 58, .82); color: #fff; padding: 7px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; }
  .pill.act { background: rgba(154, 90, 44, .9); }
  kbd { font: 700 11px var(--font); background: rgba(255, 255, 255, .2); border-radius: 5px; padding: 1px 6px; margin-right: 4px; }
  .toasts { position: absolute; top: 60px; right: 12px; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; pointer-events: none; max-width: min(360px, calc(100% - 24px)); }
  .toast { margin: 0; padding: 8px 12px; border-radius: 12px; background: rgba(255, 255, 255, .95); box-shadow: var(--shadow); font-size: 13px; }
  .toast.task { background: var(--leaf); color: #fff; font-weight: 700; }
  .toast.good { border-left: 4px solid var(--leaf); }
  .toast.warn { border-left: 4px solid var(--warning); }
  .bubble { position: absolute; transform: translate(-50%, -100%); background: #fff; border-radius: 12px; padding: 4px 10px; font-weight: 800; box-shadow: var(--shadow); pointer-events: none; }
  .stick { position: absolute; width: 112px; height: 112px; margin: -56px 0 0 -56px; border-radius: 50%; background: rgba(255, 255, 255, .25); border: 2px solid rgba(255, 255, 255, .6); pointer-events: none; }
  .stick.idle { left: 92px; bottom: calc(max(24px, env(safe-area-inset-bottom)) + 40px); top: auto; margin: 0 0 -56px -56px; opacity: .55; }
  .nub { position: absolute; left: 36px; top: 36px; width: 40px; height: 40px; border-radius: 50%; background: rgba(255, 255, 255, .85); }
  .pad { position: absolute; right: 12px; bottom: max(64px, calc(env(safe-area-inset-bottom) + 56px)); display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
  .pb { border: 0; border-radius: 999px; font-weight: 800; box-shadow: var(--shadow); touch-action: manipulation; }
  .pb.leap { width: 84px; height: 84px; background: var(--sun); color: var(--ink); font-size: 16px; }
  .pb.act { min-height: 48px; max-width: 200px; padding: 8px 14px; background: var(--cedar); color: #fff; font-size: 13px; }
  .pb.act:disabled { opacity: .45; }
  .pb.meow { width: 48px; height: 48px; background: #fff; font-size: 22px; }
  .help, .finish { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(440px, calc(100% - 32px)); background: var(--panel); border-radius: 18px; padding: 18px 20px; box-shadow: var(--shadow); text-align: center; }
  .help p { margin: 0 0 10px; }
  .help kbd { background: var(--accent-bg); color: var(--ink); }
  .finish h2 { margin: 0 0 8px; font-size: 22px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 12px; }
  .prompt.coarse { bottom: auto; top: calc(max(8px, env(safe-area-inset-top)) + 52px); }
  .prompt.coarse ~ .toasts { top: calc(max(8px, env(safe-area-inset-top)) + 96px); }
</style>
