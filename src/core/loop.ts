import { SIM_DT } from '../sim/constants';

export interface LoopHandlers {
  /** Called a whole number of times per frame, always with the same dt. */
  fixedUpdate: () => void;
  /** Called once per frame. `alpha` is the blend into the pending sim step. */
  /**
   * `alpha` interpolates between the last two simulation states. `frameSeconds`
   * is REAL time since the previous frame, unscaled by game speed, and it is
   * what anything cosmetic must be advanced with: a camera shake driven by
   * simulated time would last twice as long at half game speed, so the slow
   * motion setting would quietly become a different game to look at. It is also
   * clamped, so a tab returning from the background does not fast-forward every
   * effect at once. See ADR-0004.
   */
  render: (alpha: number, frameSeconds: number) => void;
}

/** At most 0.25 s of simulation is replayed after a stall. */
const MAX_FRAME_TIME = 0.25;

/**
 * The accumulator, as a pure function, so it can be tested without a browser.
 *
 * Returns how many fixed steps to run and what is left over. `scale` is game
 * speed: the simulation still advances in exact SIM_DT ticks, it is just fed
 * less real time per second, so the physics is untouched and only the film
 * runs slower.
 */
export const advance = (
  accumulator: number,
  frameSeconds: number,
  scale = 1,
): { steps: number; remainder: number } => {
  const clamped = Math.min(frameSeconds, MAX_FRAME_TIME) * scale;
  let acc = accumulator + clamped;
  let steps = 0;
  while (acc >= SIM_DT) {
    acc -= SIM_DT;
    steps += 1;
  }
  return { steps, remainder: acc };
};

/**
 * Fixed-timestep loop with an accumulator, after Gaffer's "Fix Your Timestep".
 * Physics must not depend on the display refresh rate: a player on a 144 Hz
 * monitor has to get exactly the same ball flight as one on 60 Hz, or the game
 * is not fair and replays do not reproduce.
 *
 * The accumulator is clamped so that a long stall (alt-tab, a GC pause) cannot
 * trigger a death spiral of catch-up steps.
 */
export class GameLoop {
  private accumulator = 0;
  private last = 0;
  private running = false;
  private frameId = 0;
  private scale = 1;

  constructor(private readonly handlers: LoopHandlers) {}

  /**
   * Game speed, as a fraction of real time. Below 1 the whole game — ball,
   * player and swing together — plays slower, which is the only honest way to
   * give a person more time: slowing the ball alone would leave the physics
   * disagreeing with itself, and slowing the ball but not the player would
   * change what shots are reachable.
   */
  setSpeed(scale: number): void {
    this.scale = Math.max(0.1, Math.min(2, scale));
  }

  speed(): number {
    return this.scale;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.frameId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.frameId);
  }

  /**
   * Forget the time spent in a long synchronous call.
   *
   * Running the shot solver takes tens of milliseconds, and in a slow browser
   * a good deal more. Without this the loop charges that stall to the
   * simulation and replays it as catch-up steps, so a shot is already part way
   * through its flight by the first frame the player sees. Call this straight
   * after any blocking work that is not part of the simulation.
   */
  resync(): void {
    this.last = performance.now();
    this.accumulator = 0;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.frameId = requestAnimationFrame(this.frame);

    const frameSeconds = (now - this.last) / 1000;
    this.last = now;

    const { steps, remainder } = advance(this.accumulator, frameSeconds, this.scale);
    for (let i = 0; i < steps; i++) this.handlers.fixedUpdate();
    this.accumulator = remainder;

    this.handlers.render(this.accumulator / SIM_DT, Math.min(frameSeconds, 0.1));
  };
}
