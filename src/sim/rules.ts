import * as C from './constants';
import {
  Side,
  Slot,
  TeamSize,
  isInBounds,
  isInKitchen,
  opponentOf,
  otherSlot,
  sideOf,
} from './court';
import { SimEvent } from './world';
import { Vec3 } from './vec3';

/**
 * The rules of a game, singles or doubles, as a state machine fed by simulation
 * events.
 *
 * It touches no physics and no renderer: it is handed "the ball bounced here"
 * and "this player hit it" and answers with faults, points and whose serve it
 * is. That seam is why it can be tested exhaustively without ever launching a
 * ball, and why the opponent AI asks it what is legal rather than
 * reimplementing the rules in its own head.
 *
 * Singles is doubles with one player a side. That is not a slogan, it is how
 * this file is written: `teamSize` is the only branch, and it exists in exactly
 * two places — who serves next after a fault, and how many numbers are in the
 * call. Everything else is shared, which is why widening it did not disturb a
 * single existing singles test.
 */

export type ServeBox = 'right' | 'left';

export type Fault =
  | 'serve into net'
  | 'serve out'
  | 'serve wrong box'
  | 'serve into kitchen'
  | 'into net'
  | 'out'
  | 'double bounce'
  | 'volleyed too early'
  | 'volley in the kitchen'
  | 'missed';

export type ServerNumber = 1 | 2;

export type RuleEvent =
  | { type: 'fault'; by: Side; reason: Fault }
  | { type: 'point'; to: Side; score: { near: number; far: number } }
  | { type: 'sideOut'; to: Side }
  | { type: 'secondServer'; team: Side }
  | { type: 'rallyStart'; server: Side; slot: Slot; number: ServerNumber; box: ServeBox }
  | { type: 'gameOver'; winner: Side; score: { near: number; far: number } };

export type Phase = 'awaitingServe' | 'inPlay' | 'betweenPoints' | 'gameOver';

export interface Match {
  phase: Phase;
  /** Players a side. The only thing that distinguishes singles from doubles. */
  teamSize: TeamSize;
  /** Which end is serving. */
  server: Side;
  /**
   * Which player on that end is serving. Always 0 in singles.
   *
   * There is no stored `box`: which service court anyone is standing in falls
   * out of this and the score. See `serveBox`.
   */
  serverSlot: Slot;
  /**
   * The third number in a doubles call. Always 1 in singles.
   *
   * It is genuinely separate from `serverSlot` because of one irregular state:
   * the team that serves first in a doubles game is called "second server" while
   * standing in slot 0's court, so that the serve passes over on their first
   * fault. Deriving one from the other would make that state unrepresentable,
   * and it is a state the sport actually has.
   */
  serverNumber: ServerNumber;
  score: { near: number; far: number };
  /** Bounces since the last time anyone hit the ball. */
  bouncesSinceHit: number;
  /** Hits since the serve. 0 = serve not yet struck, 1 = serve, 2 = return. */
  hitsThisRally: number;
  /** Who last struck the ball. */
  lastHitBy: Side | null;
  /** Set the moment a point is decided, cleared when the next serve begins. */
  pendingFault: { by: Side; reason: Fault } | null;
}

/** Games are to 11, win by 2. */
export const GAME_TARGET = 11;
export const WIN_BY = 2;

export const createMatch = (server: Side = 'near', teamSize: TeamSize = 1): Match => ({
  phase: 'awaitingServe',
  teamSize,
  server,
  serverSlot: 0,
  // The whole point of the opening exception. A doubles game starts 0-0-2:
  // the first team gets one server, not two, because otherwise winning the toss
  // is worth a free extra service turn. Calling it "two" from the start is how
  // the sport encodes that, and it is why this is not simply `1`.
  serverNumber: teamSize === 2 ? 2 : 1,
  score: { near: 0, far: 0 },
  bouncesSinceHit: 0,
  hitsThisRally: 0,
  lastHitBy: null,
  pendingFault: null,
});

/**
 * Which slot is standing in the right/even court, given that team's score.
 *
 * This is the load-bearing line of doubles, and it is a consequence rather than
 * a rule: partners swap courts exactly when their team scores, and the score
 * goes up by one at the same instant. So "slot 0 is on the right" and "the score
 * is even" flip together and stay locked for the whole game. Nothing has to
 * track where anyone is standing.
 *
 * USA Pickleball 4.B.6.b states the same invariant from the other end: when the
 * team's score is even, the team's *starting* server belongs in the right/even
 * serving area. Slot 0 is that player, by definition.
 */
