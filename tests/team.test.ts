import { describe, expect, it } from 'vitest';
import * as C from '../src/sim/constants';
import { emptyInput } from '../src/sim/input';
import { createPlayer } from '../src/sim/player';
import { createRally, stepRally } from '../src/sim/rally';
import { createMatch } from '../src/sim/rules';
import {
  TeamPlan,
  advanceOn,
  createTeamPlan,
  halfSign,
  leftCourtPlayer,
  planTeam,
  supportPosition,
} from '../src/sim/team';
import { createWorld, launch } from '../src/sim/world';
import { v3 } from '../src/sim/vec3';

/**
 * Day 15. Ball ownership.
 *
 * The claim under test is narrow and it is the one that decides whether a
 * computer partner is a partner or a liability: exactly one player on a team
 * plays each ball, the choice is made once per shot rather than every tick, and
 * the rulebook overrides it where the rulebook has an opinion.
 */

const pairAt = (side: 'near' | 'far', x0: number, z0: number, x1: number, z1: number) => {
  const a = createPlayer(side, 0);
  const b = createPlayer(side, 1);
  a.pos.x = x0;
  a.pos.z = z0;
  b.pos.x = x1;
  b.pos.z = z1;
  return [a, b];
};

/** A ball crossing toward `near`, high enough and slow enough to be playable. */
const incoming = () => {
  const world = createWorld();
  launch(world, v3(0.2, 1.0, -1.5), v3(0, 1.5, 9), v3(0, 0, 0));
  return world;
};

describe('who takes the ball', () => {
  it('gives it to whoever can get there first', () => {
    const world = incoming();
    const match = createMatch('far', 2);
    match.phase = 'inPlay';
    match.hitsThisRally = 4;
    match.bouncesSinceHit = 0;
    const plan = createTeamPlan();

    const far = pairAt('near', 5.0, 5.0, -0.4, 3.0);
    planTeam(plan, world, match, 'near', far);
    expect(plan.owner).toBe(1);
    expect(plan.reason).toMatch(/closer|middle/);
  });

  it('decides once a shot and then refuses to change its mind', () => {
    // The whole mechanism. Two players a metre apart trade "closest" on
    // alternate ticks, and a claim that follows that is two players drifting at
    // half commitment. The claim is pinned to the shot number instead.
    // Deliberately NOT a middle ball: the convention would decide it and this
    // test is about commitment, not about the convention. Getting that wrong is
    // how the first version of this test failed — it asserted the arithmetic
    // while the middle-ball rule was correctly overruling it.
    const world = createWorld();
    launch(world, v3(2.2, 1.0, -1.5), v3(0, 1.5, 9), v3(0, 0, 0));
    const match = createMatch('far', 2);
    match.phase = 'inPlay';
    match.hitsThisRally = 4;
    const plan = createTeamPlan();
    const players = pairAt('near', 4.0, 4.0, -1.0, 3.0);
    planTeam(plan, world, match, 'near', players);
    const first = plan.owner;
    const other = first === 0 ? 1 : 0;

    // Teleport the other player on top of the ball. Nothing should move.
    players[other].pos.x = world.ball.pos.x;
    players[other].pos.z = 1.0;
    planTeam(plan, world, match, 'near', players);
    expect(plan.owner).toBe(first);

    // A new shot is a new decision.
    match.hitsThisRally = 5;
    planTeam(plan, world, match, 'near', players);
    expect(plan.owner).toBe(other);
  });

  it('lets the rulebook overrule the arithmetic', () => {
    const world = incoming();
    const match = createMatch('far', 2);
    match.phase = 'inPlay';
    match.hitsThisRally = 1;
    const plan = createTeamPlan();
    // Slot 1 is standing on the ball, and slot 0 is the correct receiver.
    const players = pairAt('near', 6.0, 6.0, 0.2, 1.0);
    planTeam(plan, world, match, 'near', players, null, 0);
    expect(plan.owner).toBe(0);
    expect(plan.reason).toBe('receiving');
  });

  it('gives a middle ball to the left-court player, and gives the same answer twice', () => {
    const world = createWorld();
    launch(world, v3(0, 1.0, -1.5), v3(0, 1.6, 9), v3(0, 0, 0));
    const match = createMatch('far', 2);
    match.phase = 'inPlay';
    match.hitsThisRally = 4;
    // Symmetric: neither is closer, which is exactly when "closest" is a coin
    // toss and the convention has to decide it.
    const players = pairAt('near', 1.6, 3.0, -1.6, 3.0);
    const a = planTeam(createTeamPlan(), world, match, 'near', players);
    const b = planTeam(createTeamPlan(), world, match, 'near', players);
    expect(a.reason).toBe('middle ball');
    expect(a.owner).toBe(b.owner);
    expect(a.owner).toBe(leftCourtPlayer(players).slot);
  });

  it('never overrules a human on their own team', () => {
    const world = incoming();
    const match = createMatch('far', 2);
    match.phase = 'inPlay';
    match.hitsThisRally = 4;
    // The partner is nearer. The human still gets it, because a partner that
    // takes balls out of your paddle is the behaviour players hate most.
    const players = pairAt('near', 2.2, 3.4, 0.2, 2.0);
    const plan = planTeam(createTeamPlan(), world, match, 'near', players, 0);
    expect(plan.owner).toBe(0);
  });

  it('picks the left-court player from each side of the net correctly', () => {
    // The right court is +x near and -x far. This project has had five sign
    // bugs of exactly this shape, so both ends are asserted.
    expect(leftCourtPlayer(pairAt('near', 1.5, 5, -1.5, 5)).slot).toBe(1);
    expect(leftCourtPlayer(pairAt('far', 1.5, -5, -1.5, -5)).slot).toBe(0);
  });
});

