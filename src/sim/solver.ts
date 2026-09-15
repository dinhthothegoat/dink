import { BallState } from './ball';
import * as C from './constants';
import { netHeightAt } from './court';
import { Swing, defaultSwing, strike, withSwing } from './paddle';
import { Vec3, v3, copy } from './vec3';
import { World, createWorld, launch, step } from './world';

/**
 * Where a shot should go and what shape it should have.
 *
 * The shape is not cosmetic. A drive and a lob can land on the same spot, and
 * choosing between them is the whole of pickleball tactics, so the solver has
 * to be told which one is wanted rather than inferring it from the target.
 */
export type ShotShape = 'drive' | 'drop' | 'lob';

export interface ShotIntent {
  targetX: number;
  targetZ: number;
  shape: ShotShape;
  facing: -1 | 1;
}

export interface ShotOutcome {
  /** Landing point of the first bounce, or null if it netted or flew out. */
  landing: Vec3 | null;
  netted: boolean;
  apex: number;
  /** Gap between the bottom of the ball and the top of the net, in metres. */
  clearance: number;
  flightSeconds: number;
}

/**
 * Play a swing out to its first bounce. Used by the solver and by tests; the
 * rally loop will not call this, since it simulates continuously.
 */
/**
 * Scratch state, reused across every call.
 *
 * This function is the inner loop of the whole simulation: `solveSwing` calls it
 * about 190 times, and `solveSwing` runs inside the tick that resolves a
 * contact. Allocating a ball and a world per candidate meant roughly 1,700
 * short-lived objects per shot, arriving in a burst at precisely the moment a
 * garbage collection is least welcome. Measured at 300 simulated seconds: one
 * collection every 507 ticks, worst pause 4.78 ms against an 8.3 ms tick.
 *
 * Reusing them is safe because nothing in the returned outcome points back into
 * the probe. `landing` is the `at` of a bounce event, which `step` already
 * builds as a copy, and everything else is a number or a boolean. That was
 * checked before this was written, not assumed.
 */
const _probeBall: BallState = { pos: v3(), vel: v3(), spin: v3(), resting: false };
let _probeWorld: World | null = null;

export const simulateSwing = (ball: BallState, swing: Swing, maxSeconds = 6): ShotOutcome => {
  const probe = _probeBall;
  copy(probe.pos, ball.pos);
  copy(probe.vel, ball.vel);
  copy(probe.spin, ball.spin);
  probe.resting = ball.resting;
  strike(probe, swing);

  if (!_probeWorld) _probeWorld = createWorld();
  const world = _probeWorld;
  launch(world, probe.pos, probe.vel, probe.spin);

  let apex = probe.pos.y;
  let clearance = -Infinity;
  let landing: Vec3 | null = null;
  let netted = false;
  let ticks = 0;

  for (let i = 0; i < maxSeconds * C.SIM_HZ; i++) {
    const prevZ = world.ball.pos.z;
    const events = step(world);
    ticks = i + 1;
    if (world.ball.pos.y > apex) apex = world.ball.pos.y;

    // Record net clearance on the tick the ball crosses the net plane.
    if (Math.sign(prevZ) !== Math.sign(world.ball.pos.z) && prevZ !== world.ball.pos.z) {
      const t = prevZ / (prevZ - world.ball.pos.z);
      const cy = world.prev.pos.y + (world.ball.pos.y - world.prev.pos.y) * t;
      const cx = world.prev.pos.x + (world.ball.pos.x - world.prev.pos.x) * t;
      clearance = cy - C.BALL_RADIUS - netHeightAt(cx);
    }
    for (const e of events) {
      if (e.type === 'net') netted = true;
      if (e.type === 'bounce' && !landing) landing = e.at;
    }
    if (netted || landing || world.ball.resting) break;
  }

  return { landing, netted, apex, clearance, flightSeconds: ticks * C.SIM_DT };
};