export const rightCourtSlot = (teamScore: number): Slot => (teamScore % 2 === 0 ? 0 : 1);

/**
 * Which service court the server is standing in, and therefore serving from.
 *
 * Derived, never stored. It used to be a field that two different code paths
 * assigned, which is the exact shape of the Day 6 serve bug: one authority is
 * the only reliable way to keep four combinations agreeing.
 *
 * Note what this says about the second server. They serve from the court they
 * are standing in, and nobody moved when the first server faulted, so at an even
 * score the second server serves from the LEFT. That surprises people, and two
 * sources disagreed about it while this was being written. The invariant above
 * settles it without needing a source: no point was scored, so no one swapped.
 */
export const serveBox = (match: Match): ServeBox =>
  match.serverSlot === rightCourtSlot(match.score[match.server]) ? 'right' : 'left';

/**
 * Which player on the receiving team must take the serve.
 *
 * The serve is diagonal, so the receiver is whoever is standing in the box it is
 * headed for. Same invariant, read on the other side of the net.
 */
export const receiverSlot = (match: Match): Slot => {
  const receiving = opponentOf(match.server);
  const evenSlot = rightCourtSlot(match.score[receiving]);
  return serveTargetBox(match.server, serveBox(match)).rightHalf ? evenSlot : otherSlot(evenSlot);
};

/**
 * Where a serve has to land: diagonally opposite, past the kitchen line.
 *
 * The right-hand box seen from behind your own baseline is +x on the near side
 * and -x on the far side, which is the one piece of geometry in the rules that
 * is easy to get backwards, so it lives in one function.
 */
/**
 * Which side of the centre line the server is standing on, in world x.
 *
 * The one place this is decided. It used to be worked out independently in the
 * box rule and in the serve setup, and the two disagreed for exactly one of
 * the four combinations: the far player serving from their left aimed straight
 * down the court instead of across it. Nothing called a fault, because the
 * legality check was reading the same wrong answer as the shot, and the
 * receiver was parked at the same wrong place — so the only symptom was that
 * the far player kept losing. Deriving both from one function is what makes
 * that class of disagreement impossible rather than merely unlikely.
 */
export const serveFromX = (server: Side, box: ServeBox): number => {
  const sign = server === 'near' ? 1 : -1;
  const halfX = C.COURT_HALF_WIDTH / 2;
  return (box === 'right' ? sign : -sign) * halfX;
};

/**
 * A serve is struck diagonally, so it lands on the far side of the centre line
 * from where it was struck. That is the whole rule, and stating it as "the
 * opposite sign of where the server stands" makes it true for both ends.
 */
export const serveTargetBox = (server: Side, box: ServeBox): { side: Side; rightHalf: boolean } => ({
  side: opponentOf(server),
  rightHalf: serveFromX(server, box) < 0,
});

/**
 * The striker's momentum carried them into the kitchen after a volley.
 *
 * Separate from `onHit` because it happens LATER — the contact was legal and the
 * fault is about where the player ends up a fraction of a second afterwards.
 */
export const onMomentumFault = (match: Match, side: Side): RuleEvent[] =>
  match.phase === 'inPlay' ? awardAgainst(match, side, 'volley in the kitchen') : [];

const isLegalServeLanding = (match: Match, at: Vec3): Fault | null => {
  if (!isInBounds(at)) return 'serve out';
  const target = serveTargetBox(match.server, serveBox(match));
  if (sideOf(at.z) !== target.side) return 'serve out';
  if (isInKitchen(at)) return 'serve into kitchen';
  const landedRight = at.x >= 0;
  if (landedRight !== target.rightHalf) return 'serve wrong box';
  return null;
};

/**
 * Register that `side` struck the ball. Call this on the contact tick, before
 * the simulation events for the same tick.
 */
/**
 * Register that `side` struck the ball. Call this on the contact tick, before
 * the simulation events for the same tick.
 *
 * `inKitchen` is whether the striker's feet are in their own non-volley zone.
 * The rule needs it here rather than anywhere else because whether a shot is a
 * volley is already known here — `bouncesSinceHit === 0` means the ball has not
 * touched the ground since the opponent hit it, which is exactly what a volley
 * is. Two facts that were already in the same place, and a rule that falls out
 * of putting them together.
 */
