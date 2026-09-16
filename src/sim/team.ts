import * as C from './constants';
import { Side, Slot, otherSlot } from './court';
import { interceptPoint } from './intercept';
import { PlayerState } from './player';
import { BASELINE_STANCE, NVZ_STANCE } from './opponent';
import { Match, rightCourtSlot } from './rules';
import { World } from './world';

/**
 * Who takes the ball.
 *
 * This is the whole of doubles that a computer partner gets wrong, and it fails
 * in exactly two ways. Both players chase, collide, and one of them plays a shot
 * they had no business at. Or both leave it, watch it bounce between them, and
 * the human blames the partner — correctly.
 *
 * The fix is not cleverness, it is committing. A claim is decided ONCE per shot
 * and held until the next one, in the same way that the opponent draws its
 * reaction and its misread once per shot rather than every tick. That is the
 * lesson this project keeps relearning: a decision re-made sixty times a second
 * is not a decision, it is an average, and an averaged claim is two players
 * drifting toward the same ball at half commitment each.
 */
export interface TeamPlan {
  /** Which player on this team is playing the next ball. */
  owner: Slot;
  /**
   * The rally hit count the claim was made for.
   *
   * The claim is recomputed when this changes and at no other time. -1 means
   * nothing has been claimed yet this point.
   */
  decidedFor: number;
  /** Why, in words, for the readout and for the day log. */
  reason: string;
  /**
   * How far off the net the whole team is trying to stand, in metres.
   *
   * Day 16. Depth used to live on each player, as `Opponent.stance`, and each
   * player advanced or gave ground on their own. That is singles thinking. In
   * doubles a pair moves as a unit, and a pair that does not is a lob waiting to
   * happen on one side and an open tramline on the other.
   *
   * Only the player who plays the ball changes it — they are the one who earned
   * the step forward or was pushed back — and everybody stands at it. Singles is
   * the same code with a team of one, which is why this replaced `stance`
   * outright rather than sitting beside it.
   */
  depth: number;
  /** Which shape the pair is holding. Reported, not chosen: it falls out of depth. */
  shape: 'side by side' | 'up and back';
}

export const createTeamPlan = (): TeamPlan => ({
  owner: 0,
  decidedFor: -1,
  reason: '',
  depth: BASELINE_STANCE,
  shape: 'side by side',
});

export const resetTeamPlan = (plan: TeamPlan): void => {
  plan.decidedFor = -1;
  plan.reason = '';
  plan.depth = BASELINE_STANCE;
  plan.shape = 'side by side';
};

/**
 * How near the centre line a ball has to be to count as "down the middle".
 *
 * The middle ball is the one doubles arguments are about. Inside this band the
 * arithmetic of who is closer stops deciding it, because two players a metre
 * apart both being "closest by 10 cm" on alternate shots is the thrash the
 * commit-once rule exists to prevent.
 */
const MIDDLE_BAND = 0.9;

/**
 * A human beats their partner on anything they can plausibly reach.
 *
 * Not because it produces better doubles — it does not — but because a partner
 * that takes balls out of your paddle is the single most disliked behaviour in
 * co-op sports AI. The player is allowed to be wrong. Their partner is not
 * allowed to overrule them.
 */
const HUMAN_BIAS_SECONDS = 0.35;

/**
 * What it costs to take a ball in your partner's half.
 *
 * Pure time-to-arrive is singles reasoning. It let a player who happened to be
 * one step nearer cross the centre line to play a ball their partner was
 * standing next to — which is two players in one half, a whole tramline open,
 * and the largest single source of crowding in the Day 16 trace: 57 per cent of
 * it, all at the back, all with the reason "closer".
 *
 * In doubles you cover your half. Being closer is a reason to take a ball in
 * your OWN half, not a licence to raid your partner's. Half a second of penalty
 * is about a stride and a half, which is roughly what a player would trade.
 */
const OUT_OF_HALF_SECONDS = 0.5;

/** Which way from the centre line this slot's half lies, in world x. */
export const halfSign = (side: Side, slot: Slot, teamScore: number): -1 | 1 => {
  const rightSign = side === 'near' ? 1 : -1;
  return (slot === rightCourtSlot(teamScore) ? rightSign : -rightSign) as -1 | 1;
};

