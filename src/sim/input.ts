import { ShotShape } from './solver';

/**
 * Everything the simulation is allowed to know about what a player wants in
 * one tick.
 *
 * The simulation consumes only these. It never reads a keyboard, a gamepad or
 * a clock. That is what makes the promise in ADR-0001 real: a rally is a seed
 * plus a list of InputFrames, so a replay is a re-simulation rather than a
 * recording, and the same list is what a network peer would send.
 */
export interface InputFrame {
  /** Movement request, each in -1..1. Not a velocity: an intention. */
  moveX: number;
  moveZ: number;
  /** True on the tick the swing is committed to, not while held. */
  swing: boolean;
  /** What kind of shot the swing is asking for. */
  shape: ShotShape;
  /** Aim bias in -1..1: -1 is hard to the left of the far court, +1 right. */
  aimX: number;
  /**
   * Depth bias in -1..1: -1 is as short as the shape allows, +1 as deep, 0 the
   * depth that shape has always been played at.
   *
   * Named to match `moveX`/`moveZ` rather than bundled into an object, because
   * everything that carries an InputFrame — the replay's run-length encoding
   * most of all — wants flat numbers, and the axis pair is the same pair the
   * movement already uses.
   */
  aimZ: number;
}

export const emptyInput = (): InputFrame => ({
  moveX: 0,
  moveZ: 0,
  swing: false,
  shape: 'drive',
  aimX: 0,
  aimZ: 0,
});

/**
 * Collects live device state and hands the simulation one frame per tick.
 *
 * This buffer exists for one reason only: a key pressed and released between
 * two ticks would otherwise vanish, and at 120 Hz that is a real 8 ms window a
 * player can fall into. A press latches until the next tick reads it, and no
 * longer.
 *
 * It deliberately does NOT hold a press while the player is mid-swing. That is
 * a rule about when a shot is allowed, not about sampling a device, and it
 * lives with the player where it can see whether the swing is available.
 */
export class InputBuffer {
  private pendingSwing = false;
  private readonly state: InputFrame = emptyInput();

  /** Continuous state: called whenever the device state changes. */
  setMove(x: number, z: number): void {
    this.state.moveX = clamp(x);
    this.state.moveZ = clamp(z);
  }

  setShape(shape: ShotShape): void {
    this.state.shape = shape;
  }

  setAim(x: number, z: number): void {
    this.state.aimX = clamp(x);
    this.state.aimZ = clamp(z);
  }

  /** Edge event: called once when the swing button goes down. */
  pressSwing(): void {
    this.pendingSwing = true;
  }

  /** Produce the frame for one simulation tick, consuming any latched press. */
  consume(): InputFrame {
    const frame: InputFrame = { ...this.state, swing: this.pendingSwing };
    this.pendingSwing = false;
    return frame;
  }
}

const clamp = (v: number): number => (v < -1 ? -1 : v > 1 ? 1 : v);
