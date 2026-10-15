// three.js for Catio Prowl: the catio and house walls from the planner (drawn from the generated parts),
// the game's scenery around them (sky, yard, the outside of the house, the furnished room — see
// scenery.ts), the player's cat (catmodel.ts), toy mice, the things that can be knocked off, a visiting
// bird and the leap marker. A third-person camera follows the cat; the room's walls between the camera and
// the cat fade out, everything else in the way is cut away around the cat, a silhouette shows where it is
// still hidden, and the ceiling lifts off when the camera rises above it. Loaded only on #/prowl.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Catalog } from '../catalog/catalog';
import type { Project, Vec3 } from '../model/types';
import type { Assembly } from '../generate/assembly';
import { buildHouse, buildStructure, disposeGroup } from '../scene/build';
import { mat } from '../quest/catrig';
import type { Prowl } from './game';
import { STEP, groundAt, inFurnitureAt, inRect, inVolumes, topAt } from './physics';
import type { Rect, WallSpec, World } from './world';
import { type CatBusy, makeCatModel } from './catmodel';
import { ROOF_LAYER, buildHouseShell, buildInterior, buildSky, buildTunnelFloors, buildYard, houseWall, mergeStatics, sunDirection } from './scenery';
import type { Flap } from './tunnel';
import { blob } from './textures';

export interface CameraInput { orbit: [number, number]; zoom: number; recenter?: boolean }
export interface ProwlScene {
  frame(dt: number, game: Prowl, cam: CameraInput, moving: boolean): void;
  /** Direction the camera looks along (radians, as the cat's heading). */
  readonly yaw: number;
  resize(w: number, h: number): void;
  screenOf(p: Vec3): { x: number; y: number; visible: boolean };
  dispose(): void;
  canvas: HTMLCanvasElement;
}

const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });

/** Layer of the cat's main pieces, drawn a second time as a silhouette where something hides them. */
const SILHOUETTE_LAYER = 5;

/** Where the cut-away is: the camera, the cat's chest, the cat's paws and how much to cut (0–1). */
interface Cutaway { cam: { value: THREE.Vector3 }; cat: { value: THREE.Vector3 }; feet: { value: number }; on: { value: number } }

/** Cut a see-through window, a dithered cone from the camera to the cat, through every material under
 *  `root` (merged scenery included: no extra draw calls, shadows unchanged). Fragments within 0.3 m of the
 *  cat and at or below its paws are kept, so it never loses the ground it stands on or the ledge by it. */
