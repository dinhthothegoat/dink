import { describe, expect, it } from 'vitest';
import * as C from '../src/sim/constants';
import {
  GAME_TARGET,
  Match,
  RuleEvent,
  callScore,
  createMatch,
  nextServe,
  onHit,
  onMiss,
  onMomentumFault,
  onSimEvent,
  receiverSlot,
  rightCourtSlot,
  serveBox,
  serveSetup,
  serveTargetBox,
} from '../src/sim/rules';
import { Side } from '../src/sim/court';
import { v3 } from '../src/sim/vec3';

const bounce = (x: number, z: number, inBounds = true) =>
  ({ type: 'bounce', at: v3(x, C.BALL_RADIUS, z), inBounds, speed: 6 }) as const;
const net = () => ({ type: 'net', at: v3(0, 0.5, 0), cord: false }) as const;
const rest = (x: number, z: number) => ({ type: 'rest', at: v3(x, C.BALL_RADIUS, z) }) as const;
const outOfPlay = (x: number, z: number) =>
  ({ type: 'outOfPlay', at: v3(x, C.BALL_RADIUS, z) }) as const;

const reasons = (events: RuleEvent[]) =>
  events.filter((e) => e.type === 'fault').map((e) => (e.type === 'fault' ? e.reason : ''));

/** Serve legally and let it bounce in the correct box. */
const legalServe = (match: Match): RuleEvent[] => {
  const setup = serveSetup(match);
  const events = onHit(match, match.server);
  return [...events, ...onSimEvent(match, bounce(setup.target.x, setup.target.z))];
};

describe('serving', () => {
  it('sends the serve diagonally, past the kitchen', () => {
    const match = createMatch('near');
    const setup = serveSetup(match);
    // Server on the near right serves to the far left of the court as drawn,
    // which is the receiver's right.
    expect(Math.sign(setup.from.x)).toBe(1);
    expect(Math.sign(setup.target.x)).toBe(-1);
    expect(Math.abs(setup.target.z)).toBeGreaterThan(C.KITCHEN_DEPTH);
    expect(serveTargetBox('near', 'right').side).toBe('far');
  });

  it('faults a serve into the net', () => {
    const match = createMatch('near');
    onHit(match, 'near');
    expect(reasons(onSimEvent(match, net()))).toEqual(['serve into net']);
  });

  it('faults a serve that lands long', () => {
    const match = createMatch('near');
    onHit(match, 'near');
    expect(reasons(onSimEvent(match, bounce(-1.5, -8, false)))).toEqual(['serve out']);
  });

  it('faults a serve into the kitchen', () => {
    const match = createMatch('near');
    onHit(match, 'near');
    expect(reasons(onSimEvent(match, bounce(-1.5, -1.0)))).toEqual(['serve into kitchen']);
  });

  it('faults a serve into the wrong box', () => {
    const match = createMatch('near');
    onHit(match, 'near');
    // Correct side and depth, wrong half of the court.
    expect(reasons(onSimEvent(match, bounce(1.5, -4.5)))).toEqual(['serve wrong box']);
  });

  it('accepts a serve that lands where it should', () => {
    const match = createMatch('near');
    expect(reasons(legalServe(match))).toEqual([]);
    expect(match.phase).toBe('inPlay');
  });
});

describe('the two-bounce rule', () => {
  it('will not let the receiver volley the serve', () => {
    const match = createMatch('near');
    onHit(match, 'near');
    // Receiver swings before the serve has bounced.
    expect(reasons(onHit(match, 'far'))).toEqual(['volleyed too early']);
  });

  it('will not let the server volley the return', () => {
    const match = createMatch('near');
    legalServe(match);
    onHit(match, 'far'); // legal return, off the bounce
    expect(reasons(onHit(match, 'near'))).toEqual(['volleyed too early']);
  });

  it('allows a volley from the third shot on', () => {
    const match = createMatch('near');
    legalServe(match);
    onHit(match, 'far');
    onSimEvent(match, bounce(0, 4.0)); // return bounces on the server's side
    expect(reasons(onHit(match, 'near'))).toEqual([]);
    // Now the ball is live and may be taken out of the air.
    expect(reasons(onHit(match, 'far'))).toEqual([]);
  });
});

