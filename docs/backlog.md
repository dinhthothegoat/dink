# Dink: Pickleball Rivals — two-week plan

Rescoped on Day 3 from six sprints to **ten working days**, ending in a
playable singles game against an opponent, on one court, with real rules and a
score. The original plan was a production roadmap; this is the smallest thing
that is actually a game, with everything else deferred behind it.

What that costs, stated plainly: no doubles, no progression, no audio beyond
the basics, no player models past capsules, no Steam packaging. Those are still
in the project, just after the game exists and can be played.

The rule for the whole two weeks: **something playable at the end of every
day**. A day that ends with a broken build has failed regardless of how much
code it produced.

## Week 1 — the ball, the paddle, the player

| Day | Goal | State |
| --- | --- | --- |
| 1 | Ball flight, bounce, court, net. Deterministic loop, headless tests | Done |
| 2 | Aerodynamics calibrated to measurements. Paddle contact. Shot solver | Done |
| 3 | Player movement and reach, input, swing timing, playable practice court | Done |
| 4 | Rules: serve, two-bounce rule, side-out scoring (kitchen is now a rail) | Done |
| 5 | Rally state machine, scoreboard, call-outs. A point can be won and lost | Done |

## Days 12-20 — doubles

Nine days, planned after v1.0.2. The options considered and why this one won are
in `docs/daylog.md` under Day 11; the short version is that doubles is the
largest stated want, and the one piece of debt it depends on has been open since
Day 4.

**The whole block is a bet on one thing being true**, and it is stated here so it
can be checked rather than assumed: that doubles is still recognisably doubles on
this court. Doubles is decided at the non-volley line — dinking, resets, the
fourth-shot battle — and this game does not have a non-volley line. It has a
physical rail that holds a player 2.41 m from the net, which is DINK-39, logged
on Day 4 as a design decision with its cost noted. Day 12 is that cost coming
due.

| Day | Goal | Depends on |
| --- | --- | --- |
| 12 | The kitchen: replace the rail with the real non-volley rule | Done |
| 13 | Teams: widen the simulation from two players to four | — |
| 14 | The doubles rulebook: serve rotation, two servers, the three-number call | 13 |
| 15 | The partner: ball ownership, so two players never both chase or both leave | 13 |
| 16 | Formations: side-by-side and up-and-back, the middle ball, stacking | 15 |
| 17 | Doubles playtest and balance | 14, 15, 16 |
| 18 | Modes: practice feed, target challenges, an opponent ladder | — |
| 19 | Around the game: settings, remapping, persistence, controller | — |
| 20 | Playtest, balance, package, ship v1.1 | everything |

### Where the risk actually is

Not Day 15. The partner AI looks like the hard day and is not: the opponent has
emitted nothing but `InputFrame`s since Day 6 and already drives either end of
the court, so a second brain is cheap. The hard part there is arbitration, which
is one clear problem.

**Day 13 is the risky one.** Every `Side` in the simulation currently means both
"which end" and "which player", and doubles separates those. `rally.near`,
`rally.farReach`, `Record<Side, Skill>`, `interceptPoint(world, side)` — each
assumes one player per end. The test that this day went well is that all 162
existing tests pass untouched, because singles is doubles with one player a side.

If a day overruns, cut in this order: 16 (formations), then 18 (modes), then
compress 20. Do not cut 17 — an unmeasured mode is how Day 5 ended up with two
players who could not lose.

### The branch this plan is waiting on

A research run on doubles is in flight, and one of its questions is whether a
physical barrier at the kitchen line breaks doubles specifically. Two outcomes:

- **The rail is fatal to doubles.** Day 12 proceeds as written and the block is
  as above.
- **The rail is survivable.** Day 12 becomes the replay recorder instead —
  determinism has been this project's core architectural claim since ADR-0001
  and nothing has ever exercised it end to end. A replay is also the best
  possible bug report and the cheapest playtest artefact, and it would have
  caught more than one of the last two days' findings.

Either way Day 12 is a day, and either way it is spent on the foundation the
rest of the block stands on.

## Week 2 — the opponent, and making it a game

| Day | Goal | State |
| --- | --- | --- |
| 6 | Opponent: movement, interception, shot choice through the existing solver | Done |
| 7 | Opponent difficulty: reaction time and error models, so it misses like a person | Done |
| 8 | Feel: camera work, hit feedback, sound, moment-to-moment polish | Done |
| 9 | A full game to 11: serve rotation, win and lose, restart | Done |
| 10 | Playtest pass, balance, performance, a build worth showing | Done |

## What each day depends on

Day 4 needs the sim event stream, which exists. Day 5 needs Day 4. Day 6 is
the one carrying real risk: an opponent has to decide where to move before the
ball arrives, which needs prediction (Day 3) and shot selection (the solver,
Day 2), and both exist — but shot choice is a design problem, not just code.

Days 8 and 10 are the compressible ones. If something slips, feel and polish
absorb it, because a rough-looking game that plays correctly is worth more than
a pretty one that does not.

## Deferred past the two weeks

Doubles and partner logic. Progression, unlocks, paddle stats. Player and
paddle models with animation. Court variants. Local two-player. Replay
recorder. Electron packaging and the Steam depot. Settings and remapping.
Code-splitting the 550 kB bundle.

## Done so far

