// three.js builders. Structures are drawn from the generated parts' `geom` (structure-local
// [u, y, v]), so what you see is exactly what the BOM and cut list count. World: plan x → X,
// plan y → Z, y up; a structure group sits at (x, elevation, y) rotated −rotation about Y.
import * as THREE from 'three';
import type { Catalog } from '../catalog/catalog';
import type { HostWall, Project, SiteObstacle, Structure } from '../model/types';
import type { Assembly } from '../generate/assembly';
import type { Geom, Part } from '../generate/parts';
import { rad } from '../model/geometry';
import { makeCatModel } from '../prowl/catmodel';

const WOOD: Record<string, string> = { cedar: '#b77a4f', pine: '#a99a6c', spf: '#d9c49b' };
const KIT: Record<string, string> = {
  bed: '#c9a27e', hammock: '#d8b38a', cubby: '#8a6f5a', 'litter-annex': '#7b8a99', 'water-station': '#4a8fc2',
  'planter-small': '#b5653d', 'planter-large': '#a85a34', 'cat-door': '#3b3b3b', 'window-insert': '#d9dee3', sisal: '#d6c29a'
};
export const CAT_COATS = ['#d98a3d', '#7d7f86', '#2b2b2e', '#e8d5b0', '#9a6b47', '#f2f0ea'];

const matCache = new Map<string, THREE.Material>();
function std(color: string, extra: THREE.MeshStandardMaterialParameters = {}): THREE.Material {
  const key = color + JSON.stringify(extra);
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra }); matCache.set(key, m); }
  return m;
}

let meshTexture: THREE.Texture | null = null;
/** A 4 × 4-cell welded-wire tile on a transparent background. */
function wireTexture(): THREE.Texture {
  if (meshTexture) return meshTexture;
  const size = 128, cells = 4, step = size / cells;
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!c) return (meshTexture = new THREE.Texture());
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  g.strokeStyle = 'rgba(70,76,84,1)';
  g.lineWidth = 3;
  for (let i = 0; i <= cells; i++) {
    g.beginPath(); g.moveTo(i * step, 0); g.lineTo(i * step, size); g.stroke();
    g.beginPath(); g.moveTo(0, i * step); g.lineTo(size, i * step); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return (meshTexture = t);
}

const meshMats = new Map<string, THREE.Material>();
/** Wire-look material for a mesh panel: the tile repeats once per 4 openings. */
function wireMaterial(opening: [number, number], w: number, h: number, pvc: boolean, tint?: string): THREE.Material {
  // Openings smaller than ~1 cm read as a haze at normal distances: draw at least 2.5 cm cells.
  const cu = Math.max(opening[0], 0.025) * 4, cv = Math.max(opening[1], 0.025) * 4;
  const key = `${Math.round((w / cu) * 4) / 4}x${Math.round((h / cv) * 4) / 4}:${pvc}:${tint ?? ''}`;
  let m = meshMats.get(key);
  if (!m) {
    const t = wireTexture().clone();
    t.needsUpdate = true;
    t.repeat.set(w / cu, h / cv);
    m = new THREE.MeshStandardMaterial({ map: t, color: tint ? '#ffffff' : pvc ? '#2f3a35' : '#9aa3ab', ...(tint ? { emissive: tint, emissiveIntensity: 0.9 } : {}), metalness: 0.6, roughness: 0.45, transparent: true, alphaTest: 0.2, side: THREE.DoubleSide, depthWrite: false });
    meshMats.set(key, m);
  }
  return m;
}

const v3 = (p: [number, number, number]) => new THREE.Vector3(p[0], p[1], p[2]);

/** Boards that cats walk on: drawn lying flat (thickness `size[0]` facing up) whichever way they run. */
const FLAT_ROLES = new Set(['shelf-board', 'ramp-board', 'bridge-board', 'ramp-cleat']);

function barMesh(g: Extract<Geom, { type: 'bar' }>, mat: THREE.Material, flat = false): THREE.Mesh {
  const a = v3(g.a), b = v3(g.b);
  const len = a.distanceTo(b);
  const geo = new THREE.BoxGeometry(g.size[1], len, g.size[0]);
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const thick = up.clone().addScaledVector(dir, -up.dot(dir));
  if (flat && thick.lengthSq() > 1e-6) {
    // Box axes: X = width, Y = along the bar, Z = thickness (pointing as near to up as the bar allows).
    thick.normalize();
    const width = new THREE.Vector3().crossVectors(dir, thick);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(width, dir, thick));
  } else m.quaternion.setFromUnitVectors(up, dir);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function quadMesh(g: Extract<Geom, { type: 'quad' }>, mat: THREE.Material, uvW = 1, uvH = 1): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  const [p0, p1, p2, p3] = g.p;
  geo.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, ...p2, ...p0, ...p2, ...p3], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, uvW, 0, uvW, uvH, 0, 0, uvW, uvH, 0, uvH], 2));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, mat);
}

