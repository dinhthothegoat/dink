#!/usr/bin/env node
/**
 * ship — end a build day: verify, commit, tag, package.
 *
 * The same eight steps have been run by hand at the end of every day since Day
 * 1. Thirteen times is well past the point where a procedure should be a
 * command, and the two mistakes it has already produced were both the same
 * kind: the version in package.json and the git tag disagreeing, because the
 * bump and the tag are two commands and nothing checked they matched.
 *
 * Usage:
 *   node tools/ship.mjs --day 14 --version 1.1.0 -m "Day 14: the doubles rulebook"
 *   node tools/ship.mjs --day 14 --version 1.1.0 -m "..." --dry-run
 *   node tools/ship.mjs --day 14 --version 1.1.0 -F notes.txt --json
 *
 * What it does NOT do, on purpose: publish the artifact and update the project
 * doc. Both are calls into Claude's own tools rather than the shell, so the
 * tool prints them as remaining work instead of pretending to have done them.
 *
 * Exit codes:
 *   0 shipped        1 usage error      2 precondition failed
 *   3 verify failed  4 git failed       5 packaging failed
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = '/mnt/user-data/outputs';
const ARTIFACT = '/home/claude/dink-artifact.html';
/** Kept stable across republishes: the artifact is found by its tab title. */
const ARTIFACT_TITLE = 'Dink: Pickleball Rivals';

export const EXIT = {
  ok: 0,
  usage: 1,
  precondition: 2,
  verify: 3,
  git: 4,
  package: 5,
};

const HELP = `ship — end a build day: verify, commit, tag, package.

  --day <n>          the sprint day being shipped        (required)
  --version <x.y.z>  the version to tag                  (required)
  -m, --message <s>  first line of the commit message    (required unless -F)
  -F, --file <path>  read the whole commit message from a file
  --dry-run          print the plan and change nothing
  --verbose          echo every command before running it
  --json             machine-readable result on stdout
  --skip-verify      package a build you have already verified this minute
  -h, --help         this
  -V, --version-of-tool

Examples:
  node tools/ship.mjs --day 14 --version 1.1.0 -m "Day 14: the doubles rulebook"
  node tools/ship.mjs --day 14 --version 1.1.0 -F /tmp/msg.txt --dry-run
`;

export const parseArgs = (argv) => {
  const opts = { dryRun: false, verbose: false, json: false, skipVerify: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) {
        throw new UsageError(`${a} needs a value`);
      }
      i += 1;
      return v;
    };
    if (a === '--day') opts.day = Number(next());
    else if (a === '--version') opts.version = next();
    else if (a === '-m' || a === '--message') opts.message = next();
    else if (a === '-F' || a === '--file') opts.messageFile = next();
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--verbose') opts.verbose = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--skip-verify') opts.skipVerify = true;
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a === '-V' || a === '--version-of-tool') opts.toolVersion = true;
    else throw new UsageError(`unknown argument ${a}`);
  }
  return opts;
};

export class UsageError extends Error {}

/** Everything the tool would do, in order. Pure, so a test can read it. */
export const plan = (opts) => [
  { id: 'verify', skip: opts.skipVerify, label: 'npm run verify (typecheck, tests, build)' },
  { id: 'bump', label: `package.json version -> ${opts.version}` },
  { id: 'commit', label: `git commit, all changes` },
  { id: 'tag', label: `git tag v${opts.version}` },
  { id: 'artifact', label: `inline dist into ${ARTIFACT}` },
  { id: 'tarball', label: `${OUT_DIR}/dink-v${opts.version}.tar.gz` },
];

/** Steps a shell cannot do. Printed, never claimed. */
export const remaining = (opts) => [
  `publish ${ARTIFACT} to the "${ARTIFACT_TITLE}" artifact`,
  `deliver ${OUT_DIR}/dink-v${opts.version}.tar.gz to the user`,
  `update the project doc for day ${opts.day}`,
];

export const validate = (opts) => {
  if (!Number.isInteger(opts.day) || opts.day < 1) {
    throw new UsageError('--day must be a positive whole number');
  }
  if (!/^\d+\.\d+\.\d+$/.test(opts.version ?? '')) {
    throw new UsageError('--version must look like 1.2.3');
  }
  if (!opts.message && !opts.messageFile) {
    throw new UsageError('one of -m or -F is required');
  }
  if (opts.messageFile && !existsSync(opts.messageFile)) {
    throw new UsageError(`no such message file: ${opts.messageFile}`);
  }
};

const run = (cmd, args, opts, { capture = true } = {}) => {
  if (opts.verbose) process.stderr.write(`$ ${cmd} ${args.join(' ')}\n`);
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
};

class StepError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Refuse to ship onto a tag that already exists.
 *
 * Not politeness. Re-tagging silently moves a tag that a tarball out in the
 * world already claims to be, which is the one failure here that cannot be
 * undone by running the command again.
 */
