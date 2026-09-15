/**
 * The autopilot: a scripted player that runs INSIDE the page.
 *
 * Extracted on Day 15 so that `play.mjs` (does it still work?) and `watch.mjs`
 * (what does it look like?) drive the game with the same hands. Two copies of a
 * hundred-line player is how the two harnesses quietly start measuring
 * different games, which is a mistake this project has made three times in
 * other places.
 *
 * It is a string rather than a module because it is injected with
 * `page.addScriptTag`. Driving it from Playwright instead meant a CDP round
 * trip per key, which lagged the scripted player by 300 ms and missed
 * everything: it was measuring the harness, not the game.
 */
export const AUTOPILOT = String.raw`
window.__tally = { swings: 0, serves: 0, ticks: 0, stalls: 0 };
// The harness switches this off around the pause check. Without it the
// autopilot presses straight through the pause card in the next frame, and the
// check reads "not paused" — measuring the harness fighting itself, which is a
// mistake this file has made before.
window.__autopilot = { enabled: true, keys: true };
(function autopilot() {
  const held = new Set();
  const send = (type, code) =>
    window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
  const hold = (code, want) => {
    if (want && !held.has(code)) { held.add(code); send('keydown', code); }
    else if (!want && held.has(code)) { held.delete(code); send('keyup', code); }
  };
  const tap = (code) => { send('keydown', code); send('keyup', code); };
  // Cooldowns are in seconds, not frames. A headless browser runs at about
  // fifteen frames a second and a real one at sixty; a frame counter meant the
  // scripted player waited four times too long here and swung wildly there.
  let cooldownUntil = 0;
  let prev = null;
  const READY_Z = 4.6;
  const LEAD = 0.16;

  function tick() {
    requestAnimationFrame(tick);
    const s = window.__dink.state();
    window.__tally.ticks += 1;

    // Between games and at the end of a match a card covers the court. Press on
    // through it, because a match is what this now measures.
    if (s.screen !== 'playing') {
      hold('KeyW', false); hold('KeyS', false); hold('KeyA', false); hold('KeyD', false);
      if (window.__autopilot.enabled && performance.now() > cooldownUntil) {
        document.getElementById('cardGo').click();
        cooldownUntil = performance.now() + 500;
      }
      return;
    }

    // With keys off, the near end is driven by its own brain (demo mode) and
    // this loop is only here to click through cards. No backticks in here: the
    // whole file is one String.raw template and a backtick ends it.
    if (!window.__autopilot.keys) return;

    // Serve when it is your serve. Everything else waits for the ball.
    if (s.match.phase === 'awaitingServe') {
      prev = null;
      if (s.match.server === 'near' && performance.now() > cooldownUntil) {
        tap('Space'); window.__tally.serves += 1; cooldownUntil = performance.now() + 400;
      }
      return;
    }

    // Differencing the position gives a velocity without the game handing one
    // over; leading by a windup is what a person does starting a swing early.
    const now = performance.now() / 1000;
    let vx = 0, vy = 0, vz = 0;
    if (prev && now > prev.t) {
      const dt = now - prev.t;
      vx = (s.ball.x - prev.x) / dt; vy = (s.ball.y - prev.y) / dt; vz = (s.ball.z - prev.z) / dt;
    }
    prev = { t: now, x: s.ball.x, y: s.ball.y, z: s.ball.z };
    const fx = s.ball.x + vx * LEAD;
    const fy = s.ball.y + vy * LEAD - 4.9 * LEAD * LEAD;
    const fz = s.ball.z + vz * LEAD;

    const mine = s.ball.z > 0.4 && !s.ball.resting;
    const mustLet = s.match.hits < 3 && s.match.bounces === 0;

    // Stand behind where the ball can be met, not where it is. The first
    // version chased the ball's current position and was permanently half a
    // metre late, which at a headless frame rate meant it never once got
    // inside reach. The intercept is what the ring on court shows a human.
    const meet = s.intercept;
    const tx = meet ? meet.x : mine ? fx : 0;
    const tz = meet
      ? Math.max(1.5, Math.min(6.4, meet.z + 0.45))
      : mine ? Math.max(1.5, Math.min(6.4, fz + 0.45)) : READY_Z;
    hold('KeyD', tx - s.you.x > 0.12);
    hold('KeyA', tx - s.you.x < -0.12);
    hold('KeyS', tz - s.you.z > 0.15);
    hold('KeyW', tz - s.you.z < -0.15);

    const d = Math.hypot(fx - s.you.x, fz - s.you.z);
    if (mine && !mustLet && s.you.phase === 'ready' && performance.now() > cooldownUntil &&
        d < 1.0 && fy > 0.3 && fy < 1.6) {
      tap('Space');
      window.__tally.swings += 1;
      cooldownUntil = performance.now() + 250;
    }
  }
  tick();
})();
`;