/** Seconds for this player to get to a point, ignoring acceleration. */
const timeTo = (player: PlayerState, x: number, z: number): number =>
  Math.hypot(x - player.pos.x, z - player.pos.z) / C.PLAYER_MAX_SPEED;

/**
 * Decide who plays the next ball for one team.
 *
 * `forced` overrides everything, and the rules supply it: only the correct
 * server may serve, and only the correct receiver may take the serve. Those are
 * not preferences to be scored against distance, they are the rulebook, and
 * folding them into the same function is what stops a "sensible" claim from
 * conceding a point.
 *
 * `humanSlot` is the player a person is driving on this team, if any.
 */
export const planTeam = (
  plan: TeamPlan,
  world: World,
  match: Match,
  side: Side,
  players: PlayerState[],
  humanSlot: Slot | null = null,
  forced: Slot | null = null,
): TeamPlan => {
  if (players.length < 2) {
    plan.owner = 0;
    plan.decidedFor = match.hitsThisRally;
    plan.reason = 'singles';
    return plan;
  }
  if (forced !== null) {
    plan.owner = forced;
    plan.decidedFor = match.hitsThisRally;
    plan.reason = match.hitsThisRally === 0 ? 'serving' : 'receiving';
    return plan;
  }
  // Committed already for this shot. Leave it alone — that is the point.
  if (plan.decidedFor === match.hitsThisRally) return plan;

  const meeting = interceptPoint(world, side, {
    requireBounce: match.hitsThisRally < 3 && match.bouncesSinceHit === 0,
  });
  if (!meeting) return plan;

  plan.decidedFor = match.hitsThisRally;
  const cost = players.map((p) => {
    const t = timeTo(p, meeting.pos.x, meeting.pos.z);
    const mine = halfSign(side, p.slot, match.score[side]);
    const theirSide = meeting.pos.x !== 0 && Math.sign(meeting.pos.x) !== mine;
    return theirSide ? t + OUT_OF_HALF_SECONDS : t;
  });
  if (humanSlot !== null) cost[humanSlot] -= HUMAN_BIAS_SECONDS;

  // Down the middle: the left-court player takes it.
  //
  // This is the convention the sport already uses — for two right-handers the
  // left-court player's forehand covers the centre — and its real virtue here is
  // that it is a CONSTANT. "Whoever is closer" on a ball both players are
  // equidistant from is a coin toss that lands differently on consecutive
  // shots, and two players alternating who commits is precisely the middle-ball
  // argument this function exists to end.
  if (Math.abs(meeting.pos.x) < MIDDLE_BAND) {
    plan.owner = leftCourtPlayer(players).slot;
    plan.reason = 'middle ball';
    if (humanSlot !== null) plan.owner = humanSlot;
    // The convention is a tie-break, not an instruction to watch a ball die
    // beside the partner while the preferred player is across the court.
    const preferred = players[plan.owner];
    const alternate = players[otherSlot(plan.owner)];
    if (timeTo(preferred, meeting.pos.x, meeting.pos.z) >
        timeTo(alternate, meeting.pos.x, meeting.pos.z) + 0.6) {
      plan.owner = alternate.slot;
      plan.reason = 'covering middle';
    }
    return plan;
  }

  plan.owner = cost[0] <= cost[1] ? 0 : 1;
  plan.reason = 'closer';
  return plan;
};

/**
 * Which of the two is standing in their own left court.
 *
 * The right court is +x for the near side and -x for the far side — the same
 * piece of geometry that `serveFromX` owns and that this project has got
 * backwards more times than any other line. It is derived from there rather
 * than written out again.
 */
export const leftCourtPlayer = (players: PlayerState[]): PlayerState => {
  const leftSign = players[0].side === 'near' ? -1 : 1;
  return players[0].pos.x * leftSign >= players[1].pos.x * leftSign
    ? players[0]
    : players[1];
};

/**
 * Where the partner who is NOT playing the ball should be.
 *
 * A partner who freezes is the other half of why co-op AI feels bad, and it is
 * the half that loses points rather than merely annoying. A doubles pair moves
 * as a unit: same depth, because a split pair is a lob waiting to happen, and
 * shaded toward the middle, because the ball their partner is stretching for
 * comes back down the centre more often than anywhere else.
 */
