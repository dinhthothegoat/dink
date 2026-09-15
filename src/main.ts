import { GameLoop } from './core/loop';
import { attachControls } from './core/input';
import * as C from './sim/constants';
import { interceptPoint } from './sim/intercept';
import { faceNormal } from './sim/paddle';
import { Difficulty, LEVELS, setDifficulty } from './sim/opponent';
import { Recorder, REPLAY_VERSION, newSeed } from './core/replay';
import { STYLES } from './sim/style';
import {
  Career,
  LADDER,
  isChampion,
  loadCareer,
  nextOpponent,
  recordMatch,
  saveCareer,
  styleFor,
} from './core/career';
import { Rally, createRally, paddleAt, stepRally } from './sim/rally';
import { interpolatedPlayer } from './sim/player';
import { Mode, loadSettings, saveSettings, teamSizeOf } from './core/settings';
import {
  Series,
  coverage,
  createSeries,
  mishitRate,
  nextGame,
  nextServer,
  observe,
} from './sim/series';
import { Fault, callScore, serveBox } from './sim/rules';
import { targetFor, warmUp } from './sim/solver';

/**
 * The aim, as a phrase.
 *
 * The dead zone is 0.2 rather than 0 so that "middle" survives the moment after
 * a key is released, while the ramp is still unwinding. Without it the readout
 * flickers through three words on the way back to centre, which draws the eye to
 * the panel at exactly the moment the ball needs it — and the playtest protocol
 * counts every glance at the panel as a finding.
 */
const aimWords = (x: number, z: number): string => {
  const across = x < -0.2 ? 'left' : x > 0.2 ? 'right' : 'middle';
  const along = z < -0.2 ? 'short' : z > 0.2 ? 'deep' : '';
  return along ? `${across}, ${along}` : across;
};
import { v3, set } from './sim/vec3';
import { interpolatedPosition, predictBall } from './sim/world';
import { CameraView, createRenderer } from './render/scene';
import { createSound } from './render/sound';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = createRenderer(canvas);
const controls = attachControls();
const sound = createSound();
renderer.paddle.showPathArrow(false);

// Browsers will not start an audio context outside a user gesture, and one
// created too early lands suspended and stays there — silence, with no error
// anywhere. So the first key or click the player makes is what starts it.
const wake = (): void => sound.unlock();
window.addEventListener('keydown', wake, { once: true });
canvas.addEventListener('pointerdown', wake, { once: true });

let series: Series = createSeries(3);
/**
 * What the player chose, last time or in the URL.
 *
 * Doubles and watch mode were URL flags from Day 16 to Day 18, because the
 * rules and the partners were real and the interface for them was not. Four
 * days of doubles work reachable only by typing `?doubles=1` is work nobody can
 * use, so Day 19 gives them buttons — and the URL still wins when it is
 * present, because `tools/watch.mjs` and `tools/shot.mjs` drive the game that
 * way and a recording harness should not depend on what somebody last clicked.
 */
const params = new URLSearchParams(location.search);
const saved = loadSettings();
if (params.get('doubles') === '1') saved.mode = 'doubles';
if (params.get('demo') === '1') saved.watch = true;

let mode: Mode = saved.mode;
let watching = saved.watch;
let level: Difficulty = saved.difficulty;

/**
 * The ladder, and whether the match on court is a ladder match.
 *
 * `challenging` is the rival this match counts against, or null for a friendly.
 * It is captured when the match STARTS rather than read from the career when it
 * ends, because winning changes the career's idea of who is next — reading it
 * at the end would credit the win to the wrong person, which is the same
 * commit-once shape as ball ownership on Day 15 and `readOff` on Day 6.
 */
let career: Career = loadCareer();
let challenging: string | null = null;

/**
 * The match being recorded, and the seed that makes it reproducible.
 *
 * Day 23. `createRally` has taken a seed since Day 16 and nothing had ever
 * passed one, so every match the game has ever played ran on seed 0: the
 * opponent's random stream was byte-identical from the first serve of every
 * match, in every session, on every install. The same mis-hit on the same ball
 * every time somebody pressed Rematch.
 *
 * It survived because determinism is a virtue in this project and "the same
 * every time" reads as the system working. It is the difference between
 * reproducible and identical, and the replay recorder forced the distinction:
 * to replay a match you have to admit the match had a seed.
 */
let recorder: Recorder | null = null;

let rally: Rally = createRally('near', level, teamSizeOf(mode), watching);
let currentView: CameraView = saved.view;

/** Write the whole of it back, whenever any of it changes. */
const remember = (): void =>
  saveSettings({
    difficulty: level,
    mode,
    watch: watching,
    view: currentView,
    speed: loop.speed(),
    muted: sound.muted(),
  });

/**
 * What the game is doing when it is not playing.
 *
 * The loop keeps running in every one of these — the camera still settles, the
 * ball still sits where it landed — but `fixedUpdate` steps nothing unless the
 * state is `playing`. Pausing by stopping the loop was the first version and it
 * was wrong: the accumulator kept filling, so unpausing replayed every missed
 * tick at once and the ball teleported.
 */
