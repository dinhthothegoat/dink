import { BallState } from './ball';
import * as C from './constants';
import { Side, Slot } from './court';
import { InputFrame } from './input';
import { Vec3, v3, set, copy, length } from './vec3';

export type SwingPhase = 'ready' | 'windup' | 'recovery';

export interface PlayerState {
  pos: Vec3;
  /**
   * Where this player was at the start of the current tick.
   *
   * Day 16, after somebody watched a recording and said the player was standing
   * still and hitting the ball anyway. They were right, and it was not the frame
   * rate. `world.prev` has existed since Day 1 so the BALL could be drawn
   * between two ticks, and nothing equivalent existed for players — so every
   * frame drew the ball part way through a tick and the player and paddle a full
   * tick ahead of it. Measured over four games: the ball covers 9.2 cm in a
   * typical tick and up to 23.9 cm, against a ball 7.4 cm across. More than a
   * ball's width of mismatch, worst exactly at contact, where the ball is
   * fastest and the eye is looking.
   */
  prev: Vec3;
  vel: Vec3;
  side: Side;
  /**
   * Which of the two players on this end. 0 is the player who starts the game
   * in the right/even court, which is the anchor the whole doubles serve
   * rotation hangs off. Always 0 in singles.
   */
  slot: Slot;
  /** -1 hits toward -z, +1 toward +z. Fixed by which side they are on. */
  facing: -1 | 1;
  phase: SwingPhase;
  /** Seconds left in the current phase. */
  phaseTime: number;
  /**
   * Seconds left in which stepping into the non-volley zone is a fault.
   *
   * Set when a volley is struck. It is not enough to be behind the line when
   * you hit it: if your own momentum carries you in before you re-establish,
   * the point is lost. This is the non-volley rule people actually get called
   * for, and it is what stops a player volleying hard and drifting in to cover
   * the next ball for free.
   */
  momentumLeft: number;
  /**
   * A swing asked for while busy, and how long ago. Held here rather than in
   * the input layer, because whether a swing is available is a rule about the
   * player, not a property of the keyboard.
   */
  queuedSwing: boolean;
  queuedAge: number;
  /** The shot the queued or in-progress swing is asking for. */
  queuedShape: InputFrame['shape'];
  /**
   * Where that swing is aimed, latched at the press rather than read at contact.
   *
   * Both axes are latched together and for the same reason: a shot is a decision
   * made before the swing starts, and sampling the aim 120 ms later — after the
   * windup, when the player is already moving to the next ball — would let
   * somebody steer a ball that has been committed to. The cost is that the aim
   * has to be held BEFORE the shape key, which is a real thing a player has to
   * learn and which the marker in the renderer exists to teach.
   */
  queuedAimX: number;
  queuedAimZ: number;
}

/** How long a swing asked for mid-recovery stays queued. */
export const SWING_QUEUE_WINDOW = 0.18;

export const createPlayer = (side: Side, slot: Slot = 0): PlayerState => ({
  pos: v3(0, 0, side === 'near' ? C.COURT_HALF_LENGTH - 0.6 : -(C.COURT_HALF_LENGTH - 0.6)),
  prev: v3(0, 0, side === 'near' ? C.COURT_HALF_LENGTH - 0.6 : -(C.COURT_HALF_LENGTH - 0.6)),
  vel: v3(0, 0, 0),
  side,
  slot,
  facing: side === 'near' ? -1 : 1,
  phase: 'ready',
  phaseTime: 0,
  momentumLeft: 0,
  queuedSwing: false,
  queuedAge: 0,
  queuedShape: 'drive',
  queuedAimX: 0,
  queuedAimZ: 0,
});

const _desired = v3();

/**
 * Advance a player one tick.
 *
 * Movement is acceleration-based rather than a direct velocity set. On a court
 * this small that choice is most of how the game feels: a player who changes
 * direction instantly can cover everything, and the whole tension of pickleball
 * is that they cannot.
 */
export const stepPlayer = (player: PlayerState, input: InputFrame, dt: number): void => {
  copy(player.prev, player.pos);

  // --- movement ------------------------------------------------------------
  const mag = Math.hypot(input.moveX, input.moveZ);
  if (mag > 1e-4) {
    // Normalise so diagonal movement is not faster than straight movement.
    const nx = input.moveX / Math.max(1, mag);
    const nz = input.moveZ / Math.max(1, mag);
    set(_desired, nx * C.PLAYER_MAX_SPEED, 0, nz * C.PLAYER_MAX_SPEED);
  } else {
    set(_desired, 0, 0, 0);
  }

  // Accelerate toward the requested velocity, braking harder than we drive.
  const dx = _desired.x - player.vel.x;
  const dz = _desired.z - player.vel.z;
  const gap = Math.hypot(dx, dz);
  if (gap > 1e-6) {
    const rate = mag > 1e-4 ? C.PLAYER_ACCEL : C.PLAYER_DECEL;
    const step = Math.min(gap, rate * dt);
    player.vel.x += (dx / gap) * step;
    player.vel.z += (dz / gap) * step;
  }

  player.pos.x += player.vel.x * dt;
  player.pos.z += player.vel.z * dt;
  clampToSide(player);
  if (player.momentumLeft > 0) player.momentumLeft -= dt;

  // --- swing state machine -------------------------------------------------
  if (player.phase !== 'ready') {
    player.phaseTime -= dt;
    if (player.phaseTime <= 0) {
      player.phase = player.phase === 'windup' ? 'recovery' : 'ready';
      player.phaseTime = player.phase === 'recovery' ? C.SWING_RECOVERY : 0;
    }
  }

  if (player.queuedSwing) {
    player.queuedAge += dt;
    if (player.queuedAge > SWING_QUEUE_WINDOW) player.queuedSwing = false;
  }

  if (input.swing) {
    player.queuedSwing = true;
    player.queuedAge = 0;
    player.queuedShape = input.shape;
    player.queuedAimX = input.aimX;
    player.queuedAimZ = input.aimZ;
  }

  if (player.phase === 'ready' && player.queuedSwing) {
    player.queuedSwing = false;
    player.phase = 'windup';
    player.phaseTime = C.SWING_WINDUP;
  }
};

