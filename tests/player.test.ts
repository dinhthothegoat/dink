import { describe, expect, it } from 'vitest';
import * as C from '../src/sim/constants';
import { createBall } from '../src/sim/ball';
import { isInBounds, isInKitchen } from '../src/sim/court';
import { InputBuffer, emptyInput } from '../src/sim/input';
import { PlayerState, SWING_QUEUE_WINDOW, createPlayer, emptyReach, inKitchen, interpolatedPlayer, isContactTick, reachTo, stepPlayer, strainToImpactOffset } from '../src/sim/player';
import { POWER_SPOT_OFFSET } from '../src/sim/paddle';
import { createSession, stepSession } from '../src/sim/session';
import { ballAt, solveSwing } from '../src/sim/solver';
import { predictBall } from '../src/sim/world';
import { advance } from '../src/core/loop';
import { v3 } from '../src/sim/vec3';

const run = (ticks: number, mutate: (t: number) => Partial<ReturnType<typeof emptyInput>>) => {
  const player = createPlayer('near');
  const input = emptyInput();
  for (let i = 0; i < ticks; i++) {
    Object.assign(input, emptyInput(), mutate(i));
    stepPlayer(player, input, C.SIM_DT);
  }
  return player;
};

describe('player movement', () => {
  it('accelerates rather than snapping to top speed', () => {
    const oneTick = run(1, () => ({ moveX: 1 }));
    expect(Math.abs(oneTick.vel.x)).toBeLessThan(C.PLAYER_MAX_SPEED);
    expect(Math.abs(oneTick.vel.x)).toBeGreaterThan(0);
  });

  it('reaches top speed and stops there', () => {
    const player = run(C.SIM_HZ, () => ({ moveX: 1 }));
    expect(player.vel.x).toBeCloseTo(C.PLAYER_MAX_SPEED, 3);
  });

  it('does not let diagonal movement be faster than straight movement', () => {
    // The classic bug. Holding two directions must not be a speed boost.
    const straight = run(C.SIM_HZ, () => ({ moveX: 1 }));
    const diagonal = run(C.SIM_HZ, () => ({ moveX: 1, moveZ: 1 }));
    const straightSpeed = Math.hypot(straight.vel.x, straight.vel.z);
    const diagonalSpeed = Math.hypot(diagonal.vel.x, diagonal.vel.z);
    expect(diagonalSpeed).toBeCloseTo(straightSpeed, 3);
  });

  it('crosses the court in a plausible time', () => {
    // Sideline to sideline is 6.1 m. If this ever takes under a second the
    // court has stopped mattering; over three and the game is a slog.
    const player = createPlayer('near');
    player.pos.x = -C.COURT_HALF_WIDTH;
    const input = { ...emptyInput(), moveX: 1 };
    let ticks = 0;
    while (player.pos.x < C.COURT_HALF_WIDTH && ticks < 10 * C.SIM_HZ) {
      stepPlayer(player, input, C.SIM_DT);
      ticks += 1;
    }
    const seconds = ticks * C.SIM_DT;
    expect(seconds).toBeGreaterThan(1.0);
    expect(seconds).toBeLessThan(3.0);
  });

  it('brakes harder than it accelerates', () => {
    const player = createPlayer('near');
    const go = { ...emptyInput(), moveX: 1 };
    for (let i = 0; i < C.SIM_HZ; i++) stepPlayer(player, go, C.SIM_DT);
    const moving = player.vel.x;
    const stop = emptyInput();
    let ticks = 0;
    while (Math.abs(player.vel.x) > 0.01 && ticks < C.SIM_HZ) {
      stepPlayer(player, stop, C.SIM_DT);
      ticks += 1;
    }
    expect(ticks * C.SIM_DT).toBeLessThan(moving / C.PLAYER_ACCEL);
  });

  it('keeps the near player on their own side of the net', () => {
    const player = run(3 * C.SIM_HZ, () => ({ moveZ: -1 }));
    expect(player.pos.z).toBeGreaterThanOrEqual(C.PLAYER_RADIUS - 1e-9);
  });
});

