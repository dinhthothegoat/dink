import { InputBuffer, InputFrame } from '../sim/input';
import { ShotShape } from '../sim/solver';

/**
 * Turns a keyboard and a gamepad into InputFrames.
 *
 * This is the only file in the project allowed to know that a keyboard exists.
 * Everything downstream sees InputFrames, which is what keeps a rally
 * reproducible from a seed and a list of frames rather than from a recording
 * of what the browser happened to report.
 */
export interface Controls {
  frame: (dt: number) => InputFrame;
  detach: () => void;
  /** Current shot shape, for the HUD. */
  shape: () => ShotShape;
  /**
   * Current aim on both axes, for the marker that draws where a shot would go.
   *
   * Read by the renderer only. The simulation gets this through the InputFrame
   * like everything else — a second path into the sim would be exactly the leak
   * ADR-0001 exists to prevent.
   */
  aim: () => { x: number; z: number };
}

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0],
};

const SHAPE_KEYS: Record<string, ShotShape> = {
  Space: 'drive',
  KeyJ: 'drop',
  KeyK: 'lob',
};

/**
 * Aim is the direction you are already holding. There are no aim keys.
 *
 * The arrows used to be a second direction control, on the other hand, read
 * independently of the movement. Two direction controls is one more than a
 * racket sport needs: where you are going and where you are hitting are the same
 * decision in the sport itself, and splitting them across two hands made the
 * game ask for a kind of coordination it is not about. WASD now steers the
 * player and points the shot, and the swing keys commit whatever is held.
 *
 * The cost is real and it is the mechanic: chasing a ball wide to your right
 * means holding KeyD, so a shot played on the run goes the way you ran. Hitting
 * behind somebody means planting first — letting the key go, or pressing back
 * against your own momentum — which is what a player on a real court is doing
 * when they set their feet. It is a skill rather than a tax, but it IS the
 * thing to watch for in the Day 23 notes: see DINK-145.
 */

/**
 * Arrows no longer aim, and are still swallowed.
 *
 * Not a leftover. They scroll the page in a browser, and a player who reaches
 * for the old control during a rally should get nothing rather than get the
 * court scrolled out from under them.
 */
const SWALLOW = new Set([
  'Space',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  ...Object.keys(MOVE_KEYS),
]);

export const attachControls = (target: Window = window): Controls => {
  const buffer = new InputBuffer();
  const held = new Set<string>();
  let shape: ShotShape = 'drive';
  let aimX = 0;
  let aimZ = 0;

  /**
   * One direction, sent to both the feet and the aim.
   *
   * Deliberately the same numbers rather than two derived from one source: if
   * the aim were ever computed differently from the movement, the marker on the
   * court and the player's own legs would disagree about which way "right" is,
   * and that is the kind of inconsistency nobody reports and everybody feels.
   *
   * The values are the raw held direction, not a ramp. The arrows used to ramp
   * over 0.28 s so a tap was a slight angle and a hold was the sideline, and
   * that cannot survive the merge: KeyW is how you run, so ramping would mean
   * running forward slowly aimed you further and further short. Aim is
   * three-valued per axis again — but on two axes rather than one, so nine
   * targets where the arrows originally gave three. A gamepad stick stays fully
   * analog, which is where the fine aim now lives. DINK-146.
   */
  const refreshMove = (): void => {
    let x = 0;
    let z = 0;
    for (const code of held) {
      const dir = MOVE_KEYS[code];
      if (dir) {
        x += dir[0];
        z += dir[1];
      }
    }
    buffer.setMove(x, z);
    aimX = Math.max(-1, Math.min(1, x));
    aimZ = Math.max(-1, Math.min(1, z));
    buffer.setAim(aimX, aimZ);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (SWALLOW.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    held.add(e.code);

    const asShape = SHAPE_KEYS[e.code];
    if (asShape) {
      shape = asShape;
      buffer.setShape(asShape);
      buffer.pressSwing();
    }
    refreshMove();
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    held.delete(e.code);
    refreshMove();
  };

  // Releasing focus with keys down would otherwise leave a player sprinting
  // into the fence for ever — and, now, aimed at the fence too. `refreshMove`
  // recentres both, which is the point of them sharing one path.
  const onBlur = (): void => {
    held.clear();
    refreshMove();
  };

  target.addEventListener('keydown', onKeyDown as EventListener);
  target.addEventListener('keyup', onKeyUp as EventListener);
  target.addEventListener('blur', onBlur);

  let padSwingWasDown = false;

  const pollGamepad = (): void => {
    const pads = target.navigator.getGamepads?.() ?? [];
    const pad = pads.find((p) => p && p.connected);
    if (!pad) return;
    const dead = (v: number): number => (Math.abs(v) < 0.18 ? 0 : v);
    // The left stick does both, exactly as WASD does. The right stick was the
    // aim until the two controls were merged, and giving it back as a second,
    // independent aim would hand pad players a game keyboard players cannot
    // play — the same split this change exists to remove, just moved onto one
    // device. Stick up is negative y, which is toward the net, which is shorter:
    // the same sign the movement axis already uses.
    const x = dead(pad.axes[0] ?? 0);
    const z = dead(pad.axes[1] ?? 0);
    buffer.setMove(x, z);
    buffer.setAim(x, z);
    aimX = x;
    aimZ = z;

    const drive = pad.buttons[0]?.pressed ?? false;
    const drop = pad.buttons[1]?.pressed ?? false;
    const lob = pad.buttons[3]?.pressed ?? false;
    const down = drive || drop || lob;
    if (down && !padSwingWasDown) {
      shape = lob ? 'lob' : drop ? 'drop' : 'drive';
      buffer.setShape(shape);
      buffer.pressSwing();
    }
    padSwingWasDown = down;
  };

  return {
    frame: () => {
      // A connected pad wins, by overwriting what the keys last wrote. Not new:
      // `pollGamepad` has always done this to the move axes, and the aim is now
      // one of them.
      pollGamepad();
      return buffer.consume();
    },
    detach: () => {
      target.removeEventListener('keydown', onKeyDown as EventListener);
      target.removeEventListener('keyup', onKeyUp as EventListener);
      target.removeEventListener('blur', onBlur);
    },
    shape: () => shape,
    aim: () => ({ x: aimX, z: aimZ }),
  };
};
