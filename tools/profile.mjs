#!/usr/bin/env node
/**
 * profile — is this the same sport, measured the way the sport measures itself.
 *
 * Every other tool here asks whether the game is internally sensible. This one
 * asks whether it resembles pickleball, in the categories published pickleball
 * analysis actually uses, against numbers charted from real matches.
 *
 * The comparison numbers live in `src/sim/profile.ts` with their sources. They
 * are pro doubles, and this simulation's levels are club to strong, so a gap is
 * expected in places — but a gap of four times is not a level difference, it is
 * a different sport, and that is what this is for.
 *
 * Usage:
 *   node tools/profile.mjs
 *   node tools/profile.mjs --games 12 --difficulty tough --singles
 *   node tools/profile.mjs --json
 */

import { emptyInput } from '../src/sim/input.ts';
import { createProfile, countRally, countShot, profileReport, REAL } from '../src/sim/profile.ts';
import { createRally, stepRally } from '../src/sim/rally.ts';

const parse = (argv) => {
  const o = { games: 8, difficulty: 'steady', teamSize: 2, json: false };
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
    else if (a === '--singles') o.teamSize = 1;
    else if (a === '--doubles') o.teamSize = 2;
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
  process.stderr.write(`profile: ${e.message}\n`);
  process.exit(1);
}
if (opts.help) {
  process.stdout.write(
    'profile — is this the same sport.\n\n' +
      '  --games <n>        games to play (default 8)\n' +
      '  --difficulty <d>   easy | steady | tough\n' +
      '  --singles          one player a side (default doubles)\n' +
      '  --json             machine-readable\n',
  );
  process.exit(0);
}

const p = createProfile();
const idle = emptyInput();
for (let g = 0; g < opts.games; g += 1) {
  // Seed AND server both vary, so the sample is g distinct games rather than
  // two games repeated — the defect this project shipped in `doubles.mjs`
  // yesterday and caught by printing the same aggregate for 6 games and 12.
  const rally = createRally(g % 2 ? 'far' : 'near', opts.difficulty, opts.teamSize, true, g);
  let shotsInRally = 0;
  let serverOfRally = rally.match.server;
  for (let i = 0; i < 120 * 600; i += 1) {
    for (const e of stepRally(rally, idle)) {
      if (e.type === 'served') {
        serverOfRally = e.by;
        shotsInRally += 1;
        countShot(p, true);
      } else if (e.type === 'struck') {
        shotsInRally += 1;
        countShot(p, false);
      } else if (e.type === 'fault') {
        countRally(p, shotsInRally, e.reason, e.by, serverOfRally);
        shotsInRally = 0;
      }
    }
    if (rally.match.phase === 'gameOver') break;
  }
}

const r = profileReport(p);
if (opts.json) {
  process.stdout.write(`${JSON.stringify({ report: r, byFault: p.byFault, real: REAL }, null, 2)}\n`);
  process.exit(0);
}

const n = (v, d = 1) => (v === null ? '    —' : v.toFixed(d).padStart(5));
const line = (label, mine, real, unit = '%') =>
  `  ${label.padEnd(28)}${n(mine)}${unit}   ${n(real)}${unit}   ${gap(mine, real)}\n`;
const gap = (mine, real) => {
  if (mine === null) return '';
  const ratio = real === 0 ? 0 : mine / real;
  if (ratio > 1.25 || ratio < 0.8) return `${ratio.toFixed(2)}x`;
  return 'ok';
};

process.stdout.write(
  `${opts.games} games, ${opts.difficulty}, ${opts.teamSize === 2 ? 'doubles' : 'singles'},` +
    ' both ends played by the computer.\n' +
    `${p.rallies} rallies, ${p.shots} shots.\n\n` +
    '                                 Dink    real    gap\n' +
    line('mean shots per rally', r.meanRally, REAL.meanRally, ' ') +
    line('rallies of 1-4 shots', r.shortPct, REAL.shortPct) +
    line('rallies of 5-8 shots', r.mediumPct, REAL.mediumPct) +
    line('rallies of 9 or more', r.longPct, REAL.longPct) +
    line('ended by striker error', r.strikerErrorPct, REAL.strikerErrorPct) +
    line('ended unreachable', r.unreachablePct, REAL.unreachablePct) +
    line('serve fault rate', r.serveFaultPct, REAL.serveFaultPct) +
    `\n  longest rally ${r.longest} shots · serving side won ` +
    `${r.servedAndWonPct === null ? '—' : r.servedAndWonPct.toFixed(0)}% of rallies\n` +
    `\n  faults: ${Object.entries(p.byFault)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${((100 * v) / p.rallies).toFixed(0)}%`)
      .join(' · ')}\n` +
    '\n  real = professional doubles, charted. Sources in src/sim/profile.ts.\n' +
    '  This game is club to strong, so expect a gap. Four times is not a gap.\n',
);
