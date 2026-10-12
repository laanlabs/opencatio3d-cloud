// Generated parts and the constants every recipe shares. A Part is one physical thing (or one batch of
// fasteners) with a stable id `stableId(structureId + ':' + key)`; the 3D view draws parts from their
// `geom`, and the BOM, cut list and steps are computed from the same parts — there is no separate
// decorative model. Every number here is part of the web ↔ iOS contract (EXPORT_FORMAT.md
// "Generator algorithms"); change one only together with the Swift port and the parity fixtures.
import type { Side, Vec3 } from '../model/types';

/** Extra mesh width/height per panel so each edge lands on a frame member (m). */
export const OVERLAP = 0.025;
/** Mesh screw + washer spacing along every panel edge (m). */
export const MESH_FASTENER_SPACING = 0.15;
/** Largest gap between roof purlins under solid panels (m). */
export const PURLIN_SPACING = 0.6;
/** End lap where two rows of roof sheets meet (m). */
export const END_LAP = 0.15;
/** Largest floor joist spacing for raised floors (m). */
export const JOIST_SPACING = 0.4;
/** Structural screw spacing along a ledger (m). */
export const LEDGER_SCREW_SPACING = 0.4;
/** Landscape staple spacing along a ground skirt; trim screw spacing (m). */
export const STAPLE_SPACING = 0.3;
/** Clearance around a door or hatch leaf (m, each side). */
export const DOOR_GAP = 0.006;
/** Frame screws per frame member (two at each end). */
export const SCREWS_PER_MEMBER = 4;
/** Sisal rope (m) per metre of wrapped 4×4 post: perimeter 0.356 m ÷ ⅜″ rope. */
export const ROPE_PER_M = 37.5;
/** Ramp cleat spacing (m). */
export const CLEAT_SPACING = 0.15;
/** Knee-brace spacing under a raised box (m). */
export const KNEE_SPACING = 0.9;
/** Default vestibule depth (m). */
export const VESTIBULE_DEPTH = 0.9;
/** Default ground-skirt depth (m). */
export const SKIRT_DEPTH = 0.3;
/** Default share of a partial roof that is covered. */
export const PARTIAL_COVER = 0.5;

export const EPS = 1e-9;
/** ceil that ignores floating-point fuzz: ceilE(2.0000000001) = 2. */
export const ceilE = (x: number) => Math.ceil(x - EPS);
/** Lengths are reported to the millimetre (round half up; all inputs are positive). */
export const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** Money to the cent. */
export const r2 = (x: number) => Math.round(x * 100) / 100;

export type PartKind = 'member' | 'panel' | 'connector' | 'hardware' | 'kit' | 'base';
export type StepKey = 'base' | 'walls' | 'attach' | 'roof-frame' | 'openings' | 'mesh' | 'roof-cover' | 'skirt' | 'furnish' | 'inspect';
export const STEP_ORDER: StepKey[] = ['base', 'walls', 'attach', 'roof-frame', 'openings', 'mesh', 'roof-cover', 'skirt', 'furnish', 'inspect'];

/** Drawing hints in structure-local coordinates [u, y, v]. */
export type Geom =
  | { type: 'bar'; a: Vec3; b: Vec3; size: [number, number] }
  | { type: 'quad'; p: [Vec3, Vec3, Vec3, Vec3] }
  | { type: 'box'; c: Vec3; s: Vec3 };

export interface Part {
  id: string;
  structureId: string;
  key: string;
  kind: PartKind;
  /** What the part is for, e.g. 'stud', 'mesh-wall', 'hinge' (EXPORT_FORMAT.md role table). */
  role: string;
  materialId: string;
  qty: number;
  step: StepKey;
  /** Build label such as "A12" (members, panels, hardware and kits; never fasteners). */
  label?: string;
  /** Members and rope: length (m). */
  length?: number;
  /** Panels: width across the roll / sheet and height along it (m). */
  width?: number;
  height?: number;
  /** Mesh: metres of roll this part consumes (per qty). */
  rollLength?: number;
  /** Sheet goods: area (m², per qty). */
  area?: number;
  side?: Side | 'roof' | 'span';
  /** Opening / furnishing this part belongs to. */
  ownerId?: string;
  geom?: Geom;
}

/** Roles counted as frame members (each gets SCREWS_PER_MEMBER frame screws). */
export const FRAME_ROLES = new Set(['plate', 'stud', 'jamb', 'header', 'sill', 'rail', 'rafter', 'purlin', 'joist', 'door-stile', 'door-rail', 'door-brace', 'hoop-post', 'hoop-bar', 'tunnel-rail']);
