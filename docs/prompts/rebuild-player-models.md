# Prompt: rebuild the player models

Paste everything below the line into a fresh session with the repository
attached. It is written to be self-contained — it assumes no memory of this
project.

---

## The task

Rewrite `src/render/player.ts` in this repository. It draws the human figures in
a 3D pickleball game (Three.js + TypeScript + Vite). Today each player is eleven
`BoxGeometry` boxes and a sphere, jointed at hips, knees, shoulders and elbows.
The proportions are right and the thing reads as a person, but it reads as a
person *made of boxes*, and the players are the only living thing on screen.

**Rewrite that file and nothing else.** Do not touch `src/sim` — it is a pure,
deterministic simulation with 327 tests, and the renderer is forbidden from
feeding anything back into it.

## The contract you may not change

Four callers depend on this file: `src/render/scene.ts` builds four of them, and
`src/main.ts` calls `pose()` on each one every frame. These exported shapes must
survive exactly:

```ts
export interface Pose {
  at: Vec3;                 // where to stand, already interpolated by the caller
  facing: -1 | 1;           // -1 faces toward -z, +1 toward +z
  speed: number;            // metres per second across the ground, for the stride
  drift: number;            // direction of travel in x, -1 to 1, for the lean
  swing: number;            // 0 idle, rising through windup, falling through recovery
  strain: number;           // 0 to 1, how stretched this contact is
  canReach: boolean;        // is the ball reachable at all
  frameSeconds: number;     // REAL seconds since the last frame, never simulated
  paddleAt?: Vec3;          // world-space paddle position, if the caller places it
}

export interface PlayerView {
  group: THREE.Group;
  pose: (pose: Pose) => void;
  setVisible: (visible: boolean) => void;
}

export interface Kit { shirt: number; shorts: number; skin: number; shoes: number; }

export const NEAR_KIT: Kit;
export const FAR_KIT: Kit;
export const partnerKit: (kit: Kit) => Kit;
export const buildPlayer: (kit?: Kit, withPaddle?: boolean) => PlayerView;
```

## Hard constraints

**Procedural geometry only. No glTF, no OBJ, no textures, no external fetches.**
This is not a preference. The game ships as a single self-contained HTML file
whose content-security policy blocks every external request, so an asset load
would work on your machine and fail silently in the place most people play. Build
everything from Three.js primitives, `LatheGeometry`, `ExtrudeGeometry`,
`BufferGeometry` you generate, or `CapsuleGeometry`.

**`pose()` must not allocate.** It runs four times a frame at up to 120 fps.
Scratch vectors live at module scope and are reused; the file already does this
and you must keep doing it. Note that three separate defects in this project came
from one scratch buffer being shared between two live values — one vector per
purpose, never two.

**Interpolation is the caller's job.** `pose.at` arrives already interpolated
between simulation ticks. Do not smooth it again. A previous version drew players
one tick ahead of the ball and it was visible as the paddle striking thin air.

**`frameSeconds` is real seconds, not simulated seconds.** Anything you animate
from it must look the same at 60 fps and 144 fps, and must not change when the
player sets the game speed to 0.45x.

**Budget:** four players posed and drawn in under 2 ms. `npm run perf` asserts a
tick fits in 8.33 ms and must still pass.

**The reach ring stays and stays load-bearing.** Reach is the rule that decides
which balls exist for a player. Without it drawn, shots fail for no visible
reason. It is not decoration and it may not be removed for looking cleaner.

## The brief

What is wrong, specifically:

- **No weight.** Boxes of constant cross-section. A thigh is thicker than a shin,
  a torso tapers to the waist and flares at the shoulders, and none of that is
  there.
- **No ready stance.** A pickleball player at the kitchen line stands in an
  athletic crouch with the paddle up in front of the chest. It is the single most
  recognisable posture in the sport and the game does not have it.
- **The swing is one arm rotating.** A real stroke rotates the torso, transfers
  weight between the feet, and the arm arrives last.
- **The torso is rigid.** It never twists, so the figure is a mannequin that
  waves an arm.

> Corrected after reading the file rather than remembering it: an earlier draft
> of this brief also claimed there were no feet, no neck, and no arm
> counter-swing. All three already existed. The claims came from a summary
> instead of from `src/render/player.ts`, which is the same defect this project
> files as DINK-103 — a guess written down as a fact. Read the file.

What to keep: the proportions table (a figure about 1.75 m, hips at 0.92,
shoulders at 1.40) was tuned by looking from the broadcast camera and is right.
Keep the cap — it reads at distance and separates the two ends.

## What "better" means, measurably

Do not decide this by looking at it up close. The camera sits about 14 m away
looking down roughly 20 degrees, and there are also side and top cameras.

1. **The silhouette test.** Set every material to flat black, render, and look.
   If the black cutout does not read as a person in an athletic stance, the
   model is wrong and no amount of shading fixes it. This is the single most
   useful check and it takes two minutes.
2. At 14 m you can tell which way a player faces without them moving.
3. At 14 m you can tell they are swinging within one frame of the swing starting.
4. Four players on court, two kits plus two partner shades, all four
   distinguishable at a glance.

## How to verify, before you claim it works

This project's standing rule is that a change is not done because it looks
plausible. The render layer specifically has almost no automated coverage, and
three separate render defects have been found by a person looking at the screen
rather than by a test.

```bash
npm run typecheck && npm test     # must stay green with NO test edits
npm run shots                     # still frames to docs/shots/ — open them
npm run watch                     # an mp4 of the game playing itself
npm run perf                      # the tick budget
npm run playtest:browser          # real keys, real DOM, in Chromium
```

Look at the output of `npm run shots` yourself. Take a before and after from the
same seed. If you cannot see the difference in a still frame at the broadcast
camera, it is not an improvement, it is a refactor.

## House style for the file

Match the existing comments. They explain **why** a number is what it is, record
what was tried and rejected and what it measured, and are written for somebody
arriving in six months with no context. For example, the current file says:

> It was a capsule from Day 1 to Day 16 — a pill on a pale court, at a camera
> distance where it was genuinely hard to tell what you were looking at, which
> is how it was reported.

If you try something and it looks worse, delete it and leave a comment saying
what it was and why it lost. Three things in this project have been built,
measured worse, and removed, and the record of each is worth more than the code
would have been.

## Deliverable

1. The rewritten `src/render/player.ts`.
2. Before and after screenshots from the same seed, at the broadcast camera.
3. The silhouette test image.
4. A short note on anything you tried and rejected.
