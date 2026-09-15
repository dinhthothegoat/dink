import { BallState } from './ball';
import * as C from './constants';
import {
  Vec3,
  v3,
  set,
  add,
  addScaled,
  cross,
  dot,
  length,
  normalize,
  scale,
  sub,
} from './vec3';

/**
 * A swing, described the way a player would describe one.
 *
 * The important idea, and the one the whole model rests on: spin is not a
 * separate dial. It comes out of the angle between where the paddle is
 * pointing (`pitch`, `yaw`) and where it is going (`pathAngle`, `pathYaw`).
 * Swing along the face normal and you get a flat ball; brush upward across a
 * closed face and you get topspin, because the face is sliding across the
 * ball and friction has to go somewhere. That is how a real paddle works and
 * it is why this is one impulse calculation rather than a table of shot types.
 */
export interface Swing {
  /** Speed of the paddle at the contact point, m/s. */
  speed: number;
  /** Face normal elevation, degrees. Positive opens the face upward. */
  pitch: number;
  /** Face normal yaw, degrees. Positive aims toward +x. */
  yaw: number;
  /** Swing path elevation, degrees. Positive is low-to-high. */
  pathAngle: number;
  /** Swing path yaw, degrees. Positive swings across toward +x. */
  pathYaw: number;
  /**
   * Where on the face the ball lands, in metres from the centre of the face
   * along the paddle's long axis. Positive is toward the tip.
   */
  impactOffset: number;
  /** Which way the paddle is facing down the court: -1 hits toward -z. */
  facing: -1 | 1;
}

export interface ContactResult {
  /** Speed of the ball leaving the face, m/s. */
  exitSpeed: number;
  /** Topspin imparted, rpm. Negative is backspin. */
  topspinRpm: number;
  /** Effective mass of the paddle at the impact point, kg. */
  effectiveMass: number;
  /** 0 at the power spot, 1 at the tip: how badly the hit was mislocated. */
  offCentre: number;
  /** True if the face slid across the ball rather than gripping it. */
  slid: boolean;
}

/**
 * Effective mass of the paddle at a point `d` metres from its centre of mass.
 *
 * During the roughly four milliseconds of contact the hand cannot respond, so
 * the paddle behaves as a free body: an off-centre hit spends part of the
 * collision rotating the paddle instead of driving the ball. That is the whole
 * explanation for why tip hits feel dead, and it falls out of one formula
 * rather than needing a hand-authored power curve.
 */
export const effectiveMassAt = (d: number): number =>
  C.PADDLE_MASS / (1 + (C.PADDLE_MASS * d * d) / C.PADDLE_INERTIA);

/** Distance from the centre of mass to a point `offset` from the face centre. */
const armFromCom = (offset: number): number =>
  C.PADDLE_FACE_CENTER - C.PADDLE_BALANCE + offset;

/**
 * The power spot: the point on the face where effective mass is highest and
 * the ball leaves fastest. It sits over the centre of mass, which on a real
 * paddle is below the geometric centre of the face — which is exactly where
 * coaches tell people to hit.
 */
export const POWER_SPOT_OFFSET = C.PADDLE_BALANCE - C.PADDLE_FACE_CENTER;

const HALF_FACE = C.PADDLE_FACE_LENGTH / 2;
const DEG = Math.PI / 180;
const RPM = (2 * Math.PI) / 60;

/** Unit vector from an elevation and a yaw, pointing down-court by `facing`. */
const direction = (out: Vec3, elevationDeg: number, yawDeg: number, facing: number): Vec3 => {
  const el = elevationDeg * DEG;
  const yaw = yawDeg * DEG;
  const horiz = Math.cos(el);
  return set(out, horiz * Math.sin(yaw), Math.sin(el), facing * horiz * Math.cos(yaw));
};

const _n = v3();
const _pv = v3();
const _rel = v3();
const _relN = v3();
const _relT = v3();
const _contact = v3();
const _that = v3();
const _dp = v3();
const _r = v3();
const _torque = v3();
const _tmp = v3();

