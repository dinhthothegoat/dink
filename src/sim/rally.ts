import { STYLES, Style } from './style';
import { BallState } from './ball';
import * as C from './constants';
import { Side, TeamSize, otherSlot } from './court';
import { InputFrame, emptyInput } from './input';
import { POWER_SPOT_OFFSET, strike, withSwing } from './paddle';
import {
  PlayerState,
  Reach,
  createPlayer,
  emptyReach,
  inKitchen,
  isContactTick,
  reachTo,
  stepPlayer,
  strainToImpactOffset,
} from './player';
import {
  Match,
  Phase,
  RuleEvent,
  callScore,
  createMatch,
  onMomentumFault,
  nextServe,
  onHit,
  onSimEvent,
  receiverSlot,
  serveSetup,
} from './rules';
import { HUMAN, Skill, perturb, pressureOf } from './execution';
import {
  BASELINE_STANCE,
  Difficulty,
  NVZ_STANCE,
  Opponent,
  createOpponent,
  driveOpponent,
  resetOpponent,
} from './opponent';
import { Rng, createRng } from './rng';
import {
  TeamPlan,
  advanceOn,
  createTeamPlan,
  planTeam,
  resetTeamPlan,
  shapeOf,
  supportPosition,
} from './team';
import { DOUBLES_CLEARANCE, LIVE_SOLVE, ShotShape, ballAt, solveSwing, targetFor } from './solver';
import { Vec3, v3, copy, set } from './vec3';
import { SimEvent, World, createWorld, launch, step } from './world';

export type RallyEvent =
  | SimEvent
  | RuleEvent
  | { type: 'served'; by: Side }
  | {
      type: 'struck';
      by: Side;
      shape: ShotShape;
      exitSpeed: number;
      strain: number;
      /** What made this shot hard, 0 to 1. The error scaled with it. */
      pressure: number;
      /** How far off the middle of the paddle it was, 0 to 1. */
      offCentre: number;
    };

/**
 * A game: two or four players, a ball, and the rules deciding what any of it
 * means.
 *
 * The far side is played by an `Opponent` (Day 6), which sees the same world
 * the human does and answers with the same four-field `InputFrame` a keyboard
 * produces. The rally does not know which end is a person: it steps two
 * players from two input frames, and only `stepRally`'s caller supplies one of
 * them. That is what makes a demo mode, a replay and a second computer player
 * all the same amount of work.
 */
export interface Rally {
  world: World;
  match: Match;
  /**
   * Everyone on the court, by end.
   *
   * Day 13. `near` and `far` below are the same objects as `team.near[0]` and
   * `team.far[0]`, kept because half the codebase reads them and because in
   * singles they are the whole team. Two names for one object is a cost, and it
   * is being paid deliberately: the alternative was rewriting 173 passing tests
   * to say `[0]`, which would have changed a lot of lines that were not wrong.
   */
  team: Record<Side, PlayerState[]>;
  near: PlayerState;
  far: PlayerState;
  /**
   * One reach buffer per player, aliased the same way as `team`.
   *
   * Day 9 gave the two ends separate buffers because a far-side contact was
   * briefly writing into the value the UI reads. Widening to four players
   * reintroduces exactly that bug unless every player owns one, so every player
   * owns one.
   */
  reaches: Record<Side, Reach[]>;
  reach: Reach;
  events: RallyEvent[];
  /** Counts down between points, and before the stand-in serves. */
  waitTimer: number;
  /** What the umpire would be saying right now. */
  call: string;
  /** Seeded, so the opponent's mistakes replay identically. */
  rng: Rng;
  /** The computer player on the far side. Slot 0's brain, kept by name. */
  opponent: Opponent;
  /**
   * A brain per player, or null where a person is driving.
   *
   * Day 15. The near partner has one too, which is what closes DINK-74: when a
   * near-side second server has to serve, there is now somebody there who can.
   */
  minds: Record<Side, (Opponent | null)[]>;
  /** Who is taking the next ball, per team. Decided once a shot. */
  plans: Record<Side, TeamPlan>;
  /**
   * One input frame per player, allocated once.
   *
   * The first cut of Day 15 shared a single `partnerInput` between every brain
   * that was not the far slot-0 opponent. Movement survived it, because each
   * frame is consumed by `stepPlayer` on the line after it is written — but the
   * serve check reads a frame again later in the tick, and by then it belonged
   * to whichever player wrote last. Nobody served. Three brains, one buffer, and
   * the same shape as the reach-buffer bug on Day 9 and again on Day 13.
   */
  frames: Record<Side, InputFrame[]>;
  /** Reach of the far player, kept separate so the two never share a buffer. */
  farReach: Reach;
  /** How well each side executes what it intended. */
  skill: Record<Side, Skill>;
  /** What made the last shot hard, for the readout. */
  lastPressure: number;
}

