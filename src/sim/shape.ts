import * as C from './constants';
import { PlayerState } from './player';

/**
 * How a doubles pair is standing, measured rather than described.
 *
 * This lives in `src/sim` and not in a `.mjs` tool for one reason, learned the
 * hard way on Days 10 and 11: four defects turned up in the measuring tools
 * against zero in the simulation, every one of them a broken denominator, and
 * every one of them in arithmetic that no test constrained. A statistic nothing
 * constrains is a rumour with a decimal point. So the arithmetic is here, where
 * it has tests, and `tools/doubles.mjs` is a printer.
 *
 * Day 15 left a number: the pair crowds for 23.6 per cent of ticks and stands
 * 1.96 m apart on a 6.1 m court. Day 16 has to move it. This is the instrument
 * that says whether it moved.
 */
export interface ShapeTally {
  /** Ticks sampled. The denominator, and only live ones are counted. */
  ticks: number;
  /** Ticks with the pair inside CROWDED_WITHIN of each other. */
  crowded: number;
  /** Crowded ticks in the back third of the court. */
  crowdedDeep: number;
  /** Sum of |x0 - x1|, for a mean. */
  lateral: number;
  /** Sum of |z0 - z1|, for a mean. */
  depthGap: number;
  /** Ticks where both are within a stride of the non-volley line. */
  bothAtLine: number;
  /** Ticks where one is at the line and the other is behind the transition. */
  upAndBack: number;
}

/**
 * Two players closer than this are in each other's way.
 *
 * A stride, plus the paddle. Below it they cannot both swing, and one of them is
 * covering court the other already covers.
 */
export const CROWDED_WITHIN = 1.0;

/** Within a stride of the non-volley line counts as being at the line. */
const AT_LINE = C.KITCHEN_DEPTH + C.PLAYER_RADIUS + 0.9;

/** Behind this is the back third, where Day 15's crowding all happened. */
const DEEP = C.COURT_HALF_LENGTH - 2.4;

export const createShapeTally = (): ShapeTally => ({
  ticks: 0,
  crowded: 0,
  crowdedDeep: 0,
  lateral: 0,
  depthGap: 0,
  bothAtLine: 0,
  upAndBack: 0,
});

/**
 * Add one tick for one pair.
 *
 * `live` is the caller's answer to whether the point is actually being played.
 * It is a parameter rather than something this function works out, because the
 * denominator is the thing that goes wrong: sampling the ticks between points,
 * when everyone is parked at a serve position nobody chose, would measure the
 * setup code and report it as tactics. Day 11 shipped three statistics that
 * counted the wrong thing in the denominator and two of them looked plausible
 * for four days.
 */
export const sampleShape = (
  tally: ShapeTally,
  players: PlayerState[],
  live: boolean,
): void => {
  if (!live || players.length < 2) return;
  const [a, b] = players;
  const dx = Math.abs(a.pos.x - b.pos.x);
  const dz = Math.abs(a.pos.z - b.pos.z);
  tally.ticks += 1;
  tally.lateral += dx;
  tally.depthGap += dz;
  if (Math.hypot(dx, dz) < CROWDED_WITHIN) {
    tally.crowded += 1;
    if (Math.abs(a.pos.z) > DEEP && Math.abs(b.pos.z) > DEEP) tally.crowdedDeep += 1;
  }
  const aUp = Math.abs(a.pos.z) < AT_LINE;
  const bUp = Math.abs(b.pos.z) < AT_LINE;
  if (aUp && bUp) tally.bothAtLine += 1;
  else if (aUp !== bUp) tally.upAndBack += 1;
};

export interface ShapeReport {
  ticks: number;
  /** Per cent of live ticks with the pair on top of each other. */
  crowded: number | null;
  /** Of that crowding, the share that happened deep. */
  crowdedDeep: number | null;
  /** Mean lateral separation, metres. */
  lateral: number | null;
  /** Mean depth difference, metres. A pair should be level or deliberately not. */
  depthGap: number | null;
  /** Per cent of live ticks with both players at the non-volley line. */
  atLine: number | null;
  /** Per cent in an up-and-back shape. */
  upAndBack: number | null;
}

/**
 * Turn a tally into percentages.
 *
 * Every one of these returns null on an empty sample rather than NaN or zero.
 * Zero is a claim — "they never crowded" — and a tool that says it having
 * measured nothing is the exact failure `coverage` shipped with on Day 7 and
 * carried until Day 11.
 */
export const shapeReport = (tally: ShapeTally): ShapeReport => {
  const n = tally.ticks;
  const pct = (v: number) => (n === 0 ? null : (100 * v) / n);
  return {
    ticks: n,
    crowded: pct(tally.crowded),
    crowdedDeep: tally.crowded === 0 ? null : (100 * tally.crowdedDeep) / tally.crowded,
    lateral: n === 0 ? null : tally.lateral / n,
    depthGap: n === 0 ? null : tally.depthGap / n,
    atLine: pct(tally.bothAtLine),
    upAndBack: pct(tally.upAndBack),
  };
};
