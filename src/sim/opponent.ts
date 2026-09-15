import * as C from './constants';
import { STYLES, Style } from './style';
import { Side } from './court';
import { InputFrame } from './input';
import { interceptPoint, receivePosition } from './intercept';
import { Skill, pressureOf, readError } from './execution';
import { PlayerState, emptyReach, inKitchen, reachTo } from './player';
import { Match } from './rules';
import { Rng } from './rng';
import { ShotShape } from './solver';
import { Vec3, v3, set } from './vec3';
import { World, predictBall } from './world';

/**
 * A computer player.
 *
 * It produces `InputFrame`s and nothing else — the same four fields a keyboard
 * produces — and it is handed the same world every player sees. That is not
 * tidiness for its own sake. It means the opponent cannot cheat by reaching
 * into the simulation, that a recorded match replays with the opponent in it,
 * and that this brain can drive the near player just as well, which is how the
 * headless tally tool gets two real players to watch.
 *
 * Day 5 measured a game between two placeholder players and found something
 * that decided the shape of this file: across 48 rallies, not one ball went
 * out and not one went into the net. Every point was won because somebody
 * could not reach. So the interesting decisions here are about *position* —
 * where to stand, where to send them, when to come forward — and the shot
 * chosen is mostly a means to move the other player.
 */

/** Where on the court a shot is being struck from. Drives everything else. */
export type Zone = 'net' | 'transition' | 'back';

/**
 * Zone boundaries, in metres from the net on your own side.
 *
 * `NET_ZONE_END` sits just past where the kitchen rail holds a player: with
 * the rail at 2.13 m and a body radius of 0.28 m, a player at the rail strikes
 * from about 2.4 m, and anything inside 3.2 m is playing that game.
 * `BACK_ZONE_START` is the more interesting number — see `chooseShot`.
 */
const NET_ZONE_END = 3.2;
const BACK_ZONE_START = 5.2;

export const zoneOf = (z: number): Zone => {
  const depth = Math.abs(z);
  if (depth < NET_ZONE_END) return 'net';
  if (depth < BACK_ZONE_START) return 'transition';
  return 'back';
};

export interface ShotContext {
  /** Contacts so far: a settled net exchange offers a chance to change pace. */
  rallyHits?: number;
  /** Where the ball will be struck. */
  contact: Vec3;
  /** Where the other player is standing. */
  otherX: number;
  /** How stretched this contact is, 0 comfortable to 1 at full reach. */
  strain: number;
  /** Which end of the court the striker is playing from. */
  facing: -1 | 1;
  /**
   * Are the opponents already at their non-volley line?
   *
   * Doubles only. It is what makes a deep ball a third-shot drop rather than a
   * drive: driving into two paddles standing at the net is how you lose a point,
   * and dropping at their feet is how you get to join them.
   */
  foeAtLine?: boolean;
  /**
   * What kind of player is hitting this ball.
   *
   * Optional, and it defaults to `all court`, which holds exactly the constants
   * the policy had before Day 22. That default is what makes every pre-existing
   * test still a test of the policy rather than of the refactor.
   */
  style?: Style;
}

export interface ShotChoice {
  shape: ShotShape;
  /** Lateral target, in world x, -1 to 1. Not mirrored per side. */
  aim: number;
  /**
   * How much ground to take after this shot, in metres, negative to give
   * ground back. Never the whole way: see `NET_STEP`.
   */
  step: number;
  /** Why, for the day log and for the on-screen readout. */
  reason: string;
}

/**
 * How far forward a soft shot earns you, and why it is not "all the way".
 *
 * The first version of this made advancing a boolean: play a drop, stand at
 * the rail. It lost 0-11. Every drop sent it sprinting four metres forward,
 * and the next deep drive went past it, because a player at the rail cannot
 * retreat to the baseline inside one shot. That is not a bug in the movement —
 * it is exactly what happens to a real player who follows a mediocre drop in.
 *
 * The sport's answer is that you take the ground one step at a time and stop
 * where you are when they strike, and you only take a step at all if the shot
 * you just hit gives you time to. So advancing is metres per shot, and a shot
 * played under pressure gives ground back.
 */
