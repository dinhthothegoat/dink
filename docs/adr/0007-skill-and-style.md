# ADR-0007: Skill and Style are two axes, not one

Day 22. Accepted.

## Context

Career mode needs eight rivals a player can tell apart. The game had one
opponent at three quality settings: `LEVELS` moves reaction time, read error and
mis-hit size, and all three answer "how good is this person". None of them
answers "what kind of player is this", so `easy` and `tough` chose identical
shots from identical positions and differed only in how often they pulled them
off.

A ladder of eight people who all play the same way is a ladder of one person
with eight portraits.

## Decision

Two independent axes:

- **Skill** — how well the chosen shot is executed. `src/sim/execution.ts`.
- **Style** — which shot is chosen at all. `src/sim/style.ts`.

Independent means a nervous banger and a fearless banger are both bangers, and a
weak dinker is bad at the same game a strong dinker is good at. A rival is a
Style plus a Difficulty **and nothing else** — no hidden bonuses, no
rubber-banding, no extra reach for the rival at the top. If the player beats
Marco it is because they worked out how Marco plays, and that is only true while
Marco is made of the same parts as everybody else.

Every style field is a dial on the existing decision in `chooseShot`, never a
new branch. A style that needed its own special case would be a second policy
wearing a costume, and the day it disagreed with the first one there would be no
way to tell which was meant to win.

## Consequences

**A style must be measurable or it does not exist.** `tools/styles.mjs` plays
each style against the `all court` reference and prints its shot mix, court
position, error rate and record. It computes its own verdict: any two styles
within 12 points across those measures are reported as the same player. The
tool is written to be able to fail, and it did — twice, on the day it was
written.

**`crasher` was built, measured and deleted the same day.** It separated cleanly
in singles and was indistinguishable from `all court` in doubles, and the
measurement said why in one number: `at line` came out 67.9 per cent for `all
court`, `wall` and `crasher` alike. In doubles a player's court position is
owned by `planTeam`, not the individual, so `homeDepth` and `netUrge` are
singles-only dials and a style built on court position has nothing to express in
half the game. Four styles that differ everywhere beat five where one is a
duplicate in the mode the ladder will mostly be played in. Reviving it means
teaching team plans about style: DINK-116.

**`homeDepth` became a range, not a starting position.** Originally it set only
the opening stance, and a crasher driven back once stayed at the baseline like
everybody else, because the retreat clamp was `BASELINE_STANCE` for all comers.
A style now owns both ends of the range it will occupy, which is what committing
to the line actually means — and what makes the commitment cost something,
because a player who will not retreat is a player you lob.

**`ATTACK_HEIGHT` turned out to be near-dead code.** Placing style thresholds
required knowing where the ball actually is at contact, which nobody had
measured. At the net: median 0.39 m, p90 0.65 m. The constant had been 0.95
since Day 5, above the 90th percentile of every zone, so "attack the high ball"
has almost never fired in seventeen days. Style thresholds are now placed inside
the measured spread. `all court` keeps 0.95 deliberately — it is the control for
the singles ladder, and moving it is a balance change rather than a career one.
DINK-115.

**The banger exposed a balance problem that is really a physics problem.** It
wins 87.8 per cent of rallies in doubles with 0.12 faults per rally, by hitting
hard and flat. It wins because this game's players cannot cover a hard flat ball
— DINK-37, the movement model, seen from a new angle. A style that beats the
sport by exploiting the engine is a finding, not a difficulty setting. The
ladder places bangers deliberately rather than pretending the number is fine.
DINK-114.
