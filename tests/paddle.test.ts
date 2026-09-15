import { describe, expect, it } from 'vitest';
import * as C from '../src/sim/constants';
import { createBall } from '../src/sim/ball';
import {
  POWER_SPOT_OFFSET,
  defaultSwing,
  effectiveMassAt,
  strike,
  withSwing,
} from '../src/sim/paddle';
import { isInKitchen } from '../src/sim/court';
import { ballAt, solveSwing } from '../src/sim/solver';
import { v3 } from '../src/sim/vec3';

/** An incoming ball travelling toward the near player at a typical rally speed. */
const incoming = (speed = 8, drop = 0) => {
  const b = createBall();
  b.pos = v3(0, 0.8, 4);
  b.vel = v3(0, drop, speed);
  b.spin = v3(0, 0, 0);
  return b;
};

const hit = (patch: Partial<ReturnType<typeof defaultSwing>>, ball = incoming()) => {
  const result = strike(ball, withSwing(defaultSwing(), patch));
  return { ball, result };
};

describe('paddle model', () => {
  it('balances where the spec says it does', () => {
    // The handle-plus-face decomposition is only trustworthy if it reproduces
    // the published balance point; otherwise the derived inertia is fiction.
    expect(C.PADDLE_MODEL_BALANCE).toBeCloseTo(C.PADDLE_BALANCE, 3);
  });

  it('stays inside the USA Pickleball paddle limits', () => {
    expect(C.PADDLE_LENGTH / 0.0254).toBeLessThanOrEqual(17);
    expect((C.PADDLE_LENGTH + C.PADDLE_FACE_WIDTH) / 0.0254).toBeLessThanOrEqual(24);
    expect(C.PADDLE_COR).toBeLessThanOrEqual(0.43);
  });

  it('puts peak effective mass over the centre of mass', () => {
    expect(effectiveMassAt(0)).toBeCloseTo(C.PADDLE_MASS, 6);
    expect(effectiveMassAt(0.05)).toBeLessThan(C.PADDLE_MASS);
    expect(effectiveMassAt(-0.05)).toBeLessThan(C.PADDLE_MASS);
  });

  it('places the power spot below the centre of the face', () => {
    // Which is exactly where coaches tell people to hit. Negative offset
    // means toward the throat.
    expect(POWER_SPOT_OFFSET).toBeLessThan(0);
  });
});

describe('contact', () => {
  it('sends the ball back down the court', () => {
    const { ball } = hit({});
    expect(ball.vel.z).toBeLessThan(0);
  });

  it('hits harder the faster the paddle moves', () => {
    const slow = hit({ speed: 8 }).result.exitSpeed;
    const fast = hit({ speed: 18 }).result.exitSpeed;
    expect(fast).toBeGreaterThan(slow);
  });

  it('produces a rally speed a pickleball player would recognise', () => {
    // A 14 m/s swing onto an 8 m/s incoming ball should come off in the
    // 40-55 mph band that drives actually live in.
    const mph = hit({ speed: 14, pitch: 8, pathAngle: 8 }).result.exitSpeed * 2.23694;
    expect(mph).toBeGreaterThan(38);
    expect(mph).toBeLessThan(58);
  });

  it('loses real speed on a tip hit', () => {
    const middle = hit({ impactOffset: POWER_SPOT_OFFSET }).result;
    const tip = hit({ impactOffset: C.PADDLE_FACE_LENGTH / 2 }).result;
    expect(tip.effectiveMass).toBeLessThan(middle.effectiveMass * 0.4);
    expect(tip.exitSpeed).toBeLessThan(middle.exitSpeed * 0.85);
    expect(tip.offCentre).toBeGreaterThan(middle.offCentre);
  });

  it('creates topspin by brushing up and backspin by cutting down', () => {
    // Spin is not a dial: it is the angle between where the face points and
    // where the paddle is going.
    const flat = hit({ pitch: 8, pathAngle: 8 }).result.topspinRpm;
    const brushed = hit({ pitch: 8, pathAngle: 34 }).result.topspinRpm;
    const cut = hit({ pitch: 18, pathAngle: -6 }).result.topspinRpm;
    expect(brushed).toBeGreaterThan(flat);
    expect(brushed).toBeGreaterThan(300);
    expect(cut).toBeLessThan(flat);
    expect(cut).toBeLessThan(-300);
  });

  it('never exceeds the spin a paddle can actually produce', () => {
    const wild = hit({ speed: 24, pitch: 35, pathAngle: -30 }).ball;
    const rpm = Math.hypot(wild.spin.x, wild.spin.y, wild.spin.z) / ((2 * Math.PI) / 60);
    expect(rpm).toBeLessThanOrEqual(C.MAX_SPIN_RPM + 1e-6);
  });

  it('reports a whiff instead of inventing a shot', () => {
    // The ball is already leaving down-court faster than the paddle follows
    // it, so the face never closes on the ball and there is no contact.
    const ball = createBall();
    ball.pos = v3(0, 0.8, 4);
    ball.vel = v3(0, 0, -8);
    const before = ball.vel.z;
    const result = strike(ball, withSwing(defaultSwing(), { speed: 5 }));
    expect(result.topspinRpm).toBe(0);
    expect(ball.vel.z).toBe(before);
  });

  it('cannot give the ball more energy than the swing carries', () => {
    // A sanity bound rather than a strict conservation law: the paddle is
    // driven, so it does add energy, but never more than a perfectly elastic
    // collision at that swing speed would.
    const swingSpeed = 16;
    const ball = incoming(8);
    const inSpeed = 8;
    const { exitSpeed } = strike(ball, withSwing(defaultSwing(), { speed: swingSpeed }));
    expect(exitSpeed).toBeLessThan(2 * swingSpeed + inSpeed);
  });
});

