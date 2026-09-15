import { BallState } from './ball';
import * as C from './constants';
import { InputFrame } from './input';
import { POWER_SPOT_OFFSET, strike, withSwing, ContactResult } from './paddle';
import {
  PlayerState,
  Reach,
  createPlayer,
  emptyReach,
  isContactTick,
  reachTo,
  stepPlayer,
  strainToImpactOffset,
} from './player';
import { LIVE_SOLVE, ShotShape, ballAt, solveSwing, targetFor } from './solver';
import { Vec3, v3, copy, set } from './vec3';
import { SimEvent, World, createWorld, launch, step } from './world';

export type SessionEvent =
  | SimEvent
  | { type: 'contact'; result: ContactResult; strain: number; shape: ShotShape }
  | { type: 'whiff'; reason: 'out of reach' | 'mistimed' }
  | { type: 'feed' };

/**
 * A practice session: one player, and a machine that feeds them balls.
 *
 * This is not the rally state machine — there are no rules here, no score, no
 * two-bounce test. It exists because the player, the input model and the
 * contact model cannot be judged separately. Whether reach feels fair, whether
 * the swing delay feels responsive, and whether a stretched shot is punished
 * enough are all questions you can only answer with a ball coming at you.
 */
export interface Session {
  world: World;
  player: PlayerState;
  reach: Reach;
  events: SessionEvent[];
  /** Seconds until the next ball is fed, once the current one is done. */
  feedTimer: number;
  feedCount: number;
  /** Set on the tick a shot leaves the paddle; used by the sandbox HUD. */
  lastContact: ContactResult | null;
  lastStrain: number;
  lastTargetX: number;
  lastTargetZ: number;
}

const FEED_DELAY = 1.1;
/** Where the feeder stands and how high it releases the ball. */
const FEED_Z = -C.COURT_HALF_LENGTH + 0.4;
const FEED_HEIGHT = 0.9;

export const createSession = (): Session => ({
  world: createWorld(),
  player: createPlayer('near'),
  reach: emptyReach(),
  events: [],
  feedTimer: 0.4,
  feedCount: 0,
  lastContact: null,
  lastStrain: 0,
  lastTargetX: 0,
  lastTargetZ: 0,
});

/**
 * Send another ball. Feeds alternate sides so the player has to move, which is
 * the only thing that makes the reach model observable.
 *
 * The feed goes through the solver rather than being aimed by hand. The first
 * version pointed a velocity vector at the target and set an elevation that
 * looked about right; it put every ball into the net, because pointing at a
 * target is not the same as reaching it once drag and gravity are involved.
 * That is precisely what the solver exists to do, and a feeder that quietly
 * disagrees with the shot model is a feeder that tests the wrong thing.
 */
export const feed = (session: Session, laneBias = 0): void => {
  const lane = laneBias || (session.feedCount % 2 === 0 ? -1 : 1) * 1.5;
  const depth = 3.6 + (session.feedCount % 3) * 0.6;
  const ball = ballAt(v3(-lane * 0.4, FEED_HEIGHT, FEED_Z));
  // A lofted feed, not a drive. A driven feed skids through at ankle height
  // and is a hard ball to practise on; an arcing one lands short and sits up
  // into the strike zone, which is what a coach with a basket actually does.
  const solved = solveSwing(
    ball,
    { targetX: lane, targetZ: depth, shape: 'lob', facing: 1 },
    {},
    LIVE_SOLVE,
  );
  strike(ball, solved.swing);
  launch(session.world, ball.pos, ball.vel, ball.spin);
  session.feedCount += 1;
  session.events.push({ type: 'feed' });
};

/**
 * Advance the whole session one fixed tick.
 *
 * Order matters and is worth stating: the player moves first, then the ball,
 * then contact is resolved. Moving the player first means the paddle arrives
 * where the player has just got to, not where they were a tick ago, which is
 * the difference between a shot feeling reachable and feeling stolen.
 */
export const stepSession = (session: Session, input: InputFrame): SessionEvent[] => {
  session.events.length = 0;
  const { world, player } = session;

  stepPlayer(player, input, C.SIM_DT);

  const contactNow = isContactTick(player, C.SIM_DT);
  if (contactNow) resolveContact(session);

  for (const e of step(world)) session.events.push(e);

  // Feed the next ball once this one is done with.
  if (world.ball.resting) {
    session.feedTimer -= C.SIM_DT;
    if (session.feedTimer <= 0) {
      feed(session);
      session.feedTimer = FEED_DELAY;
    }
  } else {
    session.feedTimer = FEED_DELAY;
  }

  reachTo(player, world.ball, session.reach);
  return session.events;
};

const _ballCopy: BallState = {
  pos: v3(),
  vel: v3(),
  spin: v3(),
  resting: false,
};

const resolveContact = (session: Session): void => {
  const { world, player } = session;
  const ball = world.ball;

  if (ball.resting) {
    session.events.push({ type: 'whiff', reason: 'mistimed' });
    return;
  }

  const reach = reachTo(player, ball, session.reach);
  if (!reach.canReach) {
    session.events.push({ type: 'whiff', reason: 'out of reach' });
    return;
  }

  const shape = player.queuedShape;
  const { targetX, targetZ } = targetFor(
    shape,
    player.queuedAimX,
    player.queuedAimZ,
    player.facing,
  );
  session.lastTargetX = targetX;
  session.lastTargetZ = targetZ;

  // Solve at the ball's actual state, then apply the swing the solver found
  // with the impact point the player's position has earned them.
  copyBall(_ballCopy, ball);
  const solved = solveSwing(
    _ballCopy,
    { targetX, targetZ, shape, facing: player.facing },
    {},
    LIVE_SOLVE,
  );

  const impactOffset = strainToImpactOffset(reach.strain, POWER_SPOT_OFFSET);
  const swing = withSwing(solved.swing, { impactOffset });
  const result = strike(ball, swing);

  session.lastContact = result;
  session.lastStrain = reach.strain;
  session.events.push({ type: 'contact', result, strain: reach.strain, shape });
};

const copyBall = (out: BallState, from: BallState): void => {
  copy(out.pos, from.pos);
  copy(out.vel, from.vel);
  copy(out.spin, from.spin);
  out.resting = from.resting;
};

/**
 * Where the paddle is drawn: held out toward the ball, at reach.
 *
 * It only tracks the ball's height while the ball is actually playable. The
 * first version followed it always, so a lofted feed four metres up dragged
 * the paddle to full stretch over the player's head and it read as a bug.
 * Out of reach, the paddle returns to a ready height in front of the body.
 */
const READY_HEIGHT = 0.95;

export const paddlePosition = (out: Vec3, session: Session): Vec3 => {
  const p = session.player.pos;
  const b = session.world.ball.pos;
  const dx = b.x - p.x;
  const dz = b.z - p.z;
  const d = Math.hypot(dx, dz);
  const playable = session.reach.canReach;
  const hold = playable ? Math.min(d, C.PLAYER_REACH * 0.8) : 0.42;
  const y = playable
    ? Math.min(C.PLAYER_STRIKE_HIGH, Math.max(C.PLAYER_STRIKE_LOW, b.y))
    : READY_HEIGHT;
  return d < 1e-4
    ? set(out, p.x, READY_HEIGHT, p.z + session.player.facing * 0.42)
    : set(out, p.x + (dx / d) * hold, y, p.z + (dz / d) * hold);
};
