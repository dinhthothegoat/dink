# Days 24 to 100

Written on day 23. Seven blocks, each with an exit criterion you can check
rather than feel, and the gate that reroutes the plan when the evidence says to.

## What a hundred days can and cannot buy

Stating this first, because a plan that quietly promises more than it can
deliver is worse than no plan.

**Can:** a finished, honest, small game on Steam. A demo. A real launch with a
page, a trailer, and people who wishlisted it. A simulation whose physics is
defensible against published measurements, which almost nothing in this genre is.

**Cannot:** a hit. Wishlist counts at launch are mostly a function of how long
the page has been live and how much reach it got, and 100 days from a standing
start with no audience is thin. Plan for a small launch done properly, and treat
anything beyond that as luck rather than as a target you failed to hit.

**The unit is a sprint day, not a calendar day.** Twenty-three of them have
produced a validated physics engine, doubles, a career ladder, desktop builds
and 324 tests, so the rate is known. What is not known is how the rate holds
when the work stops being engineering, which is most of blocks 3, 6 and 7.

## Where this starts

```
                                 Dink    real    gap
  mean shots per rally          4.3      8.6    0.50x
  rallies of 5-8 shots         30.0%    44.0%   0.68x
  rallies of 9 or more          0.6%    13.0%   0.05x
  ended unreachable            65.8%    36.3%   1.81x
```

One number explains most of the others and it is the spine of this plan: **two
thirds of rallies end because nobody reached the ball.** Real doubles is a third.
That single defect makes rallies half as long as the sport's, makes the banger
style win 88 per cent of the time, and means the soft game — which is the whole
identity of pickleball — barely happens. It is DINK-37, it has been open since
Day 4, and it is the reason Block 2 is the longest engineering block here.

Everything else is downstream of that and of one other fact: **nobody outside
this repository has played it.**

---

## Block 1 · Days 24–31 · Evidence

The playtest, and acting on it. `docs/playtest.md` is the protocol.

| Day | Work |
| --- | --- |
| 24 | Application icon, Windows build actually launched on a real machine (DINK-104, DINK-111). No playtester should meet the Electron logo. |
| 25 | Run 4 sessions. Watch, do not explain. |
| 26 | Run 4 more. Different people, not the same four again. |
| 27 | Triage. Sort into blocked / bounced / asked-for. Three of eight before it is a finding. |
| 28–29 | Fix the entire blocked pile. Everything, before anything else on this page. |
| 30 | Onboarding, because it is always in the top three and this game has a wall of text for a title card. |
| 31 | Re-test the fixes on two fresh people. Two, not the original eight — they know too much now. |

**Exit criterion:** eight sessions run, blocked pile empty, and two fresh players
reach their first won point without being told anything.

**Gate.** Three triggers, written before the data:

- "Nobody to play against" is the top complaint → Block 5 becomes netcode and is
  moved earlier, ahead of Block 4.
- "I could not tell what I did wrong" → the coaching read becomes the headline
  feature and the identity in Block 3 is built around it.
- "Rallies end too fast" → eight strangers independently found what the profile
  has said since Day 17. Block 2 was already next; it becomes non-negotiable.

If it is none of those three, this plan was wrong about the game and the plan
changes rather than the evidence.

---

## Block 2 · Days 32–45 · Movement

The core defect. Fourteen days on one problem because it is the one that decides
whether this feels like pickleball or like a physics demo of pickleball.

| Day | Work |
| --- | --- |
| 32 | Instrument it. Where exactly is a player when a ball becomes unreachable, and by how much do they miss? Distance, time, or anticipation — the three have different fixes and nobody has separated them. |
| 33–34 | Anticipation. The read is a single error term applied once per shot; a real player re-reads continuously and corrects. |
| 35–36 | Acceleration and the first step. `PLAYER_ACCEL` is 14 and unsourced. The first 300 ms decides most reaches. |
| 37–38 | Reach and the stretch. `PLAYER_REACH` 1.15 m is geometry; whether a stretched contact should be *possible but bad* rather than impossible is a design question the code currently answers with a hard cutoff. |
| 39–40 | Recovery. Where a player returns to after a shot, and whether they are ever caught moving the wrong way. |
| 41–42 | Re-calibrate everything downstream: difficulty levels, styles, the ladder. All of them were tuned against broken movement. |
| 43 | Re-measure the styles. The banger's dominance is the cleanest proxy for whether this block worked. |
| 44–45 | Playtest again, four people, movement only. Does it feel different or only measure different? |

