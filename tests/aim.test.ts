import { describe, expect, it } from 'vitest';
import * as C from '../src/sim/constants';
import { ShotShape, targetFor } from '../src/sim/solver';
import { isInBounds, isInKitchen } from '../src/sim/court';
import { v3 } from '../src/sim/vec3';
import { attachControls } from '../src/core/input';

const SHAPES: ShotShape[] = ['drive', 'drop', 'lob'];

/**
 * The depth axis, and the one claim that has to hold before any of the others
 * matter.
 *
 * Every calibrated number in this project — the difficulty ladder, the serve
 * hold rate, the rally-length profile, DOUBLES_CLEARANCE itself — was measured
 * against a game where a shape had exactly one depth. Adding a control that
 * moves that depth is safe only if the neutral position is bit-for-bit the old
 * behaviour, and "I lifted the expressions unchanged" is a claim about a diff,
 * not about the code. This file is the claim about the code.
 */
describe('a neutral aim is the game that was calibrated', () => {
  it.each(SHAPES)('puts a %s exactly where it always landed', (shape) => {
    // These three literals are the pre-change expressions, written out rather
    // than imported, so that editing DEPTH_HOME to "improve" a shot fails here
    // instead of silently re-basing the ladder. A test that recomputes the thing
    // it is testing pins nothing.
    const was =
      shape === 'drop'
        ? C.KITCHEN_DEPTH * 0.6
        : shape === 'lob'
          ? C.COURT_HALF_LENGTH - 0.8
          : C.KITCHEN_DEPTH + (C.COURT_HALF_LENGTH - C.KITCHEN_DEPTH) * 0.72;

    for (const facing of [-1, 1] as const) {
      expect(targetFor(shape, 0, 0, facing).targetZ).toBe(facing * was);
    }
  });

  it('matches the pre-change function exactly, over the whole lateral range', () => {
    // The old `targetFor`, written out in full. Both axes, every shape, both
    // ends, swept across the aim range — because the claim that the ladder and
    // the rally profile still mean something rests entirely on this function
    // being the old one when aimZ is 0, and `toBe` rather than `toBeCloseTo` is
    // the difference between "identical" and "close enough that nobody
    // noticed". The stand-in and the opponent both pass aimZ = 0, so this sweep
    // is every target the calibrated game can ask for.
    const before = (shape: ShotShape, aim: number, facing: -1 | 1) => {
      const deep = C.KITCHEN_DEPTH + (C.COURT_HALF_LENGTH - C.KITCHEN_DEPTH) * 0.72;
      const z =
        shape === 'drop'
          ? C.KITCHEN_DEPTH * 0.6
          : shape === 'lob'
            ? C.COURT_HALF_LENGTH - 0.8
            : deep;
      return { targetX: aim * (C.COURT_HALF_WIDTH - 0.5), targetZ: facing * z };
    };

    for (const shape of SHAPES) {
      for (const facing of [-1, 1] as const) {
        for (let aim = -1; aim <= 1.0001; aim += 0.05) {
          expect(targetFor(shape, aim, 0, facing)).toEqual(before(shape, aim, facing));
        }
      }
    }
  });

  it('leaves the lateral axis untouched by the new one', () => {
    // aimX meant the same thing before this change and has to still. If depth
    // ever leaks into x the opponent's whole aim policy moves, because the
    // stand-in passes aimZ = 0 and would be the last thing to show it.
    const wide = C.COURT_HALF_WIDTH - 0.5;
    for (const z of [-1, -0.4, 0, 0.4, 1]) {
      expect(targetFor('drive', 0.62, z, -1).targetX).toBeCloseTo(0.62 * wide, 12);
    }
  });
});