/**
 * How much the swing path is tilted relative to the face, in degrees, for
 * each shape. This is the only place shot identity is encoded: brush hard up
 * across the face for a drive's topspin, barely at all for a drop, and cut
 * under the ball for a lob so it floats and sits up on the bounce.
 */
const BRUSH: Record<ShotShape, number> = { drive: 16, drop: 4, lob: -14 };

/** Search bounds per shape, so a lob solver never returns a flat drive. */
const BOUNDS: Record<ShotShape, { speed: [number, number]; pitch: [number, number] }> = {
  drive: { speed: [8, 24], pitch: [-2, 22] },
  drop: { speed: [3, 14], pitch: [4, 40] },
  lob: { speed: [5, 18], pitch: [20, 55] },
};

/**
 * How high a drop may arc before it stops being a drop.
 *
 * Derived from the published launch window rather than chosen: a third shot drop
 * leaves at 10.9 to 16 m/s and 12.5 to 22.5 degrees (arXiv 2501.00163, six
 * filmed trajectories), which puts the apex at roughly 1.5 m above the court for
 * a contact near waist height. 1.7 m allows the top of that range and still
 * refuses a loop.
 */
const DROP_APEX = 1.7;

/** Net clearance a shot aims for when it is played from right at the net. */
const BASE_CLEARANCE: Record<ShotShape, number> = { drive: 0.08, drop: 0.06, lob: 0.5 };

/**
 * How much extra clearance each metre back from the net buys, in metres.
 *
 * Derived rather than tuned. A pitch error of d radians at horizontal distance
 * x from the net arrives at the net roughly x*d metres off. The execution model
 * perturbs pitch by up to PITCH_ERROR = 6 degrees = 0.105 rad, so a shot struck
 * from the baseline at 6.2 m is 65 cm out of line at the net on a bad one, and a
 * dink struck from the kitchen line at 1.3 m is 14 cm out.
 *
 * The right coefficient is the TYPICAL error, not the worst one. A `steady`
 * player under moderate pressure is perturbed by about level x (0.28 + 0.72p) x
 * 6 degrees, which is near 2.2 degrees, or 0.038 rad. A sweep of this constant
 * against the charted rally profile put the knee of the curve at 0.035. Physics
 * and measurement agreeing to within ten per cent is the only reason to trust
 * either of them.
 *
 * The sweep also produced a negative result worth keeping: NO value of this
 * constant reproduces the real rally-length distribution. From 0.00 to 0.06 the
 * share of rallies lasting 1-4 shots stays between 81 and 94 per cent against a
 * real 43, and the 5-8 band never rises above 8 per cent against a real 44. The
 * knob changes WHICH failure happens, not how often a rally survives the
 * transition. That is Day 18's problem and it is not this constant's fault.
 *
 * This was Day 17's whole finding. A flat 6 cm was right for a dink and suicidal
 * for a third shot drop, and the measurement was stark: 47 per cent of all
 * rallies ended on shot three, 80 per cent of net errors were on shot three, and
 * 99 per cent of net errors were drops. A shot played from the baseline and a
 * shot played from the kitchen line have the same name and are not the same
 * shot.
 */
export const DOUBLES_CLEARANCE = 0.035;

/**
 * How close to the aim point counts as having found the shot.
 *
 * Distance-scaled for the same reason the clearance is: every error source —
 * pitch, yaw, speed — arrives at the target multiplied by how far the ball
 * travelled to get there. A fixed 0.35 m was calibrated on short shots and
 * called a 6.2 m drop landing 0.6 m long a failure, when 0.6 m long inside a
 * 2.13 m kitchen is a better third shot than most people ever hit.
 *
 * `found` is read by tests and by nothing in the game. That is worth saying out
 * loud rather than leaving to be discovered: it is an assertion about solver
 * quality, not a control signal, and the simulation plays whatever the solver
 * returns regardless.
 */
