/**
 * Plays a real game in a headless browser, through real keyboard events.
 *
 * This is the only test that exercises the whole path a player uses: DOM key
 * events, the input buffer, the fixed-step loop, the rally, the rules and the
 * renderer. The unit tests call stepRally directly and would not notice if the
 * keyboard were wired to nothing, or if the scoreboard never repainted.
 */
import { chromium } from 'playwright';
import { AUTOPILOT } from './autopilot.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const shotsDir = fileURLToPath(new URL('../artifacts/browser/', import.meta.url));
mkdirSync(shotsDir, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
// Use the same Playwright-managed browser locally and on GitHub Actions.
// Launch before listening so a missing browser cannot leave a server running.
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const srv = createServer((req, res) => {
  let p = join(root, decodeURIComponent(req.url.split('?')[0]));
  if (p.endsWith('/')) p += 'index.html';
  if (!existsSync(p)) { res.statusCode = 404; return res.end('x'); }
  res.setHeader('content-type', types[extname(p)] || 'application/octet-stream');
  res.end(readFileSync(p));
});
try {
await new Promise((resolve, reject) => {
  srv.once('error', reject);
  srv.listen(4176, '127.0.0.1', resolve);
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errs.push('CONSOLE ' + m.text());
});
await page.goto('http://127.0.0.1:4176/index.html', { waitUntil: 'networkidle' });
// The panel first, then the card, then the court. The title overlay covers the
// canvas, so clicking it before pressing Play fails — which is the overlay
// doing its job, and was worth finding here rather than in a bug report.
await page.waitForTimeout(300);
// Play the level a person most likely will. The gate below does not care who
// wins, but the run should exercise the difficulty path rather than the default
// happening to be whatever it is.
await page.evaluate(() => { document.getElementById('panel').scrollTop = 0; });
await page.screenshot({ path: join(shotsDir, '00-title-card.png') });
await page.click('[data-level="steady"]');
// Day 9 put a title card in front of the game, which is the right thing for a
// person and an immediate trap for a harness: the first version of this ran a
// full 75 seconds against a paused game and reported that the player never
// swung. Clicking Play through the real button is also the only thing that
// tests the button.
await page.click('#cardGo');
await page.click('#view');
await page.waitForTimeout(400);

if (!(await page.evaluate(() => typeof window.__dink?.state === 'function'))) {
  console.error('FAIL: the game exposes no debug state — the harness has nothing to read');
  await browser.close(); srv.close();
  process.exit(1);
}

/**
 * The autopilot runs inside the page, not in Playwright. Driving it from
 * outside meant a CDP round trip per key, which made the scripted player lag
 * by 300 ms and miss everything — it was measuring the harness, not the game.
 * In-page it still goes through the real window keyboard listeners.
 *
 * Its policy is the same one the unit test uses: stand behind where the ball
 * will be, wait out the two-bounce rule, and drive. Deliberately the same, so
 * the two tests disagree only about the layers between them.
 */
await page.addScriptTag({ content: AUTOPILOT });

/**
 * The controls, through the real DOM.
 *
 * Day 19 added a singles/doubles selector, a watch toggle and — as it turned
 * out — the first working mute button. The panel had listed mute and the M key
 * since Day 8 and neither had ever been connected to anything, which is a thing
 * a harness can only catch if it clicks the button and then asks the game
 * whether anything changed.
 */
const controlCheck = async () => {
  const read = () => page.evaluate(() => window.__dink.state());
  const out = {};

  await page.evaluate(() => { window.__autopilot.enabled = false; });
  await page.click('[data-mode="doubles"]');
  await page.waitForTimeout(300);
  out.doubles = await read();

  await page.click('#watch');
  await page.waitForTimeout(300);
  out.watching = await read();

  await page.click('#mute');
  await page.waitForTimeout(120);
  out.muted = (await read()).muted;

  await page.click('#mute');
  await page.waitForTimeout(120);
  out.unmuted = (await read()).muted;

  await page.click('[data-mode="singles"]');
  await page.click('#watch');
  await page.waitForTimeout(300);
  out.backToSingles = await read();

  /**
   * The career ladder, Day 22.
   *
   * Checked by clicking, for the reason Day 19 learned: a control that changes
   * nothing observable cannot be checked, and that is exactly how the mute
   * button stayed dead for eleven days while being drawn and documented.
   *
   * The assertion that matters is the difficulty: the challenge button is
   * supposed to start a match at the RIVAL's level, not at whatever is selected
   * in the panel. So the panel is deliberately set to `tough` first, and the
   * bottom rival is `easy` — if the two were the same, this would pass without
   * proving anything.
   */
  await page.click('[data-level="tough"]');
  await page.waitForTimeout(120);
  out.ladderRungs = await page.$$eval('.rung', (els) => els.length);
  out.challengeLabel = (await page.textContent('#challenge')).trim();
  await page.click('#challenge');
  await page.waitForTimeout(400);
  out.challengeDifficulty = (await read()).difficulty;
  await page.evaluate(() => { window.__autopilot.enabled = true; });
  return out;
};

const shots = [
  { at: 9000, view: 'broadcast', file: '01-match-behind' },
  { at: 18000, view: 'side', file: '02-match-side' },
  { at: 27000, view: 'top', file: '03-match-top' },
];
const t0 = Date.now();
for (const shot of shots) {
  const wait = shot.at - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.click(`[data-view="${shot.view}"]`);
  // Clicking a control scrolls the panel to it, which cropped the scoreboard
  // out of every screenshot the day the difficulty buttons were added.
  await page.evaluate(() => { document.getElementById('panel').scrollTop = 0; });
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(shotsDir, `${shot.file}.png`) });
}
await page.click('[data-view="broadcast"]');