/** Pause after a point before the next serve is set up. */
const POINT_PAUSE = 1.6;
/** How long the stand-in waits before serving. */
const SERVE_PAUSE = 0.9;
/** Contact height for a serve, roughly waist level. */
const SERVE_HEIGHT = 0.8;

export const createRally = (
  server: Side = 'near',
  difficulty: Difficulty = 'steady',
  teamSize: TeamSize = 1,
  /**
   * Give the near player a brain too, and ignore the keyboard.
   *
   * This is the demo mode ADR-0003 promised for free and never cashed: the
   * rally has never known which end is a person, so making both ends computers
   * is one null becoming an object. It is also the only way to measure doubles,
   * because a human who is not there stands still and loses 11-1.
   */
  autoNear = false,
  /**
   * Offsets every seeded stream in this rally.
   *
   * 0 reproduces the exact game every previous day measured, so nothing that has
   * been published moves. Anything else is a different game.
   *
   * It exists because `tools/doubles.mjs` reported "near won 0 of 12" and then
   * reported the identical shape statistics for 6 games and for 12. Six games
   * were two distinct games repeated three times, because the only thing varying
   * between them was which end served. A sample size of two, printed as twelve.
   * Fifth time in this project that a harness has measured itself.
   */
  seed = 0,
  /**
   * Who the far side is, and who the near side is when it has a brain.
   *
   * Two separate parameters rather than one, because a career match is a named
   * rival on one end and the player on the other, while a style comparison
   * needs both ends fixed. Defaulting both to `all court` keeps every existing
   * caller producing exactly the rally it produced before Day 22.
   */
  farStyle: Style = STYLES['all court'],
  nearStyle: Style = STYLES['all court'],
): Rally => {
  // Two streams, not one. The rally's own stream perturbs both players' swings;
  // the opponent gets a separate one for its decisions. Sharing a single stream
  // left the two ends of the court drawing from it in differently shaped
  // patterns — the far player pulled extra numbers for its read of the ball,
  // the near player did not — and a 20-game measurement showed the two sides
  // mis-hitting at 11 and 16 per cent with identical skill. Not bias in
  // expectation, but enough structure to muddy the fairness check that found
  // the Day 6 bug, and that check is worth more than the saving.
  const salt = (base: number): number => (base + seed * 0x9e3779b9) >>> 0;
  const rng = createRng(salt(0x5eed1234));
  const opponent = createOpponent('far', createRng(salt(0xb1a5e5)), difficulty, farStyle);
  const near = [createPlayer('near', 0)];
  const far = [createPlayer('far', 0)];
  if (teamSize === 2) {
    near.push(createPlayer('near', 1));
    far.push(createPlayer('far', 1));
  }
  const reaches = { near: near.map(emptyReach), far: far.map(emptyReach) };
  // One brain per computer player, each with its own stream, so that adding a
  // partner does not change a single number the far side draws. Seeds are
  // spelled out rather than derived, because a derived seed is a silent
  // coupling between two players who are supposed to be independent.
  const minds: Record<Side, (Opponent | null)[]> = {
    near: [autoNear ? createOpponent('near', createRng(salt(0x6a09e667)), difficulty, nearStyle) : null],
    far: [opponent],
  };
  if (teamSize === 2) {
    minds.near.push(createOpponent('near', createRng(salt(0x9e3779b1)), difficulty, nearStyle));
    minds.far.push(createOpponent('far', createRng(salt(0x2545f491)), difficulty, farStyle));
  }
  const rally: Rally = {
    world: createWorld(),
    match: createMatch(server, teamSize),
    team: { near, far },
    near: near[0],
    far: far[0],
    reaches,
    reach: reaches.near[0],
    farReach: reaches.far[0],
    events: [],
    waitTimer: SERVE_PAUSE,
    call: '0-0',
    rng,
    opponent,
    minds,
    plans: { near: createTeamPlan(), far: createTeamPlan() },
    frames: { near: near.map(emptyInput), far: far.map(emptyInput) },
    // In demo mode both ends execute at the level being demonstrated. Leaving
    // the near end on HUMAN skill (level 0.34 against steady's 0.60) made the
    // near end win 6-0 and made the demo a good player beating a mediocre one
    // rather than a picture of the game.
    skill: {
      near: autoNear ? { ...minds.near[0]!.skill } : { ...HUMAN },
      far: opponent.skill,
    },
    lastPressure: 0,
  };
  parkBallForServe(rally);
  return rally;
};

