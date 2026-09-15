import { Side, opponentOf } from './court';
import { Fault } from './rules';
import { RallyEvent } from './rally';

/**
 * A match: several games to 11, and what happened in them.
 *
 * Everything up to Day 8 was one game, started by loading the page and ended by
 * a line of text in the panel. That is not a match, and the difference is not
 * cosmetic. A match is what makes a bad first game recoverable, gives the
 * difficulty setting somewhere to be chosen, and gives the end of a game
 * something to say beyond the score.
 *
 * It lives in `src/sim` rather than in the page for the usual reason: it is
 * game state with rules attached, so it should be testable without a browser.
 * It reads the same `RallyEvent` stream the renderer does and writes nothing
 * back — the rally has no idea a series exists.
 */

export interface GameRecord {
  near: number;
  far: number;
  winner: Side;
  rallies: number;
  longest: number;
}

/**
 * What a player did over a match.
 *
 * These are the same two numbers `tools/tally.mjs` uses to separate difficulty
 * levels, and they are here for the same reason: they are what a person
 * actually experiences, and neither of them balances. Reported back at the end
 * of a game, they turn "you lost 11-7" into something a player can act on —
 * whether they were losing points by not getting there or by not striking
 * cleanly are different problems with different fixes.
 */
export interface SideStats {
  /** Balls struck at them, including serves. */
  chances: number;
  /**
   * How many of those never arrived legally — the other player put them into
   * the net or outside the court.
   *
   * Kept as its own number rather than quietly subtracted from `chances`,
   * because the correction is the kind of thing that is wrong once and then
   * wrong forever unless somebody can see it. `coverage` divides by the
   * difference.
   */
  unplayable: number;
  /** Balls hit at them that they got back. Serves are not returns. */
  returns: number;
  /** Serves they put in play. A serve is a shot they struck, but not a return. */
  serves: number;
  /** Rallies lost by hitting the net or the fence. */
  mishits: number;
  /** Rallies lost by not reaching the ball. */
  missed: number;
  /** Rallies the OTHER side lost. */
  won: number;
  /** Fastest shot they struck, m/s. */
  fastest: number;
}

export interface Series {
  /** Games needed to take the match. Best of three means two. */
  needed: number;
  games: Record<Side, number>;
  history: GameRecord[];
  stats: Record<Side, SideStats>;
  /** Rallies and shots in the game currently being played. */
  rallies: number;
  longest: number;
  shotsThisRally: number;
  champion: Side | null;
}

export type SeriesEvent =
  | { type: 'gameWon'; by: Side; games: Record<Side, number> }
  | { type: 'matchWon'; by: Side };

/**
 * Which faults are a failure to arrive rather than a failure to execute.
 *
 * Day 7 kept these apart in the measuring tool and it was the change that made
 * the difficulty ladder legible. Same reason here: added together they hide
 * each other, and a player told only "you lost eleven rallies" learns nothing.
 */
const MISSED: ReadonlySet<Fault> = new Set<Fault>([
  'double bounce',
  'missed',
  'volleyed too early',
]);

/**
 * Faults that mean the striker's own shot never reached the other player.
 *
 * The complement of `MISSED`, and it exists for a second reason: a ball hit into
 * the net or out of court was credited to the receiver as a chance when it was
 * struck, and it was never a chance. Leaving that in made a player's coverage
 * depend on how erratic their OPPONENT was — worst against `easy`, which is
 * exactly the level where the number was most quoted.
 */
const STRIKER_ERROR: ReadonlySet<Fault> = new Set<Fault>([
  'into net',
  'out',
  'serve into net',
  'serve out',
  'serve wrong box',
  'serve into kitchen',
]);

const emptyStats = (): SideStats => ({
  chances: 0,
  unplayable: 0,
  serves: 0,
  returns: 0,
  mishits: 0,
  missed: 0,
  won: 0,
  fastest: 0,
});

export const createSeries = (bestOf = 3): Series => ({
  needed: Math.ceil(bestOf / 2),
  games: { near: 0, far: 0 },
  history: [],
  stats: { near: emptyStats(), far: emptyStats() },
  rallies: 0,
  longest: 0,
  shotsThisRally: 0,
  champion: null,
});

