<script lang="ts">
  // 2D plan (SVG, metres): house walls with their openings, obstacles, structures with posts, doors and
  // furnishings, and dimension lines on the selection. Drag to pan, wheel or pinch to zoom, drag a
  // structure or obstacle to move it (attached structures slide along their wall). While placing, a keyboard
  // marker (arrow keys, Enter) places things without a pointer.
  import { onMount } from 'svelte';
  import type { Editor } from './editor.svelte';
  import type { Project, Structure, Vec2 } from '../model/types';
  import { footprints, rad, snapTo, toPlan, wallDir, wallNormal } from '../model/geometry';
  import { fmtLen } from '../model/units';
  import { sceneBounds } from '../scene/bounds';
  import { furnishingCentre } from '../analysis/checks';

  let { editor }: { editor: Editor } = $props();
  const p = $derived(editor.project);

  let host: HTMLDivElement;
  let w = $state(600), h = $state(400);
  let cx = $state(0), cy = $state(0), scale = $state(60); // px per metre
  let fitted = false;

  export function fit() {
    const b = sceneBounds(editor.project);
    const bw = Math.max(4, b.max[0] - b.min[0] + 3), bh = Math.max(4, b.max[1] - b.min[1] + 3);
    scale = Math.max(8, Math.min(300, Math.min(w / bw, h / bh)));
    cx = (b.min[0] + b.max[0]) / 2;
    cy = (b.min[1] + b.max[1]) / 2;
  }

  const vb = $derived(`${cx - w / scale / 2} ${cy - h / scale / 2} ${w / scale} ${h / scale}`);
  const px = $derived(1 / scale); // one screen pixel in metres
  const minor = $derived(editor.step);
  const major = $derived(editor.units === 'imperial' ? 0.3048 * 5 : 1);

  function toPlanPt(e: { clientX: number; clientY: number }): Vec2 {
    const r = host.getBoundingClientRect();
    return [cx + (e.clientX - r.left - w / 2) / scale, cy + (e.clientY - r.top - h / 2) / scale];
  }

  // ---------- pointer interaction ----------
  type Drag = { kind: 'pan'; start: Vec2; c: Vec2 } | { kind: 'structure' | 'obstacle'; id: string; start: Vec2; project: Project; moved: boolean };
  let drag: Drag | null = null;
  const pointers = new Map<number, Vec2>();
  let pinch: { d: number; scale: number } | null = null;
  let wallStart = $state<Vec2 | null>(null);

  function down(e: PointerEvent) {
    host.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), scale };
      drag = null;
      return;
    }
    const at = toPlanPt(e);
    if (editor.placing && !editor.readonly) { placeAt(at); return; }
    const t = (e.target as Element).closest('[data-kind]') as HTMLElement | SVGElement | null;
    const kind = t?.getAttribute('data-kind');
    const id = t?.getAttribute('data-id') ?? '';
    if (kind === 'structure' || kind === 'obstacle') {
      editor.selection = { kind, id };
      if (!editor.readonly) drag = { kind, id, start: at, project: editor.project, moved: false };
      return;
    }
    if (kind === 'furnishing' || kind === 'opening') { editor.selection = { kind, id, structureId: t!.getAttribute('data-structure')! }; return; }
    if (kind === 'wall') { editor.selection = { kind: 'wall', id }; return; }
    if (kind === 'wall-opening') { editor.selection = { kind: 'wall-opening', id, wallId: t!.getAttribute('data-wall')! }; return; }
    drag = { kind: 'pan', start: [e.clientX, e.clientY], c: [cx, cy] };
    editor.selection = null;
  }

  function move(e: PointerEvent) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      scale = Math.max(8, Math.min(400, (pinch.scale * Math.hypot(a[0] - b[0], a[1] - b[1])) / pinch.d));
      return;
    }
    if (!drag) { if (editor.placing?.kind === 'wall') hover = toPlanPt(e); return; }
    if (drag.kind === 'pan') {
      cx = drag.c[0] - (e.clientX - drag.start[0]) / scale;
      cy = drag.c[1] - (e.clientY - drag.start[1]) / scale;
      return;
    }
    const at = toPlanPt(e);
    let delta: Vec2 = [at[0] - drag.start[0], at[1] - drag.start[1]];
    if (!drag.moved && Math.hypot(delta[0], delta[1]) * scale < 4) return;
    drag.moved = true;
    if (drag.kind === 'structure') {
      const s0 = drag.project.structures.find((s) => s.id === (drag as { id: string }).id)!;
      const wall = drag.project.site.walls.find((x) => x.id === s0.hostWallId);
      if (wall) {
        // Attached: slide along the wall only.
        const d = wallDir(wall);
        const t = snapTo(delta[0] * d[0] + delta[1] * d[1], minor / 2);
        delta = [d[0] * t, d[1] * t];
      } else delta = [snapTo(s0.x + delta[0], minor / 2) - s0.x, snapTo(s0.y + delta[1], minor / 2) - s0.y];
      editor.moveStructure(drag.id, drag.project, delta);
    } else editor.moveObstacle(drag.id, drag.project, delta);
  }

  function up(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (drag && drag.kind !== 'pan' && drag.moved) editor.endDrag();
    drag = null;
  }

  let hover = $state<Vec2 | null>(null);

  function placeAt(at: Vec2) {
    const placing = editor.placing;
    if (!placing) return;
    if (placing.kind === 'structure') editor.addStructure(placing.template, at);
    else if (placing.kind === 'obstacle') editor.addObstacle(placing.obstacle, at);
    else if (placing.kind === 'wall') {
      const snapped: Vec2 = [snapTo(at[0], minor), snapTo(at[1], minor)];
      if (!wallStart) wallStart = snapped;
      else { editor.addWall(wallStart, snapped); wallStart = null; editor.placing = null; }
    }
  }

  // Keyboard placing: picking a tool puts a marker in the middle of the view and focus on the plan.
  let marker = $state<Vec2 | null>(null);
  let keyed = $state(false);
  $effect(() => {
    if (!editor.placing || editor.readonly) { marker = null; keyed = false; return; }
    marker = [snapTo(cx, minor), snapTo(cy, minor)];
    host.focus({ preventScroll: true });
  });

  function key(e: KeyboardEvent) {
    if (!editor.placing || !marker || editor.readonly || e.target !== host) return;
    const f = (e.shiftKey ? 4 : 1) * minor;
    const d: Record<string, Vec2> = { ArrowLeft: [-f, 0], ArrowRight: [f, 0], ArrowUp: [0, -f], ArrowDown: [0, f] };
    if (d[e.key]) {
      e.preventDefault();
      keyed = true;
      marker = [marker[0] + d[e.key][0], marker[1] + d[e.key][1]];
      hover = marker;
      // Keep the marker in view.
      const mx = w / scale / 2 - 1, my = h / scale / 2 - 1;
      if (Math.abs(marker[0] - cx) > mx) cx = marker[0] - Math.sign(marker[0] - cx) * mx;
      if (Math.abs(marker[1] - cy) > my) cy = marker[1] - Math.sign(marker[1] - cy) * my;
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      keyed = true;
      placeAt(marker);
    }
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    const before = toPlanPt(e);
    scale = Math.max(8, Math.min(400, scale * Math.exp(-e.deltaY * 0.0015)));
    const after = toPlanPt(e);
    cx += before[0] - after[0];
    cy += before[1] - after[1];
  }

  /** Arrow-key nudge of the selected structure (grid steps). */
  export function nudge(dx: number, dy: number) {
    const s = editor.selectedStructure;
    if (!s || editor.selection?.kind !== 'structure') return;
    const wall = editor.project.site.walls.find((x) => x.id === s.hostWallId);
    let d: Vec2 = [dx * minor, dy * minor];
    if (wall) { const dir = wallDir(wall); const t = d[0] * dir[0] + d[1] * dir[1]; d = [dir[0] * t, dir[1] * t]; }
    editor.updateStructure(s.id, { x: s.x + d[0], y: s.y + d[1] });
  }

  onMount(() => {
    const ro = new ResizeObserver(() => {
      w = host.clientWidth || 600; h = host.clientHeight || 400;
      if (!fitted) { fit(); fitted = true; }
    });
    ro.observe(host);
    host.addEventListener('wheel', wheel, { passive: false });
    return () => { ro.disconnect(); host.removeEventListener('wheel', wheel); };
  });

  // ---------- drawing helpers ----------
  const pts = (poly: Vec2[]) => poly.map((q) => `${q[0]},${q[1]}`).join(' ');
  const gridLines = $derived.by(() => {
    const x0 = cx - w / scale / 2, x1 = cx + w / scale / 2, y0 = cy - h / scale / 2, y1 = cy + h / scale / 2;
    const step = minor * scale < 6 ? major : minor;
    const out: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
    if ((x1 - x0) / step > 400) return out;
    for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) out.push({ x1: x, y1: y0, x2: x, y2: y1, major: Math.abs(x / major - Math.round(x / major)) < 1e-6 });
    for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) out.push({ x1: x0, y1: y, x2: x1, y2: y, major: Math.abs(y / major - Math.round(y / major)) < 1e-6 });
    return out;
  });

  const OPENING_COLOR: Record<string, string> = { window: '#5b9bd5', door: '#8a5a3c', 'patio-door': '#5b9bd5', vent: '#8f969c', 'dryer-vent': '#c0504d', utility: '#7a6aa8', meter: '#7a6aa8', downspout: '#6b7d8a' };

  /** Stud/post positions in plan, from the generated parts. */
  function posts(s: Structure): Vec2[] {
    return editor.assembly.parts
      .filter((pt) => pt.structureId === s.id && (pt.role === 'stud' || pt.role === 'jamb' || pt.role === 'hoop-post') && pt.geom?.type === 'bar')
      .map((pt) => { const g = pt.geom as { a: [number, number, number] }; return toPlan(s, g.a[0], g.a[2]); });
  }

  function sideSeg(s: Structure, side: string, a: number, b: number): [Vec2, Vec2] {
    const at = (t: number): Vec2 => (side === 'back' ? [t, 0] : side === 'front' ? [t, s.depth] : side === 'left' ? [0, t] : [s.width, t]);
    const A = at(a), B = at(b);
    return [toPlan(s, A[0], A[1]), toPlan(s, B[0], B[1])];
  }

  /** Door swing arc for a human door or hatch (in plan). */
  function swing(s: Structure, o: Structure['openings'][number]): string {
    const [A, B] = sideSeg(s, o.side, o.offset, o.offset + o.width);
    const hingeAt = o.hinge === 'right' ? B : A, free = o.hinge === 'right' ? A : B;
    const n = o.side === 'back' ? [0, -1] : o.side === 'front' ? [0, 1] : o.side === 'left' ? [-1, 0] : [1, 0];
    const outSign = (o.swing ?? 'out') === 'out' ? 1 : -1;
    const r = rad(s.rotation), c = Math.cos(r), sn = Math.sin(r);
    const nw: Vec2 = [(n[0] * c - n[1] * sn) * outSign, (n[0] * sn + n[1] * c) * outSign];
    const tip: Vec2 = [hingeAt[0] + nw[0] * o.width, hingeAt[1] + nw[1] * o.width];
    const cross = (tip[0] - hingeAt[0]) * (free[1] - hingeAt[1]) - (tip[1] - hingeAt[1]) * (free[0] - hingeAt[0]);
    return `M${hingeAt[0]},${hingeAt[1]} L${tip[0]},${tip[1]} A${o.width},${o.width} 0 0 ${cross > 0 ? 1 : 0} ${free[0]},${free[1]}`;
  }

  const selId = $derived(editor.selection?.kind === 'structure' ? editor.selection.id : editor.selection?.structureId);
