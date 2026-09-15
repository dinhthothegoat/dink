import { describe, expect, it } from 'vitest';
import * as C from '../src/sim/constants';
import {
  accelerationOf,
  createBall,
  integrate,
  resolveImpact,
  RPM,
  spinVector,
  topspinRpmOf,
} from '../src/sim/ball';
import { v3, length } from '../src/sim/vec3';

describe('constants', () => {
  it('matches the published court dimensions in feet', () => {
    expect(C.COURT_HALF_WIDTH * 2 / 0.3048).toBeCloseTo(20, 6);
    expect(C.COURT_HALF_LENGTH * 2 / 0.3048).toBeCloseTo(44, 6);
    expect(C.KITCHEN_DEPTH / 0.3048).toBeCloseTo(7, 6);
  });

  it('keeps the ball inside the USA Pickleball equipment spec', () => {
    // 0.78-0.935 oz, 2.874-2.972 in.
    expect(C.BALL_MASS).toBeGreaterThanOrEqual(0.78 * 0.0283495);
    expect(C.BALL_MASS).toBeLessThanOrEqual(0.935 * 0.0283495);
    expect(C.BALL_RADIUS * 2 / 0.0254).toBeGreaterThanOrEqual(2.874);
    expect(C.BALL_RADIUS * 2 / 0.0254).toBeLessThanOrEqual(2.972);
  });

  it('holds the aerodynamic coefficients at their measured values (DINK-14)', () => {
    // Published figures are Cd = 0.30 +/- 0.02 and Cl = 0.195*S, both fitted
    // at an air density of 1.29. We simulate at 1.225, so the coefficients
    // carry a 1.29/1.225 scaling and it is the FORCE that must match, not the
    // bare number. This test guards the scaling, because someone reading
    // 0.316 next to a paper saying 0.30 will eventually "fix" it.
    const scale = 1.29 / C.AIR_DENSITY;
    expect(C.DRAG_COEF / scale).toBeCloseTo(0.30, 2);
    expect(C.LIFT_SLOPE / scale).toBeCloseTo(0.195, 3);
    // The lift cap must sit at the top of the measured spin range, not below
    // it, or ordinary shots would be clipped.
    const maxS = (C.BALL_RADIUS * ((C.MAX_SPIN_RPM * 2 * Math.PI) / 60)) / 15;
    expect(C.LIFT_COEF_MAX).toBeGreaterThanOrEqual(C.LIFT_SLOPE * maxS * 0.6);
  });

  it('derives restitution from the USA Pickleball drop test', () => {
    // 78 in drop, 32 in rebound => height ratio 0.41, e = sqrt(ratio).
    const dropH = 78 * 0.0254;
    const v = Math.sqrt(2 * C.GRAVITY * dropH);
    const rebound = (C.COURT_RESTITUTION * v) ** 2 / (2 * C.GRAVITY);
    expect(rebound / 0.0254).toBeGreaterThan(30);
    expect(rebound / 0.0254).toBeLessThan(34);
  });
});

