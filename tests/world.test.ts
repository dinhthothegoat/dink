import { describe, expect, it } from 'vitest';
import * as C from '../src/sim/constants';
import { isInBounds, isInKitchen, isInServiceBox, netHeightAt, sideOf } from '../src/sim/court';
import { createWorld, launch, SimEvent, step } from '../src/sim/world';
import { spinVector } from '../src/sim/ball';
import { v3, Vec3 } from '../src/sim/vec3';

/** Build a launch velocity the way the game does, from speed and angles. */
const shot = (speed: number, elevationDeg: number, azimuthDeg = 0): Vec3 => {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  const horiz = speed * Math.cos(el);
  return v3(horiz * Math.sin(az), speed * Math.sin(el), -horiz * Math.cos(az));
};

/** Run until the first bounce, net contact or timeout. Returns the events. */
const playOut = (
  pos: Vec3,
  vel: Vec3,
  spin: Vec3,
  maxSeconds = 8,
): { events: SimEvent[]; apex: number } => {
  const w = createWorld();
  launch(w, pos, vel, spin);
  const collected: SimEvent[] = [];
  let apex = pos.y;
  const maxTicks = maxSeconds * C.SIM_HZ;
  for (let i = 0; i < maxTicks; i++) {
    const evs = step(w);
    if (w.ball.pos.y > apex) apex = w.ball.pos.y;
    for (const e of evs) collected.push(e);
    if (collected.some((e) => e.type === 'bounce' || e.type === 'net')) break;
  }
  return { events: collected, apex };
};

describe('court geometry', () => {
  it('sags the net to 34 in at the centre and 36 in at the posts', () => {
    expect(netHeightAt(0) / 0.0254).toBeCloseTo(34, 6);
    expect(netHeightAt(C.NET_HALF_WIDTH) / 0.0254).toBeCloseTo(36, 6);
    expect(netHeightAt(1.5)).toBeGreaterThan(netHeightAt(0));
  });

  it('counts the lines as in', () => {
    expect(isInBounds(v3(C.COURT_HALF_WIDTH, 0, C.COURT_HALF_LENGTH))).toBe(true);
    expect(isInBounds(v3(C.COURT_HALF_WIDTH + 0.01, 0, 0))).toBe(false);
  });

  it('places the kitchen 7 ft from the net on both sides', () => {
    expect(isInKitchen(v3(0, 0, 2.0))).toBe(true);
    expect(isInKitchen(v3(0, 0, -2.0))).toBe(true);
    expect(isInKitchen(v3(0, 0, 2.5))).toBe(false);
  });

  it('resolves service boxes diagonally', () => {
    expect(sideOf(-3)).toBe('far');
    expect(isInServiceBox(v3(1.5, 0, -4), 'far', true)).toBe(true);
    expect(isInServiceBox(v3(-1.5, 0, -4), 'far', true)).toBe(false);
    expect(isInServiceBox(v3(1.5, 0, -1.5), 'far', true)).toBe(false); // kitchen
  });
});

describe('shot archetypes land where a pickleball player expects', () => {
  it('a serve clears the net and lands in the far service court', () => {
    const { events } = playOut(v3(0, 0.85, 6.6), shot(17.3, 13, -7), spinVector(600, 0));
    const bounce = events.find((e) => e.type === 'bounce');
    expect(bounce).toBeDefined();
    expect(events.some((e) => e.type === 'net')).toBe(false);
    if (bounce && bounce.type === 'bounce') {
      expect(bounce.inBounds).toBe(true);
      expect(bounce.at.z).toBeLessThan(-C.KITCHEN_DEPTH);
    }
  });

  it('a dink drops into the far kitchen', () => {
    const { events } = playOut(v3(0, 0.45, 2.4), shot(5.9, 42), spinVector(-250, 0));
    const bounce = events.find((e) => e.type === 'bounce');
    expect(bounce).toBeDefined();
    if (bounce && bounce.type === 'bounce') {
      expect(bounce.at.z).toBeLessThan(0);
      expect(isInKitchen(bounce.at)).toBe(true);
    }
  });

  it('a flat low ball hits the net rather than tunnelling through it', () => {
    const { events } = playOut(v3(0, 0.5, 3.0), v3(0, 0, -22), v3(0, 0, 0));
    expect(events.some((e) => e.type === 'net')).toBe(true);
  });

  it('a lob carries deep but stays in', () => {
    const { events, apex } = playOut(v3(0, 0.8, 2.6), shot(10.1, 51), spinVector(-600, 0));
    const bounce = events.find((e) => e.type === 'bounce');
    expect(apex).toBeGreaterThan(3);  // a lob has to clear a jumping opponent
    expect(bounce).toBeDefined();
    if (bounce && bounce.type === 'bounce') expect(bounce.inBounds).toBe(true);
  });

  it('topspin brings the same shot down shorter than backspin', () => {
    // 600 rpm rather than a heroic number: at high spin the backspin ball
    // flies clean out of the simulated volume and there is no bounce to
    // compare, which is itself a finding logged as DINK-14.
    const launchVel = shot(18.3, 16);
    const top = playOut(v3(0, 0.8, 6), launchVel, spinVector(600, 0));
    const back = playOut(v3(0, 0.8, 6), launchVel, spinVector(-600, 0));
    const tb = top.events.find((e) => e.type === 'bounce');
    const bb = back.events.find((e) => e.type === 'bounce');
    expect(tb && tb.type === 'bounce' ? tb.at.z : -99).toBeGreaterThan(
      bb && bb.type === 'bounce' ? bb.at.z : 99,
    );
  });
});

describe('world lifecycle', () => {
  it('settles the ball instead of bouncing forever', () => {
    const w = createWorld();
    launch(w, v3(0, 1.2, 0), v3(0, 0, 0), v3(0, 0, 0));
    let rested = false;
    for (let i = 0; i < 60 * C.SIM_HZ; i++) {
      for (const e of step(w)) if (e.type === 'rest') rested = true;
      if (rested) break;
    }
    expect(rested).toBe(true);
    expect(w.ball.resting).toBe(true);
  });

  it('advances one tick per step and keeps a previous state for interpolation', () => {
    const w = createWorld();
    launch(w, v3(0, 1, 5), v3(0, 2, -10), v3(0, 0, 0));
    const z0 = w.ball.pos.z;
    step(w);
    expect(w.tick).toBe(1);
    expect(w.prev.pos.z).toBeCloseTo(z0, 9);
    expect(w.ball.pos.z).toBeLessThan(z0);
  });
});
