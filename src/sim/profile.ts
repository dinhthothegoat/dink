import { Side } from './court';
import { Fault } from './rules';

/**
 * What kind of game is being played, in the categories the SPORT measures.
 *
 * Every previous tool in this project measured what was convenient to count.
 * That was fine while the only question was "is the game internally sensible",
 * and it is useless for the question Day 17 actually asks, which is "is this
 * game like the real one". So these buckets are not chosen to suit the
 * simulation. They are the buckets published pickleball analysis uses, and the
 * numbers to beat are written down beside them in REAL below.
 *
 * The arithmetic lives here rather than in a `.mjs` tool because this project
 * has now shipped five defects in measuring tools against one in the
 * simulation, every one of them in a denominator nothing constrained.
 */
export interface Profile {
  /** Rallies that ended. The denominator for endings and for the histogram. */
  rallies: number;
  /** Shots struck, serves included. */
  shots: number;
  /** Rallies of 1 to 4 shots, 5 to 8, and 9 or more. The sport's buckets. */
  short: number;
  medium: number;
  long: number;
  /** Longest rally seen. */
  longest: number;
  /**
   * The rally ended because the striker put the ball somewhere illegal.
   *
   * An unforced error, in the sport's language. Net, out, wrong box, kitchen.
   */
  strikerError: number;
  /**
   * The rally ended because nobody got to a legal ball.
   *
   * Winners and forced errors together, deliberately NOT separated. The sport
   * splits them by a judgement about whether the receiver "should" have reached
   * it, and this simulation has no basis for that judgement — inventing one
   * would produce a number that looks like the published ones and means
   * something else. Two honest buckets beat three dishonest ones.
   */
  unreachable: number;
  /** Ends by fault, for the breakdown. */
  byFault: Partial<Record<Fault, number>>;
  /** Serves struck, and serves that faulted. */
  serves: number;
  serveFaults: number;
  /** Rallies won by the side that served them. */
  servedAndWon: number;
}

export const createProfile = (): Profile => ({
  rallies: 0,
  shots: 0,
  short: 0,
  medium: 0,
  long: 0,
  longest: 0,
  strikerError: 0,
  unreachable: 0,
  byFault: {},
  serves: 0,
  serveFaults: 0,
  servedAndWon: 0,
});

/**
 * Faults where the striker is the one who made the mistake.
 *
 * `double bounce` and `missed` are the other kind: a legal ball nobody reached,
 * which is a winner or a forced error rather than anybody's unforced error.
 * `volleyed too early` and `volley in the kitchen` are rule breaches by the
 * striker, so they count as striker errors — rare enough not to matter, listed
 * so the classification is complete rather than merely plausible.
 */
const STRIKER_ERROR: ReadonlySet<Fault> = new Set<Fault>([
  'into net',
  'out',
  'serve into net',
  'serve out',
  'serve wrong box',
  'serve into kitchen',
  'volleyed too early',
  'volley in the kitchen',
]);

const SERVE_FAULT: ReadonlySet<Fault> = new Set<Fault>([
  'serve into net',
  'serve out',
  'serve wrong box',
  'serve into kitchen',
]);

/** Count one struck ball. */
export const countShot = (profile: Profile, isServe: boolean): void => {
  profile.shots += 1;
  if (isServe) profile.serves += 1;
};

/** Close one rally. `server` is the side that served it. */
export const countRally = (
  profile: Profile,
  shotsInRally: number,
  fault: Fault,
  faultedBy: Side,
  server: Side,
): void => {
  profile.rallies += 1;
  profile.longest = Math.max(profile.longest, shotsInRally);
  if (shotsInRally <= 4) profile.short += 1;
  else if (shotsInRally <= 8) profile.medium += 1;
  else profile.long += 1;

  if (STRIKER_ERROR.has(fault)) profile.strikerError += 1;
  else profile.unreachable += 1;
  if (SERVE_FAULT.has(fault)) profile.serveFaults += 1;
  profile.byFault[fault] = (profile.byFault[fault] ?? 0) + 1;
  if (faultedBy !== server) profile.servedAndWon += 1;
};

export interface ProfileReport {
  rallies: number;
  meanRally: number | null;
  longest: number;
  shortPct: number | null;
  mediumPct: number | null;
  longPct: number | null;
  strikerErrorPct: number | null;
  unreachablePct: number | null;
  serveFaultPct: number | null;
  servedAndWonPct: number | null;
}

/**
 * Percentages, or null.
 *
 * Null rather than zero on an empty sample, for the fourth time in this
 * codebase and for the same reason: zero is a claim, and a tool that makes it
 * having measured nothing is how `coverage` misled this project for four days.
 */
export const profileReport = (p: Profile): ProfileReport => {
  const pct = (v: number, n: number) => (n === 0 ? null : (100 * v) / n);
  return {
    rallies: p.rallies,
    meanRally: p.rallies === 0 ? null : p.shots / p.rallies,
    longest: p.longest,
    shortPct: pct(p.short, p.rallies),
    mediumPct: pct(p.medium, p.rallies),
    longPct: pct(p.long, p.rallies),
    strikerErrorPct: pct(p.strikerError, p.rallies),
    unreachablePct: pct(p.unreachable, p.rallies),
    // Serve faults are charged against SERVES, not against rallies. Getting
    // this denominator wrong is exactly the Day 11 defect, which charged serve
    // faults to a count that serves were not in.
    serveFaultPct: pct(p.serveFaults, p.serves),
    servedAndWonPct: pct(p.servedAndWon, p.rallies),
  };
};

/**
 * The real sport, for comparison. Measured, not estimated, with sources.
 *
 * Professional doubles unless noted. These are the numbers Day 17 balances
 * against, and they are kept in the simulation package rather than in a tool so
 * that a test can assert the game has not drifted away from them.
 *
 * Sources, read directly rather than taken from a research summary — the run
 * that was supposed to supply this on Day 14 returned three usable claims from
 * 104 agents and voted 3-0 to refute the two-bounce rule:
 *
 *   pickleball-research.com/outcomes, citing Prieto-Lage 2024 and a PPA charting
 *   of 27 gold-medal matches.
 *
 * Where a figure is a range across skill levels, the midpoint is used and the
 * range is in the comment.
 */
export const REAL = {
  /** Pro men's doubles. Women's is 9.6. */
  meanRally: 8.6,
  /** Rallies of 1-4 shots. */
  shortPct: 43,
  /** 5-8 shots. */
  mediumPct: 44,
  /** 9 or more. */
  longPct: 13,
  /** Unforced errors as a share of how points end. Range 60-75 by level. */
  strikerErrorPct: 63.7,
  /** Winners 20.3 plus forced errors 16.0, which this model does not separate. */
  unreachablePct: 36.3,
  /** Serve completion is 97.6-97.8 per cent, so faults are the remainder. */
  serveFaultPct: 2.3,
} as const;