describe('shot solver', () => {
  it('drives to a deep target', () => {
    const b = ballAt(v3(0, 0.8, 5.8), v3(0, 0, 6));
    const s = solveSwing(b, { targetX: 0, targetZ: -5.5, shape: 'drive', facing: -1 });
    expect(s.found).toBe(true);
    expect(s.outcome.landing?.z).toBeCloseTo(-5.5, 0);
    expect(s.outcome.netted).toBe(false);
    expect(s.outcome.apex).toBeLessThan(1.9);
  });

  it('drops a third shot into the far kitchen', () => {
    const b = ballAt(v3(0, 0.7, 6.2), v3(0, -2, 5));
    const s = solveSwing(b, { targetX: 0, targetZ: -1.2, shape: 'drop', facing: -1 });
    expect(s.found).toBe(true);
    expect(s.outcome.landing).not.toBeNull();
    if (s.outcome.landing) expect(isInKitchen(s.outcome.landing)).toBe(true);
  });

  it.each([
    ['down the line', 2.4, -1.3],
    ['cross court', -2.4, -1.5],
    ['at the middle', 0.0, -1.4],
  ])('drops %s into the kitchen from the same contact point', (_label, targetX, targetZ) => {
    // The three third-shot drops are one motion aimed three ways, so they are
    // solved from an identical contact: right side of the baseline, ball
    // falling, just after the return.
    const b = ballAt(v3(2.0, 0.7, 6.2), v3(0, -1.5, 6));
    const s = solveSwing(b, { targetX, targetZ, shape: 'drop', facing: -1 });
    expect(s.found).toBe(true);
    expect(s.outcome.netted).toBe(false);
    expect(s.outcome.landing).not.toBeNull();
    if (s.outcome.landing) {
      expect(isInKitchen(s.outcome.landing)).toBe(true);
      expect(s.outcome.landing.x).toBeCloseTo(targetX, 0);
    }
    // A drop that arrives fast is a drive that got lucky. It has to be
    // dropping, not driving, by the time it crosses the net.
    expect(s.swing.speed).toBeLessThan(9);
  });

  it('mirrors a drop solved from the other side of the court', () => {
    // Nothing in the model should prefer a handedness.
    const right = solveSwing(ballAt(v3(2.0, 0.7, 6.2), v3(0, -1.5, 6)), {
      targetX: -2.4,
      targetZ: -1.5,
      shape: 'drop',
      facing: -1,
    });
    const left = solveSwing(ballAt(v3(-2.0, 0.7, 6.2), v3(0, -1.5, 6)), {
      targetX: 2.4,
      targetZ: -1.5,
      shape: 'drop',
      facing: -1,
    });
    expect(left.swing.speed).toBeCloseTo(right.swing.speed, 5);
    expect(left.swing.yaw).toBeCloseTo(-right.swing.yaw, 5);
  });

  it('lobs high enough to be a lob', () => {
    const b = ballAt(v3(0, 0.7, 2.4), v3(0, -1, 4));
    const s = solveSwing(b, { targetX: 0, targetZ: -5.9, shape: 'lob', facing: -1 });
    expect(s.found).toBe(true);
    expect(s.outcome.apex).toBeGreaterThan(3);
    expect(s.outcome.clearance).toBeGreaterThan(0.5);
  });

  it('aims across court, correcting for the way spin bends the ball', () => {
    const b = ballAt(v3(-1.6, 0.8, 5.8), v3(0, 0, 6));
    const s = solveSwing(b, { targetX: 2.0, targetZ: -5.2, shape: 'drive', facing: -1 });
    expect(s.found).toBe(true);
    expect(s.outcome.landing?.x).toBeCloseTo(2.0, 0);
    expect(s.swing.yaw).toBeGreaterThan(0);
  });

  it('solves fast enough to run inside a frame', () => {
    // The opponent will call this every time it decides on a shot, so it has
    // to cost well under a 120 Hz tick's worth of budget.
    const b = ballAt(v3(0.4, 0.8, 5.0), v3(0, -1, 6));
    const t0 = performance.now();
    solveSwing(b, { targetX: -2.0, targetZ: -5.0, shape: 'drive', facing: -1 });
    expect(performance.now() - t0).toBeLessThan(120);
  });
});