describe('where the partner stands', () => {
  const planAt = (depth: number): TeamPlan => ({ ...createTeamPlan(), depth });

  it('stands in its own half, whatever the partner is doing', () => {
    // Day 15 mirrored the partner's live x, so a support followed its partner
    // into the corner they had just run to. A station does not move.
    const out = { x: 0, z: 0 };
    const [slot0, slot1] = pairAt('near', 0, 5, 0, 5);
    supportPosition(out, slot0, planAt(5), 0);
    expect(out.x).toBeCloseTo(C.COURT_HALF_WIDTH / 2, 2);
    supportPosition(out, slot1, planAt(5), 0);
    expect(out.x).toBeCloseTo(-C.COURT_HALF_WIDTH / 2, 2);
  });

  it('swaps halves with the score, like the serve rotation it derives from', () => {
    const out = { x: 0, z: 0 };
    const [slot0] = pairAt('near', 0, 5, 0, 5);
    supportPosition(out, slot0, planAt(5), 0);
    const even = out.x;
    supportPosition(out, slot0, planAt(5), 1);
    expect(Math.sign(out.x)).toBe(-Math.sign(even));
  });

  it('stands at the team depth, not at the partner depth', () => {
    const out = { x: 0, z: 0 };
    const [self] = pairAt('near', -1.5, 2.5, 1.5, 6.0);
    supportPosition(out, self, planAt(3.1), 0);
    expect(out.z).toBeCloseTo(3.1, 2);
  });

  it('never stands closer to the net than the non-volley line', () => {
    const out = { x: 0, z: 0 };
    const [self] = pairAt('far', -1.5, -0.1, 1.5, -0.1);
    supportPosition(out, self, planAt(0), 0);
    expect(Math.abs(out.z)).toBeGreaterThanOrEqual(C.KITCHEN_DEPTH + C.PLAYER_RADIUS);
    expect(Math.sign(out.z)).toBe(-1);
  });

  it.each(['near', 'far'] as const)('shifts both %s partners toward play without crossing halves', (side) => {
    const own = side === 'near' ? 1 : -1;
    const pair = pairAt(side, 1.5, own * 2.6, -1.5, own * 2.6);
    for (const score of [0, 1]) {
      const left = pair.map(self => supportPosition({ x: 0, z: 0 }, self, planAt(2.6), score, -2.5));
      const right = pair.map(self => supportPosition({ x: 0, z: 0 }, self, planAt(2.6), score, 2.5));
      pair.forEach((self, i) => {
        expect(right[i].x).toBeGreaterThan(left[i].x + 0.5);
        expect(Math.sign(left[i].x)).toBe(halfSign(side, self.slot, score));
        expect(Math.sign(right[i].x)).toBe(halfSign(side, self.slot, score));
        expect(right[i].z).toBeCloseTo(own * 2.6);
      });
      expect(Math.abs(right[0].x - right[1].x)).toBeCloseTo(C.COURT_HALF_WIDTH);
    }
  });

  it('bounds lateral coverage even when a ball goes far outside the court', () => {
    const pair = pairAt('near', 1.5, 3, -1.5, 3);
    for (const x of [-100, 100]) {
      for (const self of pair) {
        const target = supportPosition({ x: 0, z: 0 }, self, planAt(3), 0, x);
        expect(Math.abs(target.x)).toBeLessThan(C.COURT_HALF_WIDTH - C.PLAYER_RADIUS);
        expect(Math.abs(target.x)).toBeGreaterThan(0.7);
      }
    }
  });

  it('updates live recovery targets when the ball changes lateral position', () => {
    const targets = [-2, 2].map(x => {
      const rally = createRally('near', 'steady', 2, true);
      rally.match.phase = 'inPlay';
      rally.match.hitsThisRally = 4;
      rally.match.lastHitBy = 'near';
      launch(rally.world, v3(x, 1, -3), v3(0, 1, -4), v3());
      stepRally(rally, emptyInput());
      return rally.minds.near.map(mind => mind!.support.x);
    });
    expect(targets[1][0]).toBeGreaterThan(targets[0][0]);
    expect(targets[1][1]).toBeGreaterThan(targets[0][1]);
  });
});