describe('aerodynamics', () => {
  it('is pure gravity when the ball is at rest', () => {
    const a = accelerationOf(v3(), v3(0, 0, 0), v3(0, 0, 0));
    expect(a.y).toBeCloseTo(-C.GRAVITY, 9);
    expect(a.x).toBeCloseTo(0, 9);
  });

  it('drags a fast ball harder than a slow one, quadratically', () => {
    const slow = accelerationOf(v3(), v3(0, 0, -5), v3());
    const fast = accelerationOf(v3(), v3(0, 0, -10), v3());
    // Drag on the z axis only; ratio of the drag terms should be ~4.
    expect(fast.z / slow.z).toBeGreaterThan(3.5);
    expect(fast.z / slow.z).toBeLessThan(4.5);
  });

  it('makes topspin push the ball down and backspin hold it up', () => {
    const vel = v3(0, 0, -15);
    const top = accelerationOf(v3(), vel, spinVector(1500, 0));
    const back = accelerationOf(v3(), vel, spinVector(-1500, 0));
    expect(top.y).toBeLessThan(-C.GRAVITY);
    expect(back.y).toBeGreaterThan(-C.GRAVITY);
  });

  it('caps the lift coefficient instead of running away at huge spin', () => {
    const vel = v3(0, 0, -6);
    const a = accelerationOf(v3(), vel, spinVector(6000, 0));
    // Even at an impossible spin rate, Magnus stays bounded.
    expect(Math.abs(a.y + C.GRAVITY)).toBeLessThan(30);
  });

  it('saturates backspin early and lets topspin keep climbing (DINK-31)', () => {
    // The asymmetry, asserted as SHAPE rather than magnitude, because the two
    // published fits disagree threefold on the magnitude and this project does
    // not get to pick a winner. See BACKSPIN_SATURATION_S.
    //
    // A gentle slice floats almost as much as a savage one; a gentle topspin
    // ball dives nowhere near as much as a savage one. That is the claim, and
    // it is the one thing both studies agree on.
    const vel = v3(0, 0, -15);
    const lift = (rpm: number) =>
      Math.abs(accelerationOf(v3(), vel, spinVector(rpm, 0)).y + C.GRAVITY);

    const backGentle = lift(-400);
    const backHard = lift(-1500);
    const topGentle = lift(400);
    const topHard = lift(1500);

    expect(backGentle / backHard).toBeGreaterThan(0.5);
    expect(topGentle / topHard).toBeLessThan(0.5);
    // And the saturation must never buy backspin MORE lift than the
    // conservative linear fit sanctions anywhere. This is the guard on not
    // having quietly adopted the larger of the two disagreeing studies.
    const ceiling = 0.5 * C.AIR_DENSITY * C.BALL_AREA * C.LIFT_COEF_MAX;
    expect(backHard).toBeLessThanOrEqual((ceiling * 15 * 15) / C.BALL_MASS + 1e-9);
  });
});

describe('flight', () => {
  it('reproduces the drop test to within a centimetre', () => {
    // Drop from 78 in with no spin; check the speed at contact matches
    // free fall closely (drag over 2 m is small but not zero).
    const ball = createBall();
    ball.pos = v3(0, 78 * 0.0254, 0);
    ball.vel = v3(0, 0, 0);
    ball.spin = v3(0, 0, 0);
    while (ball.pos.y > C.BALL_RADIUS) integrate(ball, C.SIM_DT);
    const ideal = Math.sqrt(2 * C.GRAVITY * (78 * 0.0254 - C.BALL_RADIUS));
    expect(Math.abs(ball.vel.y)).toBeLessThan(ideal);
    expect(Math.abs(ball.vel.y)).toBeGreaterThan(ideal * 0.94);
  });

  it('is deterministic: identical launches give identical trajectories', () => {
    const run = () => {
      const b = createBall();
      b.pos = v3(0, 0.9, 6);
      b.vel = v3(0.4, 3, -16);
      b.spin = spinVector(1200, 200);
      for (let i = 0; i < 400; i++) integrate(b, C.SIM_DT);
      return b.pos;
    };
    const a = run();
    const b = run();
    expect(a.x).toBe(b.x);
    expect(a.y).toBe(b.y);
    expect(a.z).toBe(b.z);
  });

  it('bleeds spin off during flight', () => {
    const b = createBall();
    b.vel = v3(0, 0, -12);
    b.spin = spinVector(2000, 0);
    const before = length(b.spin);
    for (let i = 0; i < C.SIM_HZ; i++) integrate(b, C.SIM_DT);
    expect(length(b.spin)).toBeLessThan(before);
    expect(length(b.spin)).toBeGreaterThan(before * 0.5);
  });

  it('bleeds spin per metre travelled, not per second (DINK-32)', () => {
    // dw/dt = -(U/L) * w, so the decay constant is a DISTANCE. The test is the
    // direct consequence: three balls launched at 6, 12 and 18 m/s must arrive
    // at the six metre mark having lost the SAME fraction of their spin, while
    // at the six-tenths-of-a-second mark they must not.
    //
    // Launched from high up so the flight is not cut short by the court, and
    // spin decay is measured against path length rather than z so that the
    // gravity drop counts too.
    const launch = (speed: number) => ({
      pos: v3(0, 50, 0),
      vel: v3(0, 0, -speed),
      spin: spinVector(1200, 0),
      resting: false,
    });

    const overDistance = (speed: number, metres: number) => {
      const b = launch(speed);
      const s0 = length(b.spin);
      let travelled = 0;
      while (travelled < metres) {
        const { x, y, z } = b.pos;
        integrate(b, C.SIM_DT);
        travelled += Math.hypot(b.pos.x - x, b.pos.y - y, b.pos.z - z);
      }
      return length(b.spin) / s0;
    };

    const overTime = (speed: number, seconds: number) => {
      const b = launch(speed);
      const s0 = length(b.spin);
      for (let i = 0; i < seconds * C.SIM_HZ; i++) integrate(b, C.SIM_DT);
      return length(b.spin) / s0;
    };

    const slow = overDistance(6, 6);
    const fast = overDistance(18, 6);
    expect(Math.abs(slow - fast)).toBeLessThan(0.01);

    // Same three balls, same clock: now they must differ, and in the right
    // direction. Without this half, a decay of zero would pass the test above.
    expect(overTime(18, 0.6)).toBeLessThan(overTime(6, 0.6) - 0.05);
  });
});