describe('the non-volley zone', () => {
  /**
   * This block used to assert the opposite. It pinned a physical rail that
   * stopped a player entering the kitchen at all, and it was right to, until
   * Day 12 measured what the rail cost: it held a player 2.41 m from the net
   * against a 1.15 m reach, so 59 per cent of the kitchen could not be reached
   * by anybody. There was no dink rally, only dink winners.
   *
   * The zone is a rule again. Walking in is legal and necessary; what you may
   * not do is volley from in there, which `tests/rules.test.ts` covers. What
   * belongs here is that the movement model no longer stops you.
   */
  it('lets a player walk right up to the net', () => {
    const player = run(4 * C.SIM_HZ, () => ({ moveZ: -1 }));
    expect(player.pos.z).toBeCloseTo(C.PLAYER_RADIUS, 6);
    expect(isInKitchen(v3(player.pos.x, 0, player.pos.z))).toBe(true);
  });

  it('knows when a player is standing in their own zone', () => {
    const player = createPlayer('near');
    player.pos.z = C.KITCHEN_DEPTH + 0.6;
    expect(inKitchen(player)).toBe(false);
    player.pos.z = C.KITCHEN_DEPTH - 0.2;
    expect(inKitchen(player)).toBe(true);
  });

  it('reads the zone the same way at both ends of the court', () => {
    // The fifth chance this project has had to get a sign wrong on one side of
    // the net and right on the other, and the fifth test pinning both.
    const far = createPlayer('far');
    far.pos.z = -(C.KITCHEN_DEPTH - 0.2);
    expect(inKitchen(far)).toBe(true);
    far.pos.z = -(C.KITCHEN_DEPTH + 0.6);
    expect(inKitchen(far)).toBe(false);
  });

  it('still stops the player dead at the net rather than walking through it', () => {
    const player = run(4 * C.SIM_HZ, () => ({ moveZ: -1 }));
    expect(player.vel.z).toBe(0);
  });

  it('lets a player reach a ball landing anywhere in the kitchen', () => {
    /**
     * The test that should have caught this, and did not.
     *
     * Its previous form asserted that a player held at the rail could reach
     * five centimetres past the kitchen line, and called that enough. It was
     * measuring exactly the right thing and accepting the wrong answer: five
     * centimetres of a 2.13 m zone is not "a little way into the kitchen", it
     * is 41 per cent of it unreachable and the front 59 per cent gone.
     *
     * Now it asks the question that matters. A dink may land anywhere in the
     * zone, so a player must be able to get to anywhere in the zone.
     */
    const player = createPlayer('near');
    const out = emptyReach();
    for (const depth of [0.2, 0.6, 1.0, 1.4, 1.8, C.KITCHEN_DEPTH - 0.05]) {
      // Step in to meet it, which is what the rule allows and the rail did not.
      player.pos = v3(0, 0, Math.max(C.PLAYER_RADIUS, depth + 0.4));
      const ball = createBall();
      ball.pos = v3(0, 0.7, depth);
      expect(reachTo(player, ball, out).canReach).toBe(true);
    }
  });

  it('lets a dink land in the far kitchen at all', () => {
    // Kept from the barrier tests, where it was the one that mattered most: if
    // the soft shot cannot be solved into the zone, the soft game does not
    // exist regardless of who can reach it.
    const b = ballAt(v3(0, 0.5, 2.4), v3(0, -1, 3));
    const s = solveSwing(b, { targetX: -0.9, targetZ: -1.2, shape: 'drop', facing: -1 });
    expect(s.found).toBe(true);
    expect(s.outcome.landing).not.toBeNull();
    if (s.outcome.landing) expect(isInKitchen(s.outcome.landing)).toBe(true);
  });

  it('counts the momentum window down after a volley', () => {
    const player = createPlayer('near');
    player.momentumLeft = C.NVZ_MOMENTUM;
    for (let i = 0; i < C.SIM_HZ; i++) stepPlayer(player, emptyInput(), C.SIM_DT);
    expect(player.momentumLeft).toBeLessThanOrEqual(0);
  });
});

