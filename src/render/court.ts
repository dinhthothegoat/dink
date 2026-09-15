import * as THREE from 'three';
import * as C from '../sim/constants';
import { netHeightAt } from '../sim/court';

const LINE_W = 0.0508; // regulation lines are 2 in wide
const LINE_Y = 0.002; // lifted a hair to beat z-fighting with the surface

const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f4f6 });

const stripe = (w: number, l: number, x: number, z: number): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, LINE_Y, z);
  return m;
};

/** Court surface, painted lines, net and posts, as a single group. */
export const buildCourt = (): THREE.Group => {
  const g = new THREE.Group();

  const apronX = C.COURT_HALF_WIDTH + 3.05;
  const apronZ = C.COURT_HALF_LENGTH + 3.05;

  const surround = new THREE.Mesh(
    new THREE.PlaneGeometry(apronX * 2, apronZ * 2),
    new THREE.MeshLambertMaterial({ color: 0x1f5b46 }),
  );
  surround.rotation.x = -Math.PI / 2;
  surround.receiveShadow = true;
  g.add(surround);

  const playing = new THREE.Mesh(
    new THREE.PlaneGeometry(C.COURT_HALF_WIDTH * 2, C.COURT_HALF_LENGTH * 2),
    new THREE.MeshLambertMaterial({ color: 0x2f6fa8 }),
  );
  playing.rotation.x = -Math.PI / 2;
  playing.position.y = 0.001;
  playing.receiveShadow = true;
  g.add(playing);

  // The kitchen gets its own shade so the non-volley zone reads instantly.
  for (const sign of [1, -1]) {
    const k = new THREE.Mesh(
      new THREE.PlaneGeometry(C.COURT_HALF_WIDTH * 2, C.KITCHEN_DEPTH),
      new THREE.MeshLambertMaterial({ color: 0x27547e }),
    );
    k.rotation.x = -Math.PI / 2;
    k.position.set(0, 0.0015, (sign * C.KITCHEN_DEPTH) / 2);
    g.add(k);
  }

  const W = C.COURT_HALF_WIDTH;
  const L = C.COURT_HALF_LENGTH;
  const K = C.KITCHEN_DEPTH;

  g.add(stripe(W * 2, LINE_W, 0, L)); // near baseline
  g.add(stripe(W * 2, LINE_W, 0, -L)); // far baseline
  g.add(stripe(LINE_W, L * 2, W, 0)); // right sideline
  g.add(stripe(LINE_W, L * 2, -W, 0)); // left sideline
  g.add(stripe(W * 2, LINE_W, 0, K)); // near kitchen line
  g.add(stripe(W * 2, LINE_W, 0, -K)); // far kitchen line
  // Centre lines split the service courts, and stop at the kitchen.
  g.add(stripe(LINE_W, L - K, 0, (L + K) / 2));
  g.add(stripe(LINE_W, L - K, 0, -(L + K) / 2));

  g.add(buildNet());
  if (C.KITCHEN_BARRIER) g.add(buildKitchenBarrier());
  return g;
};

/**
 * A waist-high rail around both kitchens.
 *
 * It stops players and not the ball, which is the whole idea, so it is drawn
 * low and semi-transparent: tall enough to read as a wall you cannot walk
 * through, short enough that a dink still visibly sails over it and lands
 * inside. The rail runs along the kitchen line and up both sides to the net,
 * and stops at the sidelines so a wide ball can still be chased around it.
 */
