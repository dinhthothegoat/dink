# Dink: Pickleball Rivals

A 3D pickleball game, built to a two-week plan ending in a playable singles
match, and finished on the tenth. A best-of-three match against an opponent that
moves, positions, picks its shot from where its feet are and misses at three
levels — with a camera that leans, contacts you can hear, and a card at the end
of each game telling you what actually cost you the points.

## Running it

```bash
npm install
npm run dev        # sandbox at http://localhost:5173
npm run verify     # typecheck, tests, production build
```

## Layout

```
src/sim/      Pure simulation. Imports nothing from Three.js.
              vec3, constants, ball (flight + impact), court, world (step + events),
              paddle (contact), solver (target -> swing), player (movement and
              reach), input (InputFrames), rules (the rulebook, singles and
              doubles), intercept (where you can meet the ball), rng (seeded),
              rally (the match), opponent (the computer player), execution (how
              shots go wrong), series (a match, and what happened in it)
src/render/   Three.js scene, court and net, paddle, players, camera rig,
              impact rings, synthesised audio
src/core/     Fixed-timestep game loop, keyboard and gamepad adapter
tools/        Screenshot harness, browser play test, rally statistics,
              performance sampler, and `ship` (end a build day)
tests/        Headless tests: physics, contact, rules, rallies, matches, tooling
docs/         ADRs, backlog, day log, screenshots
```

The seam between `sim` and `render` is the load-bearing decision in this
codebase. The simulation is pure, deterministic and framerate-independent, so
it can be unit-tested with no browser, and replays and netcode later have
something to stand on. Nothing in `src/sim` may import Three.js.

## Physics

Constants come from the USA Pickleball equipment and court specification, or
from published measurements, and are marked TUNED where neither exists. Court
is 20 x 44 ft with a 7 ft non-volley zone; the net is 36 in at the posts, sagging to 34 in at the
centre. Ball is 0.0243 kg at 74 mm, treated as a hollow shell, which is why it
takes and reverses spin so readily off the bounce. Restitution is derived from
the specification's drop test: 78 in drop, 30 to 34 in rebound.

Aerodynamics are measured, not guessed: Cd = 0.30 and Cl = 0.195*S from
published trajectory fitting of a 40-hole outdoor ball, rescaled for the air
density we simulate at. Flight integrates with semi-implicit Euler at a fixed
120 Hz. Bounces run the sliding-versus-gripping test rather than reflecting
velocity, so topspin grips and keeps speed while backspin slides and keeps its
spin.

## Contact

A swing is a face orientation plus a swing path. Spin is not an input: it comes
out of the angle between where the face points and where the paddle is going.
The paddle is treated as a free body during the four milliseconds of contact,
so its effective mass at the impact point falls away from the centre of mass
and tip hits are weak without anyone authoring a power curve.

`solveSwing` inverts all of that: give it a target and a shot shape and it
finds a swing that lands there, in 10 to 50 ms.

See `docs/adr/0001-engine-and-simulation-architecture.md` and
`docs/adr/0002-physics-calibration-and-contact-model.md` for why, and
`docs/daylog.md` for what happened along the way.

## Playing it

WASD to move, space to drive, J to drop, K to lob. A gamepad works too.

**WASD is also the aim.** The direction you are holding when you swing is where
the ball goes: A and D across the far court, W short and S deep, within what the
shot allows — a drop anywhere in the kitchen, a drive from just past the
non-volley line to just inside the baseline. Standing still hits down the middle.

There is no separate aim control, and that is the mechanic rather than a
shortcut: chasing a ball wide to your right means holding D, so a shot played on
the run goes the way you ran. Hitting behind somebody means planting first —
letting go, or pressing back against your own momentum — which is what a player
on a real court is doing when they set their feet.

Aim is committed when the swing is pressed, not when the paddle arrives 120 ms
later. The amber ring on the far court shows where the shot you have selected is
pointed.

The game runs at 60 per cent of real time by default. A pickleball drive
genuinely does cross the court in seven tenths of a second, and human reaction
time does not scale with the simulation, so the whole game — ball, player and
swing together — is slowed rather than the ball alone. The panel has slower,
faster and real-time settings.

A swing puts the paddle on the ball 120 ms later, so pressing when the ball is
already in reach is pressing too late. The blue ring shows where the ball will
be when a swing pressed now would arrive; aim at that, not at the ball. The
ring under your feet is your reach, and it reddens as a contact gets stretched
— a stretched contact catches the ball off the end of the paddle, and the
contact model punishes that on its own.