const _pos = v3();

/**
 * Hold the ball at the server's hand until they swing, and put both players
 * where they would actually stand.
 *
 * The receiver goes BEHIND their baseline, in the box the serve is coming to.
 * That is where receivers stand in the real sport, and it is not decoration:
 * the first version left them on the baseline and they could not return a
 * single serve, because a deep serve bounces and skids away faster than a
 * standing start can follow. Every rally in the first playthrough was one shot
 * long, and the fix was position rather than anything in the physics.
 */
/** Where a partner waits while the serve is played: at the non-volley line. */
const partnerStance = (side: Side, x: number): { x: number; z: number } => ({
  x,
  z: (side === 'near' ? 1 : -1) * (C.KITCHEN_DEPTH + C.PLAYER_RADIUS + 0.12),
});

const park = (player: PlayerState, x: number, z: number): void => {
  player.pos.x = x;
  player.pos.z = z;
  set(player.vel, 0, 0, 0);
};

const parkBallForServe = (rally: Rally): void => {
  const setup = serveSetup(rally.match);
  const serving = rally.match.server;
  const receiving: Side = serving === 'near' ? 'far' : 'near';
  const server = rally.team[serving][rally.match.serverSlot];
  const takingIt = rally.match.teamSize === 2 ? receiverSlot(rally.match) : 0;
  const receiver = rally.team[receiving][takingIt];
  park(server, setup.from.x, setup.from.z);
  park(receiver, setup.target.x, (serving === 'near' ? -1 : 1) * (C.COURT_HALF_LENGTH + 0.9));

  // The two teams do NOT start at the same depth, and that asymmetry is the
  // whole opening of a doubles point.
  //
  // The serving team is pinned back by the two-bounce rule. The receiving team
  // is already at the net except for the one player taking the serve, who comes
  // in behind their return. Starting both teams at the baseline — which is what
  // `resetTeamPlan` did, reasonably — deadlocked the game: a team only plays a
  // third-shot drop when the opponents are at the line, neither team could reach
  // the line, so neither ever saw the other there and both drove from the
  // baseline for ever. Two correct rules, and between them a state neither could
  // leave.
  if (rally.match.teamSize === 2) {
    rally.plans[serving].depth = BASELINE_STANCE;
    rally.plans[receiving].depth = NVZ_STANCE;
    rally.plans[serving].shape = 'up and back';
    rally.plans[receiving].shape = 'up and back';
  }

  // The two who are not in the exchange stand at their own kitchen line, on the
  // other half of the court from their partner. That is not decoration: in
  // doubles the non-serving pair are already at the line before the ball is
  // struck, and the whole third-shot problem exists because of it.
  if (rally.match.teamSize === 2) {
    const half = C.COURT_HALF_WIDTH / 2;
    const serverMate = rally.team[serving][otherSlot(rally.match.serverSlot)];
    const receiverMate = rally.team[receiving][otherSlot(takingIt)];
    const mate = partnerStance(serving, setup.from.x > 0 ? -half : half);
    park(serverMate, mate.x, mate.z);
    const across = partnerStance(receiving, setup.target.x > 0 ? -half : half);
    park(receiverMate, across.x, across.z);
  }
  // The ball sits just in front of the server, on the court side of them.
  set(_pos, setup.from.x, SERVE_HEIGHT, setup.from.z + (rally.match.server === 'near' ? -0.3 : 0.3));
  launch(rally.world, _pos, v3(0, 0, 0), v3(0, 0, 0));
  rally.world.ball.resting = true;
};

const _ballCopy: BallState = { pos: v3(), vel: v3(), spin: v3(), resting: false };

const copyBall = (out: BallState, from: BallState): void => {
  copy(out.pos, from.pos);
  copy(out.vel, from.vel);
  copy(out.spin, from.spin);
  out.resting = from.resting;
};

/**
 * Serve. The direction is not the server's choice: the rules say which box it
 * has to go to, so the solver is aimed at that box and the player's only
 * decision is when to hit it.
 */
