import * as THREE from 'three';
import * as C from '../sim/constants';
import { buildCourt } from './court';
import { PaddleView, buildPaddle } from './paddle';
import { FAR_KIT, NEAR_KIT, PlayerView, buildPlayer, partnerKit } from './player';
import { CameraRig, Rig, createCameraRig } from './camera';
import { Impacts, createImpacts } from './impact';

/**
 * Three fixed camera rigs. Broadcast is what the game will ship with; side
 * and top exist because you cannot judge a trajectory down the barrel of the
 * shot, and most of Day 1's physics bugs were only obvious from the side.
 */
export type CameraView = 'broadcast' | 'side' | 'top';

/**
 * `up` is explicit because the top view needs it: looking straight down with the
 * default up of +y leaves the view direction parallel to up, `lookAt` falls back
 * on an epsilon, and the resulting roll is arbitrary. That is what put the court
 * sideways with the near baseline on the left.
 *
 * `follow` and `shake` are Day 8. The two playing views lean and flinch; the top
 * view does neither, on purpose. It is a reading instrument — it is where you go
 * to see exactly where the opponent is holding — and an instrument that moves
 * when the subject moves is no longer telling you where anything is.
 */
const VIEWS: Record<CameraView, Rig> = {
  broadcast: {
    pos: [0, 5.6, 14.8],
    look: [0, 0.6, -1.6],
    up: [0, 1, 0],
    follow: 0.26,
    shake: 0.075,
  },
  side: { pos: [16.5, 3.2, 0], look: [0, 1.5, 0], up: [0, 1, 0], follow: 0.1, shake: 0.05 },
  // Near baseline at the bottom of the screen, +x to the right, as a player
  // standing behind the court would see it. High enough that both baselines and
  // the run-off behind them fit.
  top: { pos: [0, 22, 0], look: [0, 0, 0], up: [0, 0, -1], follow: 0, shake: 0 },
};

export interface Renderer {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  setView: (view: CameraView) => void;
  ball: THREE.Mesh;
  marker: THREE.Mesh;
  /** Ring dropped where the ball first bounced, so the landing stays visible. */
  landingMark: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  /** Ring showing where the ball will be when a swing pressed now arrives. */
  intercept: THREE.Mesh;
  /**
   * Crosshair on the far court showing where a shot pressed now would be aimed.
   *
   * The counterpart to `intercept`, and the two answer the two halves of one
   * question: that one is where the ball will be, this one is where it would go.
   * Aim has been a control with no feedback since Day 1 — the title card said
   * "arrows to aim" and nothing on screen ever moved — which was survivable
   * while aim was three lateral positions and is not survivable now that it is a
   * plane. A control the player cannot see is a control they will not use.
   */
  aimMark: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  trail: THREE.Line;
  paddle: PaddleView;
  player: PlayerView;
  /**
   * The doubles partners, hidden in singles.
   *
   * Day 16. `?doubles=1` put four players on court and drew two of them: the
   * scene had exactly two `PlayerView`s and nothing ever asked for more. Two of
   * the four were invisible, which is a strange thing to have shipped a doubles
   * video of.
   */
  partner: PlayerView;
  oppPartner: PlayerView;
  /** The far side, drawn the same way but without the reach ring lit up. */
  opponent: PlayerView;
  /** Ring showing where a swing pressed now would put the paddle. */
  swingMark: THREE.Mesh;
  /** Expanding rings marking where and how well the ball was struck. */
  impacts: Impacts;
  /** The camera's own motion: lean, flinch, and settling. */
  rig: CameraRig;
  render: () => void;
  resize: () => void;
  pushTrail: (x: number, y: number, z: number) => void;
  clearTrail: () => void;
}

/** 4 s of flight at the 120 Hz sim rate, which outlasts any real rally shot. */
const TRAIL_POINTS = 480;

/**
 * The ball is drawn slightly larger than it is. At a broadcast-style camera
 * distance a true 74 mm sphere is a couple of pixels and the player loses it
 * entirely; every tennis and pickleball game does some version of this.
 */
const BALL_RENDER_SCALE = 1.6;