function boxMesh(g: Extract<Geom, { type: 'box' }>, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(g.s[0], g.s[1], g.s[2]), mat);
  m.position.set(g.c[0], g.c[1], g.c[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export interface StructureOptions {
  highlightOwner?: string | null;
  /** Draw only these parts (Build mode: the steps done so far). */
  only?: Set<string>;
  /** Draw these parts in the highlight colour (Build mode: the current step). */
  highlightParts?: Set<string>;
}

/** One structure from its parts. `userData.structureId` on every mesh supports picking. */
export function buildStructure(s: Structure, parts: Part[], cat: Catalog, opts: StructureOptions = {}): THREE.Group {
  const group = new THREE.Group();
  group.name = s.name;
  group.position.set(s.x, s.elevation ?? 0, s.y);
  group.rotation.y = -rad(s.rotation);
  for (const p of parts) {
    if (!p.geom || (opts.only && !opts.only.has(p.id))) continue;
    const m = cat.material(p.materialId);
    let obj: THREE.Mesh | null = null;
    const hl = (opts.highlightOwner && p.ownerId === opts.highlightOwner) || opts.highlightParts?.has(p.id);
    if (p.geom.type === 'bar') {
      const color = hl ? '#e8a93a' : m?.kind === 'lumber' ? WOOD[m.species ?? 'spf'] ?? WOOD.spf : '#999';
      obj = barMesh(p.geom, std(color), FLAT_ROLES.has(p.role));
    } else if (p.geom.type === 'quad') {
      if (m?.kind === 'mesh') {
        obj = quadMesh(p.geom, wireMaterial((m.opening ?? [0.0254, 0.0254]) as [number, number], p.width ?? 1, p.height ?? 1, m.coating === 'pvc-coated', hl ? '#e8a93a' : undefined), 1, 1);
        obj.renderOrder = 2;
      } else if (m?.kind === 'roof-panel') {
        obj = quadMesh(p.geom, hl ? std('#e8a93a', { transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthWrite: false }) : m.translucent ? std('#e9f3f7', { transparent: true, opacity: 0.45, roughness: 0.2, side: THREE.DoubleSide, depthWrite: false }) : std('#9aa1a6', { metalness: 0.5, roughness: 0.5, side: THREE.DoubleSide }));
        obj.renderOrder = 3;
      } else obj = quadMesh(p.geom, std('#999', { side: THREE.DoubleSide }));
    } else {
      const color = hl ? '#e8a93a' : m?.kind === 'sheet' ? '#c8a97a' : KIT[p.role] ?? '#a0a0a0';
      obj = boxMesh(p.geom, std(color, m?.id === 'kit-window-insert' ? { transparent: true, opacity: 0.6 } : {}));
    }
    obj.userData = { structureId: s.id, partId: p.id, ownerId: p.ownerId };
    group.add(obj);
  }
  return group;
}

/** House walls with windows and doors drawn on their outdoor face. */
export function buildHouse(p: Project): THREE.Group {
  const g = new THREE.Group();
  const wallMat = std('#e9e3d8');
  const glass = std('#9cc4dc', { roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
  const door = std('#6b5a4c');
  const frame = std('#ffffff');
  const vent = std('#8f969c');
  for (const w of p.site.walls) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    if (L < 0.01) continue;
    const ang = Math.atan2(w.b[1] - w.a[1], w.b[0] - w.a[0]);
    const wall = new THREE.Group();
    wall.position.set(w.a[0], 0, w.a[1]);
    wall.rotation.y = -ang;
    const body = new THREE.Mesh(new THREE.BoxGeometry(L, w.height, 0.2), wallMat);
    body.position.set(L / 2, w.height / 2, -0.1);
    body.receiveShadow = true;
    body.castShadow = true;
    body.userData = { wallId: w.id };
    wall.add(body);
    for (const o of w.openings) {
      const isGlass = o.kind === 'window' || o.kind === 'patio-door';
      const m = isGlass ? glass : o.kind === 'door' ? door : vent;
      const pane = new THREE.Mesh(new THREE.BoxGeometry(o.width, o.height, 0.02), m);
      pane.position.set(o.offset + o.width / 2, o.sill + o.height / 2, 0.012);
      pane.userData = { wallId: w.id, wallOpeningId: o.id };
      wall.add(pane);
      if (isGlass || o.kind === 'door') {
        const f = new THREE.Mesh(new THREE.BoxGeometry(o.width + 0.08, o.height + 0.08, 0.015), frame);
        f.position.set(o.offset + o.width / 2, o.sill + o.height / 2, 0.004);
        wall.add(f);
      }
    }
    g.add(wall);
  }
  return g;
}

export const GROUND_COLOR: Record<string, string> = { grass: '#8fae6b', soil: '#9b7f5f', concrete: '#c9c6bf', pavers: '#b8b0a3', deck: '#a77b52' };

export function buildGround(size: number, kind: string): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), std(GROUND_COLOR[kind] ?? GROUND_COLOR.grass, { roughness: 1 }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  m.name = 'ground';
  return m;
}

export function buildObstacle(o: SiteObstacle): THREE.Group {
  const g = new THREE.Group();
  g.position.set(o.x, 0, o.y);
  g.rotation.y = -rad(o.rotation);
  if (o.kind === 'tree') {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, o.height * 0.45, 10), std('#6d5240'));
    trunk.position.y = o.height * 0.225;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(Math.max(o.width, o.depth) * 0.9, 1), std('#5f8a4a', { flatShading: true }));
    crown.position.y = o.height * 0.65;
    trunk.castShadow = crown.castShadow = true;
    g.add(trunk, crown);
  } else {
    const color = o.kind === 'no-build' ? '#d9534f' : o.kind === 'ac-unit' ? '#b9bec4' : '#8f8f8f';
    const box = new THREE.Mesh(new THREE.BoxGeometry(o.width, o.kind === 'no-build' ? 0.02 : o.height, o.depth), std(color, o.kind === 'no-build' ? { transparent: true, opacity: 0.35 } : {}));
    box.position.y = o.kind === 'no-build' ? 0.01 : o.height / 2;
    box.castShadow = o.kind !== 'no-build';
    g.add(box);
  }
  g.userData = { obstacleId: o.id };
  g.traverse((c) => (c.userData = { obstacleId: o.id }));
  return g;
}