| ID | Title |
| --- | --- |
| DINK-1 | Repo, toolchain, layered architecture |
| DINK-2 | ADR-0001, backlog, day log |
| DINK-3 | Deterministic fixed-timestep loop with render interpolation |
| DINK-4 | Ball flight: gravity, drag, Magnus, spin decay |
| DINK-5 | Court geometry, bounce with spin transfer, net collision |
| DINK-6 | Headless physics test suite |
| DINK-7 | Sandbox, three camera rigs, screenshot verification |
| DINK-8 | Paddle contact: face angle, swing path, effective mass, spin |
| DINK-14 | Aerodynamics calibrated against published measurements |
| DINK-17 | Shot intent solver |
| DINK-34 | Third-drop directions, lateral contact, top view and loop fixes |
| DINK-9 | Player entity: movement, court bounds, reach envelope |
| DINK-10 | Deterministic input frames, keyboard and gamepad, press buffering |
| DINK-35 | Swing windup, contact tick, recovery, queued swings |
| DINK-36 | Practice court: feed, play, and a browser-driven play test |
| DINK-40 | Kitchen barrier: fence the non-volley zone instead of ruling it |
| DINK-11 | Rules engine: serve, two-bounce, faults, side-out scoring, game to 11 |
| DINK-12 | Rally: serve, return, both players and the ball on one court |
| DINK-13 | Match Court UI: scoreboard, serve indicator, umpire call-outs |
| DINK-41 | Intercept prediction by re-simulation, memoised per world |
| DINK-42 | Seeded RNG, so opponent mistakes replay identically |
| DINK-43 | Play test plays a real game and checks the scoreboard agrees |
| DINK-15 | Opponent: movement, stance, interception, shot choice, serving |
| DINK-45 | Shot selection by court position, not by shot number |
| DINK-46 | Self-play tally with a per-side fairness check |
| DINK-47 | Opponent intent on screen and in the play test's gate |
| DINK-48 | Serve diagonal derived from one place; all four cases tested |
| DINK-49 | Solver yaw sign fixed; the court is symmetric again |
| DINK-16 | Execution model: pressure, and a biased swing perturbation |
| DINK-52 | Easy, steady and tough presets, with a selector and a pressure meter |
| DINK-53 | Tally reports coverage and mis-hit rate, the two levers kept apart |
| DINK-54 | The serve aimed shorter; hold rate down from 79 to 58 per cent |
| DINK-18 | Synthesised audio: contact, bounce, net and the call |
| DINK-57 | Impact rings: when the paddle arrived, and how cleanly |
| DINK-58 | A camera that leans and flinches, framerate-independently |
| DINK-59 | Real frame seconds in the render callback, separate from alpha |
| DINK-19 | A match: best of three, game records, per-side statistics |
| DINK-62 | Title, between-games, match-over and pause cards |
| DINK-63 | The card says why you lost, not only that you did |
| DINK-64 | opponentOf moved to court.ts, where the geometry lives |
| DINK-55 | Levels measured against a stand-in for a person; tough retuned |
| DINK-38 | Solver preset measured, JIT warmed at load; worst tick inside budget |
| DINK-67 | CI: verify plus all four measuring tools on every push |

## Known debt

- DINK-31. A wind-tunnel source reports topspin/backspin lift asymmetry a
  linear Cl model cannot express, contradicting the trajectory studies we
  calibrated against. Revisit only if spin feel is wrong in playtesting.
- DINK-32. Spin decay in flight is TUNED at a 4 s time constant, no source.
- DINK-33. Paddle-face friction is TUNED at 0.35 and is the lever with the
  most reach over how spin feels.
- DINK-37. Player speed and acceleration are TUNED. Worth a pass against
  broadcast footage once there is a rally to compare against.
- DINK-38. CLOSED on Day 10, and the number corrected in the review after the
  v1.0.0 tag: contact ticks are p50 2.3 ms and p99 5.7 ms over ~500 samples,
  against an 8.3 ms budget. The originally published "worst tick 7.7 ms" was a
  maximum over two hundred samples and re-ran anywhere between 3 and 24 ms — it
  was never a measurement.
- DINK-50. CLOSED on Day 7 by aiming the serve shorter. Hold rate is now 55 to
  61 per cent across all three presets.
- DINK-65. Players do not switch ends between games. Real pickleball does, and
  it matters on an outdoor court with wind and sun — neither of which exists
  here. The camera and controls assume the human is the near player, so this is
  a bigger change than it looks and buys nothing until there is weather.
- DINK-66. The match-over card offers a rematch but keeps no history across
  matches. A session record — matches played, best game — is a small piece of
  state and the natural place for it is browser storage, which nothing here
  uses yet.
- DINK-60. No hitstop and no slow-motion winner, by decision (ADR-0004). If one
  is ever wanted it has to be a `setSpeed` ramp so the simulation genuinely runs
  slower and the input frames record it.
- DINK-61. Audio is synthesised and thin. Real samples would sound better and
  are the obvious upgrade once the build stops needing to be one HTML file.
- DINK-55. CLOSED on Day 10. `tools/playtest.mjs` measures the levels against a
  stand-in for a person; `tough` was a wall and was retuned. What remains, and
  cannot be closed headlessly: nobody has yet established whether the game is
  *fun*, only that it is ordered and winnable.
- DINK-56. Pressure counts pace, height, reach and body speed, but not *time* —
  a ball you have half a second to set up for should be easier than the same
  ball arriving now. The intercept already knows the seconds available.
- DINK-51. Two mirrored games diverge slightly even now, because the solver's
  refinement tries its yaw candidates in a fixed order and a near-tie resolves
  differently at each end. It is search noise rather than bias — the outcome
  measurement is even — but exact rotational symmetry would be a stronger
  invariant to test against.
- DINK-39. CLOSED on Day 12, with a measurement rather than an opinion. The rail
  put 59 per cent of the kitchen out of reach of anybody, and the solver's own
  drop target sat 2 cm inside the answerable band at full stretch — so every
  dink was a winner or a scramble and there was no soft rally. The zone is a rule
  again: stand in it freely, do not volley from it, and do not let your momentum
  carry you in. At `tough` the soft game went from a handful of shots to 29 per
  cent of them.
- DINK-44. CLOSED on Day 7. Errors now come off the swing and land out or in
  the net, and the mis-hit rate separates cleanly by difficulty.
  Original note: `tools/tally.mjs`
  reports 48 rallies with zero balls out and zero into the net — both players
  solve a perfect arc, so every point is won by someone failing to reach. And
  the stand-in's aim *error* beats the scripted player's precision, because
  spread is what makes a ball hard to reach. Day 7's error model has to degrade
  placement in a way that costs the opponent, not just blur it.
- DINK-69. `solveSwing` still allocates two `Swing` objects per candidate,
  about 380 per contact, and that is the dominant remaining source of garbage.
  Fixing it needs a scratch candidate and an explicit copy into the winner,
  inside a loop whose field-override ordering is load-bearing (`base` overrides
  `yaw`; `speed` overrides `base`) and is exercised only by callers that pass an
  empty `base`. Contact ticks already fit the budget with margin, so this is
  filed rather than done.
