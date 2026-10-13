<script lang="ts">
  // Build screen: the piece tray, the board and the inspector, with a live budget meter and issue count
  // from the real generator and checks. Pieces can be tapped (placed in the first free spot) or dragged
  // onto the board with a mouse or a finger.
  import { catalog } from '../../catalog/catalog';
  import type { Units } from '../../model/types';
  import { money } from '../../model/units';
  import { CATEGORIES, CATEGORY_LABEL, PIECES, type Piece, type PieceCategory } from '../pieces';
  import { findingText } from '../score';
  import type { QuestGame } from '../game.svelte';
  import Board from './Board.svelte';
  import Inspector from './Inspector.svelte';
  import CatFace from './CatFace.svelte';

  let { game, units, onexplore, onback }: { game: QuestGame; units: Units; onexplore: () => void; onback: () => void } = $props();

  let category = $state<PieceCategory>('perches');
  let board = $state<ReturnType<typeof Board>>();
  let dragged = false;
  let tabs = $state<HTMLElement>();
  // On phones the category tabs scroll sideways; keep the selected one in view.
  $effect(() => {
    void category;
    tabs?.querySelector('.chip.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  let ghost = $state<{ piece: Piece; x: number; y: number; moved: boolean; x0: number; y0: number } | null>(null);
  let showIssues = $state(false);
  let confirmRestart = $state(false);

  const sc = $derived(game.sc);
  const s = $derived(game.structure);
  const pieces = $derived(PIECES.filter((p) => p.category === category && (p.action.kind !== 'template' || sc.templates.includes(p.action.template))));
  const active = (p: Piece) => {
    const a = p.action;
    if (!s) return false;
    if (a.kind === 'template') return s.template === a.template;
    if (a.kind === 'mesh') return s.mesh.materialId === a.materialId;
    if (a.kind === 'roof') return s.roof.kind === a.roof && (a.roof !== 'partial' || (s.roof.materialId ?? '') === (a.materialId ?? ''));
    if (a.kind === 'base') return s.base.kind === a.base;
    return false;
  };
  const budgetPct = $derived(sc.budget ? Math.min(100, (game.cost / sc.budget) * 100) : 0);
  const over = $derived(!!sc.budget && game.cost > sc.budget);

  function piecePointerDown(e: PointerEvent, p: Piece) {
    if (e.button > 0 || p.action.kind !== 'furnishing') return;
    ghost = { piece: p, x: e.clientX, y: e.clientY, moved: false, x0: e.clientX, y0: e.clientY };
  }
  function windowMove(e: PointerEvent) {
    if (!ghost) return;
    if (!ghost.moved && Math.hypot(e.clientX - ghost.x0, e.clientY - ghost.y0) < 10) return;
    ghost.moved = true;
    ghost.x = e.clientX; ghost.y = e.clientY;
  }
  function windowUp(e: PointerEvent) {
    if (!ghost) return;
    const g = ghost;
    ghost = null;
    if (!g.moved || g.piece.action.kind !== 'furnishing') return;
    // A drag that ends over its own button still fires a click; don't add the piece twice.
    dragged = true;
    setTimeout(() => (dragged = false), 0);
    const spot = board?.dropAt(e.clientX, e.clientY, g.piece.action.componentId);
    if (!spot) return;
    const id = game.apply(g.piece);
    if (id) game.moveFurnishing(id, spot);
  }
  function tap(p: Piece) {
    if (ghost?.moved || dragged) return;
    game.apply(p);
  }

  function onKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); game.undo(); }
    if (e.key === 'Escape') { if (showIssues) showIssues = false; else game.selected = null; }
  }
</script>

<svelte:window onpointermove={windowMove} onpointerup={windowUp} onpointercancel={() => (ghost = null)} onkeydown={onKey} />

