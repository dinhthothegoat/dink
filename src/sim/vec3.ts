/**
 * Minimal, allocation-conscious 3D vector math for the simulation layer.
 * Deliberately free of any Three.js import: the sim must run headless
 * (tests, future dedicated server, replay validation).
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const clone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });

export const set = (out: Vec3, x: number, y: number, z: number): Vec3 => {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
};

export const copy = (out: Vec3, a: Vec3): Vec3 => set(out, a.x, a.y, a.z);

export const add = (out: Vec3, a: Vec3, b: Vec3): Vec3 =>
  set(out, a.x + b.x, a.y + b.y, a.z + b.z);

export const sub = (out: Vec3, a: Vec3, b: Vec3): Vec3 =>
  set(out, a.x - b.x, a.y - b.y, a.z - b.z);

export const scale = (out: Vec3, a: Vec3, s: number): Vec3 =>
  set(out, a.x * s, a.y * s, a.z * s);

/** out = a + b * s. The workhorse of the integrator. */
export const addScaled = (out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 =>
  set(out, a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);

export const cross = (out: Vec3, a: Vec3, b: Vec3): Vec3 =>
  set(
    out,
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  );

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;

export const length = (a: Vec3): number => Math.sqrt(lengthSq(a));

export const normalize = (out: Vec3, a: Vec3): Vec3 => {
  const len = length(a);
  return len > 1e-9 ? scale(out, a, 1 / len) : set(out, 0, 0, 0);
};

export const lerp = (out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 =>
  set(
    out,
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  );
