// Project model, schema `opencatio3d/project@0.1`. Field names and units follow the `opencatio3d`
// block in docs/EXPORT_FORMAT.md, so a web project *is* that block plus web-only view state in `web`.
// Storage is metres and degrees. Plan x → world X, plan y → world Z (y up in 3D, +y down on screen).
// Entries are plain objects edited with spreads, so unknown keys from another producer survive.

export type Vec2 = [number, number];
export type Polygon = Vec2[];
/** Structure-local 3D point: [u along width, y up, v along depth toward the front]. */
export type Vec3 = [number, number, number];
export type Units = 'metric' | 'imperial';

export const SCHEMA = 'opencatio3d/project@0.1';

export const TEMPLATE_IDS = ['lean-to', 'freestanding', 'window-box', 'tunnel', 'porch-infill', 'balcony-concept'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export const SIDES = ['back', 'front', 'left', 'right'] as const;
export type Side = (typeof SIDES)[number];

export const OPENING_KINDS = ['human-door', 'cat-door', 'window-access', 'cleaning-hatch', 'vestibule'] as const;
export type OpeningKind = (typeof OPENING_KINDS)[number];
export const LATCHES = ['hasp', 'slide-bolt', 'gravity', 'keyed'] as const;
export type Latch = (typeof LATCHES)[number];

export const ROOF_KINDS = ['mesh', 'corrugated', 'polycarbonate', 'partial'] as const;
export type RoofKind = (typeof ROOF_KINDS)[number];
export const BASE_KINDS = ['ground-skirt', 'pavers', 'deck', 'raised-floor', 'none'] as const;
export type BaseKind = (typeof BASE_KINDS)[number];
export const PROFILES = ['wood-2x2', 'wood-2x3', 'wood-2x4'] as const;
export type Profile = (typeof PROFILES)[number];

export const GROUND_KINDS = ['grass', 'soil', 'concrete', 'pavers', 'deck'] as const;
export type GroundKind = (typeof GROUND_KINDS)[number];

export const WALL_OPENING_KINDS = ['window', 'door', 'patio-door', 'vent', 'dryer-vent', 'utility', 'downspout', 'meter'] as const;
export type WallOpeningKind = (typeof WALL_OPENING_KINDS)[number];

export const OBSTACLE_KINDS = ['tree', 'ac-unit', 'hose-bib', 'steps', 'no-build', 'other'] as const;
export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];

/** A window, door, vent or utility on a house wall. `offset` runs from the wall's `a` end. */
export interface WallOpening {
  id: string;
  kind: WallOpeningKind;
  offset: number;
  width: number;
  height: number;
  sill: number;
  /** Bedroom emergency escape window (CAT-HOME-003). */
  egress?: boolean;
  name?: string;
  [k: string]: unknown;
}

/**
 * A house wall segment in plan. Its outdoor side is along n = (−(b.y − a.y), b.x − a.x) / |ab| — for a
 * wall drawn left to right that is +y, down the screen. A structure attached to it has local u along
 * a → b and local v along n (rotation = atan2(b.y − a.y, b.x − a.x)).
 */
export interface HostWall {
  id: string;
  a: Vec2;
  b: Vec2;
  height: number;
  openings: WallOpening[];
  [k: string]: unknown;
}

export interface SiteObstacle {
  id: string;
  kind: ObstacleKind;
  x: number;
  y: number;
  width: number;
  depth: number;
  rotation: number;
  height: number;
  name?: string;
  [k: string]: unknown;
}

export type MeasureSource = 'typed' | 'tape' | 'ar' | 'lidar';
/** A key dimension and how it was measured. Build outputs need `confirmed` on every key dimension (CAT-DIM-001). */
export interface Measurement {
  id: string;
  targetId: string;
  field: string;
  value: number;
  source: MeasureSource;
  confirmed: boolean;
  [k: string]: unknown;
}

export interface Site {
  /** Bearing of plan "up" (−y) from true north, degrees clockwise. */
  northDeg: number;
  ground: GroundKind;
  walls: HostWall[];
  obstacles: SiteObstacle[];
  measurements: Measurement[];
  [k: string]: unknown;
}

export interface Frame {
  profile: Profile;
  materialId: string;
  /** Largest stud/post pitch along a wall (m). */
  maxPostSpacing: number;
  /** Largest vertical gap between horizontal rails (m). */
  railSpacing: number;
  [k: string]: unknown;
}

export interface Roof { kind: RoofKind; coverFraction?: number; materialId?: string; [k: string]: unknown }
export interface Base { kind: BaseKind; skirtDepth?: number; [k: string]: unknown }

export interface StructureOpening {
  id: string;
  kind: OpeningKind;
  side: Side;
  offset: number;
  width: number;
  height: number;
  sill?: number;
  swing?: 'in' | 'out';
  hinge?: 'left' | 'right';
  latch?: Latch | null;
  selfClosing?: boolean;
  /** Vestibule only: how far it projects from the wall (m, default 0.9). */
  depth?: number;
  [k: string]: unknown;
}

/** An enrichment item, resource or planter. `side: 'span'` items run left↔right at `offset` from the back. */
export interface Furnishing {
  id: string;
  componentId: string;
  side: Side | 'span';
  offset: number;
  mountHeight: number;
  length?: number;
  [k: string]: unknown;
}