describe('rally faults', () => {
  const rallyInPlay = () => {
    const match = createMatch('near');
    legalServe(match);
    onHit(match, 'far');
    onSimEvent(match, bounce(0, 4.0));
    onHit(match, 'near');
    return match;
  };

  it('gives the point away on a ball into the net', () => {
    const match = rallyInPlay();
    expect(reasons(onSimEvent(match, net()))).toEqual(['into net']);
  });

  it('gives the point away on a ball landing out', () => {
    const match = rallyInPlay();
    expect(reasons(onSimEvent(match, bounce(0, -8, false)))).toEqual(['out']);
  });

  it('gives the point away on a ball that never crosses the net', () => {
    // In bounds, but on the striker's own side, which is still a fault.
    const match = rallyInPlay();
    expect(reasons(onSimEvent(match, bounce(0, 4.5)))).toEqual(['out']);
  });

  it('awards the point when the opponent lets it bounce twice', () => {
    const match = rallyInPlay();
    expect(reasons(onSimEvent(match, bounce(0, -4.0)))).toEqual([]);
    const events = onSimEvent(match, bounce(0, -4.2));
    expect(reasons(events)).toEqual(['double bounce']);
    expect(events.some((e) => e.type === 'point' && e.to === 'near')).toBe(true);
  });

  it('does not call a second bounce out when the ball rolls past the line', () => {
    // The first bug this engine produced on a real court. A legal shot lands
    // in, nobody gets to it, and the ball bounces again beyond the baseline on
    // its way to stopping. That second bounce ends the rally in the striker's
    // favour; judging it in or out gave the point to the wrong player.
    const match = rallyInPlay();
    onSimEvent(match, bounce(0, -4.0));
    const events = onSimEvent(match, bounce(-2.7, -9.2, false));
    expect(reasons(events)).toEqual(['double bounce']);
    expect(events.some((e) => e.type === 'point' && e.to === 'near')).toBe(true);
  });

  it('applies the same rule to a serve nobody returns', () => {
    const match = createMatch('near');
    legalServe(match);
    const events = onSimEvent(match, bounce(-2.7, -9.2, false));
    expect(reasons(events)).toEqual(['double bounce']);
    expect(match.score.near).toBe(1);
  });

  it('ends the rally when the ball simply stops', () => {
    // The simulation reports a gentle settle as `rest`, not `bounce`. Ignoring
    // it left a dribbled shot with the match stuck in play for ever, which is
    // a soft-lock and worse than any wrong call.
    const match = rallyInPlay();
    onSimEvent(match, bounce(0, -4.0));
    expect(reasons(onSimEvent(match, rest(0, -4.3)))).toEqual(['double bounce']);
    expect(match.phase).toBe('betweenPoints');
  });

  it('ends the rally when the ball leaves the simulated court', () => {
    const match = rallyInPlay();
    expect(reasons(onSimEvent(match, outOfPlay(0, -12)))).toEqual(['out']);
    expect(match.phase).toBe('betweenPoints');
  });

  it('awards the point when the opponent cannot reach it', () => {
    const match = rallyInPlay();
    onSimEvent(match, bounce(0, -4.0));
    expect(reasons(onMiss(match, 'far'))).toEqual(['missed']);
  });
});

