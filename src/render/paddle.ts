import * as THREE from 'three';
import * as C from '../sim/constants';
import { Vec3 } from '../sim/vec3';

export interface PaddleView {
  group: THREE.Group;
  /** Point the face along `normal` and show the swing path as an arrow. */
  pose: (at: Vec3, normal: Vec3, path: Vec3) => void;
  /**
   * The swing-path arrow explains the spin model in a sandbox and is clutter
   * in a game, where the player is watching the ball rather than studying a
   * contact.
   */
  showPathArrow: (visible: boolean) => void;
}

/**
 * The paddle, drawn mainly so the difference between where the face points
 * and where the paddle is travelling is visible. That difference is the whole
 * spin model, and it is much easier to understand as a picture than as two
 * numbers in a panel.
 */
export const buildPaddle = (): PaddleView => {
  const group = new THREE.Group();

  const face = new THREE.Mesh(
    new THREE.BoxGeometry(C.PADDLE_FACE_WIDTH, C.PADDLE_FACE_LENGTH, 0.012),
    new THREE.MeshStandardMaterial({ color: 0x1d3d57, roughness: 0.7, metalness: 0.1 }),
  );
  face.castShadow = true;

  const rim = new THREE.Mesh(
    new THREE.BoxGeometry(C.PADDLE_FACE_WIDTH + 0.01, C.PADDLE_FACE_LENGTH + 0.01, 0.006),
    new THREE.MeshBasicMaterial({ color: 0xffb648 }),
  );
  rim.position.z = -0.005;

  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.017, 0.019, C.PADDLE_LENGTH - C.PADDLE_FACE_LENGTH, 10),
    new THREE.MeshStandardMaterial({ color: 0x22303b, roughness: 0.9 }),
  );
  handle.position.y = -(C.PADDLE_FACE_LENGTH + (C.PADDLE_LENGTH - C.PADDLE_FACE_LENGTH)) / 2;

  const body = new THREE.Group();
  body.add(rim, face, handle);
  group.add(body);

  // Swing-path arrow, drawn from the contact point.
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(),
    0.55,
    0xff8a3d,
    0.14,
    0.09,
  );
  group.add(arrow);

  const _n = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _target = new THREE.Vector3();

  return {
    group,
    showPathArrow: (visible) => {
      arrow.visible = visible;
    },
    pose: (at, normal, path) => {
      group.position.set(at.x, at.y, at.z);
      _n.set(normal.x, normal.y, normal.z).normalize();
      // The face plate's own +z is its normal, so aim that at the target.
      _target.copy(group.position).add(_n);
      body.position.set(0, 0, 0);
      body.lookAt(_target);
      // Push the paddle back behind the ball so the two do not intersect.
      body.position.copy(_n).multiplyScalar(-C.BALL_RADIUS - 0.02);
      _p.set(path.x, path.y, path.z).normalize();
      arrow.setDirection(_p);
    },
  };
};