export const aimTolerance = (distanceToNet: number): number =>
  0.35 + Math.max(0, distanceToNet) * 0.06;

/** Net clearance the solver will accept, given where the ball is being struck. */
export const clearanceFor = (
  shape: ShotShape,
  distanceToNet: number,
  perMetre = 0,
): number => BASE_CLEARANCE[shape] + Math.max(0, distanceToNet) * perMetre;

const cost = (
  intent: ShotIntent,
  o: ShotOutcome,
  distanceToNet: number,
  perMetre: number,
): number => {
  if (o.netted || !o.landing) return Infinity;
  const miss = Math.hypot(o.landing.x - intent.targetX, o.landing.z - intent.targetZ);
  const tooLow =
    Math.max(0, clearanceFor(intent.shape, distanceToNet, perMetre) - o.clearance) * 8;
  // Shape preferences: a drive stays flat, a lob has to actually go up, and a
  // drop arcs but does not loop.
  //
  // The drop's ceiling was 2.2 m until Day 20, chosen by eye, and it was letting
  // the solver play the wrong shot. Compared against six filmed third-shot drops
  // (arXiv 2501.00163), this game was launching them at 36.5 degrees where the
  // real ones leave at 15.5 to 22.5 — a lofted, slow, looping ball instead of the
  // flattish arc the sport actually plays. A 13 m/s launch at 18 degrees rises
  // v_y^2 / 2g = 0.82 m above a contact at 0.7 m, so a real third shot drop
  // apexes near 1.5 m. DROP_APEX is that number, not a preference.
  const shapeCost =
    intent.shape === 'drive'
      ? Math.max(0, o.apex - 1.6) * 3
      : intent.shape === 'lob'
        ? Math.max(0, 3.0 - o.apex) * 3
        : Math.max(0, o.apex - DROP_APEX) * 2;
  return miss + tooLow + shapeCost;
};

export interface SolvedShot {
  swing: Swing;
  outcome: ShotOutcome;
  /** Residual cost. Above about 0.5 m the solver did not really find the shot. */
  cost: number;
  found: boolean;
}

/**
 * Find a swing that sends the ball to `intent`.
 *
 * Coarse grid over swing speed and face pitch, then a shrinking local refine.
 * A closed-form inverse does not exist here: drag, Magnus and the contact
 * impulse are all coupled, and the aim is a swing a player could plausibly
 * make rather than the mathematically exact one. Roughly a thousand simulated
 * shots, a few milliseconds.
 */
export interface SolveOptions {
  /**
   * Grid resolution. The default is generous because the sandbox and the
   * tests can afford it. In a live rally the solver runs inside a tick, so
   * callers there pass something coarser: the shot is a player's intention,
   * not a proof, and 10 steps lands within a few centimetres for a fifth of
   * the cost.
   */
  steps?: number;
  refines?: number;
  /**
   * Extra net clearance demanded per metre back from the net, in metres.
   *
   * Zero by default, which is the behaviour every day up to Day 17 and which
   * the singles difficulty ladder is calibrated on. Doubles passes
   * DOUBLES_CLEARANCE.
   *
   * The scoping is a trade, not a discovery, and it is worth naming as one. The
   * rule is physically right for both codes: a pitch error arrives at the net
   * multiplied by the distance it travelled. Turning it on in singles is also
   * correct and it moved the ladder from 6/6, 2/6, 0/6 to 6/6, 0/6, 0/6 — two
   * of the three levels became indistinguishable and unbeatable, because the
   * side that plays drops gains from safer drops and the fixed stand-in does
   * not. Rebalancing three difficulty levels is a day's work with a playtest
   * attached, and doing it as the last change of an evening is how a calibrated
   * game stops being calibrated. DINK-93.
   */
  clearancePerMetre?: number;
}