- DINK-70. CLOSED on Day 11. The other three tools were audited and three more
  defects came out, all in the same statistic and all in a denominator:
  `mishitRate` counted every mis-hit twice, it charged serve faults to a count
  serves were not in, and `coverage` counted balls the opponent had put into the
  net as balls the player failed to reach. Each is fixed with a regression test
  that was watched to fail against the old code. Match outcomes were verified
  bit-identical, so no balance decision rested on any of them.
- DINK-71. Day 7's claim that "coverage and mis-hit rate each separate the
  levels" is half withdrawn. Corrected, coverage in `tools/tally.mjs` reads 73,
  76 and 79 per cent across the three levels and barely separates them; the old
  column separated because it counted the opponent's error rate, which in a
  self-play run is the level's own error rate measured twice. It still separates
  in `tools/playtest.mjs`, where the player is fixed and only the opponent
  varies. Same statistic, sound in one tool and hollow in the other.
- DINK-72. The measuring tools have no tests of their own. Four defects in two
  days against zero in the simulation, which has 158. The arithmetic that is
  shared with the game now lives in `src/sim/series.ts` and is covered; the
  arithmetic still inside the `.mjs` tools is not.
- DINK-68. `tough` no longer separates from `steady` in `tools/tally.mjs`. That
  is the accepted cost of making it beatable, and the self-play tool is the
  wrong instrument for the question — but a level ladder that two tools disagree
  about is worth revisiting with a real playtest.
- CI added on Day 10 (`.github/workflows/verify.yml`): verify on every push,
  plus all four measuring tools so a change that alters the kind of game being
  played shows up in the log of the run that caused it.

## The plan: days 21-30

Days 15-20 stand as written. This is the block after v1.1, and it was chosen
against the strongest fact about the project, which is uncomfortable:

**After fourteen days, nobody outside this repository has played it.** Every
balance number here comes from a stand-in the project wrote itself. That is the
Day 11 failure at project scale — the instrument is the thing least checked —
and four days running it has been the instrument that was wrong, not the game.

### The options, and what each is really a bet on

**A. Ship to Steam.** Wrap in Electron or Tauri, depots, store page, upload.
Cost: three or four days of plumbing that teaches nothing about the game.
Forecloses nothing. Right if the game is already good enough to sell.
*Attack:* Steam refunds inside two hours. A game with one opponent archetype and
no progression is exhausted in forty minutes, and that is a refund, not a sale.

**B. Progression.** A season, named opponents with styles, a rating, unlocks.
Cost: five or six days, mostly content and UI. Right if players want to keep
playing but have no reason to come back tomorrow.
*Attack:* progression on a shallow core is a dressed-up grind, and "unlock the
tough opponent" is strictly worse than a menu that already lets you pick it.

**C. Online multiplayer.** Determinism has been the core architectural claim
since ADR-0001 and nothing has ever exercised it, so lockstep is genuinely
within reach. Cost: the whole block, and a real chance of not landing.
Forecloses every other option for ten days.
*Attack:* a game with no players has nobody to match with. Solving that with
netcode is solving the wrong end of it.

**D. Depth and coaching.** Kill the TUNED physics constants against measured
ball data, and build the read the end-of-game card is already half of: what
your game actually loses on. Cost: four or five days. Right if the audience is
players who care about their own pickleball.
*Attack:* it risks becoming a training tool with a game attached, and that is
not what someone opens at six in the evening.

**E. Do nothing more. Put v1.1 in front of twenty people and wait.**
*Attack:* not free. Twenty people need a build they can run without a terminal,
which is the first three days of A regardless.

### The sequence

No single option is the answer, and the null option is not free but is closest
to right. So the block starts by buying evidence, and only commits its second
half once there is some.

| Day | Goal |
| --- | --- |
| 21 | Package: a desktop build that runs by double-clicking, Windows and macOS |
| 22 | The replay recorder. Determinism finally exercised, and a bug report becomes a seed rather than a description |
| 23 | Playtest with eight to ten real players. Watch, do not explain |
| 24 | Triage what actually broke, fix the top three |
| 25 | Onboarding, because it is always in the top three |
| 26 | Named opponents with distinct styles, and a ladder |
| 27 | The physics debt: measure DINK-31/32/33/37 instead of tuning them |
| 28 | Steam plumbing: depots, build upload, an unlisted beta branch |
| 29 | Second playtest, on the beta branch, against strangers |
| 30 | v2.0 candidate, and the thirty-day postmortem |

**What this costs.** Multiplayer is deferred out of the block entirely, and if
the answer to "why would I play this twice" turns out to be "against a friend",
this plan finds that out on Day 23 and has seven days left to react.

**The trigger that flips it.** If the Day 23 playtest's top complaint is that
there is nobody to play against, days 26 and 27 become netcode and the physics
debt slips to a later block. If instead the players are club players asking what
their own game is doing wrong, option D is the differentiator and 26 becomes the
coaching read rather than a ladder.

**The assumption most likely to break it.** That eight to ten players can be
found and watched by Day 23. Everything after that day is scheduled on the
answer they give, and nothing in the plan replaces them.

## Tickets opened on days 13 and 14

- DINK-73. The partners have no brain. They stand at the non-volley line, the
  rules can see them, and they do not move. Day 15.
- DINK-74. The human and the opponent drive slot 0 only. When a near-side second
  server serves, the ball leaves the correct place but the player standing there
  is not the one swinging. Serving works because `serve()` never consults a
  player, which is luck rather than design. Day 15 or 16.
- DINK-75. Contacting a partner who is touching the non-volley zone is a fault
  (USAP 11.L). There is no partner collision, so it cannot be expressed. Filed
  rather than faked.
- DINK-76. Serving out of turn is a fault in the rulebook and is unrepresentable
  here, because the game only ever lets the correct server serve. Deliberate: a
  fault that cannot occur is a rule nothing exercises.
- DINK-72. CLOSED in part on Day 14. `tools/ship.mjs` has fifteen tests, written
  before it was used once. The four measuring tools still have none.

## Tickets opened and closed on day 15

- DINK-73. CLOSED. The partners have brains. Ball ownership decides who plays
  each ball, once per shot: the rulebook first, then the middle-ball convention,
  then time-to-arrive, with a human always beating their own partner. The null
  hypothesis was measured — with no arbitration, every rally is one shot long,
  because the ball lands between two players who each assumed the other had it.
