#!/usr/bin/env node
/**
 * shot — still frames of the game, for the README and for looking at models.
 *
 * Replaced on Day 16. The old version had been shooting `dropLine`,
 * `dropCross` and `dropMiddle` since Day 3, which were sandbox scenes that
 * stopped existing on Day 4 — so it had been silently photographing a game that
 * was not there for twelve days. Nothing used the output, which is why nobody
 * noticed, and which is the argument for deleting a tool rather than leaving it.
 *
 * Usage:
 *   node tools/shot.mjs
 *   node tools/shot.mjs --doubles --out /tmp
 */

import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = '/home/claude/dink/dist';
const opts = { out: '/home/claude/dink/docs/shots', doubles: false, demo: true, settle: 4000 };
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i];
  if (a === '--out') opts.out = process.argv[(i += 1)];
  else if (a === '--doubles') opts.doubles = true;
  else if (a === '--singles') opts.doubles = false;
  else if (a === '-h' || a === '--help') {
    process.stdout.write('shot — still frames.\n\n  --out <dir>   where to write\n  --doubles     four players\n');
    process.exit(0);
  } else {
    process.stderr.write(`shot: unknown argument ${a}\n`);
    process.exit(1);
  }
}
if (!existsSync(join(ROOT, 'index.html'))) {
  process.stderr.write('shot: dist/index.html missing; run `npm run build` first\n');
  process.exit(2);
}

const types = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json', '.css': 'text/css' };
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
await new Promise((r) => srv.listen(4176, r));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const query = [opts.demo ? 'demo=1' : '', opts.doubles ? 'doubles=1' : ''].filter(Boolean).join('&');
await page.goto(`http://localhost:4176/index.html${query ? `?${query}` : ''}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.click('#cardGo').catch(() => {});
await page.waitForTimeout(opts.settle);

mkdirSync(opts.out, { recursive: true });
const kind = opts.doubles ? 'doubles' : 'singles';
for (const view of ['broadcast', 'side', 'top']) {
  await page.click(`[data-view="${view}"]`).catch(() => {});
  // Clicking a control scrolls the panel to it, which once cropped the
  // scoreboard out of every screenshot.
  await page.evaluate(() => {
    const panel = document.getElementById('panel');
    if (panel) panel.scrollTop = 0;
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(opts.out, `${kind}-${view}.png`) });
  process.stdout.write(`${join(opts.out, `${kind}-${view}.png`)}\n`);
}
await browser.close();
srv.close();
if (errors.length) {
  process.stderr.write(`shot: ${errors.length} page errors, first: ${errors[0]}\n`);
  process.exit(3);
}
