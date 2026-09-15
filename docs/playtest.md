# The Day 23 playtest

Eight to ten people, twenty minutes each. This document is the protocol, and it
exists because a playtest run badly is worse than none: it produces confident
opinions that feel like evidence, and this project has spent twenty-three days
learning what happens when you act on a measurement you did not interrogate.

**The one thing that cannot be substituted.** Everything else in this repository
has been measured by something the project wrote itself. Twenty-three days of
calibration, and every number came from a stand-in playing against another
stand-in. Day 11 already found what that costs: the instrument was wrong four
times running, not the game. A person is the only instrument this project does
not control, and that is exactly why the plan is scheduled on them.

## Before anybody arrives

- [ ] Build the version they will play and **write the version number down**.
      `npm run desktop:win` for Windows, or the artifact URL for a browser.
      A session whose build is unknown is a session you cannot act on.
- [ ] **Launch the Windows build yourself, once.** DINK-104: it has been built
      four times and never run by anybody, because there is no Windows in the
      environment that builds it. Five minutes, and it is the difference between
      "should work" and "works". The steps are below.
- [ ] Run `npm run desktop:verify` on whatever machine you can.
- [ ] Have `Copy replay` tested once yourself. If it does not work, the whole
      session is notes rather than evidence.
- [ ] Decide nothing in advance about what you expect to find. Writing down a
      prediction is fine; looking for it is not.

## Launching the Windows build for the first time

This is DINK-104 and it is the one item on this page that no amount of tooling
here can close. What is already verified: the exe is a valid PE32 binary, all
seven icon sizes are embedded in it, the payload carries the right version and
both shell files, and the identical payload boots, ticks and draws on Linux.
What is not verified is that Windows runs it.

1. Copy `Dink Pickleball Rivals <version>.exe` to a Windows machine and
   double-click it. It is portable — no installer, nothing written to Program
   Files.
2. **SmartScreen will stop it.** The build is unsigned (DINK-105), so Windows
   shows "Windows protected your PC". Click **More info**, then **Run anyway**.
   Expect this, and expect every playtester to need telling.
3. Check, in this order, because each one fails differently:
   - the icon in the taskbar is a paddle, not the Electron atom
   - a window opens at 1280x800 with a dark background, not white
   - the title card appears and Play starts a match
   - the ball moves and the court is drawn, not a black canvas
   - `Copy replay` reports kilobytes copied
4. If the window opens but stays black, that is the `dink://` protocol handler
   failing and the replay is not the diagnostic — take a screenshot and check
   whether the panel drew.
5. Note the Windows version and whether the machine has a discrete GPU. A
   software-rendered Windows box is the likeliest performance surprise.

Do the same on macOS if you have one. Gatekeeper's version of step 2 is
right-click then **Open**, because an unsigned app cannot be launched by
double-clicking at all.

## The rule

**Watch. Do not explain.**

Not a slogan — a constraint with a cost, and the cost is the point. Every time
you explain a control, you have destroyed the only sample you will ever get of
somebody meeting it cold. There are eight to ten such samples in existence and
then they are gone forever.

So:

- Say "play however you like, I am going to be quiet" and then be quiet.
- When they ask a question, write the question down and say "try it and see".
  **The question is the finding.** The answer is not.
- Help only when they are stuck in a way that ends the session: crash, black
  screen, cannot start a match. Note it and move on.
- Do not sit where they can read your face.

The hardest version of this is when somebody is playing it wrong and losing
badly and you know one sentence would fix it. Say nothing. That sentence is not
in the game, and if it needs to be, that is the single most valuable thing this
playtest can tell you.

## What to write down, per session

Timestamps matter more than adjectives. "Confused at 0:40" is actionable;
"found it confusing" is not.

```
Player:            #      Build:            Mode they chose:
0:00  starts. Did they read the title card, or click straight through?
0:00  first thing they tried to do
?:??  first time they moved on purpose rather than by accident
?:??  first point they won, and did they know why
?:??  first time they said anything out loud
?:??  every question they asked (verbatim, not paraphrased)
?:??  every time they looked at the panel instead of the court
?:??  first sign of boredom, frustration, or reaching for their phone
?:??  did they find the career ladder without being told
?:??  did they ever play a soft shot on purpose
END   why did it end? finished, gave up, ran out of time, or asked to stop
```

**The single most important line is the last one.** How a session ends is the
closest thing to a retention signal you can get from twenty minutes.

## After, in under two minutes

Four questions, asked in this order, and write the answers verbatim.

1. "What were you trying to do when it went wrong?" — not "what went wrong",
   which invites them to theorise about the code.
2. "What did you think that button did?" for anything they misused.
3. "Would you play it again tomorrow?" and then **stop talking**. The pause
   before the answer is data.
4. "What would you tell a friend it is?" — if nobody can describe the game, the
   store page cannot either.

Do not ask them to rate anything out of ten. A number from eight people is not a
measurement, it is eight opinions with a mean.

Then: **ask for the replay.** `Copy replay` in the panel, paste it into a
message. A replay is the match, bit for bit, verified reproducible by
`npm run replay`. "It got weird when I served from the left" is a description; a
replay is a bug you can step through.

## Reading the results

A finding needs **three of eight** people before it is a finding. One person
struggling is one person. Three is the game.

Sort what you get into three piles and be strict about it:

- **Blocked** — they could not do a thing the game requires. Fix first, always,
  and before anything on any roadmap.
- **Bounced** — they could do it and stopped wanting to. This is the pile that
  decides what the game becomes, and it is the pile that is easiest to explain
  away.
- **Asked for** — what they said they wanted. Treat with suspicion. People are
  reliable about what frustrated them and unreliable about what would fix it.

## The gate this feeds

The plan says days 24 to 30 are scheduled on the answer. Three triggers were
written down in advance, before the data, so that the data cannot be read to
suit a preference already held:

- **Top complaint is "there is nobody to play against"** → days 26 and 27 become
  netcode, and the physics debt slips to a later block. The deterministic core
  verified on Day 23 is what makes that reachable.
- **Top complaint is about their own play — "I could not tell what I did wrong"**
  → build the coaching read. The end-of-match card is already half of it.
- **Top complaint is that rallies end too fast** → that is DINK-37, the movement
  model, and it is already the top-ranked debt in the project. It would mean
  eight strangers independently found what the rally profile has been saying
  since Day 17, which would be the strongest possible confirmation.

If it is none of those, the plan was wrong and the plan changes. That is what
the playtest is for.

## What this playtest cannot tell you

Worth writing down so it is not quietly assumed:

- **Whether the game is fun after two hours.** Twenty minutes measures the first
  twenty minutes. Retention needs the second playtest, on the beta branch,
  against strangers.
- **Whether it sells.** Eight people you can find are not eight buyers.
- **Whether the physics is right.** They will not notice, and that is the
  correct outcome: the aerodynamics were validated against filmed trajectories
  on Day 20 and a player should feel it rather than see it.
- **Anything about doubles**, unless you make some of them play doubles. Pick
  three in advance and ask those three to try it.