describe('bounce', () => {
  const UP = v3(0, 1, 0);

  it('returns the expected fraction of vertical speed', () => {
    const b = createBall();
    b.pos = v3(0, C.BALL_RADIUS, 0);
    b.vel = v3(0, -6, 0);
    resolveImpact(b, UP, C.COURT_RESTITUTION, C.COURT_FRICTION);
    expect(b.vel.y).toBeCloseTo(6 * C.COURT_RESTITUTION, 6);
  });

  it('never lets a backspin ball come off faster than a plain one', () => {
    // Worth being precise about, because the naive expectation is wrong.
    // A hard backspin ball slides through the whole contact, so the friction
    // impulse saturates at Coulomb's limit and the rebound speed matches the
    // plain ball exactly. The check a slice produces on court comes from the
    // spin it keeps, not from the first bounce eating extra speed.
    const plain = createBall();
    plain.vel = v3(0, -5, -14);
    resolveImpact(plain, UP, C.COURT_RESTITUTION, C.COURT_FRICTION);

    const back = createBall();
    back.vel = v3(0, -5, -14);
    back.spin = spinVector(-1800, 0);
    resolveImpact(back, UP, C.COURT_RESTITUTION, C.COURT_FRICTION);

    expect(back.vel.z).toBeGreaterThanOrEqual(plain.vel.z);
    expect(topspinRpmOf(back.spin)).toBeLessThan(topspinRpmOf(plain.spin));
  });

  it('lets a topspin ball grip instead of sliding, so it keeps more speed', () => {
    // The mirror image of the case above: topspin reduces slip at the contact
    // patch, the impulse needed to stop the slip drops below Coulomb's limit,
    // and the ball therefore loses less forward speed.
    const plain = createBall();
    plain.vel = v3(0, -5, -14);
    const plainR = resolveImpact(plain, UP, C.COURT_RESTITUTION, C.COURT_FRICTION);

    const top = createBall();
    top.vel = v3(0, -5, -14);
    top.spin = spinVector(2200, 0);
    const topR = resolveImpact(top, UP, C.COURT_RESTITUTION, C.COURT_FRICTION);

    expect(plainR.slid).toBe(true);
    expect(topR.slid).toBe(false);
    expect(top.vel.z).toBeLessThan(plain.vel.z);
  });

  it('generates topspin from a plain driven ball', () => {
    const b = createBall();
    b.vel = v3(0, -5, -14);
    resolveImpact(b, UP, C.COURT_RESTITUTION, C.COURT_FRICTION);
    // Friction at the contact patch always rolls the ball forward.
    expect(topspinRpmOf(b.spin)).toBeGreaterThan(0);
  });

  it('never adds energy', () => {
    const b = createBall();
    b.vel = v3(2, -8, -14);
    b.spin = v3(1200 * RPM, 400 * RPM, 100 * RPM); // arbitrary, not a game shot
    const I = C.BALL_INERTIA_COEF * C.BALL_MASS * C.BALL_RADIUS ** 2;
    const kBefore =
      0.5 * C.BALL_MASS * (b.vel.x ** 2 + b.vel.y ** 2 + b.vel.z ** 2) +
      0.5 * I * (b.spin.x ** 2 + b.spin.y ** 2 + b.spin.z ** 2);
    resolveImpact(b, UP, C.COURT_RESTITUTION, C.COURT_FRICTION);
    const kAfter =
      0.5 * C.BALL_MASS * (b.vel.x ** 2 + b.vel.y ** 2 + b.vel.z ** 2) +
      0.5 * I * (b.spin.x ** 2 + b.spin.y ** 2 + b.spin.z ** 2);
    expect(kAfter).toBeLessThanOrEqual(kBefore + 1e-9);
  });
});

