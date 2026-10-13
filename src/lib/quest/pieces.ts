// The Catio Quest piece tray. Every piece is a real catalog item — a template, a mesh, a roof, a base, an
// opening, a furnishing or a plant — so whatever the player builds is a layout the planner understands.
// The blurbs teach the real trade-off behind each choice.
import type { BaseKind, OpeningKind, RoofKind, TemplateId } from '../model/types';

export type PieceCategory = 'structure' | 'walls' | 'roof' | 'base' | 'access' | 'perches' | 'comfort' | 'plants';

export const CATEGORY_LABEL: Record<PieceCategory, string> = {
  structure: 'Catio', walls: 'Mesh', roof: 'Roof', base: 'Floor', access: 'Doors', perches: 'Perches', comfort: 'Comforts', plants: 'Plants'
};

export type PieceAction =
  | { kind: 'template'; template: TemplateId }
  | { kind: 'mesh'; materialId: string }
  | { kind: 'roof'; roof: RoofKind; materialId?: string; coverFraction?: number }
  | { kind: 'base'; base: BaseKind }
  | { kind: 'opening'; opening: OpeningKind }
  | { kind: 'furnishing'; componentId: string }
  | { kind: 'plant'; plantId: string };

export interface Piece {
  id: string;
  name: string;
  icon: string;
  category: PieceCategory;
  blurb: string;
  action: PieceAction;
}