export const createRenderer = (canvas: HTMLCanvasElement): Renderer => {
  const gl = new THREE.WebGLRenderer({ canvas, antialias: true });
  gl.setPixelRatio(Math.min(devicePixelRatio, 2));
  gl.shadowMap.enabled = true;
  gl.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1620);
  scene.fog = new THREE.Fog(0x0d1620, 45, 95);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);
  const rig = createCameraRig(camera, VIEWS.broadcast);
  const setView = (view: CameraView): void => {
    rig.setRig(VIEWS[view]);
  };
  setView('broadcast');

  scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x203040, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(7, 14, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const cam = sun.shadow.camera;
  cam.left = -14;
  cam.right = 14;
  cam.top = 14;
  cam.bottom = -14;
  cam.far = 45;
  scene.add(sun);

  scene.add(buildCourt());

  const impacts = createImpacts();
  scene.add(impacts.group);

  const paddle = buildPaddle();
  scene.add(paddle.group);

  // The near player carries no paddle of their own: `renderer.paddle` is the
  // precise one, with a real face orientation, and two paddles in one hand is
  // worse than none.
  const player = buildPlayer(NEAR_KIT, false);
  scene.add(player.group);

  const opponent = buildPlayer(FAR_KIT);
  scene.add(opponent.group);

  // Partners wear the team kit a shade darker, so a pair reads as a pair and
  // the two of them are still telling apart at broadcast distance.
  const partner = buildPlayer(partnerKit(NEAR_KIT));
  partner.setVisible(false);
  scene.add(partner.group);

  const oppPartner = buildPlayer(partnerKit(FAR_KIT));
  oppPartner.setVisible(false);
  scene.add(oppPartner.group);

  const swingMark = new THREE.Mesh(
    new THREE.RingGeometry(0.06, 0.1, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffb648,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    }),
  );
  swingMark.rotation.x = -Math.PI / 2;
  swingMark.position.y = 0.004;
  swingMark.visible = false;
  scene.add(swingMark);

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(C.BALL_RADIUS * BALL_RENDER_SCALE, 24, 16),
    new THREE.MeshStandardMaterial({
      color: 0xf7e11f,
      roughness: 0.55,
      metalness: 0.0,
      emissive: 0x3a3405,
    }),
  );
  ball.castShadow = true;
  scene.add(ball);

  // A flat ring under the ball: without it, judging height in a fixed
  // camera is genuinely hard, and the shadow alone is too soft to read.
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.1, 24),
    new THREE.MeshBasicMaterial({
      color: 0xffe45e,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.004;
  scene.add(marker);

  // The ball goes on bouncing and rolling after it lands, often well off the
  // court, so the landing point needs a mark of its own or the shot's actual
  // result is lost in the aftermath.
  const landingMark = new THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>(
    new THREE.RingGeometry(0.09, 0.16, 28),
    new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    }),
  );
  landingMark.rotation.x = -Math.PI / 2;
  landingMark.position.y = 0.006;
  landingMark.visible = false;
  scene.add(landingMark);

  const intercept = new THREE.Mesh(
    new THREE.RingGeometry(0.13, 0.19, 32),
    new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    }),
  );
  intercept.rotation.x = -Math.PI / 2;
  intercept.position.y = 0.005;
  intercept.visible = false;
  scene.add(intercept);

  // Deliberately a different colour and a different size from the intercept
  // ring. They are both flat rings on the floor and they are on screen at the
  // same time, so if they read as the same object the player learns nothing from
  // either. Amber, and wider, because it is the one that sits still.
  const aimMark = new THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>(
    new THREE.RingGeometry(0.22, 0.3, 32),
    new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    }),
  );
  aimMark.rotation.x = -Math.PI / 2;
  aimMark.position.y = 0.005;
  aimMark.visible = false;
  scene.add(aimMark);

  const trailGeo = new THREE.BufferGeometry();
  const trailPos = new Float32Array(TRAIL_POINTS * 3);
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
  trailGeo.setDrawRange(0, 0);
  const trail = new THREE.Line(
    trailGeo,
    new THREE.LineBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.85 }),
  );
  trail.frustumCulled = false;
  scene.add(trail);

  let trailCount = 0;

  const resize = (): void => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    gl.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();

  return {
    scene,
    camera,
    setView,
    ball,
    marker,
    landingMark,
    intercept,
    aimMark,
    trail,
    paddle,
    player,
    opponent,
    partner,
    oppPartner,
    swingMark,
    impacts,
    rig,
    render: () => gl.render(scene, camera),
    resize,
    pushTrail: (x, y, z) => {
      if (trailCount >= TRAIL_POINTS) {
        trailPos.copyWithin(0, 3);
        trailCount = TRAIL_POINTS - 1;
      }
      const i = trailCount * 3;
      trailPos[i] = x;
      trailPos[i + 1] = y;
      trailPos[i + 2] = z;
      trailCount += 1;
      trailGeo.setDrawRange(0, trailCount);
      trailGeo.attributes.position.needsUpdate = true;
    },
    clearTrail: () => {
      trailCount = 0;
      trailGeo.setDrawRange(0, 0);
    },
  };
};
