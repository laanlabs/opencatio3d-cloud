// The OpenCatio3D catalog (materials, furnishings, templates, plants, rule records, sources), copied
// from opencatio3d-www/catalog/data by `npm run catalog`. Schema: that folder's README.md. Pure
// functions take a Catalog so tests can inject a small one.
import materialsDoc from './materials.json';
import componentsDoc from './components.json';
import templatesDoc from './templates.json';
import plantsDoc from './plants.json';
import rulesDoc from './rules.json';
import sourcesDoc from './sources.json';
import type { Frame, Roof, Base, StructureOpening, Furnishing, TemplateId } from '../model/types';

export type Range = [number, number];

export interface Material {
  id: string;
  kind: 'lumber' | 'mesh' | 'roof-panel' | 'sheet' | 'hardware' | 'fastener' | 'base' | 'rope' | 'kit';
  category: string;
  unit: string;
  name: string;
  notes?: string;
  // lumber
  profile?: string;
  nominal?: string;
  actual?: [number, number];
  species?: string;
  treatment?: 'none' | 'above-ground' | 'ground-contact';
  groundContact?: boolean;
  stockLengths?: number[];
  pricePerMeter?: Range;
  // mesh
  opening?: [number, number];
  gauge?: number;
  coating?: string;
  rollWidth?: number;
  rollLength?: number;
  // roof / sheet
  sheetWidth?: number;
  coverWidth?: number;
  sheetLength?: number;
  translucent?: boolean;
  thickness?: number;
  // hardware / fastener / base
  hinge?: 'standard' | 'spring';
  latch?: string;
  perBox?: number;
  size?: number;
  price?: Range;
}

export interface Component {
  id: string;
  name: string;
  category: 'enrichment' | 'resource' | 'planter';
  recipe: 'board-shelf' | 'board-ramp' | 'board-bridge' | 'post-scratcher' | 'kit';
  mount: 'wall' | 'span' | 'floor';
  defaults: { length: number; depth: number; mountHeight: number };
  limits?: Partial<Record<'length' | 'mountHeight', Range>>;
  provides: string[];
  materials: Record<string, string>;
  ratedUse: string;
}

export interface TemplateDefaults {
  width: number;
  depth: number;
  height: number;
  lowHeight?: number;
  elevation?: number;
  path?: [number, number][];
  frame: Frame;
  mesh: { materialId: string };
  roof: Roof;
  base: Base;
  openings: Omit<StructureOpening, 'id'>[];
  furnishings: Omit<Furnishing, 'id'>[];
}

export interface Template {
  id: TemplateId;
  name: string;
  summary: string;
  conceptOnly: boolean;
  attached: boolean;
  limits: Partial<Record<'width' | 'depth' | 'height' | 'lowHeight' | 'elevation' | 'pathLength', Range>>;
  defaults: TemplateDefaults;
}

export type CatSafety = 'known-hazard' | 'no-known-issue' | 'conflicting' | 'insufficient-data';
export interface PlantSource { sourceId: string; url: string; listing?: string; listedAs?: string; retrievedAt: string }
export interface Plant {
  id: string;
  name: string;
  commonNames: string[];
  scientificName: string;
  catSafety: CatSafety;
  hazardLevel?: 'severe' | 'moderate' | 'mild';
  affectedParts?: string[];
  notes?: string;
  catAttractant?: boolean;
  habit: string;
  sun: ('full' | 'part' | 'shade')[];
  water: 'low' | 'medium' | 'high';
  containerMinL: number;
  zones: Range | null;
  sources: PlantSource[];
  reviewedAt: string;
}

export type Severity = 'blocker' | 'warning' | 'advisory' | 'info';
export interface RuleRecord {
  id: string;
  version: number;
  domain: string;
  severity: Severity;
  title: string;
  explanation: string;
  remediation: string;
  evidence: string;
  sources: string[];
  acknowledgeable: boolean;
  reviewable: boolean;
  reviewedAt: string;
  effectiveDate: string;
}

export interface Source { id: string; publisher: string; title: string; url: string; kind: string; retrievedAt: string; license?: string; notes?: string }

export interface CatalogData {
  version: string;
  pricesAsOf: string;
  currency: string;
  materials: Material[];
  components: Component[];
  templates: Template[];
  plants: Plant[];
  rules: RuleRecord[];
  sources: Source[];
}

export class Catalog {
  readonly version: string;
  readonly pricesAsOf: string;
  readonly currency: string;
  readonly materials: Material[];
  readonly components: Component[];
  readonly templates: Template[];
  readonly plants: Plant[];
  readonly rules: RuleRecord[];
  readonly sources: Source[];
  private byId: Map<string, Material>;
  private compById: Map<string, Component>;
  private plantById: Map<string, Plant>;
  private ruleById: Map<string, RuleRecord>;
  private sourceById: Map<string, Source>;

  constructor(d: CatalogData) {
    this.version = d.version;
    this.pricesAsOf = d.pricesAsOf;
    this.currency = d.currency;
    this.materials = d.materials;
    this.components = d.components;
    this.templates = d.templates;
    this.plants = d.plants;
    this.rules = d.rules;
    this.sources = d.sources;
    this.byId = new Map(d.materials.map((m) => [m.id, m]));
    this.compById = new Map(d.components.map((c) => [c.id, c]));
    this.plantById = new Map(d.plants.map((p) => [p.id, p]));
    this.ruleById = new Map(d.rules.map((r) => [r.id, r]));
    this.sourceById = new Map(d.sources.map((s) => [s.id, s]));
  }

  material(id: string | undefined) { return id ? this.byId.get(id) : undefined; }
  component(id: string | undefined) { return id ? this.compById.get(id) : undefined; }
  template(id: string | undefined) { return this.templates.find((t) => t.id === id); }
  plant(id: string | undefined) { return id ? this.plantById.get(id) : undefined; }
  rule(id: string) { return this.ruleById.get(id); }
  source(id: string) { return this.sourceById.get(id); }

  lumberFor(profile: string) { return this.materials.filter((m) => m.kind === 'lumber' && m.profile === profile); }
  ofKind(kind: Material['kind']) { return this.materials.filter((m) => m.kind === kind); }
  latchMaterial(latch: string) { return this.materials.find((m) => m.kind === 'hardware' && m.latch === latch); }
}

export function catalogFromDocs(docs: { materials: any; components: any; templates: any; plants: any; rules: any; sources: any }): Catalog {
  return new Catalog({
    version: docs.materials.catalogVersion,
    pricesAsOf: docs.materials.pricesAsOf,
    currency: docs.materials.currency,
    materials: docs.materials.materials,
    components: docs.components.components,
    templates: docs.templates.templates,
    plants: docs.plants.plants,
    rules: docs.rules.rules,
    sources: docs.sources.sources
  });
}

export const catalog = catalogFromDocs({ materials: materialsDoc, components: componentsDoc, templates: templatesDoc, plants: plantsDoc, rules: rulesDoc, sources: sourcesDoc });

export const SAFETY_LABEL: Record<CatSafety, string> = {
  'known-hazard': 'Known hazard',
  'no-known-issue': 'No known issue found',
  conflicting: 'Conflicting evidence',
  'insufficient-data': 'Insufficient data'
};
