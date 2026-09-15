import { describe, expect, it } from 'vitest';
import * as C from '../src/sim/constants';
import { emptyInput } from '../src/sim/input';
import { chooseShot, createOpponent, driveOpponent, zoneOf } from '../src/sim/opponent';
import { createPlayer } from '../src/sim/player';
import { createRng } from '../src/sim/rng';
import { createMatch } from '../src/sim/rules';
import { LIVE_SOLVE, ballAt, solveSwing } from '../src/sim/solver';
import { v3 } from '../src/sim/vec3';
import { createWorld, launch } from '../src/sim/world';

const at = (x: number, y: number, z: number) => v3(x, y, z);

describe('zones', () => {
  it('reads the same depth from either end of the court', () => {
    expect(zoneOf(2.5)).toBe('net');
    expect(zoneOf(-2.5)).toBe('net');
    expect(zoneOf(4.0)).toBe('transition');
    expect(zoneOf(-4.0)).toBe('transition');
    expect(zoneOf(6.0)).toBe('back');
    expect(zoneOf(-6.0)).toBe('back');
  });
});

describe('shot choice', () => {
  const base = { otherX: 1.5, strain: 0.1, facing: -1 as const };

  it('drives from the back, because a drop from there goes out', () => {
    // The rule Day 5 paid for: the textbook third-shot drop is a function of
    // where your feet are, not of the shot count.
    expect(chooseShot({ ...base, contact: at(0, 0.8, 6.2) }).shape).toBe('drive');
    expect(chooseShot({ ...base, contact: at(0, 0.8, 4.9) }).shape).toBe('drive');
  });

  it('drops from inside the court and takes ground for it', () => {
    const choice = chooseShot({ ...base, contact: at(0, 0.7, 4.0) });
    expect(choice.shape).toBe('drop');
    expect(choice.step).toBeGreaterThan(0);
  });

  it('takes ground one step at a time, never the whole court', () => {
    // Advancing as a boolean lost 0-11: it ran to the rail off every drop and
    // the next deep ball went past it.
    const choice = chooseShot({ ...base, contact: at(0, 0.7, 4.0) });
    expect(choice.step).toBeLessThan(C.COURT_HALF_LENGTH - C.KITCHEN_DEPTH);
  });

  it('attacks a high ball and dinks a low one at the rail', () => {
    expect(chooseShot({ ...base, contact: at(0, 1.2, 2.6) }).shape).toBe('drive');
    expect(chooseShot({ ...base, contact: at(0, 0.6, 2.6) }).shape).toBe('drop');
  });

  it('gives ground and resets when stretched', () => {
    const choice = chooseShot({ ...base, strain: 0.9, contact: at(0, 0.8, 3.0) });
    expect(choice.shape).toBe('lob');
    expect(choice.step).toBeLessThan(0);
  });

  it('always aims away from the other player, from either end', () => {
    // Day 5's measurement: spread is what makes a ball hard to reach, so this
    // is the whole of the offence. Both signs, because half of it passing is
    // how the three sign bugs before this one got through.
    for (const contact of [at(0, 0.8, 4.0), at(0, 0.8, -4.0)]) {
      expect(chooseShot({ ...base, otherX: 2.0, contact }).aim).toBeLessThan(0);
      expect(chooseShot({ ...base, otherX: -2.0, contact }).aim).toBeGreaterThan(0);
    }
  });
});

