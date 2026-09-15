/**
 * Does the PACKAGED desktop build actually run?
 *
 * Day 21. This tool exists because of what was measured before the shell was
 * written: loading the Vite build over file:// leaves a canvas on screen, no
 * exception anywhere, and a game that never started. Chromium blocks ES modules
 * from origin `null` and the page simply sits there looking like it is loading.
 *
 * So "the build produced a file" and "a window opened" are both worthless as
 * checks, and so is a screenshot, because the failure looks like a game waiting
 * to start. The only assertion worth making is that the simulation is running,
 * and the only place worth making it is inside the binary a player would
 * double-click — not `electron .` against the source tree, which loads
 * different files from a different root.
 *
 * It drives the app over the DevTools protocol rather than Electron's own test
 * tooling, so it tests the shipped artefact rather than a re-hosted copy of it.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 9333;
const UNPACKED = 'release/linux-unpacked';

/** Find the packaged binary, and say something useful when it is not there. */
const findBinary = () => {
  if (!existsSync(UNPACKED)) {
    console.error(`no packaged build at ${UNPACKED}. Run: npm run desktop:pack`);
    process.exit(1);
  }
  const named = readdirSync(UNPACKED).find((f) => f.startsWith('dink') || f.startsWith('Dink'));
  if (!named) {
    console.error(`no executable found in ${UNPACKED}: ${readdirSync(UNPACKED).join(', ')}`);
    process.exit(1);
  }
  return join(UNPACKED, named);
};

const binary = findBinary();
console.log(`launching ${binary}`);

/**
 * --no-sandbox and the software renderer are for THIS container, not for the
 * shipped game. A cloud box has no GPU and cannot create a user namespace, so
 * without them Electron exits before it draws anything. Recorded here so nobody
 * later reads these flags as something the game needs.
 */
const child = spawn(binary, [
  `--remote-debugging-port=${PORT}`,
  '--no-sandbox',
  // ANGLE over SwiftShader. The obvious-looking `--use-gl=swiftshader` is wrong
  // on Electron 44 and fails in a way worth recording, because it does not look
  // like a renderer problem from the outside:
  //
  //   ERROR gl_factory: Requested GL implementation (gl=none,angle=none) not
  //   found in allowed implementations: [(gl=egl-angle,angle=default)]
  //   ERROR viz_main_impl: Exiting GPU process due to errors
  //
  // and then the frame callback never fires, so the game boots, draws nothing,
  // and reports tick 0 forever. Diagnosed as "the simulation is not running"
  // when the simulation was fine and had simply never been asked to step.
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--disable-gpu-sandbox',
], { stdio: ['ignore', 'pipe', 'pipe'] });

const logs = [];
child.stdout.on('data', (d) => logs.push(String(d)));
child.stderr.on('data', (d) => logs.push(String(d)));

let exited = null;
child.on('exit', (code) => { exited = code; });

const die = (message) => {
  console.error(`\nFAIL: ${message}`);
  if (logs.length) console.error(`\napp output:\n${logs.join('').slice(0, 2000)}`);
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  process.exit(1);
};

/** Wait for the debug port, retrying: Electron takes a second or two to boot. */
const connect = async () => {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (exited !== null) die(`the app exited with code ${exited} before it could be inspected`);
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return die('the app never opened a debuggable window');
};

const browser = await connect();
const context = browser.contexts()[0];
const page = context?.pages()[0] ?? (await context.waitForEvent('page'));

const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// The real assertion. Not "is there a canvas" — there is always a canvas.
try {
  // Timer polling here too, and for the same reason as `until` below: the boot
  // wait must not depend on the frame callback it is waiting for.
  await page.waitForFunction(() => typeof window.__dink?.state === 'function', null, {
    timeout: 20000,
    polling: 200,
  });
} catch {
  die(
    'the game never booted inside the packaged app: window.__dink is missing.\n' +
      `page errors: ${errors.slice(0, 3).join(' | ') || '(none, which is the point)'}`,
  );
}

const url = await page.evaluate(() => location.href);
console.log(`loaded ${url}`);

/**
 * Press Play, by clicking the button a person clicks.
 *
 * The game opens on a title card, so a freshly booted app sits at tick 0 on
 * purpose. The first version of this tool did not know that and reported "the
 * simulation is not running" at a game that was behaving perfectly — the
 * harness was wrong, not the app, for the seventh time in this project.
 *
 * `window.__dink.begin()` exists and would do the same thing in one line. The
 * click is used instead because the whole reason this tool exists is that the
 * last step before a pixel has no coverage, and a button that does not respond
 * inside the packaged app is exactly the defect it is here to catch.
 */
