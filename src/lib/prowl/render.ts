// three.js for Catio Prowl: the planner's ground, house and catio (drawn from the generated parts), the
// furnished room from the world description, the player's cat (the Catio Quest rig), toy mice, the things
// that can be knocked off, a visiting bird and the leap marker. A third-person camera follows the cat;
// walls between the camera and the cat fade out. Loaded only on #/prowl.
import * as THREE from 'three';
import type { Catalog } from '../catalog/catalog';
import type { Project, Vec3 } from '../model/types';
import type { Assembly } from '../generate/assembly';
import { buildGround, buildHouse, buildStructure, disposeGroup } from '../scene/build';
import { makeCat, mat, pose } from '../quest/catrig';
import type { Prowl } from './game';
import { openAir } from './physics';
import type { Rect, Surface, WallSpec, World } from './world';

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

function boxAt(r: Rect, y0: number, y1: number, material: THREE.Material, inset = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.01, 2 * r.h[0] - inset), Math.max(0.005, y1 - y0), Math.max(0.01, 2 * r.h[1] - inset)), material);
  m.position.set(r.c[0], (y0 + y1) / 2, r.c[1]);
  m.rotation.y = -r.yaw;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function flatAt(r: Rect, y: number, material: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * r.h[0], 2 * r.h[1]), material);
  m.rotation.order = 'YXZ';
  m.rotation.set(-Math.PI / 2, -r.yaw, 0);
  m.position.set(r.c[0], y, r.c[1]);
  m.receiveShadow = true;
  return m;
}

/** Furniture drawn from its walking surface, with a few touches by id. */
function furniture(s: Surface): THREE.Object3D {
  const g = new THREE.Group();
  const color = s.color ?? '#a08870';
  const legs = (h: number, inset = 0.05) => {
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    for (const [i, j] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = i * (s.h[0] - inset), lz = j * (s.h[1] - inset);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, h, 6), std('#6b4f3a'));
      leg.position.set(s.c[0] + lx * c - lz * sn, h / 2, s.c[1] + lx * sn + lz * c);
      leg.castShadow = true;
      g.add(leg);
    }
  };
  switch (s.id) {
    case 'sill': g.add(boxAt(s, s.top - 0.04, s.top, std(color))); break;
    case 'counter':
      g.add(boxAt(s, 0, s.top - 0.04, std('#b8a58c'), 0.04), boxAt(s, s.top - 0.04, s.top, std(color)));
      break;
    case 'fridge': {
      g.add(boxAt(s, 0, s.top, std(color, { roughness: 0.4 })));
      break;
    }
    case 'coffee': case 'side':
      g.add(boxAt(s, s.top - 0.04, s.top, std(color)));
      legs(s.top - 0.04);
      break;
    case 'grass': {
      g.add(boxAt(s, 0, s.top, std(color)));
      const blades = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 7, 1, true), std('#6aa84f', { side: THREE.DoubleSide, flatShading: true }));
      blades.position.set(s.c[0], s.top + 0.1, s.c[1]);
      g.add(blades);
      break;
    }
    case 'bed': {
      g.add(boxAt(s, 0, s.top, std(color)));
      g.add(boxAt(s, s.top - 0.01, s.top + 0.005, std('#efe3d3'), 0.12));
      break;
    }
    default:
      if (s.solid) g.add(boxAt(s, s.bottom, s.top, std(color)));
      else g.add(boxAt(s, s.top - 0.04, s.top, std(color)));
  }
  return g;
}

