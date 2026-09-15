import { describe, expect, it } from 'vitest';
import { DEFAULTS, coerce, teamSizeOf } from '../src/core/settings';

/**
 * What comes back out of storage is not what you put in.
 *
 * It may have been written by an older build, by another tab, or by somebody
 * editing it by hand, and the only guarantee is that it is a string that once
 * parsed as JSON. Every field is validated on the way back in, and the test for
 * that is field-by-field rather than all-or-nothing: a build that adds a setting
 * must not throw away the four a player already chose.
 */
describe('settings coercion', () => {
  it('defaults anything it does not recognise', () => {
    expect(coerce(undefined)).toEqual(DEFAULTS);
    expect(coerce(null)).toEqual(DEFAULTS);
    expect(coerce('doubles')).toEqual(DEFAULTS);
    expect(coerce(42)).toEqual(DEFAULTS);
    expect(coerce([])).toEqual(DEFAULTS);
  });

  it('keeps the good fields and defaults only the bad ones', () => {
    const s = coerce({ mode: 'doubles', difficulty: 'nonsense', speed: 0.8 });
    expect(s.mode).toBe('doubles');
    expect(s.speed).toBe(0.8);
    expect(s.difficulty).toBe(DEFAULTS.difficulty);
  });

  it('refuses a speed the buttons do not offer', () => {
    // An arbitrary number here is somebody else's writing, and a game running at
    // 0.03 speed with no button lit is a bug report nobody can reproduce.
    expect(coerce({ speed: 0.61 }).speed).toBe(DEFAULTS.speed);
    expect(coerce({ speed: 99 }).speed).toBe(DEFAULTS.speed);
    expect(coerce({ speed: 1 }).speed).toBe(1);
  });

  it('refuses a truthy string where a boolean belongs', () => {
    expect(coerce({ watch: 'true' }).watch).toBe(false);
    expect(coerce({ muted: 1 }).muted).toBe(false);
    expect(coerce({ watch: true }).watch).toBe(true);
  });

  it('accepts every value the interface can actually produce', () => {
    for (const difficulty of ['easy', 'steady', 'tough'] as const) {
      expect(coerce({ difficulty }).difficulty).toBe(difficulty);
    }
    for (const view of ['broadcast', 'side', 'top'] as const) {
      expect(coerce({ view }).view).toBe(view);
    }
  });

  it('never hands back a shared object', () => {
    // `coerce` starts from a copy of DEFAULTS. Returning the constant itself
    // would let one caller's edit change everybody's defaults.
    const a = coerce(null);
    a.mode = 'doubles';
    expect(coerce(null).mode).toBe('singles');
    expect(DEFAULTS.mode).toBe('singles');
  });

  it('maps a mode to a team size', () => {
    expect(teamSizeOf('singles')).toBe(1);
    expect(teamSizeOf('doubles')).toBe(2);
  });
});