describe('swing timing', () => {
  it('does not put the paddle on the ball instantly', () => {
    const player = createPlayer('near');
    stepPlayer(player, { ...emptyInput(), swing: true }, C.SIM_DT);
    expect(player.phase).toBe('windup');
    expect(isContactTick(player, C.SIM_DT)).toBe(false);
  });

  it('lands contact one windup after the press, then recovers', () => {
    const player = createPlayer('near');
    const idle = emptyInput();
    stepPlayer(player, { ...idle, swing: true }, C.SIM_DT);
    let ticks = 1;
    while (!isContactTick(player, C.SIM_DT) && ticks < C.SIM_HZ) {
      stepPlayer(player, idle, C.SIM_DT);
      ticks += 1;
    }
    expect(ticks * C.SIM_DT).toBeCloseTo(C.SWING_WINDUP, 1);
    // And the player is not immediately able to swing again.
    stepPlayer(player, idle, C.SIM_DT);
    expect(player.phase).toBe('recovery');
  });

  it('queues a swing pressed during recovery, but not for ever', () => {
    const player = createPlayer('near');
    const idle = emptyInput();
    stepPlayer(player, { ...idle, swing: true }, C.SIM_DT);
    for (let i = 0; i < Math.round(C.SWING_WINDUP * C.SIM_HZ) + 2; i++) {
      stepPlayer(player, idle, C.SIM_DT);
    }
    expect(player.phase).toBe('recovery');

    stepPlayer(player, { ...idle, swing: true }, C.SIM_DT);
    expect(player.queuedSwing).toBe(true);

    // Held long enough and it expires rather than firing late.
    const stale = createPlayer('near');
    stale.phase = 'recovery';
    stale.phaseTime = 5;
    stepPlayer(stale, { ...idle, swing: true }, C.SIM_DT);
    for (let i = 0; i < Math.ceil(SWING_QUEUE_WINDOW * C.SIM_HZ) + 2; i++) {
      stepPlayer(stale, idle, C.SIM_DT);
    }
    expect(stale.queuedSwing).toBe(false);
  });
});

describe('reach', () => {
  const ballAtPoint = (x: number, y: number, z: number) => {
    const b = createBall();
    b.pos = v3(x, y, z);
    return b;
  };

  it('cannot reach a ball beyond a lunge', () => {
    const player = createPlayer('near');
    player.pos = v3(0, 0, 4);
    const out = emptyReach();
    expect(reachTo(player, ballAtPoint(0, 0.8, 4), out).canReach).toBe(true);
    expect(reachTo(player, ballAtPoint(C.PLAYER_REACH + 0.2, 0.8, 4), out).canReach).toBe(false);
  });

  it('cannot reach a ball on the floor or over its head', () => {
    const player = createPlayer('near');
    player.pos = v3(0, 0, 4);
    const out = emptyReach();
    expect(reachTo(player, ballAtPoint(0, 0.01, 4), out).canReach).toBe(false);
    expect(reachTo(player, ballAtPoint(0, 3.0, 4), out).canReach).toBe(false);
  });

  it('reports no strain in the strike zone and full strain at the limit', () => {
    const player = createPlayer('near');
    player.pos = v3(0, 0, 4);
    const out = emptyReach();
    expect(reachTo(player, ballAtPoint(0.2, 0.9, 4), out).strain).toBe(0);
    const stretched = reachTo(player, ballAtPoint(C.PLAYER_REACH - 0.01, 0.9, 4), out).strain;
    expect(stretched).toBeGreaterThan(0.9);
  });

  it('hands strain to the paddle as an off-centre impact', () => {
    // A stretched player does not miss, they catch it off the end of the
    // paddle, and the contact model already knows what that costs.
    const clean = strainToImpactOffset(0, POWER_SPOT_OFFSET);
    const stretched = strainToImpactOffset(1, POWER_SPOT_OFFSET);
    expect(clean).toBeCloseTo(POWER_SPOT_OFFSET, 6);
    expect(stretched).toBeCloseTo(C.PADDLE_FACE_LENGTH / 2, 6);
    expect(stretched).toBeGreaterThan(clean);
  });
});

