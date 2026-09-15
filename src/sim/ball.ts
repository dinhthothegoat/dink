import * as C from './constants';
import { Vec3, v3, clone, set, copy, add, addScaled, cross, dot, length, normalize, scale, sub } from './vec3';

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  /** Angular velocity in rad/s. Build it with spinVector, not by hand. */
  spin: Vec3;
  /** True once the ball has stopped doing anything interesting. */
  resting: boolean;
}

/**
 * Convert the numbers a player thinks in (rpm of topspin and sidespin) into
 * an angular velocity vector, for a ball struck toward -z.
 *
 * Sign convention, derived rather than guessed: topspin means the top of the
 * ball moves the way the ball is going. The top of the ball sits at +y, and
 * its velocity relative to the centre is omega x (r*y_hat) = omega_x * r * z_hat.
 * Travel is toward -z, so topspin needs omega_x NEGATIVE. Positive sidespin
 * is defined as curving the ball toward +x, which likewise needs omega_y
 * negative. Callers should never build a spin vector by hand.
 */
export const RPM = (2 * Math.PI) / 60;
export const spinVector = (topspinRpm: number, sidespinRpm: number): Vec3 =>
  v3(-topspinRpm * RPM, -sidespinRpm * RPM, 0);

/** Inverse of spinVector, for HUD readouts and tests. */
export const topspinRpmOf = (spin: Vec3): number => -spin.x / RPM;

export const createBall = (): BallState => ({
  pos: v3(0, 1, 4),
  vel: v3(0, 0, 0),
  spin: v3(0, 0, 0),
  resting: false,
});

// Scratch vectors. The step function runs 120 times a second for the whole
// life of the process, so it does not allocate.
const _acc = v3();
const _tmp = v3();
const _magnus = v3();

/**
 * Aerodynamic + gravitational acceleration for a ball in flight.
 * Exported so tests can probe it directly rather than inferring it from
 * a trajectory.
 */
export const accelerationOf = (out: Vec3, vel: Vec3, spin: Vec3): Vec3 => {
  const speed = length(vel);
  set(out, 0, -C.GRAVITY, 0);
  if (speed < 1e-6) return out;

  // Drag: opposes velocity, grows with the square of speed.
  addScaled(out, out, vel, -C.DRAG_K * speed);

  // Magnus: perpendicular to both spin and velocity, and NOT symmetric.
  //
  // Topspin follows the linear fit Cl = LIFT_SLOPE * S, capped where the data
  // runs out. Backspin SATURATES instead — it reaches the same ceiling but at a
  // much lower spin number and then stops, which is the one thing the two
  // published fits agree on (see BACKSPIN_SATURATION_S). tanh is used for the
  // knee rather than a min(), because a kink in the force means a visible kink
  // in the flight of a ball whose spin is decaying through it.
  //
  // Which case this is falls out of the force direction rather than needing the
  // spin axis decomposed: omega x v points down for topspin and up for backspin,
  // so the sign of its vertical component IS the question. Pure sidespin has no
  // vertical component at all and lands on the topspin branch, which is the
  // conservative one — sidespin saturation is not something either study
  // measured, so it does not get invented here.
  const spinRate = length(spin);
  if (spinRate > 1e-6) {
    cross(_magnus, spin, vel);
    const S = (C.BALL_RADIUS * spinRate) / speed;
    // What MAGNUS_K already encodes; everything below is a correction to it.
    const linear = C.LIFT_SLOPE * S;
    const cl =
      _magnus.y > 0
        ? C.LIFT_COEF_MAX * Math.tanh(S / C.BACKSPIN_SATURATION_S)
        : Math.min(linear, C.LIFT_COEF_MAX);
    if (linear > 1e-12) addScaled(out, out, _magnus, (C.MAGNUS_K * cl) / linear);
  }
  return out;
};

/**
 * One fixed simulation step of free flight. Semi-implicit Euler: velocity is
 * advanced first, then position uses the new velocity. It is only first
 * order, but it is symplectic, cheap, and — the reason it wins here —
 * bit-for-bit reproducible, which we will need for replays and netcode.
 */
export const integrate = (ball: BallState, dt: number): void => {
  accelerationOf(_acc, ball.vel, ball.spin);
  addScaled(ball.vel, ball.vel, _acc, dt);
  addScaled(ball.pos, ball.pos, ball.vel, dt);
  // Spin decays exponentially toward zero, at a rate set by how fast the ball is
  // going: dw/dt = -(U / L) * w, so the constant is a DISTANCE travelled and not
  // a wall-clock time. A dink holds its spin far longer than a drive does.
  scale(ball.spin, ball.spin, Math.exp((-dt * length(ball.vel)) / C.SPIN_DECAY_LENGTH));
};

export interface ImpactResult {
  /** Speed along the surface normal just before impact, always positive. */
  approachSpeed: number;
  /** True if the contact patch was still sliding when the impulse ended. */
  slid: boolean;
}

const _n = v3();
const _vn = v3();
const _vt = v3();
const _contact = v3();
const _that = v3();
const _dp = v3();
const _torque = v3();
const _r = v3();

/**
 * Resolve a ball striking a surface with unit normal `n`.
 *
 * Normal direction is a plain coefficient of restitution. Tangential
 * direction runs the standard sliding-versus-gripping test: apply friction
 * up to Coulomb's limit, but never more than the impulse that would exactly
 * cancel slip at the contact patch. Because a pickleball is a hollow shell,
 * the grip impulse is 2/5 of the slip momentum rather than the 2/7 you would
 * use for a solid ball, so it picks up and reverses spin aggressively.
 */
export const resolveImpact = (
  ball: BallState,
  n: Vec3,
  restitution: number,
  friction: number,
): ImpactResult => {
  copy(_n, n);
  const vnMag = dot(ball.vel, _n);
  const approachSpeed = Math.abs(vnMag);

  // Split velocity into normal and tangential parts.
  scale(_vn, _n, vnMag);
  sub(_vt, ball.vel, _vn);

  // Velocity of the material point actually touching the surface:
  // u = v_t + omega x (-r * n)
  scale(_r, _n, -C.BALL_RADIUS);
  cross(_tmp, ball.spin, _r);
  add(_contact, _vt, _tmp);

  const slipSpeed = length(_contact);
  const normalImpulse = C.BALL_MASS * (1 + restitution) * approachSpeed;
  const gripImpulse =
    (C.BALL_INERTIA_COEF / (1 + C.BALL_INERTIA_COEF)) * C.BALL_MASS * slipSpeed;
  const coulombLimit = friction * normalImpulse;
  const jt = Math.min(coulombLimit, gripImpulse);
  const slid = coulombLimit < gripImpulse;

  // Reflect the normal component.
  addScaled(ball.vel, _vt, _n, -restitution * vnMag);

  if (slipSpeed > 1e-6 && jt > 0) {
    normalize(_that, _contact);
    scale(_dp, _that, -jt); // friction opposes slip
    addScaled(ball.vel, ball.vel, _dp, 1 / C.BALL_MASS);

    // Angular impulse = r x dp, with I = coef * m * r^2.
    cross(_torque, _r, _dp);
    const invI = 1 / (C.BALL_INERTIA_COEF * C.BALL_MASS * C.BALL_RADIUS * C.BALL_RADIUS);
    addScaled(ball.spin, ball.spin, _torque, invI);
  }

  return { approachSpeed, slid };
};

export const snapshot = (ball: BallState): BallState => ({
  pos: clone(ball.pos),
  vel: clone(ball.vel),
  spin: clone(ball.spin),
  resting: ball.resting,
});
