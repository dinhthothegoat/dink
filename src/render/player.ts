import * as THREE from 'three';
import * as C from '../sim/constants';
import { Vec3 } from '../sim/vec3';

/**
 * What the renderer needs to know to draw one player.
 *
 * Everything here is presentation. None of it is read by `src/sim`, and none of
 * it feeds back — the stride is cosmetic, the swing arm is cosmetic, and a
 * player whose legs are in the wrong place still reaches exactly as far.
 */
export interface Pose {
  /** Where to stand. Interpolated between ticks by the caller. */
  at: Vec3;
  /** -1 faces toward -z, +1 toward +z. Which end of the court they play from. */
  facing: -1 | 1;
  /** Metres per second across the ground, for the stride. */
  speed: number;
  /** Direction of travel in x, for the lean. -1 to 1. */
  drift: number;
  /** 0 idle, rising through the windup, falling through the recovery. */
  swing: number;
  /** How stretched the current contact is, 0 to 1. Colours the reach ring. */
  strain: number;
  /** Is the ball reachable at all? */
  canReach: boolean;
  /** Real seconds since the last frame. Never simulated seconds — see ADR-0004. */
  frameSeconds: number;
  /** Where this player's paddle is, in world space, if the caller places it. */
  paddleAt?: Vec3;
}

export interface PlayerView {
  group: THREE.Group;
  pose: (pose: Pose) => void;
  /** Hide a partner who is not on court. Doubles builds four, singles uses two. */
  setVisible: (visible: boolean) => void;
}

/**
 * A player, as a body that reads as a person and a ring that reads as a rule.
 *
 * It was a capsule from Day 1 to Day 16 — a pill on a pale court, at a camera
 * distance where it was genuinely hard to tell what you were looking at, which
 * is how it was reported. A capsule also cannot show the two things that matter
 * most about a player at any moment: which way they are moving and whether they
 * are swinging.
 *
 * Everything is built from primitives rather than loaded. The published build is
 * a single self-contained file with no external fetches allowed, so a glTF
 * character was never an option — and a jointed figure made of eleven boxes and
 * a sphere costs about a millisecond and can be posed exactly.
 *
 * The reach ring stays, and it stays load-bearing rather than decorative. Reach
 * is the rule that decides which balls exist for you (ADR-0003), and without it
 * drawn, shots would simply fail sometimes for no visible reason.
 */
export interface Kit {
  shirt: number;
  shorts: number;
  skin: number;
  shoes: number;
}

export const NEAR_KIT: Kit = { shirt: 0xe8edf2, shorts: 0x2f4a63, skin: 0xc79a72, shoes: 0x1b2733 };
export const FAR_KIT: Kit = { shirt: 0xd98b6a, shorts: 0x6b3b2a, skin: 0xb5825c, shoes: 0x2a1d17 };

/** Partners wear the same kit a shade darker, so a pair reads as a pair. */
export const partnerKit = (kit: Kit): Kit => ({
  shirt: shade(kit.shirt, 0.72),
  shorts: shade(kit.shorts, 0.8),
  skin: kit.skin,
  shoes: kit.shoes,
});

const shade = (hex: number, factor: number): number => {
  const c = new THREE.Color(hex);
  c.multiplyScalar(factor);
  return c.getHex();
};

/**
 * Flat-black everything, behind `?silhouette=1`.
 *
 * Day 25. The most useful check on a character model is the cheapest one: strip
 * every colour and light, render the figure as a solid cutout, and look at it.
 * If the silhouette does not read as a person in an athletic stance, the model
 * is wrong, and no amount of shading, shadow or material work will rescue it —
 * shading only ever tells you about a shape you have already got right.
 *
 * It is a flag rather than a thing done once by hand, because a check you have
 * to rebuild in order to repeat is a check that gets run once.
 */
const silhouette = (): boolean => {
  try {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has('silhouette');
  } catch {
    return false;
  }
};

const solid = (color: number, roughness = 0.8) =>
  silhouette()
    ? new THREE.MeshBasicMaterial({ color: 0x000000 })
    : new THREE.MeshStandardMaterial({ color, roughness });

/**
 * A tapered limb that hangs DOWN from its parent's origin, so the parent is the
 * joint.
 *
 * Day 25. This was a box of constant cross-section from Day 16, and a box is
 * what made the figure read as a person *made of boxes*: a thigh and a shin the
 * same width is not a leg, it is a plank with a hinge in it. A cylinder with
 * different radii at each end is one primitive, costs the same, and carries the
 * single most important cue for weight — that a limb is thick where it attaches
 * and thin where it ends.
 *
 * Eight radial segments. Sixteen was tried and is indistinguishable at fourteen
 * metres, which is the only distance this is ever seen from; eight keeps the
 * silhouette faceted enough to catch the light.
 *
 * `squashZ` flattens the cross-section front to back. A human limb is not round
 * and a torso is much less round than a limb.
 */
