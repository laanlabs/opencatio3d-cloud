<script lang="ts">
  // Build mode's 3D view: the house and ground, every part from the steps already done, and the
  // current step's parts in the highlight colour; later steps are not drawn yet. "Finished" shows the
  // whole catio. Renders only while the camera or the step changes.
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import { onMount } from 'svelte';
  import type { Project } from '../../model/types';
  import type { Assembly, Step } from '../../generate/assembly';
  import type { Catalog } from '../../catalog/catalog';
  import { buildGround, buildHouse, buildObstacle, buildStructure, disposeGroup } from '../../scene/build';
  import { builtBefore } from '../progress';

  let { project, assembly, cat, step, whole = false }: { project: Project; assembly: Assembly; cat: Catalog; step: Step | undefined; whole?: boolean } = $props();

  let host: HTMLDivElement;
  let renderer: THREE.WebGLRenderer | undefined;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let webgl = $state(true);
  let raf = 0, drawUntil = 0;
  let fittedFor = '';
  const wake = () => { drawUntil = performance.now() + 500; };
  const site = new THREE.Group();
  const padMat = new THREE.MeshBasicMaterial({ color: '#e8a93a', transparent: true, opacity: 0.55, depthWrite: false });
  const structures = new THREE.Group();

  function sync() {
    disposeGroup(structures);
    const before = step && !whole ? builtBefore(assembly.steps, step) : null;
    const now = step && !whole ? new Set(step.partIds) : undefined;
    const only = before && now ? new Set([...before, ...now]) : undefined;
    for (const s of project.structures) {
      const parts = assembly.parts.filter((p) => p.structureId === s.id);
      structures.add(buildStructure(s, parts, cat, { only, highlightParts: now }));
    }
    // Pavers and sand have no shape of their own: the base step shows the footprint to prepare.
    const s = step && !whole && step.key === 'base' ? project.structures.find((x) => x.id === step.structureId) : undefined;
    if (s && !s.elevation) structures.add(footprint(s));
    // Frame the structure being built (the whole site for "Finished"), once per structure.
    const target = whole ? 'all' : step?.structureId ?? 'all';
    if (target !== fittedFor) { fittedFor = target; fit(target); }
  }

  function footprint(s: Project['structures'][number]): THREE.Group {
    const g = new THREE.Group();
    g.position.set(s.x, 0.012, s.y);
    g.rotation.y = -(s.rotation * Math.PI) / 180;
    const pad = (a: number[], b: number[], w: number) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len + w, w), padMat);
      m.rotation.set(-Math.PI / 2, 0, -Math.atan2(b[1] - a[1], b[0] - a[0]));
      m.position.set((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2);
      g.add(m);
    };
    if (s.template === 'tunnel' && s.path && s.path.length > 1) for (let i = 1; i < s.path.length; i++) pad(s.path[i - 1], s.path[i], s.width);
    else {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(s.width, s.depth), padMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(s.width / 2, 0, s.depth / 2);
      g.add(m);
    }
    return g;
  }

  function fit(target: string) {
    const s = project.structures.find((x) => x.id === target);
    const box = new THREE.Box3();
    if (s) {
      // The structure's own corners (its parts may not be drawn yet).
      const r = (s.rotation * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r), e = s.elevation ?? 0;
      const pts = s.template === 'tunnel' && s.path?.length ? s.path : [[0, 0], [s.width, 0], [s.width, s.depth], [0, s.depth]];
      for (const [u, v] of pts) for (const y of [e, e + s.height]) box.expandByPoint(new THREE.Vector3(s.x + u * c - v * sn, y, s.y + u * sn + v * c));
    } else box.setFromObject(structures);
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
    const centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, size.y, 2) * Math.max(1, 1.1 / Math.max(0.4, camera.aspect));
    controls.target.set(centre.x, Math.min(centre.y, 1), centre.z);
    camera.position.set(centre.x + span * 0.75, centre.y + span * 0.6, centre.z + span * 1.15);
    controls.update();
    wake();
  }

  $effect(() => {
    step; whole; assembly;
    if (!renderer) return;
    sync();
    wake();
  });

  onMount(() => {
    let r: THREE.WebGLRenderer;
    try { r = new THREE.WebGLRenderer({ antialias: true }); }
    catch { webgl = false; return; }
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
    controls.maxDistance = 120;
    controls.addEventListener('change', wake);
    const hemi = new THREE.HemisphereLight('#ffffff', '#8c8a6e', 1.1);
    const sun = new THREE.DirectionalLight('#fff3e2', 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    const xs = project.structures.map((s) => s.x), zs = project.structures.map((s) => s.y);
    const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0, cz = zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0;
    const reach = 12;
    sun.position.set(cx - reach, reach * 1.6, cz + reach * 0.8);
    sun.target.position.set(cx, 0, cz);
    Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 0.5, far: reach * 6 });
    sun.shadow.camera.updateProjectionMatrix();
    site.add(buildGround(400, project.site.ground), buildHouse(project));
    for (const o of project.site.obstacles) site.add(buildObstacle(o));
    scene.add(hemi, sun, sun.target, site, structures);

    const ro = new ResizeObserver(() => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      r.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      wake();
    });
    ro.observe(host);
    r.setSize(host.clientWidth || 600, host.clientHeight || 400);
    camera.aspect = (host.clientWidth || 600) / (host.clientHeight || 400);
    camera.updateProjectionMatrix();
    sync();
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
      controls.dispose();
      disposeGroup(site);
      disposeGroup(structures);
      padMat.dispose();
      r.dispose();
      r.forceContextLoss();
      r.domElement.remove();
      renderer = undefined;
    };
  });
</script>

<div class="view" bind:this={host} role="img" aria-label={whole ? `The finished catio, ${project.name}` : step ? `3D view: ${step.title}. Parts for this step are highlighted in yellow; parts from earlier steps are in place.` : '3D view'}>
  {#if !webgl}<p class="nowebgl">3D needs WebGL, which this browser has turned off. The steps and parts lists still work.</p>{/if}
</div>

<style>
  .view { position: relative; width: 100%; height: 100%; overflow: hidden; touch-action: none; background: #d9e4ec; }
  .view :global(canvas) { display: block; width: 100%; height: 100%; }
  .nowebgl { position: absolute; inset: 0; margin: 0; display: grid; place-items: center; padding: 24px; text-align: center; font-size: 13px; }
</style>