const buildKitchenBarrier = (): THREE.Group => {
  const group = new THREE.Group();
  const h = C.KITCHEN_BARRIER_HEIGHT;
  const railMat = new THREE.MeshStandardMaterial({
    color: 0xffb648,
    transparent: true,
    opacity: 0.85,
    roughness: 0.5,
  });
  const meshMat = new THREE.MeshBasicMaterial({
    color: 0xffb648,
    transparent: true,
    opacity: 0.11,
    side: THREE.DoubleSide,
  });
  const postMat = new THREE.MeshStandardMaterial({ color: 0xc98a2c, roughness: 0.6 });

  const rail = (length: number, x: number, z: number, alongX: boolean): THREE.Mesh => {
    const m = new THREE.Mesh(
      alongX
        ? new THREE.BoxGeometry(length, 0.045, 0.045)
        : new THREE.BoxGeometry(0.045, 0.045, length),
      railMat,
    );
    m.position.set(x, h, z);
    m.castShadow = true;
    return m;
  };

  const panel = (width: number, x: number, z: number, alongX: boolean): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, h), meshMat);
    m.position.set(x, h / 2, z);
    if (!alongX) m.rotation.y = Math.PI / 2;
    return m;
  };

  const W = C.COURT_HALF_WIDTH;
  const K = C.KITCHEN_DEPTH;

  for (const side of [1, -1]) {
    // The kitchen line itself.
    group.add(rail(W * 2, 0, side * K, true));
    group.add(panel(W * 2, 0, side * K, true));
    // Returns down each sideline to the net, so the zone is enclosed.
    for (const edge of [1, -1]) {
      group.add(rail(K, edge * W, (side * K) / 2, false));
      group.add(panel(K, edge * W, (side * K) / 2, false));
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, h, 10), postMat);
      post.position.set(edge * W, h / 2, side * K);
      post.castShadow = true;
      group.add(post);
    }
    // A post at the centre of the kitchen line stops it looking like a floating bar.
    const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, h, 10), postMat);
    mid.position.set(0, h / 2, side * K);
    group.add(mid);
  }
  return group;
};

const buildNet = (): THREE.Group => {
  const net = new THREE.Group();
  const segments = 48;
  const meshMat = new THREE.MeshBasicMaterial({
    color: 0x0b1a24,
    transparent: true,
    opacity: 0.62,
    side: THREE.DoubleSide,
  });
  const cordMat = new THREE.MeshBasicMaterial({ color: 0xe8eef2 });

  // Build the sagging net as a strip of quads so the catenary is visible.
  const positions: number[] = [];
  for (let i = 0; i < segments; i++) {
    const x0 = -C.NET_HALF_WIDTH + (2 * C.NET_HALF_WIDTH * i) / segments;
    const x1 = -C.NET_HALF_WIDTH + (2 * C.NET_HALF_WIDTH * (i + 1)) / segments;
    const y0 = netHeightAt(x0);
    const y1 = netHeightAt(x1);
    positions.push(x0, 0, 0, x1, 0, 0, x1, y1, 0);
    positions.push(x0, 0, 0, x1, y1, 0, x0, y0, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  net.add(new THREE.Mesh(geo, meshMat));

  for (let i = 0; i < segments; i++) {
    const x0 = -C.NET_HALF_WIDTH + (2 * C.NET_HALF_WIDTH * i) / segments;
    const x1 = -C.NET_HALF_WIDTH + (2 * C.NET_HALF_WIDTH * (i + 1)) / segments;
    const y0 = netHeightAt(x0);
    const y1 = netHeightAt(x1);
    const len = Math.hypot(x1 - x0, y1 - y0);
    const cord = new THREE.Mesh(new THREE.BoxGeometry(len, 0.032, 0.02), cordMat);
    cord.position.set((x0 + x1) / 2, (y0 + y1) / 2 + 0.016, 0);
    cord.rotation.z = Math.atan2(y1 - y0, x1 - x0);
    net.add(cord);
  }

  const postMat = new THREE.MeshLambertMaterial({ color: 0x33404a });
  for (const sign of [1, -1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, C.NET_HEIGHT_POST + 0.05, 12),
      postMat,
    );
    post.position.set(sign * C.NET_HALF_WIDTH, (C.NET_HEIGHT_POST + 0.05) / 2, 0);
    post.castShadow = true;
    net.add(post);
  }
  return net;
};