export interface Structure {
  id: string;
  name: string;
  template: TemplateId;
  /** Back-left corner (plan metres) and rotation (degrees): local u → (cos r, sin r), local v → (−sin r, cos r). */
  x: number;
  y: number;
  rotation: number;
  width: number;
  depth: number;
  /** Back (high) side height. */
  height: number;
  /** Front height; equals `height` for a flat roof. */
  lowHeight?: number;
  elevation?: number;
  hostWallId?: string;
  hostOpeningId?: string;
  /** Tunnel centreline in local coordinates; `width`/`height` are the cross-section. */
  path?: Vec2[];
  frame: Frame;
  mesh: { materialId: string; [k: string]: unknown };
  roof: Roof;
  base: Base;
  openings: StructureOpening[];
  furnishings: Furnishing[];
  [k: string]: unknown;
}

export interface Cat {
  id: string;
  name: string;
  ageClass: 'kitten' | 'adult' | 'senior';
  mobility: 'full' | 'reduced' | 'limited';
  size: 'small' | 'medium' | 'large';
  climber: boolean;
  escapeRisk: 'low' | 'medium' | 'high';
  [k: string]: unknown;
}

export interface PlantPlacement {
  id: string;
  plantId: string;
  structureId?: string;
  furnishingId?: string;
  x?: number;
  y?: number;
  [k: string]: unknown;
}

/** Acceptance of a finding: a note on an acknowledgeable rule, or a recorded professional review for a reviewable blocker. */
export interface Acknowledgement {
  ruleId: string;
  /** '' for project-level findings. */
  targetId: string;
  kind: 'acknowledge' | 'professional-review';
  note: string;
  by?: string;
  at: string;
  [k: string]: unknown;
}

export interface Observation {
  id: string;
  kind: 'note' | 'photo' | 'issue' | 'measurement' | 'as-built';
  createdAt: string;
  author: string;
  x?: number;
  y?: number;
  text?: string;
  photoFile?: string;
  structureId?: string;
  resolved?: boolean;
  [k: string]: unknown;
}

export interface DesignSnapshot { structures: Structure[]; plants: PlantPlacement[] }
export interface Alternative { id: string; name: string; createdAt: string; snapshot: DesignSnapshot; [k: string]: unknown }

export interface Assumptions {
  /** Stock lengths (m) to buy; [] = every length the catalog lists for each lumber. */
  stockLengths: number[];
  /** Saw kerf (m) between cuts from one stock piece. */
  kerf: number;
  /** Extra for roll and sheet goods (0.1 = 10 %). */
  wasteFactor: number;
  /** Extra screws, washers and staples. */
  fastenerOverage: number;
  [k: string]: unknown;
}

export interface Region {
  country: string;
  state?: string;
  climate?: { snowLoad: 'none' | 'light' | 'heavy'; wind: 'normal' | 'high'; hot: boolean; rainy: boolean; [k: string]: unknown };
  [k: string]: unknown;
}

/** Verbatim OpenPlan3D building arrays (prepared RoomPlan JSON, metres). */
export interface Building {
  walls: any[];
  doors: any[];
  windows: any[];
  openings: any[];
  sections: any[];
  stories: any[];
  floors: any[];
  defaults: Record<string, unknown>;
  objects?: any[];
  [k: string]: unknown;
}

export type Workspace = 'site' | 'structure' | 'access' | 'enrichment' | 'materials' | 'checks' | 'output';
export type ViewMode = '2d' | '3d' | 'split';

/** Web-only view state in `opencatio3d.web`; iOS stores it verbatim and writes it back. */
export interface WebExtras {
  view?: ViewMode;
  workspace?: Workspace;
  sampleId?: string;
  hints?: Record<string, boolean>;
  showCats?: boolean;
  [k: string]: unknown;
}

export interface Project {
  schema: typeof SCHEMA;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  catalogVersion: string;
  captureSource: 'manual' | 'template' | 'sample' | 'openplan' | 'ios' | 'ar' | string;
  units: Units;
  currency: string;
  region?: Region;
  site: Site;
  structures: Structure[];
  cats: Cat[];
  plants: PlantPlacement[];
  overrides: Acknowledgement[];
  alternatives: Alternative[];
  observations: Observation[];
  assumptions: Assumptions;
  building: Building | null;
  web: WebExtras;
  /** Unknown top-level keys of the `opencatio3d` block, re-emitted verbatim. */
  extra: Record<string, unknown>;
}

export const DEFAULT_ASSUMPTIONS: Assumptions = { stockLengths: [], kerf: 0.003, wasteFactor: 0.1, fastenerOverage: 0.1 };

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 3) | 8).toString(16);
  });
}

/**
 * Deterministic UUID-shaped id from a string key (FNV-1a based, same as the sibling apps). Same key →
 * same id on web and iOS. Keys are ASCII (structure ids and recipe keys), so UTF-16 code units = bytes.
 */
export function stableId(key: string): string {
  const h = (seed: number) => {
    let x = 0x811c9dc5 ^ seed;
    for (let i = 0; i < key.length; i++) { x ^= key.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return (x >>> 0).toString(16).padStart(8, '0');
  };
  const s = h(1) + h(2) + h(3) + h(4);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-${'89ab'[parseInt(s[16], 16) & 3]}${s.slice(17, 20)}-${s.slice(20, 32)}`;
}

/** Deep copy of plain JSON data. Unlike structuredClone it also accepts Svelte state proxies. */
export const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export const snapshotOf = (p: Project): DesignSnapshot => clone({ structures: p.structures, plants: p.plants });

/** Front height of a structure (lowHeight, or height for a flat roof). */
export const frontHeight = (s: Structure) => (typeof s.lowHeight === 'number' ? s.lowHeight : s.height);
