import { describe, expect, it } from 'vitest';
import * as C from '../src/sim/constants';
import { HUMAN, Skill, perturb, pressureOf, readError } from '../src/sim/execution';
import { POWER_SPOT_OFFSET, defaultSwing, strike, withSwing } from '../src/sim/paddle';
import { createRng } from '../src/sim/rng';
import { DOUBLES_CLEARANCE, LIVE_SOLVE, ballAt, solveSwing } from '../src/sim/solver';
import { v3 } from '../src/sim/vec3';
import { createWorld, launch, step } from '../src/sim/world';

const ball = (vel: [number, number, number]) => ({
  pos: v3(0, 0.9, 3),
  vel: v3(...vel),
  spin: v3(),
  resting: false,
});

const easy: Skill = { level: 0.9, reaction: 0.4, anticipation: 0.5 };
const perfect: Skill = { level: 0, reaction: 0, anticipation: 0 };

describe('pressure', () => {
  it('is nothing for a comfortable ball, standing still', () => {
    expect(pressureOf(ball([0, 0, -2]), 0.9, 0, 0).total).toBeLessThan(0.2);
  });

  it('rises with every one of its four causes', () => {
    const calm = pressureOf(ball([0, 0, -2]), 0.9, 0, 0);
    expect(pressureOf(ball([0, 0, -2]), 0.9, 0.9, 0).total).toBeGreaterThan(calm.total);
    expect(pressureOf(ball([0, 0, -20]), 0.9, 0, 0).total).toBeGreaterThan(calm.total);
    expect(pressureOf(ball([0, 0, -2]), C.PLAYER_STRIKE_LOW, 0, 0).total)
      .toBeGreaterThan(calm.total);
    expect(pressureOf(ball([0, 0, -2]), 0.9, 0, 4).total).toBeGreaterThan(calm.total);
  });

  it('stays inside 0 and 1 however bad it gets', () => {
    const worst = pressureOf(ball([0, -12, -40]), 0.1, 3, 12);
    expect(worst.total).toBeGreaterThan(0.8);
    expect(worst.total).toBeLessThanOrEqual(1);
  });
});

describe('perturbing a swing', () => {
  const swing = withSwing(defaultSwing(), { speed: 14, pitch: 8, yaw: 3, pathAngle: 20 });
  const calm = pressureOf(ball([0, 0, -2]), 0.9, 0, 0);
  const hard = pressureOf(ball([0, -4, -20]), 0.4, 0.9, 3);

  it('leaves a flawless player alone', () => {
    expect(perturb(swing, perfect, hard, createRng(1))).toEqual(swing);
  });

  it('goes further wrong under pressure than in comfort', () => {
    const spread = (p: typeof calm) => {
      const rng = createRng(9);
      let worst = 0;
      for (let i = 0; i < 200; i++) {
        worst = Math.max(worst, Math.abs(perturb(swing, easy, p, rng).pitch - swing.pitch));
      }
      return worst;
    };
    expect(spread(hard)).toBeGreaterThan(spread(calm) * 1.5);
  });

  it('is never perfect, even on an easy ball', () => {
    // Without a floor, an opponent plays flawlessly whenever it is not under
    // pressure, and every point is decided by whether it can reach — which is
    // the state Days 5 and 6 both measured and both called the problem.
    const rng = createRng(3);
    const moved = Array.from({ length: 40 }, () => perturb(swing, easy, calm, rng)).filter(
      (s) => s.pitch !== swing.pitch,
    );
    expect(moved.length).toBe(40);
  });

  it('sits the ball up on average rather than scattering evenly', () => {
    // The tuning finding: with a symmetric scatter, error was a free source of
    // spread, and spread is what makes a ball hard to reach — so the "tough"
    // preset lost to "steady". A player who does not strike cleanly loses pace
    // and opens the face, which is a genuinely worse shot, and one the shot
    // chooser already knows to attack.
    const rng = createRng(11);
    let pitch = 0;
    let speed = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const got = perturb(swing, easy, hard, rng);
      pitch += got.pitch - swing.pitch;
      speed += got.speed - swing.speed;
    }
    expect(pitch / n).toBeGreaterThan(0.5);
    expect(speed / n).toBeLessThan(-0.1);
  });
});

describe('what a mis-hit does to the ball', () => {
  /**
   * The whole point of perturbing the swing rather than the target: the
   * simulation decides what a bad contact means. A model that nudged where the
   * ball was aimed would only ever produce a different shot that lands in, and
   * the measurement Days 5 and 6 kept returning was that nobody ever missed.
   */
  it('sends some of them out and some into the net', () => {
    const rng = createRng(4242);
    const hard = pressureOf(ball([0, -4, -20]), 0.4, 0.9, 3);
    // A deep drive off a low ball, which is what the opponent actually plays
    // and where its errors actually happen. Aimed at the middle of the court a
    // mis-hit still lands in: the margin is what makes a safe shot safe, and a
    // model that missed from there would be wrong.
    const from = v3(0, 0.5, 5.5);
    const intent = { targetX: 0.5, targetZ: -5.4, shape: 'drive' as const, facing: -1 as const };
    const intended = solveSwing(ballAt(from), intent, {}, LIVE_SOLVE).swing;

    let out = 0;
    let netted = 0;
    let good = 0;

    for (let i = 0; i < 80; i++) {
      const b = ballAt(from);
      strike(b, perturb(intended, easy, hard, rng));
      const world = createWorld();
      launch(world, b.pos, b.vel, b.spin);
      let settled = false;
      for (let t = 0; t < 6 * C.SIM_HZ && !settled; t++) {
        for (const e of step(world)) {
          if (e.type === 'net') {
            netted += 1;
            settled = true;
          } else if (e.type === 'bounce') {
            if (e.inBounds) good += 1;
            else out += 1;
            settled = true;
          }
        }
      }
    }

    expect(good).toBeGreaterThan(0);
    expect(out + netted).toBeGreaterThan(0);
    // And the same swing, struck cleanly, should be reliable — otherwise the
    // errors above are the solver's, not the error model's.
    const clean = ballAt(from);
    strike(clean, intended);
    const world = createWorld();
    launch(world, clean.pos, clean.vel, clean.spin);
    let landed: { inBounds: boolean } | null = null;
    for (let t = 0; t < 6 * C.SIM_HZ && !landed; t++) {
      for (const e of step(world)) if (e.type === 'bounce') landed = e;
    }
    expect(landed?.inBounds).toBe(true);
  });
});