describe('side-out scoring', () => {
  it('only lets the serving side score', () => {
    const match = createMatch('near');
    legalServe(match);
    // The receiver hits it out: the server scores.
    onHit(match, 'far');
    onSimEvent(match, bounce(0, 9, false));
    expect(match.score).toEqual({ near: 1, far: 0 });

    nextServe(match);
    legalServe(match);
    // Now the server hits it out: no point to the receiver, just the serve.
    onHit(match, 'far');
    onSimEvent(match, bounce(0, 4.0));
    onHit(match, 'near');
    onSimEvent(match, bounce(0, -9, false));
    expect(match.score).toEqual({ near: 1, far: 0 });
    expect(match.server).toBe('far');
  });

  it('swaps the service box on every point won', () => {
    const match = createMatch('near');
    expect(serveBox(match)).toBe('right');
    legalServe(match);
    onHit(match, 'far');
    onSimEvent(match, bounce(0, 9, false));
    expect(serveBox(match)).toBe('left');
  });

  it('calls the score with the server first', () => {
    const match = createMatch('near');
    legalServe(match);
    onHit(match, 'far');
    onSimEvent(match, bounce(0, 9, false));
    expect(callScore(match)).toBe('1-0');
  });
});

describe('winning', () => {
  /** Hand `side` a point by having the other side dump the ball out. */
  const pointTo = (match: Match, side: Side): void => {
    nextServe(match);
    if (match.server !== side) {
      // Get the serve back first: the receiver wins the rally, taking serve.
      legalServe(match);
      onHit(match, match.server === 'near' ? 'far' : 'near');
      onSimEvent(match, bounce(0, match.server === 'near' ? 4.0 : -4.0));
      onHit(match, match.server);
      onSimEvent(match, bounce(0, match.server === 'near' ? -9 : 9, false));
      nextServe(match);
    }
    legalServe(match);
    const receiver = match.server === 'near' ? 'far' : 'near';
    onHit(match, receiver);
    onSimEvent(match, bounce(0, receiver === 'near' ? -9 : 9, false));
  };

  it('ends at 11 with two clear', () => {
    const match = createMatch('near');
    for (let i = 0; i < GAME_TARGET && match.phase !== 'gameOver'; i++) pointTo(match, 'near');
    expect(match.score.near).toBe(GAME_TARGET);
    expect(match.phase).toBe('gameOver');
    expect(callScore(match)).toContain('game');
  });

  it('does not end at 11-10', () => {
    const match = createMatch('near');
    match.score = { near: 10, far: 10 };
    pointTo(match, 'near');
    expect(match.score.near).toBe(11);
    expect(match.phase).not.toBe('gameOver');
  });

  it('ignores everything once the game is over', () => {
    const match = createMatch('near');
    match.phase = 'gameOver';
    expect(onHit(match, 'near')).toEqual([]);
    expect(onSimEvent(match, net())).toEqual([]);
  });
});

describe('the serve is diagonal from both ends', () => {
  // All four combinations, because exactly one of them was wrong: the far
  // player serving from their left aimed straight down the court instead of
  // across it. Nothing called a fault, because the legality check read the
  // same wrong answer as the shot and the receiver was parked in the same
  // wrong place. The only symptom was the far player quietly losing.
  it.each([
    ['near' as const, 'right' as const],
    ['near' as const, 'left' as const],
    ['far' as const, 'right' as const],
    ['far' as const, 'left' as const],
  ])('%s serving from the %s box crosses the centre line', (server, box) => {
    const match = createMatch(server);
    // The box is derived from the score now, so ask for it by scoring.
    if (box === 'left') match.score[server] = 1;
    expect(serveBox(match)).toBe(box);
    const setup = serveSetup(match);
    expect(Math.sign(setup.target.x)).toBe(-Math.sign(setup.from.x));
    expect(Math.sign(setup.target.z)).toBe(-Math.sign(setup.from.z));
    expect(serveTargetBox(server, box).rightHalf).toBe(setup.from.x < 0);
  });
});

