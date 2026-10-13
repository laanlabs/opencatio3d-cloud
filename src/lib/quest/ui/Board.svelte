<script lang="ts">
  // The build board: a top-down plan of the catio (house wall at the top), drawn from the layout. Pieces
  // can be dragged along and between walls (mouse or touch), moved with the arrow keys, or edited in the
  // inspector. Anything the generator would leave out is outlined in red.
  import { catalog } from '../../catalog/catalog';
  import type { Furnishing, Side, StructureOpening, Units } from '../../model/types';
  import { frontHeight } from '../../model/types';
  import { frameMaterial, furnishingFits, layoutFor, sideLength } from '../../generate/structure';
  import { fmtLen } from '../../model/units';
  import { rampRun, sidesFor } from '../design';
  import { PIECES } from '../pieces';
  import type { QuestGame } from '../game.svelte';

  let { game, units }: { game: QuestGame; units: Units } = $props();

  const s = $derived(game.structure!);
  const W = $derived(s.width * 100), D = $derived(s.depth * 100);
  const d = $derived(((frameMaterial(s, catalog).actual ?? [0.038, 0.064])[0]) * 100);
  const attached = $derived(layoutFor(s.template).houseBack);
  const vest = $derived(s.openings.find((o) => o.kind === 'vestibule'));
  // Labels, padding and strokes are sized in screen pixels: k = plan units (cm) per screen pixel.
  let cw = $state(600), ch = $state(400);
  // viewBox ≈ (W + 60k) × (D + 82k + vestibule), shown with 'meet': solve for k.
  const k = $derived(Math.max(0.05, W / Math.max(40, cw - 60), (D + (vest ? (vest.depth ?? 0.9) * 100 : 0)) / Math.max(40, ch - 82)));
  const pad = $derived(30 * k);
  const top = $derived(attached ? 52 * k : pad);
  const bottom = $derived(pad + (vest ? (vest.depth ?? 0.9) * 100 : 0));
  const fs = (px: number) => `font-size:${(px * k).toFixed(1)}px`;
  const viewBox = $derived(`${-pad} ${-top} ${W + 2 * pad} ${D + top + bottom}`);

  const ICON: Record<string, string> = Object.fromEntries(PIECES.filter((p) => p.action.kind === 'furnishing').map((p) => [(p.action as { componentId: string }).componentId, p.icon]));

  let svg: SVGSVGElement;
  let drag = $state<{ id: string; kind: 'f' | 'o'; side: Side | 'span'; offset: number; moved: boolean; x0: number; y0: number } | null>(null);

  function toLocal(clientX: number, clientY: number): [number, number] {
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = pt.matrixTransform(m.inverse());
    return [p.x / 100, p.y / 100];
  }

  const lenOf = (f: Furnishing) => (f.componentId === 'ramp' ? rampRun(f) : f.length ?? catalog.component(f.componentId)?.defaults.length ?? 0.5);

  /** Nearest allowed side and the offset along it for a point (metres, structure-local). */
  function snap(u: number, v: number, sides: Side[], len: number): { side: Side; offset: number } {
    const dist: Record<Side, number> = { back: Math.abs(v), front: Math.abs(s.depth - v), left: Math.abs(u), right: Math.abs(s.width - u) };
    const side = [...sides].sort((a, b) => dist[a] - dist[b])[0] ?? 'left';
    const along = side === 'back' || side === 'front' ? u : v;
    const L = sideLength(side, s.width, s.depth);
    return { side, offset: Math.round(Math.max(0, Math.min(L - len, along - len / 2)) * 20) / 20 };
  }

  /** Where a tray piece dropped at this screen point should go (for drag from the tray). */
  export function dropAt(clientX: number, clientY: number, componentId: string): Partial<Furnishing> | null {
    const comp = catalog.component(componentId);
    if (!comp || !svg) return null;
    const r = svg.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return null;
    const [u, v] = toLocal(clientX, clientY);
    if (comp.mount === 'span') return { side: 'span', offset: Math.round(Math.max(0.1, Math.min(s.depth - 0.1, v)) * 20) / 20 };
    return snap(u, v, sidesFor(s, comp.mount), comp.defaults.length);
  }

  function down(e: PointerEvent, id: string, kind: 'f' | 'o') {
    if (e.button > 0) return;
    game.selected = id;
    const item = kind === 'f' ? game.furnishing(id) : game.opening(id);
    if (!item || (kind === 'o' && ((item as StructureOpening).kind === 'window-access' || (item as StructureOpening).kind === 'vestibule'))) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag = { id, kind, side: item.side as Side | 'span', offset: item.offset, moved: false, x0: e.clientX, y0: e.clientY };
  }
  function move(e: PointerEvent) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
    drag.moved = true;
    const [u, v] = toLocal(e.clientX, e.clientY);
    if (drag.kind === 'f') {
      const f = game.furnishing(drag.id)!;
      const comp = catalog.component(f.componentId)!;
      if (f.side === 'span') { drag.offset = Math.round(Math.max(0.1, Math.min(s.depth - 0.1, v)) * 20) / 20; return; }
      const r = snap(u, v, sidesFor(s, comp.mount), lenOf(f));
      drag.side = r.side; drag.offset = r.offset;
    } else {
      const o = game.opening(drag.id)!;
      const L = sideLength(o.side, s.width, s.depth);
      const along = o.side === 'back' || o.side === 'front' ? u : v;
      drag.offset = Math.round(Math.max(0, Math.min(L - o.width, along - o.width / 2)) * 20) / 20;
    }
  }
  function up() {
    if (drag?.moved) {
      if (drag.kind === 'f') game.moveFurnishing(drag.id, { side: drag.side, offset: drag.offset });
      else game.setOpening(drag.id, { offset: drag.offset });
    }
    drag = null;
  }

  function key(e: KeyboardEvent, f: Furnishing) {
    const comp = catalog.component(f.componentId);
    if (!comp) return;
    const step = e.shiftKey ? 0.3 : 0.1;
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); game.remove(f.id); return; }
    if (e.key === 'PageUp' || e.key === 'PageDown') {
      if (comp.mount === 'floor' && comp.recipe !== 'post-scratcher') return;
      e.preventDefault();
      game.moveFurnishing(f.id, { mountHeight: Math.round(Math.max(0.2, f.mountHeight + (e.key === 'PageUp' ? step : -step)) * 100) / 100 });
      return;
    }
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    game.moveFurnishing(f.id, { offset: Math.round((f.offset + dir * step) * 100) / 100 });
  }

  /** Board rectangle (cm) of a furnishing. */
  function rectOf(f: Furnishing, side = f.side, offset = f.offset) {
    const comp = catalog.component(f.componentId);
    const dep = (comp?.defaults.depth ?? 0.3) * 100;
    const len = lenOf(f) * 100, t = offset * 100;
    switch (side) {
      case 'back': return { x: t, y: d, w: len, h: dep };
      case 'front': return { x: t, y: D - d - dep, w: len, h: dep };
      case 'left': return { x: d, y: t, w: dep, h: len };
      case 'right': return { x: W - d - dep, y: t, w: dep, h: len };
      default: return { x: (W - (f.length ?? s.width) * 100) / 2, y: t - dep / 2, w: (f.length ?? s.width) * 100, h: dep };
    }
  }
  function openingSeg(o: StructureOpening, offset = o.offset) {
    const t = offset * 100, w = o.width * 100;
    switch (o.side) {
      case 'back': return { x: t, y: -6 * k, w, h: 12 * k };
      case 'front': return { x: t, y: D - 6 * k, w, h: 12 * k };
      case 'left': return { x: -6 * k, y: t, w: 12 * k, h: w };
      default: return { x: W - 6 * k, y: t, w: 12 * k, h: w };
    }
  }
  const OPEN_COLOR: Record<string, string> = { 'human-door': '#8a5a3c', 'cat-door': '#26364d', 'window-access': '#7fb3d5', 'cleaning-hatch': '#c78a3a', vestibule: '#6b665e' };
  const OPEN_LABEL: Record<string, string> = { 'human-door': 'people door', 'cat-door': 'cat door', 'window-access': 'window insert', 'cleaning-hatch': 'cleaning hatch', vestibule: 'vestibule' };

  const roofFrac = $derived(s.roof.kind === 'mesh' ? 0 : s.roof.kind === 'partial' ? s.roof.coverFraction ?? 0.5 : 1);
  const roofFill = $derived(s.roof.kind === 'polycarbonate' || (s.roof.kind === 'partial' && !(s.roof.materialId ?? '').includes('steel')) ? 'rgba(150,200,230,.28)' : 'rgba(120,128,138,.28)');
  const wallWindow = $derived(game.layout.site.walls[0]?.openings.find((o) => o.id === s.hostOpeningId) ?? game.layout.site.walls[0]?.openings.find((o) => o.kind === 'window'));
  const startOnWall = $derived.by(() => { const w = game.layout.site.walls[0]; if (!w) return 0; const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1; return ((s.x - w.a[0]) * (w.b[0] - w.a[0]) + (s.y - w.a[1]) * (w.b[1] - w.a[1])) / L; });
  const plantsIn = (fid: string) => game.layout.plants.filter((p) => p.furnishingId === fid);
  const SAFETY_COLOR: Record<string, string> = { 'known-hazard': '#b3261e', 'no-known-issue': '#3f6f4f', conflicting: '#a15c00', 'insufficient-data': '#a15c00' };
  const label = (f: Furnishing) => `${catalog.component(f.componentId)?.name ?? f.componentId}${f.side === 'span' ? ' across the catio' : ` on the ${f.side} wall`}${f.mountHeight ? `, ${fmtLen(f.mountHeight, units, true)} up` : ''}`;