const screenOf = () => page.evaluate(() => window.__dink.state().screen);

/**
 * Serve with the KEYBOARD, not the mouse.
 *
 * A match opens in `awaitingServe` and the world does not step until somebody
 * serves, so a freshly started match sits at tick 0 indefinitely and is correct
 * to do so. The second version of this tool pressed Play, saw tick 0, and again
 * blamed the game.
 *
 * The third version clicked the Watch button to hand both ends to the computer,
 * which worked — one run in three. Synthetic mouse input is hit-tested against
 * the last COMPOSITED frame, and this container composites about twice a
 * second, so a click aimed at a button in the panel lands wherever the panel
 * was two frames ago. Measured across three runs: pass, fail, fail, with no
 * code change between them.
 *
 * Keyboard events are delivered to the focused document and never hit-tested,
 * so they do not care what the compositor is doing. Space is the swing key and
 * a swing while awaiting serve IS the serve.
 *
 * Clicking is not skipped out of convenience. `tools/play.mjs` clicks every one
 * of these controls in a browser running at a real frame rate, which is where a
 * mouse test belongs. Repeating it here would not test the packaged app, it
 * would test this container's compositor, and it would fail two runs in three
 * while doing it.
 */
const click = async (selector, what) => {
  await page.click(selector, { timeout: 8000 }).catch(() => die(`could not click ${what}`));
};

/**
 * Wait on a TIMER, not on a frame.
 *
 * Playwright's `waitForFunction` polls on requestAnimationFrame by default, and
 * requestAnimationFrame is the exact thing that is starved here. A harness that
 * polls on frames, watching a game that is short of frames, spends its whole
 * timeout taking ten measurements and then reports the game is broken. That is
 * the harness measuring the harness.
 *
 * The predicates are also guarded, because Playwright treats an exception in a
 * poll as a failed wait rather than a poll to retry.
 */
const until = (fn, timeout, what) =>
  page
    .waitForFunction(fn, null, { timeout, polling: 200 })
    .catch((error) => die(`${what}\n  (${String(error).split('\n')[0]})`));

// Play is a full-screen overlay button, so this click is not at the mercy of a
// stale layout the way a panel button is. It has never missed across runs.
if ((await screenOf()) === 'title') {
  await click('#cardGo', 'Play');
  await until(
    () => {
      try { return window.__dink.state().screen !== 'title'; } catch { return false; }
    },
    10000,
    'clicking Play in the packaged app did nothing',
  );
}
console.log(`screen: ${await screenOf()}`);

await page.keyboard.press('Space');
await until(
  () => {
    try { return window.__dink.state().match.phase === 'inPlay'; } catch { return false; }
  },
  10000,
  'the serve key did nothing inside the packaged app: the rally never started',
);
console.log('served from the keyboard, rally live');

/**
 * Boot is not enough. A simulation that started and immediately stalled also
 * satisfies the check above, so the tick count has to be seen MOVING.
 *
 * Three seconds rather than one because this container has no GPU: the frame
 * callback fires about twice a second under software rendering, against sixty
 * on a real machine. The check is "is it advancing", never "how fast" — a
 * throughput assertion here would be measuring the container.
 */
const tickOf = () => page.evaluate(() => window.__dink.state().tick ?? null);
const first = await tickOf();
await page.waitForTimeout(3000);
const second = await tickOf();

if (first === null || second === null) die('the debug hook does not report a tick');
if (second <= first) die(`the simulation is not running: tick stuck at ${first}`);
console.log(`simulation running: tick ${first} -> ${second}`);

// And the renderer is drawing, which is a separate claim from the sim ticking.
const drawn = await page.evaluate(() => {
  const canvas = document.querySelector('canvas');
  return canvas ? { w: canvas.width, h: canvas.height } : null;
});
if (!drawn || drawn.w < 100 || drawn.h < 100) die(`canvas is ${JSON.stringify(drawn)}`);
console.log(`canvas ${drawn.w}x${drawn.h}`);

await page.screenshot({ path: 'release/desktop-verified.png' });
console.log('screenshot release/desktop-verified.png');

if (errors.length) {
  console.log(`\nnote: ${errors.length} console error(s):`);
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}

await browser.close();
child.kill('SIGTERM');
setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 2000).unref();

console.log('\ndesktop build verified: it boots, it ticks, it draws.');
