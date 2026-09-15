import { describe, expect, it } from 'vitest';
import { REAL, countRally, countShot, createProfile, profileReport } from '../src/sim/profile';

/**
 * The instrument, before the instrument is trusted.
 *
 * Day 17's entire argument is a table of percentages compared against charted
 * real matches. This project has shipped five defects in measuring tools against
 * one in the simulation, and every one of them was a denominator. So the
 * denominators are what this file is about.
 */
describe('the match profile', () => {
  it('returns null rather than zero on an empty sample', () => {
    const r = profileReport(createProfile());
    expect(r.meanRally).toBeNull();
    expect(r.strikerErrorPct).toBeNull();
    expect(r.serveFaultPct).toBeNull();
  });

  it('charges serve faults against SERVES, not against rallies', () => {
    // The Day 11 defect, exactly: serve faults counted into a denominator that
    // serves were not in. Two rallies, four shots, of which two were serves,
    // one of which faulted. The answer is 50 per cent of serves, not 25 per
    // cent of shots and not 50 per cent of rallies by luck.
    const p = createProfile();
    countShot(p, true);
    countShot(p, false);
    countRally(p, 2, 'out', 'near', 'near');
    countShot(p, true);
    countShot(p, false);
    countRally(p, 2, 'serve into net', 'far', 'far');
    const r = profileReport(p);
    expect(p.serves).toBe(2);
    expect(r.serveFaultPct).toBe(50);
  });

  it('splits endings into striker error and unreachable, and they sum to 100', () => {
    const p = createProfile();
    for (const f of ['into net', 'out', 'serve out'] as const) {
      countShot(p, false);
      countRally(p, 3, f, 'near', 'near');
    }
    for (const f of ['double bounce', 'missed'] as const) {
      countShot(p, false);
      countRally(p, 3, f, 'near', 'near');
    }
    const r = profileReport(p);
    expect(r.strikerErrorPct).toBe(60);
    expect(r.unreachablePct).toBe(40);
    expect((r.strikerErrorPct ?? 0) + (r.unreachablePct ?? 0)).toBe(100);
  });

  it('buckets rally lengths on the sport boundaries, not near them', () => {
    const p = createProfile();
    for (const n of [1, 4, 5, 8, 9, 40]) {
      countShot(p, false);
      countRally(p, n, 'out', 'near', 'near');
    }
    expect(p.short).toBe(2);
    expect(p.medium).toBe(2);
    expect(p.long).toBe(2);
    expect(p.longest).toBe(40);
  });

  it('credits the rally to the side that did not fault', () => {
    const p = createProfile();
    countShot(p, true);
    countRally(p, 1, 'out', 'far', 'near');
    countShot(p, true);
    countRally(p, 1, 'out', 'near', 'near');
    expect(p.servedAndWon).toBe(1);
  });

  it('counts a rule breach by the striker as a striker error', () => {
    // Rare, and listed so the classification is complete rather than plausible.
    const p = createProfile();
    countShot(p, false);
    countRally(p, 3, 'volley in the kitchen', 'near', 'near');
    expect(profileReport(p).strikerErrorPct).toBe(100);
  });

  it('keeps the real numbers internally consistent', () => {
    // The comparison targets are charted from real matches and quoted in
    // src/sim/profile.ts with their sources. If somebody edits one they should
    // have to edit the others.
    expect(REAL.shortPct + REAL.mediumPct + REAL.longPct).toBe(100);
    expect(REAL.strikerErrorPct + REAL.unreachablePct).toBe(100);
    expect(REAL.meanRally).toBeGreaterThan(5);
  });
});
