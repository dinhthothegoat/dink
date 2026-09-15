import { describe, expect, it } from 'vitest';
import * as C from '../src/sim/constants';
import { emptyInput } from '../src/sim/input';
import { interceptPoint, receivePosition } from '../src/sim/intercept';
import { RallyEvent, createRally, stepRally } from '../src/sim/rally';
import { createRng } from '../src/sim/rng';
import { receiverSlot } from '../src/sim/rules';
import { v3 } from '../src/sim/vec3';
import { launch, predictBall } from '../src/sim/world';

interface Tally {
  rallies: number;
  hits: number;
  points: number;
  sideOuts: number;
  longest: number;
  faults: Record<string, number>;
  winner: string | null;
  score: { near: number; far: number };
}

/**
 * Play a whole game with a scripted near player.
 *
 * The policy is the same one the browser autopilot uses, and deliberately so:
 * it goes to the intercept, waits out the two-bounce rule, and drives. If this
 * ever stops being able to complete a game, the game has stopped working.
 */
const playGame = (seconds = 1200): Tally => {
  const rally = createRally('near');
  const input = emptyInput();
  const stand = v3();
  const tally: Tally = {
    rallies: 0,
    hits: 0,
    points: 0,
    sideOuts: 0,
    longest: 0,
    faults: {},
    winner: null,
    score: { near: 0, far: 0 },
  };
  let inRally = 0;

  for (let i = 0; i < seconds * C.SIM_HZ && rally.match.phase !== 'gameOver'; i++) {
    const ball = rally.world.ball;
    const p = rally.near.pos;
    const mine = ball.pos.z > 0.4 && !ball.resting;
    const bounced = rally.match.bouncesSinceHit > 0;
    const mustLet = rally.match.hitsThisRally < 3;
    const meeting = interceptPoint(rally.world, 'near', {
      requireBounce: mustLet && !bounced,
    });

    if (meeting) receivePosition(stand, rally.near.facing, meeting.pos);
    else if (mine) stand.x = p.x, (stand.z = p.z);
    else stand.x = 0, (stand.z = 4.6);

    input.moveX = Math.max(-1, Math.min(1, (stand.x - p.x) * 3));
    input.moveZ = Math.max(-1, Math.min(1, (stand.z - p.z) * 3));

    const future = predictBall(rally.world, C.SWING_WINDUP).pos;
    const distance = Math.hypot(future.x - p.x, future.z - p.z);
    input.swing =
      rally.match.phase === 'awaitingServe'
        ? rally.match.server === 'near'
        : mine &&
          (!mustLet || bounced) &&
          rally.near.phase === 'ready' &&
          distance < 0.9 &&
          future.y > C.PLAYER_STRIKE_LOW &&
          future.y < C.PLAYER_STRIKE_HIGH + 0.25;
    input.shape = 'drive';
    input.aimX = 0.35;

    for (const e of stepRally(rally, input)) {
      if (e.type === 'struck' || e.type === 'served') {
        tally.hits += 1;
        inRally += 1;
      }
      if (e.type === 'fault') {
        tally.faults[e.reason] = (tally.faults[e.reason] ?? 0) + 1;
        tally.rallies += 1;
        tally.longest = Math.max(tally.longest, inRally);
        inRally = 0;
      }
      if (e.type === 'point') tally.points += 1;
      if (e.type === 'sideOut') tally.sideOuts += 1;
      if (e.type === 'gameOver') tally.winner = e.winner;
    }
  }
  tally.score = { ...rally.match.score };
  return tally;
};

describe('a whole game', () => {
  const game = playGame();

  it('reaches a winner', () => {
    expect(game.winner).not.toBeNull();
    const top = Math.max(game.score.near, game.score.far);
    const low = Math.min(game.score.near, game.score.far);
    expect(top).toBeGreaterThanOrEqual(11);
    expect(top - low).toBeGreaterThanOrEqual(2);
  });

  it('produces rallies rather than one-shot points', () => {
    // The first working version returned every rally in a single shot, because
    // the receiver stood in front of the serve. Average rally length is the
    // number that catches that class of bug, and it catches it loudly.
    expect(game.rallies).toBeGreaterThan(10);
    expect(game.hits / game.rallies).toBeGreaterThan(2);
    expect(game.longest).toBeGreaterThan(4);
  });

  it('never hangs: every rally ends in a fault', () => {
    // A ball that dribbles to a stop used to leave the match stuck in play for
    // ever, because the rules only listened for bounces and nets.
    const faults = Object.values(game.faults).reduce((a, b) => a + b, 0);
    expect(faults).toBe(game.rallies);
  });

  it('scores only on serve, so points and side-outs both happen', () => {
    expect(game.points).toBeGreaterThan(0);
    expect(game.sideOuts).toBeGreaterThan(0);
  });

  it('serves legally: the built-in serve never faults on its own', () => {
    const serveFaults = Object.keys(game.faults).filter((f) => f.startsWith('serve'));
    expect(serveFaults).toEqual([]);
  });

  it('is deterministic', { timeout: 30_000 }, () => {
    const again = playGame();
    expect(again.score).toEqual(game.score);
    expect(again.winner).toBe(game.winner);
    expect(again.hits).toBe(game.hits);
  });
});