function cutaway(root: THREE.Object3D, u: Cutaway) {
  const done = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) {
      if (done.has(x) || (x as THREE.ShaderMaterial).isShaderMaterial) continue;
      done.add(x);
      const prev = x.onBeforeCompile;
      x.onBeforeCompile = (shader, renderer) => {
        prev.call(x, shader, renderer);
        if (!shader.vertexShader.includes('#include <project_vertex>') || !shader.fragmentShader.includes('void main() {')) return;
        Object.assign(shader.uniforms, { uCutCam: u.cam, uCutCat: u.cat, uCutFeet: u.feet, uCutOn: u.on });
        shader.vertexShader = 'varying vec3 vCutWorld;\n' + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  #ifdef USE_INSTANCING
    vCutWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif`);
        shader.fragmentShader = `varying vec3 vCutWorld;
uniform vec3 uCutCam, uCutCat;
uniform float uCutFeet, uCutOn;
void cutAway() {
  if (uCutOn < 0.01 || vCutWorld.y < uCutFeet + 0.03) return;
  vec3 ab = uCutCat - uCutCam;
  float L = length(ab);
  if (L < 0.5) return;
  vec3 dir = ab / L;
  float t = dot(vCutWorld - uCutCam, dir);
  if (t < 0.02 || t > L - 0.3) return;
  // A cone that is a constant size on screen: 0.34 m wide at the cat.
  float r = 0.34 * t / L;
  float d = length(vCutWorld - uCutCam - dir * t);
  float k = (1.0 - smoothstep(r * 0.55, r, d)) * smoothstep(L - 0.3, L - 0.55, t) * uCutOn;
  float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  if (n < k * 0.93) discard;
}
` + shader.fragmentShader.replace('void main() {', 'void main() {\n  cutAway();');
      };
      x.needsUpdate = true;
    }
  });
}

function flatAt(r: Rect, y: number, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * r.h[0], 2 * r.h[1]), material);
  m.rotation.order = 'YXZ';
  m.rotation.set(-Math.PI / 2, -r.yaw, 0);
  m.position.set(r.c[0], y, r.c[1]);
  m.receiveShadow = true;
  return m;
}

function makeItem(shape: string, color: string, size: Vec3): THREE.Object3D {
  const g = new THREE.Group();
  const [sx, sy, sz] = size;
  let m: THREE.Mesh;
  if (shape === 'mug' || shape === 'pot') {
    m = new THREE.Mesh(new THREE.CylinderGeometry(sx / 2, sx / 2 * 0.92, sy, 14), std(color, { roughness: 0.5 }));
    if (shape === 'mug') {
      const handle = new THREE.Mesh(new THREE.TorusGeometry(sy * 0.28, 0.008, 6, 12), std(color));
      handle.position.set(sx / 2 + 0.01, sy / 2, 0);
      g.add(handle);
    }
  } else if (shape === 'glass') {
    m = new THREE.Mesh(new THREE.CylinderGeometry(sx / 2, sx / 2 * 0.85, sy, 14), std(color, { transparent: true, opacity: 0.55, roughness: 0.1 }));
  } else if (shape === 'vase') {
    m = new THREE.Mesh(new THREE.LatheGeometry([0.01, 0.045, 0.05, 0.035, 0.022, 0.03].map((r, i) => new THREE.Vector2(r * (sx / 0.09), (i / 5) * sy)), 14), std(color, { roughness: 0.4, side: THREE.DoubleSide }));
    m.position.y = -sy / 2;
  } else {
    m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), std(color));
  }
  if (shape !== 'vase') m.position.y = sy / 2;
  else m.position.y = 0;
  m.castShadow = true;
  g.add(m);
  return g;
}

function makeMouse(): THREE.Group {
  const g = new THREE.Group();
  const fur = std('#8d8d93', { flatShading: true });
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.035, 1), fur);
  body.scale.set(0.8, 0.7, 1.4);
  body.position.y = 0.03;
  const ear = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), std('#e4a3b3'));
  ear.position.set(0.015, 0.055, 0.03);
  const ear2 = ear.clone(); ear2.position.x = -0.015;
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.08, 4), std('#e4a3b3'));
  tail.rotation.x = Math.PI / 2.4;
  tail.position.set(0, 0.025, -0.07);
  for (const m of [body, ear, ear2, tail]) m.castShadow = true;
  g.add(body, ear, ear2, tail);
  return g;
}

function makeBird(): { g: THREE.Group; wings: THREE.Mesh[] } {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 1), mat('#6d5a4a'));
  body.scale.set(0.9, 0.9, 1.3);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.04, 1), mat('#6d5a4a'));
  head.position.set(0, 0.06, 0.06);
  const breast = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 1), mat('#d9783a'));
  breast.position.set(0, 0.01, 0.05);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.03, 4), mat('#e8a93a'));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.06, 0.11);
  const wingGeo = new THREE.BoxGeometry(0.11, 0.01, 0.07);
  const w1 = new THREE.Mesh(wingGeo, mat('#5a4a3c')), w2 = new THREE.Mesh(wingGeo, mat('#5a4a3c'));
  w1.geometry.translate(0.055, 0, 0);
  w1.position.set(0.03, 0.03, 0); w2.position.set(-0.03, 0.03, 0); w2.scale.x = -1;
  g.add(body, head, breast, beak, w1, w2);
  return { g, wings: [w1, w2] };
}

/** A cat flap in its frame, hinged at the top: it swings away from a cat pushing through and settles back. */
function makeFlap(f: Flap) {
  const group = new THREE.Group();
  group.position.set(...f.c);
  group.rotation.y = -Math.atan2(f.along[1], f.along[0]);
  const frame = std('#3b3b3b', { roughness: 0.6 });
  const t = 0.03;
  for (const [w, h, x, y] of [[f.w + 2 * t, t, 0, f.h + t / 2], [f.w + 2 * t, t, 0, -t / 2], [t, f.h, -f.w / 2 - t / 2, f.h / 2], [t, f.h, f.w / 2 + t / 2, f.h / 2]] as const) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), frame);
    m.position.set(x, y, 0);
    m.castShadow = true;
    group.add(m);
  }
  const hinge = new THREE.Group();
  hinge.position.y = f.h;
  const pane = new THREE.Mesh(new THREE.BoxGeometry(f.w - 0.01, f.h - 0.01, 0.006), std('#5a6670', { transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0.1 }));
  pane.position.y = -f.h / 2;
  hinge.add(pane);
  group.add(hinge);
  const along = new THREE.Vector2(f.along[0], f.along[1]), normal = new THREE.Vector2(-f.along[1], f.along[0]);
  // Which way the flap's +z faces in the plan (the side it swings away from when turned by +angle).
  group.updateMatrixWorld();
  const z = new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion);
  if (z.x * normal.x + z.z * normal.y < 0) normal.multiplyScalar(-1);
  let angle = 0, vel = 0, side = 0;
  return {
    group,
    update(dt: number, cat: Vec3) {
      const dx = cat[0] - f.c[0], dz = cat[2] - f.c[2];
      const sd = dx * normal.x + dz * normal.y, lat = dx * along.x + dz * along.y;
      const near = Math.abs(lat) < f.w / 2 + 0.08 && Math.abs(sd) < 0.32 && cat[1] < f.c[1] + f.h;
      if (!near) side = 0;
      else if (!side) side = sd > 0 ? 1 : -1;
      const goal = near ? side * 1.2 * Math.min(1, (0.32 - Math.abs(sd)) / 0.14 + (Math.sign(sd) !== side ? 1 : 0)) : 0;
      if (dt >= 1) angle = goal; // reduced motion: no swinging
      else {
        vel += ((goal - angle) * 90 - vel * 9) * dt;
        angle = Math.max(-1.4, Math.min(1.4, angle + vel * dt));
      }
      hinge.rotation.x = angle;
    }
  };
}

export function createProwlScene(host: HTMLElement, p: Project, a: Assembly, world: World, cat: Catalog, opts: { coat: string; reduceMotion: boolean }): ProwlScene {
  // Phones and small tablets: fewer pixels and a smaller shadow map.
  const small = typeof matchMedia !== 'undefined' && (matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700);
  const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.03, 400);
  if (typeof location !== 'undefined' && location.search.includes('prowl-debug')) (window as unknown as { __prowlScene: unknown }).__prowlScene = { scene, camera, THREE };
  // Soft image-based light for every material (cheap: rendered once).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.32;
  pmrem.dispose();

  const hostSpec = world.walls.find((w) => w.host);
  const sunDir = sunDirection(world, hostSpec);
  const sky = buildSky(sunDir);
  scene.add(sky.group);
  scene.fog = new THREE.Fog(sky.horizon.clone(), 30, 170);

  const hemi = new THREE.HemisphereLight('#dfeaf7', '#8d8a6c', 0.85);
  const sun = new THREE.DirectionalLight('#fff0d6', 2.5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = small ? 2 : 3;
  sun.shadow.camera.layers.enable(ROOF_LAYER);
  scene.add(hemi, sun, sun.target);
  camera.layers.enable(ROOF_LAYER);

  const statics = new THREE.Group();
  scene.add(statics);
  // Everything that never moves is merged by look (see mergeStatics) to keep draw calls down on phones.
  const outdoor = new THREE.Group();
  outdoor.add(buildYard(p, world));
  const site = world.home ? { ...p, site: { ...p.site, walls: p.site.walls.filter((w) => w.id !== world.hostWallId) } } : p;
  outdoor.add(buildHouse(site));
  outdoor.add(buildHouseShell(p, world));
  // The planner's parts, less those the game replaces (window inserts it opens, cat-flap kits it swings, tunnel
  // pieces inside a window chute), plus the chute.
  const hidden = new Set(world.hiddenParts);
  for (const st of p.structures) {
    const parts = a.parts.filter((x) => x.structureId === st.id && !hidden.has(x.id) && !(st.id === world.catio.structureId && x.role === 'window-insert' && world.home));
    outdoor.add(buildStructure(st, [...parts, ...world.extraParts.filter((x) => x.structureId === st.id)], cat));
  }
  outdoor.add(buildTunnelFloors(world));
  statics.add(mergeStatics(outdoor));

  // The room: walls (which fade, with what hangs on them), then floor, ceiling, furniture and decor.
  const fades: { spec: WallSpec; materials: THREE.Material[]; o: number }[] = [];
  const interior = world.room ? buildInterior(world, hostSpec) : null;
  for (const w of world.walls) {
    const { group, materials } = houseWall(w);
    const mats: THREE.Material[] = [...materials];
    for (const d of interior?.wallDecor ?? []) {
      if (d.wallId !== w.id) continue;
      statics.add(d.object);
      d.object.traverse((o) => { const m = (o as THREE.Mesh).material; if (m) for (const x of Array.isArray(m) ? m : [m]) if (!mats.includes(x)) mats.push(x); });
    }
    statics.add(mergeStatics(group));
    fades.push({ spec: w, materials: mats, o: 1 });
  }
  if (interior) statics.add(mergeStatics(interior.group));
  // Sunny patches of the catio floor (the room's sunbeam is real light through the window).
  const beamMat = new THREE.MeshBasicMaterial({ color: '#fff0b8', transparent: true, opacity: 0.16, depthWrite: false });
  for (const b of world.sunbeams) {
    if (world.room && b === world.spots.find((s) => s.id === 'nap:sunbeam')?.area) continue;
    const under = world.surfaces.filter((s) => s.kind === 'floor').find((s) => Math.hypot(s.c[0] - b.c[0], s.c[1] - b.c[1]) < Math.max(s.h[0], s.h[1]) + 0.5);
    statics.add(flatAt(b, (under?.top ?? 0) + 0.006, beamMat));
  }
  // A fence post for the visiting bird, just outside the catio.
  const bp = world.catio.birdPerch;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, bp[1], 10), std('#7a5c43'));
  post.position.set(bp[0], bp[1] / 2, bp[2]);
  post.castShadow = true;
  statics.add(post);
  // Whatever stands between the camera and the cat (a wall, the catio's framing and roof, a tunnel's mesh,
  // furniture) is cut away around it.
  const cut: Cutaway = { cam: { value: new THREE.Vector3() }, cat: { value: new THREE.Vector3() }, feet: { value: 0 }, on: { value: 1 } };
  cutaway(statics, cut);

  // Light: the sun shines in through the open window onto the room's sunbeam, over the middle of the play area.
  const mid = new THREE.Vector3(...world.catio.centre);
  if (world.room) mid.lerp(new THREE.Vector3(world.room.c[0], 0, world.room.c[1]), 0.5);
  sun.position.copy(mid).addScaledVector(sunDir, 22);
  sun.target.position.copy(mid);
  const sc = sun.shadow.camera;
  sc.left = -10; sc.right = 10; sc.top = 10; sc.bottom = -10; sc.near = 1; sc.far = 50;
  sc.updateProjectionMatrix();

  // Moving things.
  const dynamic = new THREE.Group();
  scene.add(dynamic);
  const kitty = makeCatModel(opts.coat);
  dynamic.add(kitty.root);
  // Where the cat is still hidden (behind a post, a box, the catio's roof), a soft silhouette shows through:
  // the cat marks its visible pixels in the stencil buffer, and its main pieces are drawn again only where
  // they are behind something and not already showing.
  const silhouette = new THREE.MeshBasicMaterial({
    color: '#ffcf86', transparent: true, opacity: 0.42, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp
  });
  kitty.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) Object.assign(x, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
    // Only the big pieces (torso, head, legs, tail): a few extra draw calls.
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    if (m.castShadow && m.geometry.boundingSphere!.radius >= 0.045) m.layers.enable(SILHOUETTE_LAYER);
  });
  const shadowBlob = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5), new THREE.MeshBasicMaterial({ map: blob(), transparent: true, depthWrite: false, opacity: 0.55 }));
  shadowBlob.rotation.order = 'YXZ';
  shadowBlob.renderOrder = 3;
  dynamic.add(shadowBlob);
  const itemMeshes = new Map(world.items.map((it) => { const m = makeItem(it.shape, it.color, it.size); dynamic.add(m); return [it.id, m]; }));
  const toyMeshes = new Map(world.toys.map((t) => { const m = makeMouse(); m.position.set(...t.p); m.rotation.y = (t.id.length * 1.7) % 6.28; dynamic.add(m); return [t.id, m]; }));
  const flaps = world.flaps.map((f) => { const m = makeFlap(f); dynamic.add(m.group); return m; });
  const bird = makeBird();
  dynamic.add(bird.g);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.13, 28), new THREE.MeshBasicMaterial({ color: '#e8a93a', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  marker.rotation.x = -Math.PI / 2;
  marker.renderOrder = 5;
  dynamic.add(marker);

  // Camera rig.
  let yaw = world.start.heading, pitch = 0.36, dist = 1.45;
  let lastOrbit = -10;
  let time = 0;
  const target = new THREE.Vector3(world.start.p[0], world.start.p[1] + 0.25, world.start.p[2]);
  const tmp = new THREE.Vector3();

  // Close in, the camera stays in the open air of the room or catio (pulled in before a wall or roof; it
  // looks past furniture, which is cut away, but never sits inside it); zoomed far out it floats free,
  // dollhouse style, and whatever is between it and the cat is cut away.
  const FREE = 2.6;
  const want = new THREE.Vector3();
  const reach = (p: number, wide: boolean) => {
    const dx = -Math.sin(yaw) * Math.cos(p), dy = Math.sin(p), dz = -Math.cos(yaw) * Math.cos(p);
    let d = 0.3;
    for (let s = 0.3; s <= dist + 1e-6; s += 0.05) {
      const x = target.x + dx * s, y = target.y + dy * s, z = target.z + dz * s;
      if (!inVolumes(world, x, y, z, 0.06, wide)) break;
      if (!inFurnitureAt(world, x, y, z, 0.08)) d = s;
    }
    return { d, dx, dy, dz };
  };
  function placeCamera(dt = 1) {
    let r = { d: dist, dx: -Math.sin(yaw) * Math.cos(pitch), dy: Math.sin(pitch), dz: -Math.cos(yaw) * Math.cos(pitch) };
    if (dist <= FREE) {
      // Stay inside if there is room (lower the angle, even look up from below a high perch); only then
      // step outside a catio's mesh to look in.
      const enough = Math.min(dist, 0.95);
      let best = reach(pitch, false);
      for (const p of [pitch * 0.5, 0.05, -0.3]) {
        if (best.d >= enough) break;
        const c = reach(p, false);
        if (c.d > best.d + 0.1) best = c;
      }
      if (best.d < enough) { const out = reach(pitch, true); if (out.d > best.d + 0.2) best = out; }
      r = best;
    }
    want.set(target.x + r.dx * r.d, target.y + r.dy * r.d, target.z + r.dz * r.d);
    // Ease out, but pull in fast: a camera lagging behind a wall or a roof sees the back of it.
    const closer = want.distanceTo(target) < camera.position.distanceTo(target) - 0.05;
    camera.position.lerp(want, opts.reduceMotion ? 1 : Math.min(1, dt * (closer ? 30 : 10)));
    camera.lookAt(target);
  }
  placeCamera();
  if (typeof location !== 'undefined' && location.search.includes('prowl-debug')) {
    (window as unknown as { __prowlCam: unknown }).__prowlCam = { set(y: number, p: number, d: number) { yaw = y; pitch = p; dist = d; lastOrbit = time + 1e6; }, get: () => ({ yaw, pitch, dist, pos: camera.position.toArray() }) };
  }

  function fadeWalls(dt: number, catPos: THREE.Vector3) {
    const cam = camera.position;
    for (const f of fades) {
      const { a, dir, normal, length, height } = f.spec;
      const cs = (cam.x - a[0]) * normal[0] + (cam.z - a[1]) * normal[1];
      const ks = (catPos.x - a[0]) * normal[0] + (catPos.z - a[1]) * normal[1];
      let block = false;
      if ((cs > 0) !== (ks > 0)) {
        const t = cs / (cs - ks);
        const ix = cam.x + (catPos.x - cam.x) * t, iz = cam.z + (catPos.z - cam.z) * t, iy = cam.y + (catPos.y - cam.y) * t;
        const along = (ix - a[0]) * dir[0] + (iz - a[1]) * dir[1];
        block = along > -0.3 && along < length + 0.3 && iy < height + 0.05;
      }
      const goal = block ? 0.12 : 1;
      f.o += (goal - f.o) * Math.min(1, dt * (opts.reduceMotion ? 60 : 8));
      for (const m of f.materials) {
        const fadeNow = f.o < 0.99;
        if (m.transparent !== fadeNow) { m.transparent = fadeNow; m.depthWrite = !fadeNow; m.needsUpdate = true; }
        m.opacity = f.o;
      }
    }
  }

  return {
    canvas: renderer.domElement,
    get yaw() { return yaw; },
    frame(dt, game, input, moving) {
      time += dt;
      const c = game.cat;
      // Cat.
      kitty.root.position.set(c.p[0], c.p[1], c.p[2]);
      kitty.root.rotation.y = c.heading;
      const sh = Math.sin(c.heading), ch = Math.cos(c.heading);
      const toLocal = (q: Vec3): [number, number, number] => { const dx = q[0] - c.p[0], dz = q[2] - c.p[2]; return [dx * ch - dz * sh, q[1] - c.p[1], dx * sh + dz * ch]; };
      const birdNear = game.bird.here && Math.hypot(bp[0] - c.p[0], bp[2] - c.p[2]) < 6;
      const look = game.target ? toLocal(game.target.p) : birdNear ? toLocal([bp[0], bp[1] + 0.06, bp[2]]) : null;
      let frontDy = 0, backDy = 0;
      if (c.ground && !c.leap) {
        // Paws follow the ground under them, but only up onto what they are really on: a ramp or a step
        // well under the paws, not the edge of a box the cat has its nose against.
        const paws = (k: number) => {
          const x = c.p[0] + sh * k, z = c.p[2] + ch * k;
          const g = groundAt(world, x, z, c.p[1] + STEP);
          if (!g.surface) return 0;
          const up = g.y > c.p[1] + 0.005 && g.surface.id !== c.surfaceId;
          if (up && g.surface.kind !== 'ramp' && !inRect(g.surface, x, z, 0.05)) return 0;
          return Math.max(-0.06, Math.min(0.1, g.y - c.p[1]));
        };
        // On a ramp both paws stand on the ramp itself, however steep: the body tilts with it rather than
        // staying level with the board through its middle.
        const on = world.surfaces.find((s) => s.id === c.surfaceId);
        const onRamp = (k: number) => topAt(on!, c.p[0] + sh * k, c.p[2] + ch * k) - c.p[1];
        frontDy = on?.low !== undefined ? onRamp(0.12) : paws(0.12);
        backDy = on?.low !== undefined ? onRamp(-0.12) : paws(-0.12);
      }
      const busy = game.busy ? (game.busy.kind as CatBusy) : null;
      kitty.update(opts.reduceMotion ? Math.min(dt, 0.02) : dt, {
        speed: Math.hypot(c.v[0], c.v[1]), sneak: game.sneak, ground: c.ground, leap: c.leap ? { k: Math.min(1, c.leap.t / c.leap.T), up: c.leap.up } : null,
        busy, busyK: game.busy ? game.busy.t / game.busy.T : 0, idle: game.idle, look, frontDy, backDy, meowAgo: game.time - game.meowAt
      });
      const under = c.ground ? c.p[1] : groundAt(world, c.p[0], c.p[2], c.p[1]).y;
      shadowBlob.visible = Number.isFinite(under);
      if (shadowBlob.visible) {
        shadowBlob.position.set(c.p[0], under + 0.004, c.p[2]);
        shadowBlob.rotation.set(-Math.PI / 2, c.heading, 0);
        (shadowBlob.material as THREE.MeshBasicMaterial).opacity = 0.5 * Math.max(0, 1 - (c.p[1] - under) / 1.2);
      }
      // Items.
      for (const it of game.items) {
        const m = itemMeshes.get(it.item.id)!;
        m.position.set(it.p[0], it.p[1], it.p[2]);
        m.rotation.set(it.state === 'rest' ? 0 : it.angle, 0, it.state === 'down' ? Math.PI / 2 : 0);
        if (it.state === 'down') m.position.y += it.item.size[0] / 2;
      }
      // Toys.
      for (const [id, m] of toyMeshes) {
        m.visible = !game.progress.toys.includes(id);
        if (m.visible && !opts.reduceMotion) m.rotation.y += dt * 0.6;
      }
      for (const f of flaps) f.update(opts.reduceMotion ? 1 : dt, c.p);
      // Bird.
      const b = game.bird;
      bird.g.visible = b.here || b.leaving > 0;
      if (bird.g.visible) {
        const k = b.here ? 0 : 1 - b.leaving;
        bird.g.position.set(bp[0] + k * 2.5, bp[1] + 0.06 + k * 2.2 + (b.here && !opts.reduceMotion ? Math.abs(Math.sin(time * 3)) * 0.02 : 0), bp[2] + k * 1.5);
        bird.g.lookAt(c.p[0], bird.g.position.y, c.p[2]);
        const flap = b.here ? Math.sin(time * 2) * 0.1 : Math.sin(time * 30) * 0.9;
        bird.wings[0].rotation.z = flap; bird.wings[1].rotation.z = -flap;
      }
      // Leap marker.
      marker.visible = !!game.target;
      if (game.target) {
        marker.position.set(game.target.p[0], game.target.p[1] + 0.012, game.target.p[2]);
        const s = opts.reduceMotion ? 1 : 1 + Math.sin(time * 6) * 0.12;
        marker.scale.set(s, s, s);
      }
      // Camera: orbit by input; drift behind the cat while it walks and nobody is steering.
      if (input.orbit[0] || input.orbit[1]) { yaw += input.orbit[0]; pitch = Math.max(0.05, Math.min(1.25, pitch + input.orbit[1])); lastOrbit = time; }
      if (input.zoom) dist = Math.max(0.8, Math.min(7, dist * Math.exp(input.zoom)));
      if (input.recenter) { yaw = c.heading; lastOrbit = -10; }
      // Watching the bird: look past the cat at it.
      if (game.busy?.kind === 'watch') { let d = c.heading - yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; yaw += d * Math.min(1, dt * 3); }
      if (moving && time - lastOrbit > 1.5 && !c.leap) {
        let d = c.heading - yaw;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        if (Math.abs(d) < 2.4) yaw += d * Math.min(1, dt * 1.2);
      }
      tmp.set(c.p[0], c.p[1] + 0.22, c.p[2]);
      target.lerp(tmp, opts.reduceMotion ? 1 : Math.min(1, dt * 9));
      placeCamera(dt);
      fadeWalls(dt, tmp);
      // Lift the ceiling and the roof over the room off when the camera rises above them (dollhouse view).
      if (world.room) {
        if (camera.position.y < world.room.height - 0.03) camera.layers.enable(ROOF_LAYER);
        else camera.layers.disable(ROOF_LAYER);
      }
      interior?.update(opts.reduceMotion ? 0 : time, camera.position);
      cut.cam.value.copy(camera.position);
      cut.cat.value.set(c.p[0], c.p[1] + 0.2, c.p[2]);
      cut.feet.value = Number.isFinite(under) ? Math.min(c.p[1], under) : c.p[1];
      renderer.render(scene, camera);
      // The silhouette pass: the cat's main pieces, where they are hidden.
      const mask = camera.layers.mask;
      renderer.autoClear = false;
      renderer.shadowMap.autoUpdate = false;
      camera.layers.set(SILHOUETTE_LAYER);
      scene.overrideMaterial = silhouette;
      renderer.render(scene, camera);
      scene.overrideMaterial = null;
      camera.layers.mask = mask;
      renderer.shadowMap.autoUpdate = true;
      renderer.autoClear = true;
    },
    resize(w, h) { renderer.setSize(w, h); camera.aspect = w / h; camera.fov = w < h ? 68 : 55; camera.updateProjectionMatrix(); },
    screenOf(p) {
      tmp.set(p[0], p[1], p[2]).project(camera);
      const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
      return { x: (tmp.x * 0.5 + 0.5) * w, y: (-tmp.y * 0.5 + 0.5) * h, visible: tmp.z < 1 };
    },
    dispose() {
      disposeGroup(statics);
      disposeGroup(dynamic);
      kitty.dispose();
      silhouette.dispose();
      envRT.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
  };
}
