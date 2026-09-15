# Day log

One entry per working day. Written the way a standup update is written: what
moved, what broke, what is next.

---

## Sprint 1, Day 1 — 2026-09-07

### Done

- DINK-1. Repository, Vite + TypeScript + Three.js toolchain, Vitest, and the
  three-layer split the architecture depends on: `src/sim` (no renderer
  imports), `src/render`, `src/core`. One command verifies everything:
  `npm run verify`.
- DINK-2. ADR-0001 records the engine decision and the reasoning behind the
  sim/render seam. Backlog laid out to a vertical slice in six sprints.
- DINK-3. Fixed 120 Hz loop with an accumulator, clamped against death
  spirals, with the renderer interpolating between the last two sim states.
- DINK-4. Ball flight: gravity, quadratic drag, Magnus lift through a capped
  linear lift-slope model, exponential spin decay. Real ball constants —
  0.0264 kg, 74 mm, hollow-shell inertia.
- DINK-5. Regulation court, sagging net with a separate cord restitution, and
  a bounce model that runs the sliding-versus-gripping test properly rather
  than just reflecting velocity.
- DINK-6. 25 headless tests covering constants, aerodynamics, flight, bounce,
  geometry and shot archetypes. They run in 450 ms.
- DINK-7. Physics sandbox with six shot presets and three camera rigs, built
  and verified by screenshot in a headless browser.

### Found and fixed

Three real bugs, all caught by tests or by looking at the output rather than
by reading the code.

1. **Spin sign convention was inverted.** Topspin was making the ball float.
   Rather than flip a sign until the test passed, the convention is now
   derived in a comment from the contact-point velocity, and callers go
   through `spinVector(topspinRpm, sidespinRpm)` instead of building an
   angular velocity by hand. The failing test was the good kind: it caught a
   real error in the model.

2. **A test asserted physics that does not happen.** The expectation was that
   a backspin ball comes off the bounce slower than a plain one. It does not:
   a hard backspin ball slides through the entire contact, so the friction
   impulse saturates at Coulomb's limit and the rebound speed is identical.
   The check a slice produces comes from the spin it keeps. The test now
   asserts that, plus its mirror image — a topspin ball grips instead of
   sliding and therefore keeps more speed — which is the interesting case.

3. **The ball trail was framerate-dependent.** It was sampled in `render`, so
   in a headless browser running at roughly 1000 fps the ring buffer held a
   fifth of a second of flight and the arc all but disappeared. Sampling moved
   into the fixed step, where it belongs.

### Decisions