// Pause and resume through the real key, because the overlay machinery is new
// and every other path to it needs a full game to finish. This also pins the
// thing that was wrong in the first version: pausing by stopping the loop let
// the accumulator fill, and resuming replayed the backlog in one frame.
await page.waitForTimeout(Math.max(0, 40000 - (Date.now() - t0)));
await page.evaluate(() => { window.__autopilot.enabled = false; });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const paused = await page.evaluate(() => ({
  screen: window.__dink.state().screen,
  showing: document.getElementById('overlay').classList.contains('show'),
  tick: window.__dink.state().tick,
}));
await page.waitForTimeout(1200);
const stillPaused = await page.evaluate(() => window.__dink.state().tick);
await page.evaluate(() => { document.getElementById('panel').scrollTop = 0; });
await page.screenshot({ path: join(shotsDir, '04-pause-card.png') });
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const resumed = await page.evaluate(() => window.__dink.state().screen);
await page.evaluate(() => { window.__autopilot.enabled = true; });

await page.waitForTimeout(Math.max(0, 75000 - (Date.now() - t0)));

const result = await page.evaluate(() => ({
  ...window.__tally,
  state: window.__dink.state(),
  scoreYou: document.getElementById('scoreYou').textContent,
  scoreOpp: document.getElementById('scoreOpp').textContent,
  banner: document.getElementById('banner').textContent,
  lastCall: document.getElementById('lastCall').textContent,
  plan: document.getElementById('planInfo').textContent,
  level: document.getElementById('levelInfo').textContent,
  mute: document.getElementById('mute').textContent,
  card: document.getElementById('cardTitle').textContent,
}));

const { score, phase } = result.state.match;
console.log(
  `${(75 / 1).toFixed(0)} s of scripted play: ${result.serves} serves, ${result.swings} rally ` +
  `swings, score ${score.near}-${score.far} (${phase})`,
);
console.log(`scoreboard reads ${result.scoreYou}-${result.scoreOpp} · "${result.banner}"` +
  (result.lastCall ? ` · "${result.lastCall}"` : ''));
console.log(`match: games ${result.state.games.near}-${result.state.games.far} · ` +
  `screen "${result.state.screen}" · card "${result.card}"`);
console.log(`opponent (${result.state.difficulty}): "${result.plan || '(none)'}" · holding ` +
  `${result.state.opponent.stance.toFixed(2)} m from the net · ${result.level}`);