type Screen = 'title' | 'playing' | 'paused' | 'betweenGames' | 'matchOver';
let screen: Screen = 'title';

const out = (id: string) => document.getElementById(id) as HTMLElement;

/**
 * Stamp the build's own version into the panel.
 *
 * Day 21: the packaged desktop build proudly reported v1.1 while being v1.2.1,
 * because the string was typed into index.html on Day 11 and nothing ever had
 * cause to read it again. A wrong version number is worse than none — it makes
 * every bug report against a downloaded build point at the wrong code.
 */
out('version').textContent = `v${__APP_VERSION__}`;

/** What the umpire says, in the words a player would actually hear. */
const CALL: Record<Fault, string> = {
  'serve into net': 'serve into the net',
  'serve out': 'serve long',
  'serve wrong box': 'wrong box',
  'serve into kitchen': 'serve in the kitchen',
  'into net': 'into the net',
  out: 'out',
  'double bounce': 'two bounces',
  'volleyed too early': 'volleyed too early',
  'volley in the kitchen': 'volleyed in the kitchen',
  missed: 'missed',
};

let banner = '';
let bannerTone: 'ok' | 'bad' | 'idle' = 'idle';

const setBanner = (text: string, tone: 'ok' | 'bad' | 'idle'): void => {
  if (text === banner && tone === bannerTone) return;
  banner = text;
  bannerTone = tone;
  out('banner').textContent = text;
  out('banner').className = `banner ${tone}`;
};

const refreshGames = (): void => {
  const pips = (n: number, cls: string) => `<b class="${cls}"></b>`.repeat(n);
  const blank = series.needed * 2 - 1 - series.games.near - series.games.far;
  out('gamesInfo').innerHTML =
    `best of ${series.needed * 2 - 1} ` +
    pips(series.games.near, 'you') +
    pips(series.games.far, 'opp') +
    pips(Math.max(0, blank), '');
};

/**
 * The ladder, drawn.
 *
 * Rank order top to bottom, the player's own rung shown in place among them,
 * and one line of scouting on whoever is next. The scouting line is the part
 * that matters: a named rival is only worth naming if you can learn something
 * about them, and the thing you learn has to arrive BEFORE the first point
 * rather than after the third game.
 */
const refreshCareer = (): void => {
  const next = nextOpponent(career);
  const rows: string[] = [];
  for (let rank = 1; rank <= LADDER.length + 1; rank += 1) {
    if (rank === career.rank) {
      rows.push(`<div class="rung you"><b>${rank}</b><span>You</span><i></i></div>`);
      continue;
    }
    const r = LADDER[rank - 1];
    if (!r) continue;
    const rec = career.results[r.id];
    const tally = rec ? `${rec.won}-${rec.lost}` : '';
    const cls = next && r.id === next.id ? 'rung next' : 'rung';
    rows.push(
      `<div class="${cls}"><b>${rank}</b><span>${r.name}</span><i>${r.styleName}</i>` +
        `<em>${tally}</em></div>`,
    );
  }
  out('ladder').innerHTML = rows.join('');

  const button = out('challenge') as HTMLButtonElement;
  if (isChampion(career)) {
    out('scouting').textContent = 'Top of the ladder. Nobody left to beat.';
    button.disabled = true;
    button.textContent = 'Champion';
  } else if (next) {
    out('scouting').innerHTML = `<b>${next.name}</b> · ${next.difficulty} · ${next.blurb}`;
    button.disabled = false;
    button.textContent = `Play ${next.name}`;
  }
};

const refreshScore = (): void => {
  const { match } = rally;
  out('scoreYou').textContent = String(match.score.near);
  out('scoreOpp').textContent = String(match.score.far);
  out('serveYou').classList.toggle('on', match.server === 'near');
  out('serveOpp').classList.toggle('on', match.server === 'far');
  out('boxInfo').textContent =
    match.phase === 'gameOver'
      ? 'game over'
      : // Doubles calls three numbers and the third one is not decoration: it
        // says whether the next fault ends the service turn, which is the whole
        // of what the receiving pair is planning around.
        `${match.server === 'near' ? 'your serve' : 'their serve'} · ${serveBox(match)} box` +
        (match.teamSize === 2 ? ` · server ${match.serverNumber} · ${callScore(match)}` : '');
  refreshGames();
};

/* ---------------------------------------------------------------------------
 * The card between games.
 *
 * What it says is the point of it. "You lost 11-7" tells a player nothing they
 * can act on; whether they were losing rallies by not getting there or by not
 * striking cleanly are different problems with different fixes, and Day 7 spent
 * a day learning that those two numbers have to be kept apart. So the card
 * reports both, for both players, and then names whichever one was worse.
 * ------------------------------------------------------------------------ */

const pct = (v: number | null): string => (v === null ? '—' : `${v.toFixed(0)}%`);