describe('the non-volley zone', () => {
  /**
   * Day 4 made the kitchen a physical rail because a fence is readable where a
   * rule is not. Day 12 measured what that cost: the rail holds a player 2.41 m
   * from the net and a paddle reaches 1.15 m, so anything landing inside 1.26 m
   * of the net could not be played at all — 59 per cent of the kitchen,
   * unreturnable by geometry rather than by skill. There was no dink rally,
   * only dink winners, and the soft exchange is the whole of doubles.
   *
   * So it is a rule again. Standing in the zone is legal; volleying out of it
   * is not; and your momentum must not carry you in afterwards.
   */
  const inPlay = (): Match => {
    const match = createMatch('near');
    match.phase = 'inPlay';
    // Past the two-bounce rule, so a volley is legal in principle and only the
    // non-volley rule is under test.
    match.hitsThisRally = 5;
    match.lastHitBy = 'far';
    return match;
  };

  it('faults a volley struck from inside the zone', () => {
    const match = inPlay();
    match.bouncesSinceHit = 0; // straight out of the air
    const events = onHit(match, 'near', true);
    expect(events.find((e) => e.type === 'fault')).toMatchObject({
      by: 'near',
      reason: 'volley in the kitchen',
    });
  });

  it('allows a volley struck from behind the line', () => {
    const match = inPlay();
    match.bouncesSinceHit = 0;
    expect(onHit(match, 'near', false).some((e) => e.type === 'fault')).toBe(false);
  });

  it('allows a bounced ball to be played from inside the zone', () => {
    // The half of the rule the rail could not express, and the half the whole
    // soft game runs on: you step in, play the ball off the bounce, step out.
    const match = inPlay();
    match.bouncesSinceHit = 1;
    expect(onHit(match, 'near', true).some((e) => e.type === 'fault')).toBe(false);
  });

  it('still calls the two-bounce rule before the non-volley rule', () => {
    // Order matters, and getting it backwards would report the wrong fault to
    // a player standing legally behind the line on the second shot.
    const match = createMatch('near');
    match.phase = 'inPlay';
    match.hitsThisRally = 1;
    match.bouncesSinceHit = 0;
    expect(onHit(match, 'far', false).find((e) => e.type === 'fault')).toMatchObject({
      reason: 'volleyed too early',
    });
  });

  it('faults momentum carried into the zone after a volley', () => {
    const match = inPlay();
    expect(onMomentumFault(match, 'near').find((e) => e.type === 'fault')).toMatchObject({
      by: 'near',
      reason: 'volley in the kitchen',
    });
  });

  it('does not fault momentum when the rally is already over', () => {
    const match = createMatch('near');
    match.phase = 'betweenPoints';
    expect(onMomentumFault(match, 'near')).toEqual([]);
  });
});

/**
 * Doubles, Day 14.
 *
 * The reference is the USA Pickleball rulebook, section 4, read directly. The
 * research run that was supposed to supply this returned three usable claims out
 * of a hundred agents and voted 3-0 to refute the two-bounce rule, so it was
 * used as a list of things to go and check rather than as an answer.
 *
 * The whole rotation is exercised as a sequence rather than as isolated cases,
 * because the failure mode that matters is drift: every individual transition
 * can be right while the sequence of them ends up with the wrong player in the
 * wrong court, and only walking a service turn end to end catches that.
 */
