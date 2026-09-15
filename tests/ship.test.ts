import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain .mjs tool, deliberately dependency-free
import { EXIT, assertArtifactIntact, parseArgs, plan, remaining, tarExcludes, validate } from '../tools/ship.mjs';

/**
 * The first test any tool in this repo has had.
 *
 * DINK-72 has been open since Day 11, when four defects turned up in the
 * measuring tools against zero in the simulation, all of them in code that was
 * trusted precisely because it was the thing doing the checking. `ship` is worse
 * than a measuring tool: it commits, tags and packages, so a defect in it is a
 * defect in the record of what was shipped. It gets tests before it gets used.
 *
 * What is testable here is the boundary — argument parsing, validation, and the
 * plan — not the git calls. That is on purpose: the plan is pure and the
 * dangerous parts are refused before anything runs, so the interesting failures
 * are all reachable without a repository.
 */
describe('ship, the argument boundary', () => {
  const good = { day: 14, version: '1.1.0', message: 'x' };

  it('parses the flags it documents', () => {
    const opts = parseArgs(['--day', '14', '--version', '1.1.0', '-m', 'hi', '--json']);
    expect(opts).toMatchObject({ day: 14, version: '1.1.0', message: 'hi', json: true });
  });

  it('refuses an unknown flag rather than ignoring it', () => {
    expect(() => parseArgs(['--yolo'])).toThrow(/unknown argument/);
  });

  it('refuses a flag whose value is missing', () => {
    // `--version --json` would otherwise silently tag the string "--json".
    expect(() => parseArgs(['--version', '--json'])).toThrow(/needs a value/);
  });

  it.each([
    [{ ...good, day: 0 }, /--day/],
    [{ ...good, day: 1.5 }, /--day/],
    [{ ...good, version: 'v1.1.0' }, /--version/],
    [{ ...good, version: '1.1' }, /--version/],
    [{ day: 14, version: '1.1.0' }, /-m or -F/],
    [{ ...good, message: undefined, messageFile: '/no/such/file' }, /message file/],
  ])('rejects %j', (opts, message) => {
    expect(() => validate(opts)).toThrow(message);
  });

  it('accepts a well-formed invocation', () => {
    expect(() => validate(good)).not.toThrow();
  });
});

describe('ship, the plan', () => {
  it('names every step, in dependency order', () => {
    const ids = plan({ version: '1.1.0' }).map((s: { id: string }) => s.id);
    expect(ids).toEqual(['verify', 'bump', 'commit', 'tag', 'artifact', 'tarball']);
  });

  it('marks verify as skipped only when asked', () => {
    expect(plan({ version: '1.1.0' })[0].skip).toBeFalsy();
    expect(plan({ version: '1.1.0', skipVerify: true })[0].skip).toBe(true);
  });

  it('carries the version into the tag and the tarball name', () => {
    const labels = plan({ version: '2.3.4' }).map((s: { label: string }) => s.label);
    expect(labels.join(' ')).toContain('v2.3.4');
    expect(labels.join(' ')).toContain('dink-v2.3.4.tar.gz');
  });

  it('lists what a shell cannot do instead of claiming it', () => {
    const left = remaining({ day: 14, version: '1.1.0' }).join(' ');
    expect(left).toContain('publish');
    expect(left).toContain('project doc');
  });

  it('gives distinct exit codes to distinct failures', () => {
    const codes = Object.values(EXIT);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('what the source tarball leaves out', () => {
  /**
   * Day 21 shipped a 1.6 GB tarball, because the exclude list was three names
   * typed on a day when those were the only generated directories that existed.
   * Deriving it from .gitignore means the list cannot go stale on its own; these
   * tests hold the derivation, not the list.
   */
  it('takes every ignored directory, and .git', () => {
    const out = tarExcludes('node_modules/\ndist/\nrelease/\n');
    expect(out).toContain('.git');
    expect(out).toContain('node_modules');
    expect(out).toContain('release');
  });

  it('strips the trailing slash, because tar matches names', () => {
    expect(tarExcludes('release/\n')).toContain('release');
    expect(tarExcludes('release/\n')).not.toContain('release/');
  });

  it('ignores comments and blank lines', () => {
    expect(tarExcludes('# builds\n\nrelease/\n')).toEqual(['.git', 'release']);
  });

  it('drops negations rather than mistranslating them', () => {
    // `!keep.me` means "do not ignore this". Passing it to tar --exclude would
    // exclude a file the author explicitly asked to keep — the exact inversion
    // of what was written.
    expect(tarExcludes('release/\n!keep.me\n')).toEqual(['.git', 'release']);
  });

  it('never emits .git twice when the ignore file lists it', () => {
    expect(tarExcludes('.git\nrelease/\n').filter((n: string) => n === '.git')).toHaveLength(1);
  });

  it("excludes this repository's actual release directory", () => {
    // The regression itself: read the real .gitignore, not a fixture.
    expect(tarExcludes()).toContain('release');
  });
});

describe('the artifact the player actually plays', () => {
  /**
   * Day 25, and the most expensive defect this project has shipped.
   *
   * `buildArtifact` inlined the bundle first and stripped the HTML skeleton
   * second, so `/<meta[^>]*>/gi` — written to remove a charset tag — ran across
   * a megabyte of minified Three.js and deleted every
   * `<metalnessmap_pars_fragment>` it found, because that chunk name begins
   * with the letters `meta`.
   *
   * Every MeshStandardMaterial then failed to compile, in the published
   * artifact only. The players are MeshStandardMaterial; the reach rings are
   * MeshBasicMaterial and compiled fine. The bug report, twice, was "I can only
   * see the blue ring".
   */
  const BUNDLE =
    '#include <metalnessmap_pars_fragment> #include <common> MeshStandardMaterial';

  it('accepts an artifact that carries the bundle intact', () => {
    expect(() => assertArtifactIntact(`<div></div>${BUNDLE}`, BUNDLE)).not.toThrow();
  });

  it('catches the exact regex that broke it', () => {
    const mangled = BUNDLE.replace(/<meta[^>]*>/gi, '');
    expect(() => assertArtifactIntact(mangled, BUNDLE)).toThrow(/lost 1 of 2/);
  });

  it('counts rather than pattern-matches, so Three.js own parser is not a hit', () => {
    // Three.js ships its own include parser, whose source contains a `+`
    // between `#include` and `<`. The first version of this check flagged it,
    // and that false positive is why the rule counts instead of judging.
    const withParser = `${BUNDLE} /^[ \\t]*#include +<([\\w\\d./]+)>/gm`;
    expect(() => assertArtifactIntact(withParser, withParser)).not.toThrow();
  });

  it('notices a bundle that lost its standard material entirely', () => {
    const noMaterial = '#include <metalnessmap_pars_fragment> #include <common>';
    expect(() => assertArtifactIntact(noMaterial, BUNDLE)).toThrow(/MeshStandardMaterial/);
  });
});