const serve = (rally: Rally, side: Side): void => {
  const setup = serveSetup(rally.match);
  const ball = ballAt(
    v3(setup.from.x, SERVE_HEIGHT, setup.from.z - (side === 'near' ? 0.3 : -0.3)),
  );
  const solved = solveSwing(
    ball,
    {
      targetX: setup.target.x,
      targetZ: setup.target.z,
      shape: 'drive',
      facing: side === 'near' ? -1 : 1,
    },
    {},
    LIVE_SOLVE,
  );
  strike(ball, withSwing(solved.swing, { impactOffset: POWER_SPOT_OFFSET }));
  launch(rally.world, ball.pos, ball.vel, ball.spin);
  rally.events.push({ type: 'served', by: side });
  for (const e of onHit(rally.match, side)) rally.events.push(e);
};

/** Strike a live ball for `side`, aiming where their input asked. */
const returnShot = (
  rally: Rally,
  player: PlayerState,
  shape: ShotShape,
  aimX: number,
  aimZ: number,
): void => {
  const side = player.side;
  const ball = rally.world.ball;
  // Each side gets its own reach buffer. Sharing one worked, because the near
  // player's is recomputed at the end of every tick, but it meant a far-side
  // contact briefly wrote into the value the UI reads — a bug waiting for the
  // first person to render mid-tick.
  const reach = reachTo(player, ball, rally.reaches[side][player.slot]);
  if (!reach.canReach) return;

  // The rules get to veto before the physics happens: a shot that would break
  // the two-bounce rule, or that volleys out of the kitchen, is a fault rather
  // than a shot.
  const wasVolley = rally.match.bouncesSinceHit === 0;
  const ruled = onHit(rally.match, side, inKitchen(player));
  const faulted = ruled.some((e) => e.type === 'fault');
  for (const e of ruled) rally.events.push(e);
  if (faulted) return;

  // A legal volley arms the momentum window: from here the striker has to keep
  // out of the kitchen until they have re-established, or the point is theirs to
  // lose. Only a volley — you may step in freely to play a ball that bounced.
  if (wasVolley) player.momentumLeft = C.NVZ_MOMENTUM;

  const facing = player.facing;
  const { targetX, targetZ } = targetFor(shape, aimX, aimZ, facing);
  copyBall(_ballCopy, ball);
  // Doubles asks the solver for real net clearance on a long shot; singles keeps
  // the flat rule its difficulty ladder is calibrated on. See SolveOptions.
  const solved = solveSwing(
    _ballCopy,
    { targetX, targetZ, shape, facing },
    {},
    rally.match.teamSize === 2
      ? { ...LIVE_SOLVE, clearancePerMetre: DOUBLES_CLEARANCE }
      : LIVE_SOLVE,
  );
  // What the shot was worth attempting, and then what actually happened. The
  // pressure is measured before the strike, from the ball as it arrives and the
  // player as they are: how far they reached, how fast it came, how low they
  // took it, and how fast they were still moving.
  const pressure = pressureOf(
    ball,
    ball.pos.y,
    reach.strain,
    Math.hypot(player.vel.x, player.vel.z),
  );
  rally.lastPressure = pressure.total;

  const intended = withSwing(solved.swing, {
    impactOffset: strainToImpactOffset(reach.strain, POWER_SPOT_OFFSET),
  });
  const result = strike(ball, perturb(intended, rally.skill[side], pressure, rally.rng));
  rally.events.push({
    type: 'struck',
    by: side,
    shape,
    exitSpeed: result.exitSpeed,
    strain: reach.strain,
    pressure: pressure.total,
    offCentre: result.offCentre,
  });
};

const SIDES = ['near', 'far'] as const;

/** Both teams' depth as it was at the top of the tick. Reused, never allocated. */
const _depthNow: Record<Side, number> = { near: 0, far: 0 };



/**
 * Read the current phase without letting TypeScript narrow it.
 *
 * Serving and the rules engine both mutate `match.phase` inside calls the
 * compiler cannot see through, so a narrowed `phase` from an earlier branch is
 * stale by the time it is checked again. Reading it through here says out loud
 * that the value moves under our feet on purpose.
 */
const phaseOf = (match: Match): Phase => match.phase;

