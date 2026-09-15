import { describe, expect, it } from 'vitest';
import * as C from '../src/sim/constants';
import { emptyInput } from '../src/sim/input';
import { createOpponent, driveOpponent, resetOpponent } from '../src/sim/opponent';
import { RallyEvent, createRally, stepRally } from '../src/sim/rally';
import { createRng } from '../src/sim/rng';
import { Fault } from '../src/sim/rules';
import {
  Series,
  coverage,
  createSeries,
  mishitRate,
  nextGame,
  nextServer,
  observe,
} from '../src/sim/series';

const struck = (by: 'near' | 'far', exitSpeed = 12): RallyEvent => ({
  type: 'struck',
  by,
  shape: 'drive',
  exitSpeed,
  strain: 0,
  pressure: 0,
  offCentre: 0,
});

const fault = (by: 'near' | 'far', reason: Fault): RallyEvent => ({
  type: 'fault',
  by,
  reason,
});

const served = (by: 'near' | 'far'): RallyEvent => ({ type: 'served', by });

const gameOver = (winner: 'near' | 'far', near: number, far: number): RallyEvent => ({
  type: 'gameOver',
  winner,
  score: { near, far },
});

describe('counting a match', () => {
  it('treats a ball struck by one player as a chance for the other', () => {
    const s = createSeries();
    observe(s, [struck('near'), struck('far'), struck('near')]);
    expect(s.stats.far.chances).toBe(2);
    expect(s.stats.near.chances).toBe(1);
    expect(s.stats.near.returns).toBe(2);
  });

  it('keeps failing to arrive apart from failing to execute', () => {
    // Day 7 learned this the expensive way in the measuring tool. Added
    // together the two hide each other, and a player told only "you lost
    // eleven rallies" has learned nothing they can act on.
    const s = createSeries();
    observe(s, [fault('near', 'double bounce'), fault('near', 'into net')]);
    expect(s.stats.near.missed).toBe(1);
    expect(s.stats.near.mishits).toBe(1);
    expect(s.stats.far.won).toBe(2);
  });

  it('remembers the longest rally of the game and resets it for the next', () => {
    const s = createSeries();
    observe(s, [struck('near'), struck('far'), struck('near'), fault('far', 'into net')]);
    observe(s, [struck('near'), fault('far', 'into net')]);
    expect(s.longest).toBe(3);
    nextGame(s);
    expect(s.longest).toBe(0);
    expect(s.stats.far.won).toBe(0);
    // Stats carry across games; only the per-game counters clear.
    expect(s.stats.near.won).toBe(2);
  });

  it('records the fastest shot each side hit', () => {
    const s = createSeries();
    observe(s, [struck('near', 9), struck('near', 21), struck('near', 14)]);
    expect(s.stats.near.fastest).toBe(21);
  });
});

describe('winning a match', () => {
  it('takes two games out of three, and stops there', () => {
    const s = createSeries(3);
    expect(observe(s, [gameOver('near', 11, 4)]).map((e) => e.type)).toEqual(['gameWon']);
    expect(s.champion).toBeNull();
    expect(observe(s, [gameOver('far', 6, 11)]).map((e) => e.type)).toEqual(['gameWon']);
    const done = observe(s, [gameOver('near', 11, 9)]);
    expect(done.map((e) => e.type)).toEqual(['gameWon', 'matchWon']);
    expect(s.champion).toBe('near');
    // Anything after the match is over is ignored, so a stray event cannot
    // score a fourth game.
    observe(s, [gameOver('far', 11, 0), struck('far')]);
    expect(s.history.length).toBe(3);
    expect(s.games.far).toBe(1);
  });

  it('hands the next serve to whoever lost the last game', () => {
    // The USA Pickleball rule, and the only version that does not compound:
    // giving it to the winner would stack the first-server advantage on top of
    // already being ahead, and the serve is worth about 58 per cent of rallies.
    const s = createSeries();
    expect(nextServer(s)).toBe('near');
    observe(s, [gameOver('near', 11, 5)]);
    expect(nextServer(s)).toBe('far');
    observe(s, [gameOver('far', 7, 11)]);
    expect(nextServer(s)).toBe('near');
  });

  it('keeps a record of every game played', () => {
    const s = createSeries();
    observe(s, [struck('near'), fault('far', 'out'), gameOver('near', 11, 3)]);
    expect(s.history[0]).toMatchObject({ near: 11, far: 3, winner: 'near', rallies: 1 });
  });
});