/**
 * Where to draw a player, part way between two ticks.
 *
 * The same treatment `interpolatedPosition` gives the ball, and it has to be the
 * same or the two are drawn in different moments. Nothing in the simulation uses
 * this: it is a renderer question and the answer never feeds back.
 */
export const interpolatedPlayer = (out: Vec3, player: PlayerState, alpha: number): Vec3 => {
  const a = player.prev;
  const b = player.pos;
  return set(out, a.x + (b.x - a.x) * alpha, 0, a.z + (b.z - a.z) * alpha);
};

/** True on the tick the paddle arrives, which is when contact can happen. */
export const isContactTick = (player: PlayerState, dt: number): boolean =>
  player.phase === 'windup' && player.phaseTime <= dt;

/**
 * Keep a player on their own side, and off the net and posts.
 *
 * The kitchen used to be fenced here. It is now governed by the non-volley
 * rule in `rules.ts`, which is what the sport actually does: you may stand in
 * there, you may not volley from there. KITCHEN_BARRIER survives as a
 * constant so the old behaviour is one flag away, but it is off.
 */
const clampToSide = (player: PlayerState): void => {
  const limit = C.COURT_HALF_WIDTH + 1.6;
  if (player.pos.x > limit) {
    player.pos.x = limit;
    player.vel.x = 0;
  }
  if (player.pos.x < -limit) {
    player.pos.x = -limit;
    player.vel.x = 0;
  }
  const near = player.side === 'near';
  // The only thing between a player and the net is the net. Standing in the
  // kitchen is legal and often necessary — you step in to play a ball that has
  // bounced, and step out again. What you may not do in there is volley, and
  // that is a rule in `rules.ts`, not a wall here.
  const insideCourtWidth = Math.abs(player.pos.x) <= C.COURT_HALF_WIDTH + C.PLAYER_RADIUS;
  const fenced = C.KITCHEN_BARRIER && insideCourtWidth;
  const nearLimit = fenced ? C.KITCHEN_DEPTH + C.PLAYER_RADIUS : C.PLAYER_RADIUS;
  const minZ = near ? nearLimit : -(C.COURT_HALF_LENGTH + 2.4);
  const maxZ = near ? C.COURT_HALF_LENGTH + 2.4 : -nearLimit;
  if (player.pos.z < minZ) {
    player.pos.z = minZ;
    player.vel.z = 0;
  }
  if (player.pos.z > maxZ) {
    player.pos.z = maxZ;
    player.vel.z = 0;
  }
};

/** Is this player standing in their own non-volley zone? */
export const inKitchen = (player: PlayerState): boolean =>
  Math.abs(player.pos.z) < C.KITCHEN_DEPTH + C.PLAYER_RADIUS;

export interface Reach {
  /** Can the paddle get to the ball at all? */
  canReach: boolean;
  /** Horizontal distance from the player to the ball, in metres. */
  distance: number;
  /**
   * 0 when the ball is right in the strike zone, 1 at the very limit of a
   * lunge. This is what makes a stretched shot a bad shot: it is handed
   * straight to the paddle as an off-centre impact.
   */
  strain: number;
  /** Where the paddle would meet the ball. */
  contact: Vec3;
}

const _toBall = v3();

/**
 * Work out whether and how well a player can meet the ball where it is.
 *
 * Strain combines two ways of being stretched: too far to the side, and too
 * high or too low. Both end up in the same number because both do the same
 * thing to a real shot, which is push contact away from the middle of the
 * paddle.
 */
export const reachTo = (player: PlayerState, ball: BallState, out: Reach): Reach => {
  set(_toBall, ball.pos.x - player.pos.x, 0, ball.pos.z - player.pos.z);
  const distance = length(_toBall);
  const height = ball.pos.y;

  const lateral = distance / C.PLAYER_REACH;
  const vertical =
    height < C.PLAYER_STRIKE_LOW
      ? (C.PLAYER_STRIKE_LOW - height) / (C.PLAYER_STRIKE_LOW - C.PLAYER_REACH_LOW)
      : height > C.PLAYER_STRIKE_HIGH
        ? (height - C.PLAYER_STRIKE_HIGH) / (C.PLAYER_REACH_HIGH - C.PLAYER_STRIKE_HIGH)
        : 0;

  const comfortable = Math.max(
    0,
    (lateral - C.PLAYER_COMFORT_REACH) / (1 - C.PLAYER_COMFORT_REACH),
  );
  out.canReach =
    lateral <= 1 && height >= C.PLAYER_REACH_LOW && height <= C.PLAYER_REACH_HIGH;
  out.distance = distance;
  out.strain = Math.min(1, Math.hypot(comfortable, vertical));
  copy(out.contact, ball.pos);
  return out;
};

export const emptyReach = (): Reach => ({
  canReach: false,
  distance: 0,
  strain: 0,
  contact: v3(),
});

/**
 * Turn reach strain into a point on the paddle face.
 *
 * A stretched player does not miss the ball, they catch it off the end of the
 * paddle, and the contact model already knows what that costs. Routing strain
 * here rather than applying a damage multiplier means a bad position produces
 * a bad shot for the same reason a bad swing does.
 */
export const strainToImpactOffset = (strain: number, powerSpot: number): number => {
  const half = C.PADDLE_FACE_LENGTH / 2;
  return powerSpot + strain * (half - powerSpot);
};