describe('the depth axis', () => {
  it.each(SHAPES)('aims a %s shorter at -1 than at +1, at both ends', (shape) => {
    for (const facing of [-1, 1] as const) {
      const short = Math.abs(targetFor(shape, 0, -1, facing).targetZ);
      const deep = Math.abs(targetFor(shape, 0, 1, facing).targetZ);
      expect(short).toBeLessThan(deep);
      // Sign is the court side, and it is the mistake this codebase has made on
      // five separate axes. Depth must never flip a target into the striker's
      // own half, however hard it is pushed.
      expect(Math.sign(targetFor(shape, 0, -1, facing).targetZ)).toBe(facing);
      expect(Math.sign(targetFor(shape, 0, 1, facing).targetZ)).toBe(facing);
    }
  });

  it.each(SHAPES)('keeps every reachable %s target inside the court', (shape) => {
    for (const x of [-1, 0, 1]) {
      for (let z = -1; z <= 1.0001; z += 0.1) {
        const { targetX, targetZ } = targetFor(shape, x, z, -1);
        expect(isInBounds(v3(targetX, 0, targetZ))).toBe(true);
      }
    }
  });

  it('never lets a drop out of the kitchen, however deep it is asked for', () => {
    // The drop's range IS the kitchen. A drop that can be aimed past the
    // non-volley line is a bad drive with a soft key, and the shape stops
    // meaning anything — which is the failure mode of giving depth to a shot
    // whose identity is its depth.
    for (let z = -1; z <= 1.0001; z += 0.05) {
      const { targetX, targetZ } = targetFor('drop', 0, z, -1);
      expect(isInKitchen(v3(targetX, 0, targetZ))).toBe(true);
    }
  });

  it('never lets a drive be aimed into the kitchen', () => {
    // The other half of the same rule, and the reason the two shapes stay
    // distinct: a drive pushed fully short must still land past the line, so a
    // player who wants the kitchen has to actually play the soft shot.
    for (let z = -1; z <= 1.0001; z += 0.05) {
      expect(Math.abs(targetFor('drive', 0, z, -1).targetZ)).toBeGreaterThan(C.KITCHEN_DEPTH);
    }
  });

  it('clamps off the baseline rather than aiming at it', () => {
    // Asking for maximum depth should be a risk the execution model resolves,
    // not an instruction to aim at the line itself. A target ON the baseline is
    // out on any error at all, which would make the deep end of the axis a
    // button that loses the point.
    for (const shape of SHAPES) {
      expect(Math.abs(targetFor(shape, 0, 5, -1).targetZ)).toBeLessThan(C.COURT_HALF_LENGTH);
    }
  });

  it('is symmetric about the neutral depth', () => {
    // Not required by anything downstream, but if it ever stops being true it
    // means the clamp has started biting inside the nominal range, and the
    // player's stick would be travelling further one way than the other.
    for (const shape of SHAPES) {
      const home = Math.abs(targetFor(shape, 0, 0, -1).targetZ);
      const short = Math.abs(targetFor(shape, 0, -1, -1).targetZ);
      const deep = Math.abs(targetFor(shape, 0, 1, -1).targetZ);
      expect(home - short).toBeCloseTo(deep - home, 9);
    }
  });
});

/**
 * A fake window, because `attachControls` is the one file allowed to know a
 * keyboard exists and nothing had ever tested it.
 *
 * Only the four things it touches. A jsdom environment would work and would also
 * make this file's 14 other tests pay for a DOM they never use.
 */
const fakeTarget = () => {
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  return {
    target: {
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        (listeners[type] ??= []).push(fn);
      },
      removeEventListener: () => {},
      navigator: { getGamepads: () => [] },
    } as unknown as Window,
    fire: (type: string, e: unknown) => {
      for (const fn of listeners[type] ?? []) fn(e);
    },
  };
};

const key = (code: string) => ({ code, repeat: false, preventDefault: () => {} });