</script>

<div class="wrap" bind:clientWidth={cw} bind:clientHeight={ch}>
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<svg bind:this={svg} {viewBox} class="board" data-board role="application" aria-label="Catio plan, {fmtLen(s.width, units, true)} wide and {fmtLen(s.depth, units, true)} deep. Select a piece, then use the arrow keys to move it, Page Up and Page Down to raise or lower it, Delete to remove it." onpointermove={move} onpointerup={up} onpointercancel={() => (drag = null)} onpointerdown={(e) => { if (e.target === svg || (e.target as Element).classList.contains('floor')) game.selected = null; }}>
  <defs>
    <pattern id="q-mesh" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 0H10M0 0V10" stroke="#8a929b" stroke-width="1" /></pattern>
    <pattern id="q-pavers" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#d9d3c7" /><path d="M0 0H40M0 0V40" stroke="#c4bcae" stroke-width="2" /></pattern>
    <pattern id="q-boards" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="#d8bb92" /><path d="M0 0H14" stroke="#c4a173" stroke-width="2" /></pattern>
    <pattern id="q-grass" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#e4ecd6" /><path d="M3 12l2-5M10 14l1-6" stroke="#c6d6ad" stroke-width="1.4" /></pattern>
    <pattern id="q-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V12" stroke="rgba(38,54,77,.18)" stroke-width="4" /></pattern>
  </defs>

  {#if attached}
    <rect x={-pad} y={-top} width={W + 2 * pad} height={Math.max(0, top - 8 * k)} fill="#ebe5da" />
    <text x={-pad + 8 * k} y={-top + 20 * k} class="tiny" style={fs(15)}>House</text>
    {#if wallWindow}<rect x={(wallWindow.offset - startOnWall) * 100} y={-30 * k} width={wallWindow.width * 100} height={14 * k} rx="3" fill="#bcd9ec" stroke="#7fb3d5" stroke-width={k} /><text x={(wallWindow.offset - startOnWall) * 100 + 4} y={-36 * k} class="tiny" style={fs(15)}>window</text>{/if}
  {/if}

  <!-- floor -->
  <rect class="floor" x="0" y="0" width={W} height={D} fill={s.base.kind === 'pavers' ? 'url(#q-pavers)' : s.base.kind === 'raised-floor' || s.base.kind === 'deck' ? 'url(#q-boards)' : 'url(#q-grass)'} />
  {#if s.base.kind === 'ground-skirt'}<rect x={-18} y={attached ? 0 : -18} width={W + 36} height={D + (attached ? 18 : 36)} fill="none" stroke="#8a929b" stroke-dasharray="4 4" stroke-width="2" />{/if}
  {#if roofFrac > 0}<rect x="0" y="0" width={W} height={D * roofFrac} fill={roofFill} pointer-events="none" /><rect x="0" y="0" width={W} height={D * roofFrac} fill="url(#q-hatch)" pointer-events="none" />{/if}

  <!-- walls -->
  <rect x="0" y="0" width={W} height={D} fill="none" stroke="url(#q-mesh)" stroke-width={10 * k} pointer-events="none" />
  <rect x="0" y="0" width={W} height={D} fill="none" stroke="#9a5a2c" stroke-width={Math.max(2, d)} stroke-opacity=".9" pointer-events="none" />
  {#if attached}<line x1="0" y1="0" x2={W} y2="0" stroke="#59544c" stroke-width={8 * k} pointer-events="none" />{/if}

  <!-- openings -->
  {#each s.openings as o (o.id)}
    {@const live = drag?.id === o.id ? drag.offset : o.offset}
    {@const r = openingSeg(o, live)}
    {#if o.kind === 'vestibule'}
      <rect x={o.offset * 100} y={D} width={o.width * 100} height={(o.depth ?? 0.9) * 100} fill="rgba(107,102,94,.08)" stroke={OPEN_COLOR.vestibule} stroke-dasharray="6 4" stroke-width="3" class:sel={game.selected === o.id} role="button" tabindex="0" aria-label="Vestibule" onpointerdown={(e) => down(e, o.id, 'o')} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') game.selected = o.id; }} />
      <text x={o.offset * 100 + 6} y={D + 22 * k} class="tiny" style={fs(15)}>vestibule</text>
    {:else}
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="3" fill={OPEN_COLOR[o.kind]} stroke-width={(game.selected === o.id ? 4 : 2) * k} class="opening" class:sel={game.selected === o.id} role="button" tabindex="0" aria-label={OPEN_LABEL[o.kind]} onpointerdown={(e) => down(e, o.id, 'o')} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') game.selected = o.id; }} />
      {#if o.kind === 'human-door' && o.side === 'front'}
        <path d="M{live * 100} {D} A {o.width * 100} {o.width * 100} 0 0 0 {live * 100 + o.width * 100} {D + (o.swing === 'in' ? -1 : 1) * o.width * 100}" fill="none" stroke="#8a5a3c" stroke-width="1.5" stroke-dasharray="3 3" pointer-events="none" />
      {/if}
      {#if !o.latch && (o.kind === 'human-door' || o.kind === 'cleaning-hatch')}<text x={r.x + r.w / 2} y={o.side === 'front' ? D - 14 * k : o.side === 'back' ? 26 * k : r.y + r.h / 2} text-anchor="middle" class="warn" style={fs(15)}>no latch!</text>{/if}
    {/if}
  {/each}

  <!-- furnishings -->
  {#each s.furnishings as f (f.id)}
    {@const comp = catalog.component(f.componentId)}
    {@const live = drag?.id === f.id ? rectOf(f, drag.side, drag.offset) : rectOf(f)}
    {@const fits = furnishingFits(s, f, catalog)}
    {#if comp}
      <g class="item" class:sel={game.selected === f.id} class:bad={!fits} role="button" tabindex="0" aria-label="{label(f)}{fits ? '' : ' — does not fit here'}" aria-pressed={game.selected === f.id}
        onpointerdown={(e) => down(e, f.id, 'f')} onkeydown={(e) => key(e, f)} onfocus={() => (game.selected = f.id)}>
        <rect x={live.x} y={live.y} width={live.w} height={live.h} rx="5" fill={comp.mount === 'floor' ? '#f6ecdc' : comp.id === 'bridge' ? '#e6d2b0' : '#efdcc0'} stroke={fits ? '#9a5a2c' : '#b3261e'} stroke-width={(game.selected === f.id ? 4 : 2) * k} stroke-dasharray={fits ? undefined : '6 4'} />
        <text x={live.x + live.w / 2} y={live.y + live.h / 2 + 7 * k} text-anchor="middle" class="ico" style={fs(Math.min(22, Math.max(12, Math.min(live.w, live.h) * 0.55 / k)))}>{ICON[f.componentId] ?? '▪'}</text>
        {#if f.mountHeight > 0 && comp.mount !== 'floor'}<text x={live.x + live.w / 2} y={live.y - 4} text-anchor="middle" class="tiny h" style={fs(13)}>{fmtLen(f.mountHeight, units, true)}</text>{/if}
        {#each plantsIn(f.id) as pl, i (pl.id)}
          {@const plant = catalog.plant(pl.plantId)}
          <circle cx={live.x + (10 + i * 13) * k} cy={live.y + 10 * k} r={6 * k} fill={SAFETY_COLOR[plant?.catSafety ?? 'insufficient-data']} stroke="#fff" stroke-width="1.5" />
        {/each}
      </g>
    {/if}
  {/each}

</svg>
</div>
<p class="caption">{fmtLen(s.width, units, true)} × {fmtLen(s.depth, units, true)} · {fmtLen(s.height, units, true)}{s.lowHeight != null && Math.abs(s.lowHeight - s.height) > 0.01 ? `–${fmtLen(frontHeight(s), units, true)}` : ''} tall{s.elevation ? ` · ${fmtLen(s.elevation, units, true)} off the ground` : ''}{roofFrac > 0 ? ' · shaded area = roof cover' : ''}</p>

<style>
  .wrap { width: 100%; flex: 1; min-height: 0; }
  .board { width: 100%; height: 100%; display: block; touch-action: none; user-select: none; }
  .caption { margin: 6px 0 0; text-align: center; font-size: 13px; font-weight: 700; color: var(--body); }
  .tiny { fill: #6b665e; font-weight: 600; }
  .tiny.h { fill: #9a5a2c; }
  .warn { fill: #b3261e; font-weight: 800; }
  .ico { pointer-events: none; }
  .item { cursor: grab; outline: none; }
  .item:focus-visible rect, .item.sel rect { stroke: #e8a93a; }
  .item.bad rect { fill: #fbe7e5; }
  .opening { cursor: ew-resize; stroke: #fff; outline: none; }
  .opening.sel, .opening:focus-visible { stroke: #e8a93a; }
</style>
