<script lang="ts">
  // Catio Prowl hub: name and pick your cat, then choose a space to explore — the sample homes and
  // catios, or any catio in your own library. Free, no account; progress stays in this browser.
  import Logo from '../../ui/Logo.svelte';
  import CatFace from '../../quest/ui/CatFace.svelte';
  import { listProjects, type ProjectSummary } from '../../io/storage';
  import { CAT_COATS, COAT_NAMES, readCat, saveCat } from '../cat';
  import { readAll } from '../game';

  const SPACES = [
    { id: 'lean-to-window', title: 'Living room and lean-to catio', blurb: 'A furnished living room — window seat, cat tree, sofa, kitchen counter, a wardrobe to climb — and through the window, an 8 × 4 ft lean-to with shelves, a ramp and planters.', icon: '🛋️' },
    { id: 'window-box', title: 'Kitchen window box', blurb: 'A home with a 3 ft window box off the kitchen: a sunny shelf and a bed with a view.', icon: '🪟' },
    { id: 'garden-retreat', title: 'Garden catio', blurb: 'A walk-in catio in the yard: a high bridge, a hammock, a ramp, a hideaway cube and a scratching post.', icon: '🌳' }
  ];

  let cat = $state(readCat());
  $effect(() => saveCat({ name: cat.name, coat: cat.coat }));
  const progress = readAll();
  const done = (id: string) => progress[id]?.done?.length ?? 0;
  let mine = $state<ProjectSummary[]>([]);
  listProjects().then((all) => (mine = all.filter((p) => p.templates.some((t) => t !== 'tunnel')))).catch(() => {});
</script>

<div class="hub">
  <header class="top">
    <a href="#/" class="brand" aria-label="OpenCatio3D planner"><Logo word /></a>
    <a class="btn small" href="#/quest">Play Catio Quest</a>
  </header>
  <main>
    <section class="intro">
      <p class="eyebrow">A free game from OpenCatio3D</p>
      <h1>Catio Prowl — a day in the life of your cat</h1>
      <p class="lede">Be the cat. Leap from the window seat to the fridge, knock the mug off the table, find the toy mice, then slip through the window into the catio to watch the birds — and end the day napping in a sunbeam. Every catio here is a real design from the planner, so you can explore your own before you build it.</p>
    </section>

    <section class="who" aria-labelledby="who-h">
      <h2 id="who-h">Your cat</h2>
      <div class="cat-row">
        <CatFace coat={cat.coat} size={64} mood="happy" />
        <label class="name">Name <input type="text" bind:value={cat.name} maxlength="24" autocomplete="off" /></label>
        <fieldset class="coats">
          <legend>Coat</legend>
          {#each CAT_COATS as c (c)}
            <button class="coat" class:on={cat.coat === c} aria-pressed={cat.coat === c} aria-label={COAT_NAMES[c]} title={COAT_NAMES[c]} onclick={() => (cat.coat = c)}><span style="background:{c}"></span></button>
          {/each}
        </fieldset>
      </div>
    </section>

    <h2>Where to explore</h2>
    <ul class="grid">
      {#each SPACES as s (s.id)}
        <li>
          <a class="card" href="#/prowl/{s.id}">
            <span class="ico" aria-hidden="true">{s.icon}</span>
            <strong>{s.title}</strong>
            <span class="tag">{s.blurb}</span>
            <span class="meta">{done(`sample:${s.id}`) ? `${done(`sample:${s.id}`)} things done today` : 'Explore →'}</span>
          </a>
        </li>
      {/each}
    </ul>

    {#if mine.length}
      <h2>Your catios</h2>
      <p class="muted">Walk around a catio you designed. Catios built over a window come with a room behind them.</p>
      <ul class="mine">
        {#each mine as p (p.id)}
          <li><a class="btn" href="#/prowl/p/{p.id}">{p.name}</a></li>
        {/each}
      </ul>
    {:else}
      <p class="muted">Design a catio in the <a href="#/">planner</a> and it will show up here to explore.</p>
    {/if}

    <section class="how" aria-labelledby="how-h">
      <h2 id="how-h">How to play</h2>
      <ul>
        <li><strong>Move:</strong> WASD or the arrow keys (hold Shift to sneak). On a phone, use the stick in the corner.</li>
        <li><strong>Leap:</strong> a ring shows where you’ll land. Press Space, or tap Leap.</li>
        <li><strong>Do things:</strong> press E (or the action button) to knock, scratch, drink, sniff, watch or nap.</li>
        <li><strong>Look around:</strong> drag the view, scroll or pinch to zoom, or press , and . to turn. C puts the camera behind your cat. M meows.</li>
      </ul>
    </section>

    <p class="fine">Progress is saved only in this browser. No account, no ads, nothing to buy. Catio Prowl is a game: the catios are real planner designs, but playing isn’t a safety check — use the planner’s checks and a build review for that.</p>
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
  .cat-row { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; padding: 14px 16px; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); }
  .name { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 700; color: var(--muted); }
  .name input { width: 180px; font-size: 15px; font-weight: 600; color: var(--ink); }
  .coats { border: 0; margin: 0; padding: 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .coats legend { font-size: 12px; font-weight: 700; color: var(--muted); padding: 0; margin-bottom: 4px; }
  .coat { width: 40px; height: 40px; border-radius: 50%; border: 2px solid transparent; background: none; padding: 3px; cursor: pointer; }
  .coat span { display: block; width: 100%; height: 100%; border-radius: 50%; border: 1px solid rgba(0, 0, 0, .25); }
  .coat.on { border-color: var(--dusk); }
  .grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
  .card { height: 100%; display: flex; flex-direction: column; gap: 6px; padding: 14px; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); text-decoration: none; color: var(--ink); }
  a.card:hover { border-color: var(--dusk); box-shadow: var(--shadow); }
  .ico { font-size: 26px; }
  .tag { font-size: 13px; color: var(--body); }
  .meta { margin-top: auto; font-size: 12px; font-weight: 800; color: var(--cedar); }
  .mine { list-style: none; padding: 0; margin: 8px 0 0; display: flex; flex-wrap: wrap; gap: 8px; }
  .how ul { padding-left: 18px; color: var(--body); max-width: 52em; }
  .how li { margin: 4px 0; }
  .fine { margin-top: 28px; font-size: 12px; color: var(--muted); max-width: 52em; }
</style>