describe('intercept prediction', () => {
  it('finds a strikeable point for a ball coming at you', () => {
    const rally = createRally('near');
    const input = emptyInput();
    input.swing = true;
    stepRally(rally, input);
    input.swing = false;
    const meeting = interceptPoint(rally.world, 'far', { requireBounce: true });
    expect(meeting).not.toBeNull();
    if (meeting) {
      expect(meeting.pos.z).toBeLessThan(0);
      expect(meeting.pos.y).toBeGreaterThanOrEqual(C.PLAYER_STRIKE_LOW);
      expect(meeting.pos.y).toBeLessThanOrEqual(C.PLAYER_STRIKE_HIGH);
      expect(meeting.seconds).toBeGreaterThan(0);
    }
  });

  it('returns nothing when the ball is going the other way', () => {
    const rally = createRally('near');
    const input = emptyInput();
    input.swing = true;
    stepRally(rally, input);
    expect(interceptPoint(rally.world, 'near', { requireBounce: true })).toBeNull();
  });

  it('stands behind the ball, on the correct side, for both players', () => {
    // The sign bug that made the stand-in wait in front of every serve. Both
    // directions are checked, because the wrong version passes one of them.
    //
    // Each player is asked about a ball on THEIR OWN side, which is the only
    // thing the callers ever ask. The first version of this test handed both
    // players the same far-side ball and leaned on the old kitchen clamp to make
    // the answer look sensible.
    const nearBall = v3(1, 0, 5);
    const near = receivePosition(v3(), -1, nearBall);
    expect(near.z).toBeGreaterThan(nearBall.z);

    const farBall = v3(1, 0, -5);
    const far = receivePosition(v3(), 1, farBall);
    expect(far.z).toBeLessThan(farBall.z);
  });

  it('steps into the kitchen for a ball that lands there', () => {
    // This test used to be called "never places a player inside the kitchen
    // rail" and asserted the opposite. The rail was deleted from the physics on
    // Day 12; it survived here, and in `receivePosition`, until Day 17 — so for
    // five days players were ALLOWED into the kitchen and nothing ever asked to
    // go, which made every drop a coin toss decided at the edge of reach.
    //
    // Standing in there is legal. Volleying from in there is not, and that is a
    // rule in `rules.ts` with a momentum window attached, not a wall here.
    // Doubles only, and the scoping is the interesting half. In singles the same
    // permission produced an absorbing state: a player inside the zone may not
    // volley, every ball must bounce, and a soft ball bouncing in the kitchen is
    // always reachable by somebody standing there. One rally ran 2,569 shots.
    const paired = receivePosition(v3(), -1, v3(0, 0, 0.4), 0.45, true);
    expect(paired.z).toBeLessThan(C.KITCHEN_DEPTH);
    expect(paired.z).toBeGreaterThanOrEqual(C.PLAYER_RADIUS - 1e-9);

    const alone = receivePosition(v3(), -1, v3(0, 0, 0.4));
    expect(alone.z).toBeGreaterThanOrEqual(C.KITCHEN_DEPTH + C.PLAYER_RADIUS - 1e-9);
  });
});

describe('seeded randomness', () => {
  it('replays identically from the same seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const drawA = Array.from({ length: 8 }, () => a.next());
    const drawB = Array.from({ length: 8 }, () => b.next());
    expect(drawA).toEqual(drawB);
  });

  it('differs between seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('stays in range', () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(Math.abs(rng.spread(0.4))).toBeLessThanOrEqual(0.4);
    }
  });
});