- DINK-74. CLOSED. Every player has a brain or a keyboard, and its own input
  frame. A near-side second server now has somebody there to serve. The shared
  frame that made this a bug was itself a bug: three brains wrote into one
  buffer, nobody served for a whole match, and it is the third instance of shared
  scratch in this codebase after Day 9 and Day 13.
- DINK-77. **The pair crowds.** Two team-mates are within a metre of each other
  for 23.6 per cent of ticks, all of it at the back of the court (0.4 per cent at
  the net), with mean lateral separation 1.96 m on a court 6.1 m wide. Both
  tramlines are open and they are one shot from colliding. Day 16's acceptance
  number: crowding under 5 per cent, mean separation above 2.8 m, without the
  rally length falling.
- DINK-78. Doubles rallies are 3.21 shots against singles' 3.26, and the longest
  is 5 against 7. Doubles should produce LONGER rallies than singles, not the
  same. Probably downstream of DINK-77 and of the third shot: nobody is at the
  line, so nobody has to drop. Day 17.
- DINK-79. Demo mode and doubles are reachable only by URL flag (`?demo=1`,
  `?doubles=1`). Deliberate for now — the rules and the partners are real, the
  interface for them is not — but doubles cannot ship as a mode until it has one.
  Day 18 or 19.

## Tickets opened and closed on day 16

- DINK-77. CLOSED on the crowding half. 23.6 per cent to 2.3 per cent of live
  ticks, against a target of 5. Four hypotheses were tried and three were wrong;
  the one that worked was that a waiting player had no station and stood on the
  singles bisector in the middle of the court. The separation half is NOT met —
  2.58 m against a target of 2.8 — and is being closed anyway, because the
  stations are 3.05 m apart and one player is always away chasing, so the
  geometry does not allow much more. 2.8 was a guess sitting next to two measured
  numbers; chasing it would make the metric meaningless.
- DINK-78. CLOSED. Doubles rallies are 3.52 shots against singles' 3.28, and the
  longest is 8 in both. The cause was never positioning: 94 per cent of doubles
  shots were drives, because the back zone always drives and the team could never
  leave the back zone. The third shot drop exists now.
- DINK-80. `tools/doubles.mjs` was measuring two distinct games and printing
  twelve, because the seeds were fixed and only the server alternated. Fixed by
  giving `createRally` a seed. Filed rather than merely fixed because it is the
  FIFTH harness in this project to measure itself, against one defect in the
  simulation, and the pattern deserves a number of its own: any tool that reports
  an aggregate must be checked by varying the sample size and confirming the
  aggregate moves.
- DINK-81. `planTeam`'s human bias was being applied to computer players in demo
  mode, costing the near pair fifteen of sixteen games. Fixed, but the shape of
  it is worth keeping: the rule was correct and was being applied to the wrong
  kind of player. Nothing in the rule looked wrong.
- DINK-82. The third-shot drop fires only when the opponents are at the net, and
  a team only reaches the net behind a drop. Two correct rules with a deadlock
  between them, broken by the opening positions rather than by a smarter rule.
  Filed as a caution: rule pairs that gate each other need an initial condition,
  and nothing about either rule looks broken when you read it.

- DINK-83. CLOSED same day it was found. Players and the paddle were drawn a
  whole simulation tick ahead of the ball, which is drawn interpolated. The ball
  covers 9.2 cm in a typical tick and up to 23.9 cm against a ball 7.4 cm across,
  so at contact the paddle could be drawn three ball widths from the ball it was
  hitting. Present since Day 1 and invisible to every test, because every test
  measures the simulation and this lived in the last step before a pixel. Found
  by somebody watching a recording.
- DINK-84. `tools/watch.mjs` claimed in its header that a headless browser
  renders at about fifteen frames a second. It renders at about 37 at 1280 wide.
  The tool was already printing the number needed to check it. Corrected. Second
  time a guess written into a comment has been treated as a fact.

- DINK-85. CLOSED. The player model was a capsule from Day 1 to Day 16. There is
  an articulated figure now — torso, head, capped head so it has a front, jointed
  arms and legs, shoes, paddle — built from primitives because the published
  build is a single file that may not fetch anything. The stride is driven by
  distance travelled rather than by time, which is why the legs do not cycle on
  the spot and why it is frame-rate independent without trying.
- DINK-86. CLOSED. **Two of the four doubles players were never drawn.** The
  scene built two `PlayerView`s and nothing had asked for more. Yesterday's
  doubles video was published with half the players invisible. Same root cause as
  DINK-83: every test here measures the simulation, and the scene graph is not
  the simulation.
- DINK-87. CLOSED. The paddle floated beside the player rather than being held.
  Invisible while the body was a capsule. The arm is aimed at the paddle rather
  than the paddle moved to the hand, because where the paddle is is the rule —
  it is where the ball can be met — and moving it would be the renderer lying.
- DINK-88. `tools/shot.mjs` had been photographing Day 3 sandbox scenes that
  stopped existing on Day 4, for twelve days, and nothing consumed the output.
  Replaced. Filed for the shape: a tool nothing reads cannot be caught by CI
  going green, because it went green.

## Tickets from day 17

- DINK-90. CLOSED. The solver demanded a flat 6 cm of net clearance for a drop
  regardless of where it was struck. Right for a dink, impossible from the
  baseline: a pitch error arrives at the net multiplied by the distance it
  travelled. 47 per cent of all rallies ended on shot three and 99 per cent of
  net errors were drops. Clearance scales with distance now, coefficient derived
  from the typical pitch perturbation and confirmed by a sweep.
- DINK-91. CLOSED. `found` conflated "landed where I aimed" with "cleared by as
  much as I wanted", because DINK-90's fix went into the same cost. The ranking
  should weigh clearance; the verdict should not. Also: `found` is read by tests
  and by nothing in the game, which is now said out loud in the source.
- DINK-92. **The kitchen rail survived Day 12 in `receivePosition` and in a test
  called "never places a player inside the kitchen rail".** For five days the
  physics allowed players into the zone and nothing ever asked to go. Fixed for
  doubles; NOT fixed for singles, because letting a singles player into the
  kitchen creates an absorbing state — one rally of 2,569 shots, both players
  parked inside the line, no angle out because one player covers the whole
  width. The real sport breaks that with the lob and by driving at the feet of
  anyone standing in the zone. Neither is modelled well enough to rely on.
