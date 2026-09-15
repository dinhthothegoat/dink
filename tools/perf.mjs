/**
 * What the simulation costs, and where.
 *
 * The headline used to be the worst single tick, which was a mistake. A maximum
 * over a few hundred samples is one sample: it is whatever garbage collection or
 * OS scheduling happened to land in, and it swung between 3 ms and 24 ms across
 * runs of identical code. Two things get reported instead, both repeatable:
 *
 *   the distribution of contact ticks   the solve is the only expensive thing in
 *                                       here, so p50 and p99 of the ticks that
 *                                       do one is the cost of the simulation
 *   garbage collection, separately      counted and timed by the runtime rather
 *                                       than inferred from a spike, because a
 *                                       pause is not the simulation being slow
 *
 * DINK-38 was open from Day 2 to Day 10 about the first of those: the shot
 * solver runs inside the tick that resolves a contact and nobody had measured
 * it. The second is what that measurement then turned up.
 *
 * Run with: npx tsx tools/perf.mjs
 */
import { PerformanceObserver } from 'node:perf_hooks';
import * as C from '../src/sim/constants.ts';
import { emptyInput } from '../src/sim/input.ts';
import { createOpponent, driveOpponent, resetOpponent } from '../src/sim/opponent.ts';
import { createRally, stepRally } from '../src/sim/rally.ts';
import { createRng } from '../src/sim/rng.ts';
import { warmUp } from '../src/sim/solver.ts';

const BUDGET_MS = 1000 / C.SIM_HZ;
// Long enough that the contact percentiles have something to stand on. Rallies
// are short and there is dead time between points, so 300 s of play yields only
// about 70 contacts — and a "p99" over 70 samples is the maximum wearing a
// percentile's clothes, which is the exact mistake this tool was rewritten to
// stop making.
const SECONDS = Number(process.env.SECONDS ?? 900);

let gcCount = 0;
let gcTime = 0;
let worstGc = 0;
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    gcCount += 1;
    gcTime += e.duration;
    worstGc = Math.max(worstGc, e.duration);
  }
}).observe({ entryTypes: ['gc'] });

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

const run = (label, level, seed) => {
  let rally = createRally('near', level);
  let you = createOpponent('near', createRng(seed), level);
  rally.skill.near = you.skill;
  const input = emptyInput();
  const plain = [];
  const contacts = [];
  let games = 0;

  for (let i = 0; i < SECONDS * C.SIM_HZ; i++) {
    // Start another game when one finishes. Without this the run went quiet
    // after the first game to 11 and spent the rest of its duration stepping a
    // world with nothing in it — so raising the duration to get more samples
    // produced exactly the same seventy contacts, which is what gave the tool
    // away.
    if (rally.match.phase === 'gameOver') {
      games += 1;
      rally = createRally(games % 2 ? 'far' : 'near', level);
      you = createOpponent('near', createRng(seed + games * 7919), level);
      rally.skill.near = you.skill;
    }
    driveOpponent(you, rally.world, rally.match, rally.near, rally.far, input);
    const t0 = performance.now();
    const events = stepRally(rally, input);
    const dt = performance.now() - t0;
    if (events.some((e) => e.type === 'struck' || e.type === 'served')) contacts.push(dt);
    else plain.push(dt);
    if (events.some((e) => e.type === 'fault')) resetOpponent(you);
  }

  plain.sort((a, b) => a - b);
  contacts.sort((a, b) => a - b);
  // Percentiles only as deep as the sample supports: with n contacts, the 1/n
  // tail is a single observation and reporting it as a percentile is a lie with
  // arithmetic on it.
  const deepest = contacts.length >= 400 ? 0.99 : contacts.length >= 100 ? 0.95 : 0.9;
  console.log(
    `${label.padEnd(24)} ${contacts.length} contacts over ${games + 1} games · ` +
      `p50 ${pct(contacts, 0.5).toFixed(2)} ms · ` +
      `p${(deepest * 100).toFixed(0)} ${pct(contacts, deepest).toFixed(2)} ms`,
  );
  console.log(
    `${''.padEnd(24)} every other tick: p50 ${pct(plain, 0.5).toFixed(4)} ms · ` +
      `p99 ${pct(plain, 0.99).toFixed(4)} ms`,
  );
  return pct(contacts, deepest);
};

console.log(`tick budget at ${C.SIM_HZ} Hz: ${BUDGET_MS.toFixed(2)} ms`);
const cold = performance.now();
warmUp();
console.log(`warmUp() ${(performance.now() - cold).toFixed(0)} ms, once, during loading\n`);

const a = run('one human, one opponent', 'steady', 0xc0ffee);
const b = run('both on tough', 'tough', 0xbeef);

// PerformanceObserver delivers on a later turn of the loop. Printing without
// this waited for nothing and reported zero collections in ten minutes of
// simulated play, which is not a plausible number and should have been read as
// a broken instrument rather than a good result.
await new Promise((resolve) => setTimeout(resolve, 100));

const worst = Math.max(a, b);
console.log(
  `\nsimulation: worst reported contact tick ${worst.toFixed(2)} ms, ` +
    `${(BUDGET_MS / worst).toFixed(1)}x inside the ${BUDGET_MS.toFixed(2)} ms budget`,
);
console.log(
  `collection: ${gcCount} pauses in ${2 * SECONDS} simulated seconds · ` +
    `worst ${worstGc.toFixed(2)} ms (${((100 * worstGc) / BUDGET_MS).toFixed(0)}% of a tick) · ` +
    `${gcTime.toFixed(0)} ms total`,
);
console.log(
  `a 60 fps frame runs two ticks; the bad case is one contact plus one pause, ` +
    `\nwhich is ${(worst + worstGc).toFixed(1)} ms of its 16.67 ms.`,
);
