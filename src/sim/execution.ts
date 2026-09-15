import { BallState } from './ball';
import * as C from './constants';
import { Swing, withSwing } from './paddle';
import { Rng } from './rng';

/**
 * How a shot goes wrong.
 *
 * Days 5 and 6 both ended with the same measurement: across every rally of a
 * self-play game, not one ball went out and not one went into the net. Both
 * players solved a perfect arc to their target, so the only way to lose a point
 * was to fail to reach one. Difficulty lived entirely in the legs.
 *
 * The fix has to satisfy two things that pull against each other.
 *
 * First, the error has to be applied to the SWING, not to the target. Nudging
 * where a shot is aimed produces a different perfect shot; nudging the swing
 * produces a mis-hit, and the simulation then decides what that means — long,
 * short, wide, or into the net. That is where "out" and "into the net" come
 * from, and there is no other honest place to get them.
 *
 * Second, from Day 5: an error model that only scatters placement makes a
 * player *harder* to beat, because spread is what makes a ball hard to reach.
 * So the error has to be able to cost the person who made it. Perturbing pitch
 * and speed does exactly that: too much of either and the ball lands beyond the
 * baseline, too little and it never crosses.
 */

export interface Skill {
  /**
   * How much a player mis-hits when nothing is going wrong, 0 to 1. Zero is a
   * machine: a comfortable ball is struck exactly as intended.
   */
  level: number;
  /** Seconds before they start moving to a new shot. */
  reaction: number;
  /**
   * How wrong their read of the ball is, in metres of lateral offset at full
   * pressure. Movement error, as distinct from execution error: it makes them
   * arrive in slightly the wrong place rather than mis-hit once they are there.
   */
  anticipation: number;
}

/**
 * What made this shot hard, 0 to 1.
 *
 * These are the four things that actually degrade a shot in the sport, and each
 * is measured from something the simulation already knows rather than from a
 * difficulty number: how far the player had to reach, how fast the ball was
 * coming, how low the contact was, and how fast the player was still moving.
 * A difficulty setting scales the consequence; it does not invent the cause.
 */
export interface Pressure {
  /** Combined 0 to 1, the number the error scales with. */
  total: number;
  strain: number;
  pace: number;
  low: number;
  moving: number;
}

/** Above this incoming ball speed, pace is contributing everything it can. */
const PACE_FULL = 18;
/** Above this body speed, movement is contributing everything it can. */
const MOVING_FULL = 3.2;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

export const pressureOf = (
  ball: BallState,
  contactHeight: number,
  strain: number,
  bodySpeed: number,
): Pressure => {
  const pace = clamp01(Math.hypot(ball.vel.x, ball.vel.y, ball.vel.z) / PACE_FULL);
  // A ball taken below the knee is the hardest shot in pickleball and the one
  // that produces the most unforced errors, which is why low counts for as much
  // as reaching does.
  const low = clamp01((C.PLAYER_STRIKE_LOW + 0.35 - contactHeight) / 0.35);
  const moving = clamp01(bodySpeed / MOVING_FULL);

  // Root-sum-square rather than a sum: two mild difficulties should not add up
  // to a disaster, but reaching at full stretch off a fast ball should.
  const total = clamp01(
    Math.sqrt(strain * strain + pace * pace * 0.55 + low * low + moving * moving * 0.6) / 1.55,
  );
  return { total, strain: clamp01(strain), pace, low, moving };
};

/**
 * How much each part of the swing can be wrong at full pressure, for a player
 * whose level is 1.
 *
 * These are the numbers that decide what the game feels like, so they are
 * stated in the units a coach would use. Six degrees of face pitch is a
 * genuinely bad contact; twelve per cent of paddle speed is the difference
 * between a shot that lands deep and one that lands two metres long. They are
 * TUNED — measuring them would need a marker-tracked amateur, which is a Day 10
 * problem at best.
 */
const PITCH_ERROR = 6.0;
const SPEED_ERROR = 0.12;
const YAW_ERROR = 3.5;

/**
 * A mis-hit is not a symmetric scatter, and getting this wrong cost a round of
 * tuning. With pure symmetric noise, the "tough" preset lost to "steady": error
 * was a free source of spread, and Day 5 already measured that spread is what
 * makes a ball hard to reach. A sloppier player was simply harder to play.
 *
 * The sport says otherwise, and so does the contact model. A player who does
 * not strike cleanly loses pace and opens the face, so the ball comes off
 * higher, shorter and more central — it *sits up*. That is a genuinely worse
 * shot, and the shot chooser already knows what to do with one: a ball above
 * the net gets attacked. So the bias closes a real loop. Pressure produces a
 * floaty ball, and a floaty ball is the one that gets put away.
 *
 * The scatter is still there. It is just centred on a worse shot rather than
 * on the intended one.
 */
const PITCH_BIAS = 3.4;
const SPEED_BIAS = 0.1;

/**
 * A floor under the error, so that even a comfortable ball is not perfect.
 *
 * Without it, an opponent set to any difficulty plays flawlessly whenever it is
 * not under pressure, and every rally is decided by whether it can get there —
 * which is the exact failure this file exists to fix.
 */
const BASE_PRESSURE = 0.28;

/**
 * Perturb an intended swing into the one that actually happens.
 *
 * The three errors are drawn independently and all three matter differently:
 * pitch decides long or into the net, speed decides deep or short, and yaw
 * decides wide. Pitch is the one that produces the errors a player recognises,
 * so it carries the most weight.
 */
export const perturb = (swing: Swing, skill: Skill, pressure: Pressure, rng: Rng): Swing => {
  if (skill.level <= 0) return swing;
  const scale = skill.level * (BASE_PRESSURE + (1 - BASE_PRESSURE) * pressure.total);
  return withSwing(swing, {
    pitch: swing.pitch + PITCH_BIAS * scale + rng.spread(PITCH_ERROR * scale),
    speed: Math.max(
      1,
      swing.speed * (1 - SPEED_BIAS * scale + rng.spread(SPEED_ERROR * scale)),
    ),
    yaw: swing.yaw + rng.spread(YAW_ERROR * scale),
    // The swing path follows the face. A player whose face is wrong is not
    // swinging along a different line than they think — they are swinging where
    // they meant to with the paddle turned, and that is what puts spin on a
    // mis-hit.
    pathAngle: swing.pathAngle + rng.spread(PITCH_ERROR * scale * 0.5),
  });
};

/**
 * How far off the read of the ball is, in metres, for this shot.
 *
 * Movement error rather than execution error. It is drawn once per shot, so the
 * player commits to a slightly wrong place and has to correct late, which is
 * what being beaten by a good shot looks like — as opposed to jittering, which
 * is what per-tick noise looks like and which averages out to nothing.
 */
export const readError = (skill: Skill, pressure: Pressure, rng: Rng): number =>
  rng.spread(skill.anticipation * (BASE_PRESSURE + (1 - BASE_PRESSURE) * pressure.total));

/**
 * The human.
 *
 * Level is low but not zero, and that is a deliberate feel decision rather than
 * a balance one: with level zero a player at full stretch hits the same shot as
 * a player standing still, and the reach ring reddening means nothing. At this
 * level a comfortable ball is essentially perfect and a stretched one is a real
 * risk, which is what the ring has been promising since Day 3.
 */
export const HUMAN: Skill = { level: 0.34, reaction: 0, anticipation: 0 };