</script>

<!-- role="application" takes keys for the placing marker; svelte does not count it as interactive -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="plan" class:placing={!!editor.placing} bind:this={host}
  onpointerdown={down} onpointermove={(e) => { keyed = false; move(e); }} onpointerup={up} onpointercancel={up} onkeydown={key}
  tabindex="0" role="application" aria-label="Plan view. Drag to pan, scroll to zoom, select and drag a catio to move it. When placing, move the marker with the arrow keys and press Enter."
>
  <svg viewBox={vb} width={w} height={h}>
    <g class="grid">
      {#each gridLines as l}<line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.major ? 'var(--grid-major)' : 'var(--grid)'} stroke-width={px} />{/each}
    </g>

    {#each p.site.walls as wall (wall.id)}
      {@const n = wallNormal(wall)}
      {@const d = wallDir(wall)}
      <g data-kind="wall" data-id={wall.id} class:sel={editor.selection?.id === wall.id}>
        <polygon class="house" points={pts([wall.a, wall.b, [wall.b[0] - n[0] * 0.2, wall.b[1] - n[1] * 0.2], [wall.a[0] - n[0] * 0.2, wall.a[1] - n[1] * 0.2]])} />
        <polygon class="indoor" points={pts([[wall.a[0] - n[0] * 0.2, wall.a[1] - n[1] * 0.2], [wall.b[0] - n[0] * 0.2, wall.b[1] - n[1] * 0.2], [wall.b[0] - n[0] * 1.6, wall.b[1] - n[1] * 1.6], [wall.a[0] - n[0] * 1.6, wall.a[1] - n[1] * 1.6]])} />
      </g>
      {#each wall.openings as o (o.id)}
        {@const A = [wall.a[0] + d[0] * o.offset, wall.a[1] + d[1] * o.offset]}
        {@const B = [A[0] + d[0] * o.width, A[1] + d[1] * o.width]}
        <line data-kind="wall-opening" data-id={o.id} data-wall={wall.id} x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke={OPENING_COLOR[o.kind] ?? '#999'} stroke-width={editor.selection?.id === o.id ? 0.16 : 0.1} stroke-linecap="butt" class="wopen"><title>{o.name || o.kind}</title></line>
      {/each}
    {/each}

    {#each p.site.obstacles as o (o.id)}
      <g data-kind="obstacle" data-id={o.id} class="obst" class:sel={editor.selection?.id === o.id} transform="translate({o.x} {o.y}) rotate({o.rotation})">
        {#if o.kind === 'tree'}<circle r={Math.max(o.width, o.depth) / 2} fill="#9db88a" fill-opacity=".55" stroke="#5f8a4a" stroke-width={px * 1.5} />
        {:else}<rect x={-o.width / 2} y={-o.depth / 2} width={o.width} height={o.depth} fill={o.kind === 'no-build' ? '#d9534f' : '#b9bec4'} fill-opacity={o.kind === 'no-build' ? 0.18 : 0.7} stroke={o.kind === 'no-build' ? '#d9534f' : '#8f969c'} stroke-dasharray={o.kind === 'no-build' ? `${px * 6} ${px * 4}` : ''} stroke-width={px * 1.5} />{/if}
        <text y={0.05} font-size={11 * px} text-anchor="middle" class="olabel">{o.name || o.kind.replace('-', ' ')}</text>
      </g>
    {/each}

    {#each p.structures as s (s.id)}
      {@const fp = footprints(s)}
      {@const selected = selId === s.id}
      <g data-kind="structure" data-id={s.id} class="struct" class:sel={selected}>
        {#each fp as f}<polygon points={pts(f)} class="fp" />{/each}
        {#each posts(s) as q}<rect x={q[0] - 0.04} y={q[1] - 0.04} width="0.08" height="0.08" class="post" />{/each}
      </g>
      {#each s.openings as o (o.id)}
        {#if s.template !== 'tunnel'}
          {@const [A, B] = sideSeg(s, o.side, o.offset, o.offset + o.width)}
          <g data-kind="opening" data-id={o.id} data-structure={s.id} class="opening" class:sel={editor.selection?.id === o.id}>
            <line x1={A[0]} y1={A[1]} x2={B[0]} y2={B[1]} stroke={o.kind === 'window-access' ? '#5b9bd5' : o.kind === 'cat-door' ? '#1d1c1a' : '#fff'} stroke-width={0.07} />
            {#if o.kind === 'human-door' || o.kind === 'cleaning-hatch'}<path d={swing(s, o)} fill="none" stroke="var(--dusk)" stroke-width={px * 1.2} stroke-dasharray="{px * 4} {px * 3}" />{/if}
          </g>
        {/if}
      {/each}
      {#each s.furnishings as f (f.id)}
        {@const c = editor.cat.component(f.componentId)}
        {#if c && s.template !== 'tunnel'}
          {@const len = f.side === 'span' ? (f.length ?? s.width) : (f.length ?? c.defaults.length)}
          {@const ctr = furnishingCentre(s, f, len)}
          {@const along = f.side === 'left' || f.side === 'right'}
          {@const inset = f.side === 'span' ? 0 : c.defaults.depth / 2 + 0.03}
          {@const lc = f.side === 'back' ? [ctr[0], ctr[1] + inset] : f.side === 'front' ? [ctr[0], ctr[1] - inset] : f.side === 'left' ? [ctr[0] + inset, ctr[1]] : f.side === 'right' ? [ctr[0] - inset, ctr[1]] : ctr}
          {@const pc = toPlan(s, lc[0], lc[1])}
          <g data-kind="furnishing" data-id={f.id} data-structure={s.id} class="furn" class:sel={editor.selection?.id === f.id} transform="translate({pc[0]} {pc[1]}) rotate({s.rotation + (along ? 90 : 0)})">
            <rect x={-len / 2} y={-c.defaults.depth / 2} width={len} height={c.defaults.depth} rx="0.02" class="fur {c.category}" />
          </g>
        {/if}
      {/each}
      {@const lp = toPlan(s, s.template === 'tunnel' ? (s.path?.[0]?.[0] ?? 0) : s.width / 2, s.template === 'tunnel' ? (s.path?.[0]?.[1] ?? 0) : s.depth / 2)}
      <text x={lp[0]} y={lp[1]} font-size={12 * px} text-anchor="middle" class="slabel" pointer-events="none">{s.name}</text>
      {#if selected && s.template !== 'tunnel'}
        {@const off = 0.45}
        {@const a0 = toPlan(s, 0, s.depth + off)}{@const a1 = toPlan(s, s.width, s.depth + off)}
        {@const b0 = toPlan(s, s.width + off, 0)}{@const b1 = toPlan(s, s.width + off, s.depth)}
        <g class="dim" pointer-events="none">
          <line x1={a0[0]} y1={a0[1]} x2={a1[0]} y2={a1[1]} stroke-width={px} />
          <text x={(a0[0] + a1[0]) / 2} y={(a0[1] + a1[1]) / 2 - 3 * px} font-size={11 * px} text-anchor="middle">{fmtLen(s.width, editor.units)}</text>
          <line x1={b0[0]} y1={b0[1]} x2={b1[0]} y2={b1[1]} stroke-width={px} />
          <text x={(b0[0] + b1[0]) / 2 + 4 * px} y={(b0[1] + b1[1]) / 2} font-size={11 * px}>{fmtLen(s.depth, editor.units)}</text>
        </g>
      {/if}
    {/each}

    {#if wallStart && hover}<line x1={wallStart[0]} y1={wallStart[1]} x2={hover[0]} y2={hover[1]} stroke="var(--house)" stroke-width="0.2" opacity=".5" />{/if}
    {#if marker && keyed}
      <g class="marker" pointer-events="none" stroke-width={2 * px}>
        <circle cx={marker[0]} cy={marker[1]} r={10 * px} fill="none" />
        <line x1={marker[0] - 16 * px} y1={marker[1]} x2={marker[0] + 16 * px} y2={marker[1]} />
        <line x1={marker[0]} y1={marker[1] - 16 * px} x2={marker[0]} y2={marker[1] + 16 * px} />
      </g>
    {/if}
  </svg>
  <div class="zoom" onpointerdown={(e) => e.stopPropagation()} role="toolbar" aria-label="Plan zoom" tabindex="-1">
    <button class="chip" onclick={() => (scale = Math.min(400, scale * 1.25))} aria-label="Zoom in">+</button>
    <button class="chip" onclick={() => (scale = Math.max(8, scale / 1.25))} aria-label="Zoom out">−</button>
    <button class="chip" onclick={fit}>Fit</button>
  </div>
  {#if editor.placing}
    <p class="hint" role="status">
      {editor.placing.kind === 'wall' ? (wallStart ? 'Now pick the other end of the wall' : 'Pick where the wall starts') : 'Pick a spot in the plan to place it'}{keyed ? ' (arrow keys move, Enter places)' : ''} — <button class="link" onpointerdown={(e) => e.stopPropagation()} onclick={() => { editor.placing = null; wallStart = null; }}>cancel</button>
    </p>
  {/if}
</div>

<style>
  .plan { position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--plan-bg); touch-action: none; user-select: none; cursor: grab; }
  .plan.placing { cursor: crosshair; }
  .plan:focus-visible { outline: 2px solid var(--sun); outline-offset: -2px; }
  .marker { stroke: var(--sun); }
  svg { display: block; }
  .house { fill: var(--house); }
  .indoor { fill: var(--house-fill); }
  [data-kind='wall'] { cursor: pointer; }
  .wopen { cursor: pointer; }
  .obst { cursor: move; }
  .obst.sel rect, .obst.sel circle { stroke: var(--sun); }
  .olabel { fill: var(--muted); }
  .struct { cursor: move; }
  .fp { fill: var(--cedar-tint); fill-opacity: .75; stroke: var(--cedar); stroke-width: 0.03; }
  .struct.sel .fp { stroke: var(--sun); stroke-width: 0.05; fill-opacity: .9; }
  .post { fill: var(--cedar); }
  .opening { cursor: pointer; }
  .opening.sel line { stroke: var(--sun) !important; }
  .furn { cursor: pointer; }
  .fur { fill: #d8c3a5; stroke: #9a7b5a; stroke-width: 0.01; }
  .fur.resource { fill: #c7d3dc; stroke: #6b7d8a; }
  .fur.planter { fill: #c98a5f; stroke: #8a4524; }
  .furn.sel .fur { stroke: var(--sun); stroke-width: 0.03; }
  .slabel { fill: var(--dusk-dark); font-weight: 700; paint-order: stroke; stroke: var(--plan-bg); stroke-width: 0.03; }
  .dim line { stroke: var(--dusk); }
  .dim text { fill: var(--dusk); font-weight: 700; }
  .zoom { position: absolute; right: 10px; bottom: 10px; display: flex; gap: 4px; }
  .hint { position: absolute; left: 50%; top: 10px; transform: translateX(-50%); margin: 0; background: var(--dusk); color: #fff; padding: 6px 12px; border-radius: 999px; font-size: 13px; white-space: nowrap; }
  .hint .link { background: none; border: 0; color: var(--sun); text-decoration: underline; cursor: pointer; padding: 0; }
</style>