describe('input buffering', () => {
  it('keeps a press that happened between two ticks', () => {
    const buffer = new InputBuffer();
    buffer.pressSwing();
    expect(buffer.consume().swing).toBe(true);
  });

  it('never fires the same press twice', () => {
    const buffer = new InputBuffer();
    buffer.pressSwing();
    buffer.consume();
    expect(buffer.consume().swing).toBe(false);
  });

  it('carries movement and aim through unchanged, clamped', () => {
    const buffer = new InputBuffer();
    buffer.setMove(3, -3);
    buffer.setAim(-9, 4);
    const frame = buffer.consume();
    expect(frame.moveX).toBe(1);
    expect(frame.moveZ).toBe(-1);
    expect(frame.aimX).toBe(-1);
    expect(frame.aimZ).toBe(1);
  });
});

describe('practice session', () => {
  /** The scripted player the sandbox is meant to make possible for a human. */
  const play = (seconds: number) => {
    const session = createSession();
    const input = emptyInput();
    const tally = { contacts: 0, in: 0, out: 0, netted: 0, whiffs: 0 };
    let awaiting = false;

    for (let i = 0; i < seconds * C.SIM_HZ; i++) {
      const ball = session.world.ball;
      const p = session.player.pos;
      const mine = ball.pos.z > 0.6 && ball.vel.z > -0.2 && !ball.resting;
      const future = predictBall(session.world, C.SWING_WINDUP).pos;
      const tx = mine ? future.x : 0;
      const tz = mine ? Math.max(1.2, future.z - 0.45) : 4.2;
      input.moveX = Math.max(-1, Math.min(1, (tx - p.x) * 3));
      input.moveZ = Math.max(-1, Math.min(1, (tz - p.z) * 3));
      const d = Math.hypot(future.x - p.x, future.z - p.z);
      input.swing =
        mine && session.player.phase === 'ready' && d < 0.85 && future.y > 0.3 && future.y < 1.6;
      input.shape = 'drive';
      input.aimX = session.feedCount % 2 === 0 ? 0.5 : -0.5;

      for (const e of stepSession(session, input)) {
        if (e.type === 'contact') {
          tally.contacts += 1;
          awaiting = true;
        }
        if (e.type === 'whiff') tally.whiffs += 1;
        if (awaiting && e.type === 'net') {
          tally.netted += 1;
          awaiting = false;
        }
        if (awaiting && e.type === 'bounce') {
          // In means in the far court. The first version of this test only
          // asked isInBounds, which counts the player's own half, so it passed
          // happily while every shot was being aimed backwards.
          isInBounds(e.at) && e.at.z < 0 ? (tally.in += 1) : (tally.out += 1);
          awaiting = false;
        }
      }
    }
    return { session, tally };
  };

  it('feeds a ball that lands in the near court, not the net', () => {
    const session = createSession();
    const input = emptyInput();
    let firstBounce: { x: number; z: number } | null = null;
    let netted = false;
    for (let i = 0; i < 6 * C.SIM_HZ && !firstBounce; i++) {
      for (const e of stepSession(session, input)) {
        if (e.type === 'net') netted = true;
        if (e.type === 'bounce' && !firstBounce) firstBounce = { x: e.at.x, z: e.at.z };
      }
    }
    expect(netted).toBe(false);
    expect(firstBounce).not.toBeNull();
    if (firstBounce) {
      expect(firstBounce.z).toBeGreaterThan(0);
      expect(Math.abs(firstBounce.x)).toBeLessThan(C.COURT_HALF_WIDTH);
    }
  });

  it('lets a competent player return most of what is fed', () => {
    // The end-to-end check that Day 3 actually connects: feed, move, reach,
    // swing timing, solver, contact, flight, and a legal landing.
    const { tally } = play(50);
    expect(tally.contacts).toBeGreaterThan(8);
    expect(tally.whiffs).toBe(0);
    expect(tally.in / Math.max(1, tally.in + tally.out + tally.netted)).toBeGreaterThan(0.7);
  });

  it('is deterministic: the same inputs give the same session', () => {
    const a = play(20);
    const b = play(20);
    expect(a.tally).toEqual(b.tally);
    expect(a.session.player.pos.x).toBe(b.session.player.pos.x);
    expect(a.session.world.ball.pos.z).toBe(b.session.world.ball.pos.z);
  });
});