const NET_STEP = 1.3;
const GIVE_GROUND = -1.1;
/** A deep drive struck in balance is worth a step, but only a small one. */
const APPROACH_STEP = 0.55;

/**
 * The deepest contact a drop can be played from.
 *
 * Past this the ball has to travel too far to land in a seven-foot box, and
 * the solver puts it long. Day 5 found this the expensive way, when the
 * placeholder played the textbook third-shot drop off a return of serve struck
 * from two metres behind the baseline, and every one went out.
 */
const DROP_RANGE = 4.6;

/**
 * Two constants that became style fields on Day 22.
 *
 * `ATTACK_HEIGHT = 0.95` and `STRETCHED = 0.78` used to live here. They are now
 * `attackHeight` and `lobAt` on the style, and the `all court` archetype holds
 * exactly those two numbers so the default policy is byte-for-byte the one that
 * shipped. Their history is worth keeping and has moved to `src/sim/style.ts`
 * with them — in particular that STRETCHED was 0.62 first, and a third of every
 * shot in a self-play game came out as a defensive lob, because with any read
 * error at all a player is routinely half a metre off and half a metre is 0.62
 * of a 1.15 m reach.
 */
/**
 * How stretched you may be and still try a third-shot drop.
 *
 * Tighter than STRETCHED, because a drop played off balance sits up and gets put
 * away, which is worse than a deep drive that at least keeps you in the point.
 */
const THIRD_SHOT_LIMIT = 0.45;

/**
 * Choose a shot from where you are standing.
 *
 * The rule that matters is the first one, and it was learned the hard way on
 * Day 5: a drop struck from behind the baseline always goes out. The
 * placeholder played the real third-shot-drop pattern by shot number, which is
 * how the pattern is taught, and every one of them landed long — because the
 * pattern assumes you are inside the court, and the return of serve is struck
 * two metres behind it. So the deciding input here is the contact *position*,
 * never the shot count. That is the honest version of the same rule.
 */