## The opponent

It sees the world you see and answers with the same four fields a keyboard
produces: move, swing, shape, aim. That is the only channel it has. It cannot
read the simulation directly, it drives the near player just as well as the
far one, and `stepRally` has no idea which end is a person.

What it decides. Where to stand: behind the point it can strike the ball, or,
when the ball is not yet its problem, on the bisector of the angle you can hit
into, at whatever depth it has earned. What to hit: a drive from deep, a drop
and a step forward from inside the court, a dink or an attack at the rail, a
lob when stretched. Every shot is aimed away from where you are standing,
because the distance it makes you run is the whole of its offence.

Coming forward is earned one step per soft shot and given back under pressure.
Following your own drop all the way to the net loses 11-0, which is also true
of the real sport.

`npx tsx tools/tally.mjs` plays eight games with that brain at both ends. It
reports how the rallies ended, which shots were played, and the hold rate at
each end of the court — two identical players, so those two numbers agreeing
is a fairness check on the whole simulation.

## Missing

Nobody plays a perfect arc. A shot is degraded by four things the simulation
already knows — how far you reached, how fast the ball came, how low you took
it, and how fast you were still moving — and the error is applied to the swing
rather than to the target, so the physics decides whether a bad contact goes
long, short, wide or into the net.

It is not a symmetric scatter. A player who does not strike cleanly loses pace
and opens the face, so the ball sits up: higher, shorter, more central. That
matters more than it sounds. A symmetric scatter made worse players *harder* to
beat, because spread is what makes a ball hard to reach.

Three levels, and they separate on the two things you actually feel:

| | rally length | balls reached | mis-hits |
| --- | --- | --- | --- |
| Easy | 3.0 | 73 per cent | 8 per cent |
| Steady | 3.3 | 76 per cent | 8 per cent |
| Tough | 4.1 | 79 per cent | 4 per cent |

Those are two players of the same level playing each other, and read that way
the columns barely separate — which is the honest picture. A level cannot be
measured against a copy of itself; a better player faces a better opponent and
the two cancel.

What orders them is holding one side fixed. Against a stand-in for an ordinary
player, over ten matches each:

| | matches won | rallies won | balls reached |
| --- | --- | --- | --- |
| Easy | 10 of 10 | 79 per cent | 88 per cent |
| Steady | 3 of 10 | 44 per cent | 72 per cent |
| Tough | 0 of 10 | 33 per cent | 70 per cent |

Tough is won four times in ten by a stand-in for someone who has played a lot.
It used to be better than Steady on all three of its axes at once, which is why
it was not hard but impossible — a top level has to give something back
somewhere.

You miss too, and the reach ring is the warning. A comfortable ball goes where
you sent it; a stretched one is a real risk.

## The match

Best of three games to 11, win by 2. Side-out scoring: you only score on your
own serve, and losing a rally on serve hands it over rather than giving a point
away. Whoever loses a game serves first in the next one. Serves go
diagonally and must clear the kitchen. The two-bounce rule is enforced — the
serve and the return must both bounce before anyone may take the ball out of
the air.

The non-volley rule is real. You may stand in the kitchen to play a ball that has
bounced — you have to, constantly — but not to volley one out of the air, and
your own momentum must not carry you in for half a second afterwards.

It was a physical rail from Day 4 to Day 12. The rail put 59 per cent of the
kitchen out of reach of anybody, which meant every dink was an unanswerable
winner rather than a rally. `docs/daylog.md` has the geometry.

## Doubles, so far

`docs/adr/0005-teams-and-a-derived-serve-rotation.md` has the data model and why
it is shaped this way. The short version:

The rulebook is in. Two servers a side, the 0-0-2 opening exception, the
three-number call, and a serve rotation that is derived rather than tracked:
partners swap courts exactly when their team scores, so "the player who started
in the right court is on the right" and "the team score is even" flip together
and stay locked for the whole game. Nothing stores where anybody is standing.

One consequence of that, which two sources disagreed about while it was being
written: the second server serves from the LEFT at an even score. Nobody swapped,
because no point was scored.