describe('the brain is the same at both ends', () => {
  /**
   * Turn the whole court through half a turn and the same player must make the
   * same decision. This is the test that would have caught the solver's yaw
   * sign: nothing about a single shot looked wrong, but one end of the court
   * won eleven games out of twelve against an identical opponent.
   */
  const decide = (
    side: 'near' | 'far',
    ball: [number, number, number],
    vel: [number, number, number],
    spin: [number, number, number],
    self: [number, number],
    other: [number, number],
  ) => {
    const world = createWorld();
    launch(world, v3(...ball), v3(...vel), v3(...spin));
    const match = createMatch('near');
    match.phase = 'inPlay';
    match.hitsThisRally = 5;
    match.bouncesSinceHit = 1;
    const me = createPlayer(side);
    me.pos.x = self[0];
    me.pos.z = self[1];
    const them = createPlayer(side === 'near' ? 'far' : 'near');
    them.pos.x = other[0];
    them.pos.z = other[1];
    const opp = createOpponent(side, createRng(1));
    opp.skill = { level: 0, reaction: 0, anticipation: 0 };
    opp.reactedTo = 5;
    const out = emptyInput();
    driveOpponent(opp, world, match, me, them, out);
    return out;
  };

  const cases: Array<{
    ball: [number, number, number];
    vel: [number, number, number];
    spin: [number, number, number];
    self: [number, number];
    other: [number, number];
  }> = [
    { ball: [0.6, 0.7, 3.4], vel: [1, -1, 6], spin: [-30, 0, 0], self: [0.2, 4.4], other: [-1.4, -4.0] },
    { ball: [-1.1, 1.1, 1.9], vel: [-2, 1, 4], spin: [20, 0, 0], self: [-0.8, 2.6], other: [1.9, -3.0] },
    { ball: [1.8, 0.5, 5.6], vel: [0, -3, 9], spin: [0, 0, 0], self: [1.2, 6.0], other: [0.4, -6.1] },
  ];

  it.each(cases)('decides identically under a half turn of the court', (c) => {
    const a = decide('near', c.ball, c.vel, c.spin, c.self, c.other);
    // A half turn about the vertical: x and z both flip, and spin, being an
    // axial vector, flips its x and z and keeps its y.
    const b = decide(
      'far',
      [-c.ball[0], c.ball[1], -c.ball[2]],
      [-c.vel[0], c.vel[1], -c.vel[2]],
      [-c.spin[0], c.spin[1], -c.spin[2]],
      [-c.self[0], -c.self[1]],
      [-c.other[0], -c.other[1]],
    );
    expect(b.moveX).toBeCloseTo(-a.moveX, 9);
    expect(b.moveZ).toBeCloseTo(-a.moveZ, 9);
    expect(b.swing).toBe(a.swing);
    expect(b.shape).toBe(a.shape);
    expect(b.aimX).toBeCloseTo(-a.aimX, 9);
    expect(b.aimZ).toBeCloseTo(a.aimZ, 9);
  });
});

describe('the solver is the same at both ends', () => {
  /**
   * The bug this pins: the initial yaw guess was multiplied by `facing`, but
   * `faceNormal` applies `facing` to the z component alone. So the far
   * player's face started turned the wrong way across the court on every shot.
   * The refinement loop closed the lateral error anyway, which is why every
   * individual shot still landed near its target and nothing looked broken.
   */
  it.each([
    [1.8, -4.5],
    [-2.2, -3.0],
    [0.9, -5.5],
  ])('solves a mirrored shot to a mirrored place (target x=%s)', (targetX, targetZ) => {
    const near = solveSwing(
      ballAt(v3(0.3, 0.9, 4.2)),
      { targetX, targetZ, shape: 'drive', facing: -1 },
      {},
      LIVE_SOLVE,
    );
    const far = solveSwing(
      ballAt(v3(-0.3, 0.9, -4.2)),
      { targetX: -targetX, targetZ: -targetZ, shape: 'drive', facing: 1 },
      {},
      LIVE_SOLVE,
    );
    expect(near.swing.yaw).toBeCloseTo(-far.swing.yaw, 6);
    expect(near.outcome.landing).not.toBeNull();
    expect(far.outcome.landing).not.toBeNull();
    if (near.outcome.landing && far.outcome.landing) {
      expect(near.outcome.landing.x).toBeCloseTo(-far.outcome.landing.x, 3);
      expect(near.outcome.landing.z).toBeCloseTo(-far.outcome.landing.z, 3);
    }
  });
});