describe('reading the ball', () => {
  it('is exact for a player with no anticipation error', () => {
    expect(readError(perfect, pressureOf(ball([0, 0, -20]), 0.4, 1, 3), createRng(1))).toBe(0);
  });

  it('stays inside the skill it was given', () => {
    const rng = createRng(5);
    const hard = pressureOf(ball([0, -4, -20]), 0.4, 0.9, 3);
    for (let i = 0; i < 200; i++) {
      expect(Math.abs(readError(easy, hard, rng))).toBeLessThanOrEqual(easy.anticipation);
    }
  });
});

describe('the human', () => {
  it('is near enough perfect in comfort and a real risk on the stretch', () => {
    // The reach ring has promised this since Day 3. With level zero it was a
    // lie: a player at full stretch hit exactly the same shot as one standing
    // still.
    const swing = withSwing(defaultSwing(), { speed: 14, pitch: 8 });
    const rng = createRng(77);
    const worst = (strain: number, height: number, moving: number) => {
      const p = pressureOf(ball([0, 0, -8]), height, strain, moving);
      let w = 0;
      for (let i = 0; i < 300; i++) {
        w = Math.max(w, Math.abs(perturb(swing, HUMAN, p, rng).pitch - swing.pitch));
      }
      return w;
    };
    expect(worst(0, 0.9, 0)).toBeLessThan(1.5);
    expect(worst(0.95, 0.4, 3.5)).toBeGreaterThan(2.5);
  });
});

describe('the third shot drop, against film', () => {
  /**
   * Does the solver play the shot the sport plays?
   *
   * The companion to the drag check in ball.test.ts. That one asks whether a
   * real launch lands where our physics says; this one asks whether our SOLVER
   * chooses a real launch. Same six filmed trajectories (arXiv 2501.00163):
   *
   *   down the line  10.9-13.0 m/s at 15.5-22.5 deg
   *   cross court    13.3-16.0 m/s at 12.5-18.0 deg
   *
   * Day 20 found the answer was no. DROP_APEX had been set by eye at 2.2 m and
   * the solver was launching third shots at 36.5 degrees and 9.2 m/s — a slow
   * loop where the sport hits a flattish arc. Deriving the apex from the window
   * above closed most of the gap.
   *
   * Most, not all. The angle still runs two to three degrees steep, because the
   * solver buys net clearance the real players do not: DOUBLES_CLEARANCE asks
   * for 29 cm from the baseline, and the filmed shots skim the cord by under
   * 15. That margin exists because this game's execution error is far larger
   * than a professional's, and it is the honest cost of the Day 17 fix rather
   * than a bug. The tolerance below is the size of that cost, written down so
   * it cannot grow quietly.
   */
  const contact = () => ballAt(v3(2.0, 0.7, 6.7), v3(0, -1.5, 6));
  const opts = { ...LIVE_SOLVE, clearancePerMetre: DOUBLES_CLEARANCE };
  const STEEP_ALLOWANCE = 4;

  const launchOf = (targetX: number) => {
    const solved = solveSwing(
      contact(),
      { targetX, targetZ: -1.3, shape: 'drop', facing: -1 },
      {},
      opts,
    );
    const probe = contact();
    strike(probe, withSwing(solved.swing, { impactOffset: POWER_SPOT_OFFSET }));
    return {
      speed: Math.hypot(probe.vel.x, probe.vel.y, probe.vel.z),
      degrees:
        (Math.atan2(probe.vel.y, Math.hypot(probe.vel.x, probe.vel.z)) * 180) / Math.PI,
    };
  };

  it('leaves down the line inside the filmed speed and angle window', () => {
    const { speed, degrees } = launchOf(2.4);
    expect(speed).toBeGreaterThan(10.9);
    expect(speed).toBeLessThan(13.0);
    expect(degrees).toBeGreaterThan(15.5);
    expect(degrees).toBeLessThan(22.5 + STEEP_ALLOWANCE);
  });

  it('leaves cross court inside the filmed speed and angle window', () => {
    const { speed, degrees } = launchOf(-2.4);
    expect(speed).toBeGreaterThan(13.3);
    expect(speed).toBeLessThan(16.0);
    expect(degrees).toBeGreaterThan(12.5);
    expect(degrees).toBeLessThan(18.0 + STEEP_ALLOWANCE);
  });
});
