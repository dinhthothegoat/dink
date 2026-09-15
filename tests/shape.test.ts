import { describe, expect, it } from 'vitest';
import * as C from '../src/sim/constants';
import { createPlayer } from '../src/sim/player';
import { createShapeTally, sampleShape, shapeReport } from '../src/sim/shape';

/**
 * The instrument, tested before it was trusted.
 *
 * DINK-72 has been open since Day 11, when four defects turned up in the
 * measuring tools against zero in the simulation, all of them denominators. This
 * file exists because Day 16's entire argument is a set of percentages, and a
 * percentage nothing constrains is a rumour with a decimal point.
 */
const pair = (x0: number, z0: number, x1: number, z1: number) => {
  const a = createPlayer('near', 0);
  const b = createPlayer('near', 1);
  a.pos.x = x0;
  a.pos.z = z0;
  b.pos.x = x1;
  b.pos.z = z1;
  return [a, b];
};

describe('the shape tally', () => {
  it('reports null rather than zero on an empty sample', () => {
    // Zero is a claim — "they never crowded". A tool that makes it having
    // measured nothing is the exact failure `coverage` shipped with on Day 7 and
    // carried for four days.
    const r = shapeReport(createShapeTally());
    expect(r.crowded).toBeNull();
    expect(r.lateral).toBeNull();
    expect(r.upAndBack).toBeNull();
    expect(r.ticks).toBe(0);
  });

  it('counts only live ticks, because the denominator is what goes wrong', () => {
    const t = createShapeTally();
    sampleShape(t, pair(0, 6, 0.1, 6), false);
    sampleShape(t, pair(0, 6, 0.1, 6), false);
    expect(t.ticks).toBe(0);
    sampleShape(t, pair(0, 6, 0.1, 6), true);
    expect(t.ticks).toBe(1);
  });

  it('ignores a team of one', () => {
    const t = createShapeTally();
    sampleShape(t, [createPlayer('near', 0)], true);
    expect(t.ticks).toBe(0);
  });

  it('calls a pair crowded inside a stride and not outside it', () => {
    const t = createShapeTally();
    sampleShape(t, pair(0, 6, 0.9, 6), true);
    sampleShape(t, pair(-1.5, 6, 1.5, 6), true);
    expect(t.crowded).toBe(1);
    expect(t.ticks).toBe(2);
    expect(shapeReport(t).crowded).toBe(50);
  });

  it('separates crowding at the back from crowding at the net', () => {
    const t = createShapeTally();
    sampleShape(t, pair(0, 6.3, 0.4, 6.3), true);
    sampleShape(t, pair(0, 2.5, 0.4, 2.5), true);
    expect(t.crowded).toBe(2);
    expect(t.crowdedDeep).toBe(1);
    expect(shapeReport(t).crowdedDeep).toBe(50);
  });

  it('tells side-by-side at the line from up-and-back', () => {
    const line = C.KITCHEN_DEPTH + C.PLAYER_RADIUS + 0.3;
    const t = createShapeTally();
    sampleShape(t, pair(-1.5, line, 1.5, line), true);
    sampleShape(t, pair(-1.5, line, 1.5, 6.2), true);
    sampleShape(t, pair(-1.5, 6.2, 1.5, 6.2), true);
    const r = shapeReport(t);
    expect(r.atLine).toBeCloseTo(100 / 3, 1);
    expect(r.upAndBack).toBeCloseTo(100 / 3, 1);
  });

  it('averages the separations it was given', () => {
    const t = createShapeTally();
    sampleShape(t, pair(-1, 6, 1, 6), true);
    sampleShape(t, pair(-2, 6, 2, 6), true);
    const r = shapeReport(t);
    expect(r.lateral).toBeCloseTo(3, 6);
    expect(r.depthGap).toBeCloseTo(0, 6);
  });
});