describe('game speed', () => {
  it('runs exactly as many fixed steps as the scaled time allows', () => {
    // A fifth of a second at half speed is a tenth of a second of simulation.
    // Kept under the stall clamp on purpose: a whole second of frame time is
    // already a stall, and the clamp would hide the scaling being tested.
    const full = advance(0, 0.2, 1);
    const half = advance(0, 0.2, 0.5);
    expect(full.steps).toBe(Math.round(0.2 * C.SIM_HZ));
    expect(half.steps).toBe(Math.round(0.1 * C.SIM_HZ));
  });

  it('carries the remainder so slow motion does not drift', () => {
    // Sixty frames of a 60 Hz display at 0.6 speed must add up to 0.6 s of
    // simulation, not 0.6 s minus sixty roundings.
    let acc = 0;
    let steps = 0;
    for (let i = 0; i < 60; i++) {
      const r = advance(acc, 1 / 60, 0.6);
      acc = r.remainder;
      steps += r.steps;
    }
    expect(steps).toBe(Math.round(0.6 * C.SIM_HZ));
  });

  it('still clamps a long stall before scaling it', () => {
    // A five second stall must not become five seconds of catch-up, at any
    // game speed.
    expect(advance(0, 5, 1).steps).toBeLessThanOrEqual(0.25 * C.SIM_HZ);
    expect(advance(0, 5, 0.6).steps).toBeLessThanOrEqual(0.25 * C.SIM_HZ);
  });

  it('defaults to a speed a person can actually react at', () => {
    expect(C.DEFAULT_GAME_SPEED).toBeGreaterThan(0.3);
    expect(C.DEFAULT_GAME_SPEED).toBeLessThan(1);
  });
});

/**
 * Drawing a player between two ticks.
 *
 * Reported from the outside, watching a recording: "the player model stayed
 * still and still hit the ball." It was not the frame rate. Only the ball had a
 * previous position to interpolate from, so every frame drew the ball part way
 * through a tick and the player and paddle a whole tick ahead of it.
 */
describe('interpolating a player', () => {
  const walking = (): PlayerState => {
    const p = createPlayer('near');
    p.pos.x = 0;
    p.pos.z = 5;
    return p;
  };

  it('gives the start of the tick at 0 and the end at 1', () => {
    const p = walking();
    stepPlayer(p, { moveX: 1, moveZ: 0, swing: false, shape: 'drive', aimX: 0, aimZ: 0 }, C.SIM_DT);
    const out = v3();
    interpolatedPlayer(out, p, 0);
    expect(out.x).toBeCloseTo(p.prev.x, 9);
    interpolatedPlayer(out, p, 1);
    expect(out.x).toBeCloseTo(p.pos.x, 9);
  });

  it('lands halfway at a half tick', () => {
    const p = walking();
    stepPlayer(p, { moveX: 1, moveZ: 1, swing: false, shape: 'drive', aimX: 0, aimZ: 0 }, C.SIM_DT);
    const out = v3();
    interpolatedPlayer(out, p, 0.5);
    expect(out.x).toBeCloseTo((p.prev.x + p.pos.x) / 2, 9);
    expect(out.z).toBeCloseTo((p.prev.z + p.pos.z) / 2, 9);
  });

  it('moves prev forward every tick, so it never goes stale', () => {
    const p = walking();
    const input = { moveX: 1, moveZ: 0, swing: false, shape: 'drive' as const, aimX: 0, aimZ: 0 };
    stepPlayer(p, input, C.SIM_DT);
    const first = p.prev.x;
    stepPlayer(p, input, C.SIM_DT);
    expect(p.prev.x).toBeGreaterThan(first);
    expect(p.prev.x).toBeLessThan(p.pos.x);
  });

  it('starts a player with prev equal to pos, so frame one is not a jump', () => {
    const p = createPlayer('far');
    expect(p.prev.x).toBeCloseTo(p.pos.x, 9);
    expect(p.prev.z).toBeCloseTo(p.pos.z, 9);
  });
});
