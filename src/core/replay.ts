/**
 * A match, recorded as what was pressed.
 *
 * Day 23. ADR-0001 claimed on day one that the simulation is deterministic:
 * fixed timestep, no wall clock, seeded randomness, and InputFrames as the only
 * channel into it. Twenty-two days later that claim had never been tested. It
 * has been the justification for a lot of design — it is why the loop is a
 * fixed 120 Hz accumulator, why every random draw comes from a named stream,
 * and why the rally has never known which end is a person — and it was entirely
 * unexercised. An architectural claim nobody checks is a belief.
 *
 * This is the check, and it is also the thing that makes a playtest worth
 * running. "It got weird when I served from the left" is a description. A
 * replay is the match, and it either reproduces or the determinism claim is
 * false — and either answer is worth having.
 *
 * What is stored is deliberately NOT the ball, the players or the score. It is
 * the setup and the keypresses, and everything else is recomputed. That is the
 * whole point: if a replay had to store positions it would be a video, and a
 * video cannot tell you that the simulation is reproducible.
 */

import { Side, TeamSize } from '../sim/court';
import { InputFrame } from '../sim/input';
import { Difficulty } from '../sim/opponent';
import { ShotShape } from '../sim/solver';
import { StyleName } from '../sim/style';

/**
 * Bumped whenever a change makes old recordings replay differently.
 *
 * Not whenever the format changes — whenever the SIMULATION changes. A replay
 * is a function of the physics as much as of the file, so a recording from
 * before Day 20's spin decay rework will not reproduce today and must say so
 * rather than silently drifting. This is the one field that matters most and
 * the one easiest to forget to bump; `tools/replay.mjs` prints it on every run
 * so it is visible rather than buried.
 */
/**
 * 2 as of the depth-aim change (DINK-134). An InputFrame gained `aimZ`, which is
 * both a format change and a simulation change: a version 1 recording has no
 * depth axis to replay, and defaulting it to zero would silently produce a
 * DIFFERENT match from a file that claims to be the same one. Refusing to read
 * it is the only honest option — see the version check in `readReplay`.
 */
// 3: serve formation and AI recovery/approach decisions changed. Old inputs
// cannot reproduce the old simulation, even though the row format is unchanged.
export const REPLAY_VERSION = 3;

export interface ReplaySetup {
  version: number;
  /** The build that recorded it, for a bug report that arrives out of context. */
  build: string;
  seed: number;
  server: Side;
  difficulty: Difficulty;
  teamSize: TeamSize;
  /** Both ends played by the computer. */
  watching: boolean;
  farStyle: StyleName;
  nearStyle: StyleName;
}

/**
 * One run of identical frames: [count, moveX, moveZ, swing, shape, aimX, aimZ].
 *
 * Run-length encoded because a person holding W produces the same frame 120
 * times a second, and a match is tens of thousands of ticks. Nothing is
 * quantised: the numbers are stored exactly as the simulation consumed them,
 * because a replay that rounds is a replay that diverges, and a replay that
 * diverges is worse than no replay at all — it would look like a physics bug.
 *
 * The cost is that a gamepad, whose sticks are continuous, compresses far worse
 * than a keyboard, whose axes are exactly -1, 0 or 1. That is the honest trade
 * and it is the right way round: the common case is cheap and the rare case is
 * merely large.
 *
 * The depth axis costs one number per run and almost nothing per match: it is
 * held at whatever the last arrow left it at, so it changes far less often than
 * the movement does.
 */
export type Run = [number, number, number, 0 | 1, number, number, number];

/** Numbers in a Run, checked on the way in so a short row is caught as one. */
const RUN_LENGTH = 7;

export interface Replay {
  setup: ReplaySetup;
  runs: Run[];
  /** Ticks recorded. Derivable from `runs`, stored so a truncated file shows up. */
  ticks: number;
}

/** Shape as an index, so the file does not carry a string per tick. */
const SHAPES: readonly ShotShape[] = ['drive', 'drop', 'lob'];

const sameFrame = (a: InputFrame, run: Run): boolean =>
  run[1] === a.moveX &&
  run[2] === a.moveZ &&
  run[3] === (a.swing ? 1 : 0) &&
  run[4] === SHAPES.indexOf(a.shape) &&
  run[5] === a.aimX &&
  run[6] === a.aimZ;

export class Recorder {
  private readonly runs: Run[] = [];
  private count = 0;

  constructor(readonly setup: ReplaySetup) {}