export const chooseShot = (ctx: ShotContext): ShotChoice => {
  const style = ctx.style ?? STYLES['all court'];
  const zone = zoneOf(ctx.contact.z);
  const high = ctx.contact.y > style.attackHeight;

  // Aim away from where they are standing. This is the whole of the offence,
  // and Day 5's second finding is why: the placeholder had aim *error* and
  // beat a scripted player with none, because spread is what makes a ball hard
  // to reach. A shot's value here is the distance it makes somebody run.
  //
  // Style scales the width rather than replacing it. A wall aims nearer the
  // middle because a wide dink from the kitchen is how you hand somebody an
  // angle; a banger aims wider than is wise.
  //
  // Clamped where it is produced, not where it is consumed. `aim` is documented
  // as -1 to 1 and a style's spread is a multiplier, so a banger's 1.25 times
  // the 0.85 of a put-away is 1.0625 — off the court. `driveOpponent` already
  // clamped on the way out, so the game was never wrong; the CONTRACT was, and
  // a contract that only holds because one caller is careful is a contract that
  // breaks when a second caller appears.
  const away = (ctx.otherX >= 0 ? -1 : 1) * style.spread;
  const aimed = (fraction: number): number => Math.max(-1, Math.min(1, away * fraction));

  // How much ground this player takes after a shot. One multiplier for both
  // step sizes, so a style cannot accidentally be timid going forward and
  // reckless coming in.
  const netStep = NET_STEP * style.netUrge;
  const approach = APPROACH_STEP * style.netUrge;

  if (ctx.strain > style.lobAt) {
    // Stretched. Buy time, give ground, and reset the point rather than trying
    // to win it from a position that cannot win it.
    return { shape: 'lob', aim: aimed(0.25), step: GIVE_GROUND, reason: 'stretched, reset' };
  }

  const depth = Math.abs(ctx.contact.z);
  const deep = zone === 'back' || depth > DROP_RANGE;

  // The third shot drop, and the reason doubles is a different sport.
  //
  // Day 6 spotted the loop this breaks and patched it with a 0.55 m creep: a
  // baseline exchange where nobody is ever inside the court, so nobody can play
  // a drop, so nobody gets any further in. In singles the creep is enough,
  // barely. In doubles it is arithmetically hopeless — a depth histogram over
  // three games had the team at 5.7 m or 6.2 m for 96 per cent of live ticks and
  // at the line for 1 per cent — and the measured cause was upstream of any
  // positioning code: 94 per cent of doubles shots were drives, because a player
  // at the baseline is in the back zone and the back zone always drives.
  //
  // The sport's answer is not to creep. It is to hit a soft ball that lands in
  // their kitchen and walk in behind it, from the baseline, against opponents who
  // are already at the net. It is the hardest shot in pickleball and it is the
  // whole third shot. Without it the pair has no way in and no reason to be a
  // pair.
  //
  // Day 22: and a banger does not have this shot. Not a worse version of it —
  // none of it. They drive the third ball and take their chances, which is a
  // real way to play and a real way to lose.
  if (deep && style.thirdShotDrop && ctx.foeAtLine && ctx.strain < THIRD_SHOT_LIMIT) {
    return { shape: 'drop', aim: aimed(0.2), step: netStep, reason: 'third shot drop' };
  }

  if (deep) {
    // Too deep to drop. Drive it deep — and take a step behind it if it was
    // struck in balance, which is how a singles player actually gets forward.
    // Without this the game settles into a stable baseline exchange and the
    // soft game never happens: nobody is ever inside the court, so nobody can
    // ever play a drop, so nobody ever gets any further in.
    const balanced = ctx.strain < 0.35;
    return {
      shape: 'drive',
      aim: aimed(0.72),
      step: balanced ? approach : 0,
      reason: balanced ? 'drive and approach' : 'deep drive',
    };
  }

  if (zone === 'transition') {
    if (high) {
      return { shape: 'drive', aim: aimed(0.8), step: netStep, reason: 'attack the high ball' };
    }
    /**
     * Soft or hard from the transition zone, decided by temperament.
     *
     * This is the branch where a style is most visible to a person playing
     * against it, because it is the shot that decides whether the next ten
     * seconds are a dink rally or a firefight. `aggression` is compared against
     * a fixed line rather than randomised: an opponent who plays the same ball
     * differently on a coin flip is not a character, they are noise, and a
     * player cannot learn anything from noise.
     */
    if (style.aggression > 0.8) {
      return { shape: 'drive', aim: aimed(0.75), step: netStep, reason: 'bang it through' };
    }
    // The third-shot drop, chosen because of where the feet are rather than
    // because of the shot count, and worth one step forward rather than four.
    return { shape: 'drop', aim: aimed(0.35), step: netStep, reason: 'drop and step in' };
  }

  // At the rail. A ball above the net gets driven; anything else gets dinked
  // back, which is the game the kitchen is supposed to create.
  //
  // Day 22: `high` is now the style's own attack height, so a banger tries to
  // put away balls that are below the net and a wall waits for one that is
  // genuinely sitting up. Same branch, different threshold.
  const speedUp = (ctx.rallyHits ?? 0) >= 6 && style.aggression >= 0.5 &&
    ctx.contact.y >= 0.4 && ctx.strain < 0.35;
  if (!high && speedUp) {
    return { shape: 'drive', aim: aimed(0.8), step: netStep, reason: 'speed up the exchange' };
  }
  return high
    ? { shape: 'drive', aim: aimed(0.85), step: netStep, reason: 'put it away' }
    : { shape: 'drop', aim: aimed(0.45), step: netStep, reason: 'dink' };
};

