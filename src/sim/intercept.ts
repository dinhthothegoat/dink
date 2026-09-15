import { BallState, snapshot } from './ball';
import * as C from './constants';
import { Side, sideOf } from './court';
import { Vec3, v3, copy } from './vec3';
import { World, createWorld, launch, step } from './world';

export interface Intercept {
  /** Where the ball can be met. */
  pos: Vec3;
  /** How long until then, in seconds. */
  seconds: number;
  /** Whether it has bounced on this side by then. */
  bounced: boolean;
}

/**
 * The first point at which `side` could actually hit the ball.
 *
 * Not where the ball will be in half a second, which is what the stand-in
 * asked for first and why it walked in front of every serve and watched it
 * skid past. A player does not move toward the ball; they move toward the
 * place they will be able to strike it, which is a different point entirely
 * and often on the other side of them.
 *
 * It answers by re-simulating rather than solving, for the same reason
 * predictBall does: a closed-form guess and the real trajectory drift apart,
 * and here the answer depends on a bounce, which is not a closed form at all.
 *
 * This is the function the opponent AI on Day 6 is built on. It exists today
 * because the stand-in needed it, which is the usual way these things arrive.
 */
/**
 * One-tick memo.
 *
 * The stand-in, the human's aiming aid and the tests all ask the same question
 * on the same tick, and each answer costs a few hundred simulated steps. Three
 * identical probes per tick made a scripted game take twelve seconds to run,
 * so the answer is computed once per (tick, side, requirement) and handed out.
 * Keyed on the world's tick, so it cannot go stale.
 */
interface Memo {
  tick: number;
  requireBounce: boolean;
  result: Intercept | null;
}

interface WorldMemo {
  near: Memo | null;
  far: Memo | null;
}

/**
 * How many ticks an answer may be reused for.
 *
 * The intercept moves very little between ticks of free flight, and both
 * players ask every tick at 120 Hz. Recomputing at 20 Hz instead is six times
 * cheaper and looks identical, because the number is used to decide where to
 * run, not to place the paddle. It stays deterministic: the reuse window is
 * measured in simulation ticks, not wall time.
 */
const RECOMPUTE_TICKS = 6;

/**
 * Keyed by world, not just by tick. A module-level memo keyed on the tick
 * alone looks fine until two matches exist in one process: both start at tick
 * zero, and each starts answering the other's questions. It showed up as a
 * determinism test failing between two identical games.
 */
const memos = new WeakMap<World, WorldMemo>();

export const interceptPoint = (
  world: World,
  side: Side,
  options: { requireBounce?: boolean; horizon?: number } = {},
): Intercept | null => {
  // `requireBounce` means a bounce is still OUTSTANDING, not that the two-bounce
  // rule applies. The difference cost an afternoon: passing the rule straight
  // in made the intercept disappear the instant the serve landed, because the
  // probe starts from now and never sees a bounce that already happened. The
  // caller knows whether the ball has bounced; it has to subtract that itself.
  const requireBounce = options.requireBounce ?? false;
  const horizon = options.horizon ?? 2.5;

  if (world.ball.resting) return null;

  let slots = memos.get(world);
  if (!slots) {
    slots = { near: null, far: null };
    memos.set(world, slots);
  }
  const memo = slots[side];
  if (
    memo &&
    memo.requireBounce === requireBounce &&
    world.tick - memo.tick < RECOMPUTE_TICKS &&
    world.tick >= memo.tick
  ) {
    return memo.result;
  }

  const remember = (result: Intercept | null): Intercept | null => {
    slots[side] = { tick: world.tick, requireBounce, result };
    return result;
  };

  // A ball already past you and still travelling away is never coming back
  // without someone hitting it, so there is nothing to simulate. Skipping that
  // case is most of the cost: it is exactly when the probe would run its full
  // horizon and return nothing.
  const own = side === 'near' ? 1 : -1;
  if (own * world.ball.pos.z < 0 && own * world.ball.vel.z <= 0) return remember(null);

  const probe = probeWorld(world);
  let bounced = false;

  const ticks = Math.round(horizon * C.SIM_HZ);
  for (let i = 1; i <= ticks; i++) {
    for (const e of step(probe)) {
      if (e.type === 'bounce' && sideOf(e.at.z) === side) bounced = true;
      if (e.type === 'outOfPlay' || e.type === 'rest') return remember(null);
    }
    const p = probe.ball.pos;
    if (sideOf(p.z) !== side) continue;
    if (requireBounce && !bounced) continue;
    if (p.y < C.PLAYER_STRIKE_LOW || p.y > C.PLAYER_STRIKE_HIGH) continue;
    return remember({ pos: copy(v3(), p), seconds: i * C.SIM_DT, bounced });
  }
  return remember(null);
};