export const solveSwing = (
  ball: BallState,
  intent: ShotIntent,
  base: Partial<Swing> = {},
  options: SolveOptions = {},
): SolvedShot => {
  const bounds = BOUNDS[intent.shape];
  const aimYaw =
    (Math.atan2(intent.targetX - ball.pos.x, Math.abs(intent.targetZ - ball.pos.z)) * 180) /
    Math.PI;

  // How far back from the net this ball is being struck. The clearance the
  // solver insists on scales with it, because a pitch error arrives at the net
  // multiplied by the distance it travelled to get there.
  const fromNet = Math.abs(ball.pos.z);
  const perMetre = options.clearancePerMetre ?? 0;

  const build = (speed: number, pitch: number, yaw: number): Swing =>
    withSwing(defaultSwing(), {
      facing: intent.facing,
      yaw,
      pathYaw: yaw,
      ...base,
      speed,
      pitch,
      pathAngle: pitch + BRUSH[intent.shape],
    });

  // Geometric aim is only a starting guess. Sidespin and the Magnus force
  // bend the ball, so the lateral error is closed by feedback below rather
  // than by trusting the geometry.
  //
  // No `facing` here, and that was worth an afternoon. Yaw turns the face in
  // the world's x–z plane, and `faceNormal` applies `facing` to the z
  // component alone — so multiplying the guess by `facing` pointed the far
  // player's face the wrong way across the court on every single shot. The
  // refinement loop below closed the lateral error anyway, which is exactly
  // why nothing looked broken: shots landed near their targets, but the far
  // player reached them from a worse starting point and with the sidespin
  // backwards. It showed up only as one end of the court quietly winning 11
  // games out of 12 against an identical opponent.
  let yaw = aimYaw;

  let best = build(
    (bounds.speed[0] + bounds.speed[1]) / 2,
    (bounds.pitch[0] + bounds.pitch[1]) / 2,
    yaw,
  );
  let bestOutcome = simulateSwing(ball, best);
  let bestCost = cost(intent, bestOutcome, fromNet, perMetre);

  const steps = options.steps ?? 22;
  for (let i = 0; i <= steps; i++) {
    const speed = bounds.speed[0] + ((bounds.speed[1] - bounds.speed[0]) * i) / steps;
    for (let j = 0; j <= steps; j++) {
      const pitch = bounds.pitch[0] + ((bounds.pitch[1] - bounds.pitch[0]) * j) / steps;
      const swing = build(speed, pitch, yaw);
      const outcome = simulateSwing(ball, swing);
      const c = cost(intent, outcome, fromNet, perMetre);
      if (c < bestCost) {
        bestCost = c;
        best = swing;
        bestOutcome = outcome;
      }
    }
  }

  let dSpeed = (bounds.speed[1] - bounds.speed[0]) / steps;
  let dPitch = (bounds.pitch[1] - bounds.pitch[0]) / steps;
  let dYaw = 3;

  const consider = (speed: number, pitch: number, y: number): void => {
    const swing = build(
      Math.min(bounds.speed[1], Math.max(bounds.speed[0], speed)),
      Math.min(bounds.pitch[1], Math.max(bounds.pitch[0], pitch)),
      Math.min(45, Math.max(-45, y)),
    );
    const outcome = simulateSwing(ball, swing);
    const c = cost(intent, outcome, fromNet, perMetre);
    if (c < bestCost) {
      bestCost = c;
      best = swing;
      bestOutcome = outcome;
      yaw = swing.yaw;
    }
  };

  const refines = options.refines ?? 8;
  for (let pass = 0; pass < refines; pass++) {
    // Close the lateral error directly: aim off by however far the last shot
    // missed sideways, scaled by how far the ball still has to travel.
    if (bestOutcome.landing) {
      const err = bestOutcome.landing.x - intent.targetX;
      const reach = Math.max(1, Math.abs(bestOutcome.landing.z - ball.pos.z));
      consider(best.speed, best.pitch, yaw - (Math.atan2(err, reach) * 180) / Math.PI);
    }
    consider(best.speed + dSpeed, best.pitch, yaw);
    consider(best.speed - dSpeed, best.pitch, yaw);
    consider(best.speed, best.pitch + dPitch, yaw);
    consider(best.speed, best.pitch - dPitch, yaw);
    consider(best.speed, best.pitch, yaw + dYaw);
    consider(best.speed, best.pitch, yaw - dYaw);
    dSpeed *= 0.6;
    dPitch *= 0.6;
    dYaw *= 0.6;
  }

  // `found` asks "did it land where I aimed", and nothing else.
  //
  // It used to read `bestCost < 0.35`, which was fine while cost was almost all
  // landing error. Day 17 added a net-clearance term to the cost so the solver
  // would stop threading drops over the tape from the baseline — and that
  // quietly changed what `found` meant, because a shot that landed perfectly
  // while clearing by less than it wanted now reported itself as not found. The
  // ranking should weigh clearance; the verdict should not.
  const landed = bestOutcome.landing
    ? Math.hypot(bestOutcome.landing.x - intent.targetX, bestOutcome.landing.z - intent.targetZ)
    : Infinity;
  return { swing: best, outcome: bestOutcome, cost: bestCost, found: landed < aimTolerance(fromNet) };
};

