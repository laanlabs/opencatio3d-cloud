<script lang="ts">
  // 3D view: the house, obstacles and every structure drawn from its generated parts, plus cats on
  // their perches. Renders only while something changes (camera or scene), and releases the WebGL
  // context on unmount. Structures rebuild when their own inputs change by identity.
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import { onMount } from 'svelte';
  import type { Editor } from './editor.svelte';
  import type { Structure } from '../model/types';
  import type { Part } from '../generate/parts';
  import { buildCats, buildGround, buildHouse, buildObstacle, buildStructure, disposeGroup, sceneBounds } from '../scene/build';
  import { structureBounds } from '../scene/bounds';

  let { editor, compact = false }: { editor: Editor; compact?: boolean } = $props();

  const NO_WEBGL = '3D needs WebGL, which this browser has turned off. The plan, checks, outputs and print still work.';
  const IDLE_MS = 500;

  let host: HTMLDivElement;
  let renderer: THREE.WebGLRenderer | undefined;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let sun: THREE.DirectionalLight;
  let raf = 0;
  let drawUntil = 0;
  let autoFit = true;
  let webgl = $state(true);
  let showCats = $state(true);
  let xray = $state(false);

  const wake = () => { drawUntil = performance.now() + IDLE_MS; };

  const ground = new THREE.Group();
  const house = new THREE.Group();
  const obstacles = new THREE.Group();
  const structures = new THREE.Group();
  const cats = new THREE.Group();
  const selection = new THREE.Group();

  export function screenshot(): string {
    if (!renderer) throw new Error(NO_WEBGL);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  }

  export async function exportGlb(): Promise<Blob> {
    if (!renderer) throw new Error(NO_WEBGL);
    const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
    const root = new THREE.Group();
    root.name = editor.project.name;
    root.add(structures.clone(true), house.clone(true));
    const result = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: true });
    return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
  }

  function bounds(all = false) {
    const b = all ? sceneBounds(editor.project) : structureBounds(editor.project);
    return { cx: (b.min[0] + b.max[0]) / 2, cz: (b.min[1] + b.max[1]) / 2, size: Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], 3) };
  }

  export function fit(view: 'iso' | 'top' | 'front' | 'inside' = 'iso') {
    if (!camera) return;
    const { cx, cz, size } = bounds();
    const k = Math.max(1, 1.1 / Math.max(0.3, camera.aspect));
    const s = size * k;
    const sel = editor.selectedStructure;
    if (view === 'top') { controls.target.set(cx, 0, cz); camera.position.set(cx, s * 1.5, cz + 0.001); }
    else if (view === 'front') { controls.target.set(cx, 1, cz); camera.position.set(cx, 1.4, cz + s * 1.3); }
    else if (view === 'inside' && sel) {
      const r = (sel.rotation * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r);
      const at = (u: number, v: number) => [sel.x + u * c - v * sn, sel.y + u * sn + v * c];
      const [tx, tz] = at(sel.width / 2, 0.2), [ex, ez] = at(sel.width / 2, Math.max(0.3, (sel.depth ?? 1) - 0.25));
      controls.target.set(tx, (sel.elevation ?? 0) + 0.8, tz);
      camera.position.set(ex, (sel.elevation ?? 0) + Math.min(1.2, sel.height * 0.6), ez);
    } else { controls.target.set(cx, 0.9, cz); camera.position.set(cx + s * 0.7, 0.9 + s * 0.55, cz + s * 1.1); }
    controls.update();
    renderer?.render(scene, camera);
    wake();
  }

  // ---------- scene sync ----------

  type Built = { s: Structure; parts: Part[]; obj: THREE.Group; hl: string | null };
  const built = new Map<string, Built>();
  let lastWalls: unknown = null, lastObstacles: unknown = null, lastGround = '', lastCats: unknown = null, lastAssembly: unknown = null;

  function syncScene() {
    const p = editor.project;
    const a = editor.assembly;
    if (p.site.ground !== lastGround) {
      disposeGroup(ground);
      ground.add(buildGround(400, p.site.ground));
      lastGround = p.site.ground;
    }
    if (p.site.walls !== lastWalls) { disposeGroup(house); house.add(buildHouse(p)); lastWalls = p.site.walls; }
    if (p.site.obstacles !== lastObstacles) { disposeGroup(obstacles); for (const o of p.site.obstacles) obstacles.add(buildObstacle(o)); lastObstacles = p.site.obstacles; }
    const hl = editor.selection && (editor.selection.kind === 'opening' || editor.selection.kind === 'furnishing') ? editor.selection.id : null;
    const seen = new Set<string>();
    for (const s of p.structures) {
      seen.add(s.id);
      const parts = a.parts.filter((x) => x.structureId === s.id);
      const prev = built.get(s.id);
      const sameParts = prev && prev.parts.length === parts.length && prev.parts.every((x, i) => x === parts[i] || JSON.stringify(x) === JSON.stringify(parts[i]));
      const myHl = hl && (s.openings.some((o) => o.id === hl) || s.furnishings.some((f) => f.id === hl)) ? hl : null;
      if (prev && prev.s === s && sameParts && prev.hl === myHl) continue;
      if (prev) { disposeGroup(prev.obj); structures.remove(prev.obj); }
      const obj = buildStructure(s, parts, editor.cat, { highlightOwner: myHl });
      structures.add(obj);
      built.set(s.id, { s, parts, obj, hl: myHl });
    }
    for (const [id, b] of built) if (!seen.has(id)) { disposeGroup(b.obj); structures.remove(b.obj); built.delete(id); }
    if (p.cats !== lastCats || a !== lastAssembly) { disposeGroup(cats); cats.add(buildCats(p, a, editor.cat)); lastCats = p.cats; lastAssembly = a; }
    cats.visible = showCats;
    // Selection box around the selected structure.
    disposeGroup(selection);
    const sel = editor.selectedStructure;
    const b = sel && built.get(sel.id);
    if (b) {
      const box = new THREE.Box3().setFromObject(b.obj);
      if (!box.isEmpty()) selection.add(new THREE.Box3Helper(box.expandByScalar(0.03), new THREE.Color('#e8a93a')));
    }
    for (const b2 of built.values()) b2.obj.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && 'map' in m && (m as THREE.MeshStandardMaterial).map) m.visible = !xray; });
    const { cx, cz, size } = bounds(true);
    const reach = size * 0.8 + 4;
    sun.position.set(cx - reach, reach * 1.6, cz + reach * 0.8);
    sun.target.position.set(cx, 0, cz);
    sun.target.updateMatrixWorld();
    const cam = sun.shadow.camera;
    cam.left = -reach; cam.right = reach; cam.top = reach; cam.bottom = -reach; cam.near = 0.5; cam.far = reach * 6;
    cam.updateProjectionMatrix();
  }

  $effect(() => {
    editor.project; editor.assembly; editor.selection; showCats; xray;
    if (!renderer) return;
    syncScene();
    // One frame now, so the canvas (and exports) are current even before the next animation frame.
    renderer.render(scene, camera);
    wake();
  });

  // ---------- picking ----------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downAt: { x: number; y: number } | null = null;
  function onDown(e: PointerEvent) { downAt = { x: e.clientX, y: e.clientY }; }
  function onUp(e: PointerEvent) {
    const click = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 4;
    downAt = null;
    if (!click || !renderer) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects([structures, obstacles, house], true)[0];
    const u = hit?.object.userData ?? {};
    if (u.structureId) {
      const s = editor.project.structures.find((x) => x.id === u.structureId);
      if (u.ownerId && s?.openings.some((o) => o.id === u.ownerId)) editor.selection = { kind: 'opening', id: u.ownerId, structureId: s.id };
      else if (u.ownerId && s?.furnishings.some((f) => f.id === u.ownerId)) editor.selection = { kind: 'furnishing', id: u.ownerId, structureId: s.id };
      else editor.selection = { kind: 'structure', id: u.structureId };
    } else if (u.obstacleId) editor.selection = { kind: 'obstacle', id: u.obstacleId };
    else if (u.wallOpeningId) editor.selection = { kind: 'wall-opening', id: u.wallOpeningId, wallId: u.wallId };
    else if (u.wallId) editor.selection = { kind: 'wall', id: u.wallId };
    else editor.selection = null;
  }

  onMount(() => {
    let r: THREE.WebGLRenderer;
    try { r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch (e) { console.warn('3D view: WebGL is not available.', e); webgl = false; return; }
    renderer = r;
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(r.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color('#d9e4ec');
    scene.fog = new THREE.Fog('#d9e4ec', 60, 220);
    camera = new THREE.PerspectiveCamera(45, 1, 0.05, 1000);
    controls = new OrbitControls(camera, r.domElement);
    controls.enableDamping = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;
    controls.minDistance = 0.3;
    controls.maxDistance = 200;
    controls.addEventListener('start', () => (autoFit = false));
    controls.addEventListener('change', wake);

    const hemi = new THREE.HemisphereLight('#ffffff', '#8c8a6e', 1.1);
    sun = new THREE.DirectionalLight('#fff3e2', 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    scene.add(hemi, sun, sun.target, ground, house, obstacles, structures, cats, selection);

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      r.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      if (autoFit) fit();
      wake();
    });
    ro.observe(host);
    document.addEventListener('visibilitychange', wake);
    syncScene();
    fit();

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (controls.update()) wake();
      if (document.hidden || performance.now() > drawUntil) return;
      r.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', wake);
      controls.dispose();
      for (const g of [ground, house, obstacles, structures, cats, selection]) disposeGroup(g);
      built.clear();
      r.dispose();
      r.forceContextLoss();
      r.domElement.remove();
      renderer = undefined;
    };
  });