describe('aiming with the movement keys', () => {
  /** Hold `codes`, then read the frame the simulation would consume. */
  const hold = (codes: string[]) => {
    const { target, fire } = fakeTarget();
    const controls = attachControls(target);
    for (const code of codes) fire('keydown', key(code));
    return { controls, frame: controls.frame(C.SIM_DT), fire };
  };

  it('aims where it walks, on both axes at once', () => {
    // The whole change in one assertion: there is no second direction control,
    // so the aim is whatever the feet are already being told.
    const frame = hold(['KeyD', 'KeyW']).frame;
    expect(frame.aimX).toBe(frame.moveX);
    expect(frame.aimZ).toBe(frame.moveZ);
    expect(frame.aimX).toBe(1);
    expect(frame.aimZ).toBe(-1);
  });

  it.each([
    ['KeyA', -1, 0],
    ['KeyD', 1, 0],
    ['KeyW', 0, -1],
    ['KeyS', 0, 1],
  ])('maps %s to aim (%i, %i)', (code, x, z) => {
    // KeyW is toward the net and toward the net is shorter, so forward aims
    // short. That the same key means both is the point, not a coincidence.
    const frame = hold([code]).frame;
    expect(frame.aimX).toBe(x);
    expect(frame.aimZ).toBe(z);
  });

  it('aims dead centre when nothing is held', () => {
    // Standing still is the neutral shot: the depth each shape has always been
    // played at, down the middle. A player who never touches a key gets exactly
    // the game that was calibrated.
    const frame = hold([]).frame;
    expect(frame.aimX).toBe(0);
    expect(frame.aimZ).toBe(0);
  });

  it('does not aim on the arrow keys any more', () => {
    for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      const frame = hold([code]).frame;
      expect(frame.aimX).toBe(0);
      expect(frame.aimZ).toBe(0);
    }
  });

  it('still swallows the arrows, so reaching for the old control cannot scroll', () => {
    const { target, fire } = fakeTarget();
    attachControls(target);
    let prevented = false;
    fire('keydown', {
      code: 'ArrowLeft',
      repeat: false,
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
  });

  it('cancels opposing keys rather than picking one', () => {
    const frame = hold(['KeyA', 'KeyD']).frame;
    expect(frame.aimX).toBe(0);
    expect(frame.moveX).toBe(0);
  });

  it('recentres the aim when the key is released, with no spring to wait out', () => {
    // Aim is the held direction and nothing else, so releasing is instant. The
    // ramped version had a 0.16 s return, which is now a frame a player would
    // have had to think about between shots.
    const { controls, fire } = hold(['KeyD']);
    fire('keyup', key('KeyD'));
    expect(controls.frame(C.SIM_DT).aimX).toBe(0);
  });

  it('recentres on blur rather than keeping an aim nobody is holding', () => {
    const { controls, fire } = hold(['KeyD']);
    fire('blur', {});
    expect(controls.frame(C.SIM_DT).aimX).toBe(0);
    expect(controls.aim().x).toBe(0);
  });

  it('reports the aim to the renderer as the frame carries it', () => {
    // The marker draws from `controls.aim()` and the simulation reads the
    // InputFrame. Two readers of one value, and they have to agree or the ring
    // shows the player a shot they are not about to hit.
    const { controls, frame } = hold(['KeyA', 'KeyS']);
    expect(controls.aim().x).toBe(frame.aimX);
    expect(controls.aim().z).toBe(frame.aimZ);
  });

  it('gives nine aim points from the four keys', () => {
    // Three per axis rather than the arrows' three in total. Worth pinning as a
    // number, because it is the answer to "did merging the controls make aiming
    // cruder" and the answer is only yes on one axis.
    const seen = new Set<string>();
    for (const codes of [
      [],
      ['KeyA'],
      ['KeyD'],
      ['KeyW'],
      ['KeyS'],
      ['KeyA', 'KeyW'],
      ['KeyA', 'KeyS'],
      ['KeyD', 'KeyW'],
      ['KeyD', 'KeyS'],
    ]) {
      const f = hold(codes).frame;
      seen.add(`${f.aimX},${f.aimZ}`);
    }
    expect(seen.size).toBe(9);
  });
});

describe('aiming with a gamepad', () => {
  /** A pad with the left stick pushed to (x, z). */
  const withStick = (x: number, z: number) => {
    const listeners: Record<string, ((e: unknown) => void)[]> = {};
    const target = {
      addEventListener: (type: string, fn: (e: unknown) => void) => {
        (listeners[type] ??= []).push(fn);
      },
      removeEventListener: () => {},
      navigator: {
        getGamepads: () => [
          { connected: true, axes: [x, z, 0, 0], buttons: [] } as unknown as Gamepad,
        ],
      },
    } as unknown as Window;
    return attachControls(target).frame(C.SIM_DT);
  };

  it('drives both the feet and the aim from the left stick', () => {
    const frame = withStick(0.62, -0.41);
    expect(frame.moveX).toBeCloseTo(0.62, 9);
    expect(frame.aimX).toBeCloseTo(0.62, 9);
    expect(frame.aimZ).toBeCloseTo(-0.41, 9);
  });

  it('keeps the stick analog, which is where fine aim lives now', () => {
    // The keyboard is three-valued per axis. A pad is not, and that is the
    // honest trade rather than an oversight: merging the controls cost the
    // keyboard its ramp, and a stick never needed one.
    const a = withStick(0.3, 0).aimX;
    const b = withStick(0.7, 0).aimX;
    expect(a).not.toBe(b);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeLessThan(1);
  });

  it('ignores a stick inside the dead zone rather than aiming on noise', () => {
    const frame = withStick(0.1, -0.1);
    expect(frame.aimX).toBe(0);
    expect(frame.aimZ).toBe(0);
  });
});
