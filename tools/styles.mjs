#!/usr/bin/env node
/**
 * styles — are these five opponents actually different people?
 *
 * Day 22. Career mode's whole premise is that a named rival plays a particular
 * way, and a name is worth nothing if the player behind it chooses the same
 * shots as everybody else. So the styles get measured before they get names,
 * and the question is deliberately falsifiable: if two rows of this table are
 * the same, those two styles are the same style wearing different labels, and
 * one of them should be deleted rather than tuned.
 *
 * Every style plays a fixed reference — `all court` at the same difficulty — so
 * the only thing varying between rows is the style under test. Difficulty is
 * held constant on both ends on purpose: this measures what a player CHOOSES,
 * not how well they execute, and those are the two axes the whole design rests
 * on being independent.
 *
 * What is measured, and why each one:
 *
 *   drive/drop/lob   the shot mix. The most direct statement of temperament.
 *   contact depth    where they hit the ball from, in metres from the net.
 *                    A style's court position is visible here and nowhere else.
 *   at the line      share of live ticks spent inside the transition zone.
 *                    Separates a crasher from a banger better than shot mix.
 *   errors           faults they commit per rally. A style that hits shots it
 *                    should not is supposed to pay for it.
 *   won              rallies won against the reference. NOT the point of the
 *                    tool, and printed last on purpose: styles are meant to be
 *                    different, not balanced, and a ladder can order them.
 *
 * Usage:
 *   node tools/styles.mjs
 *   node tools/styles.mjs --games 8 --difficulty tough --doubles
 *   node tools/styles.mjs --json
 */

import { emptyInput } from '../src/sim/input.ts';
import { createRally, stepRally } from '../src/sim/rally.ts';
import { STYLES, STYLE_NAMES } from '../src/sim/style.ts';
import { zoneOf } from '../src/sim/opponent.ts';

const parse = (argv) => {
  const o = { games: 6, difficulty: 'steady', teamSize: 1, json: false };
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
  process.stderr.write(`styles: ${e.message}\n`);
  process.exit(1);
}
if (opts.help) {
  process.stdout.write(
    'styles — are these opponents actually different people.\n\n' +
      '  --games <n>        games per style (default 6)\n' +
      '  --difficulty <d>   easy | steady | tough, held equal on both ends\n' +
      '  --doubles          two a side (default singles)\n' +
      '  --json             machine-readable\n',
  );
  process.exit(0);
}

const idle = emptyInput();

/**
 * Play `games` games of one style against the reference and tally the style's
 * own behaviour.
 *
 * Only the FAR side is measured, because only the far side is the style under
 * test. Tallying both ends would average the style together with its opponent
 * and produce five rows that all converge on the reference — which is exactly
 * the kind of quiet denominator mistake this project has now made four times.
 */
const measure = (styleName) => {
  const t = {
    shots: 0,
    drive: 0,
    drop: 0,
    lob: 0,
    depthSum: 0,
    liveTicks: 0,
    nearTicks: 0,
    faults: 0,
    rallies: 0,
    won: 0,
  };

  for (let g = 0; g < opts.games; g += 1) {
    const rally = createRally(
      g % 2 ? 'far' : 'near',
      opts.difficulty,
      opts.teamSize,
      true,
      g,
      STYLES[styleName],
      STYLES['all court'],
    );
    for (let i = 0; i < 120 * 600; i += 1) {
      for (const e of stepRally(rally, idle)) {
        if (e.type === 'struck' && e.by === 'far') {
          t.shots += 1;
          t[e.shape] += 1;
        } else if (e.type === 'fault') {
          t.rallies += 1;
          if (e.by === 'far') t.faults += 1;
          else t.won += 1;
        }
      }
      // Court position, sampled every live tick rather than at contact: a
      // player's position between shots is most of what you see, and a style
      // that only differs at the moment of contact is not one you could spot
      // from across the court.
      if (rally.match.phase === 'inPlay') {
        t.liveTicks += 1;
        const z = Math.abs(rally.far.pos.z);
        t.depthSum += z;
        if (zoneOf(z) !== 'back') t.nearTicks += 1;
      }
      if (rally.match.phase === 'gameOver') break;
    }
  }
  return t;
};

/** Null on an empty sample, for the fifth time and for the same reason. */
const pct = (v, n) => (n === 0 ? null : (100 * v) / n);

const rows = STYLE_NAMES.map((name) => {
  const t = measure(name);
  return {
    name,
    shots: t.shots,
    drivePct: pct(t.drive, t.shots),
    dropPct: pct(t.drop, t.shots),
    lobPct: pct(t.lob, t.shots),
    meanDepth: t.liveTicks === 0 ? null : t.depthSum / t.liveTicks,
    atLinePct: pct(t.nearTicks, t.liveTicks),
    faultsPerRally: t.rallies === 0 ? null : t.faults / t.rallies,
    wonPct: pct(t.won, t.rallies),
  };
});

if (opts.json) {
  process.stdout.write(`${JSON.stringify({ options: opts, rows }, null, 2)}\n`);
  process.exit(0);
}

const n = (v, d = 1) => (v === null ? '   —' : v.toFixed(d).padStart(5));

process.stdout.write(
  `${opts.games} games per style, ${opts.difficulty} on both ends, ` +
    `${opts.teamSize === 2 ? 'doubles' : 'singles'}.\n` +
    'Each style plays the "all court" reference. Only the style under test is measured.\n\n' +
    '  style        shots   drive    drop     lob    depth  at line  faults  won\n',
);
for (const r of rows) {
  process.stdout.write(
    `  ${r.name.padEnd(11)}${String(r.shots).padStart(6)}  ` +
      `${n(r.drivePct)}%  ${n(r.dropPct)}%  ${n(r.lobPct)}%  ` +
      `${n(r.meanDepth, 2)}m  ${n(r.atLinePct)}%  ${n(r.faultsPerRally, 2)}  ${n(r.wonPct)}%\n`,
  );
}

/**
 * The falsification, run automatically rather than left to the reader.
 *
 * A table of five rows invites the eye to find differences whether or not they
 * are there. So the tool states its own verdict: any two styles whose shot mix
 * and court position are both within a few points of each other are not two
 * styles, and the tool says so rather than leaving it to be noticed.
 */
const distance = (a, b) =>
  Math.abs((a.drivePct ?? 0) - (b.drivePct ?? 0)) +
  Math.abs((a.dropPct ?? 0) - (b.dropPct ?? 0)) +
  Math.abs((a.lobPct ?? 0) - (b.lobPct ?? 0)) +
  Math.abs((a.atLinePct ?? 0) - (b.atLinePct ?? 0));

const SAME = 12;
const twins = [];
for (let i = 0; i < rows.length; i += 1) {
  for (let j = i + 1; j < rows.length; j += 1) {
    const d = distance(rows[i], rows[j]);
    if (d < SAME) twins.push([rows[i].name, rows[j].name, d]);
  }
}

process.stdout.write('\n');
if (twins.length === 0) {
  process.stdout.write(
    `  every pair of styles is separated. ${rows.length} players, not one.\n`,
  );
} else {
  for (const [a, b, d] of twins) {
    process.stdout.write(`  "${a}" and "${b}" are the same player (separation ${d.toFixed(1)}).\n`);
  }
  process.stdout.write('  A style that measures the same as another is a label. Delete or commit.\n');
}