/** Advance the whole game one fixed tick. */
export const stepRally = (rally: Rally, input: InputFrame): RallyEvent[] => {
  rally.events.length = 0;
  const { match, world } = rally;

  // Day 15. One path for everybody, and the only asymmetry left is which player
  // has a brain and which has a keyboard. `Side` is the end; `slot` is who.
  //
  // Two phases, deliberately. Every brain decides from the same world, and only
  // then does anybody move. Folding the two together — deciding and stepping one
  // player before the next one thinks — makes the second player read a world the
  // first has already changed, and the difficulty ladder moved by a whole match
  // out of six when that happened by accident. Simultaneity is not a detail in a
  // game whose fairness check is a mirrored rematch.
  //
  // Ownership is decided here, once per side per tick, but `planTeam` commits
  // for a whole shot: calling it every tick and having it refuse to change its
  // mind is what stops two players drifting at half commitment toward the same
  // ball. Serving and receiving are forced from the rules rather than scored,
  // because "who can get there fastest" is not an opinion the rulebook takes.
  for (const side of SIDES) {
    const players = rally.team[side];
    // Who is a PERSON on this team, not which end is nearest the camera.
    //
    // `planTeam` gives a human two advantages over their own partner: a bias on
    // the time-to-arrive comparison, and every middle ball outright. Both are
    // deliberate, because a partner that takes balls out of your paddle is the
    // most disliked behaviour in co-op sports AI — and both are a HANDICAP when
    // applied to a computer, because they hand one player balls the other should
    // take and drag them out of position to do it.
    //
    // Demo mode had no human and was still getting the human treatment on the
    // near end. Across sixteen seeded games the near pair won 1. Singles, which
    // never consults this, won 10 of 16. An end that loses fifteen games in a row
    // is not unlucky.
    const humanSlot = side === 'near' && rally.minds.near[0] === null ? 0 : null;
    const forced =
      match.teamSize === 1
        ? null
        : phaseOf(match) === 'awaitingServe'
          ? side === match.server
            ? match.serverSlot
            : receiverSlot(match)
          : match.hitsThisRally === 1 && side !== match.server
            ? receiverSlot(match)
            : null;
    planTeam(rally.plans[side], world, match, side, players, humanSlot, forced);
  }

  // Snapshot both teams' depth before anybody moves.
  //
  // Same lesson as Day 15's two-phase step, in a new place. The driving loop
  // mutates the owner's team depth, so a team processed second read a depth its
  // opponents had already updated this tick while the team processed first read
  // a stale one. It is a one-tick advantage and it is worth an entire match: the
  // far end won 6 of 6 with the server alternating, which is an end bias, not
  // tactics. Reading a snapshot makes both ends see the same court.
  _depthNow.near = rally.plans.near.depth;
  _depthNow.far = rally.plans.far.depth;

  for (const side of SIDES) {
    const players = rally.team[side];
    // The `other` a brain reasons about is an OPPONENT, not a team-mate. It is
    // used for the bisector it stands on and for the side of the court it aims
    // away from, and passing the partner instead — which the first cut of this
    // did — makes a player shade toward the empty half and aim at the player
    // they were trying to avoid. The far team lost 11-0 with rallies three shots
    // long and every fault reading "double bounce", which is what being in the
    // wrong place looks like from the scoreboard.
    const acrossSide: Side = side === 'near' ? 'far' : 'near';
    const across = rally.team[acrossSide];
    const foe = across[rally.plans[acrossSide].owner] ?? across[0];

    const plan = rally.plans[side];
    for (const player of players) {
      const mind = rally.minds[side][player.slot];
      if (!mind) continue;
      const owns = plan.owner === player.slot;
      // Day 16. Depth is the team's, not the player's. Everyone stands at it,
      // and only the player actually hitting the ball is allowed to change it —
      // they are the one who either earned the step forward or got pushed back.
      mind.stance = plan.depth;
      // Whether the other pair is already at the net, which is what turns a deep
      // ball into a third-shot drop. Singles never sets it: its creep-forward
      // model is measured and works with one player covering the court.
      mind.foeAtLine = match.teamSize === 2 && _depthNow[acrossSide] < NVZ_STANCE + 1.2;
      // Every player gets a station, owner included: it is where they wait when
      // the ball is on the other side of the net, and the owner needs one just
      // as much as the partner does.
      mind.paired = match.teamSize === 2;
      if (mind.paired) supportPosition(mind.support, player, plan, match.score[side]);
      driveOpponent(mind, world, match, player, foe, rally.frames[side][player.slot], owns);
      if (owns) {
        plan.depth = mind.stance;
        plan.shape = shapeOf(plan.depth);
        // In doubles the shot itself says where the team is going. A drop is
        // played in order to come in behind it; creeping forward half a metre at
        // a time is a singles habit that cannot cover the distance in a rally
        // this short.
        if (match.teamSize === 2 && rally.frames[side][player.slot].swing) {
          advanceOn(plan, rally.frames[side][player.slot].shape);
        }
      }
    }
  }

  for (const side of SIDES) {
    for (const player of rally.team[side]) {
      const mind = rally.minds[side][player.slot];
      stepPlayer(player, mind ? rally.frames[side][player.slot] : input, C.SIM_DT);
    }
  }

  // --- between points ------------------------------------------------------
  if (phaseOf(match) === 'betweenPoints') {
    rally.waitTimer -= C.SIM_DT;
    if (rally.waitTimer <= 0) {
      nextServe(match);
      parkBallForServe(rally);
      for (const side of SIDES) {
        resetTeamPlan(rally.plans[side]);
        for (const mind of rally.minds[side]) if (mind) resetOpponent(mind);
      }
      rally.waitTimer = SERVE_PAUSE;
      rally.call = callScore(match);
    }
    return rally.events;
  }

  if (phaseOf(match) === 'gameOver') return rally.events;

  // --- the serve -----------------------------------------------------------
  if (phaseOf(match) === 'awaitingServe') {
    parkBallForServe(rally);
    // Whoever's input asks for it serves. The opponent counts its own pause.
    // Whoever is on serve asks. In doubles that may be the near partner, whose
    // brain filled in `partnerInput` above — which is the whole of DINK-74.
    const serverMind = rally.minds[match.server][match.serverSlot];
    const asked = serverMind ? rally.frames[match.server][match.serverSlot].swing : input.swing;
    if (asked) serve(rally, match.server);
    if (phaseOf(match) !== 'inPlay') return rally.events;
  }

  // --- contact -------------------------------------------------------------
  for (const side of SIDES) {
    for (const player of rally.team[side]) {
      if (isContactTick(player, C.SIM_DT)) {
        returnShot(rally, player, player.queuedShape, player.queuedAimX, player.queuedAimZ);
      }
    }
  }

  // --- momentum carried into the kitchen -----------------------------------
  //
  // Checked every tick rather than once, because the fault is about where the
  // player ENDS UP: they can be behind the line at contact and still drift in
  // two tenths of a second later, which is exactly the call this models.
  outer: for (const side of SIDES) {
    for (const player of rally.team[side]) {
      if (player.momentumLeft > 0 && inKitchen(player)) {
        player.momentumLeft = 0;
        for (const e of onMomentumFault(match, side)) rally.events.push(e);
        break outer;
      }
    }
  }

  // --- physics, then the rules on what the physics did ----------------------
  for (const e of step(world)) {
    rally.events.push(e);
    for (const r of onSimEvent(match, e)) rally.events.push(r);
  }

  if (phaseOf(match) === 'betweenPoints') {
    rally.waitTimer = POINT_PAUSE;
    rally.call = callScore(match);
  }

  reachTo(rally.near, world.ball, rally.reach);
  return rally.events;
};