<div class="build">
  <header class="bar">
    <button class="btn small" onclick={onback} aria-label="Back to Catio Quest">←</button>
    <div class="title">
      <strong>{sc.title}</strong>
      <span class="cats">{#each sc.cats as c (c.id)}<CatFace coat={c.coat} size={22} label={c.name} />{/each}</span>
    </div>
    <button class="btn small" onclick={() => game.undo()} disabled={!game.undoCount} aria-label="Undo">↶ Undo</button>
    <button class="btn small" onclick={() => (confirmRestart = true)}>Start over</button>
  </header>

  <div class="meters">
    {#if sc.budget}
      <div class="meter" title="Best-price estimate from the real materials list">
        <span class="lbl">💰 {money(game.cost)} <span class="muted">of {money(sc.budget)}</span></span>
        <span class="track" role="meter" aria-label="Budget used" aria-valuemin="0" aria-valuemax={sc.budget} aria-valuenow={game.cost}><span class="fill" class:over style="width:{budgetPct}%"></span></span>
      </div>
    {:else}
      <div class="meter"><span class="lbl">💰 {money(game.cost)} <span class="muted">best price</span></span></div>
    {/if}
    <button class="issues" class:clear={!game.issues.length} onclick={() => (showIssues = !showIssues)} aria-expanded={showIssues}>
      {game.issues.length ? `🛡️ ${game.issues.length} issue${game.issues.length === 1 ? '' : 's'} to check` : '🛡️ No issues detected'}
    </button>
    <button class="btn primary big go" onclick={onexplore} disabled={!s}>🐾 Let them explore</button>
  </div>
  {#if showIssues}
    <div class="issue-list" role="region" aria-label="Inspection preview">
      {#if game.issues.length}
        <ul>{#each game.issues as f (f.id)}<li><span class="badge {f.severity}">{f.severity}</span> {findingText(f)} <span class="muted">— {f.remediation}</span></li>{/each}</ul>
      {:else}<p>No issue detected by the current rules. Let them explore to see how the cats like it.</p>{/if}
      <p class="muted small">Goals: {sc.goals.map((g) => g.label).join(' · ')}</p>
    </div>
  {/if}

  <div class="main">
    <section class="tray" aria-label="Pieces">
      <div class="cats-tabs" bind:this={tabs} role="tablist" aria-label="Piece categories">
        {#each CATEGORIES as c}
          <button role="tab" class="chip" class:on={category === c} aria-selected={category === c} onclick={() => (category = c)}>{CATEGORY_LABEL[c]}</button>
        {/each}
      </div>
      <div class="pieces" role="tabpanel" aria-label={CATEGORY_LABEL[category]}>
        {#each pieces as p (p.id)}
          {@const plant = p.action.kind === 'plant' ? catalog.plant(p.action.plantId) : undefined}
          <button class="piece" class:active={active(p)} aria-pressed={p.action.kind !== 'furnishing' && p.action.kind !== 'opening' && p.action.kind !== 'plant' ? active(p) : undefined} title={p.blurb} onpointerdown={(e) => piecePointerDown(e, p)} onclick={() => tap(p)}>
            <span class="pi" aria-hidden="true">{p.icon}</span>
            <span class="pn">{p.name}</span>
            {#if plant}<span class="dot {plant.catSafety}" aria-label={plant.catSafety === 'known-hazard' ? 'toxic to cats' : plant.catSafety === 'no-known-issue' ? 'not listed as toxic' : 'safety unknown'}></span>{/if}
            <span class="pb">{p.blurb}</span>
          </button>
        {/each}
      </div>
    </section>

    <section class="stage" aria-label="Your catio">
      {#if s}<Board bind:this={board} {game} {units} />{/if}
    </section>

    <section class="side" aria-label="Inspector">
      <Inspector {game} {units} />
    </section>
  </div>

  {#if game.note}
    {#key game.note.id}<p class="toast" role="status">{game.note.text}</p>{/key}
  {/if}
  {#if ghost?.moved}<div class="ghost" style="left:{ghost.x}px;top:{ghost.y}px" aria-hidden="true">{ghost.piece.icon}</div>{/if}
  {#if confirmRestart}
    <div class="confirm" role="alertdialog" aria-label="Start over?">
      <p>Start over from the original catio? Your changes here will be lost.</p>
      <div class="row"><button class="btn" onclick={() => (confirmRestart = false)}>Keep building</button><button class="btn primary" onclick={() => { confirmRestart = false; game.restart(); }}>Start over</button></div>
    </div>
  {/if}
</div>

<style>
  .build { height: 100vh; height: 100dvh; display: flex; flex-direction: column; background: var(--bg); }
  .bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--panel); border-bottom: 1px solid var(--border); }
  .title { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; }
  .title strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 15px; }
  .cats { display: inline-flex; gap: 2px; }
  .meters { display: flex; align-items: center; gap: 10px; padding: 8px 12px; flex-wrap: wrap; border-bottom: 1px solid var(--border); background: var(--panel); }
  .meter { display: flex; flex-direction: column; gap: 3px; min-width: 160px; }
  .lbl { font-weight: 700; font-size: 13px; }
  .track { display: block; height: 8px; background: var(--line); border-radius: 99px; overflow: hidden; width: 180px; max-width: 100%; }
  .fill { display: block; height: 100%; background: var(--leaf); border-radius: 99px; transition: width .3s; }
  .fill.over { background: var(--blocker); }
  .issues { border: 1px solid var(--border); background: #fdf0dc; color: var(--warning); border-radius: 999px; padding: 6px 12px; font-weight: 700; font-size: 13px; cursor: pointer; min-height: 34px; }
  .issues.clear { background: #e3efe6; color: var(--leaf); }
  .go { margin-left: auto; }
  .issue-list { padding: 8px 14px; background: var(--panel); border-bottom: 1px solid var(--border); max-height: 30vh; overflow: auto; font-size: 13px; }
  .issue-list ul { margin: 0; padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
  .small { font-size: 12px; }
  .main { flex: 1; min-height: 0; display: grid; grid-template-columns: 280px 1fr 290px; }
  .tray { border-right: 1px solid var(--border); background: var(--panel); display: flex; flex-direction: column; min-height: 0; }
  .cats-tabs { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px; border-bottom: 1px solid var(--border); }
  .pieces { overflow: auto; padding: 10px; display: grid; grid-template-columns: 1fr; gap: 6px; align-content: start; }
  .piece { display: grid; grid-template-columns: 34px 1fr auto; grid-template-rows: auto auto; gap: 0 8px; text-align: left; border: 1px solid var(--border); border-radius: 12px; background: var(--paper); padding: 8px; cursor: grab; color: var(--ink); touch-action: pan-y; min-height: 44px; }
  .piece:hover { border-color: var(--dusk); }
  .piece.active { border-color: var(--leaf); background: #eef5ef; }
  .pi { grid-row: span 2; font-size: 24px; align-self: center; text-align: center; }
  .pn { font-weight: 700; font-size: 13px; }
  .pb { grid-column: 2 / 4; font-size: 11.5px; color: var(--muted); }
  .dot { width: 10px; height: 10px; border-radius: 50%; align-self: center; background: var(--warning); }
  .dot.known-hazard { background: var(--blocker); }
  .dot.no-known-issue { background: var(--leaf); }
  .stage { min-height: 0; padding: 12px; display: flex; flex-direction: column; overflow: hidden; }
  .side { border-left: 1px solid var(--border); background: var(--panel); padding: 12px; overflow: auto; }
  .toast { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); background: var(--dusk); color: #fff; padding: 9px 14px; border-radius: 10px; box-shadow: var(--shadow); margin: 0; max-width: calc(100% - 32px); animation: fade 3.2s forwards; z-index: 40; pointer-events: none; }
  @keyframes fade { 0%, 80% { opacity: 1; } 100% { opacity: 0; } }
  .ghost { position: fixed; transform: translate(-50%, -50%); font-size: 34px; pointer-events: none; z-index: 50; filter: drop-shadow(0 4px 6px rgba(0,0,0,.25)); }
  .confirm { position: fixed; inset: auto 16px 16px auto; background: var(--panel); border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); padding: 14px; z-index: 60; max-width: 320px; }
  .confirm p { margin: 0 0 10px; }
  @media (max-width: 900px) {
    /* Phones: the board on top and the tray as one swipeable strip right under it, so a piece can be dragged up
       onto the board without scrolling. Swiping sideways scrolls the strip; dragging up places the piece. */
    .main { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(200px, 42vh) max-content auto; overflow: auto; }
    .stage { order: 0; padding: 8px; }
    .tray { order: 1; border-right: 0; border-top: 1px solid var(--border); }
    .side { order: 2; border-left: 0; border-top: 1px solid var(--border); }
    .cats-tabs { flex-wrap: nowrap; overflow-x: auto; padding: 8px 10px; scrollbar-width: none; }
    .cats-tabs .chip { flex: none; }
    .pieces { display: flex; flex: none; overflow-x: auto; overflow-y: hidden; padding: 8px 10px; scroll-snap-type: x proximity; }
    .piece { flex: 0 0 148px; scroll-snap-align: start; touch-action: pan-x; }
    .pb { display: none; }
    .go { margin-left: 0; width: 100%; }
    .track { width: 120px; }
  }
</style>