function wallMesh(w: WallSpec, color: string): { group: THREE.Group; materials: THREE.MeshStandardMaterial[] } {
  const group = new THREE.Group();
  const ang = Math.atan2(w.dir[1], w.dir[0]);
  group.position.set(w.a[0], 0, w.a[1]);
  group.rotation.y = -ang;
  // Local +z is the left of `dir`; put the body on the side away from `normal`.
  const left: [number, number] = [-w.dir[1], w.dir[0]];
  const toward = left[0] * w.normal[0] + left[1] * w.normal[1] > 0 ? -1 : 1;
  const zc = (toward * w.thickness) / 2;
  const material = std(color, { roughness: 0.95 });
  const piece = (a0: number, a1: number, y0: number, y1: number) => {
    if (a1 - a0 < 0.005 || y1 - y0 < 0.005) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(a1 - a0, y1 - y0, w.thickness), material);
    m.position.set((a0 + a1) / 2, (y0 + y1) / 2, zc);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };
  let at = 0;
  for (const h of [...w.holes].sort((x, y) => x.a0 - y.a0)) {
    piece(at, h.a0, 0, w.height);
    piece(h.a0, h.a1, 0, h.y0);
    piece(h.a0, h.a1, h.y1, w.height);
    // A white frame around the open window.
    const frame = std('#ffffff');
    for (const [a0, a1, y0, y1] of [[h.a0 - 0.05, h.a0, h.y0, h.y1], [h.a1, h.a1 + 0.05, h.y0, h.y1], [h.a0 - 0.05, h.a1 + 0.05, h.y1, h.y1 + 0.05]]) {
      for (const side of [-1, 1]) {
        const f = new THREE.Mesh(new THREE.BoxGeometry(a1 - a0, y1 - y0, 0.02), frame);
        f.position.set((a0 + a1) / 2, (y0 + y1) / 2, side < 0 ? 0.012 * -toward : toward * (w.thickness + 0.012));
        group.add(f);
      }
    }
    at = h.a1;
  }
  piece(at, w.length, 0, w.height);
  return { group, materials: [material] };
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