- Shot presets are generated, not hand-written. `tools/tune-presets.ts`
  searches launch parameters against a stated intent ("land deep and clear the
  net", "drop into the kitchen") using the live physics constants. Hand-tuned
  presets rot silently the first time drag changes; generated ones can be
  regenerated with `npm run tune`.
- The tuner needs a regulariser pulling toward hand-authored starting values.
  Without one it returned a 22 m/s serve, because nothing in "land it deep"
  says a serve should not be hit as hard as physics allows.
- The ball is drawn at 1.6x its real size. A true 74 mm sphere at broadcast
  camera distance is a couple of pixels.

### Open

- DINK-14, logged during calibration. Magnus lift is strong enough that a
  600 rpm backspin drive lands roughly 2.5 m longer than the same shot with
  topspin. Plausible for a ball this light, but unverified. Fix before shot
  feel gets locked in around it.

### Next

DINK-8, the paddle contact model — the first thing that turns this from a
trajectory simulator into a game. Contact converts swing timing, paddle face
angle and impact point into outgoing velocity and spin, which is where the
TopSpin 2K25 reference actually applies.

---

## Sprint 1, Day 2 — 2026-09-08

### Done

- DINK-14. Closed the calibration debt logged yesterday. Both aerodynamic
  coefficients are now sourced from published measurements instead of guessed:
  Cd = 0.30 and Cl = 0.195*S, with a density rescaling because the studies
  worked at 1.29 kg/m3 and we simulate at 1.225. Ball mass moved to the
  mid-spec 0.0243 kg the drag fit was made against.
- DINK-8. Paddle contact model. A swing is a face orientation plus a swing
  path, and one impulse resolves it. Spin is not an input.
- DINK-17. Shot intent solver, pulled forward from Sprint 3. Give it a target
  and a shape and it finds a swing that gets there, in 10 to 50 ms.
- DINK-8b. 19 new tests, taking the suite to 44. Sandbox rebuilt around the
  paddle: shot presets replaced by solver targets, and the paddle is drawn with
  its swing-path arrow so face-versus-path is visible rather than numeric.

### What the calibration actually changed

The lift slope was five times too strong. That one number had been distorting
everything downstream, and fixing it made the shots more realistic without any
further tuning:

- A drive now solves to 8 to 9 degrees of launch with an apex of 1.05 m. Day 1
  needed 18 degrees and a 1.5 m apex to reach the same depth, because the
  indoor-ball drag coefficient was bleeding speed too fast. A pickleball drive
  is flat, and now it looks flat.
- Realistic spin turns out to be 600 rpm in normal play and 900 at the top,
  not the 1400 to 1800 rpm Day 1's presets carried. There is a hard ceiling now,
  and the sandbox sliders were pulled in to match.

The lesson worth keeping: a wrong constant does not look like a wrong constant.
It looks like a shot that needs an odd launch angle, and it gets compensated for
in the content instead of fixed at the source.

### Found

- **A test that only asserted numbers came out.** The first contact tests
  checked exit speed and spin were in some band. That is a test of nothing.
  They now go through the solver: ask for a third shot drop, check the ball
  lands in the kitchen. If contact breaks, that fails, and it fails for a
  reason someone can read.
- **The panel was quantising the solver's answer.** Face pitch rounded to whole
  degrees moved the landing point 30 cm, so the sandbox visibly missed targets
  the solver had hit. Resolution is now half a degree. Worth remembering when
  the input model is designed: one degree of face angle is 30 cm of court.
- **Paddle friction at 0.5 made spin binary.** Every brushed shot gripped
  completely and pinned the ceiling. At 0.35 the ball slides through part of the
  contact, which is both more physical for a face smoother than strings and what
  makes spin something a player earns by degrees.

### Decisions

- Presets deleted, targets added. A preset is data that goes stale the moment a
  constant changes. A target plus a solver does not.
- `tools/tune-presets.ts` deleted with them. It searched raw launch parameters,
  and the game no longer launches balls; the solver supersedes it and searches
  the parameters that actually exist. Yesterday's good idea, one day old, and
  keeping it would have meant maintaining a tuner for a thing nothing uses.
- The solver moved two sprints earlier than planned, because it is the only way
  to test contact against a property that matters rather than against numbers.

### Open

- DINK-32. Spin decay in flight is still TUNED at a 4 s time constant. No
  published pickleball figure was found, and the study that gave us drag and
  lift does not model decay at all.
- DINK-31. One wind-tunnel source reports a lift asymmetry between topspin and
  backspin that a linear Cl model cannot express. It contradicts the two
  trajectory studies. Left unimplemented and logged rather than picked between.


### Addendum — third-shot drop directions

Added the three drops that matter — down the line, cross-court, at the middle
seam — and with them a lateral contact position, because the three are one
motion aimed three ways and that only reads if they start from the same place
on court. All three solve into the kitchen from the same contact, and a test
checks a drop solved from the left mirrors one solved from the right, since
nothing in the model should prefer a handedness.

Chasing why the top view looked wrong turned up three real bugs, none of which
were in the physics:

- **The top camera had a degenerate up-vector.** Looking straight down with an
  up of +y leaves the view direction parallel to up; `lookAt` falls back on an
  epsilon and the resulting roll is arbitrary. The court was rendering sideways
  and mirrored. Top-down views need an explicit up, and it is now -z, so the
  near baseline is at the bottom and +x is to the right the way a player behind
  the court would see it.
- **The loop was charging the solver's stall to the simulation.** Solving takes
  tens of milliseconds, more in a slow browser, and the accumulator replayed
  all of it as catch-up steps, so a shot was already part way through its
  flight on the first frame anyone saw. `GameLoop.resync()` now discards time
  spent in blocking work that is not simulation.
- **A ball reported as resting was still carrying 7 m/s.** The out-of-play path
  set the flag without zeroing velocity. Harmless today, exactly the sort of
  thing the rules engine would trip over next sprint.

The tool that found all three was a live telemetry line — tick, position,
speed, rest state — added to the panel. Before it, the argument was "that looks
wrong". After it, the numbers said what the ball was doing and the disagreement
was with the camera, not the physics. It stays in.

Two smaller changes came out of the same look: the trail now stops at the first
bounce, and a ring marks where the ball landed, green for in and red for out.
The ball goes on bouncing and rolling well off the court after it lands, which
is honest, but drawing all of it buried the trajectory being judged.

### Next

DINK-9 and DINK-10: a player entity that has to move to the ball and reach it,
and input to drive it. Contact currently happens wherever the sandbox says it
does. Making a player travel to the contact point is what introduces the first
real constraint on which shots are possible.

---

## Week 1, Day 3 — 2026-09-09

Rescoped today, at the owner's request, from six sprints to ten working days
ending in a playable game. `docs/backlog.md` is now that plan. The shape of the
day did not change — player and input were on the critical path either way —
but everything after it did: doubles, progression, models, audio and Steam
packaging all move behind "the game exists and can be played".

### Done

- DINK-9. Player entity. Acceleration-based movement, court bounds, and a
  1.15 m reach envelope. How stretched a contact is becomes one number, and
  that number is handed to the paddle as an impact point on the face, so a
  player at full stretch catches the ball off the end and the Day 2 contact
  model punishes it for real physical reasons. No damage multiplier written.
- DINK-10. InputFrames. The simulation never sees a keyboard; `core/input.ts`
  is the only file that knows one exists. Two separate buffers, one for a
  press between ticks and one for a swing asked for mid-swing, because they
  expire for different reasons.
- DINK-35. Swing windup of 120 ms and 200 ms recovery. Pressing when the ball
  is already in reach is pressing too late.
- DINK-36. The practice court: a feeder, a player, keyboard and gamepad, live
  telemetry, and a session tally. This is the first build that is played
  rather than watched.
- 19 new tests, 67 total.

### Found

Three bugs, and the interesting thing is which tool found which.

1. **Every shot was aimed at the player's own half.** `targetFor` computed the
   far side as `-facing` when facing already points down court. The solver
   then could not reach a target 60 cm behind the contact point, returned
   whatever it had, and the ball squirted sideways out of play. The unit tests
   did not catch it because the test asked `isInBounds`, which counts the
   player's own half as in — so the assertion was true while the behaviour was
   completely wrong. The browser play test caught it on its first useful run,
   because it reads the same "IN" the player reads.
2. **The ball machine put every feed into the net.** The first version pointed
   a velocity vector at the target and picked an elevation that looked right.
   Pointing at a target is not reaching it once drag and gravity exist. It now
   goes through the shot solver, like everything else that puts a ball on this
   court.
3. **The feed was a drive, and a drive is a terrible practice ball.** It skids
   through at ankle height. A lofted feed lands short and sits up into the
   strike zone, which is what a coach with a basket actually does.

### Decisions

- **The browser play test stays.** An autopilot running inside the page, reading
  the on-screen telemetry and dispatching real key events. The first version
  drove the keyboard from Playwright, which meant a round trip per key and a
  player lagging by 300 ms — it was measuring the harness, not the game.
  In-page it plays at frame rate through the same window listeners a person
  uses. It is the only test that covers DOM events through to a landing.
- **The slider sandbox is gone.** Right tool while flight was the only thing
  that existed, superseded by being able to play.
- **Telemetry earns its place twice.** The live readout added yesterday to
  diagnose a camera is now what lets a headless harness play the game without
  reaching inside the simulation. Instrumentation added for one problem paying
  for itself on the next one is a pattern worth noticing.

### Open

- DINK-37. Player speed and acceleration are TUNED, anchored to the court size
  rather than measured. Worth a pass against footage once there is a rally.
- DINK-38. The solver runs inside the tick that resolves contact. Fine for one
  player at 10 grid steps; two swinging in the same tick is unmeasured.


### Addendum — game speed

The shots were too fast to play. At full speed a struck drive crosses the court
in about seven tenths of a second, which is accurate and unplayable.

The fix is a game-speed scale on the loop, defaulting to 0.6: the simulation
still ticks in exact SIM_DT steps, it is just fed less real time per second. It
is worth being clear about why this rather than the two alternatives that look
simpler.

Slowing the ball alone would have left the physics disagreeing with itself: the
solver would compensate by finding harder swings, contact speeds would stop
matching the paddle model, and every calibrated constant from Day 2 would
quietly become decorative. Slowing the ball but not the player would change
which shots are reachable, which is a balance change disguised as a speed
setting.

Slowing everything together is the only version that changes nothing about the
game and everything about playing it — because human reaction time does not
scale with the simulation. That is the whole effect being bought.

The accumulator moved out of the loop class into a pure `advance()` so the
scaling and the stall clamp could be tested without a browser. Four tests,
including one that a slow-motion frame sequence does not drift: sixty frames at
0.6 speed must add up to 0.6 s of simulation, not 0.6 s minus sixty roundings.

Speed is a panel control — slower, default, faster, real time — because 40 per
cent was a starting point, not a finding, and the person playing it is better
placed to judge it than a number in a constants file.

One visual bug fixed alongside it: the paddle tracked the ball's height even
when the ball was four metres up and unreachable, dragging it to full stretch
over the player's head. It now returns to a ready height whenever the ball is
out of reach, which is also a truer picture of what the player can do.

### Next

Day 4: rules. Serve, the two-bounce rule, non-volley-zone faults, side-out
scoring. The sim event stream was built for this on Day 1 and has not been
asked to do anything yet.

---

## Between days — kitchen barrier

Asked for a barrier around the kitchen, so the non-volley zone is now a rail a
player cannot walk through rather than a rule they can break.

This is a design decision, not a shortcut, and it is worth writing down as one.
In the real sport you may stand in the kitchen; you simply may not volley from
it. A rule needs teaching, a fault call, and a moment where a player is
punished for something they did not see coming. A rail teaches itself the first
time you walk into it.

What it costs: reach is 1.15 m and the rail holds a player 2.41 m from the net,
so balls dying deep in your own kitchen are now unreachable rather than merely
hard. That is a real change to the soft game, and DINK-39 keeps the actual
non-volley rule on the table if the barrier turns out to hollow it out.

Three details that mattered more than the wall itself:

- **The ball goes through it.** Dinks and drops have to land in there or the
  soft game stops existing, so the barrier is drawn low and translucent and
  exists only in the player's movement clamp. There is a test for exactly this,
  because it is the one way this feature could quietly ruin the game.
- **It ends at the sidelines.** A player can still run around the outside to
  chase a wide ball, which is what a real player does.
- **It is a wall, so it lives with the other walls.** The kitchen clamp sits
  beside the net and the fence in the movement code rather than becoming a
  special case in a rules engine that does not exist yet.

---

## Week 1, Day 4 — 2026-09-10

### Done

- DINK-11. The rules of a singles game, as a state machine fed by simulation
  events. Serve legality, the two-bounce rule, faults, side-out scoring, game
  to 11 win by 2. 20 tests, all passing on the first run, which is the payoff
  for the seam rather than luck: the rules touch no physics and no renderer, so
  every case can be written as "the ball bounced here, who gets the point".

### Shape of it

`onHit(match, side)` and `onSimEvent(match, event)` in, `RuleEvent[]` out. The
engine is handed facts and answers with faults, points and whose serve it is.
Two consequences worth having:

- The whole rulebook is testable without launching a ball. A fault for serving
  into the kitchen is three lines of test, not a trajectory.
- The opponent on Day 6 can ask the rules what is legal instead of
  reimplementing them in its own head, which is how the two quietly drift apart
  in every sports game that gets this wrong.

The non-volley rule is absent, and that is the barrier decision showing up
downstream: the kitchen is a rail now, so there is no fault to call. Whether
that was the right trade is still open as DINK-39.

### The one piece of geometry worth isolating

Which service box a serve must land in is the only rule here that is easy to
get backwards, because "the server's right" and "+x" are the same thing on one
side of the net and opposites on the other. It lives in `serveTargetBox` alone,
with a test that pins the diagonal, rather than being inlined at the two places
that need it.

### Next

Day 5: wire it in. The rally state machine, a scoreboard, and call-outs, so a
point can actually be won and lost on the court rather than in a test.

---

## Week 1, Day 5 — 2026-09-11

### Done

- DINK-12. `rally.ts`: the match. Serve, return, rules, both players and the
  ball on one court, driven by input frames. A point can now be won and lost.
- DINK-13. Match Court UI: scoreboard, serve indicator, service box, umpire
  call-outs, shot readout, new game.
- DINK-41. `intercept.ts`: where a player can meet the ball, by re-simulating
  it. The ring the human stands on, and the function Day 6's opponent runs on.
- DINK-42. `rng.ts`: seeded mulberry32, so a mistake replays identically.
- DINK-43. The browser play test now plays a real game and asserts the
  scoreboard agrees with the match.

A scripted game completes: 48 rallies, 5.4 shots average, longest 20, points
and side-outs both occurring. 113 tests, clean build.

### Seven bugs, all found by playing rather than by testing

Every one of these passed the unit suite. Listing them because the pattern is
the point: the tests were asserting the mechanism and the game was still wrong.

1. **A legal serve nobody returned was called out against the server.** The
   rules judged the second bounce in-or-out before checking whether it *was* a
   second bounce. Ordering, not geometry. Two regression tests now pin it.
2. **The receiver could not return a deep serve** — it was parked on the
   baseline with no room to move back. Serves now park it behind the line.
3. **`receivePosition` stood the receiver in front of the ball.** Third sign
   bug of the project, same shape as the first two: correct on one side of the
   net, backwards on the other. Test checks both directions now.
4. **The intercept vanished the moment the serve landed.** `requireBounce`
   was being read as "the two-bounce rule applies" when it means "a bounce is
   still outstanding". The probe starts from now and cannot see a bounce that
   already happened. Callers pass `mustLet && !bounced`.
5. **The stand-in wandered off while the ball was on the far side**, then
   sprinted at the return. It only asked for an intercept when the ball was
   already its own. A receiver starts moving when the ball is *struck*.
6. **A dribbled shot soft-locked the match forever.** The rules listened for
   bounces and nets and ignored `rest` and `outOfPlay`, so a ball that simply
   stopped ended nothing. This is the class of bug that never appears in a unit
   test, because a unit test does not sit there waiting.
7. **Two perfect players rallied 3039 shots without a fault.** Fixed by giving
   the stand-in a reaction delay and aim error, both seeded.

### The determinism "failure" that was a timeout

The replay test started failing after the intercept work. It was not divergence
— a trace comparison showed 112 identical rallies — it was vitest's 5 s limit.
Chasing it found two real problems anyway: the intercept memo was keyed on tick
number at module scope, so a second match in the same process read the first
one's answers, and a ball travelling away still ran a full 2.5 s probe every
tick. A `WeakMap` per world, an early-out for departing balls and a six-tick
reuse window took the file from 28 s to 7.5 s.

### What the tally tool says, and why it changes Day 6

`tools/tally.mjs` plays a full game and reports how the rallies ended. Across
48 rallies:

```
30  you  · double bounce
18  them · double bounce
```

Not one ball out. Not one into the net. Both players solve a perfect arc to
their target, so **every point is currently won by the opponent failing to
reach, and none by anyone executing badly**. Difficulty lives entirely in
movement and nowhere in the swing.

Second observation, less obvious: the stand-in has aim error and still wins
11-0 against a scripted player with none. Erratic aim spreads the ball into
corners; precise aim sends it somewhere predictable. Accuracy is not the same
thing as difficulty, and an error model that only degrades a shot's *quality*
will make the opponent easier rather than harder. That is a design constraint
for Day 7, logged as DINK-44.

### Debug hooks are a test surface, not a smell

The play test used to scrape the telemetry line with a regular expression. When
the panel was reworded it stopped matching silently — the autopilot froze and
the run reported a *game* failure. Replaced with `window.__dink.state()`, a
named read-only accessor the harness checks for on the first tick. It exposes
the intercept marker deliberately, because the human sees that ring too; giving
the autopilot raw sim state would let it play a game no person can.

The other harness lesson: its cooldowns were counted in frames. A headless
browser runs at about fifteen frames a second and a real one at sixty, so the
scripted player waited four times too long between swings and never got inside
reach. Time, not frames, wherever the clock is the browser's.

### Next

Day 6: the opponent. Movement, interception and shot choice through the same
solver the human uses. It is the day carrying the real risk, and the tally
above says the risk is design, not code: an opponent that returns everything
perfectly is already what the stand-in does, and it is not a game yet.

---

## Week 2, Day 6 — 2026-09-12

### Done

- DINK-15. `opponent.ts`: a real computer player. Movement, interception,
  positional stance, shot selection, serving. It emits `InputFrame`s and
  nothing else.
- DINK-45. Shot selection by court position rather than by shot number.
- DINK-46. `tools/tally.mjs` now plays eight games with the same brain at both
  ends and reports the hold rate per side, which is a fairness check.
- DINK-47. The opponent's intent is on screen, and in the play test's gate.

130 tests, clean build. Eight self-play games: 3-5, 184 rallies, 3.6 shots
average, and both ends holding serve at 67 and 72 per cent.

### The opponent produces InputFrames, and only InputFrames

The same four fields a keyboard produces, from the same world a person sees.
That is the constraint the whole day was built around, and it pays three ways:
the opponent cannot cheat by reading the simulation directly, a recorded match
replays with the opponent in it, and the brain drives the near player just as
well — which is exactly how the tally tool now gets two real players to watch.
`stepRally` no longer knows which end is a person. Serving moved into the brain
for the same reason: one code path now serves for a human, for the opponent,
and for a demo mode playing itself.

### Advancing has to be earned

The first version made coming forward a boolean: play a drop, stand at the
rail. It lost 0-11. Every drop sent it sprinting four metres and the next deep
drive went past it, because a player at the rail cannot retreat to the baseline
inside one shot.

That is not a bug in the movement. It is what happens to a real player who
follows a mediocre drop in, and the sport's answer is that you take the ground
one step at a time and stop where you are when they strike. So advancing is now
metres per shot, a shot played under pressure gives ground back, and a drop is
only chosen from inside 4.6 m — the honest, position-based version of the rule
Day 5 paid for when the placeholder played the textbook third-shot drop off a
return of serve struck two metres behind the baseline.

### One end of the court was winning eleven games out of twelve

The fairness line in the tally tool is there because of what it found. With the
identical brain at both ends, alternating who served first and on different
seeds, the near end won 11 games of 12 and held serve 83 per cent against 64.

Finding it took the afternoon, and the sequence is the useful part:

1. **The physics is symmetric.** A ball and its mirror image land in the same
   place to the last bit. So it was above the physics.
2. **The brain is symmetric.** Turn the court through half a turn and it makes
   the identical decision. So it was between them.
3. **The serve geometry was wrong** — for exactly one of the four combinations.
   The far player serving from their left aimed straight down the court instead
   of across it, because `serveTargetBox` worked the diagonal out with an ad-hoc
   boolean while `serveSetup` worked out the serving position separately, and
   the two disagreed. Nothing called a fault, because the legality check read
   the same wrong answer as the shot and the receiver was parked in the same
   wrong place. Both now derive from one `serveFromX`. **It did not fix the
   asymmetry.**
4. **Mirror the entire game** — swap who serves first and swap both seeds — and
   compare tick by tick. First divergence: the serve, tick 108. But the first
   attempt reflected the court through the net, and the two ends do not
   reflect: "the right box" is named from the server's own right, so the ends
   map onto each other by *rotating* the court half a turn, flipping x and z
   together. With the rotation right, the divergence moved to the serve itself.
5. **The solver's initial yaw guess was multiplied by `facing`.** Yaw turns the
   paddle face in the world's x–z plane, and `faceNormal` applies `facing` to
   the z component alone. So the far player's face started turned the wrong way
   across the court on every shot of the game. The refinement loop closed the
   lateral error anyway — which is precisely why nothing ever looked broken.
   Shots landed near their targets. The far player simply reached them from a
   worse starting point, with the sidespin backwards, and lost.

After the fix: 6 games each, 73 per cent hold on both sides.

That is the fourth sign bug of this project with the same shape, and the first
one that a working feedback loop was hiding. The lesson I want to keep is that
**a self-correcting system does not report the error it corrected.** The only
thing that found it was measuring an outcome that had no business being
asymmetric, over enough games that luck was not an explanation.

### Strain was being measured in the wrong place

Second bug, cheaper: strain was computed from where the player was standing
when the swing started, not where they would be at contact. The swing gate
allows a ball up to 0.9 m away, which is 78 per cent of full reach before the
player has moved at all, and the windup is 120 ms of running. So nearly every
shot read as stretched and the opponent spent whole rallies playing defensive
lobs off comfortable balls. Extrapolating the player's own velocity over the
windup fixed it, and the shot vocabulary appeared immediately: drives, drops,
dinks, attacks and resets all show up in the tally now, where before there were
only two.

### What the measurement says now

```
8 games · 184 rallies · 3.6 shots average · longest 12
games won: near 3, far 5
near serving: 86 rallies, held 67%
far  serving: 98 rallies, held 72%
  338  drive · deep drive        52  drop · dink
   30  lob · stretched, reset    29  drop · drop and step in
   23  drive · attack the high ball
  184  double bounce
```

Two things to carry into Day 7. The server holds about 70 per cent of rallies,
which is high — a real singles game is closer to 55. And every single rally
still ends in a double bounce: nobody hits out and nobody hits the net, because
both players solve a perfect arc. That is DINK-44 again, and it is now the
single largest gap between this and a game.

### Next

Day 7: difficulty. Reaction time and an error model that misses the way a
person misses — worse on the stretch, worse under pace, worse when moving —
rather than uniformly at random. The hooks are already fields on `Opponent`, so
difficulty should be a matter of constructing one differently rather than of
editing how it plays.

---

## Week 2, Day 7 — 2026-09-15

### Done

- DINK-16. `execution.ts`: a pressure model and a swing perturbation, so shots
  go wrong the way shots go wrong.
- DINK-52. Three difficulty presets, and a selector on the panel.
- DINK-53. `tools/tally.mjs` reports coverage and mis-hit rate per side, which
  is what a difficulty ladder actually has to separate.
- DINK-54. The serve is aimed shorter, and is no longer the best shot in the game.

141 tests, clean build. The headless browser autopilot — which lost 0-6 to
yesterday's opponent — now beats the steady preset.

### The error goes on the swing, not on the target

Days 5 and 6 ended with the same measurement: across every rally of a self-play
game, not one ball went out and not one went into the net. Both players solved a
perfect arc, so the only way to lose a point was to fail to reach one.

Nudging where a shot is *aimed* would not have fixed that. It produces a
different perfect shot, which still lands in. So the error is applied to the
swing — face pitch, paddle speed, face yaw — and the simulation decides what a
bad contact means. That is the only honest place to get "out" and "into the net"
from, and they appeared immediately.

What scales it is `Pressure`, and its four causes are all things the simulation
already knew: how far the player reached, how fast the ball was coming, how low
the contact was, and how fast they were still moving. A difficulty setting
scales the consequence. It does not invent the cause. That distinction is what
makes the model readable on court: the pressure meter on the panel is high
exactly when the shot looked hard.

### A mis-hit is not a symmetric scatter

The first version scattered evenly, and the ladder came out backwards: the
`tough` preset lost to `steady`. Day 5 had already explained why and I had
written it down — *spread is what makes a ball hard to reach* — so a sloppier
player was simply harder to play against. Error was a free source of difficulty
for the person making it.

The sport disagrees, and so does the contact model already in this codebase. A
player who does not strike cleanly loses pace and opens the face, so the ball
comes off higher, shorter and more central. It sits up. So the perturbation
carries a bias as well as a spread, and the bias closes a loop that was already
half-built: pressure produces a floaty ball, and `chooseShot` has attacked a
high ball since Day 6.

### Head-to-head win rate is the wrong acceptance test

This cost the most time and is the most useful thing learned today.

The obvious way to check a difficulty ladder is to play the levels against each
other. It does not work, because it has a balancing dynamic in it: a cleaner
player hits more predictable balls, which the other player reaches more easily.
Sixteen games of `tough` against `steady` came out 6-10, and the mirrored
sixteen came out 12-4 the other way. Two quite different levels, no signal.

What a person on the other side of the net actually experiences is two numbers,
and neither of them balances:

```
              rally    reached    mis-hit
easy            2.6     55-67%     21-30%
steady          3.7     69-76%     11-13%
tough           4.8     79-80%       2-3%
```

Coverage is what `reaction` and `anticipation` control; the mis-hit rate is what
`level` controls. Added together they hide each other — a preset can be made
worse at one and better at the other while the total sits still, which is
exactly what had been happening. Kept apart, the ladder is monotonic on all
three columns, and each preset can be tuned against the lever that owns it.

### The serve was the best shot in the game

Once execution error existed, the server held 79 per cent of rallies. Real
singles is nearer 55.

The cause was the return of serve: struck from behind your own baseline, off the
bounce, moving backwards, which is the highest-pressure contact there is — so
the error model punished it hardest, and the server won by arithmetic. Aiming
the serve at 0.6 of the way back was making a shot nobody would actually hit.
There is no second serve in pickleball. Nobody hits a serve they cannot afford
to miss. Aiming it shorter took the hold rate to 55-61 per cent across all three
presets and put the return back in the receiver's hands.

That closes DINK-50, which was logged yesterday as balance work for Day 9.

### The human misses too

`HUMAN` has a level of 0.34 rather than zero, and that is a feel decision rather
than a balance one. With zero, a player at full stretch hit exactly the same
shot as one standing still, and the reach ring reddening meant nothing — the
game had been promising a consequence since Day 3 and not delivering one. Now a
comfortable ball is essentially perfect and a stretched one is a real risk,
which is what the ring was always saying.

### Next

Day 8: feel. Camera work, hit feedback, sound. The game is now correct and
beatable; nothing about it yet tells you, in the half second after you press the
key, whether what you did was good.

---

## Week 2, Day 8 — 2026-09-16

### Done

- ADR-0004. Feel lives in the renderer, and runs on real time.
- DINK-18. Synthesised audio: paddle contact, court bounce, net, and the call.
- DINK-57. Impact rings marking when the paddle arrived and how cleanly.
- DINK-58. A camera that leans with the rally and flinches on a hard contact.
- DINK-59. `GameLoop` hands the renderer real elapsed seconds, separately from
  the interpolation alpha.

148 tests, clean build.

### The problem, stated properly

The game was correct and beatable and told you nothing.

A swing commits 120 ms before the paddle arrives, so you press a key and then
wait — and nothing marked the moment of contact. Day 7 made shots go wrong under
pressure, but the consequence lands two seconds later when the ball drops out,
long after anyone would connect it to the swing. Both are the same problem: the
game had no way of answering "was that good?" inside the window where a person
is still asking.

So the whole day is about the half second after the key press. The ring marks
*when*. Its colour, and the sound, mark *how cleanly*.

### The decision that shaped the day, written up as ADR-0004

Every satisfying version of these effects in other games reaches into the
simulation. Hitstop freezes the world for eighty milliseconds. A winner triggers
slow motion. That is the temptation, and the rule here is that no effect may
change anything the simulation reads.

Determinism is what this codebase is built on: a rally is a starting state plus
a list of input frames, which is what makes the headless tools work — and every
design finding since Day 5 has come from a headless tool playing thousands of
rallies. Hitstop is a gameplay change wearing a cosmetic costume, and it would
cost all of that.

The cost is stated plainly in the ADR rather than hidden: no hitstop, and no
slow-motion replay of a winner. If a slow-motion moment is ever wanted it has to
go through `loop.setSpeed`, where the simulation genuinely runs slower and the
input frames record it.

### Two clocks, and why the second one exists

`render` now takes `frameSeconds` as well as `alpha`: real time since the last
frame, unscaled by game speed, clamped at 100 ms.

The clamp is for a tab returning from the background. The unscaling is the
interesting half. The game runs at 60 per cent of real time by default, so a
shake decaying in simulated seconds would last two thirds longer at that setting
and nearly twice as long on "slower" — the slow-motion setting would quietly
become a different game to *look* at, with a mushier camera and longer flashes.
Feel should be identical at every speed. Only the play should be slower.

### The follow camera bug that does not look like a bug

`x += (target - x) * 0.1` is how everyone writes a follow camera, and it moves at
a rate that depends on how often it is called. Tuned on a 60 Hz display it is
twice as fast on a 144 Hz one and a crawl in the headless harness at fifteen.
Nobody ever reports this; they say the camera feels wrong.

`approach` uses `1 - exp(-dt/tau)` instead, which covers the same ground in the
same wall-clock time at any frame rate and saturates rather than overshooting on
a very long frame. The tuning is stated as a settling time in seconds, which is
a number that means something. Three tests pin it, including the 15 / 60 / 144
comparison.

### Sound is a function, not a sample

Every sound is a few oscillators and a noise burst built at runtime. Three
reasons, in order of how much they mattered:

The published build is a single self-contained page, so a sample would have to
be base64 in the bundle. A synthesised hit can be a *continuous* function of
what happened, where a sample can only be picked from a short list. And the
mapping is then pure, which is the part worth testing — and it is tested.

What the mapping says: speed raises pitch and level, and off-centre contact
drops the tone, raises the noise and shortens the decay. That second one is the
whole point. It is what a mis-hit sounds like in the sport, and it is the
feedback Day 7's error model had no way to deliver.

The audio context is built on the first key or click rather than at import.
Browsers refuse to start one outside a user gesture, and one created too early
lands suspended and stays there even after the player clicks — silence, with no
error anywhere to explain it.

### The top camera does not move, on purpose

Behind and side lean with the rally and flinch on contact. Top does neither.

It is the view you use to read exactly where the opponent is holding, which is
most of playing against a positional opponent. An instrument that moves when the
subject moves has stopped telling you where anything is.

### Next

Day 9: the game around the game. Serve rotation is in, and a game to 11 already
ends — what is missing is everything either side of it. A start, a proper end, a
rematch, and the state that carries between them.

---

## Week 2, Day 9 — 2026-09-17

### Done

- DINK-19. `series.ts`: a match. Best of three games to 11, a record of each
  one, and per-side statistics gathered from the same event stream the renderer
  reads.
- DINK-62. A title card, a between-games card, a match-over card and a pause,
  all through one `showCard`.
- DINK-63. The end-of-game card says *why* you lost, not just that you did.
- DINK-64. `opponentOf` moved from `rules.ts` to `court.ts`, where it belongs.

158 tests, clean build. Pause is checked end to end in the browser harness:
Escape, the card appears, the world is frozen a second later, Escape resumes.

### The thing that was actually missing

Everything up to yesterday was one game, started by loading the page and ended
by a line of text in the panel. Serve rotation worked, a game to 11 ended
correctly, and there was still no match — no way in, no way out, and nothing to
come back to.

A match is not decoration. It is what makes a bad first game recoverable, gives
the difficulty setting somewhere to be chosen before it matters, and gives the
end of a game something to say.

### What the card says, and why that is the day's real work

"You lost 11-7" tells a player nothing they can act on.

Day 7 spent a day learning that failing to *arrive* and failing to *execute*
have to be kept apart, because added together they hide each other. That was for
tuning the opponent. It turns out to be exactly what a person needs told about
their own game, for the same reason: they are different problems with different
fixes. So the card reports coverage and mis-hit rate for both players, and then
names whichever one cost more:

> Most of what you lost, you lost by not getting there — 4 rallies to 0. Move to
> the ring, not to the ball: it shows where you can strike, which is a different
> place.

The instrumentation for that already existed. `SideStats` is the same pair of
numbers `tools/tally.mjs` has been using since Day 7 to separate difficulty
levels; the only new thing is that a person now sees them.

### Pausing by stopping the loop is wrong

The first version stopped the `GameLoop` on Escape. Resuming teleported the
ball across the court.

The loop accumulates real elapsed time and spends it in fixed steps. Stopping
`fixedUpdate` while `performance.now()` keeps moving means the accumulator holds
however long the player spent reading, and the first frame back replays all of
it at once. The fix is that every screen except `playing` still runs the loop
and simply steps nothing — the camera settles, the panel stays live, the world
holds still — and `loop.resync()` is called on the way back in. `resync` has
existed since Day 2 for exactly this class of problem; this is the third caller.

The browser harness now pins it: pause, wait, compare the ball's position, and
fail if it moved.

### Two small things worth writing down

**A new game builds a fresh `Rally` rather than resetting the old one.** The
rally owns the world, both players, the opponent's stance, the skills and the
rules. `resetRally` was one function that had to be kept in step with five
others and had already gone stale twice. Constructing is one line and cannot
drift.

**The level button on the card cycles rather than opening anything.** The first
version sent the player back to the panel to use the buttons already there,
reasoning that a second copy is a second thing to keep in step. Right about the
duplication, wrong about the flow: dismissing a card to press something else and
finding your way back is three steps to change one word. Cycling in place is one
step and still calls the same `applyLevel`.

### And one the harness found

The title card covers the canvas, so the play test's first action — clicking the
canvas to focus it — started failing. That is the overlay doing its job, and it
is better found here than in a bug report. The harness now clicks Play through
the real button, which is also the only thing that tests the button.

It needed one more change. The autopilot presses through any card it finds, so
it pressed through the pause card in the following frame and the pause check
read "not paused". A flag the harness switches off around that check fixed it —
the same class of mistake as Day 3's, when driving the keyboard from Playwright
measured the harness rather than the game.

### Next

Day 10: playtest, balance, performance, and a build worth showing. The presets
have been tuned against a measuring tool and never against a person, which is
DINK-55 and is now the largest thing standing between this and being finished.

---

## Week 2, Day 10 — 2026-09-18

### Done

- DINK-55 closed. `tools/playtest.mjs`: the levels measured against a stand-in
  for a person rather than against copies of themselves. `tough` retuned as a
  result.
- DINK-38 closed, eight days after it was opened. The solver preset measured
  rather than guessed, and the JIT warmed during loading.
- DINK-67. CI: `npm run verify` plus all four measuring tools on every push.
- Version 1.0.0.

158 tests, worst simulation tick 7.7 ms against an 8.3 ms budget, clean build,
browser play test green.

### `tough` was unbeatable, and the reason is worth keeping

The presets had been tuned since Day 7 against `tools/tally.mjs`, which plays a
level against a copy of itself. That measures the levels against *each other*
and says nothing about whether any of them is a fair fight for a person. DINK-55
had been open about exactly that.

A person cannot be put in a loop ten thousand times, so `tools/playtest.mjs`
puts in the closest honest stand-in: the same brain with a person's limits
bolted on where a person actually has them — replans about ten times a second,
reacts in 250 ms, times the swing to a few tens of milliseconds, reads the
bounce to a handful of centimetres. Three of them, so the question "is this
level too hard, or is my stand-in too bad" can be answered rather than argued.

The first reading, at ten matches a level:

```
                easy      steady     tough
club            10/10      3/10       0/10
strong          10/10     10/10       0/10
ceiling         10/10     10/10       6/10
```

`easy` and `steady` were well shaped. `tough` was not hard — it was a wall. A
strong stand-in swept `steady` twenty games to nothing and took *zero* games off
`tough`; the only thing that could beat it replanned every frame with a 100 ms
reaction, which is not a person.

The cause, once the third row existed to point at it: **`tough` was better than
`steady` on all three axes at once.** Quicker to react, surer in its read, and
cleaner in its execution. A level built that way can only be a wall, because
there is nothing in it for a player to attack.

So it gives movement back. It is still quicker and surer than `steady`, just no
longer beyond anybody, and it errs a little more:

```
                easy      steady     tough
club            10/10      3/10       0/10
strong             —      10/10       4/10
```

Every kind of player now has a level that is a real contest and one above it to
grow into. What it costs is written into the code: `tough` no longer separates
cleanly from `steady` in the self-play tool. That tool was the wrong instrument
for this question, which is the whole reason DINK-55 existed.

### Three tuning passes, and the discipline that ended them

The first attempt softened `tough` on movement and pushed its hold rate to 84
per cent. The second softened it on execution instead and blurred it into
`steady`. The third was inside the noise of the second.

Three misses in a row means the model is wrong one level up, so I stopped
sampling and asked what shape a beatable top level has. That is where "dominates
on every axis" came from, and it took one run to confirm rather than five to
grope towards.

### The solver: measuring the right statistic

DINK-38 has been open since Day 2 — the shot solver runs inside the tick that
resolves a contact, and nobody had measured it. Measured: the first contact of a
session cost 30 ms and the steady-state median 3.3 ms, against an 8.3 ms tick
budget. The 30 ms is JIT compilation, paid by the player as a visible hitch on
their first shot; `warmUp()` now pays it during loading, where it costs nobody
anything.

Then a wrong turn worth recording. A sweep said `{ steps: 6, refines: 6 }` was
40 per cent cheaper for 11 cm of mean landing error against the old 7 cm, and
the argument for taking it was that the execution model already scatters the
best player's shots by a median 18 cm — so four extra centimetres is below the
noise floor. Both halves of that were wrong. The 18 cm was measured on a shot
under *pressure*, and a `tough` player hitting in balance has almost no
execution error, so the solver's own error is most of what remains. And mean
miss was the wrong statistic entirely: what decides whether a shot survives
being perturbed is not where it was aimed but **how much margin it left over the
net**. The cheap preset was quietly picking tighter solutions.

`tools/tally.mjs` caught it in a single run — `tough` went from 3 per cent
mis-hits to 7 and its hold rate collapsed from 60 to 33.

The setting that actually wins is `{ steps: 8, refines: 6 }`: 15 per cent
cheaper *and* clearing the net by a mean 98 cm rather than 78, with half as many
solutions cutting it fine. The reason the two knobs behave differently is
arithmetic — the grid is `(steps + 1)²` full trajectory simulations and the
refinement is seven per pass — so the grid is the expensive knob and the
refinement is the accurate one. Sweeping them independently found it; guessing
at the pair together had hidden it for eight days.

Worst simulation tick is now 7.7 ms of the 8.3 ms budget, so a 60 fps frame
running two ticks fits in 15.5 ms of its 16.67.

### What shipped, and what did not

Ten days, ten commits, 158 tests, four ADRs. A best-of-three match against an
opponent that moves, positions, chooses its shot from where its feet are, and
misses, at three levels that are now known to be ordered for a person.

Not shipped, and each of them is in `docs/backlog.md` with a reason rather than
an apology: doubles, progression, player models and animation, ends changing
between games, sampled audio, hitstop, a session record across matches, and the
non-volley rule — which is still a physical rail (DINK-39), the one design
decision in the project I would most want a real playtest to arbitrate.

The rule held for all ten days: something playable at the end of every one.

---

## Post-release review — 2026-09-18, after the v1.0.0 tag

Ten days of work by one person with no code review. So: a review, on the tagged
release, looking for what 158 tests do not cover. Four defects, and three of them
were in the measuring tools rather than the game — which is its own finding,
because the tools were never reviewed, only trusted.

### The measurement I published was one sample

v1.0.0 shipped with "worst simulation tick 7.7 ms against an 8.3 ms budget".
That number is a maximum over about two hundred samples, which is to say it is
whichever tick a garbage collection happened to land in. Re-running identical
code produced 3 ms, 9 ms and 24 ms. It was never a measurement.

`tools/perf.mjs` now reports the distribution of the ticks that resolve a
contact — the only expensive thing in the simulation — and reports garbage
collection separately, counted by the runtime rather than inferred from a spike.
The honest numbers, over roughly five hundred contacts a side:

```
one human, one opponent   459 contacts over 8 games · p50 2.30 ms · p99 5.72 ms
both on tough             511 contacts over 6 games · p50 2.32 ms · p99 4.82 ms
every other tick                                      p50 0.0024 ms
collection                164 pauses in 1800 simulated seconds, worst 4.85 ms
```

Both inside the 8.33 ms budget. The bad case a player can actually feel is one
contact and one collection landing in the same 60 fps frame, which is 10.6 ms of
16.67 — it fits.

Fixing the tool took three passes, each a separate bug in it:

- It reported **zero** collections in ten minutes of play. `PerformanceObserver`
  delivers on a later turn of the event loop and the process exited first. Zero
  is not a plausible number and should have been read as a broken instrument
  rather than a good result.
- It reported a **p99 over seventy samples**, which is the maximum wearing a
  percentile's clothes. It now refuses to quote a percentile deeper than its
  sample supports.
- Raising the duration to get more samples produced **exactly the same seventy
  contacts**, because the run kept ticking after the game reached 11 and spent
  the rest of its time stepping an empty world. That coincidence is what gave
  the whole thing away.

### The real defect: allocation in the hot path

Hypothesis, stated to be wrong: the outlier ticks are garbage collection, and
the garbage is two functions allocating a whole `World` where they could reuse
one.

`predictBall` created a world on every call, and every player calls it every
tick. `simulateSwing` created one per solver candidate — about 190 per contact,
arriving in a burst at exactly the moment a pause is least welcome. Together,
roughly half a million short-lived objects in five minutes of play.

Both now reuse a module-level scratch, the pattern `interceptPoint` has used
since Day 5. Checked before writing rather than after: nothing in the returned
outcome points back into the probe, because `landing` is the `at` of a bounce
event and `step` already builds that as a copy.

Controlled before and after, same workload, same seed:

```
                collections   worst pause   total
before                   71       4.78 ms   25.5 ms
after                    37       2.40 ms   15.5 ms
```

Half the collections, half the pause. All 158 tests pass unchanged, and
`tools/tally.mjs` returns byte-identical balance figures, which is the check
that the change was behaviour-preserving rather than merely green.

### A theory the evidence killed

I expected to find that a swing queued on the title card or during a pause would
fire the instant play resumed, because `fixedUpdate` returns early on every
screen except `playing` and the input buffer holds a pending press until someone
consumes it.

It does not happen. `controls.frame()` is called on the line *above* the early
return, so the buffer drains every tick whatever the screen. Reproduced in the
browser to be sure: pause mid-rally, press the swing key five times, resume, and
the player stays in `ready`. Wrong theory, no defect, and worth the ten minutes
it took to find that out rather than "fixing" something that worked.

### Dead code with a trap in it

`resetRally` had no callers after Day 9 replaced it with building a fresh
`Rally`. It reset seven fields by hand and had twice gone stale when a new one
was added. Deleted rather than left: a half-correct reset that nothing calls is
a trap set for whoever next needs a reset.

### What I did not do, and why

The remaining allocation is the solver building two `Swing` objects per
candidate, about 380 per contact. Fixing it means a scratch candidate and an
explicit copy into the winner, in the most delicate loop in the codebase — one
whose field-override ordering (`base` overrides `yaw`, but `speed` overrides
`base`) is load-bearing and currently exercised only by callers that pass an
empty `base`.

The budget is already met with margin. Changing that loop on a tagged release
for a frame that already fits is a bad trade, so it is DINK-69 with the
measurement attached rather than a fifth change today.

---

## Day 11 — 2026-09-19. The tools, audited

Yesterday's review found three bugs in `tools/perf.mjs` and filed DINK-70:
*the other three deserve the same pass*. They are what every design decision
since Day 5 rests on, including the difficulty retune of the day before. If one
of them was lying, conclusions already shipped were wrong. So: the audit.

Three more defects, all in the same statistic, and one retracted claim.

### The statistic that was wrong three ways

`mishitRate` and `coverage` are shown to players on the end-of-game card and are
the two numbers Day 7 used to separate the difficulty levels. Each had a broken
denominator.

**A mis-hit was counted twice.** `mishitRate` divided by `returns + mishits`. A
ball hit into the net fires `struck` on the contact tick and `fault` a few ticks
later when it reaches the net — so it is already inside `returns`, and adding it
again inflated the denominator. Verified by counting struck events straight off
the event stream: `returns` equalled the raw struck count exactly, and mis-hits
were a subset of it. The rate was understated by more the worse the player,
which compressed the ladder it was measuring.

**Serve faults had no denominator.** `mishits` has always counted serve faults;
`returns` has never counted serves. So the numerator included shots the
denominator did not, and since the two players do not serve equally often over a
match, their rates were not comparable — which is the only comparison the number
exists for. A serve is a shot struck but it is not a *return*, so `coverage`
needs its own count and one field cannot be both.

**Coverage counted balls that were never chances.** A chance is credited when the
opponent strikes; if that shot goes into the net or out, it was never a ball to
reach. Measured against `easy`: 31 of 292 "chances" had faulted before arriving,
so coverage read 66 per cent where the true figure was 74. Worse, the distortion
scales with how erratic your *opponent* is — heaviest against `easy`, which is
where the number was quoted most.

Each fix has a regression test, and each test was run against the old code first
and watched to fail with exactly the wrong value — 20 instead of 25, 50 instead
of 66.67. A test that has never failed proves nothing.

### The claim I have to withdraw

Day 7 said: *coverage and mis-hit rate do not balance, and each is owned by one
lever.* The second half stands. The first half does not.

With the denominator corrected, coverage in self-play reads 73, 76 and 79 per
cent across easy, steady and tough. It barely separates them at all. The old
column separated cleanly — and it did so because the dilution term was "how
erratic is your opponent", which in a self-play run *is* "how bad is this level".
Coverage was measuring the level's error rate twice, once directly and once
through the contamination. **The bug was doing the separating.**

It still separates in `tools/playtest.mjs` — 88, 72 and 70 per cent — because
there the player is held fixed and only the opponent varies, so the difference is
real signal about the level rather than an echo of it. Same statistic, sound in
one tool and hollow in the other, and nothing about the number itself says which.

### What did not change

Every match outcome. `observe` is a pure observer: it reads the event stream and
writes nothing back, so no balance decision could have depended on it. Verified
rather than argued — the ten-match playtest run returns bit-identical results to
yesterday's, 10/10, 3/10 and 0/10 with the same rallies-won percentages. The
`tough` retune stands on evidence the fix did not touch.

### A green check that could pass for the wrong reason

The browser harness proves that pausing freezes the world by comparing the
ball's position across the pause. The pause lands at a fixed forty seconds,
which is as likely as not to catch the ball sitting still between points — and a
resting ball does not move whether or not the game is paused. It asserts on the
simulation's tick counter now, which has no such loophole.

### Two hypotheses the evidence killed

**Selection effect.** `easy` mis-hits less than `steady` despite a much higher
error level, and the obvious explanation is that a worse player only ever
strikes the comfortable balls. Measured the mean pressure of shots actually
struck: 0.71, 0.72, 0.65 across the three levels. Flat, and if anything backwards.
Dead.

**A structural asymmetry.** `easy` showed 11 versus 5 per cent between the two
ends over 460 shots each, which is the fairness check doing exactly what it is
for. Ran it again with the two random streams exchanged and the split vanished —
8 versus 9, coverage 73 against 73. It follows the seed, not the side. `easy` has
a high error level and is simply more seed-sensitive than the other two, which is
now written at the top of the tool so the next reader is not misled by it.

### Corrected numbers

Self-play, twelve games a level. Rally length and mis-hit rate order the levels;
coverage does not, and is left in only because leaving it out would look like
hiding it.

```
              rally   reached   mis-hit   hold
easy            3.0      73%       8%     64%
steady          3.3      76%       8%     78%
tough           4.1      79%       4%     83%
```

Against a stand-in for a person, ten matches a level. This is the table that
matters, and it is unchanged from yesterday because none of today touched it:

```
            matches won   rallies won   reached
easy (club)      10/10         79%        88%
steady (club)     3/10         44%        72%
tough (club)      0/10         33%        70%
tough (strong)    4/10         47%        73%
```

### The lesson, since there is one

Four defects in the measuring tools in two days, against zero in the simulation.
The game had 158 tests. The tools had none, and were trusted precisely because
they were the things doing the checking. Every one of the bugs was in a
denominator, and every one produced a number that looked entirely reasonable.

A statistic that no test constrains is not evidence. It is a rumour with a
decimal point.

---

## Day 11, afternoon — planning days 12 to 20

Six shapes a nine-day block could take, before picking one.

| | Mechanism | Costs | What must be true |
| --- | --- | --- | --- |
| **A Doubles** | Two players a side; a partner AI | Biggest feature yet; touches rally, rules, intercept, opponent, render, UI; every later change now has two modes to keep working | Doubles is playable on a court with no non-volley line |
| **B Product-ise** | Electron, settings, persistence, controller, quality options | Plumbing; adds a build target, a security surface, an update story | One mode with three difficulties is enough to ask someone to install something |
| **C Content breadth** | Reuse the singles sim: practice, challenges, time attack, an opponent ladder | Low per mode; almost no new simulation risk | The play is good and what is missing is reasons to do it |
| **D Deepen singles** | Player-chosen spin, finer aim, opponent playstyles instead of tiers | Moderate; the solver and error model already support it. Balance is the real cost | Depth is missing rather than breadth |
| **E Consolidate** | Non-volley rule, replay recorder, tool tests, measured constants | Low risk, low visibility | The debt is blocking something specific |
| **F Null / cut** | Declare v1.0.2 done, or cut the Steam ambition and stay a web game | None | The purpose was to build a good thing once, not to have a product |

One attack each, which is where the real information is.

**A** — doubles is the mode most dependent on the thing this game does not have.
It is decided at the non-volley line, and a rail holding players 2.41 m back
means the defining exchange cannot happen. Nine days could produce a 2v2 mode
that is not doubles.

**B** — you do not package a game with one mode. Nine days of chores and it plays
identically. Distribution is not what limits this project.

**C** — breadth on a thin base is padding. Five modes of a game that is not
compelling is five times not compelling. And it is not what was asked for.

**D** — the ask was breadth. Opponent playstyles are cheap enough to be an
afternoon inside C rather than a block of their own.

**E** — invisible to a player, and debt work expands to fill whatever time it is
given. Nine days of it would be self-indulgent.

**F** — worth taking seriously in one respect. Cutting the *Steam* ambition and
staying a web game is probably right on its own merits: the artifact already
loads in one click, which is a lower barrier than an Electron download, and it
deletes option B entirely. Cutting the project is not right — the next day has
been asked for six times running.

### The pick

**A, with E's one blocking item as its first day, and C as the tail if doubles
lands early.** No single option was the answer; the sequence is.

And a thing worth saying plainly rather than filing: **I think the rail was a
mistake, and doubles is what proves it.** It was asked for on Day 4, I built it,
and I logged the cost as DINK-39 — "revisit if the dink game feels hollow once
there is a rally". The dink game is the whole of doubles. The cost is due.

### What would flip it

If the research in flight says doubles survives the rail, Day 12 becomes the
replay recorder instead and the rest of the block is unchanged. If it says the
rail is fatal *and* replacing it is more than about a day, then doubles is a bad
nine-day bet and the block should become C — modes on the singles game that
already works.

That is a checkable condition with an answer arriving, which is the only kind of
plan assumption worth writing down.

---

## Day 12 — 2026-09-20. The kitchen

DINK-39 has been open since Day 4, when the kitchen became a physical rail
because it was asked for and because a fence is readable where a rule is not. It
was logged the same day with a stated cost: *revisit if the dink game feels
hollow once there is a rally*. Doubles is the soft game, so doubles is what makes
it due.

The plan said this day was contingent on a research run. It was not, in the end,
because the load-bearing part of the question is about **this** court and could
be measured rather than read.

### The measurement, which is just geometry

```
kitchen depth            2.13 m
reach                    1.15 m
with the rail: stands at 2.41 m, reaches to 1.26 m from the net
with the rule: stands at 0.28 m, reaches to 0.00 m from the net

of the 2.13 m deep kitchen, a railed player can reach 0.87 m — 41 per cent
the front 1.26 m is unreturnable behind the rail, and ordinary behind the rule
```

Fifty-nine per cent of the kitchen could not be reached by anybody. Not late, not
stretched: there was a fence in the way.

And the number that settled it — the solver aims a drop at 1.28 m from the net,
which is **two centimetres** inside the answerable band, at full stretch. That is
not a margin, it is an accident. Every dink was either an unanswerable winner or
a scramble. There was no dink rally, and a dink rally is the whole of doubles.

The half of the real rule the rail could not express is the half everything runs
on: **you may step into the kitchen to play a ball that has bounced.** You just
may not volley from in there.

### What went in

The zone is a rule again. Standing in it is legal; volleying out of it is a
fault; and your own momentum must not carry you in for half a second afterwards,
which is the call people actually get. The rule lives in `onHit`, because
whether a shot is a volley was already known there — `bouncesSinceHit === 0`
means the ball has not touched the ground since the opponent hit it, which is
exactly what a volley is. Two facts already in the same place, and a rule that
falls out of putting them together.

The court needed no work at all. It has painted the zone and the line since
Day 1; the rail was drawn on top of them and simply stops being drawn.

The opponent needed one line, and it is worth stating which: the gate is on the
**shot**, not on the position. If the ball has not bounced and its feet are in
the zone, it waits for the bounce. Letting the ball bounce is always available
and always legal, so there is never a reason to model retreating.

### Did it work

At `tough`, in eight self-play games: 86 dinks and 47 drop-and-step-ins out of
about 460 shots. The soft game is 29 per cent of everything now. Before, it was a
handful of shots a run.

The shape of that is the confirmation, more than the size: **the better level
plays the soft game more.** At `steady` it is 13 per cent. That is what should
happen once a dink is a rally rather than a coin toss, and it could not have
happened before, because the ball simply landed where nobody could go.

The difficulty ladder survived the change untouched — 6/6, 2/6 and 0/6 against
the club stand-in, against 10/10, 3/10 and 0/10 yesterday at a larger sample. A
rules change this size not needing a retune is worth noticing, and the reason is
that the levels are separated by reaction and error rather than by anything the
kitchen touches.

### Three things about the tests

**The failing test was the right test failing.** `player.test.ts` had a block
pinning the rail, and it broke immediately. Deleting a test because the code
changed is how a suite rots; the block is now the same block asserting the new
truth, and it kept the two of its cases that are still true.

**One of those cases should have caught this on Day 4.** It asserted that a
player at the rail could reach five centimetres past the kitchen line, and called
that "still lets the player reach a little way into the kitchen". It was
measuring exactly the right quantity and accepting the wrong answer. Five
centimetres of a 2.13 m zone is not a little way in, it is 59 per cent of the
zone gone. It now asks whether a player can reach a ball landing *anywhere* in
the kitchen, which is the question a dink actually poses.

**A rule nothing exercises is indistinguishable from a rule wired to nothing.**
The unit tests prove the non-volley rule computes. In eight self-play games it
fired zero times, because the opponent is correctly gated never to commit it —
so the only evidence came from calling it directly. There are three rally-level
tests now that stand a player in the kitchen and make them volley, and one that
walks them in afterwards.

Ten minutes of that went into debugging the game before the test. The momentum
case set the player's `z` and not their `x`, and `createRally` parks the receiver
in the service box at x = −1.52 — so the ball was a metre and a half away
laterally and the reach model was right to refuse it. The trace said distance
1.60 where I had computed 0.48, which is the whole reason to print the number
rather than reason about it.

### What this closes and what it opens

DINK-39, closed, eight days after it was opened and with a measurement rather
than an opinion.

It opens the thing the plan was waiting on. Days 13 to 17 are doubles, and
doubles is played at the line that now exists.

## Day 13-14 — teams, and the doubles rulebook

Two days in one, because Day 14 could not be written without Day 13 and Day 13
is not worth shipping alone. The plan called Day 13 the risky one. It was, and
not for the reason written down.

### What the plan expected to be hard

"Every `Side` currently means both which end and which player, and doubles
separates those." True, and the fix is two lines: a `Slot` type, and a `slot`
field on the player. What was expected to hurt was the blast radius — 173 tests
written against `rally.near` and `rally.far`, which in doubles are one of two.

That never happened, and the reason is worth writing down because it is a
technique rather than luck. `rally.team.near[0]` and `rally.near` are the same
object, not a copy. Widening added a name; it did not move anything. Two names
for one object is a real cost and it is being paid deliberately: the alternative
was editing several hundred lines that were not wrong, in order to type `[0]`.

The one place that would have quietly broken is the reach buffer. Day 9 gave the
two ends separate `Reach` objects because a far-side contact was writing into the
value the UI reads mid-tick. Four players sharing two buffers is that bug again
with more players. Every player owns one now, aliased the same way, and there is
a test that counts four distinct objects — the sort of test that looks like
ceremony until you remember the comment it descends from.

### The rulebook, and a claim that had to be settled without a source

Doubles adds three things: two servers a side, a third number in the call, and a
serve rotation that decides who stands where. The first two are bookkeeping. The
third is the interesting one, and it collapsed to a single line:

```ts
export const rightCourtSlot = (teamScore: number): Slot =>
  (teamScore % 2 === 0 ? 0 : 1);
```

Partners swap courts exactly when their team scores, and the score goes up by one
at the same instant. So "slot 0 is on the right" and "the score is even" flip
together and stay locked for the whole game. Nothing tracks where anyone is
standing. `serveBox` and `receiverSlot` both fall out of it, and the stored
`box` field — assigned in two places, which is the exact shape of the Day 6 serve
bug — was deleted.

Then the part that had to be argued rather than looked up. Where does the second
server stand? Two sources disagreed: the rulebook's 4.B.6.b pins the *starting*
server to the right court at an even score, while a USA Pickleball skills page
was summarised as saying the second server serves from the court the score
dictates. They cannot both be right.

The invariant settles it without a third source. When the first server faults,
no point is scored, so nobody swaps. The partner therefore serves from where
they are standing, which at an even score is the left. The second reading would
require two players to trade places on a fault, and nothing in the sport does
that. Evidence beat the summary, and the summary was the more recent source.

The deep-research run that was supposed to supply all of this returned three
usable claims from 104 agents and voted 3-0 to refute the two-bounce rule. It
was used as a list of things to go and check. That is the fourth time in four
days that the instrument was less reliable than the thing it was measuring.

### Proof, because passing first time is not proof

The doubles tests passed on the first run, which is not reassuring. Three
mutants were introduced deliberately and the suite was watched to kill each:
removing the 0-0-2 exception failed six tests, making `serveBox` ignore the
server slot failed one, and disabling the second-server branch failed three.

### What is honestly not done

Doubles is not playable. The partners are furniture: they stand at the kitchen
line, the rules can see them, and they have no brain until Day 15. The human and
the opponent still drive slot 0 only, so when a near-side second server serves,
the ball leaves from the right place but the person swinging is not the person
standing there. Serving works because `serve()` never consults a player.

Also unmodelled: contacting a partner who is touching the non-volley zone is a
fault, and there is no partner collision yet. Filed rather than faked.

### The ship command

Thirteen end-of-day rituals is well past the point where a procedure should be a
command. `npm run ship -- --day 14 --version 1.1.0 -F msg.txt` runs verify, bumps
the version, commits, tags, inlines the artifact and writes the tarball — and
refuses to move a tag that already exists, which is the one mistake here that
cannot be undone by running the command again. It prints the three steps a shell
cannot do rather than pretending to have done them.

It has fifteen tests, and they came before it was used. DINK-72 has been open
since Day 11 on the grounds that the tools do the checking and nothing checks
them; a tool that commits and tags is worse than a measuring tool, because a
defect in it is a defect in the record of what shipped.

## Day 15 — the partner, and three buffers shared by four players

Ball ownership. Two players a side, and the ball has to belong to exactly one of
them: both chasing is a collision, both leaving is a bounce between them and a
human who blames the partner, correctly.

### The mechanism is commitment, not cleverness

A claim is decided once per shot and held until the next one. That is the same
shape as `readOff` and `reactionLeft` on Day 6, and the reason is the same one
written in the comment there: a decision re-made a hundred and twenty times a
second is not a decision, it is an average, and an averaged claim is two players
drifting toward the same ball at half commitment each.

Three rules, in order. The rulebook first — only the correct server may serve and
only the correct receiver may take the serve, and those are not preferences to be
scored against distance. Then the middle ball, which goes to the left-court
player. Then time-to-arrive.

The middle-ball rule is a constant on purpose. "Whoever is closer" on a ball two
players are equidistant from is a coin toss that lands differently on consecutive
shots, and two players alternating who commits is precisely the argument the
function exists to end. The sport already has the convention, for two
right-handers the left-court forehand covers the centre, and a convention is
worth more here than an optimum.

One asymmetry, stated rather than discovered: **a human beats their partner on
anything they can plausibly reach.** Not because it produces better doubles, it
does not, but because a partner that takes balls out of your paddle is the single
most disliked behaviour in co-op sports AI. The player is allowed to be wrong.
Their partner is not allowed to overrule them.

### Four bugs, and three of them are the same bug

**The partner was passed as the opponent.** `driveOpponent(opp, world, match,
self, other, ...)` uses `other` for the bisector it stands on and the side of the
court it aims away from. I handed it the team-mate. The far team lost 11-0 with
every rally three shots long and every fault reading "double bounce" — a player
shading toward the empty half and aiming at the partner they were avoiding. The
scoreboard says "cannot reach anything" and the cause is a parameter.

**One input frame, three brains.** Every brain that was not the far slot-0
opponent wrote into a single shared `partnerInput`. Movement survived it, because
each frame is consumed by `stepPlayer` on the very next line — but the serve check
reads a frame again later in the tick, and by then it belonged to whoever wrote
last. Nobody served, at all, for a whole match. Every player owns a frame now.

That is the third time: Day 9 gave the two ends separate `Reach` objects for
exactly this reason, Day 13 gave four players four of them, and Day 15 did it
again with input frames. Shared scratch is this codebase's recurring defect and
the fix is always the same — one buffer per owner, allocated once.

**Both players on the serving team asked to serve.** The `!owns` early return
skips `awaitingServe`, so the serve branch ran for the partner too and set
`swing = true`. Nothing broke, because the rally reads only the correct server's
frame. It was a lie that happened to be unread, which is worse than a lie that
breaks something, and the measurement caught it: 58 swing frames out of 240 asked
by a player who did not own the ball. With the gate applied it is 0 of 182.

**Deciding and stepping in one pass moved the difficulty ladder.** The loop
planned, drove and stepped each side in turn, so the far brain read a near player
that had already moved this tick while the near side read a far player that had
not. The club stand-in went from 2 wins out of 6 at `steady` to 3. Two phases now:
every brain decides from the same world, and only then does anybody move. The
ladder returned to 6/6, 2/6, 0/6 with rallies-won and balls-reached identical to
three digits, which is what confirmed the diagnosis rather than merely fixing the
symptom.

Simultaneity is not a detail in a game whose fairness check is a mirrored
rematch.

### What the measurements say

Self-play, four games a configuration:

```
                        shots  rallies   avg  longest
singles                   222       68  3.26        7
doubles                   218       68  3.21        5
doubles, nobody claims     44       44  1.00        1
```

The third row is the null hypothesis and it is total: with no arbitration every
rally is one shot long, because the ball lands between two players who each
assumed the other had it. Arbitration is load-bearing, not decoration.

Twelve games with the server alternating: near 6, far 6, in both singles and
doubles. No end advantage — which was worth checking, because a 6-0 scoreline in
a demo recording is exactly what the Day 6 bug looked like, and it took two days
to find that one. This time the hypothesis died in one command.

### The number Day 16 has to move

**The pair crowds for 23.6 per cent of ticks, and all of it is at the back**
(0.4 per cent at the net). Mean lateral separation is 1.96 m on a 6.1 m court.
Two players that close have both tramlines open and are one shot from colliding.

A first attempt at fixing it — holding a fixed half-court station instead of
shading a third of the way to the middle — moved crowding from 53.3 to 47.9 per
cent and separation from 1.85 m to 1.96 m. The change is defensible on its own
terms and it is kept, but it is not the fix, and guessing again would be guessing.
This is Day 16's work: formations, side-by-side against up-and-back, and the
choice of which is a team decision rather than two players each picking a spot.
Day 16 has an acceptance number now instead of an opinion.

### Demo mode, which cost one null becoming an object

ADR-0003 promised on Day 3 that the rally would never know which end was a
person. Twelve days later that promise was cashed in one line: `minds.near[0]`
becomes an `Opponent` instead of `null` and the game plays itself. `?demo=1` and
`?doubles=1` reach it, and `npm run watch` records it.

One thing that fix exposed. In demo mode the near end had kept the human's
execution skill — level 0.34 against `steady`'s 0.60 — so the demo was a good
player beating a mediocre one rather than a picture of the game. Both ends now
execute at the level being demonstrated.

`npm run watch` is the other half of the day and it is not really engineering:
for fourteen days the only person who could see this game running was somebody
with a browser open. `play.mjs` prints PASS. It has never once shown anybody the
game. Same autopilot, deliberately, so the thing recorded is the thing tested.

Its own bug is worth one line. Playwright stamps every screencast frame at a
fixed 25 fps regardless of when it arrived, so 40 seconds of play came out as a
75 second file. That is not slow motion, it is wrong, and it shipped in the first
cut. The capture is rescaled by wall clock over source duration now.

And the autopilot is one `String.raw` template, so a backtick in a comment ends
the file. It took a syntax error to remember that.

DINK-73 and DINK-74 closed. DINK-77 opened for the crowding.

## Day 16 — formations, and four hypotheses that died

Day 15 handed this day a number instead of an opinion: the pair crowded for 23.6
per cent of ticks and stood 1.96 m apart on a court 6.1 m wide. Day 16 had to
move it.

### The instrument first

The first thing built was `src/sim/shape.ts` and `tools/doubles.mjs`, because
Day 15's number was measured by a throwaway script and Day 16's entire argument
is a set of percentages. The arithmetic lives in `src/sim` where it has tests;
the tool is a printer. Every percentage returns null on an empty sample rather
than zero, because zero is a claim and `coverage` made that claim for four days
in Day 7.

The honest baseline, sampling only ticks while a point is live rather than every
tick including the parked ones between points:

```
            avg  longest crowded lateral   depth  atLine up+back
singles    3.41        7     —      —       —       —      —
doubles    3.25        6   31.0   1.80    0.86     2.2    9.3
```

Worse than Day 15 reported, because the denominator is right now. And a number
nobody had looked at: **the pair reached the non-volley line 2.2 per cent of the
time.** Doubles is played at that line.

### Four hypotheses, in order, three of them wrong

**One: the support tracks its partner's live position instead of a formation.**
Depth moved from `Opponent.stance`, where each player advanced on their own, onto
the team plan, where only the player hitting the ball may change it. The support
stands in its own half, decided by the same score-parity invariant the serve
rotation runs on, rather than mirroring wherever its partner ran to. Crowding 31.0
to 16.4, separation 1.80 to 2.08 m. Partly right.

**Two: the support should stand in the middle of whatever gap its partner is not
covering.** Measured, and it lost: 16.4 to 16.6 per cent, and separation *fell*
to 1.94 m. The trace said why, and it is funny in retrospect — it made the
support cross the court whenever its partner moved through the middle, and the
crossing goes straight past the partner. It generated the traversals it was meant
to prevent. Deleted rather than tuned.

**Three: the team never advances because the steps are too small.** A depth
histogram over three games: 61 per cent of live ticks at 6.2 m, 35 per cent at
5.7 m, one per cent at the line. So a shot that lands short was made to mean "we
are coming in" outright rather than a 0.55 m creep. Nothing changed at all.

Because the fourth hypothesis was upstream of all three.

**Four: they are not choosing the right shot.** 94 per cent of doubles shots were
drives. A player at the baseline is in the back zone, and the back zone always
drives, so the team stays at the baseline, so it is in the back zone again. Day 6
spotted this exact loop and patched it with a creep; in singles the creep is just
about enough, and in doubles it is arithmetically hopeless.

The sport's answer is the third shot drop, and this game did not have it. It is
played from the baseline, against opponents already at the net, and you walk in
behind it. It is the hardest shot in pickleball and it is the whole third shot.
Without it a pair has no way in and no reason to be a pair.

### And then a deadlock, which was the actual lesson

Adding the third-shot drop changed nothing, because it fires only when the
opponents are at the line, and no team could reach the line, so no team ever saw
the other there. Two correct rules and, between them, a state neither could
leave.

The way out was not a smarter rule, it was the right opening position. **The two
teams do not start at the same depth.** The serving team is pinned back by the
two-bounce rule; the receiving team is already at the net except for the one
player taking the serve, who comes in behind their return. Setting that at every
serve broke the deadlock in one line, and time at the line went from 3.5 per cent
to 25.

Both rules were right. The initial condition was wrong. That is a failure mode
worth naming, because nothing in either rule looks broken when you read it.

### Two bugs in the measuring, one bug in the game

**The tool was measuring two games and printing twelve.** Six games and twelve
games returned byte-identical shape statistics, which is not a coincidence, it is
a fingerprint: the only thing varying between games was which end served, and
the seeds were fixed, so six games were two distinct games repeated. A sample of
two, printed as twelve. `createRally` takes a seed now. Fifth time in this project
that a harness has measured itself, against one defect in the simulation.

**The near pair was playing with a handicap.** With real seeds, near won 1 of 12
doubles games — and singles, on the same seeds, won 10 of 16. `planTeam` gives a
human two advantages over their own partner: a bias on time-to-arrive, and every
middle ball outright. Both are deliberate, because a partner that takes balls out
of your paddle is the most disliked behaviour in co-op sports AI. Both are a
*handicap* applied to a computer: they hand one player balls the other should
take and drag them out of position to do it. Demo mode had no human and was
getting the human treatment anyway. Near went to 6 of 16, and then 9 of 16 with
the rest of the day's work — noise, which is what fair looks like.

That one is worth remembering. The bug was not in the rule. The rule was right
and was being applied to the wrong kind of player.

### The fix that did the work

The trace, after all of the above, said 56 per cent of the remaining crowding was
a single state: a pair waiting for a ball on the other side of the net, with one
of them standing in the middle of the court and the other at their station 0.87 m
away.

`homePosition` puts a waiting player on the bisector of the angle the opponent
can hit into, which is near the centre. Correct with one player covering
everything. Wrong with two — and the owner had never been given a station,
because Day 15 only ever computed one for the partner who was not playing the
ball. Everybody gets a station now, and it is where they wait.

Crowding 11.1 to **2.3 per cent**. Separation 2.06 to **2.58 m**.

### Against the acceptance numbers

```
                  Day 15    target    Day 16
crowded            23.6%      < 5%      2.3%    met
lateral            1.96 m   > 2.8 m    2.58 m   not met
avg rally           3.21    not lower   3.52    met, and now above singles
at the line          1.2%       —       30.3%
```

The separation target is not met and will not be chased. The stations are 3.05 m
apart and one of the two is always away chasing a ball, so a mean of 2.58 m is
close to what the geometry allows. 2.8 was a guess written down on Day 15 next to
two numbers that were measured, and tuning until a guess is satisfied is how a
metric stops meaning anything.

Doubles rallies are now longer than singles rallies — 3.52 against 3.28 — which
is what DINK-78 asked for and is the first sign that this is a different sport
rather than singles with extra people. Singles is untouched: the ladder reads
6/6, 2/6, 0/6 with rallies-won and balls-reached identical to three digits.

### Day 16, after the fact — the player was standing still and hitting the ball

Reported from outside the project, watching the Day 16 recording: the motion
looks delayed, and the player model seems to stay still and hit the ball anyway.

Both halves were worth chasing and they had different answers.

**The delay was mostly the recording, and the tool was lying about why.** The
header of `tools/watch.mjs` claimed a headless browser renders "roughly fifteen
frames a second". That was a guess written on Day 15 and never checked. The tool
already prints the number: Playwright stamps frames at a nominal 25 fps, so the
retime factor is the capture rate divided by 25. It measures about 37 frames a
second at 1280 wide and 43 at 800. The comment was wrong by a factor of two and a
half and has been corrected. A guess in a comment is a claim, and this project
has now been caught by that twice.

**The standing-still part was a real bug, and it had been there since Day 1.**
`world.prev` exists so the ball can be drawn part way between two simulation
ticks. Nothing equivalent existed for players. So every frame drew the ball at
`prev + (pos - prev) x alpha` and drew the player, and the paddle placed from
that player, at `pos` — a whole tick further on.

The size of it, measured over four games rather than estimated:

```
ball travel per tick     p50 9.2 cm   p95 12.3 cm   max 23.9 cm
player travel per tick   p50 2.2 cm   p95  3.5 cm   max  3.5 cm
ball diameter                7.4 cm
```

More than a ball's width of mismatch in a typical tick, and three ball widths at
worst — and worst exactly at contact, because that is when the ball is fastest
and when the eye is looking. The paddle is placed from the simulated ball while
the ball is drawn interpolated, so at the moment of the hit they are drawn in two
different moments. "The model stayed still and hit it anyway" is a precise
description of that.

`PlayerState` has a `prev` now, `stepPlayer` writes it, and the renderer draws
players and the paddle from the same alpha as the ball. `paddleAt` takes the
drawn player and the drawn ball rather than reaching into the simulation for
them, so the three agree about what moment it is.

Nothing in `src/sim` reads any of it. Interpolation is a renderer question and
the answer never feeds back, which is ADR-0001 still holding at day sixteen.

Four tests, including one that the initial `prev` equals the initial `pos` so
that the first frame of a game is not a jump.

The lesson is the one about instruments again, from the other end. Fifteen days
of unit tests, headless playtests and browser harnesses did not catch this,
because every one of them measures the simulation and this defect lives entirely
in the last step before a pixel. It took somebody watching.

### Day 16, later still — the players were capsules, and half of them were not drawn

"Where is the model render, I can't see anything, draw a humanoid model please."

Two findings, and the second is worse than the first.

**The player was a capsule.** A pill, `CapsuleGeometry(0.28, 1.05)`, in pale grey,
on a pale court, at broadcast distance. It has been that since Day 1 and it was
always meant to be temporary. A capsule cannot show the two things that matter
most about a player at any instant, which are which way they are moving and
whether they are swinging.

There is a person there now: torso, pelvis, head, cap with a peak so the head has
a front, two arms and two legs on real joints, shoes, and a paddle. Eleven boxes,
two spheres and two cylinders. Everything is built from primitives rather than
loaded, and not for elegance — the published build is a single self-contained
file with no external fetches permitted, so a glTF character was never on the
table.

The stride is driven by DISTANCE TRAVELLED rather than by time. That is what
stops the legs cycling while the player stands still, and it makes the animation
frame-rate independent for free, because the feet and the body are measuring the
same thing. Amplitude follows speed, so a walk barely swings and a sprint swings
a lot; a single constant looks wrong at both ends.

**And two of the four doubles players were never drawn at all.** The scene built
exactly two `PlayerView`s and nothing had ever asked for more. Yesterday's
doubles video was a doubles match with half the players invisible, and it was
published that way. Four now, with partners in the team kit a shade darker so a
pair reads as a pair, and hidden in singles.

Nothing caught this either, for the same reason as the interpolation bug: every
test in this repository measures the simulation, and the scene graph is not the
simulation. Two defects in one day, both in the last step before a pixel, both
found by somebody looking at the screen.

**The humanoid then exposed a third problem immediately.** With a capsule, the
paddle floating 0.9 m to one side looked like nothing in particular. With a
person standing there arms-down, it was a paddle hovering in mid-air beside
somebody ignoring it. The arm is aimed at the paddle now, by quaternion from the
limb's rest direction — and the arm is aimed at the paddle rather than the paddle
moved to the hand, because where the paddle is IS the rule. It is where the ball
can be met. Moving it to suit the animation would be the renderer lying about the
game.

The near player carries no paddle of their own, because `renderer.paddle` is the
precise one with a real face orientation, and two paddles in one hand is worse
than none.

**One deletion.** `tools/shot.mjs` had been taking screenshots of `dropLine`,
`dropCross` and `dropMiddle` since Day 3 — sandbox scenes that stopped existing
on Day 4. It had been photographing a game that was not there for twelve days,
and nothing consumed the output, which is exactly why nobody noticed. Replaced
with one that works and is wired to `npm run shots`.

## Day 17 — is this the same sport

Day 17 was meant to be a doubles playtest. It became a calibration day, because
the first honest question about balance is "balanced against what", and this
project had never once compared itself to a real pickleball match.

### The research, and two harnesses that failed

The deep-research workflow was run again and failed again — this time at the
first agent, on a schema error, having burned 46k tokens. On Day 14 it returned
three usable claims out of 104 agents and voted 3-0 to refute the two-bounce
rule. Two runs, two failures.

Four direct fetches produced better data in five minutes:

- `pickleball-research.com/outcomes`, citing Prieto-Lage 2024 and a PPA charting
  of 27 gold-medal matches: points end in unforced errors 63.7 per cent of the
  time, winners 20.3, forced errors 16.0. Serve completion 97.6 to 97.8 per cent.
  Rally lengths 43 per cent short, 44 medium, 13 long. Pro men's doubles averages
  8.6 hits a rally, women's 9.6.
- `thedinkpickleball.com`, 9 matches, 30 games, 1,184 rallies, 13,000 shots:
  10.65 to 13.6 shots a rally across pro doubles finals.

And one that had to be thrown away. A promising-looking PMC table on "doubles
rally duration and shots per rally" turned out to be **badminton**. It was caught
by reading it rather than by quoting it, which is the only way that class of
error ever gets caught.

### The instrument

`src/sim/profile.ts` and `npm run profile`. It counts in the categories
published pickleball analysis uses rather than the ones convenient to the
simulation, and the real numbers live beside it with their sources.

One deliberate refusal: the sport separates winners from forced errors, and this
model does not. That split needs a judgement about whether the receiver "should"
have reached it, and inventing one would produce a number that looks like the
published figures and means something else. Two honest buckets beat three
dishonest ones.

The first run was the most interesting output of the day:

```
                                 Dink    real    gap
  mean shots per rally          3.5      8.6    0.41x
  rallies of 1-4 shots         86.3%    43.0%   2.01x
  rallies of 9 or more          0.2%    13.0%   0.02x
  ended by striker error       64.3%    63.7%   ok
  ended unreachable            35.7%    36.3%   ok
```

The error MIX was almost exactly right — 64.3 against 63.7 — and the rally
length was out by a factor of two and a half. Day 7's error model had been
producing the right ratio of mistakes to winners for ten days, and the rallies
were still ending three times too fast.

### Four defects, found by following the numbers

**One. The third shot drop was netting.** 47 per cent of all rallies ended on
shot three; 80 per cent of net errors were on shot three; 99 per cent of net
errors were drops. The solver demanded 6 cm of net clearance for a drop
regardless of where it was struck from. That is right for a dink played from the
kitchen line and impossible from the baseline: a pitch error arrives at the net
multiplied by the distance it travelled, so 6 cm of margin at 6.2 m is a shot
threaded through a gap narrower than the error.

Clearance now scales with distance from the net. The coefficient is derived —
typical pitch perturbation at `steady` is about 2.2 degrees, which is 0.038 rad
— and a sweep against the charted profile put the knee at 0.035. Physics and
measurement agreeing within ten per cent is the only reason to trust either.

**Two. My own change broke what `found` means.** The clearance term went into the
same cost that decides whether the solver found a shot, so a drop that landed
perfectly while clearing by less than it wanted reported itself as a failure. The
ranking should weigh clearance; the verdict should not. `found` now asks only
"did it land where I aimed", with a tolerance that also scales with distance —
a 6.2 m drop landing 0.6 m long inside a 2.13 m kitchen is a better third shot
than most people ever hit, and a flat 0.35 m called it a miss.

**Three. The kitchen rail survived Day 12 in two more places.** Day 12 deleted
the physical barrier and set KITCHEN_BARRIER to false. It did not touch
`receivePosition`, which clamped every target position to 2.41 m from the net —
so for five days the simulation ALLOWED players into the kitchen and nothing ever
asked to go there. The whole point of Day 12 was that you step in to play a ball
that has bounced.

It cost exactly what Day 12's own arithmetic predicted. A drop lands about 1.3 m
from the net, a defender pinned at 2.41 m is 1.1 m away, reach is 1.15 m.
Measured: 81 per cent of unreachable balls landed in the kitchen, and the median
distance from bounce to nearest defender was 1.12 m. Answering a drop was a coin
toss decided in the third decimal place.

And a test was guarding the rail. It was called "never places a player inside the
kitchen rail" and it asserted the behaviour Day 12 was supposed to have deleted.
The rail lived in three places and Day 12 found one.

**Four. Letting players into the kitchen creates an absorbing state in singles.**
One rally ran the entire 600-second budget: 2,569 shots, both players parked
inside the line. A player in the zone may not volley, so every ball must bounce,
and a soft ball bouncing in the kitchen is always reachable by somebody already
standing there. One player covers the whole width in singles, so there is no
angle out of it. In doubles it does not happen — games finish in 150 to 270
seconds, longest rally 33 — because a pair has width to cover.

### Two things scoped to doubles, and why that is a trade rather than a fix

Both the kitchen entry and the clearance rule are **on in doubles and off in
singles**, and neither scoping is a discovery. They are trades, and they are
worth naming as trades.

The clearance rule is physically right for both codes. Turning it on in singles
moved the difficulty ladder from 6/6, 2/6, 0/6 to 6/6, **0/6**, 0/6 — two of the
three levels became indistinguishable and unbeatable, because the side that plays
drops gains from safer drops and a fixed stand-in does not. Rebalancing three
difficulty levels is a day's work with a playtest attached. Doing it as the last
change of an evening is how a calibrated game stops being calibrated.

So singles is bit-identical to Day 16 — 6/6, 2/6, 0/6, with rallies-won and
balls-reached matching to three digits — and DINK-92 and DINK-93 carry the
evidence for doing it properly.

### Where doubles stands, honestly

```
                        start of day    now     real
  mean shots per rally       3.5        4.1      8.6
  rallies of 9 or more       0.2%       7.4%    13.0%
  net errors                  52%        26%      —
  longest rally                 9         33      —
  ended by striker error     64.3%      26.7%   63.7%
```

Better on length, worse on mix. The 64.3 that matched at the start of the day
matched by accident: too many net errors were compensating for too few
unreachable balls, and fixing the net errors exposed that the defence is weak.

The band the sport lives in is still missing. Rallies of 5 to 8 shots are 7.9 per
cent here against 44 per cent real, and the distribution is bimodal: a point
either dies in the transition or turns into a twenty-shot dink rally. That is
Day 18's number, and a sweep of the clearance constant from 0.00 to 0.06 showed
it cannot be reached with that knob — short rallies stayed between 81 and 94 per
cent across the whole range. A negative result, recorded so nobody sweeps it
again.

### What was not used

The instruction was to use every skill in the library. Most of them were not
applicable and using them anyway would have been theatre: there is no Word
document, spreadsheet, slide deck or PDF in a balance day, no incident to
respond to, no plugin to build. The ones that earned their place were the
engineering discipline, the research, the CLI design for two new tools, the
testing strategy for their denominators, and the citation check that caught the
badminton table before it reached a constant.

## Day 18 — the missing middle, and a rule that fixed two bugs

Day 17 left a number: doubles rallies of 5 to 8 shots were 7.9 per cent against a
charted 44, with a bimodal shape — a point either died in the transition or
became a twenty-shot dink rally. The plan said Day 18 was modes. Modes on top of
a 4.1-shot rally is dressing up a core that does not work, so Day 18 was this.

### The diagnosis, in three probes

**Where do they die.** 81 per cent of all doubles rallies ended on shot three.
Not shot four, where the net team answers the third shot — shot three itself,
split 55 per cent unreturnable and 25 per cent into the net.

**Why is the third shot unreturnable.** 93 per cent of them were drops landing in
the transition zone, median 3.47 m from the net, with the receiving team standing
at 2.53 m. A ball landing a metre behind somebody at the net.

**Did they try.** This is the probe that mattered, and the answer was flat:

```
109 unreturned third shots
  never asked to swing:         109 (100%)
  solver found no intercept:      0 (0%)
  ball never came within reach:   3 (3%)
```

A hundred per cent never pressed the button, and in 97 per cent of cases the ball
came within reach of somebody who never swung at it. Not positioning, not the
shot, not the solver. The brain was refusing.

### The cause was yesterday's fix

Day 17 let players into the kitchen, which was right — Day 12 had removed the
rail from the physics and left it in `receivePosition`, so for five days nothing
ever asked to go in. But the receiving pair then **camped** in the zone. A player
standing in the non-volley zone may not volley, so every ball has to bounce
first, so a third shot that would have been a comfortable volley sails over their
heads and lands behind them.

The defect had already been written down, in the DINK-92 comment, as the
mechanism of the singles stalemate: "a player inside the zone may not volley, so
every ball must bounce". The same sentence described the doubles bug and nobody
read it as one, because in singles it produced a 2,569-shot rally and in doubles
it produced three-shot rallies. Same cause, opposite symptom.

### The fix is the sport's own rule

You may stand in the kitchen to play a ball that **has already bounced**, and for
no other reason. It is not a place to wait; it is somewhere you step for one shot
and step out of.

`interceptPoint` already answers that question — `meeting.bounced` — so the fix
was to pass it instead of the doubles flag:

```ts
receivePosition(_stand, opp.facing, meeting.pos, 0.45, meeting.bounced);
```

One line, and it retires the Day 17 scoping. Kitchen entry is no longer
doubles-only, because the correct rule does not create the singles stalemate
either: singles games now finish in 67 to 206 seconds with a longest rally of 9,
where yesterday they ran the entire 600-second budget.

The rule the game ENFORCES is now the rule the AI POSITIONS BY. That is worth
saying plainly, because it is the shape of the whole fix: the non-volley rule had
been implemented in `rules.ts` since Day 12 and the positioning code had never
been told about it.

### What moved

```
                        Day 17    Day 18     real
  rallies of 1-4 shots   84.7%     73.8%    43.0%
  rallies of 5-8 shots    7.9%     25.6%    44.0%
  rallies of 9 or more    7.4%      0.6%    13.0%
  ended by striker error 26.7%     34.6%    63.7%
  mean shots per rally     4.1       4.2      8.6
```

The bimodal shape is gone and the middle band has tripled. The long tail went
with it, which is the honest cost: the 7.4 per cent of nine-plus rallies were
the camping dink rallies, and they were not pickleball either. Real doubles has
13 per cent, earned by two pairs at the line trading dinks legally, and this game
does not produce those yet.

### Singles is no longer bit-identical, and that is stated rather than buried

Ten matches a level against the club stand-in:

```
            Day 10 published    Day 18
  easy            10/10          10/10
  steady           3/10           4/10
  tough            0/10           0/10
```

Ordered, spread, and one match apart at `steady` — inside the noise for ten
trials. But it is a behaviour change to a shipped, calibrated game, so it was
checked at ten matches rather than six before being accepted.

### One experiment that failed usefully

With the positioning fixed, it was worth asking whether Day 17's other scoping —
the distance-scaled net clearance, on in doubles and off in singles — could be
retired too. It cannot. Turned on for singles at ten matches a level:

```
  easy 10/10 · steady 0/10 · tough 0/10
```

`steady` and `tough` collapse into indistinguishable and unbeatable, exactly as
they did at six matches on Day 17. The suspicion is now a measurement. DINK-93
stays open and the trade stays named.

## Day 19 — the interface doubles never had

Four days of doubles work — the rulebook, four players, ball ownership,
formations, the calibration — reachable only by typing `?doubles=1` into the
address bar. Work nobody can find is work nobody can use, and DINK-79 had been
open since Day 15 saying so.

### What was added

A **Match** section in the panel: Singles or Doubles, and a Watch toggle that
hands both ends to the computer. Both restart the match rather than switching
mid-point. A `Rally` owns the world, every player, the team plans and the rules,
and changing how many people are on court halfway through a game is exactly the
kind of mutation that has gone stale twice in this codebase. Rebuilding is one
line and cannot be half-done.

The URL flags still win when present, because `tools/watch.mjs` and
`tools/shot.mjs` drive the game that way and a recording harness should not
depend on what somebody last clicked.

The scoreboard calls three numbers in doubles now — `your serve · right box ·
server 2 · 0-0-2`. The third number is not decoration: it says whether the next
fault ends the service turn, which is the whole of what the receiving pair is
planning around.

### Settings that survive a refresh

Difficulty, mode, watch, camera, speed and mute are remembered. Everything about
it is a convenience and none of it is state the game needs to be correct: a fresh
browser, a private window, or storage that throws must all produce a working game
on the defaults.

Every field is validated on the way back in rather than trusted because it came
from us. What comes out of storage may have been written by an older build, by
another tab, or by somebody editing it by hand, and the only guarantee is that it
once parsed as JSON. The coercion is field by field, so a build that adds a
setting does not throw away the four a player already chose, and one bad field
does not cost the others.

Deliberately NOT stored: anything about a match in progress. Scores, serve
rotation and who is at the net belong to the simulation, and a half-restored
rally is worse than no rally.

### The mute button had never worked

Found while trying to persist it. `#mute` has been drawn in the panel since Day 8
and `M` has been listed in the controls since Day 8, and **nothing in the
codebase ever listened to either**. `sound.setMuted` existed. `sound.muted()`
existed. No line called them.

Eleven days of a control that was documented, drawn, and dead. It survived every
test because every test asked the simulation questions and this was a button.

That is an argument for storing a preference that has nothing to do with storage:
to persist a setting you have to go and look at how it is set, and looking is
what found it.

### Clicking the buttons is the test

`tools/play.mjs` now drives the new controls through the real DOM and asks the
game whether anything changed:

```
controls: doubles put 4 on court (mode "doubles") · watch on ·
          mute on then off · back to singles with 2 on court
```

Each assertion is a click followed by a question. A control that changes nothing
observable cannot be checked, which is precisely how the mute button survived —
so the debug hook gained `mode`, `watching` and `onCourt`, and the harness fails
if any of the four does nothing.

That is a small dent in DINK-89. Every test in this repository still measures the
simulation, and the last step before a pixel still has almost no coverage, but
four controls are now held down by something.

### Seven tests on the coercion

The part worth testing is not the storage, which is two lines of try/catch. It is
what happens when the value is wrong: a truthy string where a boolean belongs, a
speed no button offers, a difficulty from a build that no longer exists. One of
them checks that `coerce` never hands back the shared DEFAULTS object, because a
caller mutating it would change everybody's defaults.

246 tests. Nothing in `src/sim` was touched today, so the ladder and the doubles
profile are yesterday's numbers unchanged.

## Day 20 — the ball, against film

The ask was "make the game realistic in terms of physics", which is the kind of
request that invites twenty small tuning changes and produces nothing you can
defend. So the day was run the other way round: find the constants that are
guesses, replace the guess with a source where one exists, and where no source
exists say so in the file instead of dressing a number up.

Then measure the whole flight model against something it was never fitted to.

### What was actually a guess

Auditing `constants.ts`: drag, lift slope, restitution, ball mass, ball inertia
and paddle inertia were already MEASURED with sources. The guesses left were spin
decay, the backspin asymmetry, court friction, net restitution, paddle friction
and player movement.

Three of those moved today. Two are recorded as still unsourced, on purpose. One
turned out not to exist as a problem at all.

### Backspin does not mirror topspin

The textbook Magnus force is symmetric: reverse the spin, reverse the force, same
size. A pickleball does not do that, and the game had a constant called
`BACKSPIN_LIFT_MAX` asserting a specific ceiling with nothing behind it.

Two studies, both trajectory fits from filmed free flight:

- Steyn et al. (2025), six trajectories, fitted `Cl = 0.195*S`. Symmetric,
  linear, and the source of `LIFT_SLOPE`.
- Tennis Warehouse University, "The Physics of Pickleball Aerodynamics and
  Trajectories", 86 trajectories: topspin lift rises strongly and linearly with
  the spin number, backspin shows "far less dependence on spin than expected"
  and clusters near a flat `Cl = 0.2`. It says outright that the linear model
  cannot capture this.

At S = 0.35 that is 0.072 against 0.2. A factor of three, and the newer study
does not publish its slopes in a form you can lift.

**So the model does not choose.** Taking the bigger number because it came from
the bigger study is picking a winner in an argument this project is not
qualified to settle, and it was very nearly what happened here: the first draft
of the change adopted the larger magnitude before anyone noticed the two sources
disagree.

What both studies agree on is the *shape*: backspin saturates, topspin does not.
That is what is implemented. Backspin reaches the same modest ceiling the
conservative fit supports, but reaches it at a much lower spin number and then
stops. A gentle slice floats nearly as much as a savage one. A gentle topspin
drive dives nowhere near as hard as a savage one.

The test asserts the shape and nothing else, plus a guard that backspin never
exceeds what the conservative fit sanctions — so a future edit cannot quietly
adopt the larger study through the back door.

### Spin decay was a time, and it should be a length

`SPIN_DECAY_TAU = 4.0` said a ball dawdling through a dink loses spin at the same
rate as one fizzing past at 20 m/s. That is not how it works. The governing
relation is

```
dw/dt = -c * U * w
```

(Goodwill and Haake, "The Spin Decay of Sports Balls in Flight"): the torque
doing the slowing scales with speed, so the decay rate does too, and the natural
constant is a **distance travelled**, not a time.

The magnitude is still unsourced — that paper measured tennis balls and
footballs and says plainly it has no data on hollow or perforated balls, and no
pickleball figure was found. So `SPIN_DECAY_LENGTH = 40` is anchored, not
measured: at 10 m/s it reproduces the old four-second constant exactly, so
nothing balanced against the old behaviour moves and only the shape changes.

The test is the direct consequence of the form. Three balls at 6, 12 and 18 m/s,
measured at the six-metre mark:

```
6 m/s   0.8592 of its spin left
12 m/s  0.8590
18 m/s  0.8584
```

Three decimal places across a threefold speed range. And measured at the
six-tenths-of-a-second mark instead, they must differ, or a decay of zero would
pass the first half:

```
6 m/s   0.9069      18 m/s  0.7912
```

### The closest thing this project has to a wind tunnel

Every physics test in the repository up to today checked the flight model against
itself. The coefficients go in, the same coefficients come out. None of them
could have caught a wrong drag coefficient.

arXiv 2501.00163, "Executing a Successful Third Shot Drop in Pickleball", filmed
six real third shot drops and published their launch conditions:

```
down the line  10.9-13.0 m/s at 15.5-22.5 deg
cross court    13.3-16.0 m/s at 12.5-18.0 deg
```

Those are six measurements of where a real ball started. Feed them to our
integrator and it says where the ball ends up. **Nothing in the model was fitted
to them.**

```
down the line  10.9 @ 22.5  ->  lands z=-1.57   net clearance -0.01 m
               13.0 @ 15.5  ->  lands z=-2.32   net clearance  0.00 m
               11.9 @ 19.0  ->  lands z=-2.07   net clearance  0.05 m
cross court    13.3 @ 18.0  ->  lands z=-2.06   net clearance  0.11 m
               16.0 @ 12.5  ->  lands z=-2.76   net clearance  0.08 m
               14.6 @ 15.2  ->  lands z=-2.47   net clearance  0.14 m
```

The kitchen line is at z = -2.13. Six filmed launches, all six landing within
about 60 cm of it, all six passing within 15 cm of the net cord. That is a real
third shot drop in both senses: skims the tape, dies in the kitchen.

This is worth more than the six tests above it put together, and it is now six
test cases. If drag is ever wrong again, this fails.

### And does the solver play that shot?

Different question, same film. The check above asks whether a real launch lands
where our physics says. This one asks whether our solver *chooses* a real launch.

Yesterday the answer was no:

```
down the line  ball leaves at 9.2 m/s, 36.5 deg
```

Against a filmed 10.9-13.0 at 15.5-22.5. The game was hitting a slow loop where
the sport hits a flattish arc, because `DROP_APEX` had been set at 2.2 m by eye.
Deriving it instead — 13 m/s at 18 degrees rises `v_y^2/2g = 0.82` m above a
contact at 0.7 m, so a real third shot drop apexes near 1.5 m, and 1.7 allows the
top of the range — gives:

```
down the line  11.0 m/s @ 25.7 deg
cross court    13.7 m/s @ 19.1 deg
```

Both speeds inside the published band. Both angles still two to three degrees
steep, and that residual is **not** a bug: the solver buys 29 cm of net clearance
from the baseline because `DOUBLES_CLEARANCE` says to, and the filmed players
skim the cord by under 15. That margin exists because this game's execution error
is far larger than a professional's. It is the honest price of the Day 17 fix,
and the test now carries a named `STEEP_ALLOWANCE` of 4 degrees so the price
cannot rise without somebody choosing to raise it.

### A constant the simulation cannot see

`COURT_FRICTION` was 0.55 and marked TUNED. The ITF measures exactly this
quantity, with a ball launcher, and sorts courts by the answer: above 0.71 is a
slow court (clay), below 0.55 is a fast one (grass), and acrylic hard courts sit
in the band between. A pickleball court and a tennis hard court are the same
surface, so the number transfers even though the ball does not.

The game was being played on grass. 0.63 is the middle of the right band.

Then the move was measured rather than assumed — and the first version of this
change had the sentence "the profile and the ladder both come back unchanged"
written into the source comment *before anything was run*, which is the third
time in this project a guess has been typed into a comment as a fact. Caught by
reading it back.

What the measurement actually says, sweeping the constant against the rally
profile over eight games:

```
mu = 0.05    207 rallies
     0.15    194
     0.30    339
     0.44    450
     0.48    307
     0.52    330 rallies, 1413 shots
     0.63    330 rallies, 1413 shots
     0.71    330 rallies, 1413 shots
     0.90    330 rallies, 1413 shots
```

Byte identical from 0.52 upward. The bounce model applies friction up to
Coulomb's limit but never more than the impulse that exactly cancels slip, and
above 0.52 the limit stops binding: **every bounce grips, and the gripping branch
does not read this number at all.**

So across the entire range an acrylic court can physically occupy, this constant
is inert. It was flagged as a risk for twenty days and it does nothing. The
correction is free, and knowing why it is free is worth more than the correction.

(The sweep was checked against the obvious trap first. A profile that does not
move could mean the tool is not reading the constant, which is the harness
measuring itself and has happened six times here. Setting it to 0.05 gave 207
rallies against 330, so the tool reads it. The inertness is real.)

### Two constants that stay guesses

`NET_RESTITUTION` and `NET_CORD_RESTITUTION` were looked for and not found.
Tennis net measurements exist, but a tennis net is strung to a tension a
pickleball net is not, and borrowing across that gap is how a plausible number
becomes a fake one. They keep their values and their comment now says plainly
that they are tuning choices, with the reasoning out loud: a ball into the mesh
drops nearly dead, a ball onto the tape can go anywhere, and the gap between them
is what makes a net cord feel like luck.

`PADDLE_FRICTION` (DINK-33) is the same story. The governing body regulates
surface roughness rather than publishing a friction figure.

### Player movement: the target changed, the constant did not

`PLAYER_MAX_SPEED` and `PLAYER_ACCEL` are still unsourced, and today's search for
a source failed in a useful way. Both pickleball activity-profile papers were
found and read:

- "Match activity profile analysis during professional men's doubles pickleball
  tournaments" (6,839 shots, eight PPA Tour matches)
- "Match activity profile analysis during professional men's singles pickleball
  matches" (seven matches, Carvana Arizona Grand Slam)

Neither reports a single velocity, distance or acceleration. They are notational
studies, not GPS ones.

What they do report is better for our purposes, because it is the thing our
movement model *determines* rather than an input to it: **90.8 per cent of shots
were intercepted in doubles, 80.2 per cent in singles.**

And then the arithmetic, before adding a column to the profile tool: in a rally
of n shots every shot but the last was intercepted, so the interception rate is
just `(L-1)/L` of the mean rally length. 8.6 shots gives 88.4 per cent. It is a
restatement of a number already in the table.

So no column was added. That is the trap this project has hit six times — a
harness that measures itself and reports the answer back as a discovery — and it
was avoided this time by doing the algebra first. DINK-37 stays open with a
sharper description: the constant is unsourced and the published literature does
not contain it.

### Where the game stands

254 tests, up 8. Build clean.

```
                                 Dink    real    gap
  mean shots per rally          4.3      8.6    0.50x
  rallies of 1-4 shots         69.4%    43.0%   1.61x
  rallies of 5-8 shots         30.0%    44.0%   0.68x
  ended by striker error       34.2%    63.7%   0.54x
  ended unreachable            65.8%    36.3%   1.81x
```

Ladder still ordered: 10/10, 5/10, 0/10.

Nothing in that table moved today, and that is the correct outcome. The day
replaced guesses with sources, and where the guess was already close, replacing
it correctly *should* change nothing. A physics change that improved the rally
profile would have been a tuning change wearing a lab coat.

The gap that remains is not aerodynamic. Two thirds of faults are still double
bounces — players failing to arrive — and that is the movement model, which is
the one part of the physics with no published number to aim at.

## Day 21 — a file you can double-click

Nobody outside this repository has played the game. The Day 23 playtest needs
eight to ten people who will not open a terminal, so today is the plumbing that
teaches nothing about pickleball and without which the next two days cannot
happen.

It taught something anyway, four times.

### The failure that looks like success

Before writing a line of the shell, the question was whether the existing build
even loads without a web server. It does not:

```
canvas present: true
debug hook:     undefined
error: Access to script at 'file:///.../assets/index-Cd2VCVvH.js' from origin
       'null' has been blocked by CORS policy
```

Chromium refuses to load an ES module from origin `null`. The canvas is in
`index.html`, so it renders. Nothing throws. **A screenshot of this looks like a
game that has not started yet.**

That is the sixth time this project has produced a check that passes on
something adjacent to the thing that matters, and it decided the shape of the
whole day: every assertion written today asks whether the simulation is running,
because "a file exists", "a window opened" and "there is a canvas" are all
satisfied by a game that is dead.

The fix is a private `dink://` scheme handled in the main process. The usual
workaround is `webSecurity: false`, which turns off the protections of the
entire window in order to load a local script. Fifteen lines against that trade
is not a close call. ADR-0006 has the rest of the decision, including why
Electron rather than Tauri: one renderer on every machine, because Day 23 exists
to remove variables from a playtest rather than add three webviews to it.

### Three wrong diagnoses, all of them blaming the game

The verification tool launches the packaged binary and drives it. It failed
three times, and the game was innocent every time.

**"The simulation is not running: tick stuck at 0."** The GPU process was
exiting during startup:

```
Requested GL implementation (gl=none,angle=none) not found in allowed
implementations: [(gl=egl-angle,angle=default)]
```

`--use-gl=swiftshader` is the obvious flag and the wrong one on Electron 44. The
frame callback never fires, so the game boots, draws nothing, and reports tick 0
forever. `--use-gl=angle --use-angle=swiftshader` is the pair that works.

**"The simulation is not running: tick stuck at 0", again.** This time the
renderer was fine and the game was right: it opens on a title card. A freshly
booted app sits at tick 0 on purpose. The harness did not know that.

**"The simulation is not running", a third time.** Play pressed, screen
`playing`, tick still 0 — and correct again, because a match opens in
`awaitingServe` and the world does not step until somebody serves. In a normal
game that somebody is the person at the keyboard.

Three misses in a row is the rule for stopping and going to read the code, and
that is what finally produced a harness that knows what it is looking at.

### The click that worked one time in three

The fix for the third miss was to click the Watch button, hand both ends to the
computer, and let the game serve itself. It worked. Then it did not. Then it
did:

```
run 1: FAIL: the Watch control did not take effect
run 2: desktop build verified
run 3: FAIL: the Watch control did not take effect
```

No code change between them. Two separate causes, and the first one hid the
second:

`waitForFunction` polls on `requestAnimationFrame` by default. This container
renders in software at about two frames a second, so a harness polling on frames
while watching a game starved of frames spends its entire ten second timeout
taking twenty measurements. Switching to a timer fixed that — and immediately
exposed the real problem, because the faster poll could now land during the
match rebuild that clicking Watch triggers, and Playwright treats an exception
inside a poll as a failed wait rather than a poll to retry.

Even guarded, it stayed flaky. The reason is not a bug in the game: **synthetic
mouse input is hit-tested against the last composited frame.** At two frames a
second, a click aimed at a panel button lands wherever that button was half a
second ago.

So the desktop check serves with the keyboard instead. Keyboard events go to the
focused document and are never hit-tested, so they do not care what the
compositor is doing. Four runs, four passes.

This is not skipping the hard case. `tools/play.mjs` clicks every one of these
controls in a browser at a real frame rate, which is where a mouse test belongs.
Repeating it here would not have tested the packaged app, it would have tested
this container's compositor, and it would have failed two runs in three while
doing it.

### v1.1

The first screenshot of the packaged, verified, working desktop build showed
this in the panel:

```
Dink — Match Court
v1.1 · best of three to 11
```

Tagged v1.2.1. The string was typed into `index.html` on Day 11 and nothing ever
had cause to look at it again — not the tests, which ask the simulation
questions, and not a person, because a stale version number looks exactly like a
fresh one.

It matters more today than it did yesterday. A build somebody downloads and
reports a bug against is only useful if it can say which build it is. The
version now comes from `package.json` through a Vite `define`, and the
screenshot at the end of the run reads `v1.2.1` off the packaged binary's own
pixels.

### Sixteen megabytes of Three.js, twice

Unpacking the Windows build to check it carried the right files turned up
`/node_modules/three` inside the asar. Vite already bundles Three.js into the
578 KB game. It was being shipped twice.

The cause is a rule that is easy to miss: **electron-builder ships everything in
`dependencies` regardless of the `files` allowlist.** The allowlist named four
things and none of them was `node_modules`, and it made no difference.

`three` belongs in devDependencies, because the bundler consumes it at build
time and nothing requires it at runtime.

```
app.asar before   16 MB
app.asar after   588 KB
```

Twenty-seven times smaller, and the packaged app still boots, ticks and draws.

### And one self-inflicted wound

Midway through, `npm run build` started failing with `Failed to resolve
./assets/index-D3Tjvsbl.js from index.html` — the repository's source
`index.html` had been overwritten with a built one.

The instinct was to hunt the toolchain. The actual cause was a command typed an
hour earlier:

```
npx asar extract-file release/win-unpacked/resources/app.asar dist/index.html
```

`extract-file` writes to the current directory under the file's **basename**. It
took `dist/index.html` out of the archive and dropped it on `index.html` in the
repository root. Restoring it was one line; believing the toolchain had done it
would have cost the afternoon.

### What exists, and what is actually verified

This distinction is the whole point of the day, so it is written down rather
than implied:

```
linux-unpacked   LAUNCHED and driven: boots, ticks, draws, reads v1.2.1
AppImage 119 MB  payload extracted and LAUNCHED: boots, ticks, draws
Windows .exe      95 MB  BUILT. Payload inspected: right version, right files.
                         NOT RUN — there is no Windows here.
macOS zips  352 + 364 MB  BUILT, unsigned. NOT RUN.
```

The AppImage's own self-mounting path could not be exercised because the
container has no FUSE, which is a fact about the container. What was tested is
the payload inside it.

The Windows and macOS builds are the two that matter for Day 23 and they are the
two nobody has run. That is not a thing to paper over with a green tick: the
first playtester to double-click is the test, and the honest statement is that
the build is complete and unproven on the platforms it was made for.

Unsigned, too. macOS will demand right-click then Open, and Windows will show a
SmartScreen warning. Fine for people who are told; Day 28's problem for Steam.

### Where the game stands

269 tests, up 13. Thirteen of the new ones are the desktop shell: the URL
resolver, and the packaging manifest that decides which files reach a player's
machine at all.

Writing those turned up one more thing worth keeping. The resolver's traversal
guard was tested with three `../` attacks and all three tests failed — because a
registered standard scheme is parsed by the URL parser, and the URL parser
collapses `..` before the resolver ever sees it. `dink://game/../../../etc/passwd`
arrives with a pathname of `/etc/passwd` and lands harmlessly inside the build.
Only the percent-encoded form survives parsing, because `%2e%2e%2f` is not a
path separator until something decodes it, and the thing that decodes it is the
resolver.

So one of the four cases is the guard's entire reason to exist, and the other
three were tests of the URL parser wearing a security costume. The tests now say
which is which.

Nothing in `src/sim` was touched, so the ladder and the doubles profile are
yesterday's numbers unchanged.

## Day 22 — eight rivals, and the four that survived being measured

"Unlock the full game." Nothing in the game was locked — the only `unlock` in
the codebase is the audio autoplay handler — so the ask was the real one: it is
a complete match engine with no reason to play it twice.

Career mode. Eight named rivals, a ladder, and a record that survives closing
the tab. The interesting half was not the ladder.

### A name is worth nothing if everybody plays the same

The game had one opponent at three quality settings. `LEVELS` moves reaction
time, read error and mis-hit size, and all three answer "how good is this
person". None of them answers "what kind of player is this", so `easy` and
`tough` chose identical shots from identical positions and differed only in how
often they landed.

So there are two axes now, and ADR-0007 has the argument: **Skill is how well,
Style is what.** A rival is a Style plus a Difficulty and nothing else — no
hidden bonuses, no rubber-banding, no extra reach for the one at the top. If you
beat Marco it is because you worked out how Marco plays.

Every style field is a dial on the existing decision in `chooseShot`, never a
new branch. A style that needed its own special case would be a second policy
wearing a costume, and the day it disagreed with the first one there would be no
way to tell which was meant to win.

### The tool that deletes your work

`tools/styles.mjs` plays each style against a fixed `all court` reference and
prints the shot mix, court position, error rate and record. It ends by computing
its own verdict: any two styles within 12 points across those measures are
reported as **the same player**.

It was written to be able to fail, and its first run failed:

```
  "all court" and "crasher" are the same player (separation 10.9).
  A style that measures the same as another is a label. Delete or commit.
```

### Three misses, then look one level up

The first fix worked in singles. Doubles said:

```
  style        shots   drive    drop     lob    depth  at line  faults  won
  all court     410   33.4%   59.5%    7.1%   4.02m   67.9%   0.41   58.6%
  wall          402   32.1%   67.4%    0.5%   3.98m   67.9%   0.40   60.4%
  crasher       397   37.5%   59.7%    2.8%   3.98m   67.9%   0.40   60.5%
```

`at line` is 67.9 per cent for all three. Identical to a tenth of a per cent,
which is not a coincidence and not noise: **in doubles a player's court position
is owned by `planTeam`, not by the individual.** So `homeDepth` and `netUrge`
are singles-only dials, and a style built on court position has nothing to
express in half the game.

That was the third tuning pass, which is this project's rule for stopping and
going to read the code instead. `crasher` was built, measured and deleted the
same day — the second time that has happened here and the second time it was
right. Four styles that differ everywhere beat five where one is a duplicate in
the mode a ladder will mostly be played in.

### A constant that has done nothing for seventeen days

Placing the styles' attack thresholds needed a number nobody had: where is the
ball actually when somebody hits it?

```
net         n= 284  p10 0.34  median 0.39  p75 0.52  p90 0.65
transition  n= 311  p10 0.33  median 0.33  p75 0.33  p90 0.49
back        n= 215  p10 0.34  median 0.34  p75 0.35  p90 0.36
```

`ATTACK_HEIGHT` has been 0.95 since Day 5, set by eye. It sits above the 90th
percentile of every zone. "Attack the high ball" is a branch that exists, is
reachable in principle, and has almost never fired.

Worse for today: three styles separated by 0.8, 0.95 and 1.15 would have been
three thresholds all sitting above the distribution, differing from each other
in a region with no data in it. Which is exactly what the first draft had.

The style thresholds now sit inside the measured spread. `all court` keeps 0.95
on purpose — it is the control for the singles ladder, and moving it is a
balance change rather than a career one. That it is near-dead is DINK-115 rather
than a secret.

### The banger is not a difficulty setting, it is a bug report

```
  banger        117   98.3%    1.7%    0.0%   5.37m   26.2%   0.12   87.8%
```

Eighty-eight per cent of rallies won, with the FEWEST errors of any style, in
the mode the sport considers a soft game. It was designed to be error-prone —
`attackHeight` at the tenth percentile means it tries to hit down on balls well
below the tape — and it turned out to be dominant instead.

It wins by hitting hard and flat. That works because this game's players cannot
cover a hard flat ball, which is DINK-37, the movement model, seen from a new
angle: Day 20 measured that two thirds of faults are still double bounces and
called it a realism gap. It is also a balance defect, and the banger is what
turned one into the other. A style that beats the sport by exploiting the engine
is a finding, not a difficulty setting. DINK-114.

### A test that caught a contract, not a crash

The style invariant tests found this:

```
AssertionError: expected 1.0625 to be less than or equal to 1
```

`spread` is a multiplier, so the banger's 1.25 times the 0.85 of a put-away aims
at 1.0625 — off the court. The game was never wrong, because `driveOpponent`
clamped on the way out. The **contract** was wrong, and a contract that holds
only because one caller is careful is a contract that breaks when a second
caller appears. Clamped where the value is produced now.

### The ladder

Eight rivals, hardest first, interleaving style with difficulty rather than
running easy-steady-tough three times. Rung 5 is a steady all-courter and rung 4
is a steady banger, and which of those is harder depends on how you play.

You may challenge the rival one rung up and nobody else. A ladder where you can
challenge anybody is a menu, and a menu is what the game already had.

No relegation, and that is a decision rather than an omission. This game is
forty minutes deep at most, and a ladder that can send a player backwards turns
a bad session into lost progress, which is the mechanic most likely to make
somebody close it and not come back. It costs the climb some tension. That is
the better of the two problems while the game is this young.

`challenging` is captured when the match STARTS, not read from the career when
it ends — winning changes who is next, so reading it at the end would credit the
win to the wrong person. Same commit-once shape as ball ownership on Day 15 and
`readOff` on Day 6.

### And it was at the bottom of the panel

The first screenshot of the finished feature showed the court, the score, the
controls, the match settings, the opponent levels and the game speed. The career
ladder was below all of it, off the bottom of a scrolling panel.

That is DINK-79 from Day 19 repeating inside a single day: work nobody can find
is work nobody can use. Moved directly under the score, where the thing you are
actually doing belongs.

The browser harness now clicks it, and the assertion is chosen so it cannot pass
for the wrong reason: the panel is set to `tough` immediately before the
challenge, and the bottom rival is `easy`.

```
career: 9 rungs · "Play Nan Whitlock" started a match at easy (rival's own level)
```

If the ladder were ignoring the rival and using the panel, that line would read
`tough`.

### Where the game stands

306 tests, up 31. Twenty of them are the career save file, because it is the
only state in the game a player can lose: a rank from a build with a longer
ladder is clamped rather than rejected, an unknown rival id is dropped without
taking the rest of the record with it, and a `best` that disagrees with the rank
believes the rank, because the rank is the number the player can see.

## Day 23 — the claim nobody had checked

Day 23 in the plan is "playtest with eight to ten real players, watch, do not
explain". I cannot be eight people, and inventing what they said would be the
single worst thing this project could do: every number in this repository for
twenty-three days has come from a stand-in the project wrote itself, and the
whole reason Day 23 exists is that a person is the one instrument it does not
control.

So today is everything that makes that playtest worth running when it happens,
starting with the thing deferred twice.

### Twenty-three days of an unexercised belief

ADR-0001 claimed on day one that the simulation is deterministic. That claim has
paid for a great deal of design: the fixed 120 Hz accumulator, named random
streams, no wall clock anywhere in `src/sim`, InputFrames as the only channel in.
Every one of those decisions was justified by reproducibility.

Nobody had ever tested it.

```
replay format 1

  match 1: 10800 ticks, 423 runs, 6.7 kB, 25.5 ticks/run · identical
  match 2: 10800 ticks, 422 runs, 6.6 kB, 25.6 ticks/run · identical
  match 3: 10800 ticks, 422 runs, 6.6 kB, 25.6 ticks/run · identical

  control: changing only the seed changed the match

3 matches replayed bit for bit. ADR-0001's determinism claim holds.
```

It holds. Ninety seconds of play is 6.7 kB, and the comparison is exact rather
than tolerant — `Object.is` on ball position, velocity, spin, every player's
position and velocity and swing phase, and the score, sampled every 37 ticks
rather than only at the end. A final state can match by luck; a divergence that
self-corrects is still a divergence.

Exact, not close. Floating point is deterministic — the same operations in the
same order on the same inputs give the same bits — so "within a millimetre"
would have passed on a simulation that had quietly become frame-rate dependent.
A tolerance there would have been a way of not asking the question.

### Three green ticks are worth nothing on their own

This project has shipped six harnesses that passed for the wrong reason, so the
tool finishes by deliberately breaking the one input that must matter — the seed
— and asserting that it *notices*:

```
  control: changing only the seed changed the match
```

If that line ever reads CHANGED NOTHING, every line above it is decoration.

### And the control found a real bug on its way past

To break the seed, the seed had to exist. It did not.

`createRally` has taken a seed since Day 16 and **nothing had ever passed one**.
Every match the game has ever played ran on seed 0. The opponent's random stream
was byte-identical from the first serve of every match, in every session, on
every install — the same mis-hit on the same ball, every time anybody pressed
Rematch.

It survived twenty-three days because determinism is a virtue in this project
and "the same every time" reads as the system working. The distinction it hides
is between **reproducible** and **identical**, and the replay recorder is what
forced it: to replay a match, you must first admit the match had a seed.

Every match now draws one, and it is on the debug hook, because a bug report
that says "seed 3141592653" is a match somebody can step through.

### Clipboard, not download

Every match records now — always, because the one you want a recording of is the
one that just went wrong, and 6.7 kB is cheaper than asking somebody to
reproduce a bug.

`Copy replay` puts it on the clipboard rather than offering a file. That is not
laziness: a published artifact runs in a sandbox where a page cannot start a
download at all, so a download button would work in the desktop build, work
locally, and silently do nothing for most playtesters. Text pastes into a
message from anywhere.

### The protocol, written before the data

`docs/playtest.md`. The parts worth repeating here:

**"Watch, do not explain" is a constraint with a cost, and the cost is the
point.** Every time you explain a control you have destroyed the only sample you
will ever get of somebody meeting it cold. There are eight to ten such samples
in existence and then they are gone.

**When they ask a question, the question is the finding.** The answer is not.
Write it down verbatim and say "try it and see".

**Three of eight before it is a finding.** One person struggling is one person.

**The triggers were written down before the data**, so the results cannot be
read to suit a preference already held. Top complaint is "nobody to play
against" → days 26 and 27 become netcode, which the determinism verified today
is what makes reachable. Top complaint is "I could not tell what I did wrong" →
the coaching read. Top complaint is rallies ending too fast → that is DINK-37,
and it would mean eight strangers independently found what the rally profile has
been saying since Day 17.

And a section on what the playtest **cannot** tell you, so it is not quietly
assumed: not whether it is fun after two hours, not whether it sells, and not
whether the physics is right — they will not notice the aerodynamics, and that
is the correct outcome.

### Where the game stands

324 tests, up 18. The new ones are the recorder, and the one that matters most
is the smallest: `newSeed` never returns 0 and never returns the same number
twice in two hundred draws.

Nothing in `src/sim` changed today, so the ladder and the profile are yesterday's
numbers — except that every match now has a different seed, which means the
next person to run `npm run tally` should expect the numbers to move slightly
and should not go looking for a bug.

## Day 24 — the first thing eight strangers will see

Block 1 of the plan starts with eight people meeting this build cold, and until
today the first thing any of them would have seen was the Electron logo in their
taskbar. electron-builder had been saying so since Day 21:

```
  • default Electron icon is used  reason=application icon is not set
```

A warning in a build log, which is to say invisible.

### Drawn from source, not checked in as a blob

`tools/icon.py` generates every size from one description, for the same reason
`PADDLE_INERTIA` is derived rather than asserted: a binary nobody can regenerate
is a number nobody can change.

The constraint that decides everything is that it has to read at 16 px. So the
rules are poster rules — one silhouette, two colours, and nothing whose absence
at small size changes what the thing is — and the only way to know whether it
works is to render it at 16, 32, 48, 64, 128 and 256, on white and on black, and
look at it. `--contact` does that.

### Three drafts, two of them wrong in instructive ways

**Draft one was the ball**, alone, with seven large holes, because the holes are
what makes a pickleball a pickleball. Rendered and looked at, it was a **film
reel**. Seven big evenly spaced circles is the aperture pattern and the
resemblance was total at 256.

The mistake generalises: a real ball has forty small holes, which at icon size
is a *texture*. Reproducing "holes" as countable shapes reproduces the wrong
thing entirely.

**Draft two was the paddle**, which is the better silhouette and unambiguous in
a way the ball is not — it is not a tennis racket, not a ping-pong bat, and the
wide flat face with the stubby grip is recognisable to anybody who has held one.
It was also too big for its frame, cropped at two edges, and carried a single
inset line across the face that read as a slot or a mouth. A stripe across a
shape says "opening"; an outline says "edge".

**Draft three added a grip wrap** — three dark bands at the butt of the handle,
to stop the silhouette reading as a rounded slab on a stick. Rendered and looked
at: three horizontal bands on a narrow stem is a **screw thread**, and the icon
became a bolt.

Deleted rather than tuned, which is the third time this project has built
something, measured it worse, and removed it — after `coverTheRest` on Day 16 and
`crasher` on Day 22. The general lesson is worth keeping: at icon size, repeated
parallel marks are read as texture-with-a-meaning long before they are read as
detail, and the meaning they land on is rarely the intended one.

Draft four is draft two, reproportioned from the real thing — a regulation
paddle is a 16 in body with an 11 x 8 in face, so the face is markedly taller
than wide and the handle is a handle rather than a stub — with the outline
instead of the stripe and nothing touching the frame.

### "The builder did not complain" is not a check

The obvious verification is that the `default Electron icon` warning stopped
appearing. That is an absence, and this project has spent three weeks learning
what absences are worth.

So the exe was opened and the icon group read out of it:

```
icon.ico declares 7 images
  16x16: present in the exe
  24x24: present in the exe
  ...
  256x256: present in the exe
7/7 icon sizes embedded
```

A `.ico` is a container, and one that declares only 256x256 looks perfect in a
file listing and renders as a blurry mess in the taskbar, which is the only
place it is ever actually seen. There is now a test for that too.

### The 404 that had been sitting in plain sight

Day 22's browser harness printed one unexplained line:

```
errors: [ 'Failed to load resource: the server responded with a status of 404' ]
```

It was the favicon. The tab icon had never existed, which means every playtester
opening the artifact gets a blank page icon.

The fix is not a `favicon.ico` file, because `tools/ship.mjs` inlines the entire
game into **one** HTML file and there is no second file for the browser to
fetch — a linked favicon would have worked in dev, in the Vite build, and in the
desktop shell, and 404'd in the exact place most playtesters will play. It is now
a 1.8 kB data URI written into `index.html` by the same script that draws the
icon, so it cannot drift from it. No failed requests left.

### What I could not do today

Day 24 in the plan is "icon, and the Windows build actually launched on a real
machine". The second half is DINK-104 and it cannot be closed from here: there
is no Windows in the environment that builds the Windows exe.

What is verified: it is a valid PE32 binary, all seven icon sizes are embedded,
the payload carries the right version and both shell files, and the identical
payload boots, ticks and draws on Linux. What is not verified is that Windows
runs it, and no amount of work here changes that.

`docs/playtest.md` now opens with the five-minute procedure, including the thing
that will happen and surprise somebody: **SmartScreen will block it**, because
the build is unsigned, and every playtester will need to be told to click More
info then Run anyway.

327 tests, up 3. Nothing in `src/sim` was touched.

## Day 25 — the models, and a prompt that was wrong about its own repository

Day 25 in the plan is four playtest sessions. Redirected: rebuild the player
models, following the prompt written yesterday.

### The prompt was wrong three times before a line of code was written

Before starting, I read `src/render/player.ts` properly. The brief I had written
the day before claimed the figures had **no feet, no neck, and no arm
counter-swing**. All three already existed.

It had been written from a conversation summary rather than from the file. That
is DINK-103 — a guess recorded as a fact — and it is now the fourth instance.
The prompt is corrected and carries the correction visibly, because a prompt
that misdescribes the repository is worse than no prompt: it sends whoever
follows it to build things that are already there.

What was actually wrong: limbs of constant cross-section, a slab torso, no
athletic stance, and a rigid trunk.

### Tapered primitives, and a joint that did not exist

`limb()` was a `BoxGeometry` of fixed width. A thigh and a shin the same
thickness is not a leg, it is a plank with a hinge in it. It is now a
`CylinderGeometry` with different radii at each end and a `squashZ` that
flattens the cross-section, because a limb is not round and a torso is much less
round than a limb. Eight radial segments; sixteen is indistinguishable at
fourteen metres.

The bigger structural change: **everything above the waist was parented straight
to the root**, so there was no joint between the legs and the chest and
therefore nowhere for a lean or a rotation to happen. There is now an `upper`
group hinged at hip height, which is what lets the torso pitch forward into a
crouch and twist through a stroke.

Its origin is at the hips rather than at the floor, so pitching rotates the
chest over the hips the way a person bends instead of tipping the whole figure
like a felled tree. And the pitch and twist live *inside* the yaw that turns a
player to face the net — on the same object they would compose with it and the
far player would lean backwards.

### The silhouette test, and what it killed

The prompt says the first check is to strip every colour, render the figure as a
solid cutout, and look at it. It is now `?silhouette=1` rather than something
done once by hand, because a check you have to rebuild in order to repeat is a
check that gets run once.

It immediately said the knee bend was not working. Not that it was absent —
`CROUCH_KNEE` is 0.62 radians, which is a deep bend — but that it was
**invisible**. The game's camera looks down the length of the court, so a
fore-aft flexion is foreshortened almost to nothing.

Measured, before and after adding a lateral stance:

```
before  height 344 px   width 115 px   leg span  72 px
after   height 344 px   width 150 px   leg span 147 px
```

The leg span doubles. The height does not move at all, which is the measurement
confirming the diagnosis: the knee bend contributes nothing from the only angle
anybody plays at.

Feet apart is lateral, so it survives every camera in the game, and it is the
more truthful cue anyway — what makes a waiting athlete look ready is a base
wider than their shoulders, far more than the angle of their knees. The crouch
stays, because it is right from the side and costs nothing, but it is no longer
what the stance is made of.

This is the second time this project has found that a thing was implemented
correctly and simply could not be seen. It is a different failure from a bug and
it needs a different instrument: not a test, a picture.

### Everything else

The ready stance eases OUT with speed — a sprinting player extends, only a
waiting one is coiled — so the pose is strongest at a dead stop, which is
exactly when the figure would otherwise look most inert. The off arm comes up
and across instead of hanging, because an arm dangling at the side is the
clearest possible tell that a figure is idle rather than poised. The toes turn
out sixteen hundredths of a radian, statically, because parallel feet read as
wrong long before anybody can say why.

The paddle aim had to move from `body` space into `upper` space. The arms now
hang off a chest that twists, and resolving the reach vector in the old space
would have aimed the arm correctly only while the torso happened to be square —
which is to say everywhere except during a swing.

### Verified

```
327 tests, no test edits        perf: 0.9x inside the 8.33 ms budget
PASS: 6 points played through the keyboard
```

Before and after from the broadcast camera are in
`docs/shots/models-before-after.png`, and the difference is visible in a still
frame, which was the bar the prompt set: if you cannot see it in a still, it is
a refactor rather than an improvement.

### The hotfix: the published game could not draw a person

"I still only see the blue ring." Reported today, and reported once before on
Day 16, and it was exactly right both times.

`tools/ship.mjs` built the artifact by inlining the bundle into one HTML file
and THEN stripping the page skeleton, so every skeleton-stripping regex ran
across a megabyte of minified Three.js. One of them was `/<meta[^>]*>/gi`, for
removing the charset and viewport tags the publish target supplies itself.

Three.js assembles its shaders from directives like

```
#include <metalnessmap_pars_fragment>
```

and `<metalnessmap_pars_fragment>` begins with the letters `meta`. The regex ate
it and left `#include ` pointing at nothing:

```
ERROR: 0:1458: 'include' : invalid directive name
ERROR: 0:1605: 'metalnessFactor' : undeclared identifier
```

Every `MeshStandardMaterial` failed to compile. **The players are
`MeshStandardMaterial`. The reach rings are `MeshBasicMaterial`**, which needs no
shader chunks and compiled fine. So the published game drew a court, a net, and
two rings on an empty court — which is precisely the bug report, twice.

Counted: the bundle had 715 `#include <chunk>` directives and the artifact had
713.

It survived because **every check this project owns runs against `dist`** — the
tests, `npm run shots`, `npm run watch`, the browser harness, the desktop
verifier. The artifact is the one build nothing ever looked at, and it is the one
build people actually play. Twenty-five days of measuring the wrong binary.

Two fixes. Strip the skeleton BEFORE inlining, so the regexes only ever see
twelve kilobytes of hand-written HTML and no future one can reach the bundle
however it is spelled. And `ship` now refuses to package an artifact whose
shader include count does not match the bundle it came from.

That check counts rather than judges, and the reason is the first version of it:
it looked for `#include` not followed by `<`, and its only hit was a false
positive inside Three.js's own include parser, whose source is
`/^[ \t]*#include +<([\w\d./]+)>/gm` — a `+` sits where the `<` was expected.
Any rule clever enough to exclude that is a rule clever enough to be wrong
again. The bundle is the ground truth; comparing counts needs no cleverness.

## Day 26 — verifying the build people actually play

Yesterday's defect was not the regex. The regex was a mistake anybody could make.
The defect was that **nothing in this repository had ever looked at the
artifact**: the tests, `npm run shots`, `npm run watch`, the browser harness and
the desktop verifier all run against `dist`, and the artifact is a separate
build with its own transformations. Twenty-five days of measuring the wrong
binary, and a person found it twice before any tool did.

So today is `tools/artifact.mjs`: launch the published artifact, drive it, and
assert a person is on screen. Same discipline `tools/desktop.mjs` applies to the
packaged binary, pointed at the other shipped artefact. `ship` will not package
without it.

### The check that looked perfect and could not work

The obvious way to count players is `?silhouette=1` — the Day 25 flag that
renders every player flat black, which would make counting trivial.

It would have passed, in green, on the broken build. Silhouette mode swaps the
players onto `MeshBasicMaterial`, which needs no shader chunks and **compiled
perfectly well yesterday**. The tool that looks most suited to the job is the
one tool that cannot do it, because it avoids the exact code path that was
broken.

### Three wrong measurements before one right one

**0 warm pixels on a build whose players were plainly visible.** The first
version read the canvas back in the page — `drawImage` onto a 2D context, walk
the data. A WebGL drawing buffer is not readable after the frame that drew it
unless the context sets `preserveDrawingBuffer`, and Three.js leaves that off.
So the harness got a cleared buffer and confidently reported the exact defect it
was built to find, on a build that did not have it. A false positive is the more
dangerous direction: a check that cries wolf gets switched off, and then the real
thing ships.

**4,886 warm pixels on the deliberately broken build — a pass.** Switched to
screenshots, and the count sailed over the floor. The warm pixels were the
**side panel**: the amber accent on every BANGER label, the Play button, the
pressure bar. It was measuring the user interface and calling it a player. It
survived because the broken build also logs a console error, so the tool failed
for the right reason by accident and nobody looked at the number.

**450 against 1,414 — a 3x gap, which is a coin toss with extra steps.** Clipped
to the canvas, and the remaining warm pixels on the broken build were the paddle
face, the ball and the shot trail. All warm, none of them a person.

The discriminator that works is `r - b > 40 AND r < 225`. The second half throws
away the pale things: the paddle face is (240,217,168) and the ball is
(255,217,74), while skin is (199,154,114) and the far kit is (217,139,106).

```
working   1,112 skin pixels
broken       57
```

Twenty times apart. That is a check.

### Proving it

A check that has never failed is a check nobody has shown can fail, and this
project has now shipped seven harnesses that passed for the wrong reason. So the
tool has a `--expect-broken` mode, and the falsification is run against an
artifact built by re-applying yesterday's exact regex:

```
good includes 715   broken includes 713

broken:  only 80 skin pixels on the court (floor 300)
         1 console error: THREE.WebGLProgram: Shader Error 0
good:    screen playing, tick 156, 1133 skin pixels, no console errors
```

Both assertions fire independently on the broken build. The console error catches
a loud failure; the pixel count catches a silent one. Neither is load-bearing
alone.

### What it costs

About forty seconds on every ship, and it is skipped by `--skip-verify` along
with the rest of the verification. That is the whole price of never again
shipping a game with nobody in it.