- DINK-93. The distance-scaled clearance rule is ON in doubles and OFF in
  singles, and that is a trade rather than a fix. The rule is physically right
  for both. Turning it on in singles moved the ladder from 6/6, 2/6, 0/6 to
  6/6, 0/6, 0/6 — two levels became indistinguishable and unbeatable, because
  the side that plays drops gains from safer drops and a fixed stand-in does
  not. Rebalancing three levels needs a day and a playtest.
- DINK-94. **The middle of the rally distribution is missing.** Doubles rallies
  of 5 to 8 shots are 7.9 per cent against a charted 44, and the shape is
  bimodal: a point either dies in the transition or becomes a twenty-shot dink
  rally. A sweep of DINK-90's constant from 0.00 to 0.06 cannot reach it —
  short rallies stayed between 81 and 94 per cent across the whole range — so
  the lever is elsewhere. Day 18.
- DINK-95. Serve fault rate is 0.0 per cent against a charted 2.3. The serve was
  aimed short on Day 7 to stop the server holding 79 per cent of rallies, and it
  is now too safe to ever miss. Small, real, and a one-line target change.
- DINK-96. The deep-research workflow has now failed twice: 3 usable claims from
  104 agents on Day 14, and a schema error at the first agent on Day 17. Four
  direct fetches beat it in five minutes both times. Stop calling it.

## Tickets from day 18