export interface Opponent {
  side: Side;
  facing: -1 | 1;
  /** Seeded; every decision that is not deterministic comes from here. */
  rng: Rng;
  /** Seconds still to wait before reacting to the shot just struck. */
  reactionLeft: number;
  /** Which shot number this player last reacted to, so it reacts once. */
  reactedTo: number;
  /** How well it moves and executes. One object, so difficulty is one swap. */
  skill: Skill;
  /** Which preset that skill came from. */
  difficulty: Difficulty;
  /** What kind of player this is. Independent of difficulty: see style.ts. */
  style: Style;
  /** How far its read of this shot is off, in metres. Drawn once per shot. */
  readOff: number;
  /** The depth, in metres from the net, it is currently trying to hold. */
  stance: number;
  /** The last shot it chose, for the readout. */
  lastReason: string;
  /** Seconds left of the pause before it serves. */
  serveIn: number;
  /**
   * Where to stand when the ball is the partner's. Written by the rally from
   * `supportPosition`, read here. Ignored in singles.
   */
  support: { x: number; z: number };
  /**
   * Are the opponents standing at their non-volley line? Written by the rally.
   *
   * The one fact that turns a deep drive into a third-shot drop. False in
   * singles, where the creep-forward model is measured and works.
   */
  foeAtLine: boolean;
  /** Is there a partner on this end? Written by the rally. */
  paired: boolean;
}

export type Difficulty = 'easy' | 'steady' | 'tough';

/**
 * The three levers, and what each one actually does to a rally.
 *
 * `reaction` is time lost before moving, which costs ground and turns a
 * comfortable ball into a stretched one. `anticipation` is how wrong the read
 * of the ball is, which puts them in slightly the wrong place and makes them
 * correct late. `level` scales the mis-hit once they get there.
 *
 * They are deliberately not one slider. A slow-but-clean opponent and a
 * quick-but-wild one are different games to play against, and collapsing them
 * into "difficulty 0.4" throws that away. The presets pick points on all three
 * that hang together, and each was set by playing eight self-play games and
 * reading `tools/tally.mjs` — the tuning is in the day log.
 */
export const LEVELS: Record<Difficulty, Skill> = {
  easy: { level: 0.78, reaction: 0.42, anticipation: 0.55 },
  steady: { level: 0.6, reaction: 0.26, anticipation: 0.2 },
  // Retuned on Day 10, after `tools/playtest.mjs` measured the levels against a
  // stand-in for a person rather than against copies of themselves.
  //
  // It was `{ level: 0.36, reaction: 0.15, anticipation: 0.07 }`, which was
  // better than `steady` on all three axes at once — and that is exactly why it
  // was unbeatable rather than hard. A strong stand-in swept `steady` 12-0 in
  // games and took *zero* games off `tough` in six matches; only a player
  // replanning every frame with a 100 ms reaction could beat it, and that is not
  // a person. A top level has to give something back somewhere, and this gives
  // back movement: still quicker and surer than `steady`, no longer beyond
  // anybody. The same stand-in now takes two matches in six.
  //
  // What it costs: `tough` no longer separates cleanly from `steady` in
  // `tools/tally.mjs`, whose two ends are copies of each other. That tool was
  // the wrong instrument for this question, which is what DINK-55 was about.
  tough: { level: 0.45, reaction: 0.2, anticipation: 0.14 },
};

export const createOpponent = (
  side: Side,
  rng: Rng,
  difficulty: Difficulty = 'steady',
  style: Style = STYLES['all court'],
): Opponent => ({
  side,
  facing: side === 'near' ? -1 : 1,
  rng,
  reactionLeft: 0,
  reactedTo: -1,
  skill: { ...LEVELS[difficulty] },
  difficulty,
  readOff: 0,
  style,
  // Where this player stands when nothing is forcing them anywhere. A crasher
  // starts at the line and a banger starts behind the baseline, which is
  // visible before the first ball is struck — and that is the point: a player
  // should be able to read the opponent from where they choose to stand.
  stance: holdStance(style, style.homeDepth),
  lastReason: '',
  serveIn: SERVE_PAUSE,
  support: { x: 0, z: 0 },
  foeAtLine: false,
  paired: false,
});

