import { describe, expect, it } from 'vitest';
import { approach } from '../src/render/camera';
import { bounceVoice, hitVoice, netVoice } from '../src/render/sound';

/**
 * The pure half of the feel layer.
 *
 * The parts that touch WebGL and Web Audio are exercised by the browser play
 * test, which fails on any page error. What is worth unit-testing is the
 * mapping from what happened to what it looks and sounds like, and the one
 * piece of maths that is easy to get wrong in a way nobody notices until they
 * change monitors.
 */

describe('what a strike sounds like', () => {
  it('gets brighter and louder the harder it is hit', () => {
    const soft = hitVoice(6, 0);
    const hard = hitVoice(20, 0);
    expect(hard.tone).toBeGreaterThan(soft.tone);
    expect(hard.gain).toBeGreaterThan(soft.gain);
  });

  it('goes dull, noisy and short off the end of the paddle', () => {
    // This is the half-second of feedback Day 7's error model could not give.
    // A mis-hit's consequence lands two seconds later when the ball drops out,
    // by which point nobody connects it to the swing. The sound lands now.
    const clean = hitVoice(16, 0);
    const mishit = hitVoice(16, 1);
    expect(mishit.tone).toBeLessThan(clean.tone);
    expect(mishit.noise).toBeGreaterThan(clean.noise);
    expect(mishit.decay).toBeLessThan(clean.decay);
    expect(mishit.gain).toBeLessThan(clean.gain);
  });

  it('stays inside sane ranges however absurd the input', () => {
    for (const v of [hitVoice(0, 0), hitVoice(200, 5), hitVoice(-3, -2), bounceVoice(90), netVoice()]) {
      expect(v.tone).toBeGreaterThan(20);
      expect(v.tone).toBeLessThan(20000);
      expect(v.gain).toBeGreaterThan(0);
      expect(v.gain).toBeLessThanOrEqual(1);
      expect(v.decay).toBeGreaterThan(0);
      expect(v.decay).toBeLessThan(1);
      expect(v.noise).toBeGreaterThanOrEqual(0);
      expect(v.noise).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the court lower than the paddle', () => {
    // Plastic on composite is a bright pock; plastic on asphalt is a thud. If
    // these ever cross, the two most common sounds in the game stop being
    // distinguishable, and the ear is what tells you a rally is still alive.
    expect(bounceVoice(12).tone).toBeLessThan(hitVoice(12, 0).tone);
  });
});

describe('framerate independence', () => {
  /**
   * The bug this pins does not look like a bug. `x += (target - x) * 0.1` is
   * the way everyone writes a follow camera, and it moves at a rate that
   * depends on how often it is called — so a follow tuned on a 60 Hz display
   * is twice as fast on a 144 Hz one and a crawl in the headless harness at
   * fifteen. Nobody reports it; they just say the camera feels wrong.
   */
  it('covers the same ground in the same time at any frame rate', () => {
    const run = (steps: number, seconds: number): number => {
      let x = 0;
      for (let i = 0; i < steps; i++) x = approach(x, 10, seconds / steps);
      return x;
    };
    const at60 = run(60, 1);
    const at15 = run(15, 1);
    const at144 = run(144, 1);
    expect(at15).toBeCloseTo(at60, 4);
    expect(at144).toBeCloseTo(at60, 4);
  });

  it('settles rather than overshooting, even on a very long frame', () => {
    // A tab returning from the background hands over a frame of several
    // seconds. The exponential form saturates at the target; a naive lerp with
    // a large step sails past it and the camera snaps back.
    const x = approach(0, 10, 30);
    expect(x).toBeGreaterThan(9.9);
    expect(x).toBeLessThanOrEqual(10);
  });

  it('does not move when it is already there', () => {
    expect(approach(4, 4, 0.016)).toBe(4);
  });
});
