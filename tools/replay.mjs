#!/usr/bin/env node
/**
 * replay — is the simulation actually deterministic?
 *
 * Day 23. ADR-0001 has claimed since day one that this simulation is
 * reproducible, and that claim has paid for a lot of design: the fixed 120 Hz
 * accumulator, named random streams, no wall clock anywhere in `src/sim`, and
 * InputFrames as the only channel in. None of it had ever been checked. An
 * architectural claim nobody tests is a belief, and this project has spent
 * twenty-two days learning what happens to beliefs nobody tests.
 *
 * The test has to be able to FAIL. So it does not compare a replay against
 * itself, and it does not compare summaries: it plays a match with scripted
 * input, records it, replays the recording into a fresh rally, and compares the
 * two worlds tick by tick — ball position, velocity, spin, every player, and
 * the score — demanding exact equality, not closeness.
 *
 * Exact, because floating point is deterministic. The same operations in the
 * same order on the same inputs produce the same bits, and "within a
 * millimetre" would pass on a simulation that had quietly become
 * frame-rate-dependent. A tolerance here would be a way of not asking the
 * question.
 *
 * Usage:
 *   node tools/replay.mjs
 *   node tools/replay.mjs --matches 5 --difficulty tough --doubles
 */

import { emptyInput } from '../src/sim/input.ts';
import { createRally, stepRally } from '../src/sim/rally.ts';
import { STYLES } from '../src/sim/style.ts';
import { createRng } from '../src/sim/rng.ts';
import { Recorder, frames, readReplay, REPLAY_VERSION, newSeed } from '../src/core/replay.ts';