/** A cat (Catio Prowl's model), sitting up or loafing, posed once: the 3D view only draws when something changes. */
export function buildCat(coat: string, scale = 1, loaf = false): THREE.Group {
  const model = makeCatModel(coat);
  // Let the pose settle: a cat that has been still for a while sits (after 1.2 s) or loafs (after 9 s).
  const drive = { speed: 0, sneak: false, ground: true, leap: null, busy: null, busyK: 0, idle: loaf ? 10 : 2, look: null, frontDy: 0, backDy: 0, meowAgo: 99 };
  for (let i = 0; i < 12; i++) model.update(0.5, drive);
  const g = new THREE.Group();
  model.root.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  g.add(model.root);
  g.scale.setScalar(scale);
  return g;
}

/** Cats sitting on perches (highest first), then on floors, inside the structures. */
export function buildCats(p: Project, a: Assembly, cat: Catalog): THREE.Group {
  const g = new THREE.Group();
  g.name = 'cats';
  const spots: { s: Structure; pos: THREE.Vector3 }[] = [];
  for (const s of p.structures) {
    if (s.template === 'tunnel') continue;
    const perches = s.furnishings
      .map((f) => ({ f, c: cat.component(f.componentId) }))
      .filter((x) => x.c?.provides.includes('perch'))
      .sort((x, y) => y.f.mountHeight - x.f.mountHeight);
    for (const { f, c } of perches) {
      const part = a.parts.find((pt) => pt.ownerId === f.id && pt.geom);
      if (!part?.geom) continue;
      const geom = part.geom;
      const pos = geom.type === 'bar' ? v3(geom.a).add(v3(geom.b)).multiplyScalar(0.5) : geom.type === 'box' ? v3(geom.c) : v3(geom.p[0]);
      pos.y = c!.recipe === 'kit' ? (geom.type === 'box' ? geom.c[1] + geom.s[1] / 2 : pos.y) : f.mountHeight + 0.02;
      spots.push({ s, pos });
    }
    spots.push({ s, pos: new THREE.Vector3(s.width * 0.35, 0.02, s.depth * 0.6) });
  }
  p.cats.forEach((c, i) => {
    const spot = spots[i % Math.max(1, spots.length)];
    if (!spot) return;
    const mesh = buildCat(CAT_COATS[i % CAT_COATS.length], c.size === 'small' || c.ageClass === 'kitten' ? 0.8 : c.size === 'large' ? 1.15 : 1, i % 2 === 1);
    const holder = new THREE.Group();
    holder.position.set(spot.s.x, spot.s.elevation ?? 0, spot.s.y);
    holder.rotation.y = -rad(spot.s.rotation);
    mesh.position.copy(spot.pos).add(new THREE.Vector3((i % 2) * 0.12, 0, 0));
    mesh.rotation.y = Math.PI * (0.8 + 0.3 * (i % 3));
    holder.add(mesh);
    g.add(holder);
  });
  return g;
}

export function disposeGroup(g: THREE.Object3D) {
  for (const child of [...g.children]) {
    child.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    g.remove(child);
  }
}

export { sceneBounds } from './bounds';

export type { HostWall };