export const supportPosition = (
  out: { x: number; z: number },
  self: PlayerState,
  plan: TeamPlan,
  teamScore: number,
  ballX = 0,
): { x: number; z: number } => {
  const own = self.side === 'near' ? 1 : -1;
  // Stand in your own half of the court, and stand at the team's depth.
  //
  // Both halves of that sentence are Day 16 corrections to Day 15, and both are
  // the same mistake: the support was reading its partner's LIVE POSITION for
  // both. Its x mirrored wherever the partner had run to, and its z copied the
  // partner's z outright — so when the owner chased a ball into the back corner,
  // the support followed them into the same corner. The pair crowded for 31 per
  // cent of live ticks and stood 1.80 m apart on a court 6.1 m wide.
  //
  // A station is not a mirror. Which half is yours is already decided by the
  // same invariant the serve rotation runs on: slot 0 is in the right court when
  // the team score is even. And depth belongs to the team, not to whoever
  // happens to be chasing.
  const rightSlot = rightCourtSlot(teamScore);
  const rightSign = self.side === 'near' ? 1 : -1;
  const mine = self.slot === rightSlot ? rightSign : -rightSign;
  // Both recovery stations shade toward play by the same bounded amount.
  // This closes the middle behind a wide ball without making the support
  // mirror a chasing partner or cross into the partner's assigned half.
  const shade = Math.max(-0.65, Math.min(0.65, ballX * 0.25));
  out.x = mine * (C.COURT_HALF_WIDTH / 2) + shade;
  out.z = own * Math.max(NVZ_STANCE, Math.min(C.COURT_HALF_LENGTH + 0.6, plan.depth));
  return out;
};

/*
 * There was a `coverTheRest` here for an hour: the support stood in the middle
 * of whichever gap its partner was not covering, on the reasoning that a fixed
 * station is wrong the moment the partner leaves theirs.
 *
 * It was measured and it lost. Crowding went from 16.4 to 16.6 per cent and mean
 * separation from 2.08 m to 1.94 m — worse on both. The trace said why: it made
 * the support CROSS THE COURT whenever its partner moved through the middle,
 * and the crossing goes straight past the partner. It created the traversals it
 * was meant to prevent.
 *
 * Ball-side shading above translates both stations equally instead; it does
 * not chase the partner's live position or swap their halves.
 */

/**
 * Where a team wants to stand after playing this shot.
 *
 * Day 16's actual finding, and it was arithmetic rather than intuition. Depth
 * advanced in singles-sized creeps: a drive from the back earns 0.55 m and a
 * shot from the net zone earns 1.3 m. Getting from the baseline at 6.21 m to the
 * non-volley line at 2.37 m therefore needs three good shots at best and seven
 * at worst — and a doubles rally lasts 3.2 shots, of which a team plays about
 * half. A depth histogram over three games settled it: the team spent 96 per
 * cent of live ticks at 5.7 m or 6.2 m and reached the line 1 per cent of the
 * time. It was not slow to get forward. It could not get forward.
 *
 * Doubles is played at the line, so the intent has to be the line. A drop or a
 * dink means "we are coming in" — that is what those shots are FOR — and the
 * team says so in one step instead of creeping. Whether they arrive is then a
 * question of legs and time, which is the split this project has run on since
 * Day 7: failing to arrive and failing to execute are different problems, and
 * intent belongs on the near side of that line.
 *
 * Singles keeps the creep. It has one player covering the whole court and no
 * partner to hold the line with, and its numbers are measured.
 */
export const advanceOn = (plan: TeamPlan, shape: 'drive' | 'drop' | 'lob'): void => {
  if (shape === 'drop') plan.depth = NVZ_STANCE;
  else if (shape === 'lob') plan.depth = Math.min(BASELINE_STANCE, plan.depth + 1.4);
  plan.shape = shapeOf(plan.depth);
};

/** The shape a pair is in, from their depth. Reported, never chosen. */
export const shapeOf = (depth: number): TeamPlan['shape'] =>
  depth < NVZ_STANCE + 1.2 ? 'up and back' : 'side by side';

export { otherSlot };