describe('a doubles game plays itself', () => {
  /**
   * The acceptance test for the day, and the number it is really about.
   *
   * `autoNear` is the demo mode ADR-0003 promised on Day 3 and never cashed: the
   * rally has never known which end is a person, so both ends being computers is
   * one null becoming an object.
   */
  const selfPlay = (teamSize: 1 | 2) => {
    const rally = createRally('near', 'steady', teamSize, true);
    const idle = emptyInput();
    let asksByOwner = 0;
    let asksByOthers = 0;
    let shots = 0;
    let rallies = 0;
    // 900 simulated seconds, not 400.
    //
    // Day 18 made rallies longer and a doubles game to 11 now takes 356 to 547
    // seconds, which is roughly what a real one takes. The budget was raised
    // after checking it was slowness rather than a stall: the duration probe had
    // every game finishing, with the longest rally at 11 shots. A stalled game
    // and a slow one fail this assertion identically, so the difference has to be
    // established before the number is changed.
    for (let i = 0; i < 120 * 900; i += 1) {
      for (const e of stepRally(rally, idle)) {
        if (e.type === 'struck' || e.type === 'served') shots += 1;
        if (e.type === 'fault') rallies += 1;
      }
      for (const side of ['near', 'far'] as const) {
        for (const p of rally.team[side]) {
          if (!rally.frames[side][p.slot].swing) continue;
          if (rally.plans[side].owner === p.slot) asksByOwner += 1;
          else asksByOthers += 1;
        }
      }
      if (rally.match.phase === 'gameOver') break;
    }
    return { rally, asksByOwner, asksByOthers, shots, rallies };
  };

  // A cold full-game simulation exceeded Vitest's 5 s default on CI.
  // Keep the 900 simulated-second cap and all gameplay assertions unchanged.
  it('plays a doubles game to a finish with nobody at the keyboard', () => {
    const { rally, shots, rallies } = selfPlay(2);
    expect(rally.match.phase).toBe('gameOver');
    expect(rallies).toBeGreaterThan(10);
    expect(shots / rallies).toBeGreaterThan(2);
  }, 15_000);

  it('never asks to swing with a player who does not own the ball', () => {
    // This started at 58 asks out of 240, all of them serves: the serve branch
    // ran before the ownership gate, so both players on the serving team said
    // "I am serving" every tick. Nothing broke, because the rally reads only the
    // correct server's frame — a lie that happened to be unread.
    const { asksByOwner, asksByOthers } = selfPlay(2);
    expect(asksByOwner).toBeGreaterThan(50);
    expect(asksByOthers).toBe(0);
  }, 15_000);

  it('gives every player their own input frame', () => {
    const rally = createRally('near', 'steady', 2, true);
    const all = [...rally.frames.near, ...rally.frames.far];
    expect(new Set(all).size).toBe(4);
  });

  it('leaves singles alone', () => {
    const { rally, asksByOthers } = selfPlay(1);
    expect(rally.match.phase).toBe('gameOver');
    expect(asksByOthers).toBe(0);
    expect(rally.plans.near.reason).toBe('singles');
  });
});

/**
 * Day 16. Formations, and what the pair does when the ball is elsewhere.
 */
describe('the team shape', () => {
  it('sends a team to the line on a drop and back on a lob', () => {
    const plan = createTeamPlan();
    plan.depth = 6.2;
    advanceOn(plan, 'drop');
    expect(plan.depth).toBeLessThan(3.6);
    expect(plan.shape).toBe('up and back');
    advanceOn(plan, 'lob');
    expect(plan.depth).toBeGreaterThan(3.6);
  });

  it('leaves a drive alone, because a drive is not a way in', () => {
    const plan = createTeamPlan();
    plan.depth = 5.0;
    advanceOn(plan, 'drive');
    expect(plan.depth).toBe(5.0);
  });

  it('puts each slot in its own half, and swaps them with the score', () => {
    // The same invariant the serve rotation runs on. Both ends asserted,
    // because five of this project's bugs have been this sign.
    expect(halfSign('near', 0, 0)).toBe(1);
    expect(halfSign('near', 1, 0)).toBe(-1);
    expect(halfSign('near', 0, 1)).toBe(-1);
    expect(halfSign('far', 0, 0)).toBe(-1);
    expect(halfSign('far', 0, 1)).toBe(1);
  });

  it('charges a player for raiding their partner half', () => {
    const world = createWorld();
    // A ball heading well into slot 1's half, with slot 0 marginally closer.
    launch(world, v3(-2.2, 1.0, -1.5), v3(0, 1.5, 9), v3(0, 0, 0));
    const match = createMatch('far', 2);
    match.phase = 'inPlay';
    match.hitsThisRally = 4;
    const players = pairAt('near', -1.2, 3.4, -1.6, 4.2);
    const plan = planTeam(createTeamPlan(), world, match, 'near', players);
    expect(halfSign('near', plan.owner, 0)).toBe(-1);
  });

  it('starts the two teams at different depths, because doubles does', () => {
    // The serving team is pinned back by the two-bounce rule; the receiving team
    // is already at the net bar the one taking the serve. Starting both at the
    // baseline deadlocked the game for an hour: a team only drops when the
    // opponents are at the line, and neither could ever get there.
    const rally = createRally('near', 'steady', 2, true);
    expect(rally.plans.near.depth).toBeGreaterThan(rally.plans.far.depth);
  });
});