const statsTable = (): string => {
  const me = series.stats.near;
  const them = series.stats.far;
  const row = (label: string, a: string, b: string) =>
    `<div class="lbl">${label}</div><div class="n me">${a}</div><div class="n them">${b}</div>`;
  return (
    '<div class="stats">' +
    '<div class="h">&nbsp;</div><div class="h n">you</div><div class="h n">them</div>' +
    row('rallies won', String(me.won), String(them.won)) +
    row('reached, of playable', pct(coverage(me)), pct(coverage(them))) +
    row('mis-hit, of struck', pct(mishitRate(me)), pct(mishitRate(them))) +
    row(
      'fastest shot',
      `${(me.fastest * 2.23694).toFixed(0)} mph`,
      `${(them.fastest * 2.23694).toFixed(0)} mph`,
    ) +
    '</div>'
  );
};

/** One sentence naming the thing that cost the most points. */
const diagnosis = (): string => {
  const me = series.stats.near;
  if (me.missed + me.mishits === 0) return 'You did not lose a rally. Try Tough.';
  const cov = coverage(me);
  const mis = mishitRate(me);
  if (me.missed > me.mishits * 1.6) {
    return (
      `Most of what you lost, you lost by not getting there — ${me.missed} rallies to ` +
      `${me.mishits}. Move to the ring, not to the ball: it shows where you can strike, ` +
      'which is a different place.'
    );
  }
  if (me.mishits > me.missed * 1.6) {
    return (
      `Most of what you lost, you lost on the strike — ${me.mishits} rallies to ${me.missed}. ` +
      'The pressure bar is high when the ball is low, fast, or you are still running. ' +
      'Those are the ones to play safe.'
    );
  }
  return (
    `Split evenly: ${me.missed} rallies lost getting there, ${me.mishits} on the strike. ` +
    `You reached ${pct(cov)} of the balls you could play and mis-hit ${pct(mis)} of ` +
    'the ones you struck.'
  );
};

const showCard = (
  title: string,
  tone: 'ok' | 'bad' | 'idle',
  body: string,
  withStats: boolean,
  go: string,
  alt: string | null,
): void => {
  out('cardTitle').textContent = title;
  out('cardTitle').className = tone === 'idle' ? '' : tone;
  out('cardBody').innerHTML = body;
  out('cardStats').innerHTML = withStats ? statsTable() : '';
  out('cardWhy').innerHTML = withStats ? diagnosis() : '';
  out('cardWhy').style.display = withStats ? '' : 'none';
  out('cardGo').textContent = go;
  (out('cardAlt') as HTMLButtonElement).style.display = alt ? '' : 'none';
  if (alt) out('cardAlt').textContent = alt;
  out('overlay').classList.add('show');
};

const hideCard = (): void => out('overlay').classList.remove('show');

const PADDLE_POSE = {
  speed: 0,
  pitch: 12,
  yaw: 0,
  pathAngle: 12,
  pathYaw: 0,
  impactOffset: 0,
  facing: -1 as const,
};

/**
 * How far through a swing a player is, 0 to 1, for the arm.
 *
 * The windup rises to 1 and the recovery falls back — so the arm is furthest
 * back at the instant the paddle arrives, which is the frame the whole feel
 * layer is built around (ADR-0004). Purely cosmetic: the simulation's swing
 * state machine is unchanged and never reads this.
 */
const swingProgress = (p: { phase: string; phaseTime: number }): number => {
  if (p.phase === 'windup') return 1 - Math.max(0, p.phaseTime) / C.SWING_WINDUP;
  if (p.phase === 'recovery') return Math.max(0, p.phaseTime) / C.SWING_RECOVERY;
  return 0;
};

const _paddleAt = v3();
const _nearAt = v3();
const _farAt = v3();
const _nearMateAt = v3();
const _farMateAt = v3();
const _n = v3();
const _path = v3();
const _ball = v3();

/** The intercept the ring is currently drawing, kept for the debug hook. */
let lastMeeting: { x: number; z: number; seconds: number } | null = null;