Day 15 gave the partners brains and the ball an owner. Exactly one player a side
plays each ball, decided once per shot rather than every tick, by the rulebook
first, then the middle-ball convention, then who can get there. A human always
beats their own partner, because a partner that takes balls out of your paddle is
the behaviour players hate most.

Day 16 made them a team rather than two players on the same side. Depth belongs
to the pair and only the player hitting the ball changes it; everyone else holds
their own half. The third shot drop exists, which is the shot the sport is built
on and the only way a pair gets to the net at all — and the two teams start a
point at different depths, because the serving team is pinned back by the
two-bounce rule while the receiving team is already at the line.

The measurements, and `npm run doubles` prints them:

```
                  Day 15     Day 16
crowded            23.6%       2.3%
separation         1.96 m     2.58 m
rally length        3.21       3.52   (singles: 3.28)
time at the line     1.2%      30.3%
```

Doubles has buttons now, under **Match** in the panel, along with a Watch toggle
that hands both ends to the computer. The URL flags `?doubles=1` and `?demo=1`
still work and still win when present, because the recording tools use them.
Settings — difficulty, mode, watch, camera, speed, mute — survive a refresh.

## Feel

A swing commits 120 ms before the paddle arrives, so the game has to answer
"was that good?" inside the half second while you are still asking. A ring at
the contact marks *when* the paddle got there, which is the only way to learn
whether a press was early or late. Its colour, and the sound, mark how cleanly:
a ball off the end of the paddle drops in pitch, gains noise and dies faster,
which is what a mis-hit sounds like in the sport.

Audio is synthesised rather than sampled, so a hit is a continuous function of
exit speed and contact offset rather than one of a handful of clips. Press M to
mute.

The behind and side cameras lean with the rally and flinch on a hard contact.
The top camera does neither — it is what you use to read where the opponent is
holding, and an instrument that moves is not telling you where anything is.

None of this touches the simulation, and all of it runs on real elapsed time
rather than simulated time. `docs/adr/0004-feel-lives-in-the-renderer.md` says
why, and what it costs.

## What the end of a game tells you

Not the score — you already know the score. Two numbers per player: how many of
the balls hit at you that you got back, and how many of the ones you got back
you then mis-hit. They are kept apart because they are different problems with
different fixes, and the card names whichever one cost you more:

> Most of what you lost, you lost by not getting there — 4 rallies to 0. Move to
> the ring, not to the ball: it shows where you can strike, which is a different
> place.

Those are the same two numbers `tools/tally.mjs` uses to separate the difficulty
levels. Escape pauses and shows the same card mid-game.

## Tools

Four, and they answer different questions. Only the first one gates a merge.

```bash
npm run verify            # typecheck, 202 tests, production build
npm run tally steady      # what KIND of game is this — shots, faults, hold rate
npm run playtest 6 club   # can a person win — three levels, three stand-ins
npm run perf              # does a tick still fit in 8.3 ms (p50 2.3, p99 5.7)
npm run playtest:browser  # real keys, real DOM, real renderer, in Chromium
npm run watch             # record the game playing itself, as an mp4
npm run shots             # still frames of the court, for the README
npm run doubles           # what shape is the pair standing in, and does the rally last
npm run profile           # is this the same sport, against charted real matches
npm run ship -- --help    # end a build day: verify, commit, tag, package
```

`tally` and `playtest` are where every design finding since Day 5 came from, and
they disagree about the levels on purpose — see the note on `LEVELS` in
`src/sim/opponent.ts`.

## Plan

Ten working days to a playable singles match, then a review block, then doubles.
Day 14 of 30 as of this writing.

- `docs/backlog.md` — the day-by-day plan through Day 30, every open ticket, and
  what has been deferred behind what.
- `docs/daylog.md` — what actually happened. Five sign bugs with the same shape,
  one that a working feedback loop hid for a day, and four separate occasions
  where a test harness measured itself instead of the game.
- `docs/adr/` — the five decisions that would be expensive to reverse.

## Where to start reading

Depends on why you are here.

| You want to | Read |
| --- | --- |
| Play it | "Running it" above, then "Playing it" |
| Understand the architecture | ADR-0001, then the `sim`/`render` seam above |
| Change the physics | ADR-0002, then `src/sim/ball.ts` and `paddle.ts` |
| Work on doubles | ADR-0005, then `src/sim/rules.ts` |
| Know what is broken | `docs/backlog.md`, ranked |
| Know why something is the way it is | `docs/daylog.md`, by day |