/**
 * How far back this player is willing to be pushed.
 *
 * Day 22, and the fix for a measured failure rather than an idea. `homeDepth`
 * originally set only the opening stance, and `tools/styles.mjs` said so
 * immediately: `crasher` and `all court` came out 10.9 apart on a scale where
 * anything under 12 is the same player. A crasher started on the kitchen line,
 * got driven back once, and spent the rest of the match at the baseline like
 * everybody else, because the retreat clamp was `BASELINE_STANCE` for all
 * comers.
 *
 * So a style now owns both ends of its range. GIVE_GROUND still works — a
 * player under pressure still backs up — but a crasher backs up to 3.4 m rather
 * than 6.2 and comes straight back, which is what committing to the line
 * actually means. It is also what makes the commitment cost something: a player
 * who will not retreat is a player you lob.
 *
 * The allowance is deliberately small. Zero would pin a style to one line and
 * make it a rail rather than a preference, and this project has already spent a
 * day removing one rail from the kitchen.
 */
const RETREAT_ALLOWANCE = 0.8;
const deepestStance = (style: Style): number =>
  Math.min(BASELINE_STANCE, style.homeDepth + RETREAT_ALLOWANCE);

/** Clamp a stance into the range this particular player is willing to occupy. */
const holdStance = (style: Style, z: number): number =>
  Math.max(NVZ_STANCE, Math.min(deepestStance(style), z));

/** Change difficulty without losing the point in progress. */
/** Change what kind of player this is, without touching how good they are. */
export const setStyle = (opp: Opponent, style: Style): void => {
  opp.style = style;
  opp.stance = holdStance(style, style.homeDepth);
};

export const setDifficulty = (opp: Opponent, difficulty: Difficulty): void => {
  opp.difficulty = difficulty;
  opp.skill = { ...LEVELS[difficulty] };
};

/** A beat before serving, so the point does not start the instant the last one ends. */
const SERVE_PAUSE = 0.9;

/** Where a point starts: a half-step inside the baseline. */
export const BASELINE_STANCE = C.COURT_HALF_LENGTH - 0.5;
/**
 * Where it holds when it has earned the front: just behind the non-volley line.
 *
 * A hand's width behind rather than on it, because standing exactly on the line
 * means every volley is a coin toss with the momentum rule. Real players stand
 * a shoe's length back for the same reason.
 */
export const NVZ_STANCE = C.KITCHEN_DEPTH + C.PLAYER_RADIUS + 0.12;

/** Start of a point: back behind the baseline, and no memory of the last one. */
export const resetOpponent = (opp: Opponent): void => {
  opp.stance = holdStance(opp.style, opp.style.homeDepth);
  opp.reactedTo = -1;
  opp.reactionLeft = 0;
  opp.lastReason = '';
  opp.serveIn = SERVE_PAUSE;
};

/**
 * Where to wait when the ball is not yours to play.
 *
 * Two decisions in one line each. Depth is the stance: at the rail if the last
 * shot earned the trip forward, at the baseline otherwise. Lateral is the
 * bisector — you do not stand in the middle of the court, you stand in the
 * middle of the angle they can hit into, which is a little toward their side.
 */
const homePosition = (out: Vec3, opp: Opponent, otherX: number): Vec3 => {
  const own = opp.side === 'near' ? 1 : -1;
  return set(out, otherX * 0.25, 0, own * opp.stance);
};

const _stand = v3();
const _future = v3();
const _contact = v3();
const _plannedReach = emptyReach();

/**
 * One tick of thought, as an InputFrame.
 *
 * Order matters and is worth reading as a sentence: react, decide where to
 * stand, walk there, and swing only if the paddle would arrive at the same
 * moment the ball does.
 */