describe('doubles', () => {
  /** Fault the serving side, whoever they are. Serve into the net. */
  const serverFaults = (match: Match): RuleEvent[] => {
    const events = onHit(match, match.server);
    const ruled = [...events, ...onSimEvent(match, net())];
    nextServe(match);
    return ruled;
  };

  /** Serving side wins the rally: their serve lands, the receiver misses it. */
  const serverScores = (match: Match): RuleEvent[] => {
    legalServe(match);
    const ruled = onMiss(match, opposite(match.server));
    nextServe(match);
    return ruled;
  };

  const opposite = (side: Side): Side => (side === 'near' ? 'far' : 'near');

  it('starts a doubles game at 0-0-2 and a singles game at 0-0', () => {
    expect(callScore(createMatch('near', 2))).toBe('0-0-2');
    expect(callScore(createMatch('near', 1))).toBe('0-0');
  });

  it('gives the opening team one server, not two', () => {
    const match = createMatch('near', 2);
    // The 0-0-2 exception. In any other service turn this first fault would
    // hand over to the partner; here it hands over the serve.
    const events = serverFaults(match);
    expect(events.some((e) => e.type === 'sideOut')).toBe(true);
    expect(match.server).toBe('far');
    expect(match.serverNumber).toBe(1);
    expect(match.serverSlot).toBe(0);
  });

  it('passes the serve to the partner before the side out, thereafter', () => {
    const match = createMatch('near', 2);
    serverFaults(match); // 0-0-2 exception, side out to far
    expect(match.server).toBe('far');

    const first = serverFaults(match);
    expect(first.some((e) => e.type === 'secondServer')).toBe(true);
    expect(first.some((e) => e.type === 'sideOut')).toBe(false);
    expect(match.server).toBe('far');
    expect(match.serverNumber).toBe(2);
    expect(match.serverSlot).toBe(1);

    const second = serverFaults(match);
    expect(second.some((e) => e.type === 'sideOut')).toBe(true);
    expect(match.server).toBe('near');
    expect(match.serverNumber).toBe(1);
  });

  it('never passes to a partner in singles', () => {
    const match = createMatch('near', 1);
    const events = serverFaults(match);
    expect(events.some((e) => e.type === 'secondServer')).toBe(false);
    expect(match.server).toBe('far');
    expect(match.serverNumber).toBe(1);
  });

  it('keeps the first server on the right whenever their score is even', () => {
    const match = createMatch('far', 2);
    serverFaults(match); // opening exception, side out to near
    expect(match.server).toBe('near');

    // Walk the near team up the score with the same server the whole way. The
    // invariant under test is 4.B.6.b: slot 0 is in the right court at an even
    // score and the left court at an odd one, for as long as the game lasts.
    for (let score = 0; score < 6; score += 1) {
      expect(match.score.near).toBe(score);
      expect(match.serverSlot).toBe(0);
      expect(serveBox(match)).toBe(score % 2 === 0 ? 'right' : 'left');
      expect(rightCourtSlot(match.score.near)).toBe(score % 2 === 0 ? 0 : 1);
      serverScores(match);
    }
  });

  it('puts the second server in the other court, even at an even score', () => {
    // The thing two sources disagreed about. Nobody swaps when the first server
    // faults, because no point was scored, so the partner serves from where they
    // are standing — which at an even score is the left.
    const match = createMatch('far', 2);
    serverFaults(match);
    serverScores(match); // near to 1, still server 1
    serverScores(match); // near to 2, still server 1
    expect(match.score.near).toBe(2);
    expect(serveBox(match)).toBe('right');

    serverFaults(match); // first server faults, partner takes over
    expect(match.serverNumber).toBe(2);
    expect(match.score.near).toBe(2);
    expect(serveBox(match)).toBe('left');
  });

  it('calls three numbers, in the order the rulebook fixes', () => {
    const match = createMatch('far', 2);
    serverFaults(match);
    expect(callScore(match)).toBe('0-0-1');
    serverScores(match);
    expect(callScore(match)).toBe('1-0-1');
    serverFaults(match);
    expect(callScore(match)).toBe('1-0-2');
    serverFaults(match);
    // Side out. The receiving team's score is called first now.
    expect(callScore(match)).toBe('0-1-1');
  });

  it('sends the serve to the partner standing in the box it is aimed at', () => {
    const match = createMatch('near', 2);
    // Near serving at 0: slot 0 in the right court, serving cross-court, so the
    // far team's right-court player takes it. At an even far score that is slot 0.
    expect(serveBox(match)).toBe('right');
    expect(receiverSlot(match)).toBe(0);

    match.score.far = 1;
    // The far team swapped when they scored, so the same box is now slot 1's.
    expect(receiverSlot(match)).toBe(1);
  });

  it('only ever scores for the serving side, doubles included', () => {
    const match = createMatch('near', 2);
    serverFaults(match);
    serverFaults(match);
    serverFaults(match);
    expect(match.score).toEqual({ near: 0, far: 0 });
  });
});