const _probeBall: BallState = { pos: v3(), vel: v3(), spin: v3(), resting: false };
let _probeWorld: World | null = null;

/**
 * A throwaway world seeded from the real one. Reused between calls, because
 * the stand-in and later two opponents will ask this question every tick and
 * allocating a world at 120 Hz is not free.
 */
const probeWorld = (world: World): World => {
  if (!_probeWorld) _probeWorld = createWorld();
  const probe = _probeWorld;
  const b = snapshot(world.ball);
  copy(_probeBall.pos, b.pos);
  copy(_probeBall.vel, b.vel);
  copy(_probeBall.spin, b.spin);
  launch(probe, _probeBall.pos, _probeBall.vel, _probeBall.spin);
  probe.ball.resting = world.ball.resting;
  return probe;
};

/**
 * Where to stand to take a ball arriving at `at`: behind it relative to your
 * own end of the court, and never inside the kitchen rail.
 *
 * The standoff has to be signed by which way the player faces. Written as a
 * bare "+0.5" it is correct for the near player and backwards for the far one,
 * which is the bug that made the stand-in stand in front of every serve.
 */
export const receivePosition = (
  out: Vec3,
  facing: -1 | 1,
  at: Vec3,
  standOff = 0.45,
  /**
   * May this player stand inside their own non-volley zone to reach the ball?
   *
   * False by default, and false in singles, for a measured reason rather than a
   * cautious one. See below.
   */
  mayEnterKitchen = false,
): Vec3 => {
  const behind = at.z - facing * standOff;
  const own = -facing;
  // As close to the net as the net allows.
  //
  // This used to be KITCHEN_DEPTH + PLAYER_RADIUS — 2.41 m, the old rail. Day 12
  // deleted that rail from the physics and set KITCHEN_BARRIER to false, and
  // this line was missed, so for five days the simulation ALLOWED players into
  // the kitchen and nothing ever asked to go there. The whole point of Day 12
  // was that you step in to play a ball that has bounced.
  //
  // It cost exactly what the geometry predicted. A drop lands about 1.3 m from
  // the net, a defender pinned at 2.41 m is 1.1 m away, and reach is 1.15 m —
  // so answering a drop was a coin toss decided in the third decimal place.
  // Measured: 81 per cent of unreachable balls landed in the kitchen, and the
  // median distance from the bounce to the nearest defender was 1.12 m.
  //
  // Standing in there is legal. Volleying from in there is not, and that rule
  // has been enforced since Day 12 in `rules.ts`, with the momentum window that
  // goes with it. The gate belongs on the shot, not on where the feet may go.
  //
  // Day 17 scoped this to doubles, because letting a SINGLES player stand in the
  // kitchen produced an absorbing state: one rally of 2,569 shots, both players
  // parked inside the line, every ball an illegal volley so every ball had to
  // bounce, and a soft ball bouncing in the kitchen is always reachable by
  // somebody already standing there.
  //
  // Day 18 found the doubles version of the same defect wearing a different hat
  // — the receiving pair camping in the zone and letting third shots land behind
  // them — and with it the rule that fixes both. The caller passes whether the
  // ball being played HAS ALREADY BOUNCED. That is the sport's own rule, it is a
  // question `interceptPoint` already answers, and it makes the kitchen a place
  // you step into for one shot rather than a place you wait. The doubles-only
  // scoping is retired: one rule, both codes, no flag.
  const nearest = mayEnterKitchen ? C.PLAYER_RADIUS : C.KITCHEN_DEPTH + C.PLAYER_RADIUS;
  const deepest = C.COURT_HALF_LENGTH + 1.6;
  const clamped = Math.min(deepest, Math.max(nearest, own * behind));
  out.x = at.x;
  out.y = 0;
  out.z = own * clamped;
  return out;
};
