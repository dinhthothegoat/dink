/**
 * Plays a whole game headlessly and prints what kind of game it was.
 *
 * The unit tests answer "does a game complete?". This answers "what game is
 * being played?", which is a different question and the one that catches
 * design problems rather than crashes. On Day 5 it reported 48 rallies with
 * zero balls out and zero into the net, which is what sent Day 6's opponent
 * toward position rather than shot quality.
 *
 * Both ends are driven by the same `Opponent` brain, on separate seeds. That
 * is the only fair measurement: comparing the opponent against a scripted
 * player with no reaction time and no error measures the handicap, not the
 * opponent. It also proves the brain is genuinely side-agnostic, since a
 * mirrored sign bug would show up here as one side never scoring.
 *
 * A note on reading it: `easy` has a high error level, so its outcomes are far
 * more seed-sensitive than the other two. Twelve games showed an 11 versus 5 per
 * cent mis-hit split between the ends, which looked like the fairness check
 * firing; running it again with SWAP=1 to exchange the two random streams made
 * the split vanish, so it followed the seed rather than the side. Read `easy` at
 * GAMES=24 or more, or expect to be misled by it.
 *
 * Run with: npx tsx tools/tally.mjs [level] [level]
 */
import * as C from '../src/sim/constants.ts';
import { emptyInput } from '../src/sim/input.ts';
import { createOpponent, driveOpponent, resetOpponent } from '../src/sim/opponent.ts';
import { createRally, stepRally } from '../src/sim/rally.ts';
import { createRng } from '../src/sim/rng.ts';

/**
 * Games played, alternating who serves first.
 *
 * One game is not a measurement. The court asymmetry this tool exists to catch
 * showed up as 11 games out of 12 going to the same end, and would have looked
 * like an unlucky seed in any single game.
 */
const GAMES = Number(process.env.GAMES ?? 8);

/**
 * Which preset each end plays at:
 *   npx tsx tools/tally.mjs           both steady
 *   npx tsx tools/tally.mjs easy      both easy — reads the *character* of a
 *                                     level: rally length, which shots appear
 *   npx tsx tools/tally.mjs easy tough  a ladder match, which is the only way
 *                                     to see whether one level actually beats
 *                                     another. Two identical players tell you
 *                                     nothing about that, however many games
 *                                     they play.
 */
const FAR = process.argv[2] ?? 'steady';
const NEAR = process.argv[3] ?? FAR;

const faults = {};
const shots = {};
const held = { near: [0, 0], far: [0, 0] };
const games = { near: 0, far: 0 };
/**
 * What difficulty actually feels like, per side.
 *
 * Head-to-head win rate turned out to be the wrong acceptance test for a
 * difficulty ladder. It has a balancing dynamic in it: a cleaner player hits
 * more predictable balls, which the other player reaches more easily, so two
 * quite different levels can finish even and tell you nothing. These two
 * numbers do not balance, and they are what a person on the other side of the
 * net experiences.
 *
 *   errors   faults this player committed, per rally played
 *   returns  of the balls that came at it, how many it got back
 */
const record = {
  near: { missed: 0, mishit: 0, chances: 0, unplayable: 0, returns: 0, pressure: 0, served: 0 },
  far: { missed: 0, mishit: 0, chances: 0, unplayable: 0, returns: 0, pressure: 0, served: 0 },
};

/**
 * The two ways to lose a rally, kept apart on purpose.
 *
 * They map one to one onto the two halves of a difficulty preset. Failing to
 * reach is what `reaction` and `anticipation` control; hitting the net or the
 * fence is what `level` controls. Added together they hide each other, and a
 * preset can be made worse at one and better at the other while the total sits
 * still — which is exactly what happened before this line existed.
 */
const MISSED = new Set(['double bounce', 'missed', 'volleyed too early']);

/**
 * The other half: the striker's own shot never arrived. Those were credited to
 * the receiver as chances when they were struck, and were never chances — see
 * the note on `coverage` in src/sim/series.ts.
 */
const STRIKER_ERROR = new Set([
  'into net', 'out', 'serve into net', 'serve out', 'serve wrong box', 'serve into kitchen',
]);
let hits = 0;
let rallies = 0;
let thisRally = 0;
let longest = 0;

for (let g = 0; g < GAMES; g++) {
playGame(g);
}

