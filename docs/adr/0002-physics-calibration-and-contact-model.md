# ADR-0002: Physics calibration sources and the paddle contact model

- Status: Accepted
- Date: 2026-09-08
- Sprint: 1, Day 2
- Deciders: Tho Dinh (owner)

## Context

Day 1 shipped a ball-flight model with two invented coefficients: a drag
coefficient of 0.45 and a lift slope of 1.0. Both were plausible-looking
guesses, and the lift figure was logged as debt (DINK-14) because a 600 rpm
backspin drive was flying two and a half metres past the baseline.

Day 2 also had to answer a larger question. Everything so far launches a ball
with a velocity and a spin, but a game does not have those controls: it has a
paddle. Something has to turn a swing into a ball, and whatever that something
is will decide how the game feels for the rest of the project.

## Decision, part one: constants come from measurements, or they say TUNED

Every aerodynamic constant is now sourced.

- **Drag.** Trajectory fitting of a 40-hole outdoor Selkirk ball gives
  Cd = 0.30 +/- 0.02. Independent wind-tunnel work reports a mean of 0.33 for
  outdoor balls and 0.45 for indoor. Day 1's 0.45 was the indoor 26-hole ball,
  which is a genuinely different object.
- **Lift.** Two independent studies converge on Cl = 0.195 * S, where
  S = r*omega/v. Day 1 used 1.0. Five times too strong.
- **Air density.** Both studies worked at 1.29 kg/m3. We simulate at standard
  1.225, so both coefficients carry a 1.29/1.225 scaling. It is the force that
  has to match the measurement, not the bare number, and a test guards this
  because a future reader comparing 0.316 against a paper saying 0.30 will
  otherwise "fix" it.
- **Mass.** Moved to 0.0243 kg, the mid-spec value the drag fit was made
  against. Mass and Cd have to come from the same source or the fitted force is
  wrong.

Anything without a published figure is marked TUNED in the source, with the
reason. Two remain: spin decay in flight (DINK-32) and paddle-face friction.

A third finding shaped the design more than the numbers did. The trajectory
study models rotation up to 15 revolutions per second and calls 10 typical, so
about 600 rpm in normal play and 900 at the top. Day 1's presets carried
1400 to 1800 rpm, which no paddle produces. There is now a hard ceiling.

## Decision, part two: spin is not a dial

The contact model takes a swing, described as a face orientation and a swing
path, and resolves one impulse. Spin is not an input. It emerges from the angle
between where the face points and where the paddle is travelling: swing along
the normal and the ball comes off flat, brush upward across a closed face and
friction at the contact patch spins it. This is how a paddle actually works,
and it means there is no table of shot types to maintain and no way for a shot
to be given spin it did not earn.

Two consequences fall out for free rather than being authored:

- **Off-centre hits are weak.** The paddle is treated as a free body during the
  four milliseconds of contact, because the hand cannot respond that fast. Its
  effective mass at the impact point is then M / (1 + M*d^2/I), so a tip hit
  spends the collision rotating the paddle rather than driving the ball. A tip
  hit loses about a third of its exit speed. No power curve was written.
- **The power spot sits below the centre of the face**, over the centre of
  mass, which is exactly where coaches tell people to hit.

Paddle inertia is derived from a handle-rod plus face-plate decomposition
rather than hardcoded, and the mass split between the two is solved so the
model balances at the published balance point. That is the one paddle property
manufacturers actually print, so it is the right thing to anchor to. A test
checks the model reproduces it.

## Decision, part three: a solver, pulled forward from Sprint 3

Given a target and a shot shape, `solveSwing` searches swing speed and face
pitch for a swing that lands there, then closes the lateral error with
feedback rather than trusting geometric aim, because spin bends the ball.

It was scheduled for Sprint 3 with the opponent AI. It moved to Day 2 because
without it the contact model can only be tested by asserting that some numbers
came out of it. With it, the test is "ask for a third shot drop and check the
ball lands in the kitchen", which is the property that actually matters. It
runs in 10 to 50 ms, well inside the budget for an opponent deciding a shot.

## Consequences

- Shot presets are gone from the sandbox. Targets replaced them: the player
  asks for a shot and the solver produces a swing. Presets were data that went
  stale; a solver does not.
- Recalibration changed every preset, and the new figures are more realistic
  than the hand-tuned ones: drives now come off flat at 8 to 9 degrees with an
  apex of 1.05 m rather than the 18-degree loop the over-strong drag forced.
- The model is sensitive to about 30 cm of landing point per degree of face
  pitch. That is a real property of the sport, not a bug, but it sets a floor
  on the resolution the eventual input model needs.
- Contact tuning now has one lever with real reach, paddle-face friction. It
  was lowered from 0.5 to 0.35 because at 0.5 every brushed shot gripped
  completely and any slice at all pinned the spin ceiling.