const limb = (
  rTop: number,
  rBottom: number,
  h: number,
  material: THREE.Material,
  squashZ = 1,
): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, 8), material);
  mesh.position.y = -h / 2;
  mesh.scale.z = squashZ;
  mesh.castShadow = true;
  return mesh;
};

/**
 * Proportions, in metres, for a player about 1.75 m tall.
 *
 * Written out rather than scaled from a single height, because every one of them
 * had to be looked at from the broadcast camera and adjusted, and a table of
 * numbers somebody can edit is worth more here than an elegant formula.
 */
const HIP_Y = 0.92;
const SHOULDER_Y = 1.40;
const UPPER_LEG = 0.40;
const LOWER_LEG = 0.44;
const UPPER_ARM = 0.30;
const FOREARM = 0.28;
const HIP_HALF = 0.10;
const SHOULDER_HALF = 0.19;

/** Reused so posing four players allocates nothing per frame. */
const _reach = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _aim = new THREE.Vector3();

export const buildPlayer = (kit: Kit = NEAR_KIT, withPaddle = true): PlayerView => {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const shirt = solid(kit.shirt);
  const shorts = solid(kit.shorts);
  const skin = solid(kit.skin, 0.9);
  const shoes = solid(kit.shoes, 0.6);

  /**
   * An upper body that can pitch and twist, hinged at the hips.
   *
   * Day 25. Everything above the waist used to be parented straight to `body`,
   * which meant the figure could only ever stand bolt upright: there was no
   * joint between the legs and the chest, so there was nowhere for a lean or a
   * rotation to happen. A mannequin waving one arm.
   *
   * Its origin sits AT hip height rather than at the floor, so pitching it
   * rotates the chest over the hips the way a person bends, instead of tipping
   * the whole figure over like a felled tree.
   */
  const upper = new THREE.Group();
  upper.position.y = HIP_Y;
  body.add(upper);

  // --- torso, hips, head ---------------------------------------------------
  //
  // Tapered and flattened rather than a slab. A torso is wide at the shoulders,
  // narrow at the waist, and much thinner front-to-back than it is across — the
  // 0.40 x 0.44 x 0.22 box got the bounding volume right and the shape wrong,
  // and at this distance the shape is the whole of what you see.
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.155, 0.46, 10), shirt);
  torso.position.y = 1.24 - HIP_Y;
  torso.scale.z = 0.62;
  torso.castShadow = true;
  upper.add(torso);

  const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.165, 0.2, 10), shorts);
  pelvis.position.y = 0.99 - HIP_Y;
  pelvis.scale.z = 0.66;
  pelvis.castShadow = true;
  upper.add(pelvis);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.062, 0.1, 8), skin);
  neck.position.y = 1.49 - HIP_Y;
  upper.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skin);
  head.position.y = 1.62 - HIP_Y;
  head.scale.z = 1.06;
  head.castShadow = true;
  upper.add(head);

  // A cap, purely so the head has a front. At this distance it is the only cue
  // that says which way somebody is looking.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, 0, 1.1), shirt);
  cap.position.y = 1.63 - HIP_Y;
  upper.add(cap);
  const peak = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.1), shirt);
  peak.position.set(0, 1.62 - HIP_Y, -0.13);
  upper.add(peak);

  // --- legs ----------------------------------------------------------------
  const makeLeg = (side: -1 | 1) => {
    const hip = new THREE.Group();
    hip.position.set(side * HIP_HALF, HIP_Y, 0);
    // Thigh: thick at the hip, narrowing to the knee. Shin: narrower again, and
    // narrowest at the ankle. Three radii in a row is what a leg is.
    hip.add(limb(0.085, 0.065, UPPER_LEG, shorts, 0.92));
    const knee = new THREE.Group();
    knee.position.y = -UPPER_LEG;
    knee.add(limb(0.062, 0.042, LOWER_LEG, skin, 0.92));
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.105, 0.065, 0.25), shoes);
    // Toes turned out a few degrees. Static, so it costs nothing per frame, and
    // parallel feet are one of those details that reads as wrong long before
    // anybody can say why — nobody stands with their feet exactly square.
    foot.rotation.y = side * 0.16;
    foot.position.set(0, -LOWER_LEG - 0.02, -0.05);
    foot.castShadow = true;
    knee.add(foot);
    hip.add(knee);
    body.add(hip);
    return { hip, knee };
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // --- arms ----------------------------------------------------------------
  const makeArm = (side: -1 | 1) => {
    const shoulder = new THREE.Group();
    // Parented to `upper`, so an arm follows the chest when the torso twists.
    // On `body` it did not, and a swing looked like an arm detaching.
    shoulder.position.set(side * SHOULDER_HALF, SHOULDER_Y - HIP_Y, 0);
    shoulder.add(limb(0.055, 0.045, UPPER_ARM, shirt));
    const elbow = new THREE.Group();
    elbow.position.y = -UPPER_ARM;
    elbow.add(limb(0.043, 0.034, FOREARM, skin));
    const hand = new THREE.Group();
    hand.position.y = -FOREARM;
    elbow.add(hand);
    shoulder.add(elbow);
    upper.add(shoulder);
    return { shoulder, elbow, hand };
  };
  const armL = makeArm(-1);
  const armR = makeArm(1);

  // The paddle hand is the right one. A paddle in every hand, because until now
  // the opponent held nothing at all and appeared to hit the ball with a wrist.
  if (withPaddle) {
    // Light enough to see. The first version was 0x1d2c3a, which is the panel
    // background colour, on a dark court, at forty metres.
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 0.28, 0.2),
      solid(0xf0d9a8, 0.5),
    );
    face.position.y = -0.18;
    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.017, 0.017, 0.12, 8),
      solid(0x3a2b22, 0.9),
    );
    grip.position.y = -0.05;
    armR.hand.add(face);
    armR.hand.add(grip);
  }

  // --- the reach ring, which is a rule rather than a decoration -------------
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(C.PLAYER_REACH - 0.05, C.PLAYER_REACH, 48),
    new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.008;
  group.add(ring);

  const comfort = new THREE.Mesh(
    new THREE.RingGeometry(
      C.PLAYER_REACH * C.PLAYER_COMFORT_REACH - 0.03,
      C.PLAYER_REACH * C.PLAYER_COMFORT_REACH,
      40,
    ),
    new THREE.MeshBasicMaterial({
      color: 0x9fb4c7,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
    }),
  );
  comfort.rotation.x = -Math.PI / 2;
  comfort.position.y = 0.007;
  group.add(comfort);

  const ringMat = ring.material as THREE.MeshBasicMaterial;

  /**
   * How far the feet have travelled, in metres, modulo a stride.
   *
   * Driving the stride off DISTANCE rather than off time is what stops the legs
   * cycling while the player stands still, and it makes the animation
   * frame-rate independent for free: the feet advance with the body because they
   * are measuring the same thing.
   */
  let strideDistance = 0;
  const STRIDE = 1.25;
  let lean = 0;
  /** Eased so a swing settles rather than snapping back. */
  let twist = 0;

  /**
   * The ready stance, in radians, and why it is the pose that matters most.
   *
   * A pickleball player waiting for a ball is in an athletic crouch: knees bent,
   * weight forward on the balls of the feet, paddle up in front of the chest.
   * It is the single most recognisable posture in the sport, and until today
   * this game did not have it — a player at rest stood bolt upright with their
   * arms by their sides, which reads as somebody queuing rather than somebody
   * about to move.
   *
   * It eases OUT with speed rather than being constant. A sprinting player
   * extends; only a waiting one is coiled. So the crouch is strongest at a dead
   * stop, which is exactly when the figure would otherwise look most inert.
   */
  /**
   * Feet apart, and why this matters more than the knee bend.
   *
   * The knee bend was added first and the silhouette test said it was nearly
   * invisible: the game's camera looks down the length of the court, so a
   * fore-aft flexion is foreshortened almost to nothing. A stance that only
   * reads from a side view the player never uses is a stance nobody sees.
   *
   * Feet apart is lateral, so it survives every camera in the game. It is also
   * the more truthful cue — what makes a waiting athlete look ready is a base
   * wider than their shoulders, far more than the angle of their knees.
   */
  const STANCE_WIDTH = 0.2;
  const CROUCH_HIP = 0.34;
  const CROUCH_KNEE = -0.62;
  const CROUCH_PITCH = 0.2;
  const CROUCH_DROP = 0.07;

  return {
    group,
    setVisible: (visible) => {
      group.visible = visible;
    },
    pose: ({ at, facing, speed, drift, swing, strain, canReach, frameSeconds, paddleAt }) => {
      group.position.set(at.x, 0, at.z);

      strideDistance = (strideDistance + speed * frameSeconds) % STRIDE;
      const cycle = (strideDistance / STRIDE) * Math.PI * 2;
      // A walk barely swings and a sprint swings a lot, so the amplitude follows
      // the speed rather than being a constant that looks wrong at both ends.
      const gait = Math.min(1, speed / C.PLAYER_MAX_SPEED);
      const amp = 0.12 + 0.62 * gait;

      // How coiled this player is right now: fully at a standstill, mostly
      // unwound at a sprint.
      const crouch = 1 - 0.7 * gait;

      legL.hip.rotation.x = Math.sin(cycle) * amp + CROUCH_HIP * crouch;
      legR.hip.rotation.x = -Math.sin(cycle) * amp + CROUCH_HIP * crouch;
      legL.hip.rotation.z = -STANCE_WIDTH * crouch;
      legR.hip.rotation.z = STANCE_WIDTH * crouch;
      // Knees only bend backwards, and only on the leg that is trailing — plus
      // the crouch, which bends both.
      legL.knee.rotation.x = -Math.max(0, -Math.sin(cycle)) * amp * 1.5 + CROUCH_KNEE * crouch;
      legR.knee.rotation.x = -Math.max(0, Math.sin(cycle)) * amp * 1.5 + CROUCH_KNEE * crouch;

      // Body faces the net. A small bob with the stride, because a figure whose
      // hips never move reads as a puppet being slid across the floor.
      //
      // The crouch also lowers the hips: bending the knees without dropping the
      // body pushes the feet through the court, which at this camera angle is
      // visible as a player hovering.
      body.position.y = Math.abs(Math.sin(cycle)) * 0.025 * gait - CROUCH_DROP * crouch;
      body.rotation.y = facing === -1 ? 0 : Math.PI;

      /**
       * Pitch and twist, on the hip joint rather than on the whole figure.
       *
       * Pitch is the forward lean of the crouch. Twist is the shoulders turning
       * through a stroke, and it is what makes a swing read as a swing rather
       * than as an arm being waved: a real stroke starts in the hips, the chest
       * follows, and the arm arrives last.
       *
       * Both live on `upper`, INSIDE the yaw that turns the figure to face the
       * net, so they work identically at both ends of the court. Applied to the
       * same object as the yaw they would compose with it and the far player
       * would lean backwards.
       */
      twist += (swing * 0.55 - twist) * Math.min(1, frameSeconds * 12);
      upper.rotation.x = CROUCH_PITCH * crouch;
      upper.rotation.y = -twist;

      // Lean into the direction of travel, eased rather than snapped, so a
      // change of direction shows as a weight shift.
      lean += (drift * 0.9 * gait - lean) * Math.min(1, frameSeconds * 9);
      group.rotation.z = -lean * 0.12;
      group.rotation.y = lean * 0.35;

      // The off arm counter-swings with the legs. The paddle arm is owned by the
      // swing: it comes back through the windup and finishes across the body,
      // which is what makes a swing legible from behind at this distance.
      // The off arm counter-swings with the legs, from a ready position that is
      // up and across rather than hanging: a waiting player holds both hands in
      // front, and an arm dangling at the side is the single clearest tell that
      // a figure is idle rather than poised.
      armL.shoulder.rotation.x = -Math.sin(cycle) * amp * 0.7 - 0.12 - 0.45 * crouch;
      armL.shoulder.rotation.z = 0.3 * crouch;
      armL.elbow.rotation.x = -0.35 - 0.3 * gait - 0.75 * crouch;

      if (paddleAt) {
        // Point the paddle arm AT the paddle.
        //
        // The paddle is placed by the simulation's reach model, up to 0.92 m from
        // the body. With a capsule for a body that was fine; with a person it was
        // a paddle floating in mid-air beside somebody whose arms were by their
        // sides. The arm is aimed rather than the paddle moved, because where the
        // paddle is IS the rule — it is where the ball can be met — and moving it
        // to suit the animation would be the renderer lying about the game.
        //
        // Resolved in `upper` space rather than `body` space, because the arms
        // now hang off the twisting chest. Converting in the wrong space would
        // aim the arm correctly only while the torso happened to be square,
        // which is to say everywhere except during a swing.
        _reach.set(paddleAt.x, paddleAt.y, paddleAt.z);
        upper.worldToLocal(_reach);
        _aim.set(
          _reach.x - armR.shoulder.position.x,
          _reach.y - armR.shoulder.position.y,
          _reach.z,
        );
        if (_aim.lengthSq() > 1e-6) {
          _aim.normalize();
          armR.shoulder.quaternion.setFromUnitVectors(_down, _aim);
          armR.elbow.rotation.set(0, 0, 0);
        }
      } else {
        const ready = -0.5 - 0.25 * gait - 0.5 * crouch;
        const back = 2.1;
        armR.shoulder.rotation.set(ready + (back - ready) * swing, 0, -0.25 - 0.5 * swing);
        armR.elbow.rotation.x = -0.7 + 0.45 * swing;
      }

      const hue = canReach ? 0.33 - 0.33 * Math.min(1, strain) : 0.0;
      ringMat.color.setHSL(hue, 0.7, 0.55);
      ringMat.opacity = canReach ? 0.34 + 0.3 * strain : 0.24;
    },
  };
};