const loop = new GameLoop({
  fixedUpdate: () => {
    const input = controls.frame(C.SIM_DT);
    // Every screen except `playing` steps nothing, but the loop keeps turning
    // so the camera settles and the panel stays live. Stopping the loop instead
    // let the accumulator fill, and unpausing replayed the whole backlog in one
    // frame — the ball teleported across the court.
    if (screen !== 'playing') return;
    // Recorded BEFORE the simulation consumes it, and the exact object the
    // simulation is about to be given. Recording afterwards would capture
    // whatever the input layer had moved on to.
    recorder?.push(input);
    const events = stepRally(rally, input);
    const world = rally.world;

    if (!world.ball.resting) {
      renderer.pushTrail(world.ball.pos.x, world.ball.pos.y, world.ball.pos.z);
    }

    for (const e of events) {
      switch (e.type) {
        case 'served':
          renderer.clearTrail();
          renderer.landingMark.visible = false;
          setBanner(e.by === 'near' ? 'your serve' : 'their serve', 'idle');
          break;

        case 'struck': {
          renderer.clearTrail();
          // The half-second of feedback the game did not have. The ring marks
          // WHEN the paddle arrived, which is the only way to learn whether a
          // press was early or late across a 120 ms windup; its colour marks
          // how cleanly, which otherwise only shows up two seconds later when
          // the ball drops out and nobody connects the two.
          const b = rally.world.ball.pos;
          const quality = Math.max(e.offCentre, e.pressure * 0.8);
          renderer.impacts.at(b.x, b.y, b.z, Math.min(1, e.exitSpeed / 20), quality);
          if (e.by === 'near') renderer.rig.kick(Math.min(1, e.exitSpeed / 18));
          sound.hit(e.exitSpeed, e.offCentre);
          out('shotInfo').textContent =
            `${e.by === 'near' ? 'you' : 'opponent'} · ${e.shape} · ` +
            `${(e.exitSpeed * 2.23694).toFixed(0)} mph` +
            (e.offCentre > 0.55 ? ' · off the end' : e.strain > 0.5 ? ' · stretched' : '');
          // What the opponent thought it was doing. Worth showing: the whole
          // point of a shot-selection model is that a player can read it and
          // play against it, and a model nobody can read is just noise.
          if (e.by === 'far' && rally.opponent.lastReason) {
            out('planInfo').textContent = `opponent: ${rally.opponent.lastReason}`;
          }
          // How hard that shot was to play, which is what the error scaled
          // with. Worth showing: a player who can see it learns that a ball
          // taken low, late and on the run is the one that goes wrong, which
          // is the whole of the skill this model is trying to reward.
          out('pressureBar').style.width = `${(e.pressure * 100).toFixed(0)}%`;
          break;
        }

        case 'bounce':
          renderer.landingMark.position.set(e.at.x, 0.006, e.at.z);
          renderer.landingMark.material.color.setHex(e.inBounds ? 0x4ade80 : 0xf87171);
          renderer.landingMark.visible = true;
          renderer.impacts.at(e.at.x, 0.02, e.at.z, Math.min(1, e.speed / 12) * 0.6, e.inBounds ? 0 : 1);
          sound.bounce(e.speed);
          break;

        case 'net':
          renderer.impacts.at(e.at.x, e.at.y, e.at.z, 0.4, 1);
          sound.net();
          break;

        case 'fault':
          setBanner(
            `${CALL[e.reason]} — ${e.by === 'near' ? 'your fault' : 'their fault'}`,
            e.by === 'near' ? 'bad' : 'ok',
          );
          break;

        case 'point':
          refreshScore();
          sound.call(e.to === 'near');
          out('lastCall').textContent =
            e.to === 'near' ? `point to you · ${rally.call}` : `point to them · ${rally.call}`;
          break;

        case 'sideOut':
          refreshScore();
          sound.call(e.to === 'near');
          out('lastCall').textContent =
            e.to === 'near' ? `side out · your serve · ${rally.call}` : `side out · their serve`;
          break;

        case 'gameOver':
          refreshScore();
          setBanner(
            e.winner === 'near' ? 'GAME — you win' : 'GAME — opponent wins',
            e.winner === 'near' ? 'ok' : 'bad',
          );
          break;

        default:
          break;
      }
    }

    // The match watches the same event stream the renderer does, and writes
    // nothing back. It is what turns one game into something with a shape.
    for (const s of observe(series, events)) {
      if (s.type === 'matchWon') {
        screen = 'matchOver';
        const won = s.by === 'near';
        sound.call(won);

        // A ladder match counts. `challenging` was captured when the match
        // started, so the win is credited to the person who was actually
        // played rather than to whoever is next after the climb.
        let climbed = '';
        if (challenging) {
          const rival = LADDER.find((r) => r.id === challenging);
          const before = career.rank;
          career = recordMatch(career, challenging, won);
          saveCareer(career);
          climbed =
            career.rank < before
              ? ` You take rank ${career.rank} from ${rival?.name}.`
              : won
                ? ''
                : ` ${rival?.name} holds rank ${before - 1}.`;
          challenging = null;
          refreshCareer();
        }

        showCard(
          won ? 'Match to you' : 'Match to the opponent',
          won ? 'ok' : 'bad',
          climbed +
          `${series.games.near}–${series.games.far} in games, on ${level}. ` +
            series.history
              .map((g, i) => `Game ${i + 1} ${g.near}–${g.far}`)
              .join(' · ') +
            '.',
          true,
          'Rematch',
          `Level: ${LABEL[level]}`,
        );
      } else if (s.type === 'gameWon') {
        screen = 'betweenGames';
        const won = s.by === 'near';
        sound.call(won);
        const g = series.history[series.history.length - 1];
        showCard(
          won ? `Game ${series.history.length} to you` : `Game ${series.history.length} to them`,
          won ? 'ok' : 'bad',
          `${g.near}–${g.far} · ${g.rallies} rallies · longest ${g.longest} shots. ` +
            `Games ${series.games.near}–${series.games.far}. ` +
            `${nextServer(series) === 'near' ? 'You serve' : 'They serve'} first — the loser ` +
            'of a game starts the next one.',
          true,
          'Next game',
          null,
        );
      }
    }
  },

  render: (alpha, frameSeconds) => {
    const world = rally.world;
    interpolatedPosition(_ball, world, alpha);
    renderer.ball.position.set(_ball.x, _ball.y, _ball.z);
    renderer.marker.position.set(_ball.x, 0.004, _ball.z);

    // Players are drawn between two ticks, exactly like the ball above.
    //
    // Until Day 16 only the ball was. Every frame therefore drew the ball part
    // way through a tick and the player and paddle a full tick further on — the
    // ball travels 9.2 cm in a typical tick and up to 23.9 cm, against a ball
    // 7.4 cm across, so at contact the paddle could be drawn more than a ball's
    // width from the ball it was hitting. It reads as a player standing still
    // and the ball being hit anyway, which is precisely how it was reported.
    //
    // Everything below is presentation. The stride, the lean and the swing arm
    // are read from simulation state and never write back to it.
    const views = [
      { view: renderer.player, player: rally.near, out: _nearAt },
      { view: renderer.opponent, player: rally.far, out: _farAt },
      { view: renderer.partner, player: rally.team.near[1], out: _nearMateAt },
      { view: renderer.oppPartner, player: rally.team.far[1], out: _farMateAt },
    ];
    for (const { view, player, out } of views) {
      if (!player) {
        view.setVisible(false);
        continue;
      }
      view.setVisible(true);
      interpolatedPlayer(out, player, alpha);
      const isNear = player === rally.near;
      const reach = rally.reaches[player.side][player.slot];
      view.pose({
        at: out,
        facing: player.facing,
        speed: Math.hypot(player.vel.x, player.vel.z),
        drift: Math.max(-1, Math.min(1, player.vel.x / C.PLAYER_MAX_SPEED)),
        swing: swingProgress(player),
        strain: isNear ? rally.reach.strain : reach.strain,
        canReach: isNear ? rally.reach.canReach : reach.canReach,
        frameSeconds,
      });
    }

    // The paddle is placed from the DRAWN player and the DRAWN ball, so the
    // three of them agree about what moment it is.
    paddleAt(_paddleAt, rally, _nearAt, _ball);
    // ...and then the near player's arm is aimed at it, so the paddle is being
    // held rather than floating.
    renderer.player.pose({
      at: _nearAt,
      facing: rally.near.facing,
      speed: Math.hypot(rally.near.vel.x, rally.near.vel.z),
      drift: Math.max(-1, Math.min(1, rally.near.vel.x / C.PLAYER_MAX_SPEED)),
      swing: swingProgress(rally.near),
      strain: rally.reach.strain,
      canReach: rally.reach.canReach,
      frameSeconds,
      paddleAt: _paddleAt,
    });
    faceNormal(_n, PADDLE_POSE);
    set(_path, 0, 0.42, -0.91);
    renderer.paddle.pose(_paddleAt, _n, _path);

    // Where you could meet the ball, and where a swing pressed now would land
    // the paddle. Two different questions, and both worth showing: the first
    // tells you where to stand, the second when to press.
    const bounced = rally.match.bouncesSinceHit > 0;
    const mustLet = rally.match.hitsThisRally < 3;
    const meeting = interceptPoint(world, 'near', { requireBounce: mustLet && !bounced });
    lastMeeting = meeting && { x: meeting.pos.x, z: meeting.pos.z, seconds: meeting.seconds };
    renderer.intercept.visible = meeting !== null;
    if (meeting) renderer.intercept.position.set(meeting.pos.x, 0.005, meeting.pos.z);

    const future = predictBall(world, C.SWING_WINDUP);
    renderer.swingMark.visible = !world.ball.resting;
    renderer.swingMark.position.set(future.pos.x, 0.004, future.pos.z);

    // Where the shot currently selected would be aimed.
    //
    // `targetFor` rather than `solveSwing`: this runs every rendered frame, and
    // the solver is about a thousand simulated trajectories. The target is also
    // the honest thing to draw — it is what the player asked for, and whether
    // the shot gets there is the execution model's business, which is precisely
    // the uncertainty the game is made of. A marker that promised the landing
    // point would be lying about the hard part.
    const aim = controls.aim();
    const aimed = targetFor(controls.shape(), aim.x, aim.z, rally.near.facing);
    renderer.aimMark.visible = rally.match.phase === 'inPlay';
    renderer.aimMark.position.set(aimed.targetX, 0.005, aimed.targetZ);

    // Feel is advanced with REAL seconds, not simulated ones. A camera that
    // shook in simulated time would shake for twice as long at half game speed,
    // and the slow-motion setting would quietly become a different game to
    // look at. See ADR-0004.
    renderer.impacts.update(frameSeconds, renderer.camera);
    renderer.rig.update(frameSeconds, _ball);

    renderer.render();

    const b = world.ball;
    const speed = Math.hypot(b.vel.x, b.vel.y, b.vel.z);
    out('liveInfo').textContent =
      `ball (${b.pos.x.toFixed(2)}, ${b.pos.y.toFixed(2)}, ${b.pos.z.toFixed(2)}) ` +
      `${speed.toFixed(1)} m/s · you (${rally.near.pos.x.toFixed(2)}, ` +
      `${rally.near.pos.z.toFixed(2)}) · ` +
      `reach ${rally.reach.canReach ? `${(rally.reach.strain * 100).toFixed(0)}% strain` : 'out'} · ` +
      `${rally.match.phase}`;
    // The shape, then where it is pointed, in words rather than numbers. "0.62"
    // is a number a developer reads; "drive · right, deep" is a sentence a
    // player reads mid-rally without taking their eyes off the court for long.
    out('shapeInfo').textContent = `${controls.shape()} · ${aimWords(aim.x, aim.z)}`;
  },
});

