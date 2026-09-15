import { describe, expect, it } from 'vitest';
import { STYLES, STYLE_BLURB, STYLE_NAMES, styleOf } from '../src/sim/style';
import { chooseShot } from '../src/sim/opponent';
import { v3 } from '../src/sim/vec3';

/**
 * Styles, as a contract rather than as a table of numbers.
 *
 * `tools/styles.mjs` is what proves the styles are different players — it plays
 * them and measures the shot mix, and its verdict deleted one of them on the day
 * they were written. These tests do the part a measurement tool cannot: they
 * hold the INVARIANTS, so that a later tuning pass cannot quietly turn a banger
 * into a dinker while the table still looks plausible.
 */

const at = (z: number, y: number) => ({
  contact: v3(0, y, z),
  otherX: 2,
  strain: 0.1,
  facing: -1 as const,
});

describe('the style set', () => {
  it('names every style after itself', () => {
    for (const name of STYLE_NAMES) expect(STYLES[name].name).toBe(name);
  });

  it('gives every style a line the player can act on', () => {
    for (const name of STYLE_NAMES) expect(STYLE_BLURB[name].length).toBeGreaterThan(10);
  });

  it('keeps all court exactly as the policy shipped', () => {
    // The control. `attackHeight` and `lobAt` were ATTACK_HEIGHT and STRETCHED
    // in opponent.ts, and if they move, every measurement taken against this
    // reference since Day 5 is measuring something else.
    const base = styleOf('all court');
    expect(base.attackHeight).toBe(0.95);
    expect(base.lobAt).toBe(0.78);
    expect(base.netUrge).toBe(1);
    expect(base.spread).toBe(1);
  });

  it('keeps every dial in range', () => {
    for (const name of STYLE_NAMES) {
      const s = styleOf(name);
      expect(s.aggression).toBeGreaterThanOrEqual(0);
      expect(s.aggression).toBeLessThanOrEqual(1);
      expect(s.lobAt).toBeGreaterThan(0);
      expect(s.lobAt).toBeLessThanOrEqual(1);
      expect(s.netUrge).toBeGreaterThanOrEqual(0);
      // Past the baseline is not a court position, it is a bug.
      expect(s.homeDepth).toBeGreaterThan(2);
      expect(s.homeDepth).toBeLessThan(7);
    }
  });
});

describe('a style changes the shot, not just the label', () => {
  it('defaults to all court when no style is given', () => {
    // Every test written before Day 22 calls chooseShot without a style. If the
    // default drifted, those tests would silently start measuring a different
    // player while continuing to pass.
    const ctx = at(3.0, 0.5);
    expect(chooseShot(ctx)).toEqual(chooseShot({ ...ctx, style: styleOf('all court') }));
  });

  it('makes a banger drive the third ball where others drop it', () => {
    const deep = { ...at(6.0, 0.4), foeAtLine: true, strain: 0.2 };
    expect(chooseShot({ ...deep, style: styleOf('all court') }).shape).toBe('drop');
    expect(chooseShot({ ...deep, style: styleOf('wall') }).shape).toBe('drop');
    // Not a worse drop. No drop at all.
    expect(chooseShot({ ...deep, style: styleOf('banger') }).shape).toBe('drive');
  });

  it('makes a banger attack a ball a wall will not', () => {
    // 0.5 m at the kitchen: above the banger's 0.36 and below the wall's 0.70.
    const low = at(2.5, 0.5);
    expect(chooseShot({ ...low, style: styleOf('banger') }).shape).toBe('drive');
    expect(chooseShot({ ...low, style: styleOf('wall') }).shape).toBe('drop');
  });

  it('makes a lobber reset from a position others still attack from', () => {
    const stretched = { ...at(4.0, 0.5), strain: 0.6 };
    expect(chooseShot({ ...stretched, style: styleOf('lobber') }).shape).toBe('lob');
    expect(chooseShot({ ...stretched, style: styleOf('all court') }).shape).not.toBe('lob');
  });

  it('scales how much ground a shot earns, in one direction for every step', () => {
    // A style cannot be timid going forward and reckless coming in: one
    // multiplier drives both step sizes.
    const ball = at(2.5, 0.4);
    const base = chooseShot({ ...ball, style: styleOf('all court') }).step;
    const wall = chooseShot({ ...ball, style: styleOf('wall') }).step;
    expect(wall).toBeGreaterThan(base);
  });

  it('scales aim width without changing which side it aims at', () => {
    const ball = at(2.5, 0.4);
    const base = chooseShot({ ...ball, style: styleOf('all court') }).aim;
    const wide = chooseShot({ ...ball, style: styleOf('banger') }).aim;
    expect(Math.sign(wide)).toBe(Math.sign(base));
    expect(Math.abs(wide)).toBeGreaterThan(Math.abs(base));
  });

  it('never returns an aim outside the court', () => {
    // spread is a multiplier, so a future style with a big one could push the
    // aim past 1 and ask the solver for a target off the court.
    for (const name of STYLE_NAMES) {
      for (const z of [1.5, 3.0, 5.0, 6.5]) {
        for (const y of [0.3, 0.5, 0.9, 1.4]) {
          const c = chooseShot({ ...at(z, y), style: styleOf(name) });
          expect(Math.abs(c.aim)).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
