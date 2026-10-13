// Cat personalities. Each one weights the needs differently, so the same catio plays out differently
// for an explorer who wants height, a shy cat who wants a hiding place and a senior who wants a warm,
// reachable bed. The needs mirror the AAFP/ISFM feline environmental needs (safe places, vertical space,
// play, scratching, separate resources) that the real checks are built on.
import type { Cat } from '../model/types';
import type { Need, Personality, PersonalityId, QuestCat } from './types';

const n = (v: Partial<Record<Need, number>>): Record<Need, number> => ({ rest: 0.5, lookout: 0.5, hide: 0.3, play: 0.4, scratch: 0.4, drink: 0.5, toilet: 0.3, greens: 0.1, comfort: 0.5, ...v });

export const PERSONALITIES: Record<PersonalityId, Personality> = {
  explorer: { id: 'explorer', name: 'Explorer', emoji: '🧭', blurb: 'Climbs everything, wants the highest lookout, and tests every gap.', needs: n({ lookout: 1, play: 0.8, rest: 0.4, hide: 0.1 }), rank: 2, escapeDrive: 0.6, nibbles: false },
  shy: { id: 'shy', name: 'Shy one', emoji: '🫣', blurb: 'Needs a hiding place and a way around the bossy cat.', needs: n({ hide: 1, rest: 0.7, lookout: 0.4, play: 0.2 }), rank: 0, escapeDrive: 0, nibbles: false },
  lounger: { id: 'lounger', name: 'Lounger', emoji: '😴', blurb: 'Senior sunbather: a soft bed, gentle steps, water close by.', needs: n({ rest: 1, comfort: 0.9, lookout: 0.5, play: 0.1, hide: 0.2 }), rank: 1, escapeDrive: 0, nibbles: false },
  boss: { id: 'boss', name: 'Boss', emoji: '👑', blurb: 'Claims the best perch and pushes others off it.', needs: n({ lookout: 0.9, rest: 0.6, play: 0.3 }), rank: 3, escapeDrive: 0.2, nibbles: false },
  kitten: { id: 'kitten', name: 'Kitten', emoji: '🐾', blurb: 'Plays with everything, squeezes through anything, chews leaves.', needs: n({ play: 1, scratch: 0.8, lookout: 0.5, rest: 0.4, greens: 0.5 }), rank: 0, escapeDrive: 0.5, nibbles: true },
  nibbler: { id: 'nibbler', name: 'Plant nibbler', emoji: '🌿', blurb: 'Loves greenery — and tastes it.', needs: n({ greens: 1, rest: 0.6, lookout: 0.5 }), rank: 1, escapeDrive: 0.1, nibbles: true }
};

export const COATS = ['#d98a3d', '#7d7f86', '#2b2b2e', '#e8d5b0', '#9a6b47', '#f2f0ea', '#c4703a', '#5b5e66'];

/** A household cat: sensible production fields for the personality, overridable per scenario. */
export function questCat(id: string, name: string, personality: PersonalityId, coat: string, bio: string, patch: Partial<Cat> = {}): QuestCat {
  const base: Cat = {
    id, name,
    ageClass: personality === 'kitten' ? 'kitten' : personality === 'lounger' ? 'senior' : 'adult',
    mobility: personality === 'lounger' ? 'reduced' : 'full',
    size: personality === 'kitten' ? 'small' : 'medium',
    climber: personality !== 'lounger',
    escapeRisk: PERSONALITIES[personality].escapeDrive >= 0.5 ? 'high' : PERSONALITIES[personality].escapeDrive > 0 ? 'medium' : 'low'
  };
  return { ...base, ...patch, personality, coat, bio };
}

/** Jump reach (m) for a cat: up, down, and the longest horizontal leap. Mobility and age shrink it. */
export function capsFor(c: Cat): { up: number; down: number; leap: number } {
  let up = c.ageClass === 'kitten' ? 1.1 : c.ageClass === 'senior' ? 0.6 : c.climber ? 1.5 : 1.0;
  if (c.mobility === 'reduced') up *= 0.6;
  if (c.mobility === 'limited') up *= 0.4;
  if (c.size === 'large') up *= 0.95;
  const down = Math.min(2, Math.max(0.5, up * 1.6));
  const leap = c.ageClass === 'senior' || c.mobility !== 'full' ? 0.5 : c.ageClass === 'kitten' ? 0.8 : 1.0;
  return { up: Math.round(up * 100) / 100, down: Math.round(down * 100) / 100, leap };
}
