# ADR-0005: Teams, and a serve rotation that is derived rather than stored

- Status: Accepted
- Date: 2026-09-09
- Sprint: Week 3, Days 13 and 14
- Deciders: Tho Dinh (owner)

## Context

Twelve days produced a singles game in which `Side` — `'near' | 'far'` — meant
two things at once: which end of the court, and which player. Singles let those
be the same word, because a team was one person.

Doubles separates them, and the separation is not cosmetic. A fault, a point and
a score belong to an **end**. A serve turn, a swing and a court position belong
to a **player**. Every line that used `Side` was implicitly choosing one of those
meanings and nothing made it say which.

This decision is being recorded rather than left in the day log because Days 15
to 17 all build directly on it: the partner AI, ball ownership, formations and
the doubles playtest each assume a shape for "who is on the court and where".
A wrong turn here is the expensive one in the block, and the daylog is 1500 lines
of narrative rather than somewhere anyone would look first.

It is also only possible because of Day 12. Doubles is played at the non-volley
line, and until Day 12 that line was a physical rail holding players 2.41 m back.
The measurement that killed the rail is in `docs/daylog.md` under Day 12 and
summarised in `docs/backlog.md` under DINK-39; it is not repeated here.

## Decision one: `Side` is the end, `Slot` is the player

`src/sim/court.ts` gains:

```ts
export type Slot = 0 | 1;
export interface PlayerId { side: Side; slot: Slot; }
export type TeamSize = 1 | 2;
```

`Slot` is not an arbitrary index. **Slot 0 is the player who starts the game in
the right/even court**, and that definition is load-bearing rather than
descriptive: the entire doubles serve rotation hangs off that one player, so
pinning them to a slot number is what makes decision two possible.

Every existing use of `Side` was audited and left alone. All of them meant the
end, which is why widening did not disturb a single one of the 173 tests that
existed on Day 12.

## Decision two: nothing stores where a player is standing

The rotation reduces to one line in `src/sim/rules.ts`:

```ts
export const rightCourtSlot = (teamScore: number): Slot =>
  (teamScore % 2 === 0 ? 0 : 1);
```

Partners swap courts exactly when their team scores a point, and the team score
goes up by one at the same instant. So "slot 0 is in the right court" and "the
team score is even" flip together and stay locked for the whole game. USA
Pickleball 4.B.6.b states the same invariant from the other end, as a rule about
where the starting server belongs.

Both `serveBox` (which court the server is serving from) and `receiverSlot`
(which partner must take it) fall out of that. The stored `box: ServeBox` field
was **deleted**, not kept in sync. Two code paths used to assign it, which is the
precise shape of the Day 6 serve bug: a value that was correct on one side of the
net and backwards on the other, invisible because the legality check and the shot
read the same wrong answer. One authority is the only reliable way to keep four
combinations agreeing.

This is the general principle the project keeps rediscovering: **state that can
be derived is state that can disagree with itself.**

### The claim this settled without a source

Where does the second server stand? Two sources disagreed. USA Pickleball 4.B.6.b
pins the *starting* server to the right court at an even score; a USA Pickleball
skills page was summarised as saying the second server also serves from the court
the score dictates. They cannot both hold.

The invariant decides it with no third source. When the first server faults, no
point is scored, so nobody swaps, so the partner serves from where they are
standing — the **left** at an even score. The other reading would require two
players to trade places on a fault, and nothing in the sport does that.

The deep-research run commissioned to supply this returned three usable claims
out of 104 agents and voted 3-0 to refute the two-bounce rule. It was used as a
list of things to go and check, and the rulebook was read directly. Fourth time
in four days that the instrument was less reliable than the thing it measured.

## Decision three: `serverSlot` and `serverNumber` are separate fields

They look redundant. Server 1 is slot 0 and server 2 is slot 1, so one should
derive from the other — except in one state, and the sport genuinely has it.

A doubles game opens **0-0-2**: the team that serves first gets one server rather
than two, so that winning the toss is not worth a free extra service turn. That
player is *called* second server while standing in slot 0's court. Deriving one
field from the other would make that state unrepresentable, and refusing to
represent a state the sport has is worse than carrying a second field.

The rule this project usually follows is to make illegal states unrepresentable.
The corollary, which is what applies here, is that a **legal** state must stay
representable even when it is irregular.

## Decision four: singles is doubles with one player a side

`teamSize: 1 | 2` on the match, and it branches in exactly two places: who serves
next after a fault, and how many numbers are in the call. Everything else is
shared.

`rally.team` holds the players by end. `rally.near` and `rally.far` remain, and
are **the same objects** as `rally.team.near[0]` and `rally.team.far[0]` rather
than copies. Widening added a name; it moved nothing.

That aliasing is a real cost and it is being paid deliberately. The alternative
was editing several hundred lines across 173 passing tests in order to type
`[0]`, changing a great deal that was not wrong. The risk it carries is a future
reassignment of `rally.near` silently desynchronising the two names. Nothing
reassigns them today — every caller mutates the player object — and a test
asserts the identity so that the day someone does, it fails loudly.

The one thing that would have broken quietly is the reach buffer. Day 9 gave the
two ends separate `Reach` objects because a far-side contact was writing into the
value the UI reads mid-tick. Four players sharing two buffers is that same bug
with more players, so every player owns one, aliased the same way, and a test
counts four distinct objects.

## Consequences

- The doubles rulebook is complete and tested: two servers a side, the 0-0-2
  opening, the three-number call, the rotation, the correct receiver. Nine new
  tests, and three deliberate mutants were introduced and watched to die, because
  the suite passing on its first run is not proof of anything.
- **Doubles is not playable.** The partners stand at the non-volley line, the
  rules can see them, and they have no brain until Day 15 (DINK-73). Only slot 0
  takes input at either end, so a near-side second server's ball leaves the right
  place while the person swinging is not the person standing there (DINK-74).
  Serving works at all because `serve()` never consults a player, which is luck
  rather than design and is why DINK-74 is filed at all.
- One doubles rule is now knowably unmodelled: contacting a partner who is
  touching the non-volley zone is a fault, and there is no partner collision
  (DINK-75). Filed rather than faked.
- Serving out of turn is a real fault and is unrepresentable here, because the
  game only ever lets the correct server serve (DINK-76). Deliberate: a fault
  that cannot occur is a rule nothing exercises.
- `Slot` is the unit the next three days are written in. Ball ownership (Day 15)
  arbitrates between two `PlayerId`s; formations (Day 16) assign court regions
  per slot; stacking is a decision about which slot stands where at the serve,
  which this model expresses as an override of decision two rather than a new
  mechanism.
