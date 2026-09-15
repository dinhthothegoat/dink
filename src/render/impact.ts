import * as THREE from 'three';

/**
 * A ring that expands and fades where something was struck.
 *
 * The job it does is timing. A swing commits 120 ms before contact, so the
 * player presses a key and then waits — and until now nothing marked the moment
 * the paddle actually arrived. Without that mark there is no way to learn
 * whether you were early or late, which is the one thing the whole input model
 * is built around.
 *
 * Colour carries the second message. Day 7 made shots go wrong under pressure,
 * but the consequence lands two seconds later when the ball drops out, by which
 * time nobody connects it to the swing. A clean contact flashes pale; a bad one
 * flashes orange, at the instant it happens.
 */

export interface Impacts {
  group: THREE.Group;
  /** `quality` 0 is a clean strike, 1 is as bad as it gets. */
  at: (x: number, y: number, z: number, strength: number, quality: number) => void;
  /**
   * Call once per rendered frame with real seconds elapsed. The camera is
   * needed because a ring in mid-air has to face it: left lying flat, a contact
   * two metres up reads as an ellipse on an invisible floor rather than as a
   * mark on the ball.
   */
  update: (dt: number, camera: THREE.Camera) => void;
  clear: () => void;
}

interface Ring {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  life: number;
  span: number;
  size: number;
  /** A bounce marks the ground and lies flat; a contact happens in the air. */
  flat: boolean;
}

/**
 * A fixed pool, because these are created inside the render loop.
 *
 * Eight is more than a rally ever needs at once — a ring lives for a third of a
 * second and the fastest exchange in the game is nowhere near eight contacts in
 * that time. Allocating geometry per contact would hand the garbage collector
 * work in the middle of the frame, which is exactly where a stutter comes from.
 */
const POOL = 8;

const CLEAN = new THREE.Color(0xdff3ff);
const BAD = new THREE.Color(0xff9a3c);

export const createImpacts = (): Impacts => {
  const group = new THREE.Group();
  const rings: Ring[] = [];
  let next = 0;

  for (let i = 0; i < POOL; i++) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.72, 28),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.visible = false;
    group.add(mesh);
    rings.push({ mesh, life: 0, span: 1, size: 1, flat: true });
  }

  return {
    group,
    at: (x, y, z, strength, quality) => {
      const ring = rings[next];
      next = (next + 1) % POOL;
      ring.mesh.position.set(x, y, z);
      ring.mesh.visible = true;
      ring.span = 0.2 + 0.16 * strength;
      ring.life = ring.span;
      ring.size = 0.16 + 0.34 * strength;
      ring.mesh.material.color.copy(CLEAN).lerp(BAD, Math.min(1, Math.max(0, quality)));
      ring.mesh.scale.setScalar(0.01);
      ring.flat = y < 0.1;
      if (ring.flat) ring.mesh.rotation.set(-Math.PI / 2, 0, 0);
    },
    update: (dt, camera) => {
      for (const ring of rings) {
        if (ring.life <= 0) continue;
        ring.life -= dt;
        if (ring.life <= 0) {
          ring.mesh.visible = false;
          ring.mesh.material.opacity = 0;
          continue;
        }
        const t = 1 - ring.life / ring.span;
        // Expand fast and then slow, which is what an impact looks like; a
        // linear expansion reads as a growing circle rather than a release.
        ring.mesh.scale.setScalar(ring.size * (0.2 + 1.6 * Math.sqrt(t)));
        ring.mesh.material.opacity = 0.85 * (1 - t) * (1 - t);
        if (!ring.flat) ring.mesh.quaternion.copy(camera.quaternion);
      }
    },
    clear: () => {
      for (const ring of rings) {
        ring.life = 0;
        ring.mesh.visible = false;
        ring.mesh.material.opacity = 0;
      }
    },
  };
};
