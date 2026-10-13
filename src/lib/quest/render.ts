// three.js for "Let them explore": the planner's own scene builders (ground, house, and the catio drawn
// from its generated parts) plus stylised low-poly cats that walk, jump, sit, loaf, sleep and scratch
// along the simulated tracks, a passing bird, and rain. Loaded only on #/quest.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Catalog } from '../catalog/catalog';
import type { Project } from '../model/types';
import type { Assembly } from '../generate/assembly';
import { buildGround, buildHouse, buildStructure, disposeGroup } from '../scene/build';
import { rad } from '../model/geometry';
import { mainStructure } from './design';
import { catAt, type SimResult } from './sim';
import { makeCat, mat, pose } from './catrig';

export interface QuestScene {
  setTime(t: number): void;
  render(): void;
  resize(w: number, h: number): void;
  /** Screen position (CSS px within the canvas) above each visible cat. */
  catScreen(): Record<string, { x: number; y: number; visible: boolean }>;
  dispose(): void;
  controls: OrbitControls;
  canvas: HTMLCanvasElement;
}

export function createQuestScene(host: HTMLElement, p: Project, a: Assembly, sim: SimResult, cat: Catalog, reduceMotion: boolean): QuestScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const sky = new THREE.Color('#d9e4ec');
  scene.background = sky;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !reduceMotion;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.minDistance = 0.8;
  controls.maxDistance = 30;

  const hemi = new THREE.HemisphereLight('#ffffff', '#8c8a6e', 1.1);
  const sun = new THREE.DirectionalLight('#fff3e2', 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  scene.add(hemi, sun, sun.target);

  const world = new THREE.Group();
  world.add(buildGround(120, p.site.ground), buildHouse(p));
  const s = mainStructure(p)!;
  for (const st of p.structures) world.add(buildStructure(st, a.parts.filter((x) => x.structureId === st.id), cat));
  scene.add(world);

  // Cats live in the structure's local frame, like the navigation graph.
  const frame = new THREE.Group();
  frame.position.set(s.x, s.elevation ?? 0, s.y);
  frame.rotation.y = -rad(s.rotation);
  scene.add(frame);
  const rigs = sim.cats.map((c) => {
    const rig = makeCat(c.id, c.coat, p.cats.find((x) => x.id === c.id)?.ageClass === 'kitten');
    rig.root.add(rig.anchor);
    rig.anchor.position.set(0, 0.42, 0);
    frame.add(rig.root);
    return rig;
  });

  // Centre and frame the catio.
  const cu = s.width / 2, cv = s.depth / 2;
  const centre = new THREE.Vector3().copy(frame.localToWorld(new THREE.Vector3(cu, Math.min(s.height, 1.5) / 2, cv)));
  const size = Math.max(s.width, s.depth, s.height, 1.2);
  const front = frame.localToWorld(new THREE.Vector3(cu + size * 0.9, size * 1.0 + 0.6, cv + size * 1.7));
  controls.target.copy(centre);
  camera.position.copy(front);
  controls.update();
  sun.position.set(centre.x - 6, 10, centre.z + 5);
  sun.target.position.copy(centre);
  const sc = sun.shadow.camera;
  sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sc.near = 0.5; sc.far = 40;
  sc.updateProjectionMatrix();

  // Rain and a bird.
  const N = 600;
  const rainGeo = new THREE.BufferGeometry();
  const pts = new Float32Array(N * 3);
  const rr = Math.random;
  for (let i = 0; i < N; i++) { pts[i * 3] = centre.x + (rr() - 0.5) * 10; pts[i * 3 + 1] = rr() * 6; pts[i * 3 + 2] = centre.z + (rr() - 0.5) * 10; }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: '#9fb6c8', size: 0.04, transparent: true, opacity: 0.8 }));
  rain.visible = false;
  scene.add(rain);
  const bird = new THREE.Group();
  const wing = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.25, 3), mat('#3a3a3a'));
  wing.rotation.z = Math.PI / 2;
  const wing2 = wing.clone(); wing2.rotation.z = -Math.PI / 2;
  wing.position.x = -0.1; wing2.position.x = 0.1;
  bird.add(wing, wing2);
  bird.visible = false;
  scene.add(bird);

  let time = 0;
  const spans = sim.weather;
  const during = (kind: string, t: number) => spans.find((w) => w.kind === kind && t >= w.t0 && t < w.t1);

  function setTime(t: number) {
    time = t;
    for (const rig of rigs) {
      const segs = sim.tracks[rig.id] ?? [];
      if (!segs.length || t < segs[0].t0) { rig.root.visible = false; continue; }
      const at = catAt(segs, t);
      rig.root.position.set(at.pos[0], at.pos[1], at.pos[2]);
      if (at.seg && (at.pose === 'walk' || at.pose === 'jump')) {
        const dx = at.seg.to[0] - at.seg.from[0], dz = at.seg.to[2] - at.seg.from[2];
        if (Math.hypot(dx, dz) > 1e-3) rig.heading = Math.atan2(dx, dz);
      } else {
        // Settled: face into the catio, so heads don't poke through the mesh.
        const dx = cu - at.pos[0], dz = cv - at.pos[2];
        if (Math.hypot(dx, dz) > 0.05) rig.heading = Math.atan2(dx, dz);
      }
      rig.root.rotation.y = rig.heading;
      pose(rig, at.pose, reduceMotion ? 0 : t * 0.9 + rigs.indexOf(rig), at.k);
    }
    const raining = during('rain', t);
    rain.visible = !!raining && !reduceMotion;
    if (rain.visible) {
      const arr = rainGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < N; i++) { let y = arr.getY(i) - 0.35; if (y < 0) y += 6; arr.setY(i, y); }
      arr.needsUpdate = true;
    }
    const hot = during('sun', t);
    sun.intensity = raining ? 0.9 : hot ? 3.2 : 2.4;
    hemi.intensity = raining ? 0.8 : 1.1;
    scene.background = raining ? new THREE.Color('#b9c3cb') : sky;
    const b = during('bird', t);
    bird.visible = !!b;
    if (b) {
      const k = (t - b.t0) / (b.t1 - b.t0);
      const p0 = frame.localToWorld(new THREE.Vector3(-2 + k * (s.width + 4), (s.elevation ?? 0) + Math.max(1.6, s.height) + 0.6 + Math.sin(k * 12) * 0.15, s.depth + 1.6));
      bird.position.copy(p0);
      wing.rotation.x = wing2.rotation.x = Math.sin(t * 6) * 0.6;
    }
  }

  const v = new THREE.Vector3();
  return {
    controls,
    canvas: renderer.domElement,
    setTime,
    render() { controls.update(); renderer.render(scene, camera); },
    resize(w: number, h: number) { renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); },
    catScreen() {
      const out: Record<string, { x: number; y: number; visible: boolean }> = {};
      const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
      for (const rig of rigs) {
        rig.anchor.getWorldPosition(v);
        v.project(camera);
        out[rig.id] = { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible: rig.root.visible && v.z < 1 };
      }
      return out;
    },
    dispose() {
      controls.dispose();
      disposeGroup(world);
      disposeGroup(frame);
      rainGeo.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      void time;
    }
  };
}
