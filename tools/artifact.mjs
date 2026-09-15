#!/usr/bin/env node
/**
 * artifact — does the build people actually play still draw a game?
 *
 * Day 26, and it exists because of Day 25. The published artifact could not
 * compile `MeshStandardMaterial` for twenty-five days, so no player was ever
 * drawn in it, and the bug was reported twice by a person before anything in
 * this repository noticed. Nothing in this repository *could* have noticed:
 * the tests, `npm run shots`, `npm run watch`, the browser harness and the
 * desktop verifier all run against `dist`. The artifact is a separate build
 * with its own transformations, and it had no check at all.
 *
 * `tools/desktop.mjs` does this job for the packaged binary. This is the same
 * discipline pointed at the other shipped artefact.
 *
 * ---------------------------------------------------------------------------
 * The assertion that matters, and the four that do not
 *
 * Yesterday's defect satisfied every cheap check:
 *
 *   the page loads               it did
 *   window.__dink exists         it did
 *   the tick advances            it did, the simulation was fine
 *   a canvas of the right size   it was there, drawing a court
 *
 * A screenshot looked like a game. So the check has to be about the thing that
 * was actually missing: **a person on screen**.
 *
 * And it must NOT use `?silhouette=1` to find them. That flag swaps every
 * player material for `MeshBasicMaterial`, which needs no shader chunks and
 * compiled perfectly well on the broken build — a silhouette-based pixel count
 * would have passed, in green, on an artifact with no players in it. The one
 * tool that looks most suited to the job is the one that cannot do it.
 *
 * So the count runs in normal mode, against the real `MeshStandardMaterial`
 * path, and looks for the one thing only a player can put on screen: WARM
 * pixels. The court is blue, the surround is green, the lines are neutral
 * white. Skin and the far kit are the only strongly red-over-blue surfaces in
 * the scene.
 * ---------------------------------------------------------------------------
 *
 * Usage:
 *   node tools/artifact.mjs                      # the current dink-artifact.html
 *   node tools/artifact.mjs --file path.html     # any artifact
 *   node tools/artifact.mjs --expect-broken      # falsification: demand failure
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const parse = (argv) => {
  const o = { file: '/home/claude/dink-artifact.html', expectBroken: false, port: 4321 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--file') o.file = argv[++i];
    else if (a === '--expect-broken') o.expectBroken = true;
    else if (a === '--port') o.port = Number(argv[++i]);
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
};

let opts;
try {
  opts = parse(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`artifact: ${e.message}\n`);
  process.exit(1);
}
if (opts.help) {
  process.stdout.write(
    'artifact — does the published build still draw a game.\n\n' +
      '  --file <path>      artifact html (default /home/claude/dink-artifact.html)\n' +
      '  --expect-broken    invert: pass only if the check FAILS. For falsifying.\n',
  );
  process.exit(0);
}

if (!existsSync(opts.file)) {
  process.stderr.write(`artifact: no such file ${opts.file}\n`);
  process.exit(1);
}

/**
 * Wrap the artifact in the skeleton the publish target adds.
 *
 * `ship.mjs` deliberately strips the doctype, head and charset because the
 * publish target supplies its own. Serving the bare file would test something
 * nobody is ever served — in particular the missing charset turns every em dash
 * into mojibake, which is a bug in the harness rather than in the artifact.
 */
const SKELETON_HEAD =
  '<!doctype html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<style>:root{color-scheme:light}body{margin:0}</style></head><body>';

const page = `${SKELETON_HEAD}\n${readFileSync(opts.file, 'utf8')}\n</body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page);
});
await new Promise((r) => server.listen(opts.port, '127.0.0.1', r));

const outDir = join(tmpdir(), 'dink-artifact-check');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: [
    // The software renderer, for this container only. A real player has a GPU.
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
  ],
});

const failures = [];
const note = (message) => failures.push(message);

const tab = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const consoleErrors = [];
tab.on('pageerror', (e) => consoleErrors.push(String(e.message).slice(0, 200)));
tab.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
});

await tab.goto(`http://127.0.0.1:${opts.port}/`);

try {
  // Timer polling, not rAF: a software renderer is short of frames, and a
  // harness that polls on the thing it is waiting for measures itself.
  await tab.waitForFunction(() => typeof window.__dink?.state === 'function', null, {
    timeout: 25000,
    polling: 200,
  });
} catch {
  note('the game never booted: window.__dink is missing');
}

await tab.click('#cardGo').catch(() => note('could not press Play'));
// Serve from the keyboard. Synthetic clicks are hit-tested against the last
// composited frame and this container composites about twice a second; keyboard
// events are delivered to the focused document and never hit-tested.
await tab.keyboard.press('Space');
await tab.waitForTimeout(2500);

const state = await tab.evaluate(() => {
  try {
    const s = window.__dink.state();
    return { tick: s.tick, screen: s.screen };
  } catch {
    return null;
  }
});
if (!state) note('the debug hook stopped answering');
else if (state.tick <= 0) note(`the simulation never stepped (tick ${state.tick})`);

