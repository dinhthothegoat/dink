import { describe, expect, it } from 'vitest';
import * as C from '../src/sim/constants';
import { Side, TeamSize } from '../src/sim/court';
import { emptyInput } from '../src/sim/input';
import { createOpponent, driveOpponent, NVZ_STANCE } from '../src/sim/opponent';
import { createPlayer } from '../src/sim/player';
import { createRally, stepRally } from '../src/sim/rally';
import { createRng } from '../src/sim/rng';
import { createMatch, receiverSlot, serveSetup } from '../src/sim/rules';
import { createTeamPlan, halfSign, planTeam } from '../src/sim/team';
import { v3 } from '../src/sim/vec3';
import { createWorld, launch } from '../src/sim/world';

describe('serve formation', () => {
  it('keeps the receiver in their assigned half from either end of the court', () => {
    for (const server of ['near', 'far'] as Side[]) {
      for (const near of [0, 1]) for (const far of [0, 1]) for (const slot of [0, 1] as const) {
        const match = createMatch(server, 2);
        match.score = { near, far };
        match.serverSlot = slot;
        const receiving = server === 'near' ? 'far' : 'near';
        expect(halfSign(receiving, receiverSlot(match), match.score[receiving]))
          .toBe(Math.sign(serveSetup(match).target.x));
      }
    }
  });
  for (const side of ['near', 'far'] as Side[]) {
    for (const size of [1, 2] as TeamSize[]) {
      it(`${side}, ${size} a side: every server stands fully behind the baseline`, () => {
        const r = createRally(side, 'steady', size);
        for (const score of [0, 1]) for (const slot of size === 2 ? [0, 1] as const : [0] as const) {
          r.match.score[side] = score;
          r.match.serverSlot = slot;
          stepRally(r, emptyInput());
          const server = r.team[side][slot];
          expect(Math.abs(server.pos.z) - C.PLAYER_RADIUS).toBeGreaterThan(C.COURT_HALF_LENGTH);
          expect(Math.abs(r.world.ball.pos.z)).toBeGreaterThan(C.COURT_HALF_LENGTH);
          if (size === 2) {
            const mate = r.team[side][slot === 0 ? 1 : 0];
            expect(Math.abs(mate.pos.z)).toBeGreaterThan(C.COURT_HALF_LENGTH);
            expect(Math.sign(mate.pos.x)).toBe(-Math.sign(server.pos.x));
            const receiving = side === 'near' ? 'far' : 'near';
            const receiver = receiverSlot(r.match);
            expect(Math.abs(r.team[receiving][receiver].pos.z)).toBeGreaterThan(C.COURT_HALF_LENGTH);
            expect(Math.abs(r.team[receiving][receiver === 0 ? 1 : 0].pos.z)).toBeCloseTo(NVZ_STANCE);
          }
        }
      });
    }
  }
});

describe('active recovery', () => {
  for (const side of ['near', 'far'] as Side[]) {
    const sign = side === 'near' ? 1 : -1;
    it(`${side} recovers immediately after its own shot`, () => {
      const world = createWorld();
      launch(world, v3(2 * sign, 1, 4 * sign), v3(0, 1, -8 * sign), v3());
      const match = createMatch(side);
      match.phase = 'inPlay';
      match.hitsThisRally = 4;
      match.lastHitBy = side;
      const self = createPlayer(side);
      self.pos.x = 2 * sign;
      self.pos.z = 5 * sign;
      const brain = createOpponent(side, createRng(1));
      brain.stance = NVZ_STANCE;
      const out = emptyInput();
      driveOpponent(brain, world, match, self, createPlayer(side === 'near' ? 'far' : 'near'), out);
      expect(out.moveX * sign).toBeLessThan(0);
      expect(out.moveZ * sign).toBeLessThan(0);
      expect(out.swing).toBe(false);
      expect(brain.reactionLeft).toBe(0);
    });

    it(`${side} keeps recovering while reading the opponent's shot`, () => {
      const world = createWorld();
      launch(world, v3(0, 1, -4 * sign), v3(0, 1, 8 * sign), v3());
      const match = createMatch(side);
      match.phase = 'inPlay';
      match.hitsThisRally = 4;
      match.lastHitBy = side === 'near' ? 'far' : 'near';
      const self = createPlayer(side);
      self.pos.x = 2 * sign;
      self.pos.z = 5 * sign;
      const brain = createOpponent(side, createRng(1));
      brain.stance = NVZ_STANCE;
      const out = emptyInput();
      driveOpponent(brain, world, match, self, createPlayer(match.lastHitBy), out);
      expect(out.moveX * sign).toBeLessThan(0);
      expect(out.swing).toBe(false);
      expect(brain.reactionLeft).toBeGreaterThan(0);
    });
  }

  it('steps into the kitchen for a ball that has already bounced', () => {
    const world = createWorld();
    launch(world, v3(0, 0.6, 1.2), v3(0, 1, 0.2), v3());
    const match = createMatch('far');
    Object.assign(match, { phase: 'inPlay', hitsThisRally: 4, bouncesSinceHit: 1, lastHitBy: 'far' });
    const self = createPlayer('near');
    self.pos.z = 2.35;
    const brain = createOpponent('near', createRng(1));
    brain.reactedTo = 4;
    const out = emptyInput();
    driveOpponent(brain, world, match, self, createPlayer('far'), out);
    expect(out.moveZ).toBeLessThan(0);
  });
});