export const onHit = (match: Match, side: Side, inKitchen = false): RuleEvent[] => {
  if (match.phase === 'gameOver') return [];

  const events: RuleEvent[] = [];

  if (match.phase === 'awaitingServe') {
    match.phase = 'inPlay';
    match.hitsThisRally = 1;
    match.bouncesSinceHit = 0;
    match.lastHitBy = side;
    events.push({
      type: 'rallyStart',
      server: match.server,
      slot: match.serverSlot,
      number: match.serverNumber,
      box: serveBox(match),
    });
    return events;
  }

  if (match.phase !== 'inPlay') return events;

  // The two-bounce rule: the serve must bounce, and so must the return. Only
  // from the third shot on may the ball be taken out of the air.
  const isVolley = match.bouncesSinceHit === 0;

  // The non-volley rule. Standing in the kitchen is legal and often necessary —
  // you step in to play a ball that has bounced and step out again. Taking one
  // out of the AIR from in there is not.
  if (isVolley && inKitchen) {
    return awardAgainst(match, side, 'volley in the kitchen');
  }

  const mustHaveBounced = match.hitsThisRally < 3;
  if (mustHaveBounced && isVolley) {
    return awardAgainst(match, side, 'volleyed too early');
  }

  // Two bounces before you got there is a point against you either way.
  if (match.bouncesSinceHit > 1) {
    return awardAgainst(match, side, 'double bounce');
  }

  match.hitsThisRally += 1;
  match.bouncesSinceHit = 0;
  match.lastHitBy = side;
  return events;
};

/** Register that the player whose turn it was failed to reach the ball. */
export const onMiss = (match: Match, side: Side): RuleEvent[] =>
  match.phase === 'inPlay' ? awardAgainst(match, side, 'missed') : [];

/**
 * Feed the rules one simulation event.
 *
 * Bounces and net contacts are all it needs: everything else about a rally is
 * bookkeeping the state machine already holds.
 */
export const onSimEvent = (match: Match, event: SimEvent): RuleEvent[] => {
  if (match.phase !== 'inPlay') return [];
  const striker = match.lastHitBy;
  if (!striker) return [];

  if (event.type === 'net') {
    return awardAgainst(match, striker, match.hitsThisRally === 1 ? 'serve into net' : 'into net');
  }

  // A ball that stops, or leaves the simulated volume, ends the rally. Without
  // this the rules simply never hear about it: `step` reports a gentle settle
  // as `rest` rather than `bounce`, so a dribbled shot left the match stuck in
  // play for ever. A soft-lock is worse than any wrong call, so both are
  // handled, and both mean the same thing — nobody is going to hit this again.
  if (event.type === 'rest' || event.type === 'outOfPlay') {
    return match.bouncesSinceHit >= 1
      ? awardTo(match, striker, opponentOf(striker), 'double bounce')
      : awardAgainst(match, striker, 'out');
  }

  if (event.type === 'bounce') {
    // A serve is judged against the service box; everything else against the
    // court, and against the fact that it has to cross the net at all.
    if (match.hitsThisRally === 1 && match.bouncesSinceHit === 0) {
      const fault = isLegalServeLanding(match, event.at);
      if (fault) return awardAgainst(match, striker, fault);
      match.bouncesSinceHit = 1;
      return [];
    }

    // Order matters here, and getting it wrong was the first bug this engine
    // produced on a real court. Once the ball has already bounced legally, the
    // rally is over the moment it bounces again: the receiver did not get to
    // it. Where that second bounce lands is irrelevant, so the in/out test
    // must not run first — it was calling a legal serve "out" because the ball
    // rolled past the baseline on its way to stopping.
    if (match.bouncesSinceHit >= 1) {
      match.bouncesSinceHit += 1;
      return awardTo(match, striker, opponentOf(striker), 'double bounce');
    }

    const crossed = sideOf(event.at.z) !== striker;
    if (!event.inBounds || !crossed) {
      return awardAgainst(match, striker, 'out');
    }

    match.bouncesSinceHit += 1;
    return [];
  }

  return [];
};

/** The rally ended because `loser` did something illegal. */
const awardAgainst = (match: Match, loser: Side, reason: Fault): RuleEvent[] =>
  awardTo(match, opponentOf(loser), loser, reason);

