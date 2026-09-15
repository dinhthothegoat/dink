#!/usr/bin/env node
/**
 * watch — record the game playing itself, as a video you can actually watch.
 *
 * `play.mjs` answers "does it still work" and prints a PASS. It has never
 * answered "what does it look like", and for fourteen days the only person who
 * could see this game running was whoever had a browser open. That is a bad
 * position for a project whose next block is a playtest.
 *
 * Same autopilot as `play.mjs`, deliberately: the thing recorded is the thing
 * tested, not a second player written for the camera.
 *
 * Usage:
 *   node tools/watch.mjs
 *   node tools/watch.mjs --seconds 60 --view broadcast --difficulty tough
 *   node tools/watch.mjs --out /mnt/user-data/outputs/dink.mp4 --fps 30
 *
 * On the capture rate, because the first version of this comment guessed and was
 * wrong. The tool prints a retime factor, and that factor IS the measurement:
 * Playwright stamps frames at a nominal 25 fps, so a factor of 1.5 means 37 real
 * frames a second arrived. Measured here: about 37 fps at 1280 wide and about 43
 * at 800. Smooth enough to judge motion by, which matters, because a recording
 * that is choppy for its own reasons hides the ones that are the game's fault.
 */

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';
import { AUTOPILOT } from './autopilot.mjs';

const ROOT = '/home/claude/dink/dist';
const VIEWS = ['broadcast', 'side', 'top'];
const LEVELS = ['easy', 'steady', 'tough'];

const HELP = `watch — record the game playing itself.

  --seconds <n>      how long to record          (default 45)
  --view <v>         ${VIEWS.join(' | ')}   (default broadcast)
  --difficulty <d>   ${LEVELS.join(' | ')}      (default steady)
  --fps <n>          output frame rate           (default 24)
  --width <px>       capture width, 16:9          (default 1280)
  --out <path>       output file                 (default /mnt/user-data/outputs/dink-play.mp4)
  --demo             let the computer play the near end too (no keyboard)
  --doubles          two a side
  --keep-webm        keep the raw capture as well
  -h, --help         this

Example:
  node tools/watch.mjs --seconds 60 --view top --difficulty tough
`;

const parse = (argv) => {
  const o = { seconds: 45, view: 'broadcast', difficulty: 'steady', fps: 24, keepWebm: false };
  o.demo = false;
  o.doubles = false;
  // Fewer pixels, more frames — but less than expected: 1280 wide captured about
  // 37 frames a second and 800 wide about 43, not double. Software rendering was
  // not the bottleneck it looked like. Kept because it is free, and because
  // measuring it is what corrected the guess in the header.
  o.width = 1280;
  o.out = '/mnt/user-data/outputs/dink-play.mp4';
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--seconds') o.seconds = Number(val());
    else if (a === '--view') o.view = val();
    else if (a === '--difficulty') o.difficulty = val();
    else if (a === '--fps') o.fps = Number(val());
    else if (a === '--width') o.width = Number(val());
    else if (a === '--out') o.out = val();
    else if (a === '--demo') o.demo = true;
    else if (a === '--doubles') o.doubles = true;
    else if (a === '--keep-webm') o.keepWebm = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!VIEWS.includes(o.view)) throw new Error(`--view must be one of ${VIEWS.join(', ')}`);
  if (!LEVELS.includes(o.difficulty)) throw new Error(`--difficulty must be one of ${LEVELS.join(', ')}`);
  if (!(o.seconds > 0) || !(o.fps > 0)) throw new Error('--seconds and --fps must be positive');
  return o;
};

let opts;
try {
  opts = parse(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`watch: ${e.message}\n\n${HELP}`);
  process.exit(1);
}
if (opts.help) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (!existsSync(join(ROOT, 'index.html'))) {
  process.stderr.write('watch: dist/index.html missing; run `npm run build` first\n');
  process.exit(2);
}

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.map': 'application/json',
  '.css': 'text/css',
};
const srv = createServer((req, res) => {
  let p = join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith('/')) p += 'index.html';
  if (!existsSync(p)) {
    res.statusCode = 404;
    return res.end('nope');
  }
  res.setHeader('content-type', types[extname(p)] ?? 'application/octet-stream');
  res.end(readFileSync(p));
});
await new Promise((r) => srv.listen(4174, r));