describe('against filmed pickleball', () => {
  /**
   * The closest thing this project has to a wind tunnel.
   *
   * Every other test here checks the flight model against ITSELF: the
   * coefficients go in, the same coefficients come out. This one takes six
   * launch conditions measured off film of real players hitting real third shot
   * drops (arXiv 2501.00163, "Executing a Successful Third Shot Drop in
   * Pickleball") and asks our integrator where those balls land. Nothing in the
   * model was fitted to them.
   *
   * If drag is wrong, this fails. That is the entire point of it, and it is
   * worth more than the six tests above put together.
   *
   *   down the line  10.9-13.0 m/s at 15.5-22.5 deg
   *   cross court    13.3-16.0 m/s at 12.5-18.0 deg
   */
  const KITCHEN_LINE = -C.KITCHEN_DEPTH;

  /** Launch from the near baseline at waist height, aimed at a kitchen target. */
  const fly = (speed: number, degrees: number, aimX: number) => {
    const theta = (degrees * Math.PI) / 180;
    const x0 = 2.0;
    const z0 = 6.7;
    const dx = aimX - x0;
    const dz = -1.3 - z0;
    const len = Math.hypot(dx, dz);
    const horizontal = speed * Math.cos(theta);
    const ball = {
      pos: v3(x0, 0.7, z0),
      vel: v3((horizontal * dx) / len, speed * Math.sin(theta), (horizontal * dz) / len),
      spin: v3(0, 0, 0),
      resting: false,
    };
    let netY: number | null = null;
    for (let i = 0; i < 3000; i++) {
      const priorZ = ball.pos.z;
      const priorY = ball.pos.y;
      integrate(ball, C.SIM_DT);
      if (priorZ > 0 && ball.pos.z <= 0) netY = ball.pos.y;
      if (ball.pos.y <= 0 && priorY > 0) return { landing: ball.pos.z, netY };
    }
    throw new Error('ball never landed');
  };

  const WINDOW: [string, number, number, number][] = [
    ['down the line, slow and steep', 10.9, 22.5, 2.4],
    ['down the line, fast and flat', 13.0, 15.5, 2.4],
    ['down the line, middle', 11.9, 19.0, 2.4],
    ['cross court, slow and steep', 13.3, 18.0, -2.4],
    ['cross court, fast and flat', 16.0, 12.5, -2.4],
    ['cross court, middle', 14.6, 15.2, -2.4],
  ];

  it.each(WINDOW)('lands %s as a drop, not a drive', (_label, speed, degrees, aimX) => {
    const { landing, netY } = fly(speed, degrees, aimX);
    expect(netY).not.toBeNull();
    const clearance = (netY as number) - C.NET_HEIGHT_CENTER;

    // A real third shot drop skims the cord. Anything clearing it by a third of
    // a metre is a different shot with the same name.
    expect(clearance).toBeGreaterThan(-0.05);
    expect(clearance).toBeLessThan(0.2);

    // And it lands in the kitchen, or close enough behind it to still be a
    // drop rather than a drive to the baseline.
    expect(landing).toBeLessThan(0);
    expect(landing).toBeGreaterThan(KITCHEN_LINE - 0.8);
  });
});
