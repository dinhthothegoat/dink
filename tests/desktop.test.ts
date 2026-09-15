import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The desktop shell, as far as it can be tested from here.
 *
 * Day 21. Almost all of the shell is Electron calls that only mean anything
 * inside a running Electron process, and those are covered by `npm run
 * desktop:verify`, which launches the packaged binary and drives it. What is
 * testable here is the one part that makes a decision — turning a `dink://`
 * request into a file — plus the packaging manifest, which is where a build
 * silently loses a file nobody notices until a player downloads it.
 */

const require = createRequire(import.meta.url);
const { resolveAsset } = require('../desktop/resolve.cjs') as {
  resolveAsset: (
    dist: string,
    url: string,
  ) => { ok: true; file: string } | { ok: false; reason: string };
};

const DIST = '/app/dist';

describe('serving the build over the dink:// scheme', () => {
  it('maps the root to index.html', () => {
    const r = resolveAsset(DIST, 'dink://game/');
    expect(r).toEqual({ ok: true, file: path.normalize('/app/dist/index.html') });
  });

  it('serves a hashed asset', () => {
    const r = resolveAsset(DIST, 'dink://game/assets/index-Cd2VCVvH.js');
    expect(r.ok && r.file).toBe(path.normalize('/app/dist/assets/index-Cd2VCVvH.js'));
  });

  it('keeps the query string out of the path', () => {
    // The game reads ?doubles=1 and ?demo=1, and the recording harnesses use
    // them. A resolver that pasted the query onto the filename would break
    // every one of those URLs and only on the desktop.
    const r = resolveAsset(DIST, 'dink://game/index.html?doubles=1');
    expect(r.ok && r.file).toBe(path.normalize('/app/dist/index.html'));
  });

  /**
   * Two kinds of traversal, and only one of them reaches the guard.
   *
   * These tests were written asserting that every `../` is refused, and all
   * three of them failed. The reason is worth keeping rather than editing away:
   * a registered standard scheme is parsed by the URL parser, and the URL
   * parser collapses `..` segments before anybody downstream sees them. By the
   * time the resolver is called, `dink://game/../../../etc/passwd` has a
   * pathname of `/etc/passwd` and lands harmlessly at a file inside the build
   * that does not exist.
   *
   * `%2e%2e%2f` survives parsing, because it is not a path separator until it
   * is decoded — and decoding is done by the resolver, after the parser has
   * finished. That single case is the entire reason the guard exists, and
   * asserting the other three would have been asserting the URL parser's
   * behaviour rather than our own.
   */
  it.each([
    ['plain traversal', 'dink://game/../../../etc/passwd', '/app/dist/etc/passwd'],
    ['mixed traversal', 'dink://game/assets/../../secrets.txt', '/app/dist/secrets.txt'],
    ['a lookalike sibling', 'dink://game/../dist-old/index.html', '/app/dist/dist-old/index.html'],
  ])('has %s collapsed by the URL parser before it arrives', (_label, url, inside) => {
    const r = resolveAsset(DIST, url);
    expect(r.ok && r.file).toBe(path.normalize(inside));
  });

  it('refuses the encoded traversal, which is the one that gets through', () => {
    expect(resolveAsset(DIST, 'dink://game/%2e%2e%2f%2e%2e%2fetc%2fpasswd')).toEqual({
      ok: false,
      reason: 'outside the build',
    });
  });

  it('refuses a sibling directory that merely shares the prefix', () => {
    // `/app/dist-old/x` starts with `/app/dist` as a STRING without being
    // inside it. Comparing with startsWith and no separator is the classic way
    // to get this wrong, so it is the classic thing to test — reached here
    // through the encoded form, since that is the only form that arrives
    // intact.
    expect(resolveAsset(DIST, 'dink://game/%2e%2e%2fdist-old%2findex.html').ok).toBe(false);
  });

  it('survives malformed percent-encoding without throwing', () => {
    // decodeURIComponent throws on a lone %. A protocol handler that throws
    // takes the window with it.
    expect(resolveAsset(DIST, 'dink://game/%').ok).toBe(false);
  });
});

describe('the packaging manifest', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    main: string;
    version: string;
    build: { files: string[]; appId: string; productName: string };
  };

  it('points Electron at the shell', () => {
    expect(pkg.main).toBe('desktop/main.cjs');
  });

  it('packages every file the shell needs at runtime', () => {
    // `files` is an allowlist. Anything missing from it is simply absent from
    // the installed app, and the failure arrives as a blank window on somebody
    // else's machine rather than as a build error here. resolve.cjs was added
    // after main.cjs and is exactly the kind of file that gets left out.
    for (const needed of ['desktop/main.cjs', 'desktop/resolve.cjs', 'dist/**/*']) {
      expect(pkg.build.files).toContain(needed);
    }
  });

  it('leaves the sourcemaps behind', () => {
    // Three megabytes of sourcemap per build, and it is the whole source tree.
    expect(pkg.build.files).toContain('!dist/**/*.map');
  });

  it('ships an application icon on every platform', () => {
    // electron-builder logged `default Electron icon is used` for three days
    // and packaged the Electron logo, which is the first thing a playtester
    // sees — before the title card and before a ball is struck. It is a warning
    // in a build log, which is to say invisible.
    const b = pkg.build as unknown as Record<string, { icon?: string }>;
    for (const platform of ['win', 'mac', 'linux']) {
      expect(b[platform]?.icon).toBeTruthy();
      expect(existsSync(b[platform]!.icon!)).toBe(true);
    }
  });

  it('carries every icon size Windows asks for', () => {
    // A .ico is a container. One that declares only 256x256 looks fine in a
    // file listing and renders as a blurry mess in the taskbar, which is the
    // place it is actually seen.
    const ico = readFileSync('desktop/resources/icon.ico');
    const count = ico.readUInt16LE(4);
    const sizes = Array.from({ length: count }, (_, i) => ico[6 + i * 16] || 256);
    expect(sizes).toContain(16);
    expect(sizes).toContain(32);
    expect(sizes).toContain(48);
    expect(sizes).toContain(256);
  });

  it('inlines the favicon rather than linking a second file', () => {
    // A linked favicon 404s in the published artifact, because ship.mjs inlines
    // the whole game into one html file and there is no second file to fetch.
    // That 404 was visible in the Day 22 harness output and went unexplained.
    const html = readFileSync('index.html', 'utf8');
    expect(html).toMatch(/<link rel="icon"[^>]*href="data:image\/png;base64,/);
  });

  it('has an appId that will not change', () => {
    // Reverse-DNS, and it is what the operating system and later Steam use to
    // decide whether an update is the same application. Changing it later
    // orphans everyone's install.
    expect(pkg.build.appId).toMatch(/^[a-z]+\.[a-z]+\.[a-z]+$/);
  });
});