export function createProwlScene(host: HTMLElement, p: Project, a: Assembly, world: World, cat: Catalog, opts: { coat: string; reduceMotion: boolean }): ProwlScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#cfe0ec');
  scene.fog = new THREE.Fog('#cfe0ec', 18, 60);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.03, 200);

  const hemi = new THREE.HemisphereLight('#fffaf0', '#9a8f78', 1.5);
  const sun = new THREE.DirectionalLight('#fff1dc', 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  scene.add(hemi, sun, sun.target);

  const statics = new THREE.Group();
  scene.add(statics);
  statics.add(buildGround(160, p.site.ground));
  const site = world.home ? { ...p, site: { ...p.site, walls: p.site.walls.filter((w) => w.id !== world.hostWallId) } } : p;
  statics.add(buildHouse(site));
  for (const st of p.structures) {
    const parts = a.parts.filter((x) => x.structureId === st.id && !(st.id === world.catio.structureId && x.role === 'window-insert' && world.home));
    statics.add(buildStructure(st, parts, cat));
  }

  // The room: walls (which fade), floor, rug and furniture.
  const fades: { spec: WallSpec; materials: THREE.MeshStandardMaterial[]; o: number }[] = [];
  for (const w of world.walls) {
    const { group, materials } = wallMesh(w, w.host ? '#ece5d9' : '#f1ebe0');
    statics.add(group);
    fades.push({ spec: w, materials, o: 1 });
  }
  if (world.room) {
    statics.add(flatAt(world.room, 0.002, std('#c79f72', { roughness: 0.7 })));
    const coffee = world.surfaces.find((s) => s.id === 'coffee');
    if (coffee) statics.add(flatAt({ c: coffee.c, h: [coffee.h[0] + 0.55, coffee.h[1] + 0.45], yaw: coffee.yaw }, 0.004, std('#9c4f4f', { roughness: 1 })));
  }
  for (const s of world.surfaces) if (s.region === 'home' && s.color) statics.add(furniture(s));
  for (const s of world.spots) {
    if (s.region !== 'home' || (s.kind !== 'drink' && s.kind !== 'eat')) continue;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.05, 16), std(s.kind === 'drink' ? '#4a8fc2' : '#c9a27e', { roughness: 0.4 }));
    bowl.position.set(s.p[0], 0.025, s.p[2]);
    bowl.castShadow = true;
    statics.add(bowl);
  }
  const beamMat = new THREE.MeshBasicMaterial({ color: '#fff0b8', transparent: true, opacity: 0.32, depthWrite: false });
  for (const b of world.sunbeams) {
    const under = world.surfaces.filter((s) => s.kind === 'floor').find((s) => Math.hypot(s.c[0] - b.c[0], s.c[1] - b.c[1]) < Math.max(s.h[0], s.h[1]) + 0.5);
    statics.add(flatAt(b, (under?.top ?? 0) + 0.006, beamMat));
  }
  // A fence post for the visiting bird, just outside the catio.
  const bp = world.catio.birdPerch;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, bp[1], 8), std('#7a5c43'));
  post.position.set(bp[0], bp[1] / 2, bp[2]);
  post.castShadow = true;
  statics.add(post);

  // Light: the sun over the middle of the play area.
  const mid = new THREE.Vector3(...world.catio.centre);
  if (world.room) mid.lerp(new THREE.Vector3(world.room.c[0], 0, world.room.c[1]), 0.5);
  sun.position.set(mid.x - 5, 11, mid.z + 7);
  sun.target.position.copy(mid);
  const sc = sun.shadow.camera;
  sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 0.5; sc.far = 40;
  sc.updateProjectionMatrix();

  // Moving things.
  const dynamic = new THREE.Group();
  scene.add(dynamic);
  const rig = makeCat('player', opts.coat, false);
  dynamic.add(rig.root);
  const itemMeshes = new Map(world.items.map((it) => { const m = makeItem(it.shape, it.color, it.size); dynamic.add(m); return [it.id, m]; }));
  const toyMeshes = new Map(world.toys.map((t) => { const m = makeMouse(); m.position.set(...t.p); m.rotation.y = (t.id.length * 1.7) % 6.28; dynamic.add(m); return [t.id, m]; }));
  const bird = makeBird();
  dynamic.add(bird.g);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.13, 28), new THREE.MeshBasicMaterial({ color: '#e8a93a', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  marker.rotation.x = -Math.PI / 2;
  marker.renderOrder = 5;
  dynamic.add(marker);

  // Camera rig.
  let yaw = world.start.heading, pitch = 0.55, dist = 1.7;
  let lastOrbit = -10;
  let time = 0;
  const target = new THREE.Vector3(world.start.p[0], world.start.p[1] + 0.25, world.start.p[2]);
  const tmp = new THREE.Vector3();

  // Close in, the camera stays in the open air of the room or catio (pulled in before a wall, roof or
  // furniture); zoomed far out it floats free, dollhouse style, and walls in the way fade.
  const FREE = 2.6;
  const want = new THREE.Vector3();
  const reach = (p: number, wide: boolean) => {
    const dx = -Math.sin(yaw) * Math.cos(p), dy = Math.sin(p), dz = -Math.cos(yaw) * Math.cos(p);
    let d = 0.3;
    for (let s = 0.3; s <= dist + 1e-6; s += 0.05) {
      if (!openAir(world, target.x + dx * s, target.y + dy * s, target.z + dz * s, 0.04, wide)) break;
      d = s;
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
    camera.position.lerp(want, opts.reduceMotion ? 1 : Math.min(1, dt * 10));
    camera.lookAt(target);
  }
  placeCamera();

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
      rig.root.position.set(c.p[0], c.p[1], c.p[2]);
      rig.root.rotation.y = c.heading;
      const ps = game.pose();
      pose(rig, ps.pose, opts.reduceMotion ? 0 : time * (ps.pose === 'walk' ? 1.4 * Math.max(0.4, Math.hypot(c.v[0], c.v[1])) : 0.9), ps.k);
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
      renderer.render(scene, camera);
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
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
  };
}