/**
 * A debug hook the headless play test reads.
 *
 * The old harness scraped the telemetry line with a regular expression, which
 * broke the moment the panel was reworded — and, worse, quietly: it stopped
 * matching, the autopilot stood still, and the run reported a game problem
 * instead of a harness problem. A named accessor is a contract. It is the only
 * thing on `window`, it is read-only, and if it is ever removed the play test
 * fails loudly on the first tick rather than looking like a gameplay bug.
 */
Object.defineProperty(window, '__dink', {
  value: {
    state: () => ({
      ball: { ...rally.world.ball.pos, resting: rally.world.ball.resting },
      vel: { ...rally.world.ball.vel },
      you: { x: rally.near.pos.x, z: rally.near.pos.z, phase: rally.near.phase },
      them: { x: rally.far.pos.x, z: rally.far.pos.z },
      match: {
        phase: rally.match.phase,
        server: rally.match.server,
        box: serveBox(rally.match),
        score: { ...rally.match.score },
        hits: rally.match.hitsThisRally,
        bounces: rally.match.bouncesSinceHit,
      },
      reach: { ...rally.reach },
      difficulty: rally.opponent.difficulty,
      muted: sound.muted(),
      // Day 19. The browser harness checks the new controls through the real
      // DOM, and a control that changes nothing observable cannot be checked —
      // which is how the mute button stayed dead for eleven days.
      mode,
      watching,
      onCourt: rally.team.near.length + rally.team.far.length,
      screen,
      // The simulation's own step counter. The browser harness asserts that
      // pausing stops it, which is the only version of that check that cannot
      // pass for the wrong reason: comparing ball positions across a pause is
      // satisfied just as well by a ball that happened to be resting between
      // points.
      tick: rally.world.tick,
      // Day 23. The seed is on the hook because a bug report that says "seed
      // 3141592653" is a match somebody can reproduce, and because a harness
      // can assert that two matches do not share one.
      seed: recorder?.setup.seed ?? null,
      recordedTicks: recorder?.ticks ?? 0,
      games: { ...series.games },
      champion: series.champion,
      pressure: rally.lastPressure,
      opponent: {
        stance: rally.opponent.stance,
        reason: rally.opponent.lastReason,
        x: rally.far.pos.x,
        z: rally.far.pos.z,
      },
      // The same thing the ring on the court shows the player. The autopilot
      // is allowed to see it for exactly that reason: giving it the raw sim
      // would let it play a game the human cannot.
      intercept: lastMeeting,
    }),
    // Wrapped, not passed: these are declared further down, and naming them
    // directly here would read them before initialisation.
    newMatch: () => newMatch(),
    /** Skip the title card, which is what the headless harness needs. */
    begin: () => {
      if (screen === 'title') newMatch();
    },
  },
});