const parse = (argv) => {
  const o = { matches: 3, difficulty: 'steady', teamSize: 1, ticks: 120 * 90 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--matches') o.matches = Number(val());
    else if (a === '--difficulty') o.difficulty = val();
    else if (a === '--doubles') o.teamSize = 2;
    else if (a === '--singles') o.teamSize = 1;
    else if (a === '--seconds') o.ticks = Math.round(Number(val()) * 120);
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
};

let opts;
try {
  opts = parse(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`replay: ${e.message}\n`);
  process.exit(1);
}
if (opts.help) {
  process.stdout.write(
    'replay — is the simulation actually deterministic.\n\n' +
      '  --matches <n>      matches to record and replay (default 3)\n' +
      '  --difficulty <d>   easy | steady | tough\n' +
      '  --doubles          two a side\n' +
      '  --seconds <n>      length of each scripted match (default 90)\n',
  );
  process.exit(0);
}

/**
 * A scripted player, so the recording contains real input rather than idling.
 *
 * Deliberately NOT the autopilot: this tool must not depend on the quality of
 * anybody's play, only on there being varied input to reproduce. It moves,
 * changes shape, aims and swings on its own seeded stream, which means the
 * recording exercises every field of an InputFrame including the ones a lazy
 * test would leave at zero.
 */
const scriptedPlayer = (seed) => {
  const rng = createRng(seed);
  const shapes = ['drive', 'drop', 'lob'];
  let held = emptyInput();
  let ticksLeft = 0;
  return () => {
    if (ticksLeft <= 0) {
      // Held for a stretch, like a person, so the run-length encoding is
      // exercised rather than degenerating to one run per tick.
      ticksLeft = 6 + Math.floor(rng.next() * 40);
      held = {
        moveX: Math.round(rng.spread(1)),
        moveZ: Math.round(rng.spread(1)),
        swing: rng.chance(0.35),
        shape: shapes[Math.floor(rng.next() * 3)],
        aimX: Math.round(rng.spread(1)),
        // Deliberately NOT rounded, unlike every other axis here. The depth aim
        // ramps continuously off a keyboard now, so a real recording is full of
        // values like 0.7142857142857143 — and a determinism check fed only
        // whole numbers would never exercise the case where storing a float
        // inexactly makes a replay diverge. That is the failure this whole tool
        // exists to catch, so it has to be in the input.
        aimZ: rng.spread(1),
      };
    }
    ticksLeft -= 1;
    return { ...held };
  };
};

/** Everything a tick can be wrong about, flattened for comparison. */
const snapshot = (rally) => {
  const nums = [];
  const push = (v) => nums.push(v);
  const vec = (v) => {
    push(v.x);
    push(v.y);
    push(v.z);
  };
  vec(rally.world.ball.pos);
  vec(rally.world.ball.vel);
  vec(rally.world.ball.spin);
  push(rally.world.ball.resting ? 1 : 0);
  push(rally.world.tick);
  for (const side of ['near', 'far']) {
    for (const p of rally.team[side]) {
      push(p.pos.x);
      push(p.pos.z);
      push(p.vel.x);
      push(p.vel.z);
      push(p.phaseTime);
    }
  }
  push(rally.match.score.near);
  push(rally.match.score.far);
  push(rally.match.hitsThisRally);
  push(rally.match.bouncesSinceHit);
  return nums;
};

const build = (setup) =>
  createRally(
    setup.server,
    setup.difficulty,
    setup.teamSize,
    setup.watching,
    setup.seed,
    STYLES[setup.farStyle],
    STYLES[setup.nearStyle],
  );

let failures = 0;
let totalTicks = 0;
let totalRuns = 0;

process.stdout.write(`replay format ${REPLAY_VERSION}\n\n`);

for (let m = 0; m < opts.matches; m += 1) {
  const setup = {
    version: REPLAY_VERSION,
    build: 'tools/replay.mjs',
    seed: newSeed(),
    server: m % 2 ? 'far' : 'near',
    difficulty: opts.difficulty,
    teamSize: opts.teamSize,
    watching: false,
    farStyle: ['all court', 'banger', 'wall', 'lobber'][m % 4],
    nearStyle: 'all court',
  };

  // ---- record
  const live = build(setup);
  const recorder = new Recorder(setup);
  const player = scriptedPlayer(setup.seed ^ 0x5f3759df);
  const during = [];
  for (let i = 0; i < opts.ticks; i += 1) {
    const frame = player();
    recorder.push(frame);
    stepRally(live, frame);
    // Sample the whole world periodically rather than only at the end. A final
    // state can match by luck — a rally that ended and reset looks the same
    // whatever happened in the middle — and a divergence that self-corrects is
    // still a divergence.
    if (i % 37 === 0) during.push(snapshot(live));
  }
  const recorded = recorder.finish();

  // ---- round-trip through JSON, because that is how a bug report arrives
  const parsed = readReplay(JSON.parse(JSON.stringify(recorded)));
  if (!parsed.ok) {
    process.stdout.write(`  match ${m + 1}: FAILED to read back: ${parsed.reason}\n`);
    failures += 1;
    continue;
  }

  // ---- replay
  const ghost = build(parsed.replay.setup);
  const stream = frames(parsed.replay);
  const after = [];
  let ticks = 0;
  for (const frame of stream) {
    stepRally(ghost, frame);
    if (ticks % 37 === 0) after.push(snapshot(ghost));
    ticks += 1;
  }

  // ---- compare
  let firstDivergence = -1;
  if (ticks !== opts.ticks) firstDivergence = 0;
  for (let s = 0; s < during.length && firstDivergence < 0; s += 1) {
    const a = during[s];
    const b = after[s];
    if (!b) {
      firstDivergence = s;
      break;
    }
    for (let k = 0; k < a.length; k += 1) {
      // Exact. Object.is so that a NaN appearing in one and not the other is a
      // divergence rather than silently equal-ish, and -0 is not 0.
      if (!Object.is(a[k], b[k])) {
        firstDivergence = s;
        break;
      }
    }
  }

  const bytes = JSON.stringify(recorded).length;
  const line =
    `  match ${m + 1}: ${opts.ticks} ticks, ${recorded.runs.length} runs, ` +
    `${(bytes / 1024).toFixed(1)} kB, ${(opts.ticks / recorded.runs.length).toFixed(1)} ticks/run`;

  if (firstDivergence >= 0) {
    failures += 1;
    process.stdout.write(
      `${line}\n    DIVERGED at sample ${firstDivergence} (tick ~${firstDivergence * 37})\n`,
    );
  } else {
    process.stdout.write(`${line} · identical\n`);
  }
  totalTicks += opts.ticks;
  totalRuns += recorded.runs.length;
}

/**
 * The negative control.
 *
 * Three green ticks from a comparison that cannot go red are worth nothing, and
 * this project has shipped six harnesses that passed for the wrong reason. So
 * the tool finishes by deliberately breaking the one input that must matter —
 * the seed — and asserts that it NOTICES.
 *
 * If this reports identical, the comparison above is not comparing anything and
 * every line above it is decoration. DINK-80, applied to a determinism check
 * rather than an aggregate.
 */
const controlSetup = {
  version: REPLAY_VERSION,
  build: 'tools/replay.mjs',
  seed: 12345,
  server: 'near',
  difficulty: opts.difficulty,
  teamSize: opts.teamSize,
  watching: false,
  farStyle: 'all court',
  nearStyle: 'all court',
};
{
  const live = build(controlSetup);
  const rec = new Recorder(controlSetup);
  const player = scriptedPlayer(99);
  for (let i = 0; i < 2400; i += 1) {
    const f = player();
    rec.push(f);
    stepRally(live, f);
  }
  const truth = snapshot(live);
  // Same inputs, one different seed. A simulation whose randomness reaches the
  // rally must produce a different world; if it does not, either the seed is
  // ignored or the comparison is blind.
  const ghost = build({ ...controlSetup, seed: controlSetup.seed + 1 });
  for (const f of frames(rec.finish())) stepRally(ghost, f);
  const other = snapshot(ghost);
  const differs = truth.some((v, i) => !Object.is(v, other[i]));
  process.stdout.write(
    `\n  control: changing only the seed ${differs ? 'changed the match' : 'CHANGED NOTHING'}\n`,
  );
  if (!differs) {
    process.stdout.write(
      '  The comparison above cannot detect a difference. Every result is meaningless.\n',
    );
    failures += 1;
  }
}

process.stdout.write('\n');
if (failures === 0) {
  process.stdout.write(
    `${opts.matches} matches replayed bit for bit. ADR-0001's determinism claim holds.\n` +
      `  ${(totalTicks / totalRuns).toFixed(1)} ticks per stored run on scripted input.\n`,
  );
} else {
  process.stdout.write(
    `${failures} of ${opts.matches} matches DIVERGED. The simulation is not reproducible,\n` +
      'which invalidates replays, netcode, and every measurement taken with a fixed seed.\n',
  );
  process.exit(1);
}