describe('the non-volley rule, in a real rally', () => {
  /**
   * The unit tests in `rules.test.ts` prove the rule computes. They cannot
   * prove it ever FIRES, and in eight games of self-play it never did — the
   * opponent is gated so that it waits for the bounce rather than volleying
   * out of the zone, which is correct behaviour and also means the only
   * evidence the rule works came from calling it directly.
   *
   * A rule nothing exercises is indistinguishable from a rule that is wired to
   * nothing. So: stand a player in the kitchen and make them volley.
   */
  const volleyFrom = (z: number): RallyEvent[] => {
    const rally = createRally('near');
    const input = emptyInput();

    // Mid-rally, past the two-bounce rule, ball in the air and coming at them.
    rally.match.phase = 'inPlay';
    rally.match.hitsThisRally = 5;
    rally.match.bouncesSinceHit = 0;
    rally.match.lastHitBy = 'far';
    rally.near.pos.x = 0;
    rally.near.pos.z = z;
    launch(rally.world, v3(0, 0.9, z - 0.9), v3(0, 0.2, 2.5), v3());

    const seen: RallyEvent[] = [];
    for (let i = 0; i < C.SIM_HZ; i++) {
      input.swing = i === 0;
      for (const e of stepRally(rally, input)) seen.push(e);
    }
    return seen;
  };

  it('faults a volley taken from inside the zone', () => {
    const events = volleyFrom(C.KITCHEN_DEPTH - 0.5);
    expect(events.find((e) => e.type === 'fault')).toMatchObject({
      by: 'near',
      reason: 'volley in the kitchen',
    });
    // And the ball was never struck: the rules veto before the physics.
    expect(events.some((e) => e.type === 'struck')).toBe(false);
  });

  it('allows the same volley from behind the line', () => {
    const events = volleyFrom(C.KITCHEN_DEPTH + 0.7);
    expect(events.some((e) => e.type === 'fault')).toBe(false);
    expect(events.some((e) => e.type === 'struck')).toBe(true);
  });

  it('faults momentum that carries the striker in afterwards', () => {
    // Legal at contact, standing just behind the line, then walking forward.
    const rally = createRally('near');
    const input = emptyInput();
    rally.match.phase = 'inPlay';
    rally.match.hitsThisRally = 5;
    rally.match.bouncesSinceHit = 0;
    rally.match.lastHitBy = 'far';
    // Both coordinates. `createRally` parks the receiver in the service box at
    // x = -1.52, and setting only z leaves the ball a metre and a half away
    // laterally — which cost ten minutes of debugging the game before the test.
    rally.near.pos.x = 0;
    rally.near.pos.z = C.KITCHEN_DEPTH + 0.5;
    launch(rally.world, v3(0, 0.9, C.KITCHEN_DEPTH - 0.4), v3(0, 0.2, 2.5), v3());

    const seen: RallyEvent[] = [];
    for (let i = 0; i < C.SIM_HZ; i++) {
      input.swing = i === 0;
      input.moveZ = -1; // keep walking forward, into the zone
      for (const e of stepRally(rally, input)) seen.push(e);
    }
    expect(seen.some((e) => e.type === 'struck')).toBe(true);
    expect(seen.find((e) => e.type === 'fault')).toMatchObject({
      reason: 'volley in the kitchen',
    });
  });
});

/**
 * Day 13. The widening, checked at the seam rather than in the types.
 *
 * The claim being tested is not "doubles works" — it does not yet, because the
 * partners have no brain until Day 15. It is narrower and it is the thing that
 * would sink the next four days if it were false: four players exist, the rules
 * can see all of them, and singles is unchanged.
 */
describe('teams', () => {
  it('builds one player a side in singles and two in doubles', () => {
    expect(createRally('near', 'steady').team.near).toHaveLength(1);
    expect(createRally('near', 'steady', 2).team.far).toHaveLength(2);
  });

  it('keeps near and far pointing at slot 0, not a copy of it', () => {
    const rally = createRally('near', 'steady', 2);
    expect(rally.near).toBe(rally.team.near[0]);
    expect(rally.far).toBe(rally.team.far[0]);
    expect(rally.reach).toBe(rally.reaches.near[0]);
  });

  it('gives every player their own reach buffer', () => {
    const rally = createRally('near', 'steady', 2);
    const all = [...rally.reaches.near, ...rally.reaches.far];
    expect(new Set(all).size).toBe(4);
  });

  it('keeps the serving partner back and receiving partner at the kitchen', () => {
    const rally = createRally('near', 'steady', 2);
    const serverMate = rally.team.near[1];
    const line = C.KITCHEN_DEPTH + C.PLAYER_RADIUS;
    expect(Math.abs(serverMate.pos.z)).toBeGreaterThan(C.COURT_HALF_LENGTH);
    const receivingPartner = rally.team.far[receiverSlot(rally.match) === 0 ? 1 : 0];
    expect(Math.abs(receivingPartner.pos.z)).toBeGreaterThanOrEqual(line);
    expect(Math.abs(receivingPartner.pos.z)).toBeLessThan(line + 0.4);
    // Server on the right, partner on the left. Nobody stacks two players in
    // one half at the serve.
    expect(Math.sign(serverMate.pos.x)).toBe(-Math.sign(rally.near.pos.x));
  });

  it('runs a doubles rally without the rules losing track of anyone', () => {
    const rally = createRally('near', 'steady', 2);
    expect(rally.call).toBe('0-0');
    let served = false;
    for (let i = 0; i < 120 * 30; i += 1) {
      const events = stepRally(rally, { ...emptyInput(), swing: !served });
      if (events.some((e) => e.type === 'served')) served = true;
      if (rally.match.phase === 'gameOver') break;
    }
    expect(served).toBe(true);
    // Something was decided, and the call carries the third number all through.
    expect(rally.match.score.near + rally.match.score.far).toBeGreaterThan(0);
    expect(rally.call).toMatch(/^\d+-\d+-[12]$|^game to /);
  });
});