const checkPreconditions = (opts) => {
  let tags = '';
  try {
    tags = run('git', ['tag', '--list', `v${opts.version}`], opts);
  } catch {
    throw new StepError(EXIT.git, 'not a git repository, or git is unavailable');
  }
  if (tags.trim()) {
    throw new StepError(EXIT.precondition, `tag v${opts.version} already exists`);
  }
  const dirty = run('git', ['status', '--porcelain'], opts).trim();
  if (!dirty) {
    throw new StepError(EXIT.precondition, 'nothing to commit; is the day actually done?');
  }
};

/**
 * What to leave out of the source tarball, read from .gitignore.
 *
 * Day 21 shipped a 1.6 GB tarball. The exclude list here was three hardcoded
 * names — node_modules, dist, .git — written on a day when those were the only
 * generated directories that existed. Packaging the desktop builds added
 * `release/`, which is a third of a gigabyte of Electron per platform, and the
 * list had no way to know.
 *
 * So it is derived rather than maintained. `.gitignore` already answers "is this
 * generated", it is the file a person edits when they add a build directory,
 * and having two lists that must agree is how they stop agreeing.
 *
 * `.git` is added explicitly because .gitignore has no reason to mention it.
 * Negations and glob syntax are ignored: tar's --exclude takes patterns, this
 * project's ignore file is a list of directory names, and quietly
 * mistranslating a pattern would be worse than not supporting one.
 */
export const tarExcludes = (gitignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')) => {
  const names = gitignore
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
    .map((line) => line.replace(/\/$/, ''));
  return [...new Set(['.git', ...names])];
};

/**
 * Inline the built bundle into one self-contained page.
 *
 * The ORDER here is the whole lesson of Day 25, and it is not a style choice.
 *
 * This function used to inline the JavaScript first and strip the HTML skeleton
 * second, which meant every skeleton-stripping regex was run across a megabyte
 * of minified Three.js. One of them was `/<meta[^>]*>/gi`, for removing the
 * charset and viewport tags the publish target supplies itself.
 *
 * Three.js builds its shaders out of directives that look like this:
 *
 *     #include <metalnessmap_pars_fragment>
 *     #include <metalnessmap_fragment>
 *
 * `<metalnessmap_pars_fragment>` begins with the letters `meta`, so the regex
 * matched it and deleted it, leaving `#include ` pointing at nothing. Every
 * `MeshStandardMaterial` then failed to compile — in the PUBLISHED ARTIFACT
 * ONLY, because nothing else in the pipeline runs this function:
 *
 *     ERROR: 0:1458: 'include' : invalid directive name
 *     ERROR: 0:1605: 'metalnessFactor' : undeclared identifier
 *
 * The players are `MeshStandardMaterial`. The reach rings are
 * `MeshBasicMaterial`, which needs no shader chunks and compiled fine. So the
 * published game rendered a court, a net, and two rings on an empty court, and
 * the bug report — twice, on Day 16 and again today — was "I can only see the
 * blue ring". Exactly right, and exactly what this regex does.
 *
 * It survived because every check this project owns runs against `dist`: the
 * tests, `npm run shots`, `npm run watch`, the browser harness and the desktop
 * verifier. The artifact is the one build nothing looks at, and it is the one
 * build people actually play.
 *
 * So: **strip the skeleton BEFORE inlining the script.** Then the regexes only
 * ever see the twelve kilobytes of hand-written HTML they were written for, and
 * no future one can reach the bundle no matter how it is spelled.
 */
