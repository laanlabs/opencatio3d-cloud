// Seeded randomness for Catio Quest. The simulation, daily challenge and anything else that looks random
// draws from mulberry32 seeded by an FNV-1a hash of a string, so the same design + seed always plays
// out identically (and the daily challenge is the same for everyone on a given UTC date).

/** 32-bit FNV-1a hash of a string. */
export function hashSeed(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** mulberry32: a small, fast, well-mixed PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rngFor = (key: string) => mulberry32(hashSeed(key));

/** A deterministic pick from a list. */
export const pick = <T>(rng: () => number, list: readonly T[]): T => list[Math.floor(rng() * list.length) % list.length];