describe('approach and doubles coverage', () => {
  it('recognises a comfortable baseline contact as an approach opportunity', () => {
    const world = createWorld();
    launch(world, v3(0, 0.8, 5.6), v3(0, 0, 0.5), v3());
    const match = createMatch('far');
    Object.assign(match, { phase: 'inPlay', hitsThisRally: 4, bouncesSinceHit: 1, lastHitBy: 'far' });
    const player = createPlayer('near');
    player.pos.z = 6.2;
    const brain = createOpponent('near', createRng(1));
    brain.reactedTo = 4;
    const out = emptyInput();
    driveOpponent(brain, world, match, player, createPlayer('far'), out);
    expect(out.swing).toBe(true);
    expect(brain.lastReason).toBe('drive and approach');
  });

  it('does not advance a doubles team before a drop actually makes contact', () => {
    const r = createRally('far', 'steady', 2, true);
    Object.assign(r.match, { phase: 'inPlay', hitsThisRally: 4, bouncesSinceHit: 1, lastHitBy: 'far' });
    const player = r.team.near[0];
    player.pos.x = 1.5;
    player.pos.z = 4;
    r.team.near[1].pos.x = -2;
    r.team.near[1].pos.z = 6;
    for (const brain of r.minds.near) {
      if (brain) { brain.reactedTo = 4; brain.readOff = 0; }
    }
    r.plans.near.depth = 6.2;
    launch(r.world, v3(1.5, 0.8, 3.7), v3(0, 0, 0.5), v3());
    const events = stepRally(r, emptyInput());
    expect(player.phase).toBe('windup');
    expect(events.some(e => e.type === 'struck')).toBe(false);
    expect(r.plans.near.depth).toBe(6.2);
  });

  it.each([1, 2] as TeamSize[])('follows a successful return to the net (%s a side)', size => {
    const r = createRally('far', 'steady', size, true);
    Object.assign(r.match, { phase: 'inPlay', hitsThisRally: 1, bouncesSinceHit: 1, lastHitBy: 'far' });
    const player = r.team.near[receiverSlot(r.match)];
    player.pos.x = 0;
    player.pos.z = 5;
    player.phase = 'windup';
    player.queuedShape = 'drive';
    launch(r.world, v3(0, 0.8, 4.7), v3(0, 0, 1), v3());
    r.plans.near.depth = 6.2;
    // A contact tick is reached after stepPlayer subtracts one timestep.
    player.phaseTime = C.SIM_DT * 2;
    const events = stepRally(r, emptyInput());
    expect(events.some(e => e.type === 'struck' && e.by === 'near')).toBe(true);
    expect(r.plans.near.depth).toBeCloseTo(NVZ_STANCE);
  });

  it('gives the partner a middle ball when the human is far away', () => {
    const world = createWorld();
    launch(world, v3(0, 0.7, 2.8), v3(0, 0, 2), v3());
    const match = createMatch('far', 2);
    Object.assign(match, { phase: 'inPlay', hitsThisRally: 4, bouncesSinceHit: 1, lastHitBy: 'far' });
    const human = createPlayer('near', 0);
    human.pos.x = 4;
    human.pos.z = 8;
    const partner = createPlayer('near', 1);
    partner.pos.x = 0;
    partner.pos.z = 3.2;
    const plan = planTeam(createTeamPlan(), world, match, 'near', [human, partner], 0);
    expect(plan.owner).toBe(1);
  });
});