const buildArtifact = (opts) => {
  const indexPath = join(ROOT, 'dist', 'index.html');
  if (!existsSync(indexPath)) {
    throw new StepError(EXIT.package, 'dist/index.html missing; run without --skip-verify');
  }
  let html = readFileSync(indexPath, 'utf8');

  // The publish target wraps the page in its own skeleton, so ours has to go.
  // Done first, on the raw page, while `html` is still small and contains no
  // JavaScript. `\s` after `meta` is belt and braces: a real meta tag always
  // has an attribute, and a GLSL include never has a space there.
  html = html
    .replace(/^[\s\S]*?<head[^>]*>/i, '')
    .replace(/<\/head>|<body>|<\/body>|<\/html>/gi, '')
    .replace(/<meta\s[^>]*>/gi, '')
    .trim()
    .replace(/<title>[^<]*<\/title>/i, `<title>${ARTIFACT_TITLE}</title>`);

  let bundle = '';
  html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (_m, src) => {
    const js = readFileSync(join(ROOT, 'dist', src.replace(/^\.?\//, '')), 'utf8').replace(
      /\/\/# sourceMappingURL=.*$/m,
      '',
    );
    bundle += js;
    return `<script type="module">${js}</script>`;
  });

  assertArtifactIntact(html, bundle);
  writeFileSync(ARTIFACT, html);
  return html.length;
};

/**
 * Refuse to ship an artifact whose bundle has been mangled.
 *
 * The Day 25 defect was invisible because nothing ever looked at the artifact.
 * This is the check that would have caught it in one second.
 *
 * It COUNTS rather than pattern-matches, and that is the second lesson of the
 * day. The first version looked for `#include` not followed by `<`, and its
 * only hit was a false positive: Three.js contains its own include parser,
 *
 *     /^[ \t]*#include +<([\w\d./]+)>/gm
 *
 * whose source has a `+` between `#include` and `<`. Any rule clever enough to
 * exclude that is a rule clever enough to be wrong again.
 *
 * Comparing counts needs no cleverness. The bundle is the ground truth, the
 * artifact is supposed to contain it verbatim, and any regex that eats anything
 * on the way through shows up as a number that does not match — whatever it
 * ate and however it was spelled.
 */
export const assertArtifactIntact = (html, bundle) => {
  const includes = (text) => (text.match(/#include\s*<[\w\d./]+>/g) ?? []).length;
  const want = includes(bundle);
  const got = includes(html);
  if (got !== want) {
    throw new StepError(
      EXIT.package,
      `artifact lost ${want - got} of ${want} shader #include directives on the way in. ` +
        'A skeleton-stripping regex has eaten part of the bundle. See buildArtifact.',
    );
  }
  if (want > 0 && !html.includes('MeshStandardMaterial')) {
    throw new StepError(EXIT.package, 'artifact is missing MeshStandardMaterial');
  }
};

export const main = (argv) => {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`ship: ${e.message}\n\n${HELP}`);
    return EXIT.usage;
  }
  if (opts.help) {
    process.stdout.write(HELP);
    return EXIT.ok;
  }
  if (opts.toolVersion) {
    process.stdout.write('ship 1.0.0\n');
    return EXIT.ok;
  }
  try {
    validate(opts);
  } catch (e) {
    process.stderr.write(`ship: ${e.message}\n\n${HELP}`);
    return EXIT.usage;
  }

  const steps = plan(opts);
  if (opts.dryRun) {
    const lines = steps.map((s) => `${s.skip ? 'skip' : 'run '}  ${s.label}`);
    const left = remaining(opts).map((r) => `left  ${r}`);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({ dryRun: true, steps, remaining: remaining(opts) }, null, 2)}\n`);
    } else {
      process.stdout.write(`${[...lines, ...left].join('\n')}\n`);
    }
    return EXIT.ok;
  }

  try {
    checkPreconditions(opts);

    if (!opts.skipVerify) {
      try {
        run('npm', ['run', 'verify'], opts, { capture: !opts.verbose });
      } catch {
        throw new StepError(EXIT.verify, 'npm run verify failed; nothing was committed');
      }
    }

    const pkgPath = join(ROOT, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    pkg.version = opts.version;
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    const message = opts.messageFile
      ? readFileSync(opts.messageFile, 'utf8')
      : `${opts.message}\n`;

    // The message goes to a temp file OUTSIDE the repo. Inside it, `git add -A`
    // would sweep the message into the commit it is the message for.
    const tmp = join(tmpdir(), `dink-ship-${process.pid}.txt`);
    writeFileSync(tmp, message);
    try {
      run('git', ['add', '-A'], opts);
      run('git', ['commit', '-F', tmp], opts);
      run('git', ['tag', '-a', `v${opts.version}`, '-m', `v${opts.version}`], opts);
    } catch (e) {
      throw new StepError(EXIT.git, `git refused: ${String(e.stderr ?? e.message).trim()}`);
    } finally {
      rmSync(tmp, { force: true });
    }

    const bytes = buildArtifact(opts);

    /**
     * Launch the artifact and check a person is on screen. Day 26.
     *
     * `assertArtifactIntact` compares shader include counts, which catches the
     * Day 25 defect and nothing else. This runs the thing: boots it in a
     * browser, serves a ball, and counts the skin pixels on the court. It costs
     * about forty seconds and it is the only check in this project that looks at
     * the build people actually play.
     *
     * Skipped with --skip-verify, alongside the rest of the verification, so a
     * repackage of a build already checked this minute does not pay for it twice.
     */
    if (!opts.skipVerify) {
      run('node', [join(ROOT, 'tools', 'artifact.mjs'), '--file', ARTIFACT], opts);
    }

    mkdirSync(OUT_DIR, { recursive: true });
    run(
      'tar',
      [
        ...tarExcludes().map((name) => `--exclude=${name}`),
        '-czf',
        `${OUT_DIR}/dink-v${opts.version}.tar.gz`,
        '-C',
        dirname(ROOT),
        'dink',
      ],
      opts,
    );

    const result = {
      day: opts.day,
      version: opts.version,
      tag: `v${opts.version}`,
      artifact: ARTIFACT,
      artifactBytes: bytes,
      tarball: `${OUT_DIR}/dink-v${opts.version}.tar.gz`,
      remaining: remaining(opts),
    };
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(
        `shipped day ${opts.day} as v${opts.version}\n` +
          `  tag      ${result.tag}\n` +
          `  artifact ${result.artifact} (${(bytes / 1e6).toFixed(2)} MB)\n` +
          `  tarball  ${result.tarball}\n` +
          `${remaining(opts).map((r) => `  left     ${r}`).join('\n')}\n`,
      );
    }
    return EXIT.ok;
  } catch (e) {
    process.stderr.write(`ship: ${e.message}\n`);
    return e.code ?? EXIT.package;
  }
};

if (process.argv[1] && process.argv[1].endsWith('ship.mjs')) {
  process.exit(main(process.argv.slice(2)));
}