/** Clear the per-game counters, keeping the match score and the running stats. */
export const nextGame = (series: Series): void => {
  series.rallies = 0;
  series.longest = 0;
  series.shotsThisRally = 0;
};

/**
 * Feed one tick's rally events in; get back anything the match wants to say.
 *
 * A pure function of the event stream, which is what lets a whole match be
 * replayed or a headless game be scored without a rally object in sight.
 */
export const observe = (series: Series, events: readonly RallyEvent[]): SeriesEvent[] => {
  const out: SeriesEvent[] = [];
  if (series.champion) return out;

  for (const e of events) {
    switch (e.type) {
      case 'served':
      case 'struck': {
        series.shotsThisRally += 1;
        const striker = e.by;
        const receiver = opponentOf(striker);
        // A ball struck by one player is a chance for the other. The serve
        // counts: the return of serve is a chance like any other, and it is the
        // hardest one in the game.
        series.stats[receiver].chances += 1;
        if (e.type === 'struck') {
          series.stats[striker].returns += 1;
          series.stats[striker].fastest = Math.max(series.stats[striker].fastest, e.exitSpeed);
        } else {
          series.stats[striker].serves += 1;
        }
        break;
      }

      case 'fault': {
        const loser = e.by;
        if (MISSED.has(e.reason)) series.stats[loser].missed += 1;
        else series.stats[loser].mishits += 1;
        if (STRIKER_ERROR.has(e.reason)) series.stats[opponentOf(loser)].unplayable += 1;
        series.stats[opponentOf(loser)].won += 1;
        series.rallies += 1;
        series.longest = Math.max(series.longest, series.shotsThisRally);
        series.shotsThisRally = 0;
        break;
      }

      case 'gameOver': {
        series.games[e.winner] += 1;
        series.history.push({
          near: e.score.near,
          far: e.score.far,
          winner: e.winner,
          rallies: series.rallies,
          longest: series.longest,
        });
        out.push({ type: 'gameWon', by: e.winner, games: { ...series.games } });
        if (series.games[e.winner] >= series.needed) {
          series.champion = e.winner;
          out.push({ type: 'matchWon', by: e.winner });
        }
        break;
      }

      default:
        break;
    }
  }
  return out;
};

/**
 * Who serves first in the next game.
 *
 * The player who lost the previous game. That is the USA Pickleball rule, and
 * it is also the only version that does not compound: handing the serve to the
 * winner would stack the first-server advantage on top of already being ahead,
 * and the serve is worth about 58 per cent of rallies in this simulation.
 */
export const nextServer = (series: Series): Side => {
  const last = series.history[series.history.length - 1];
  return last ? opponentOf(last.winner) : 'near';
};

/**
 * Percentage of the balls they could have played that they got back.
 *
 * The denominator excludes shots the other player put into the net or out,
 * which were never theirs to reach. Counting those made coverage a function of
 * the opponent's error rate as much as of the player's own movement: measured
 * against `easy`, it read 66 per cent where the true figure was 74.
 */
export const coverage = (s: SideStats): number | null => {
  const playable = s.chances - s.unplayable;
  return playable <= 0 ? null : (100 * s.returns) / playable;
};

/**
 * Percentage of the shots they struck that they mis-hit.
 *
 * Two things about the denominator, both of them mistakes this made first.
 *
 * It is not `returns + mishits`. A mis-hit IS a shot struck: the `struck` event
 * fires on the contact tick and the fault only arrives when the ball reaches
 * the net a few ticks later, so adding them counted every mis-hit twice. That
 * understated the rate, by more the worse the player, which compressed the
 * ladder this number was used to measure.
 *
 * And it includes serves. `mishits` counts serve faults — a serve into the net
 * is a mis-hit by any reading — so a denominator of returns alone charged those
 * to a count they were never in. The two players do not serve equally often
 * over a match, so it made their rates incomparable, which is precisely the
 * comparison this is for.
 *
 * A serve is a shot struck but it is not a *return*, which is why `coverage`
 * keeps its own count. One field cannot be both.
 */
export const mishitRate = (s: SideStats): number | null => {
  const struck = s.returns + s.serves;
  return struck === 0 ? null : (100 * s.mishits) / struck;
};