- DINK-94. Largely closed. Doubles rallies of 5 to 8 shots went from 7.9 per cent
  to 25.6, against a charted 44, and the bimodal shape is gone. The cause was not
  the clearance constant (Day 17's sweep had already ruled that out) but the
  receiving pair camping in the non-volley zone, where every ball is an illegal
  volley, so third shots landed behind them. 81 per cent of rallies ended on shot
  three and in 97 per cent of those the ball came within reach of somebody who
  never swung. Fixed by positioning on the rule the game already enforces.
- DINK-92. CLOSED, and the doubles-only scoping retired with it. A player may
  enter the kitchen to play a ball that has already bounced, and for no other
  reason. The same rule that fixes doubles removes the singles absorbing state,
  so there is no flag: singles games finish in 67 to 206 seconds now.
- DINK-93. Still open, and now measured rather than suspected. Turning the
  distance-scaled clearance on for singles at TEN matches a level gives
  10/10, 0/10, 0/10 — `steady` and `tough` indistinguishable and unbeatable.
  Needs a rebalance day, not a footnote.
- DINK-97. **The long tail is gone.** Rallies of 9 or more fell from 7.4 per cent
  to 0.6, against a charted 13. The old long rallies were players camping in the
  kitchen and were not pickleball; the real ones are two pairs at the line
  trading legal dinks, and this game does not produce those yet. It is the same
  question as the remaining gap in the 5-8 band, from the other end.
- DINK-98. Singles is no longer bit-identical to Day 10. Ten matches a level:
  10/10, 4/10, 0/10 against a published 10/10, 3/10, 0/10. Ordered and inside the
  noise, accepted deliberately, recorded so the next person does not assume the
  published table is still exact.

## Tickets from day 19

- DINK-79. CLOSED. Doubles and watch mode have buttons. The URL flags still work
  and still win when present, because the recording harnesses use them.
- DINK-66. Half closed. Settings persist across sessions: difficulty, mode,
  watch, camera, speed, mute. The results half — a record of matches played —
  is still open, and is deliberately separate: a half-restored rally is worse
  than no rally.
- DINK-99. **The mute button never worked.** Drawn in the panel and listed in
  the controls since Day 8, with `sound.setMuted` and `sound.muted()` both
  implemented, and no line in the codebase ever called them. Eleven days. Found
  while trying to persist the setting, which is an argument for storing a
  preference that has nothing to do with storage: you have to go and look at how
  it is set.
- DINK-89. Dented, not closed. `tools/play.mjs` now clicks the four new controls
  and asserts the game changed, which required the debug hook to expose `mode`,
  `watching` and `onCourt`. Everything else in the last step before a pixel is
  still uncovered.

## Tickets from day 20

- DINK-31. CLOSED on shape, OPEN on magnitude, and deliberately left that way.
  Backspin saturates and topspin does not; both published fits agree on that and
  disagree threefold on how much lift backspin gets. `BACKSPIN_SATURATION_S`
  implements the agreed shape at the conservative magnitude, and a test guards
  against a future edit quietly adopting the larger study.
- DINK-32. CLOSED on form. Spin decay is a length, not a time:
  `dw/dt = -(U/L)*w` (Goodwill and Haake). `SPIN_DECAY_LENGTH = 40` is anchored
  so that at 10 m/s it reproduces the old four-second constant exactly. The
  magnitude is still an anchor rather than a measurement — no pickleball figure
  exists.
- DINK-100. **The flight model is now checked against something it was not
  fitted to.** Six filmed third-shot-drop launch conditions (arXiv 2501.00163)
  flown through our integrator land within 60 cm of the kitchen line and pass
  within 15 cm of the net cord. Every physics test before today checked the model
  against itself.
- DINK-101. The solver's drop leaves two to three degrees steeper than the filmed
  window, because `DOUBLES_CLEARANCE` buys 29 cm of net margin from the baseline
  and real players skim the cord by under 15. That margin is the price of the Day
  17 net-error fix and is only payable while this game's execution error is much
  larger than a professional's. Revisit if per-level execution error lands.
- DINK-102. **`COURT_FRICTION` is inert.** Swept against the rally profile, the
  result is byte identical from 0.52 to 0.90 — above 0.52 every bounce grips and
  the gripping branch never reads the constant. The whole physical range for an
  acrylic court lies inside the dead zone. Value moved to 0.63 (middle of the
  ITF band for hard courts) because it costs nothing and is defensible.
- DINK-33. Still open. Paddle friction has no published figure; the governing
  body regulates surface roughness instead. Same for `NET_RESTITUTION` and
  `NET_CORD_RESTITUTION`, whose comments now say so rather than implying a
  source.
- DINK-37. Still open, with a sharper description. Both pickleball activity
  profile papers were located and read and **neither reports any velocity,
  distance or acceleration** — they are notational studies. The published number
  that does bear on movement, interception rate (90.8 per cent doubles, 80.2
  singles), is algebraically `(L-1)/L` of mean rally length and so is already in
  the profile table. No column was added, because adding it would have been the
  harness measuring itself for the seventh time.
- DINK-103. A guess was typed into a source comment as a measured fact for the
  third time in this project ("the profile and ladder come back unchanged",
  written before either was run). It was true, and it was still a guess when it
  was written. The pattern is now frequent enough to deserve a rule: a comment
  that states a measurement must be written after the measurement, not before.

## Tickets from day 21

- DINK-104. **The Windows and macOS builds have never been run.** They are the
  two platforms Day 23 needs and the two nobody has launched: there is no
  Windows and no macOS in this container. The Windows payload was unpacked and
  inspected (right version, right files, both `.cjs` present), which is not the
  same claim. The first playtester to double-click is the test.
- DINK-105. Both are unsigned. macOS Gatekeeper will demand right-click then
  Open; Windows will show SmartScreen. Acceptable for a playtest with people who
  are told, not acceptable for Steam. Day 28.
- DINK-106. CLOSED. `three` was in `dependencies`, so electron-builder shipped
  it regardless of the `files` allowlist, on top of the copy Vite already
  bundles. app.asar 16 MB to 588 KB. The rule worth remembering: the allowlist
  does not override `dependencies`.
- DINK-107. CLOSED. The panel had said v1.1 since Day 11, in a build tagged
  v1.2.1. Now injected from `package.json` at build time. A downloaded build
  that cannot say which build it is makes every bug report against it useless.
- DINK-108. `npm run verify` does not cover the desktop build, because
  `desktop:verify` needs a packaged binary and a virtual display and takes
  minutes. So the ship tool can tag a release whose desktop build is broken. It
  should at minimum refuse to package a day that touched `desktop/` without a
  desktop verification having been run.
- DINK-109. The AppImage's self-mounting path is untested: this container has no
  FUSE, so only the extracted payload was launched. A real Linux machine would
  close this in ten seconds and it is the cheapest of the three platform gaps.
- DINK-110. The macOS zips are 352 MB and 364 MB against a 119 MB AppImage and a
  95 MB Windows exe. Probably the universal/per-arch split and no compression
  worth the name. Not chased today; it is a download-size problem, not a
  correctness one.
- DINK-111. No application icon. electron-builder logged `default Electron icon
  is used`, so every build currently ships with the Electron logo, which is what
  a playtester sees in their dock and taskbar before they see the game.
- DINK-112. A harness that polls on `requestAnimationFrame` while watching a
  game short of frames measures itself, and synthetic mouse input is hit-tested
  against the last composited frame. Both now documented in `tools/desktop.mjs`.
  The general rule for this repository: in a software-rendered environment,
  drive with the keyboard and poll on a timer.

## Tickets from day 22

- DINK-113. CLOSED. Skill and Style are two axes (ADR-0007). Eight named rivals,
  a ladder, a record that survives a refresh.
- DINK-114. **The banger wins 87.8 per cent of doubles rallies with the fewest
  errors of any style.** It was designed to be error-prone and is dominant
  instead, because it hits hard and flat and this game's players cannot cover a
  hard flat ball. That is DINK-37 from a new angle: the movement gap is not only
  a realism problem, it is the balance problem, and the banger is the probe that
  proved it. Do not "fix" this by weakening the banger.
- DINK-115. `ATTACK_HEIGHT` has been 0.95 since Day 5 and sits above the 90th
  percentile of contact heights in every zone (net: median 0.39, p90 0.65). The
  attack branch has almost never fired. Style thresholds are now placed inside
  the measured distribution; `all court` keeps 0.95 as the singles-ladder
  control. Moving it is a balance day.
- DINK-116. `crasher` was built, measured and deleted. In doubles `at line` was
  67.9 per cent for `all court`, `wall` and `crasher` alike, because `planTeam`
  owns court position and the individual does not. `homeDepth` and `netUrge` are
  singles-only dials today. Reviving the style means teaching team plans about
  style, which changes doubles positioning globally.
- DINK-117. CLOSED. `chooseShot` could return an aim outside the court — the
  banger's 1.25 spread times a 0.85 put-away is 1.0625. Harmless because
  `driveOpponent` clamped it, which is exactly why it survived. Clamped at the
  source now.
- DINK-118. The career section was built at the bottom of a scrolling panel,
  below the game speed buttons. DINK-79 repeating inside one day. Moved under
  the score; the general rule is that a new feature goes where the player is
  already looking, not where the markup is easiest to append.
- DINK-119. No relegation. Deliberate while the game is this shallow, and the
  cost is that the climb is monotonic and slightly cheap. The `best` field
  exists so that adding relegation later does not erase anybody's high-water
  mark; there is a test that will fail loudly on the day it is added.
- DINK-120. A career is singles or doubles depending on the panel, and the
  ladder does not care. A rival who is only a doubles player, or a ladder that
  demands both, is a real design question and today it is neither.

## Tickets from day 23

- DINK-121. **CLOSED, and it was the point of the day.** ADR-0001's determinism
  claim is verified: three matches recorded and replayed bit for bit, compared
  exactly rather than within a tolerance, sampled throughout rather than at the
  end. `npm run replay`. The check carries its own negative control, so a green
  result means something.
- DINK-122. **CLOSED. Every match ever played used seed 0.** `createRally` has
  taken a seed since Day 16 and nothing ever passed one, so the opponent's
  random stream was identical from the first serve of every match in every
  session on every install. Found only because breaking the seed deliberately
  required the seed to exist. The distinction it hid is reproducible against
  identical.
- DINK-123. CLOSED. The replay recorder, deferred from Day 22 twice. Every match
  records; `Copy replay` puts it on the clipboard. Clipboard rather than file
  download because a published artifact cannot start a download at all, so the
  obvious button would have silently done nothing for most playtesters.
- DINK-124. The playtest itself is not done and cannot be done from here. The
  protocol is `docs/playtest.md` and the blocking resource is eight to ten
  people. Everything scheduled after Day 23 is waiting on it, exactly as the
  plan said it would be.
- DINK-125. Nothing yet REPLAYS a recording inside the game — `npm run replay`
  proves the format round-trips, but a player cannot watch their own match back.
  That is the half that makes a replay a feature rather than a diagnostic, and
  it needs a playback screen and a scrubber.
- DINK-126. `newSeed` uses `Math.random`, which is the one place in the whole
  codebase that is not a named seeded stream. Correct — the seed has to come
  from somewhere outside the simulation — but it means a career cannot yet be
  replayed as a sequence, only match by match.
- DINK-127. Replays carry the build version and refuse to load across formats,
  but there is no check that the SIMULATION has not changed within a format
  version. Bumping `REPLAY_VERSION` is a manual discipline, and manual
  disciplines in this project have a poor record. A hash of the physics
  constants would make it automatic.


## The plan to day 100

Days 21-30 above are superseded by `docs/plan-100.md`, written on day 23 after
the determinism check and before the playtest. Seven blocks, each with an exit
criterion that can be checked rather than felt:

| Block | Days | Goal | Exit criterion |
| --- | --- | --- | --- |
| 1 Evidence | 24-31 | The playtest, and acting on it | 8 sessions run, blocked pile empty, two fresh players win a point untold |
| 2 Movement | 32-45 | DINK-37, the core defect | 5-8 shot rallies within 1.3x of real; unreachable below 45%; banger below 65% |
| 3 Identity | 46-56 | Steam page LIVE by day 52 | Page live, build uploads, one-sentence description from somebody else |
| 4 Feel | 57-70 | Animation, audio, coaching, tournament | A returning playtester plays 40 minutes unasked |
| 5 Gated | 71-82 | Netcode or depth, decided by Block 1 | Two humans play each other on purpose |
| 6 Demo | 83-92 | Demo, strangers, Next Fest | A stranger finishes the demo and asks when it is out |
| 7 Launch | 93-100 | Ship it | On sale, runs elsewhere, first crash report has a seed |

The descope order, decided in advance so it is not improvised under pressure:
tournament, then extra rivals, then in-game replay playback, then netcode down to
local two-player, then Next Fest. Never cut: the blocked pile, the movement exit
criteria, the store page by day 55, or the second playtest.

## Tickets from day 24

- DINK-111. CLOSED. The application icon exists, is generated from
  `tools/icon.py` rather than checked in as a blob, and all seven sizes are
  verified present inside the Windows exe by reading the icon group out of the
  binary — not by the absence of a build warning.
- DINK-128. CLOSED. The favicon 404 that appeared unexplained in Day 22's
  harness output. Inlined as a data URI because a linked file 404s in the
  published artifact, which is where most playtesters will play.
- DINK-104. STILL OPEN and it is the top item on the board. The Windows build
  has now been built five times and launched zero times. Everything verifiable
  from here is verified; the remainder needs a Windows machine and five minutes.
  `docs/playtest.md` has the procedure.
- DINK-105. Unsigned, so SmartScreen will block the exe and Gatekeeper will
  refuse the .app outright. Now written into the playtest procedure rather than
  left to surprise somebody mid-session. Still Day 28 work for Steam.
- DINK-129. The icon is a paddle and a ball on the game's own palette, which is
  fine for a taskbar and is not a capsule. Block 3 needs real capsule art at
  Steam's several sizes, and that is the first work in this project with no
  precedent in the first 24 days.

## Tickets from day 25

- DINK-130. CLOSED. Player models rebuilt: tapered limbs, a torso that tapers
  and twists, an `upper` group hinged at the hips that did not exist before, and
  an athletic ready stance. Before and after at `docs/shots/models-before-after.png`.
- DINK-131. **A fore-aft crouch is invisible from this game's cameras.** The
  knee bend was implemented correctly at 0.62 rad and changed the silhouette
  height by zero pixels, because every camera looks down the length of the
  court. Lateral stance width doubled the leg span (72 to 147 px) from the same
  angle. The general rule: for this camera, lateral cues read and fore-aft cues
  do not.
- DINK-132. CLOSED. `?silhouette=1` renders every player material flat black.
  The single most useful check on a character model, and now repeatable rather
  than a thing done once by hand.
- DINK-133. The Day 24 prompt claimed the models had no feet, no neck and no arm
  counter-swing. All three existed. Written from a summary rather than from the
  file: DINK-103's fourth instance. Corrected in place, with the correction left
  visible. **Rule: a brief about a file is written with the file open.**
- DINK-134. The `#view` control did not change camera when driven from the
  harness — three clicks produced three byte-identical renders. Not chased
  today because the silhouette work did not need it, but either the selector is
  wrong or the control is dead, and a dead control is how the mute button
  survived eleven days.
- DINK-135. The swing still does not transfer weight between the feet. The torso
  twists now, which was the larger half, but the feet stay planted through a
  stroke.

- DINK-136. **CLOSED, and the worst defect this project has shipped.** The
  published artifact could not compile `MeshStandardMaterial`, so no player was
  ever drawn in the build people actually play. `ship.mjs` stripped `<meta>`
  tags AFTER inlining the bundle, and `<metalnessmap_pars_fragment>` starts with
  `meta`. Reported on Day 16 and again on Day 25 as "I can only see the blue
  ring" — correct both times, because the rings are `MeshBasicMaterial`.
- DINK-137. **Nothing in this project verified the artifact.** Tests, shots,
  watch, the browser harness and the desktop verifier all run against `dist`.
  The artifact is a separate build step with its own transformations and it had
  no check at all for twenty-five days. `ship` now gates on shader integrity,
  but that is one property; the artifact deserves the same treatment as the
  desktop build — launch it and drive it.

## Tickets from day 26

- DINK-137. CLOSED. `tools/artifact.mjs` launches the published artifact, drives
  it, and asserts a person is on screen. `ship` gates on it. The artifact is no
  longer the one build nothing looks at.
- DINK-138. The silhouette flag cannot be used to verify rendering, and the
  reason is worth remembering: it swaps players onto `MeshBasicMaterial`, which
  avoids the shader path that broke. **A debug view that simplifies the thing
  you are testing cannot test it.**
- DINK-139. Three measurements were wrong before one was right: a WebGL canvas
  read back after the frame (0 pixels on a working build), a full-viewport
  screenshot (counted the amber UI panel as players), and an untightened warmth
  threshold (counted the paddle and the ball). Only the third produced a number
  worth trusting, and only because both builds were measured rather than one.
- DINK-140. The artifact check runs at one viewport, 1280x800, on a software
  renderer. It would not catch a defect that only appears at phone width or on a
  real GPU, and the phone is where most playtesters will be.

## Tickets from day 27

- DINK-134. CLOSED. **Aim is two axes.** Depth was never a control: `targetFor`
  derived `targetZ` from the shape alone, so a drive always landed at 72 per cent
  of the way back and a drop always at 0.6 of the kitchen. Three shots where the
  sport has a plane of them. `aimZ` in -1..1 now moves the target within a range
  that belongs to the shape — a drop stays inside the kitchen at both extremes, a
  drive never falls into it — so depth is a placement decision rather than a
  side effect of which key was pressed.

  The neutral position is the whole safety argument and it is tested rather than
  asserted: `aimZ = 0` reproduces the old target **exactly**, swept across every
  shape, both ends and the full lateral range, compared with `toEqual` against
  the pre-change expressions written out longhand in `tests/aim.test.ts`. The
  opponent and the `playtest.mjs` stand-in both pass 0, so the difficulty ladder
  (6/6, 3/6, 0/6), the rally profile and the hold rate are measuring the same
  game they were calibrated against. That was the constraint the design was
  built around, not a property discovered afterwards.

- DINK-135. **SUPERSEDED within the day by DINK-144. Left here because the
  reasoning was sound and aimed at the wrong problem.** The finding was real: a
  keyboard had three lateral aim points where a gamepad had a continuum, so the
  cruder game was the one nearly everybody plays. The fix was a 0.28 s ramp on
  the arrow keys, framerate-independent, tested at 60, 120 and 165 Hz. All of it
  worked. None of it survived, because it improved the resolution of a control
  that should not have existed — the ramp was the answer to "how do I aim more
  finely with the arrows", and the actual question was "why are there arrows".
  **Making a control better is not the same as asking whether it belongs.**

  One thing from it is worth keeping. The ramp's framerate test first compared
  60 Hz against 165 Hz and failed on its own loop rounding, not on the code; it
  was rewritten to compare each rate against the analytic answer, because "are
  the two clocks equal" has a one-frame floor a version that forgot `dt` could
  hide under. Second time in this project a measuring tool was the broken thing,
  after DINK-71 and the four instruments of Day 11.

- DINK-136. CLOSED. **Aim had no feedback and never had.** The title card said
  "arrows to aim" and nothing on screen ever moved. Survivable while aim was
  three lateral positions; not survivable now it is a plane. An amber ring on the
  far court draws `targetFor` every frame — deliberately the target and not a
  solved landing point, both because the solver is a thousand trajectories and
  because promising a landing point would lie about the execution model, which is
  the uncertainty the game is made of.

- DINK-141. Replay format is 2. An InputFrame gained an axis, so version 1
  recordings are refused rather than read with a zero default, which would
  replay a different match from a file claiming to be the same one. Any replay
  collected before this build is unreadable — worth knowing if one arrives with
  a bug report. `tools/replay.mjs` now feeds `aimZ` **unrounded**, unlike every
  other axis it generates, because a ramped keyboard produces values like
  0.714285… and a determinism check fed only whole numbers would never exercise
  inexact float storage. Three matches still replay bit for bit.

- DINK-142. **The opponent does not use the depth axis.** `chooseShot` returns
  lateral aim only and `driveOpponent` writes `aimZ = 0`. This is deliberate —
  see DINK-134 — but it means the player now has a control the stand-in does not,
  which is the first asymmetry of its kind in the game. Teaching the policy to
  aim at the feet in the transition zone, or to push a dink deep against somebody
  crowding the line, is a real tactical gain and a real balance change, and it
  wants its own day with `tools/playtest.mjs` run before and after. Not the
  evening before a playtest.

- DINK-143. Aim is latched at the press (`queuedAimX`/`queuedAimZ`) and the
  marker draws the LIVE aim, so during the 120 ms windup the ring can show
  something other than the shot actually in flight. Defensible — the ring is
  "where your next shot is pointed" — but it is the kind of half-truth a
  playtester finds and cannot articulate. Watch for "the ring lied to me" in the
  Day 23 notes before deciding whether the marker should freeze at the press.

- DINK-144. CLOSED. **One direction control, not two.** The arrows were a second
  direction control on the other hand, read independently of the movement. WASD
  now steers the player *and* points the shot, and the swing keys commit whatever
  is held; the left stick does both on a pad, for the same reason. Arrows are
  still swallowed so a player reaching for the old control gets nothing rather
  than getting the page scrolled out from under them.

  The argument for merging is that where you are going and where you are hitting
  are one decision in the sport and were two in the game. The argument against is
  the same sentence read the other way, and it is the thing to watch: a shot
  played on the run now goes the way you ran, so hitting behind somebody means
  planting first. That is either the best mechanic in the game or the reason
  three of eight playtesters bounce, and this project does not get to decide
  which from the inside. See DINK-145.

- DINK-145. **The open question the Day 23 playtest now has to answer.** Watch
  for a tester who runs wide, swings, and puts the ball exactly where the
  opponent already is — repeatedly, without ever saying why. The protocol's
  "first time they said anything out loud" and "every question they asked" lines
  are where this shows up, and the question will sound like "how do I hit it over
  *there*". If three of eight hit it, the fix is not more explanation: it is
  either a short grace window where the aim holds after the key is released, or
  the arrows coming back as an optional override. Both are a day's work and
  neither should be guessed at now.

- DINK-146. **Merging the controls cost the keyboard its fine aim, on one axis.**
  Aim is the raw held direction rather than a ramp, because ramping cannot
  survive the merge: KeyW is how you run, so a ramp would mean running forward
  slowly aimed you further and further short. So a keyboard is three-valued per
  axis again — but on two axes, which is nine targets against the three the
  arrows gave before any of this. A stick stays fully analog and is where fine
  aim now lives. Pinned as a number in `tests/aim.test.ts` rather than left as a
  claim, because "did this make aiming cruder" deserves an answer and the answer
  is only yes on one axis.