/**
 * Strike the ball. Mutates `ball` and reports what the contact did.
 *
 * The collision is resolved in the paddle's frame with a reduced mass, then
 * the tangential direction runs the same sliding-versus-gripping test the
 * court bounce uses. Nothing here is special-cased per shot type.
 */
export const strike = (ball: BallState, swing: Swing): ContactResult => {
  const offset = Math.max(-HALF_FACE, Math.min(HALF_FACE, swing.impactOffset));
  const arm = armFromCom(offset);
  const mEff = effectiveMassAt(arm);
  const offCentre = Math.min(1, Math.abs(offset - POWER_SPOT_OFFSET) / HALF_FACE);

  direction(_n, swing.pitch, swing.yaw, swing.facing);
  direction(_pv, swing.pathAngle, swing.pathYaw, swing.facing);
  scale(_pv, _pv, swing.speed);

  // Everything below is relative to the paddle.
  sub(_rel, ball.vel, _pv);
  const relN = dot(_rel, _n);

  // A face moving away from the ball cannot hit it. Report a whiff rather
  // than quietly producing a shot, so callers can treat it as a miss.
  if (relN >= 0) {
    return { exitSpeed: length(ball.vel), topspinRpm: 0, effectiveMass: mEff, offCentre, slid: true };
  }

  scale(_relN, _n, relN);
  sub(_relT, _rel, _relN);

  // Ball's contact patch sits one radius back along the normal, and carries
  // the ball's own surface speed from its spin.
  scale(_r, _n, -C.BALL_RADIUS);
  cross(_tmp, ball.spin, _r);
  add(_contact, _relT, _tmp);

  const reduced = (C.BALL_MASS * mEff) / (C.BALL_MASS + mEff);
  const jn = -(1 + C.PADDLE_COR) * relN * reduced;

  const slipSpeed = length(_contact);
  const gripImpulse =
    (C.BALL_INERTIA_COEF / (1 + C.BALL_INERTIA_COEF)) * C.BALL_MASS * slipSpeed;
  const coulombLimit = C.PADDLE_FRICTION * jn;
  const jt = Math.min(coulombLimit, gripImpulse);
  const slid = coulombLimit < gripImpulse;

  addScaled(ball.vel, ball.vel, _n, jn / C.BALL_MASS);

  if (slipSpeed > 1e-6 && jt > 0) {
    normalize(_that, _contact);
    scale(_dp, _that, -jt);
    addScaled(ball.vel, ball.vel, _dp, 1 / C.BALL_MASS);

    cross(_torque, _r, _dp);
    const invI = 1 / (C.BALL_INERTIA_COEF * C.BALL_MASS * C.BALL_RADIUS * C.BALL_RADIUS);
    addScaled(ball.spin, ball.spin, _torque, invI);
  }

  // A paddle cannot spin a ball past the rates seen in play; clamp rather
  // than let an extreme swing produce a number the aerodynamics never saw.
  const spinRate = length(ball.spin);
  const maxRate = C.MAX_SPIN_RPM * RPM;
  if (spinRate > maxRate) scale(ball.spin, ball.spin, maxRate / spinRate);

  ball.resting = false;
  return {
    exitSpeed: length(ball.vel),
    // Topspin reads as negative x for a ball hit toward -z and positive x
    // toward +z, so the facing sign converts the vector back to rpm.
    topspinRpm: (swing.facing * ball.spin.x) / RPM,
    effectiveMass: mEff,
    offCentre,
    slid,
  };
};

/** A neutral drive, as a starting point for callers building a swing. */
export const defaultSwing = (): Swing => ({
  speed: 14,
  pitch: 4,
  yaw: 0,
  pathAngle: 14,
  pathYaw: 0,
  impactOffset: POWER_SPOT_OFFSET,
  facing: -1,
});

/** Copy of a swing with fields overridden, for solvers and tests. */
export const withSwing = (base: Swing, patch: Partial<Swing>): Swing => ({ ...base, ...patch });

/** Face normal of a swing, exposed for the renderer and for debugging. */
export const faceNormal = (out: Vec3, swing: Swing): Vec3 =>
  direction(out, swing.pitch, swing.yaw, swing.facing);
