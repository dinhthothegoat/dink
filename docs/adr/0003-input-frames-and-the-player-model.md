# ADR-0003: Input frames, and reach as the game's central constraint

- Status: Accepted
- Date: 2026-09-09
- Sprint: Week 1, Day 3
- Deciders: Tho Dinh (owner)

## Context

Two days of work produced a ball that flies correctly and a paddle that hits it
correctly, but every shot so far has happened wherever the sandbox said it did.
Nothing had to travel to the ball, and nothing could fail to arrive. That is
the difference between a physics demo and a game.

This is also the day the project was rescoped from six sprints to ten working
days, which changed what "good enough" means for everything below.

## Decision one: the simulation only ever sees InputFrames

`src/core/input.ts` is the only file allowed to know a keyboard exists. It
turns devices into an `InputFrame` — movement, a swing edge, a shot shape, an
aim bias — and everything downstream consumes those.

This is the promise from ADR-0001 being cashed in. A rally is now a starting
state plus a list of InputFrames, which means a replay is a re-simulation
rather than a recording, and the same list is what a network peer would send.
Neither of those is being built in the two weeks, but the seam that makes them
possible costs nothing today and cannot be retrofitted cheaply.

There are two buffers, deliberately separate:

- The **input buffer** holds a keypress that happened between two ticks. At
  120 Hz there is an 8 ms window a player can fall into, and losing a press
  there is the kind of bug that reads as "the game ignored me". It latches for
  one tick and no longer.
- The **player** holds a swing asked for while it is already swinging. That is
  a rule about when a shot is allowed, not about sampling a device, so it lives
  where it can see whether the swing is available.

Putting both in one place would have been simpler and wrong: they expire for
different reasons and over different timescales.

## Decision two: reach is the constraint, and it is visible

A player can meet the ball within 1.15 m — shoulder to fingertip plus the
paddle plus a lunge. Past that the shot does not exist for them.

Inside that radius, how stretched the contact is becomes a single number, and
that number is handed straight to the paddle as an impact point on the face.
A player at full stretch catches the ball off the end of the paddle, and the
contact model from Day 2 already knows exactly what that costs: effective mass
collapses and the shot leaves weak. No damage multiplier was written. Bad
position produces a bad shot for the same physical reason a bad swing does.

The reach ring is drawn on the court, coloured by strain. Reach decides which
balls exist for you, and a rule that invisible would just feel like the game
failing at random.

## Decision three: a swing takes time, and the game shows you where to aim

Pressing swing puts the paddle on the ball 120 ms later, and there is a 200 ms
recovery before another. This is what makes movement matter: press when the
ball is already in reach and it has moved a metre and a half by the time the
paddle arrives.

That would be unreadable without help, so the court draws where the ball will
be at contact, computed by running a copy of the world forward. Re-simulating
rather than extrapolating means the aid and the reality cannot drift apart, and
the same prediction is what the opponent will use on Day 6 to decide when to
start moving.

## Consequences

- The slider sandbox is gone. It was the right tool while the flight model was
  the only thing that existed, and it is now superseded by playing.
- `session.ts` holds a practice session — a feeder and one player — with no
  rules in it. Rules arrive on Day 4, and keeping them out today meant reach
  and swing timing could be judged without a scoreboard in the way.
- The feed goes through the shot solver rather than being aimed by hand, after
  the hand-aimed version put every ball into the net. Anything that puts a ball
  on this court should agree with the shot model, including the ball machine.
- A browser-driven play test now exists: an autopilot inside the page, reading
  the on-screen telemetry and dispatching real key events. It is the only test
  that covers DOM events through to a landing, and it earned its keep on the
  first run by catching a shot-targeting bug the unit tests were blind to.
