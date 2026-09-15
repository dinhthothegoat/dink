import * as C from './constants';
import { BallState, createBall, integrate, resolveImpact, snapshot } from './ball';
import { isInBounds, netHeightAt } from './court';
import { Vec3, v3, clone, copy, set } from './vec3';

export type SimEvent =
  | { type: 'bounce'; at: Vec3; inBounds: boolean; speed: number }
  | { type: 'net'; at: Vec3; cord: boolean }
  | { type: 'rest'; at: Vec3 }
  | { type: 'outOfPlay'; at: Vec3 };

export interface World {
  ball: BallState;
  /** State at the start of the current step, for render interpolation. */
  prev: BallState;
  tick: number;
  events: SimEvent[];
}

export const createWorld = (): World => {
  const ball = createBall();
  return { ball, prev: snapshot(ball), tick: 0, events: [] };
};

export const launch = (world: World, pos: Vec3, vel: Vec3, spin: Vec3): void => {
  copy(world.ball.pos, pos);
  copy(world.ball.vel, vel);
  copy(world.ball.spin, spin);
  world.ball.resting = false;
  copy(world.prev.pos, pos);
  copy(world.prev.vel, vel);
  copy(world.prev.spin, spin);
  world.prev.resting = false;
};

const GROUND_N = v3(0, 1, 0);
const NET_N_NEAR = v3(0, 0, 1);
const NET_N_FAR = v3(0, 0, -1);
/** How far past the baselines and sidelines the ball stays simulated. */
const PLAY_MARGIN = 4;

/**
 * Advance the simulation one fixed step and report anything the game rules
 * need to know about. The world layer owns collisions and event reporting;
 * the ball layer owns pure motion. Keeping that seam clean is what lets the
 * rules engine (Day 3) be tested without ever constructing a renderer.
 */
export const step = (world: World): SimEvent[] => {
  const ball = world.ball;
  world.events.length = 0;
  copy(world.prev.pos, ball.pos);
  copy(world.prev.vel, ball.vel);
  copy(world.prev.spin, ball.spin);
  world.prev.resting = ball.resting;
  world.tick += 1;

  if (ball.resting) return world.events;

  const z0 = ball.pos.z;
  integrate(ball, C.SIM_DT);
  const z1 = ball.pos.z;

  // --- net -----------------------------------------------------------------
  // The ball moves several centimetres per step, so we test the plane
  // crossing rather than the instantaneous position. Tunnelling through the
  // net at 25 m/s would otherwise be entirely possible.
  if (z0 !== z1 && Math.sign(z0) !== Math.sign(z1)) {
    const t = z0 / (z0 - z1);
    const cx = world.prev.pos.x + (ball.pos.x - world.prev.pos.x) * t;
    const cy = world.prev.pos.y + (ball.pos.y - world.prev.pos.y) * t;
    const netY = netHeightAt(cx);
    if (Math.abs(cx) <= C.NET_HALF_WIDTH && cy - C.BALL_RADIUS <= netY) {
      const cord = cy + C.BALL_RADIUS >= netY - C.BALL_RADIUS;
      // Put the ball back at the point of contact before responding.
      set(ball.pos, cx, cy, z0 > 0 ? C.BALL_RADIUS : -C.BALL_RADIUS);
      resolveImpact(
        ball,
        z0 > 0 ? NET_N_NEAR : NET_N_FAR,
        cord ? C.NET_CORD_RESTITUTION : C.NET_RESTITUTION,
        0.9,
      );
      world.events.push({ type: 'net', at: clone(ball.pos), cord });
    }
  }

  // --- ground --------------------------------------------------------------
  if (ball.pos.y - C.BALL_RADIUS <= 0 && ball.vel.y < 0) {
    ball.pos.y = C.BALL_RADIUS;
    const r = resolveImpact(ball, GROUND_N, C.COURT_RESTITUTION, C.COURT_FRICTION);
    if (r.approachSpeed < C.REST_VELOCITY) {
      ball.resting = true;
      set(ball.vel, 0, 0, 0);
      world.events.push({ type: 'rest', at: clone(ball.pos) });
    } else {
      world.events.push({
        type: 'bounce',
        at: clone(ball.pos),
        inBounds: isInBounds(ball.pos),
        speed: r.approachSpeed,
      });
    }
  }

  // --- out of play ---------------------------------------------------------
  if (
    Math.abs(ball.pos.x) > C.COURT_HALF_WIDTH + PLAY_MARGIN ||
    Math.abs(ball.pos.z) > C.COURT_HALF_LENGTH + PLAY_MARGIN
  ) {
    ball.resting = true;
    // Zero the velocity too. Leaving it set meant a ball reported as resting
    // was still carrying 7 m/s, which is the kind of small inconsistency the
    // rules engine would later trip over.
    set(ball.vel, 0, 0, 0);
    set(ball.spin, 0, 0, 0);
    world.events.push({ type: 'outOfPlay', at: clone(ball.pos) });
  }

  return world.events;
};

/**
 * Where the ball will be in `seconds`, by running a throwaway copy of the
 * world forward.
 *
 * Needed the moment a swing takes time to arrive: a player pressing when the
 * ball is already in reach is pressing too late, because the paddle turns up
 * a windup later and the ball has moved a metre and a half. Prediction is how
 * both a person's aiming aid and the opponent AI decide when to start a swing,
 * and doing it by re-simulating rather than by a closed-form guess means the
 * prediction and the reality cannot drift apart.
 */
/**
 * Scratch world for `predictBall`, reused across calls.
 *
 * Every player asks where the ball will be at contact on every tick, so a world
 * allocated per call is nine short-lived objects at 120 Hz per player, for the
 * whole match. That is the steady half of the garbage this simulation makes;
 * the solver is the bursty half.
 */
let _future: World | null = null;

/**
 * Where the ball will be in `seconds`, by simulating it.
 *
 * The returned state is SHARED and is invalidated by the next call. Every caller
 * in this codebase reads it immediately, which is why that is acceptable; pass
 * `out` if you need to keep it. The alternative — allocating per call — is what
 * this replaced, and it cost more than the hazard is worth.
 */
export const predictBall = (world: World, seconds: number, out?: BallState): BallState => {
  if (!_future) _future = createWorld();
  const probe = _future;
  launch(probe, world.ball.pos, world.ball.vel, world.ball.spin);
  probe.ball.resting = world.ball.resting;
  const ticks = Math.max(0, Math.round(seconds * C.SIM_HZ));
  for (let i = 0; i < ticks; i++) step(probe);
  if (!out) return probe.ball;
  copy(out.pos, probe.ball.pos);
  copy(out.vel, probe.ball.vel);
  copy(out.spin, probe.ball.spin);
  out.resting = probe.ball.resting;
  return out;
};

/** Position to draw this frame, blended between the last two sim states. */
export const interpolatedPosition = (out: Vec3, world: World, alpha: number): Vec3 => {
  const a = world.prev.pos;
  const b = world.ball.pos;
  return set(
    out,
    a.x + (b.x - a.x) * alpha,
    a.y + (b.y - a.y) * alpha,
    a.z + (b.z - a.z) * alpha,
  );
};
