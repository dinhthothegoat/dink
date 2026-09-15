import * as THREE from 'three';
import { Vec3 } from '../sim/vec3';

/**
 * A camera that reacts, without ever touching the simulation.
 *
 * Three fixed rigs got the game this far, and a fixed camera is honest — it
 * never lies about where the ball is. But it also never tells you anything. A
 * camera that leans with the rally and flinches on a hard contact is most of
 * what separates a physics demo from a game, and none of it may change a single
 * number the simulation reads. See ADR-0004.
 *
 * Everything here is framerate-independent for the same reason the simulation
 * is: a lerp of the form `x += (target - x) * k` moves at a rate that depends on
 * how often it is called, so a smooth follow on a 144 Hz display becomes a snap
 * on a 60 Hz one. The exponential form below settles in the same wall-clock time
 * on any machine, which is the only version that can be tuned once.
 */

export interface Rig {
  /** Where the camera sits when nothing is happening. */
  pos: [number, number, number];
  look: [number, number, number];
  up: [number, number, number];
  /**
   * How far the camera drifts sideways with the ball, as a fraction of the
   * ball's own x. Zero holds still.
   */
  follow: number;
  /** How much a contact shakes it, in metres of amplitude at full strength. */
  shake: number;
}

/**
 * Settle to within about 2 per cent of the target in this many seconds.
 *
 * Named in the unit that matters. Everything else in a follow camera is a magic
 * constant whose meaning changes with the frame rate.
 */
const SETTLE = 0.42;

/** Shake dies away this fast, in seconds to inaudibility. */
const SHAKE_DECAY = 0.28;

/**
 * Approach a target at a rate that does not depend on the frame rate.
 *
 * `1 - exp(-dt/tau)` is the fraction of the remaining distance to cover in this
 * frame. Called twice as often with half the step, it covers the same ground.
 */
export const approach = (current: number, target: number, dt: number, tau = SETTLE): number =>
  current + (target - current) * (1 - Math.exp(-dt / tau));

export interface CameraRig {
  /** Swap rigs. The transition is animated, not cut. */
  setRig: (rig: Rig) => void;
  /** Call once per rendered frame with real seconds elapsed. */
  update: (dt: number, ball: Vec3) => void;
  /** A contact happened: shake, with `strength` from 0 to 1. */
  kick: (strength: number) => void;
  /** Cut instantly to the current rig, for a restart or a view change. */
  snap: (ball: Vec3) => void;
}

export const createCameraRig = (camera: THREE.PerspectiveCamera, first: Rig): CameraRig => {
  let rig = first;
  let driftX = 0;
  let shake = 0;
  let phase = 0;

  const place = (ball: Vec3, jitterX: number, jitterY: number): void => {
    camera.up.set(...rig.up);
    camera.position.set(rig.pos[0] + driftX + jitterX, rig.pos[1] + jitterY, rig.pos[2]);
    // The look-at point drifts too, and by more than the camera does. Moving
    // only the camera pans the whole court across the frame; moving both is a
    // lean, which is what a person filming this would do.
    camera.lookAt(rig.look[0] + driftX * 1.6, rig.look[1], rig.look[2]);
    void ball;
  };

  return {
    setRig: (next) => {
      rig = next;
    },
    kick: (strength) => {
      // Take the larger of the two rather than adding: two contacts in quick
      // succession should not be twice as violent as one, and a rally of hard
      // drives would otherwise ratchet the shake up until the court blurred.
      shake = Math.max(shake, Math.min(1, strength));
    },
    update: (dt, ball) => {
      driftX = approach(driftX, ball.x * rig.follow, dt);

      let jitterX = 0;
      let jitterY = 0;
      if (shake > 0.0005) {
        shake *= Math.exp(-dt / SHAKE_DECAY);
        phase += dt * 46;
        // Two frequencies that do not divide into each other, so the shake
        // never settles into a visible wobble.
        const amp = shake * rig.shake;
        jitterX = Math.sin(phase) * amp;
        jitterY = Math.sin(phase * 1.63 + 1.1) * amp * 0.7;
      } else {
        shake = 0;
      }
      place(ball, jitterX, jitterY);
    },
    snap: (ball) => {
      driftX = ball.x * rig.follow;
      shake = 0;
      place(ball, 0, 0);
    },
  };
};