/**
 * Count the pixels only a player can produce.
 *
 * From the SCREENSHOT, not from the canvas. The first version read the canvas
 * back in the page — `drawImage` it onto a 2D context and walk the data — and
 * it reported **0 warm pixels on a build whose players were plainly visible**.
 *
 * A WebGL drawing buffer is not readable after the frame that drew it unless
 * the context was created with `preserveDrawingBuffer: true`, and Three.js
 * leaves that off by default for good performance reasons. So the readback got
 * a cleared buffer and the harness confidently reported the exact defect it was
 * built to detect, on a build that did not have it.
 *
 * A false positive is the more dangerous direction here. A check that cries
 * wolf gets switched off, and then the real thing ships.
 *
 * The discriminator is `r - b > 40 AND r < 225`, and both halves were measured
 * rather than reasoned. `r - b > 40` alone is warmth, and warmth alone is not
 * enough: the paddle face (240,217,168), the ball (255,217,74) and the shot
 * trail are all warm, and on the broken build they came to 450 pixels against a
 * working build's 1,414. A 3x gap is not a check, it is a coin toss with extra
 * steps.
 *
 * `r < 225` throws away the bright ones. The paddle face and the ball are pale;
 * skin (199,154,114) and the far kit (217,139,106) are not. Measured:
 *
 *   working   1,112 skin pixels
 *   broken       57
 *
 * Twenty times apart, which is a check.
 *
 * CLIPPED TO THE CANVAS, and that correction matters more than the metric. The
 * first version screenshotted the whole viewport and counted 4,886 warm pixels
 * on the deliberately broken build — comfortably over the floor, passing. The
 * warm pixels were the SIDE PANEL: the amber accent on every "BANGER" label, the
 * Play button, the pressure bar. The check was measuring the user interface and
 * calling it a player.
 *
 * It survived because the broken build also logged a console error, so the tool
 * failed for the right reason by accident and the pixel count was never examined.
 * That is how a harness ends up with a metric nobody has ever seen move.
 */
const box = await tab.evaluate(() => {
  const c = document.querySelector('canvas');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
});
if (!box) note('no canvas on the page');
const shot = join(outDir, 'artifact.png');
await tab.screenshot(box ? { path: shot, clip: box } : { path: shot });

const warm = await new Promise((resolve) => {
  const py = spawn('python3', [
    '-c',
    'import sys;from PIL import Image;import numpy as np;' +
      'a=np.array(Image.open(sys.argv[1]).convert("RGB")).astype(int);' +
      'r,b=a[:,:,0],a[:,:,2];print(int((((r-b)>40)&(r<225)).sum()))',
    shot,
  ]);
  let out = '';
  py.stdout.on('data', (d) => (out += d));
  py.on('close', (code) => resolve(code === 0 ? { count: Number(out.trim()) } : null));
});

/**
 * MEASURED on both builds, inside the canvas only. Written after the numbers.
 *
 *   working artifact   see the run output
 *   broken artifact    the ball, and nothing else
 *
 * The floor sits far below a real frame and far above one containing no people.
 * If the render ever drifts near it, the right response is to re-measure and
 * move it deliberately, never to widen it until the check stops complaining.
 */
const WARM_FLOOR = 300;

if (!warm) note('could not measure the frame (python3 or Pillow missing)');
else if (warm.count < WARM_FLOOR) {
  note(
    `only ${warm.count} skin pixels on the court (floor ${WARM_FLOOR}) — ` +
      'the court is drawing and the players are not',
  );
}

if (consoleErrors.length) {
  note(`${consoleErrors.length} console error(s): ${consoleErrors[0]}`);
}

await browser.close();
server.close();

// ---------------------------------------------------------------------------

const ok = failures.length === 0;
const size = (readFileSync(opts.file).length / 1024 / 1024).toFixed(2);

if (opts.expectBroken) {
  // Falsification mode. A check that has never failed is a check nobody has
  // shown can fail, and this project has shipped six harnesses that passed for
  // the wrong reason.
  if (ok) {
    process.stdout.write(
      'FALSIFICATION FAILED: the artifact was deliberately broken and the check passed.\n' +
        'Everything this tool reports is worthless until that is fixed.\n',
    );
    process.exit(1);
  }
  process.stdout.write(`falsification ok: the broken artifact was rejected\n  ${failures[0]}\n`);
  process.exit(0);
}

process.stdout.write(`artifact ${opts.file} (${size} MB)\n`);
if (ok) {
  process.stdout.write(
    `  screen ${state.screen}, tick ${state.tick}, ${warm.count} skin pixels, no console errors\n` +
      '  the published build boots, ticks, and draws people.\n',
  );
  process.exit(0);
}
process.stdout.write('\nFAIL\n');
for (const f of failures) process.stdout.write(`  ${f}\n`);
process.stdout.write(`\nscreenshot ${join(outDir, 'artifact.png')}\n`);
process.exit(1);
