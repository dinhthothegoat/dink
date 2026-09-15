# ADR-0004: Feel lives in the renderer, and runs on real time

Status: accepted (Day 8)

## Context

The game is correct and it is beatable. It does not yet tell you anything.

A swing commits 120 ms before the paddle arrives, so a player presses a key and
then waits, and until now nothing at all marked the moment of contact. Day 7
made shots go wrong under pressure, but the consequence lands two seconds later
when the ball drops out — long after anyone would connect it to the swing that
caused it. Both problems are the same problem: the game has no way of answering
"was that good?" inside the window where a person is still asking.

The fixes for that are the usual ones — a flash at contact, a sound whose
character changes with the strike, a camera that flinches, a shake. Every one of
them is a temptation to reach into the simulation, because the most satisfying
versions of these effects in other games do exactly that: hitstop freezes the
world for 80 ms, a slow-motion winner scales time, a screen shake is applied by
moving everything except the camera.

## Decision

**No effect may change anything the simulation reads, and every effect is
advanced with real elapsed seconds rather than simulated ones.**

Concretely:

- Audio, impact rings, camera lean and camera shake all live in `src/render`,
  are driven by `RallyEvent`s the simulation already emits, and write nothing
  back.
- `GameLoop`'s render callback now takes `frameSeconds` — wall-clock time since
  the last frame, unscaled by game speed and clamped at 100 ms — alongside the
  existing interpolation alpha. Cosmetic state uses that, never `SIM_DT`.
- Anything that genuinely needs to change gameplay timing must go through
  `loop.setSpeed`, which already exists and is already a first-class, visible
  concept.

## Why

**Determinism is the thing this codebase is built on.** ADR-0001 made
`src/sim` pure so that a rally is a starting state plus a list of input frames,
which is what makes headless tests, the tally tool, replays and eventually
netcode possible. Hitstop is the cheapest way to throw all of that away: it is a
gameplay change wearing a cosmetic costume, and two clients that disagree about
whether a hit happened will disagree about the world state forever after. Every
finding since Day 5 has come from a headless tool playing thousands of rallies;
none of that survives a renderer that can pause the world.

**The game already has a speed control, and effects in simulated time break
it.** The default is 60 per cent of real time. A shake decaying in simulated
seconds lasts two thirds longer at that setting, and nearly twice as long at the
"slower" one — so the slow-motion setting would quietly become a different game
to look at, with a mushier camera and longer flashes. Feel should be the same at
every speed; only the play should be slower.

**The frame rate is not a constant.** The follow camera settles with
`1 - exp(-dt/tau)` rather than a fixed lerp fraction for the same reason the
simulation runs on a fixed timestep: a lerp of `x += (target - x) * 0.1` moves at
a rate that depends on how often it is called, so a smooth follow on a 144 Hz
display is a snap on a 60 Hz one and a crawl in the headless test harness at 15.
Stating the tuning as a settling time in seconds means it can be tuned once.

## Consequences

Good:

- The headless tools and the browser see identical simulations. `tools/tally.mjs`
  keeps working with no renderer at all, which is what makes the difficulty
  ladder measurable.
- Feel can be changed freely without re-tuning balance, and balance without
  re-tuning feel. They are not coupled through anything.
- Muting, or a machine with no audio at all, cannot change the outcome of a
  point.

Costs, stated plainly:

- No hitstop, and no slow-motion replay of a winner. Both are real polish that
  this game will not have. If a slow-motion moment is wanted later it has to be
  a `setSpeed` ramp, which is honest — the simulation genuinely runs slower and
  the input frames record it.
- Camera shake cannot be driven by simulation state directly; it is fired from
  events, which means a very long single tick could in principle drop one. At
  120 Hz with a 100 ms clamp this has not happened.
- Two clocks now exist in the render path, and confusing them is a live bug
  risk. Mitigated by the parameter being named `frameSeconds` rather than `dt`.

## Alternatives considered

**Hitstop by skipping fixed updates.** Freezing the world for a few frames feels
excellent and is what most action games do. Rejected because the simulation
would no longer be a function of its input frames, and every headless tool and
future replay would disagree with what the player saw.

**Effects in simulated time, with the game speed compensated for.** Would work,
and was two lines shorter. Rejected because the compensation is exactly the kind
of factor that gets dropped from one of the four call sites six weeks later, and
the symptom — a camera that feels slightly wrong at one speed setting — is one
nobody would ever track down.

**Sampled audio.** Better-sounding hits, immediately. Rejected for now because
the published build is a single self-contained page, so samples would be base64
in the bundle; and because a synthesised hit can be a continuous function of
exit speed and how far off the middle of the paddle the ball was, where a sample
can only be chosen from a short list. The mapping being a pure function is also
the part worth testing, and it is tested.
