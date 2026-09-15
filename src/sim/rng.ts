/**
 * A small, fast, seeded pseudo-random generator (mulberry32).
 *
 * Every source of randomness in the simulation goes through one of these, and
 * each one is seeded explicitly, because `Math.random` would quietly break the
 * promise the whole architecture rests on: a rally is a starting state plus a
 * list of inputs, and it has to replay identically. A seeded stream keeps the
 * opponent's mistakes reproducible, which is also the only way to debug one.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next: () => number;
  /** Uniform in [-spread, +spread]. */
  spread: (spread: number) => number;
  /** True with probability `p`. */
  chance: (p: number) => boolean;
  /** Current internal state, so a match can be saved and resumed. */
  state: () => number;
}

export const createRng = (seed = 0x9e3779b9): Rng => {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    spread: (amount) => (next() * 2 - 1) * amount,
    chance: (p) => next() < p,
    state: () => s,
  };
};