// The simulation's step counter, not the ball's position. Position was the
// first version and it could pass for the wrong reason: the pause lands at a
// fixed forty seconds, which is as likely as not to catch the ball sitting
// still between points, and a resting ball does not move whether or not the
// game is paused. A tick counter that must not advance has no such loophole.
const frozen = paused.tick === stillPaused;
console.log(
  `pause: screen "${paused.screen}", card ${paused.showing ? 'shown' : 'MISSING'}, ` +
  `sim tick ${paused.tick} -> ${stillPaused} over 1.2 s ` +
  `(${frozen ? 'frozen' : 'STILL RUNNING'}), resumed to "${resumed}"`,
);
const controls = await controlCheck();
console.log(
  `controls: doubles put ${controls.doubles.onCourt} on court (mode "${controls.doubles.mode}") · ` +
  `watch ${controls.watching.watching ? 'on' : 'OFF'} · ` +
  `mute ${controls.muted ? 'on' : 'DEAD'} then ${controls.unmuted ? 'STUCK' : 'off'} · ` +
  `back to ${controls.backToSingles.mode} with ${controls.backToSingles.onCourt} on court\n` +
    `career: ${controls.ladderRungs} rungs · "${controls.challengeLabel}" started a match at ` +
    `${controls.challengeDifficulty}` +
    // The panel was set to `tough` immediately before the click. If the match
    // came up `tough`, the ladder is not choosing the opponent — the panel is.
    (controls.challengeDifficulty === 'tough' ? ' — LADDER IGNORED THE RIVAL' : ' (rival\'s own level)'),
);

console.log(errs.length ? errs.join('\n') : 'no page errors');

// What this gate is for: the keyboard reaching the sim, the rules advancing a
// score, the opponent making a decision, and the DOM showing all of it.
//
// It says nothing about who wins, and it never will. This autopilot runs on
// requestAnimationFrame in a software-rendered browser, which is about fifteen
// decisions a second against an opponent thinking at a hundred and twenty. It
// loses, and that is a fact about the harness. Judging the opponent's strength
// is `tools/tally.mjs`, which runs both players at the simulation rate.
const fail = (why) => { console.error('FAIL: ' + why); process.exitCode = 1; };
if (errs.length) fail('the page logged errors');
else if (result.serves < 1) fail('the scripted player never got a serve away');
else if (result.swings < 2) fail('the player never returned a ball');
else if (score.near + score.far < 2) fail('no points were scored in 75 seconds');
else if (result.scoreYou !== String(score.near) || result.scoreOpp !== String(score.far))
  fail(`the scoreboard (${result.scoreYou}-${result.scoreOpp}) disagrees with the match`);
// The opponent has to have made a decision, and it has to have been one of
// its real ones. An opponent that never chooses is the failure this catches:
// it would still return balls, and the score would still move.
else if (!result.plan) fail('the opponent never chose a shot');
else if (result.state.difficulty !== 'steady') fail('the difficulty selector did not take');
// The feel layer is mostly WebGL and Web Audio, which this harness cannot
// inspect — but it CAN prove none of it threw, because any page error fails the
// run above, and it can prove the audio context did not die on the first key.
else if (result.state.muted) fail('sound turned itself off');
else if (result.state.screen === 'title') fail('the title card never went away');
else if (paused.screen !== 'paused' || !paused.showing) fail('Escape did not pause');
else if (!frozen) fail('the world kept running while paused');
else if (resumed !== 'playing') fail('Escape did not resume');
// Day 19's controls, each one checked by clicking it and asking the game
// whether anything actually changed. The mute button had been drawn and
// documented since Day 8 with nothing listening to it, and no test could have
// caught that without pressing it.
else if (controls.doubles.onCourt !== 4) fail('the doubles button did not put four players on court');
else if (controls.doubles.mode !== 'doubles') fail('the doubles button did not take');
else if (!controls.watching.watching) fail('the watch toggle did not take');
else if (!controls.muted) fail('the mute button does nothing');
else if (controls.unmuted) fail('the mute button does not unmute');
else if (controls.backToSingles.onCourt !== 2) fail('singles did not go back to two players');
else console.log(`PASS: ${score.near + score.far} points played through the keyboard`);

} finally {
  await browser.close();
  srv.close();
}
