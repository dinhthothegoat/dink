import { describe, expect, it } from 'vitest';
import {
  BOTTOM_RANK,
  Career,
  LADDER,
  coerceCareer,
  isChampion,
  newCareer,
  nextOpponent,
  recordMatch,
  rivalAt,
  styleFor,
  totals,
} from '../src/core/career';
import { STYLE_NAMES } from '../src/sim/style';

describe('the ladder', () => {
  it('starts the player below every rival', () => {
    const c = newCareer();
    expect(c.rank).toBe(BOTTOM_RANK);
    expect(BOTTOM_RANK).toBe(LADDER.length + 1);
    expect(rivalAt(c.rank)).toBeNull();
  });

  it('offers exactly the rival one rung up', () => {
    const c = newCareer();
    expect(nextOpponent(c)?.id).toBe(LADDER[LADDER.length - 1].id);
  });

  it('has no opponent for the champion', () => {
    expect(nextOpponent({ ...newCareer(), rank: 1 })).toBeNull();
    expect(isChampion({ ...newCareer(), rank: 1 })).toBe(true);
  });

  it('gives every rival a style the simulation actually has', () => {
    // A ladder entry naming a style that was deleted would be a rival who
    // cannot be played. `crasher` was deleted the same day this was written,
    // which is exactly how that happens.
    for (const r of LADDER) {
      expect(STYLE_NAMES).toContain(r.styleName);
      expect(styleFor(r).name).toBe(r.styleName);
    }
  });

  it('gives every rival a distinct id', () => {
    expect(new Set(LADDER.map((r) => r.id)).size).toBe(LADDER.length);
  });
});

describe('climbing', () => {
  const beat = (c: Career): Career => recordMatch(c, nextOpponent(c)!.id, true);

  it('swaps you with the rival above when you win', () => {
    const c = beat(newCareer());
    expect(c.rank).toBe(BOTTOM_RANK - 1);
  });

  it('costs nothing but the match when you lose', () => {
    const start = newCareer();
    const c = recordMatch(start, nextOpponent(start)!.id, false);
    expect(c.rank).toBe(BOTTOM_RANK);
    expect(c.matches).toBe(1);
  });

  it('reaches the top in exactly one win per rival, and stops there', () => {
    let c = newCareer();
    for (let i = 0; i < LADDER.length; i += 1) c = beat(c);
    expect(c.rank).toBe(1);
    expect(isChampion(c)).toBe(true);
    expect(nextOpponent(c)).toBeNull();
  });

  it('does not move you for beating somebody who is not directly above', () => {
    // The UI does not offer this today. A save file from a later build might,
    // and a ladder that could be climbed out of order would let one win at the
    // bottom crown somebody.
    const c = recordMatch(newCareer(), LADDER[0].id, true);
    expect(c.rank).toBe(BOTTOM_RANK);
    expect(c.results[LADDER[0].id]).toEqual({ won: 1, lost: 0 });
  });

  it('keeps the best rank when the record cannot get worse', () => {
    // There is no relegation, so best and rank track together — this test is
    // here to fail loudly on the day relegation is added, because `best` is
    // then the only thing protecting a player's high-water mark.
    let c = newCareer();
    c = beat(c);
    c = beat(c);
    expect(c.best).toBe(c.rank);
    expect(c.best).toBe(BOTTOM_RANK - 2);
  });

  it('tallies wins and losses per rival and in total', () => {
    let c = newCareer();
    const first = nextOpponent(c)!.id;
    c = recordMatch(c, first, false);
    c = recordMatch(c, first, false);
    c = recordMatch(c, first, true);
    expect(c.results[first]).toEqual({ won: 1, lost: 2 });
    expect(totals(c)).toEqual({ won: 1, lost: 2 });
    expect(c.matches).toBe(3);
  });

  it('never mutates the career it was given', () => {
    const before = newCareer();
    const snapshot = JSON.stringify(before);
    recordMatch(before, nextOpponent(before)!.id, true);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('reading a save file', () => {
  /**
   * This is the only state in the game a player can lose, so the tests are
   * about damage rather than correctness: what survives when the file is from
   * an older build, a newer one, or somebody's text editor.
   */
  it('starts fresh on anything that is not an object', () => {
    for (const junk of [null, undefined, 7, 'career', []]) {
      expect(coerceCareer(junk).rank).toBe(BOTTOM_RANK);
    }
  });

  it('clamps a rank from a build with a longer ladder', () => {
    expect(coerceCareer({ rank: 99 }).rank).toBe(BOTTOM_RANK);
    expect(coerceCareer({ rank: 0 }).rank).toBe(1);
    expect(coerceCareer({ rank: -5 }).rank).toBe(1);
  });

  it('drops an unknown rival without losing the rest of the record', () => {
    const c = coerceCareer({
      rank: 4,
      results: { ghost: { won: 3, lost: 1 }, [LADDER[0].id]: { won: 2, lost: 0 } },
    });
    expect(c.results.ghost).toBeUndefined();
    expect(c.results[LADDER[0].id]).toEqual({ won: 2, lost: 0 });
  });

  it('believes the rank when best disagrees with it', () => {
    // best is meant to be the high-water mark, so a best WORSE than the current
    // rank is incoherent. The rank is the number the player can see, so it wins.
    expect(coerceCareer({ rank: 3, best: 7 }).best).toBe(3);
    expect(coerceCareer({ rank: 3, best: 2 }).best).toBe(2);
  });

  it('refuses nonsense in the numbers rather than propagating it', () => {
    const c = coerceCareer({ rank: Number.NaN, matches: -4, best: Infinity });
    expect(c.rank).toBe(BOTTOM_RANK);
    expect(c.matches).toBe(0);
    expect(c.best).toBe(BOTTOM_RANK);
  });

  it('survives a results entry that is not an object', () => {
    const c = coerceCareer({ results: { [LADDER[0].id]: 'lots' } });
    expect(c.results[LADDER[0].id]).toBeUndefined();
  });

  it('round-trips a real career', () => {
    let c = newCareer();
    c = recordMatch(c, nextOpponent(c)!.id, true);
    c = recordMatch(c, nextOpponent(c)!.id, false);
    expect(coerceCareer(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });

  it('never hands back the shared newCareer object', () => {
    const a = coerceCareer(null);
    const b = coerceCareer(null);
    a.rank = 1;
    expect(b.rank).toBe(BOTTOM_RANK);
  });
});