const applyLevel = (next: Difficulty): void => {
  level = next;
  setDifficulty(rally.opponent, next);
  // One object, shared with the rally, so the swing error changes with it.
  rally.skill.far = rally.opponent.skill;
  document
    .querySelectorAll<HTMLButtonElement>('[data-level]')
    .forEach((b) => b.classList.toggle('on', b.dataset.level === next));
  const s = LEVELS[next];
  out('levelInfo').textContent =
    `${(s.reaction * 1000).toFixed(0)} ms to react · ` +
    `${(s.anticipation * 100).toFixed(0)} cm out on its read · ` +
    `${next === 'tough' ? 'rarely' : next === 'steady' ? 'sometimes' : 'often'} mis-hits`;
};

document.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((btn) => {
  btn.addEventListener('click', () => {
    applyLevel(btn.dataset.level as Difficulty);
    remember();
    canvas.focus();
  });
});

const applySpeed = (scale: number): void => {
  loop.setSpeed(scale);
  document
    .querySelectorAll<HTMLButtonElement>('[data-speed]')
    .forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === scale));
  out('speedInfo').textContent =
    scale === 1 ? 'real time' : `${Math.round((1 - scale) * 100)}% slower than real time`;
};

document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((btn) => {
  btn.addEventListener('click', () => {
    applySpeed(Number(btn.dataset.speed));
    remember();
    canvas.focus();
  });
});

const applyView = (view: CameraView): void => {
  currentView = view;
  renderer.setView(view);
  renderer.rig.snap(rally.world.ball.pos);
  document
    .querySelectorAll<HTMLButtonElement>('[data-view]')
    .forEach((b) => b.classList.toggle('on', b.dataset.view === view));
};

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    applyView(btn.dataset.view as CameraView);
    remember();
    canvas.focus();
  });
});