/*
 * There was a `resetRally` here until Day 10, when a review found nothing had
 * called it since Day 9. It reset seven fields of a Rally by hand, and every
 * time a new one was added it had to be remembered — which it twice was not.
 * `startGame` builds a fresh `Rally` instead, which cannot go stale. Deleting it
 * is the fix rather than the cleanup: a half-correct reset that nothing calls is
 * a trap waiting for whoever needs a reset next.
 */

/** Where the near player's paddle should be drawn. */
export const paddleAt = (
  out: Vec3,
  rally: Rally,
  /**
   * The player and ball as DRAWN, not as simulated.
   *
   * Both default to the raw simulation state, which is what every caller passed
   * until Day 16. The renderer passes its interpolated pair instead, because a
   * paddle placed from the simulated ball and drawn next to an interpolated one
   * misses it by up to 24 cm — which is what "the player stood still and hit it
   * anyway" looks like from the outside.
   */
  playerPos: Vec3 = rally.near.pos,
  ballPos: Vec3 = rally.world.ball.pos,
): Vec3 => {
  const p = playerPos;
  const b = ballPos;
  const dx = b.x - p.x;
  const dz = b.z - p.z;
  const d = Math.hypot(dx, dz);
  const playable = rally.reach.canReach;
  const hold = playable ? Math.min(d, C.PLAYER_REACH * 0.8) : 0.42;
  const y = playable
    ? Math.min(C.PLAYER_STRIKE_HIGH, Math.max(C.PLAYER_STRIKE_LOW, b.y))
    : 0.95;
  return d < 1e-4
    ? set(out, p.x, 0.95, p.z - 0.42)
    : set(out, p.x + (dx / d) * hold, y, p.z + (dz / d) * hold);
};