/**
 * Preset for solving inside a live tick rather than in a tool or a test.
 *
 * `{ steps: 10, refines: 5 }` until Day 10, when it was measured rather than
 * guessed. This is 15 per cent cheaper — 2.4 ms against 2.9 — and clears the
 * net by a mean 98 cm rather than 78, with half as many solutions cutting it
 * fine. It matters because this is the most expensive operation in the
 * simulation and it runs inside the tick that resolves a contact, which is
 * what DINK-38 had been open about since Day 2.
 *
 * The two knobs are not the same knob. The grid is `(steps + 1)²` full
 * trajectory simulations; the refinement is seven per pass. So the grid is the
 * expensive one and the refinement is the accurate one, and the old pairing was
 * spending on the wrong side of that.
 *
 * The wrong turn is worth keeping, because the reasoning was plausible and the
 * measurement was misdirected. `{ steps: 6, refines: 6 }` is cheaper still, and
 * the argument for it was that its 11 cm mean miss sits under the noise the
 * execution model already adds — the best player in the game misses by a median
 * 18 cm. Two things were wrong with that. The 18 cm was measured on a shot
 * under pressure, and a `tough` player hitting in balance has almost no
 * execution error, so the solver's own error is most of what remains. And mean
 * miss was the wrong statistic entirely: what decides whether a shot survives
 * being perturbed is not where it was aimed but how much margin it left over
 * the net, and the cheap preset was picking tighter solutions. `tools/tally.mjs`
 * caught it in one run — tough's mis-hit rate went from 3 per cent to 7 and its
 * hold rate collapsed from 60 to 33 — which is the whole reason that tool
 * exists. Measure the thing you changed, against the statistic that actually
 * moves.
 */
export const LIVE_SOLVE: SolveOptions = { steps: 8, refines: 6 };

/**
 * Run one throwaway solve, to be called during loading.
 *
 * The first contact of a session cost 30 ms against a 3.6 ms steady-state
 * median — entirely JIT compilation of the solver and the integrator, paid for
 * by the player as a visible hitch on their first shot. Paying it while the
 * page is still loading costs nobody anything.
 */
export const warmUp = (): void => {
  solveSwing(
    ballAt(v3(0, 0.9, 5)),
    { targetX: 0.5, targetZ: -5, shape: 'drive', facing: -1 },
    {},
    LIVE_SOLVE,
  );
  solveSwing(
    ballAt(v3(0, 0.9, 3.4)),
    { targetX: 0, targetZ: -1.3, shape: 'drop', facing: -1 },
    {},
    LIVE_SOLVE,
  );
};