/* ---------------------------------------------------------------------------
 * Singles, doubles, and watching.
 *
 * Both restart the match rather than switching mid-point. A `Rally` owns the
 * world, every player, the team plans and the rules, and changing how many
 * people are on court halfway through a game is the sort of mutation that has
 * gone stale twice in this codebase already (see the note above `startGame`).
 * Rebuilding is one line and cannot be half-done.
 * ------------------------------------------------------------------------ */

const applyMode = (next: Mode, restart = true): void => {
  mode = next;
  document
    .querySelectorAll<HTMLButtonElement>('[data-mode]')
    .forEach((b) => b.classList.toggle('on', b.dataset.mode === next));
  describeMode();
  if (restart) newMatch();
};

const applyWatch = (on: boolean, restart = true): void => {
  watching = on;
  out('watch').textContent = `Watch: ${on ? 'on' : 'off'}`;
  out('watch').classList.toggle('on', on);
  describeMode();
  if (restart) newMatch();
};

const describeMode = (): void => {
  out('modeInfo').textContent = watching
    ? 'The computer plays both ends. Your keys do nothing.'
    : mode === 'doubles'
      ? 'You play the right court. Your partner takes their own half, and the middle ball.'
      : 'One a side. You cover the whole court.';
};

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (mode === btn.dataset.mode) return;
    applyMode(btn.dataset.mode as Mode);
    remember();
    canvas.focus();
  });
});

out('watch').addEventListener('click', () => {
  applyWatch(!watching);
  remember();
  canvas.focus();
});

/**
 * Mute.
 *
 * The button and the M key have both been listed in the panel since Day 8 and
 * neither was connected to anything. `sound.setMuted` existed, `sound.muted()`
 * existed, and no line in this file ever called them — so the control was
 * documented, drawn, and dead. Found on Day 19 while trying to PERSIST the
 * setting, which is a good argument for storing a preference: you have to go and
 * look at how it is set.
 */
const applyMute = (next: boolean): void => {
  sound.setMuted(next);
  out('mute').textContent = `Sound: ${next ? 'off' : 'on'}`;
  out('mute').classList.toggle('on', next);
};

out('mute').addEventListener('click', () => {
  applyMute(!sound.muted());
  remember();
  canvas.focus();
});

/* ---------------------------------------------------------------------------
 * Moving between screens.
 *
 * A game is started by building a fresh `Rally`, never by mutating the old one.
 * The rally owns the world, both players, the opponent's stance and the rules;
 * resetting all of that by hand was one function that had to be kept in step
 * with five others, and it had already gone stale twice.
 * ------------------------------------------------------------------------ */

const clearCourt = (): void => {
  renderer.clearTrail();
  renderer.landingMark.visible = false;
  renderer.impacts.clear();
  renderer.rig.snap(rally.world.ball.pos);
  out('lastCall').textContent = '';
  out('shotInfo').textContent = '';
  out('planInfo').textContent = '';
  out('pressureBar').style.width = '0%';
};

const startGame = (server: 'near' | 'far'): void => {
  // A ladder match is played against that rival's style at that rival's
  // difficulty. A friendly uses whatever is set in the panel. Nothing else
  // differs — no bonuses and no rubber-banding, so beating Marco means you
  // worked out how Marco plays.
  const rival = challenging ? LADDER.find((r) => r.id === challenging) : null;
  if (rival) level = rival.difficulty;
  const seed = newSeed();
  const farStyle = rival ? styleFor(rival) : STYLES['all court'];
  rally = createRally(server, level, teamSizeOf(mode), watching, seed, farStyle);

  // Every match is recorded, always, because the one you want a recording of is
  // the one that just went wrong. A 90 second match is under 7 kB run-length
  // encoded, which is cheaper than asking somebody to reproduce a bug.
  recorder = new Recorder({
    version: REPLAY_VERSION,
    build: __APP_VERSION__,
    seed,
    server,
    difficulty: level,
    teamSize: teamSizeOf(mode),
    watching,
    farStyle: farStyle.name,
    nearStyle: 'all court',
  });
  screen = 'playing';
  hideCard();
  refreshScore();
  setBanner(server === 'near' ? 'your serve' : 'their serve', 'idle');
  clearCourt();
  // The card was on screen for as long as the player took to read it, and the
  // loop kept turning the whole time. Without this the accumulator hands the
  // first frame of the new game a backlog of catch-up ticks.
  loop.resync();
  canvas.focus();
};

const newMatch = (): void => {
  challenging = null;
  series = createSeries(3);
  startGame('near');
  refreshCareer();
};

/** Start the one match the ladder is offering. */
const challenge = (): void => {
  const rival = nextOpponent(career);
  if (!rival) return;
  challenging = rival.id;
  series = createSeries(3);
  startGame('near');
  setBanner(`your serve · ${rival.name}`, 'idle');
  refreshCareer();
};