  /**
   * Record one tick.
   *
   * Called with the frame the simulation is ABOUT to consume, never a copy made
   * later. `controls.frame()` returns a fresh object each tick today, but the
   * project has shipped three separate defects from a shared scratch buffer
   * being read after something else mutated it, so the values are copied out
   * here rather than the reference being kept.
   */
  push(frame: InputFrame): void {
    this.count += 1;
    const last = this.runs[this.runs.length - 1];
    if (last && sameFrame(frame, last)) {
      last[0] += 1;
      return;
    }
    this.runs.push([
      1,
      frame.moveX,
      frame.moveZ,
      frame.swing ? 1 : 0,
      SHAPES.indexOf(frame.shape),
      frame.aimX,
      frame.aimZ,
    ]);
  }

  get ticks(): number {
    return this.count;
  }

  finish(): Replay {
    return { setup: this.setup, runs: this.runs.map((r) => [...r] as Run), ticks: this.count };
  }
}

/**
 * Expand a replay back into one InputFrame per tick.
 *
 * A generator rather than an array: a long match is tens of thousands of
 * frames, and playback consumes them one at a time in step with the simulation.
 * Materialising the lot to hand them back one by one would be a megabyte of
 * garbage for no reason.
 *
 * It yields a FRESH object per tick. Yielding one mutable frame would be faster
 * and is exactly the defect shape this project has shipped three times.
 */
export function* frames(replay: Replay): Generator<InputFrame> {
  for (const [count, moveX, moveZ, swing, shape, aimX, aimZ] of replay.runs) {
    for (let i = 0; i < count; i += 1) {
      yield { moveX, moveZ, swing: swing === 1, shape: SHAPES[shape] ?? 'drive', aimX, aimZ };
    }
  }
}

/**
 * Read a replay from unknown JSON, or refuse.
 *
 * Returns a reason rather than throwing, because the caller is a UI that has to
 * say something useful to somebody who dragged in the wrong file. The version
 * check is the one that matters: a recording from a build with different
 * physics will replay into a different match, and reporting that as a
 * simulation bug would send somebody chasing a defect that does not exist.
 */
export const readReplay = (raw: unknown): { ok: true; replay: Replay } | { ok: false; reason: string } => {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'not a replay' };
  const v = raw as Record<string, unknown>;
  const setup = v.setup as Record<string, unknown> | undefined;
  if (typeof setup !== 'object' || setup === null) return { ok: false, reason: 'no setup' };
  if (setup.version !== REPLAY_VERSION) {
    return {
      ok: false,
      reason: `recorded by replay format ${String(setup.version)}, this build plays ${REPLAY_VERSION}`,
    };
  }
  if (!Array.isArray(v.runs)) return { ok: false, reason: 'no input' };

  const runs: Run[] = [];
  let ticks = 0;
  for (const r of v.runs) {
    if (!Array.isArray(r) || r.length !== RUN_LENGTH) {
      return { ok: false, reason: 'malformed input' };
    }
    const [count, moveX, moveZ, swing, shape, aimX, aimZ] = r as number[];
    if (!Number.isInteger(count) || count < 1) return { ok: false, reason: 'malformed run length' };
    if (![moveX, moveZ, aimX, aimZ].every(Number.isFinite)) {
      return { ok: false, reason: 'malformed axis' };
    }
    ticks += count;
    runs.push([count, moveX, moveZ, swing === 1 ? 1 : 0, shape | 0, aimX, aimZ]);
  }
  if (typeof v.ticks === 'number' && v.ticks !== ticks) {
    // The one integrity check worth having: a file cut short mid-download
    // replays a shorter match and looks like the player simply stopped.
    return { ok: false, reason: `truncated: header says ${v.ticks} ticks, found ${ticks}` };
  }
  return { ok: true, replay: { setup: setup as unknown as ReplaySetup, runs, ticks } };
};

/**
 * A seed for a new match.
 *
 * Day 23 found that every match ever played used seed 0. `createRally` takes a
 * seed and defaults it to 0, and nothing had ever passed one — so the
 * opponent's random stream was byte-identical from the first serve of every
 * match, in every session, on every install. The same mis-hit in the same place
 * on the same ball, every time you pressed Rematch.
 *
 * It survived because determinism is a virtue here and "the same every time"
 * reads as the system working. It is the difference between reproducible and
 * identical, and the replay recorder is what forced the distinction: to replay
 * a match you must first admit that the match had a seed.
 *
 * Not cryptographic, and it does not need to be. It needs to differ between
 * matches and be a plain integer that fits in a file and a bug report.
 */
export const newSeed = (): number => (Math.random() * 0xffffffff) >>> 0;
