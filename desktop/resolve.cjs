/**
 * Turn a `dink://` request into a path inside the build, or refuse.
 *
 * Split out of `main.cjs` for one reason: it is the only part of the desktop
 * shell that makes a decision, and the rest of the shell cannot be tested from
 * here at all. A pure function that takes a directory and a URL and returns a
 * path is testable in the same suite as everything else, and the traversal
 * guard below is exactly the kind of thing that should never be verified by
 * reading it.
 *
 * CommonJS to match the main process, which starts before ESM is available.
 */

const path = require('node:path');

/**
 * @param {string} distDir absolute path to the built game
 * @param {string} requestUrl e.g. dink://game/assets/index-abc.js
 * @returns {{ ok: true, file: string } | { ok: false, reason: string }}
 */
const resolveAsset = (distDir, requestUrl) => {
  let parsed;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return { ok: false, reason: 'unparseable url' };
  }

  // Percent-decode before touching the filesystem: a hashed asset name is safe,
  // but a path with a space arrives encoded and would otherwise miss on disk.
  // Decoding is also what makes the guard below load-bearing rather than
  // decorative — `%2e%2e%2f` is `../` and only looks harmless before decoding.
  let wanted;
  try {
    wanted = decodeURIComponent(parsed.pathname);
  } catch {
    return { ok: false, reason: 'bad percent-encoding' };
  }

  const file = path.normalize(path.join(distDir, wanted === '/' ? 'index.html' : wanted));
  const root = path.normalize(distDir);

  // Escaping the build directory is refused. The window only ever loads our own
  // build, so this should be unreachable — which is precisely why it is worth
  // having and worth testing: an unreachable guard costs nothing, and an
  // assumed-unreachable one costs everything the day a URL comes from somewhere
  // new.
  if (file !== root && !file.startsWith(root + path.sep)) {
    return { ok: false, reason: 'outside the build' };
  }
  return { ok: true, file };
};

module.exports = { resolveAsset };
