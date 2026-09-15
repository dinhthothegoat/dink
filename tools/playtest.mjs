/**
 * Is `easy` easy, and is `tough` hard — for a person?
 *
 * DINK-55 has been open since Day 7: the three presets were tuned against
 * `tools/tally.mjs`, which plays them against a copy of themselves. That
 * measures the levels against each other and says nothing about whether any of
 * them is a fair fight for a human, which is the only thing that matters.
 *
 * A person cannot be put in a loop ten thousand times, so this puts in the
 * closest honest stand-in: the same opponent brain, with a person's limits
 * bolted on where a person actually has them.
 *
 *   decision rate   A person does not re-plan at 120 Hz. Movement corrections
 *                   land about ten times a second; between them you are
 *                   committed to what you last decided.
 *   reaction        250 ms from the ball being struck to moving, which is the
 *                   middle of the published range for a visual cue with a
 *                   directional choice attached.
 *   timing          The swing goes in early or late by a few tens of
 *                   milliseconds, because pressing a key at an exact moment is
 *                   the one thing this game asks that people are worst at.
 *   what it sees    The intercept ring and the ball. Nothing else — no reading
 *                   the opponent's stance or its chosen shot.
 *
 * It is a stand-in and it is stated as one. What it can tell you is whether a
 * level is winnable and whether the levels are ordered; it cannot tell you
 * whether the game is fun, and nothing headless can.
 *
 * Run with: npx tsx tools/playtest.mjs [matches per level]
 */
import * as C from '../src/sim/constants.ts';
import { emptyInput } from '../src/sim/input.ts';
import { interceptPoint, receivePosition } from '../src/sim/intercept.ts';
import { createRally, stepRally } from '../src/sim/rally.ts';
import { createRng } from '../src/sim/rng.ts';
import { HUMAN } from '../src/sim/execution.ts';
import {
  coverage,
  createSeries,
  mishitRate,
  nextGame,
  nextServer,
  observe,
} from '../src/sim/series.ts';
import { v3 } from '../src/sim/vec3.ts';
import { predictBall } from '../src/sim/world.ts';
import { warmUp } from '../src/sim/solver.ts';

const MATCHES = Number(process.argv[2] ?? 6);

/**
 * A person's limits, in the units they are measured in.
 *
 * Three of them, so the question "is this level too hard, or is my stand-in too
 * bad" can be answered rather than argued about. `club` is the default and is
 * meant to be an ordinary player; `strong` is someone who has played a lot.
 */
const PLAYERS = {
  club: { replan: 0.1, reaction: 0.25, timing: 0.045, read: 0.16 },
  strong: { replan: 0.07, reaction: 0.19, timing: 0.028, read: 0.09 },
  // Not a person. The floor of what the input model itself allows, used only to
  // tell "hard for a human" apart from "impossible for anyone".
  ceiling: { replan: 0.016, reaction: 0.1, timing: 0.012, read: 0.03 },
};

const createPerson = (seed, limits) => ({
  limits,
  rng: createRng(seed),
  sinceReplan: 0,
  reactionLeft: 0,
  reactedTo: -1,
  readOff: 0,
  timingOff: 0,
  aim: 0.4,
  stand: v3(),
  committedSwing: false,
});

/**
 * One tick of a person playing.
 *
 * The shape is deliberately the same as `driveOpponent`: react, decide where to
 * stand, walk there, swing when the paddle would arrive with the ball. What
 * differs is that every one of those steps is coarse, late, or slightly wrong.
 */