/**
 * The depth each shape lands at when the player asks for nothing in particular.
 *
 * These three numbers are not new. They are exactly the expressions `targetFor`
 * computed before depth was steerable, lifted out unchanged so that `aimZ === 0`
 * is provably the old behaviour rather than approximately it. Every calibration
 * in this project — the difficulty ladder, the rally profile, the serve hold
 * rate — was measured against these, and a depth control that quietly moved them
 * would invalidate all of it while looking like a UI change.
 */
const DEPTH_HOME: Record<ShotShape, number> = {
  drive: C.KITCHEN_DEPTH + (C.COURT_HALF_LENGTH - C.KITCHEN_DEPTH) * 0.72,
  drop: C.KITCHEN_DEPTH * 0.6,
  lob: C.COURT_HALF_LENGTH - 0.8,
};

/**
 * How far, in metres, a full push on the depth axis moves the target.
 *
 * Per shape, because the useful range of a shot's depth is a property of the
 * shot and not of the court. A drop's whole identity is that it lands in the
 * kitchen, so its range is the kitchen: 0.43 m — barely over the tape — out to
 * 2.13 m, the non-volley line itself, and no further. A drive ranges from 4.43 m
 * to 6.43 m, which is past the kitchen at the short end (a drive that lands
 * short is a drop, and the player has a key for that) and a quarter-metre inside
 * the baseline at the long end. A lob barely moves: it is a deep ball or it is a
 * gift, so it gets half a metre either way.
 *
 * The deep end of the drive is deliberately close enough to the baseline to be
 * punished. `PITCH_ERROR` puts a pressured shot metres long, so asking for the
 * baseline is asking to go out, which is the trade a real player makes.
 */
const DEPTH_SPREAD: Record<ShotShape, number> = { drive: 1.0, drop: 0.85, lob: 0.5 };

/** No target may sit on the tape or on the baseline, whatever is asked for. */
const DEPTH_MIN = 0.35;
const DEPTH_MAX = C.COURT_HALF_LENGTH - 0.25;

/**
 * Where a shot asked for by `shape` and an aim in -1..1 on each axis should land.
 *
 * Aim is deliberately not a raw coordinate. A player pushes a stick or holds a
 * direction; turning that into a point on the far court is a gameplay decision,
 * and keeping it in one function means the opponent AI and the human player
 * will be aiming at the same places.
 *
 * `aimZ` steers depth: -1 is as short as the shape allows, +1 as deep, 0 the
 * depth the shape has always had. It is a second axis rather than a wider set of
 * shapes because depth and shape are genuinely independent — a drive at the feet
 * and a drive at the baseline are the same stroke aimed at two places, whereas a
 * drive and a drop are two strokes — and collapsing them into one control is
 * what left the game with three shots where the sport has a plane of them.
 */
export const targetFor = (
  shape: ShotShape,
  aimX: number,
  aimZ: number,
  facing: -1 | 1,
): { targetX: number; targetZ: number } => {
  // `facing` already points down-court, so the target sits on the far side at
  // the same sign. Getting this backwards aims every shot at the player's own
  // half, which the solver then cannot reach, and it comes out as balls
  // squirting sideways rather than as an obvious error.
  const side = facing;
  const z = DEPTH_HOME[shape] + aimZ * DEPTH_SPREAD[shape];
  return {
    targetX: aimX * (C.COURT_HALF_WIDTH - 0.5),
    targetZ: side * Math.min(DEPTH_MAX, Math.max(DEPTH_MIN, z)),
  };
};

/** Ball sitting still at a contact point, for solving a shot from scratch. */
export const ballAt = (pos: Vec3, vel: Vec3 = v3(), spin: Vec3 = v3()): BallState => ({
  pos: copy(v3(), pos),
  vel: copy(v3(), vel),
  spin: copy(v3(), spin),
  resting: false,
});