const videoDir = '/tmp/dink-watch';
rmSync(videoDir, { recursive: true, force: true });
mkdirSync(videoDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const context = await browser.newContext({
  viewport: { width: opts.width, height: Math.round((opts.width * 9) / 16) },
  recordVideo: {
    dir: videoDir,
    size: { width: opts.width, height: Math.round((opts.width * 9) / 16) },
  },
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const query = [opts.demo ? 'demo=1' : '', opts.doubles ? 'doubles=1' : '']
  .filter(Boolean)
  .join('&');
await page.goto(`http://localhost:4174/index.html${query ? `?${query}` : ''}`, {
  waitUntil: 'networkidle',
});
await page.waitForTimeout(1200);

await page.click(`[data-difficulty="${opts.difficulty}"]`).catch(() => {});
await page.click(`[data-view="${opts.view}"]`).catch(() => {});
// Clicking a control scrolls the panel to it, which once cropped the scoreboard
// out of every capture.
await page.evaluate(() => {
  const panel = document.getElementById('panel');
  if (panel) panel.scrollTop = 0;
});
await page.addScriptTag({ content: AUTOPILOT });
if (opts.demo) {
  // The near end drives itself now. The autopilot stays loaded only to click
  // through the title and between-game cards; leaving its keys on would mean
  // two players fighting over one body, which is a thing this project has
  // already done once today in another form.
  await page.evaluate(() => {
    window.__autopilot.keys = false;
  });
}

process.stderr.write(`recording ${opts.seconds}s of ${opts.difficulty} from the ${opts.view} view\n`);
const startedAt = Date.now();
await page.waitForTimeout(opts.seconds * 1000);
const elapsed = (Date.now() - startedAt) / 1000;

const summary = await page.evaluate(() => ({
  ...window.__dink.state(),
  tally: window.__tally,
}));
const video = page.video();
await context.close();
await browser.close();
srv.close();

const webm = await video.path();
mkdirSync(join(opts.out, '..'), { recursive: true });

/**
 * Put the capture back on the clock.
 *
 * Playwright stamps every screencast frame at a fixed 25 fps no matter when it
 * arrived, so a headless page that renders unevenly comes out long: 40 seconds
 * of play arrived as a 75 second file, which is not slow motion, it is wrong.
 * The first cut of this tool shipped that and it looked like the game ran at
 * half speed. Rescaling by the ratio of wall clock to source duration makes the
 * output play at the speed the game actually ran.
 */
const sourceSeconds = Number(
  execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', webm],
    { encoding: 'utf8' },
  ).trim(),
);
const ratio = Number.isFinite(sourceSeconds) && sourceSeconds > 0 ? elapsed / sourceSeconds : 1;

try {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      webm,
      '-filter:v',
      `setpts=${ratio.toFixed(6)}*PTS,fps=${opts.fps}`,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      opts.out,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
} catch (e) {
  process.stderr.write(`watch: ffmpeg failed, keeping the raw capture\n${String(e.stderr ?? '')}\n`);
  renameSync(webm, opts.out.replace(/\.mp4$/, '.webm'));
  process.exit(3);
}
if (opts.keepWebm) renameSync(webm, opts.out.replace(/\.mp4$/, '.webm'));

process.stdout.write(
  `${opts.out}\n` +
    `  ${elapsed.toFixed(1)}s · ${opts.difficulty} · ${opts.view} · retimed x${(1 / ratio).toFixed(2)}\n` +
    `  score ${summary.match.score.near}-${summary.match.score.far}` +
    ` · games ${summary.games?.near ?? 0}-${summary.games?.far ?? 0}` +
    ` · ${summary.tally.swings} swings, ${summary.tally.serves} serves\n` +
    `  ${errors.length ? `${errors.length} page errors: ${errors[0]}` : 'no page errors'}\n`,
);