function playGame(g) {
const rally = createRally(g % 2 ? 'far' : 'near', FAR);
const input = emptyInput();
// SWAP=1 exchanges the two random streams between the ends. A difference that
// follows the side is structural and serious; one that follows the seed is
// variance. This is the experiment that found the Day 6 solver bug.
const seedNear = process.env.SWAP ? 0x2000 + g * 104729 : 0x1000 + g * 7919;
const seedFar = process.env.SWAP ? 0x1000 + g * 7919 : 0x2000 + g * 104729;
const you = createOpponent('near', createRng(seedNear), NEAR);
rally.opponent.rng = createRng(seedFar);
rally.skill.near = you.skill;
rally.opponent.rng = createRng(0x2000 + g * 104729);

for (let i = 0; i < 1800 * C.SIM_HZ && rally.match.phase !== 'gameOver'; i++) {
  const server = rally.match.server;
  driveOpponent(you, rally.world, rally.match, rally.near, rally.far, input);

  for (const e of stepRally(rally, input)) {
    if (e.type === 'struck' || e.type === 'served') {
      hits += 1;
      thisRally += 1;
      // A ball struck by one player is a chance for the other. Counting it here
      // rather than from the rules means a serve counts too, which is right:
      // the return of serve is a chance like any other.
      const facing = e.by === 'near' ? 'far' : 'near';
      record[facing].chances += 1;
      if (e.type === 'served') record[e.by].served += 1;
      if (e.type === 'struck') {
        record[e.by].returns += 1;
        // How hard, on average, the shots it actually got to were. A worse
        // player reaches fewer balls, so the ones it does strike are the
        // comfortable ones — which suppresses its mis-hit rate for a reason
        // that has nothing to do with how well it strikes.
        record[e.by].pressure += e.pressure;
      }
      if (e.type === 'struck') {
        const why = e.by === 'near' ? you.lastReason : rally.opponent.lastReason;
        shots[`${e.shape} · ${why}`] = (shots[`${e.shape} · ${why}`] ?? 0) + 1;
      }
    }
    if (e.type === 'fault') {
      faults[`${e.reason} (${e.by === server ? 'server' : 'receiver'})`] =
        (faults[`${e.reason} (${e.by === server ? 'server' : 'receiver'})`] ?? 0) + 1;
      held[server][e.by === server ? 0 : 1] += 1;
      if (MISSED.has(e.reason)) record[e.by].missed += 1;
      else record[e.by].mishit += 1;
      if (STRIKER_ERROR.has(e.reason)) {
        record[e.by === 'near' ? 'far' : 'near'].unplayable += 1;
      }

      rallies += 1;
      longest = Math.max(longest, thisRally);
      thisRally = 0;
      // Both brains hold per-point state: which shot they last reacted to, and
      // how far up the court they have earned the right to stand. The rally
      // resets the far one; this one belongs to the caller, and resetting it
      // on points scored rather than on rallies played is what made an early
      // reading of this tool report 11-2 between two identical players. Under
      // side-out scoring most rallies score nothing, so the near brain was
      // carrying a stale stance into the next point and the tool was measuring
      // its own bookkeeping.
      resetOpponent(you);
    }
  }
}
games[rally.match.score.near > rally.match.score.far ? 'near' : 'far'] += 1;
}

const rate = (side) => {
  const [lost, won] = held[side];
  return `${won + lost} rallies, held ${((100 * won) / (won + lost)).toFixed(0)}%`;
};

console.log(
  `[near ${NEAR} v far ${FAR}] ${GAMES} games · ${rallies} rallies · ` +
    `${(hits / rallies).toFixed(1)} shots average · longest ${longest}`,
);
console.log(`games won: near ${games.near}, far ${games.far}`);
// The fairness check, and only meaningful when both ends play the same preset:
// two identical brains, so these two lines have to agree. A gap between them is
// a bug on one side of the net, and finding one that way is what Day 6 mostly
// consisted of.
console.log(`near serving: ${rate('near')}`);
console.log(`far  serving: ${rate('far')}`);
for (const side of ['near', 'far']) {
  const r = record[side];
  console.log(
    `${side.padEnd(4)} (${side === 'near' ? NEAR : FAR}): ` +
      `reached ${((100 * r.returns) / (r.chances - r.unplayable)).toFixed(0)}% of the ` +
      `balls it could play · ` +
      `mis-hit ${((100 * r.mishit) / (r.returns + r.served)).toFixed(0)}% of the ` +
      `${r.returns + r.served} shots it struck`,
  );
}

const table = (title, rows) => {
  console.log(title);
  for (const [k, v] of Object.entries(rows).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(v).padStart(3)}  ${k}`);
  }
};
table('shots played:', shots);
table('how the rallies ended:', faults);