describe('the numbers shown to the player', () => {
  it('says nothing rather than dividing by zero', () => {
    const s = createSeries();
    expect(coverage(s.stats.near)).toBeNull();
    expect(mishitRate(s.stats.near)).toBeNull();
  });

  it('counts a mis-hit against the shots struck, not against itself', () => {
    // The shipped bug. A ball hit into the net fires `struck` on the contact
    // tick and `fault` a few ticks later when it reaches the net, so it is
    // already inside `returns`. Dividing by `returns + mishits` counted it
    // twice and understated the rate — by more the worse the player, which
    // compressed the very ladder the number was measuring.
    const s = createSeries();
    observe(s, [
      struck('near'),
      struck('near'),
      struck('near'),
      struck('near'),
      fault('near', 'into net'),
    ]);
    expect(s.stats.near.returns).toBe(4);
    expect(s.stats.near.mishits).toBe(1);
    expect(mishitRate(s.stats.near)).toBeCloseTo(25, 6); // 1 of 4, not 1 of 5
  });

  it('counts a serve as a shot struck, since a serve fault is a mis-hit', () => {
    // The third defect in this one statistic. `mishits` has always counted
    // serve faults, and `returns` has never counted serves — so the rate was
    // charged to a denominator the numerator was not in. The two players do not
    // serve equally often over a match, which made their rates incomparable:
    // exactly the comparison the number exists for.
    const s = createSeries();
    observe(s, [served('near'), served('near'), struck('near'), struck('near')]);
    observe(s, [fault('near', 'serve into net')]);
    expect(s.stats.near.serves).toBe(2);
    expect(s.stats.near.returns).toBe(2);
    expect(mishitRate(s.stats.near)).toBeCloseTo(25, 6); // 1 of 4 struck, not 1 of 2
  });

  it('never reports a mis-hit rate above 100 per cent', () => {
    // Guards the invariant the new denominator relies on: every mis-hit is a
    // shot that was struck, so mishits can never exceed returns.
    const s = createSeries();
    observe(s, [struck('near'), fault('near', 'out')]);
    expect(mishitRate(s.stats.near)).toBeLessThanOrEqual(100);
  });

  it('does not count a ball the other player put in the net as one you missed', () => {
    // The second shipped bug, and the larger one. A chance is credited when the
    // ball is struck; if that shot faults, it was never a ball to reach. Left
    // in, a player's coverage moved with their OPPONENT's error rate — worst
    // against `easy`, which is where the number was most quoted.
    const s = createSeries();
    // Four balls struck at near. It returns two; of the other two, one was hit
    // into the net by the opponent and one it simply failed to reach.
    observe(s, [struck('far'), struck('far'), struck('far'), struck('far')]);
    observe(s, [struck('near'), struck('near')]);
    observe(s, [fault('far', 'into net')]);
    observe(s, [fault('near', 'double bounce')]);

    expect(s.stats.near.chances).toBe(4);
    expect(s.stats.near.unplayable).toBe(1);
    // Two returned out of three that were actually playable.
    expect(coverage(s.stats.near)).toBeCloseTo(66.67, 1);
  });

  it('leaves coverage alone when the fault was the receiver failing to arrive', () => {
    const s = createSeries();
    observe(s, [struck('far'), struck('far')]);
    observe(s, [struck('near')]);
    observe(s, [fault('near', 'double bounce')]);
    expect(s.stats.near.unplayable).toBe(0);
    expect(coverage(s.stats.near)).toBeCloseTo(50, 6);
  });
});

describe('a whole match, played', () => {
  /**
   * The end-to-end check: two real opponents play until one of them takes the
   * match. It is slow-ish and deliberately not clever — if this stops finishing,
   * the game has stopped being finishable, which is the one thing Day 9 added.
   */
  it('reaches a champion, through real games', () => {
    const series: Series = createSeries(3);
    let server: 'near' | 'far' = 'near';
    let guard = 0;

    while (!series.champion && guard < 6) {
      guard += 1;
      const rally = createRally(server, 'steady');
      rally.opponent.rng = createRng(0x2000 + guard * 7919);
      const you = createOpponent('near', createRng(0x1000 + guard * 104729), 'steady');
      rally.skill.near = you.skill;
      const input = emptyInput();

      for (let i = 0; i < 1800 * C.SIM_HZ && rally.match.phase !== 'gameOver'; i++) {
        driveOpponent(you, rally.world, rally.match, rally.near, rally.far, input);
        const events = stepRally(rally, input);
        observe(series, events);
        if (events.some((e) => e.type === 'fault')) resetOpponent(you);
      }
      nextGame(series);
      server = nextServer(series);
    }

    expect(series.champion).not.toBeNull();
    expect(series.games.near + series.games.far).toBeLessThanOrEqual(3);
    expect(series.games[series.champion!]).toBe(2);
    expect(series.history.length).toBe(series.games.near + series.games.far);
    for (const game of series.history) {
      expect(Math.max(game.near, game.far)).toBeGreaterThanOrEqual(11);
      expect(Math.abs(game.near - game.far)).toBeGreaterThanOrEqual(2);
    }
  }, 60_000);
});