export const PIECES: Piece[] = [
  // Catio shape
  { id: 'tpl-lean-to', name: 'Lean-to', icon: '🏠', category: 'structure', blurb: 'Against the house; cats come out through a window.', action: { kind: 'template', template: 'lean-to' } },
  { id: 'tpl-freestanding', name: 'Freestanding', icon: '🏡', category: 'structure', blurb: 'Stands in the yard; room to walk in.', action: { kind: 'template', template: 'freestanding' } },
  { id: 'tpl-window-box', name: 'Window box', icon: '🪟', category: 'structure', blurb: 'Small and cheap: a lookout on one window.', action: { kind: 'template', template: 'window-box' } },
  // Mesh
  { id: 'mesh-1x1', name: '1″ welded wire', icon: '🔳', category: 'walls', blurb: 'The standard: 16-gauge, galvanized after welding. Too small for an adult cat.', action: { kind: 'mesh', materialId: 'mesh-1x1-16ga-gaw-48' } },
  { id: 'mesh-half', name: '½″ × 1″ wire', icon: '▦', category: 'walls', blurb: 'Kitten-proof openings. Costs a little more.', action: { kind: 'mesh', materialId: 'mesh-half-1-16ga-gaw-36' } },
  { id: 'mesh-1x2-gbw', name: '1″ × 2″ budget wire', icon: '▤', category: 'walls', blurb: 'Cheaper, but galvanized before welding: welds rust sooner, and kittens fit through.', action: { kind: 'mesh', materialId: 'mesh-1x2-16ga-gbw-48' } },
  { id: 'mesh-2x4', name: '2″ × 4″ garden fence', icon: '🥅', category: 'walls', blurb: 'Cheapest — and a cat can squeeze through it.', action: { kind: 'mesh', materialId: 'mesh-2x4-14ga-fence-48' } },
  { id: 'mesh-pvc', name: 'PVC-coated wire', icon: '⬛', category: 'walls', blurb: 'Heavy 14-gauge with a soft coating: lasts longest, kind to paws.', action: { kind: 'mesh', materialId: 'mesh-pvc-1x1-14ga-48' } },
  // Roof
  { id: 'roof-mesh', name: 'Mesh roof', icon: '☀️', category: 'roof', blurb: 'Sun and rain come straight in. Fine for mild weather only.', action: { kind: 'roof', roof: 'mesh' } },
  { id: 'roof-partial', name: 'Half-covered roof', icon: '⛅', category: 'roof', blurb: 'A solid panel over the back half: shade and a dry corner, sky over the rest.', action: { kind: 'roof', roof: 'partial', coverFraction: 0.5, materialId: 'roof-steel-corrugated' } },
  { id: 'roof-poly', name: 'Clear polycarbonate', icon: '🌤️', category: 'roof', blurb: 'Keeps rain off but lets the sun through — little shade.', action: { kind: 'roof', roof: 'polycarbonate', materialId: 'roof-polycarb-corrugated' } },
  { id: 'roof-steel', name: 'Steel roof', icon: '🌧️', category: 'roof', blurb: 'Full shade and fully dry. Darker inside.', action: { kind: 'roof', roof: 'corrugated', materialId: 'roof-steel-corrugated' } },
  // Base
  { id: 'base-pavers', name: 'Paver floor', icon: '🧱', category: 'base', blurb: 'Drains well and stops digging.', action: { kind: 'base', base: 'pavers' } },
  { id: 'base-skirt', name: 'Mesh ground skirt', icon: '〰️', category: 'base', blurb: 'Wire laid flat outward so nobody digs in or out.', action: { kind: 'base', base: 'ground-skirt' } },
  { id: 'base-raised', name: 'Raised floor', icon: '🪵', category: 'base', blurb: 'A wooden floor off the damp ground.', action: { kind: 'base', base: 'raised-floor' } },
  // Doors and access
  { id: 'open-window', name: 'Window insert', icon: '🪟', category: 'access', blurb: 'Cats come and go through the house window.', action: { kind: 'opening', opening: 'window-access' } },
  { id: 'open-cat-door', name: 'Cat door', icon: '🚪', category: 'access', blurb: 'A cat-sized flap in the catio wall.', action: { kind: 'opening', opening: 'cat-door' } },
  { id: 'open-door', name: 'People door', icon: '🚪', category: 'access', blurb: 'So a human can get in to clean. Needs a latch and a self-closer.', action: { kind: 'opening', opening: 'human-door' } },
  { id: 'open-hatch', name: 'Cleaning hatch', icon: '🧽', category: 'access', blurb: 'A small latched hatch for reaching in.', action: { kind: 'opening', opening: 'cleaning-hatch' } },
  { id: 'open-vestibule', name: 'Vestibule', icon: '🔐', category: 'access', blurb: 'A double-door airlock: the escape artist can’t dash past you.', action: { kind: 'opening', opening: 'vestibule' } },
  // Perches
  { id: 'f-shelf', name: 'Shelf', icon: '➖', category: 'perches', blurb: 'A perch on the wall. Vary the heights.', action: { kind: 'furnishing', componentId: 'shelf' } },
  { id: 'f-ramp', name: 'Ramp', icon: '📐', category: 'perches', blurb: 'Gentle way up for seniors and kittens.', action: { kind: 'furnishing', componentId: 'ramp' } },
  { id: 'f-bridge', name: 'Bridge', icon: '🌉', category: 'perches', blurb: 'Crosses the catio up high — a second route.', action: { kind: 'furnishing', componentId: 'bridge' } },
  { id: 'f-hammock', name: 'Hammock', icon: '🛏️', category: 'perches', blurb: 'A soft, high resting spot.', action: { kind: 'furnishing', componentId: 'hammock' } },
  { id: 'f-cubby', name: 'Hideaway cube', icon: '📦', category: 'perches', blurb: 'A place to hide, with a low perch on top.', action: { kind: 'furnishing', componentId: 'cubby' } },
  // Comforts
  { id: 'f-bed', name: 'Cat bed', icon: '🛋️', category: 'comfort', blurb: 'Raised off the damp floor.', action: { kind: 'furnishing', componentId: 'bed' } },
  { id: 'f-scratcher', name: 'Scratching post', icon: '🪵', category: 'comfort', blurb: 'Sisal, tall enough for a full stretch.', action: { kind: 'furnishing', componentId: 'scratcher-post' } },
  { id: 'f-water', name: 'Water bowl', icon: '💧', category: 'comfort', blurb: 'In the shade, away from the litter.', action: { kind: 'furnishing', componentId: 'water-station' } },
  { id: 'f-litter', name: 'Litter box', icon: '🚽', category: 'comfort', blurb: 'In its own enclosure, far from water.', action: { kind: 'furnishing', componentId: 'litter-annex' } },
  // Planting
  { id: 'f-planter-small', name: 'Small planter', icon: '🪴', category: 'plants', blurb: 'Holds one plant.', action: { kind: 'furnishing', componentId: 'planter-small' } },
  { id: 'f-planter-large', name: 'Large planter', icon: '🪴', category: 'plants', blurb: 'Holds up to three plants.', action: { kind: 'furnishing', componentId: 'planter-large' } },
  { id: 'p-spider', name: 'Spider plant', icon: '🌱', category: 'plants', blurb: 'ASPCA: not listed as toxic to cats.', action: { kind: 'plant', plantId: 'spider-plant' } },
  { id: 'p-fern', name: 'Boston fern', icon: '🌿', category: 'plants', blurb: 'ASPCA: not listed as toxic to cats. Likes shade.', action: { kind: 'plant', plantId: 'boston-fern' } },
  { id: 'p-rosemary', name: 'Rosemary', icon: '🌿', category: 'plants', blurb: 'ASPCA: not listed as toxic to cats. Likes sun.', action: { kind: 'plant', plantId: 'rosemary' } },
  { id: 'p-areca', name: 'Areca palm', icon: '🌴', category: 'plants', blurb: 'ASPCA: not listed as toxic to cats.', action: { kind: 'plant', plantId: 'areca-palm' } },
  { id: 'p-catgrass', name: 'Cat grass', icon: '🌾', category: 'plants', blurb: 'A cat favourite — but not on the ASPCA list, so its safety is “insufficient data”.', action: { kind: 'plant', plantId: 'cat-grass-oat' } },
  { id: 'p-catnip', name: 'Catnip', icon: '🍃', category: 'plants', blurb: 'Surprise: the ASPCA lists catnip as mildly toxic in quantity.', action: { kind: 'plant', plantId: 'catnip' } },
  { id: 'p-aloe', name: 'Aloe vera', icon: '🌵', category: 'plants', blurb: 'Listed as toxic to cats.', action: { kind: 'plant', plantId: 'aloe' } },
  { id: 'p-lily', name: 'Easter lily', icon: '🌸', category: 'plants', blurb: 'Lilies can cause kidney failure in cats. Never in a catio.', action: { kind: 'plant', plantId: 'easter-lily' } }
];

export const piece = (id: string) => PIECES.find((p) => p.id === id);
export const CATEGORIES: PieceCategory[] = ['structure', 'walls', 'roof', 'base', 'access', 'perches', 'comfort', 'plants'];

/** Planter capacity (plants) by component. */
export const PLANTER_CAPACITY: Record<string, number> = { 'planter-small': 1, 'planter-large': 3 };