</script>

<div class="viewer" class:off={!webgl} bind:this={host} onpointerdown={onDown} onpointerup={onUp} role="application" aria-label="3D view. Drag to orbit, scroll or pinch to zoom.">
  {#if webgl}
    <div class="tools" class:compact onpointerdown={(e) => e.stopPropagation()} onpointerup={(e) => e.stopPropagation()} role="toolbar" aria-label="3D view controls" tabindex="-1">
      <button class="chip" onclick={() => fit('iso')}>⟲ View</button>
      <button class="chip" onclick={() => fit('top')}>Top</button>
      <button class="chip" onclick={() => fit('front')}>Front</button>
      {#if editor.selectedStructure && editor.selectedStructure.template !== 'tunnel'}<button class="chip" onclick={() => fit('inside')}>Cat’s eye</button>{/if}
      <button class="chip" class:on={showCats} aria-pressed={showCats} onclick={() => (showCats = !showCats)}>Cats</button>
      <button class="chip" class:on={xray} aria-pressed={xray} onclick={() => (xray = !xray)} title="Hide the mesh to see the framing">Frame only</button>
    </div>
  {:else}
    <p class="nowebgl" role="status">{NO_WEBGL}</p>
  {/if}
</div>

<style>
  .viewer { position: relative; width: 100%; height: 100%; overflow: hidden; touch-action: none; background: #d9e4ec; }
  .viewer.off { background: var(--bg); }
  .viewer :global(canvas) { display: block; width: 100%; height: 100%; }
  .tools { position: absolute; left: 10px; bottom: 10px; display: flex; gap: 6px; flex-wrap: wrap; max-width: calc(100% - 20px); }
  .nowebgl { position: absolute; inset: 0; margin: 0; display: grid; place-items: center; padding: 24px; text-align: center; color: var(--ink-soft); font-size: 13px; }
</style>