const drivePerson = (p, rally, out) => {
  const { world, match, near: me, far: them } = rally;
  const mine = world.ball.pos.z > 0.4 && !world.ball.resting;
  const bounced = match.bouncesSinceHit > 0;
  const mustLet = match.hitsThisRally < 3;

  if (match.phase === 'awaitingServe') {
    out.moveX = 0;
    out.moveZ = 0;
    out.swing = match.server === 'near';
    return;
  }

  if (match.hitsThisRally !== p.reactedTo) {
    p.reactedTo = match.hitsThisRally;
    p.reactionLeft = p.limits.reaction;
    p.readOff = p.rng.spread(p.limits.read);
    // Box-Muller would be more honest about the shape, but the tails are what
    // would matter and a uniform spread is the conservative choice: it never
    // produces the occasional perfectly-timed swing that a normal would.
    p.timingOff = p.rng.spread(p.limits.timing);
    // People aim broadly, not precisely, and they change their mind about it
    // roughly once a rally rather than once a tick.
    p.aim = p.rng.spread(0.75);
    p.committedSwing = false;
  }
  if (p.reactionLeft > 0) {
    p.reactionLeft -= C.SIM_DT;
    out.moveX = 0;
    out.moveZ = 0;
    out.swing = false;
    return;
  }

  // Re-plan where to stand about ten times a second. Between decisions the keys
  // stay where they were, which is what being committed to a step feels like.
  p.sinceReplan += C.SIM_DT;
  if (p.sinceReplan >= p.limits.replan) {
    p.sinceReplan = 0;
    const meeting = interceptPoint(world, 'near', { requireBounce: mustLet && !bounced });
    if (meeting) {
      receivePosition(p.stand, me.facing, meeting.pos);
      p.stand.x += p.readOff;
    } else {
      p.stand.x = them.pos.x * 0.2;
      p.stand.z = C.COURT_HALF_LENGTH - 0.6;
    }
  }
  out.moveX = Math.max(-1, Math.min(1, (p.stand.x - me.pos.x) * 3));
  out.moveZ = Math.max(-1, Math.min(1, (p.stand.z - me.pos.z) * 3));

  // Swing when the paddle would arrive with the ball, plus or minus the timing
  // error. Once committed, stay committed: a person cannot un-press a key.
  const lead = Math.max(0.02, C.SWING_WINDUP + p.timingOff);
  const future = predictBall(world, lead).pos;
  const distance = Math.hypot(future.x - me.pos.x, future.z - me.pos.z);
  out.swing =
    !p.committedSwing &&
    mine &&
    (!mustLet || bounced) &&
    me.phase === 'ready' &&
    distance < 1.0 &&
    future.y > C.PLAYER_STRIKE_LOW &&
    future.y < C.PLAYER_STRIKE_HIGH + 0.2;
  if (out.swing) p.committedSwing = true;

  // Drive by default; drop when up at the rail, which is what the shot is for.
  out.shape = Math.abs(me.pos.z) < 3.4 ? 'drop' : 'drive';
  out.aimX = p.aim;
  // The stand-in person does not steer depth, for the same reason the opponent
  // does not: this tool produces the difficulty ladder's numbers, and a
  // simulated player who used a control no previous run had would move the
  // ladder without anybody changing the game. DINK-134.
  out.aimZ = 0;
};

const playMatch = (level, seed, limits) => {
  const series = createSeries(3);
  const person = createPerson(seed, limits);
  let server = 'near';
  let guard = 0;

  while (!series.champion && guard < 5) {
    guard += 1;
    const rally = createRally(server, level);
    rally.opponent.rng = createRng(seed * 31 + guard);
    rally.skill.near = { ...HUMAN };
    const input = emptyInput();

    for (let i = 0; i < 2400 * C.SIM_HZ && rally.match.phase !== 'gameOver'; i++) {
      drivePerson(person, rally, input);
      observe(series, stepRally(rally, input));
    }
    nextGame(series);
    server = nextServer(series);
  }
  return series;
};

warmUp();
const WHO = process.argv[3] ?? 'club';
const limits = PLAYERS[WHO];
console.log(
  `stand-in "${WHO}": replans every ${(limits.replan * 1000).toFixed(0)} ms, ` +
    `reacts in ${(limits.reaction * 1000).toFixed(0)} ms,\n` +
    `times the swing to ±${(limits.timing * 1000).toFixed(0)} ms and reads the bounce to ` +
    `±${(limits.read * 100).toFixed(0)} cm.\n`,
);
console.log('level    matches   won   games   rallies won   reached   mis-hit');

const ONLY = process.argv[4];
for (const level of (ONLY ? [ONLY] : ['easy', 'steady', 'tough'])) {
  let won = 0;
  let gamesFor = 0;
  let gamesAgainst = 0;
  // Shaped like a SideStats, because it is handed to `coverage` and
  // `mishitRate` from the simulation. `unplayable` has to be summed too: the
  // day it was added, leaving it out here would have divided by NaN and printed
  // a table of blanks rather than failing.
  const totals = {
    chances: 0, unplayable: 0, returns: 0, serves: 0, mishits: 0, won: 0, lost: 0,
  };

  for (let m = 0; m < MATCHES; m++) {
    const series = playMatch(level, 0x51de + m * 7919, limits);
    if (series.champion === 'near') won += 1;
    gamesFor += series.games.near;
    gamesAgainst += series.games.far;
    const s = series.stats.near;
    totals.chances += s.chances;
    totals.unplayable += s.unplayable;
    totals.serves += s.serves;
    totals.returns += s.returns;
    totals.mishits += s.mishits;
    totals.won += s.won;
    totals.lost += s.missed + s.mishits;
  }

  console.log(
    `${level.padEnd(8)} ${String(MATCHES).padStart(7)}   ` +
      `${String(won).padStart(3)}   ${gamesFor}-${gamesAgainst}   ` +
      `${((100 * totals.won) / (totals.won + totals.lost)).toFixed(0).padStart(9)}%   ` +
      `${coverage(totals).toFixed(0).padStart(6)}%   ` +
      `${mishitRate(totals).toFixed(0).padStart(6)}%`,
  );
}