**Exit criterion, stated as numbers so the block cannot be declared done by
feel:**

- rallies of 5–8 shots within 1.3x of the charted 44 per cent
- rallies of 9 or more above 6 per cent, against today's 0.6
- unreachable endings below 45 per cent, against today's 65.8
- banger rally-win rate below 65 per cent, against today's 87.8

**Risk.** This is the block most likely to overrun, because "players cannot reach
things" may turn out to be four separate defects. If day 40 arrives with less
than half the exit criteria met, take what has improved, write down the rest,
and move on. The plan after this point does not depend on it being perfect.

---

## Block 3 · Days 46–56 · Identity, and the Steam page goes up

**The single most schedule-sensitive decision on this page: the store page goes
live around day 52, not near launch.** Wishlists accumulate over elapsed time and
drive launch-day visibility, so every day the page is not live is a day of
compounding lost. Launching around day 100 with a page live from day 52 gives
roughly seven weeks of accrual, which is thin but real. Live at day 90 would be
worth almost nothing.

| Day | Work |
| --- | --- |
| 46 | Identity. Answer "what would you tell a friend it is?" using the playtesters' own words, not yours. Every decision below depends on this one sentence. |
| 47–49 | Art pass on the thing a screenshot shows: court, players, ball, lighting. Not a full art overhaul — the five frames that go on the page. |
| 50 | Capsule art in all the sizes Steam demands. This is a specific, tedious, unavoidable list. |
| 51 | Trailer. Sixty seconds, gameplay in the first three, no logo sting at the front. |
| 52 | **Page live.** Description, tags, screenshots, trailer, coming-soon. |
| 53 | Steamworks setup behind it: depots, branches, a build that uploads. |
| 54–56 | The first thing wishlists are worth: tell people. Pickleball communities, the physics angle, the day log. This project has an unusually good story and has never told it. |

**Exit criterion:** the page is live, a build uploads to a private branch, and
the game can be described in one sentence by somebody who is not you.

**Risk.** Art is the most likely skill gap and the most likely thing to slip.
Budget for commissioning the capsule if it stalls for more than two days — it is
the single highest-leverage art in the whole project and it is seen by people who
have not yet decided to care.

---

## Block 4 · Days 57–70 · Feel and depth

The block that makes it a game rather than a correct simulation.

| Day | Work |
| --- | --- |
| 57–59 | Animation. Players are jointed boxes that slide. Weight, footwork, a real swing. This is the largest single change to how it reads. |
| 60–61 | Audio. Paddle, bounce, shoe, net, crowd. Currently minimal and it is half of feel. |
| 62–63 | The coaching read. The end-of-match card already knows what you lost on; say it in a sentence a club player would recognise. |
| 64–65 | Tournament mode: a bracket, seeding, a day of pickleball. |
| 66–67 | Revive `crasher` by teaching team plans about style (DINK-116), and add two more rivals. |
| 68–70 | Replay playback in-game (DINK-125): watch your own match, scrub it. The recorder exists and is verified; only the screen is missing. |

**Exit criterion:** a returning playtester from Block 1 plays for 40 minutes
without being asked to.

---

## Block 5 · Days 71–82 · The gated block

**This block's content is decided by Block 1's gate, not now.**

**If the answer was "nobody to play against":** lockstep netcode. This is
genuinely reachable and it is the one thing this codebase is unusually ready for
— determinism was verified on Day 23, inputs are already the only channel in, and
a match is already a seed plus a list of InputFrames. That is most of a netcode
design. Twelve days is enough for two players, not for matchmaking or ranked.