const awardTo = (match: Match, winner: Side, loser: Side, reason: Fault): RuleEvent[] => {
  const events: RuleEvent[] = [{ type: 'fault', by: loser, reason }];
  match.pendingFault = { by: loser, reason };
  match.phase = 'betweenPoints';

  if (winner === match.server) {
    // Side-out scoring: only the serving side scores. The partners swap courts,
    // which is not modelled here because nothing stores where they stand — the
    // score going up IS the swap. See `rightCourtSlot`.
    match.score[match.server] += 1;
    events.push({ type: 'point', to: match.server, score: { ...match.score } });

    const mine = match.score[match.server];
    const theirs = match.score[opponentOf(match.server)];
    if (mine >= GAME_TARGET && mine - theirs >= WIN_BY) {
      match.phase = 'gameOver';
      events.push({ type: 'gameOver', winner, score: { ...match.score } });
    }
    return events;
  }

  // The serving side faulted. In doubles that is not automatically a side out:
  // both partners serve before the serve goes over, which is why a doubles game
  // has three numbers in its call and a singles game has two.
  if (match.teamSize === 2 && match.serverNumber === 1) {
    match.serverNumber = 2;
    match.serverSlot = otherSlot(match.serverSlot);
    events.push({ type: 'secondServer', team: match.server });
    return events;
  }

  match.server = winner;
  // The incoming team's first server is always the player who started the game
  // in their right court — slot 0. Which court that player is standing in now
  // depends on their score, and `serveBox` works it out.
  match.serverSlot = 0;
  match.serverNumber = 1;
  events.push({ type: 'sideOut', to: winner });
  return events;
};

/** Ready the next serve. Called once the previous point has been shown. */
export const nextServe = (match: Match): void => {
  if (match.phase !== 'betweenPoints') return;
  match.phase = 'awaitingServe';
  match.hitsThisRally = 0;
  match.bouncesSinceHit = 0;
  match.lastHitBy = null;
  match.pendingFault = null;
};

/** Where the server should stand, and where they must land the ball. */
export const serveSetup = (
  match: Match,
): { from: { x: number; z: number }; target: { x: number; z: number } } => {
  const sign = match.server === 'near' ? 1 : -1;
  const halfX = C.COURT_HALF_WIDTH / 2;
  const box = serveBox(match);
  const fromX = serveFromX(match.server, box);
  const target = serveTargetBox(match.server, box);
  const targetX = (target.rightHalf ? 1 : -1) * halfX;
  // A serve aimed at 0.6 of the way back was the strongest shot in the game:
  // the receiver takes it behind their own baseline, off the bounce, moving
  // backwards, which is the highest-pressure contact there is — so once
  // execution error existed, the server held 79 per cent of rallies. Real
  // singles is nearer 55, and the reason is that there is no second serve in
  // pickleball. Nobody hits a serve they cannot afford to miss. Aiming it
  // shorter is what a player does, and it hands the return back to the
  // receiver rather than to the arithmetic.
  const targetZ = -sign * (C.KITCHEN_DEPTH + (C.COURT_HALF_LENGTH - C.KITCHEN_DEPTH) * 0.45);
  return {
    from: { x: fromX, z: sign * (C.COURT_HALF_LENGTH - 0.35) },
    target: { x: targetX, z: targetZ },
  };
};

/**
 * Score as it would be called out loud: server's score first.
 *
 * Doubles adds a third number, the server number, and USA Pickleball 4.J makes
 * that order mandatory rather than conventional. It is not decoration either:
 * without it nobody at the net can tell whether the next fault ends the service
 * turn, so the whole team's court position for the next rally is unknowable.
 * That is the reason it is modelled as state and printed here, rather than left
 * to the scoreboard.
 */
export const callScore = (match: Match): string => {
  if (match.phase === 'gameOver') {
    const winner = match.score.near > match.score.far ? 'near' : 'far';
    return `game to ${winner === 'near' ? 'you' : 'opponent'} ${match.score.near}-${match.score.far}`;
  }
  const mine = match.score[match.server];
  const theirs = match.score[opponentOf(match.server)];
  return match.teamSize === 2
    ? `${mine}-${theirs}-${match.serverNumber}`
    : `${mine}-${theirs}`;
};