export const driveOpponent = (
  opp: Opponent,
  world: World,
  match: Match,
  self: PlayerState,
  other: PlayerState,
  out: InputFrame,
  /**
   * Day 15. Whether this ball is this player's to play.
   *
   * Always true in singles. In doubles the team decided it once, when the shot
   * was struck, and a player who does not own the ball must not swing at it —
   * not because it would be illegal, but because a partner who takes balls out
   * of your paddle is the most disliked behaviour in co-op sports AI.
   */
  owns = true,
): void => {
  const p = self.pos;
  const own = opp.side === 'near' ? 1 : -1;

  // Not your ball: hold the pair's shape and keep the paddle down. `support` is
  // set by the caller from `supportPosition`, so the geometry of a doubles pair
  // lives in team.ts rather than being reinvented here.
  if (!owns && match.phase !== 'awaitingServe') {
    out.swing = false;
    out.moveX = Math.max(-1, Math.min(1, (opp.support.x - p.x) * 3));
    out.moveZ = Math.max(-1, Math.min(1, (opp.support.z - p.z) * 3));
    opp.lastReason = 'covering';
    return;
  }

  // Serving is just another input frame. Handling it here rather than in the
  // rally means `stepRally` has no idea which end is a person: it serves for
  // whichever side asked to, and one code path covers a human, this opponent,
  // and a demo mode playing itself.
  if (match.phase === 'awaitingServe') {
    out.moveX = 0;
    out.moveZ = 0;
    opp.serveIn -= C.SIM_DT;
    // `owns` is the rules' answer to which partner is serving, forced rather
    // than scored. Without it BOTH players on the serving team ask to serve
    // every tick. Nothing broke, because the rally reads only the correct
    // server's frame — but a frame that says "I am serving" from a player who is
    // not is a lie waiting for the first caller to read frames generically.
    out.swing = match.server === opp.side && owns && opp.serveIn <= 0;
    return;
  }
  opp.serveIn = SERVE_PAUSE;

  // Recover while the ball is away, and keep recovering during the read delay.
  // Reacting to our OWN shot froze the player instead of following it forward.
  if (opp.paired) set(_stand, opp.support.x, 0, opp.support.z);
  else homePosition(_stand, opp, other.pos.x);
  out.moveX = Math.max(-1, Math.min(1, (_stand.x - p.x) * 3));
  out.moveZ = Math.max(-1, Math.min(1, (_stand.z - p.z) * 3));
  out.swing = false;
  if (match.lastHitBy === opp.side || world.ball.resting || match.phase !== 'inPlay') {
    opp.reactionLeft = 0;
    return;
  }

  const mine = own * world.ball.pos.z > 0.4 && !world.ball.resting;
  const bounced = match.bouncesSinceHit > 0;
  const mustLet = match.hitsThisRally < 3;

  // React once per shot, and choose this shot's error at the same moment. Both
  // belong to the shot, not to the tick: re-rolling error every frame averages
  // it away to nothing, which is the standard way an error model quietly stops
  // existing.
  if (match.hitsThisRally !== opp.reactedTo) {
    opp.reactedTo = match.hitsThisRally;
    opp.reactionLeft = opp.skill.reaction;
    // How badly this particular ball is read. Drawn once, so the player commits
    // to slightly the wrong place and has to correct late — which is what being
    // beaten by a good shot looks like. Redrawn every tick it would jitter, and
    // jitter averages to nothing.
    const seen = pressureOf(world.ball, world.ball.pos.y, 0, 0);
    opp.readOff = readError(opp.skill, seen, opp.rng);
  }
  if (opp.reactionLeft > 0) {
    opp.reactionLeft -= C.SIM_DT;
    out.swing = false;
    return;
  }

  // Where the ball can be STRUCK, which is not where the ball will be. Asked
  // for on every tick regardless of which side the ball is on, because a
  // receiver starts moving when the ball is hit, not when it arrives.
  const meeting = interceptPoint(world, opp.side, { requireBounce: mustLet && !bounced });
  if (meeting) {
    // You may stand in the kitchen to play a ball that has ALREADY BOUNCED, and
    // for no other reason. That is the rule the sport plays by and, as of today,
    // the rule this player positions by.
    //
    // Day 12 removed the rail. Day 17 let the AI use the space and scoped it to
    // doubles, because singles turned into a 2,569-shot stalemate. Day 18 found
    // the doubles version of the same defect, wearing a different hat: the
    // receiving pair camped inside the zone, where every ball is an illegal
    // volley, so they waited for a bounce that landed behind them. 81 per cent
    // of all doubles rallies ended on the third shot, and in 97 per cent of those
    // the ball came within reach of somebody who never swung at it.
    //
    // Standing in there is not a place to wait. It is somewhere you step for one
    // shot and step out of, and `meeting.bounced` is exactly that question
    // already answered.
    receivePosition(_stand, opp.facing, meeting.pos, 0.45, bounced || meeting.bounced);
    _stand.x += opp.readOff;
  } else if (opp.paired) {
    // Waiting, with a partner. Go to YOUR half, not to the middle.
    //
    // `homePosition` puts a singles player on the bisector of the angle the
    // opponent can hit into, which is near the centre of the court. That is
    // correct with one player covering everything and wrong with two: the trace
    // said 56 per cent of all remaining crowding was this exact state, a pair
    // waiting for a ball on the other side of the net with one of them standing
    // in the middle and the other at their station 0.87 m away.
    set(_stand, opp.support.x, 0, opp.support.z);
  } else {
    homePosition(_stand, opp, other.pos.x);
  }

  out.moveX = Math.max(-1, Math.min(1, (_stand.x - p.x) * 3));
  out.moveZ = Math.max(-1, Math.min(1, (_stand.z - p.z) * 3));

  const future = predictBall(world, C.SWING_WINDUP).pos;
  set(_future, future.x, future.y, future.z);
  const distance = Math.hypot(_future.x - p.x, _future.z - p.z);
  // Day 12: it may not volley out of the kitchen. Standing in there is legal —
  // it steps in to play a ball that bounced — so the gate is on the shot, not on
  // the position: if the ball has not bounced and its feet are in the zone, it
  // waits. Letting the ball bounce is always available and always legal, which
  // is why this is a `&&` rather than a retreat.
  const wouldVolleyIllegally = !bounced && inKitchen(self);

  const swinging =
    mine &&
    (!mustLet || bounced) &&
    !wouldVolleyIllegally &&
    self.phase === 'ready' &&
    distance < 0.9 &&
    _future.y > C.PLAYER_STRIKE_LOW &&
    _future.y < C.PLAYER_STRIKE_HIGH + 0.25;

  out.swing = swinging;
  if (!swinging) return;

  // Decide the shot from the contact that is about to happen, not from where
  // the player is now: the two differ by up to a metre of reach, and the
  // difference is exactly what separates a dink from a drive.
  set(_contact, _future.x, _future.y, _future.z);

  // Strain has to be measured where the player will BE at contact, not where
  // they are standing when the swing starts. Measuring it from here made
  // almost every shot read as stretched — the swing gate allows contact up to
  // 0.9 m away, which is 78 per cent of reach before the player has moved an
  // inch, and the windup is 120 ms of running. The opponent spent whole
  // rallies playing defensive lobs off comfortable balls.
  // Use the contact model's comfort zone. Distance / maximum reach counted
  // even a routine 0.6 m contact as stretched and suppressed nearly every
  // approach and speed-up decision.
  const plannedPlayer = { ...self, pos: v3(
    p.x + self.vel.x * C.SWING_WINDUP, 0, p.z + self.vel.z * C.SWING_WINDUP,
  ) };
  const strain = reachTo(plannedPlayer, { ...world.ball, pos: _future }, _plannedReach).strain;
  const choice = chooseShot({
    rallyHits: match.hitsThisRally,
    contact: _contact,
    otherX: other.pos.x,
    strain,
    facing: opp.facing,
    foeAtLine: opp.foeAtLine,
    style: opp.style,
  });

  opp.lastReason = choice.reason;
  opp.stance = holdStance(opp.style, opp.stance - choice.step);
  out.shape = choice.shape;
  // No aim jitter here any more. Nudging the aim produced a different *perfect*
  // shot, and Day 5 measured what that does: spread makes a ball harder to
  // reach, so an opponent with aim error beat one without. The error now lives
  // in the swing, where it can cost the player who made it.
  out.aimX = Math.max(-1, Math.min(1, choice.aim));
  // The stand-in does not steer depth, and that is a decision rather than an
  // omission. `aimZ = 0` is exactly the depth every shape was played at before
  // depth was steerable, so the difficulty ladder, the rally profile and the
  // hold rate all keep measuring the opponent they were calibrated against. A
  // policy that used the new axis would be a balance change wearing a control
  // change's clothes, and it would land the evening before a playtest. DINK-134.
  out.aimZ = 0;
};