**If the answer was anything else:** local two-player first (cheap, for the same
architectural reason), then depth in whatever direction the playtest pointed.

**Exit criterion, either way:** two humans can play each other on purpose.

**Risk.** Netcode is the classic project killer. The mitigation is the exit
criterion above: two people on one connection, no lobbies, no matchmaking, no
ranking. If day 78 arrives without two people connected, stop and take the local
two-player version instead.

---

## Block 6 · Days 83–92 · Demo, and strangers

| Day | Work |
| --- | --- |
| 83–84 | Cut the demo. A demo is not the game with a timer — it is a deliberately chosen slice that ends while they still want more. |
| 85 | Performance and the low-end machine. A pickleball audience skews older and their hardware skews older with them. |
| 86 | Accessibility: colourblind-safe court, remappable keys, a larger UI scale, and a difficulty floor below `easy`. |
| 87–88 | Second playtest, on the beta branch, against people you have never met. This is the first honest read on retention. |
| 89–90 | Triage that, again by the three-of-eight rule. |
| 91–92 | Steam Next Fest if the calendar allows, or an equivalent push. Register early; the deadlines are weeks ahead of the event. |

**Exit criterion:** the demo is playable by strangers and at least one of them
finishes it and asks when it is out.

---

## Block 7 · Days 93–100 · Launch

| Day | Work |
| --- | --- |
| 93–94 | Release candidate. Feature freeze means freeze. |
| 95 | Store page final: pricing, regional pricing, age rating, launch date announced. |
| 96–97 | The release-day checklist run as a rehearsal on the private branch, not as a live experiment. |
| 98 | Launch. |
| 99–100 | Post-launch triage. The first 48 hours produce more bug reports than the previous 99 days, and every one arrives with a replay attached. |

**Exit criterion:** it is on sale, it runs on other people's computers, and the
first crash report has a seed in it.

---

## What gets cut first

The most useful part of any plan, and the part usually missing. If the schedule
slips, cut in this order and do not improvise a different one under pressure:

1. **Tournament mode** (days 64–65). The career ladder already provides
   structure; a bracket is more of the same shape.
2. **Extra rivals and `crasher`** (66–67). Four styles are already measurably
   distinct, which is more than most sports games manage.
3. **In-game replay playback** (68–70). The recorder works and is the part that
   matters for bug reports. Watching it back is a feature, not a need.
4. **Netcode → local two-player** (Block 5). Same fun, a tenth of the risk.
5. **Next Fest** (91–92). A real deadline you cannot move, so it goes before
   anything a player touches.

**Never cut:** the blocked pile in Block 1, the movement block's exit criteria,
the store page going live by day 55, or the second playtest. Those four are the
plan.

## The assumptions most likely to break this

- **That movement is one defect.** If it is four, Block 2 eats Block 3's start
  and the store page slips, which is the one slip that compounds.
- **That eight playtesters can be found twice.** Block 1 needs eight and Block 6
  needs strangers. This has no engineering mitigation.
- **That art does not become the bottleneck.** It is the only work here with no
  precedent in the first 23 days.
- **That a solo project sustains 77 more days.** The day log is the mitigation
  and always has been: it makes a bad day legible rather than demoralising.

## What would make me abandon this plan entirely

Written now, while it costs nothing to be honest:

- Five or more of eight playtesters stop before twenty minutes and none of them
  asks to play again. That is not a plan problem and no amount of movement work
  fixes it; the game would need rethinking, not scheduling.
- The movement block ends with the rally profile unmoved. It would mean the
  model is wrong at a level none of this plan addresses, and the right response
  is a week of reading and a new ADR, not the next block.
- Steam launch stops being the goal. Everything from Block 3 onward exists to
  serve it, and if the real goal turns out to be a portfolio piece or a coaching
  tool, roughly half of this page is wasted effort.
