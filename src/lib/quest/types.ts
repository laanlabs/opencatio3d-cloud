// Catio Quest: shared types. A game layout *is* a production Project (opencatio3d/project@0.1) — the
// real generator, catalog and checks run on it — so "Continue in OpenCatio3D" is a copy, not a mapping.
// What the game adds is the household (cats with personalities), the scenario rules and the scores.
import type { Cat, Project, Region, TemplateId } from '../model/types';
import type { Assembly } from '../generate/assembly';
import type { Finding } from '../analysis/checks';

export const NEEDS = ['rest', 'lookout', 'hide', 'play', 'scratch', 'drink', 'toilet', 'greens', 'comfort'] as const;
export type Need = (typeof NEEDS)[number];

export const PERSONALITY_IDS = ['explorer', 'shy', 'lounger', 'boss', 'kitten', 'nibbler'] as const;
export type PersonalityId = (typeof PERSONALITY_IDS)[number];

export interface Personality {
  id: PersonalityId;
  name: string;
  emoji: string;
  blurb: string;
  /** How much each need matters to this cat (0 = not at all, 1 = a lot). */
  needs: Record<Need, number>;
  /** Social rank: a higher-ranked cat displaces lower ones from a spot it wants. */
  rank: number;
  /** Tests the enclosure for ways out. */
  escapeDrive: number;
  /** Chews plants. */
  nibbles: boolean;
}

/** A cat in a scenario household: the production Cat plus who they are. */
export interface QuestCat extends Cat {
  personality: PersonalityId;
  coat: string;
  bio: string;
}

export type ScoreKey = 'safety' | 'happiness' | 'social' | 'weather' | 'buildability' | 'budget' | 'style';
export const SCORE_KEYS: ScoreKey[] = ['safety', 'happiness', 'social', 'weather', 'buildability', 'budget', 'style'];

export interface Score {
  key: ScoreKey;
  value: number;
  /** What went into the number, in plain words. */
  notes: string[];
  /** How to do better, teaching real catio design. */
  tips: string[];
}

export interface GoalResult { id: string; label: string; met: boolean }

export interface Scores {
  scores: Record<ScoreKey, Score>;
  overall: number;
  stars: 0 | 1 | 2 | 3;
  passed: boolean;
  goals: GoalResult[];
}

export interface Climate {
  label: string;
  snowLoad: 'none' | 'light' | 'heavy';
  wind: 'normal' | 'high';
  hot: boolean;
  rainy: boolean;
}

/** What scenario goals and scores look at. */
export interface Evaluation {
  project: Project;
  assembly: Assembly;
  findings: Finding[];
  sim: import('./sim').SimResult;
}

export interface Goal {
  id: string;
  label: string;
  test: (e: Evaluation) => boolean;
}

export interface Scenario {
  id: string;
  title: string;
  tagline: string;
  /** The household's story, shown on the intro screen. */
  story: string;
  difficulty: 1 | 2 | 3;
  cats: QuestCat[];
  climate: Climate;
  /** Design cost limit (USD, midpoint of the generator's range); undefined = no limit. */
  budget?: number;
  /** Templates the player may switch between. */
  templates: TemplateId[];
  /** Constraints shown on the intro screen. */
  constraints: string[];
  goals: Goal[];
  /** Overall score needed to pass (with every goal met and Safety ≥ minSafety). */
  pass: number;
  minSafety: number;
  weights?: Partial<Record<ScoreKey, number>>;
  theme?: 'cozy' | 'garden' | 'shelter';
  /** Starting layout (deterministic ids). */
  start: () => Project;
  /** Seed for the simulation, so revisions are compared on the same afternoon. */
  seed: string;
  daily?: boolean;
}

export type QuestRegion = Region;
