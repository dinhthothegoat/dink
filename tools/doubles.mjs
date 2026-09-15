#!/usr/bin/env node
/**
 * doubles — what shape is the pair standing in, and does the rally last.
 *
 * A printer. Every number it prints is computed in `src/sim/shape.ts`, where it
 * has tests, because the four defects this project has shipped in its measuring
 * tools were all arithmetic that nothing constrained.
 *
 * Usage:
 *   node tools/doubles.mjs
 *   node tools/doubles.mjs --games 8 --difficulty tough
 *   node tools/doubles.mjs --json
 *
 * Acceptance for Day 16 (DINK-77), against Day 15's baseline:
 *   crowded    23.6 %   ->  under 5 %
 *   lateral    1.96 m   ->  over 2.8 m
 *   avg rally  3.21     ->  not lower
 */

import { emptyInput } from '../src/sim/input.ts';
import { createRally, stepRally } from '../src/sim/rally.ts';
import { createShapeTally, sampleShape, shapeReport } from '../src/sim/shape.ts';

const parse = (argv) => {
  const o = { games: 6, difficulty: 'steady', json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--games') o.games = Number(val());
    else if (a === '--difficulty') o.difficulty = val();
    else if (a === '--json') o.json = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!['easy', 'steady', 'tough'].includes(o.difficulty)) {
    throw new Error('--difficulty must be easy, steady or tough');
  }
  if (!Number.isInteger(o.games) || o.games < 1) throw new Error('--games must be a whole number');
  return o;
};

let opts;
try {
  opts = parse(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`doubles: ${e.message}\n`);
  process.exit(1);
}
if (opts.help) {
  process.stdout.write(
    'doubles — what shape is the pair standing in.\n\n' +
      '  --games <n>        games a configuration (default 6)\n' +
      '  --difficulty <d>   easy | steady | tough  (default steady)\n' +
      '  --json             machine-readable\n',
  );
  process.exit(0);
}

const measure = (teamSize) => {
  const tally = createShapeTally();
  let shots = 0;
  let rallies = 0;
  let longest = 0;
  let inThisRally = 0;
  let nearWins = 0;
  const idle = emptyInput();
  for (let g = 0; g < opts.games; g += 1) {
    // The server alternates, so a systematic advantage at one end shows up as a
    // lopsided win column rather than hiding inside the averages.
    // Vary the SEED as well as the server. Without the seed, alternating the
    // server gives two distinct games repeated, and the tool reported the same
    // shape numbers for 6 games as for 12 — a sample of two, printed as twelve.
    const rally = createRally(g % 2 ? 'far' : 'near', opts.difficulty, teamSize, true, g);
    for (let i = 0; i < 120 * 500; i += 1) {
      for (const e of stepRally(rally, idle)) {
        if (e.type === 'struck' || e.type === 'served') {
          shots += 1;
          inThisRally += 1;
        }
        if (e.type === 'fault') {
          rallies += 1;
          longest = Math.max(longest, inThisRally);
          inThisRally = 0;
        }
      }
      const live = rally.match.phase === 'inPlay';
      sampleShape(tally, rally.team.near, live);
      sampleShape(tally, rally.team.far, live);
      if (rally.match.phase === 'gameOver') break;
    }
    if (rally.match.score.near > rally.match.score.far) nearWins += 1;
  }
  return {
    teamSize,
    shots,
    rallies,
    avgRally: rallies === 0 ? null : shots / rallies,
    longest,
    nearWins,
    games: opts.games,
    shape: shapeReport(tally),
  };
};

const singles = measure(1);
const doubles = measure(2);

if (opts.json) {
  process.stdout.write(`${JSON.stringify({ singles, doubles }, null, 2)}\n`);
  process.exit(0);
}

const n = (v, d = 2) => (v === null ? '   —  ' : v.toFixed(d).padStart(6));
const row = (label, r) =>
  `${label.padEnd(9)}${n(r.avgRally)}${String(r.longest).padStart(9)}` +
  `${n(r.shape.crowded, 1)}${n(r.shape.lateral)}${n(r.shape.depthGap)}` +
  `${n(r.shape.atLine, 1)}${n(r.shape.upAndBack, 1)}`;

process.stdout.write(
  `${opts.games} games a configuration, ${opts.difficulty}, both ends played by the computer.\n` +
    'Shape is sampled only while a point is live.\n\n' +
    '            avg  longest crowded lateral   depth  atLine up+back\n' +
    `${row('singles', singles)}\n` +
    `${row('doubles', doubles)}\n\n` +
    `near won ${doubles.nearWins} of ${doubles.games} doubles games ` +
    `(server alternating; a lopsided column is an end advantage, not tactics)\n`,
);