const titleScreen = (): void => {
  screen = 'title';
  showCard(
    'Dink: Pickleball Rivals',
    'idle',
    'Best of three games to 11, side-out scoring — you only score on your own ' +
      'serve. <b>WASD</b> to move, <b>Space</b> to serve and drive, <b>J</b> drop, ' +
      '<b>K</b> lob.<br><br>You aim with <b>WASD</b> too: the direction you are holding ' +
      'when you swing is where the ball goes — <b>A</b> and <b>D</b> across the court, ' +
      '<b>W</b> short and <b>S</b> deep. So a shot played on the run goes the way you ' +
      'ran, and hitting behind somebody means planting first.<br><br>The shaded box ' +
      'either side of the net is ' +
      'the kitchen. You may stand in it to play a ball that has bounced, but not to ' +
      'volley one out of the air — and your own momentum must not carry you in ' +
      'afterwards.<br><br>The blue ring is where the ball will be ' +
      'when a swing pressed now arrives. Aim at that, not at the ball — the paddle ' +
      'takes 120 ms to get there. The amber ring across the net is where your next ' +
      'shot is pointed.',
    false,
    'Play',
    `Level: ${LABEL[level]}`,
  );
};

/**
 * Hand the current match to the player as text.
 *
 * Clipboard rather than a file download, and that is not laziness: a published
 * artifact runs in a sandbox where a page cannot start a download at all, so a
 * download button would work in the desktop build, work locally, and silently
 * do nothing for anybody playing in the browser — which is most playtesters.
 * Text on the clipboard works everywhere and pastes straight into a message.
 */
out('copyReplay').addEventListener('click', async () => {
  if (!recorder || recorder.ticks === 0) {
    out('replayInfo').textContent = 'nothing recorded yet — play a point first';
    return;
  }
  const json = JSON.stringify(recorder.finish());
  const kb = (json.length / 1024).toFixed(1);
  try {
    await navigator.clipboard.writeText(json);
    out('replayInfo').textContent = `${kb} kB copied — paste it into your bug report`;
  } catch {
    // Clipboard access is refused without a user gesture in some contexts and
    // blocked outright in others. Falling back to the console is not elegant
    // and it beats a button that appears to do nothing.
    console.log(json);
    out('replayInfo').textContent = `${kb} kB written to the console (clipboard refused)`;
  }
});

out('challenge').addEventListener('click', () => {
  challenge();
  canvas.focus();
});

out('cardGo').addEventListener('click', () => {
  if (screen === 'title') newMatch();
  else if (screen === 'paused') {
    screen = 'playing';
    hideCard();
    loop.resync();
    canvas.focus();
  } else if (screen === 'betweenGames') {
    nextGame(series);
    startGame(nextServer(series));
  } else if (screen === 'matchOver') newMatch();
});

/**
 * The level button on the card cycles rather than opening anything.
 *
 * The first version sent the player back to the panel to use the buttons that
 * were already there, on the reasoning that a second copy is a second thing to
 * keep in step. It was right about the duplication and wrong about the flow:
 * dismissing a card to go and press something else, then finding your way back,
 * is three steps to change one word. Cycling in place is one, and it reuses
 * `applyLevel`, so there is still only one implementation.
 */
const ORDER: Difficulty[] = ['easy', 'steady', 'tough'];
const LABEL: Record<Difficulty, string> = { easy: 'Easy', steady: 'Steady', tough: 'Tough' };

out('cardAlt').addEventListener('click', () => {
  applyLevel(ORDER[(ORDER.indexOf(level) + 1) % ORDER.length]);
  out('cardAlt').textContent = `Level: ${LABEL[level]}`;
});

const pause = (): void => {
  if (screen !== 'playing') return;
  screen = 'paused';
  showCard(
    'Paused',
    'idle',
    `Games ${series.games.near}–${series.games.far}, this game ` +
      `${rally.match.score.near}–${rally.match.score.far} on ${level}.`,
    series.stats.near.chances > 0,
    'Resume',
    null,
  );
};

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (screen === 'playing') pause();
    else if (screen === 'paused') out('cardGo').click();
  }
  if (e.code === 'KeyR' && screen !== 'title') newMatch();
  if (e.code === 'KeyM') {
    applyMute(!sound.muted());
    remember();
  }
  if (e.code === 'Enter' && screen !== 'playing') out('cardGo').click();
});
out('restart').addEventListener('click', () => newMatch());

window.addEventListener('resize', renderer.resize);

out('specInfo').textContent =
  `game to ${11} win by 2 · side-out scoring · court ${(C.COURT_HALF_WIDTH * 2).toFixed(2)} x ` +
  `${(C.COURT_HALF_LENGTH * 2).toFixed(2)} m · reach ${C.PLAYER_REACH.toFixed(2)} m · ` +
  `windup ${(C.SWING_WINDUP * 1000).toFixed(0)} ms · sim ${C.SIM_HZ} Hz`;

// Compile the solver before the player can see it happen. Without this the
// first contact of a session costs 30 ms against a 3.6 ms median, which is a
// visible hitch on the very first shot.
warmUp();

refreshScore();
applyLevel(level);
applySpeed(saved.speed);
applyView(saved.view);
// `restart: false` — nothing has started yet, and `newMatch` before the title
// screen would drop the player straight into a game they did not ask for.
applyMode(mode, false);
applyWatch(watching, false);
applyMute(saved.muted);
titleScreen();
// Draw the ladder before the first frame, so a returning player sees where
// they left off rather than an empty panel that fills in after a match.
refreshCareer();
loop.start();
