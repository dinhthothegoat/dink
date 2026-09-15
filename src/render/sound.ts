/**
 * The game's audio, synthesised rather than sampled.
 *
 * No files. Every sound here is a few oscillators and a noise burst built at
 * runtime, which is a deliberate choice with three reasons behind it. The
 * published build is a single self-contained page, so an audio file would have
 * to be base64 in the bundle. A synthesised hit can be a continuous function of
 * what happened — how fast the ball left, how far off the middle of the paddle
 * it was — where a sample can only be picked from a short list. And the mapping
 * from contact to sound is then a pure function, which is the part worth
 * testing.
 *
 * Nothing in here is allowed to touch the simulation. See ADR-0004.
 */

export interface Voice {
  /** Centre frequency of the tonal part, Hz. */
  tone: number;
  /** How much of the sound is noise rather than tone, 0 to 1. */
  noise: number;
  /** Peak gain, 0 to 1. */
  gain: number;
  /** Seconds to silence. */
  decay: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * What a paddle hit sounds like.
 *
 * A pickleball off a composite paddle is a bright, short "pock" — most of its
 * energy above a kilohertz, gone inside a tenth of a second. Two things move
 * it, and both are things the contact model already computes:
 *
 * Speed raises the pitch and the level. That is the obvious one.
 *
 * Off-centre contact is the one that matters for play. A ball struck off the
 * end of the paddle excites the edge rather than the face: the tone drops, the
 * noise rises, and the whole thing dies faster. That is exactly what a mis-hit
 * sounds like in the sport, and it is the half-second of feedback Day 7's error
 * model had no way to deliver — the ball goes out two seconds later, long after
 * the player has stopped associating it with the swing.
 */
export const hitVoice = (exitSpeed: number, offCentre: number): Voice => {
  const fast = clamp01(exitSpeed / 22);
  const off = clamp01(offCentre);
  return {
    tone: (820 + 900 * fast) * (1 - 0.42 * off),
    noise: 0.18 + 0.55 * off,
    gain: (0.18 + 0.34 * fast) * (1 - 0.3 * off),
    decay: (0.075 + 0.045 * fast) * (1 - 0.4 * off),
  };
};

/** The court. Lower, softer, and it dies fast on a slow ball. */
export const bounceVoice = (approachSpeed: number): Voice => {
  const hard = clamp01(approachSpeed / 14);
  return {
    tone: 190 + 210 * hard,
    noise: 0.35,
    gain: 0.06 + 0.2 * hard,
    decay: 0.09 + 0.05 * hard,
  };
};

/** The net: no tone worth speaking of, just a short scrape. */
export const netVoice = (): Voice => ({ tone: 260, noise: 0.9, gain: 0.16, decay: 0.14 });

export interface Sound {
  hit: (exitSpeed: number, offCentre: number) => void;
  bounce: (approachSpeed: number) => void;
  net: () => void;
  /** Two notes: up for a point won, down for one lost. */
  call: (won: boolean) => void;
  /** Call from a real user gesture, or nothing will ever play. */
  unlock: () => void;
  setMuted: (muted: boolean) => void;
  muted: () => boolean;
}

/** One second of white noise, generated once and reused for every burst. */
const makeNoise = (ctx: AudioContext): AudioBuffer => {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
};

export const createSound = (): Sound => {
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  let master: GainNode | null = null;
  let muted = false;

  /**
   * Built on first use rather than at import.
   *
   * Browsers refuse to start an AudioContext outside a user gesture, and one
   * created too early lands in "suspended" and stays there even after the
   * player clicks — so the game is silent with no error anywhere. Creating it
   * on the first gesture avoids the whole category.
   */
  const ready = (): boolean => {
    if (muted) return false;
    if (!ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return false;
      ctx = new Ctor();
      noise = makeNoise(ctx);
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx.state !== 'closed';
  };

  /**
   * One voice: a tone and a noise burst through the same envelope.
   *
   * Both parts are scheduled and forgotten. Nothing is pooled and nothing is
   * stopped by hand — the nodes are one-shot and the browser collects them when
   * they finish, which for sounds this short is cheaper than managing a pool.
   */
  const play = (v: Voice, when = 0): void => {
    if (!ready() || !ctx || !master || !noise) return;
    const t = ctx.currentTime + when;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    // A 4 ms attack. Zero attack clicks; anything longer stops sounding like
    // an impact and starts sounding like a note.
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, v.gain), t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + v.decay);
    env.connect(master);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(v.tone, t);
    // A falling pitch is what a struck object does as it loses energy, and it
    // is most of what makes this read as an impact rather than a beep.
    osc.frequency.exponentialRampToValueAtTime(v.tone * 0.6, t + v.decay);
    const oscGain = ctx.createGain();
    oscGain.gain.value = 1 - v.noise;
    osc.connect(oscGain).connect(env);
    osc.start(t);
    osc.stop(t + v.decay + 0.02);

    if (v.noise > 0.01) {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.playbackRate.value = 0.8 + Math.random() * 0.4;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = v.tone * 1.6;
      band.Q.value = 0.9;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = v.noise;
      src.connect(band).connect(noiseGain).connect(env);
      src.start(t);
      src.stop(t + v.decay + 0.02);
    }
  };

  return {
    hit: (exitSpeed, offCentre) => play(hitVoice(exitSpeed, offCentre)),
    bounce: (approachSpeed) => play(bounceVoice(approachSpeed)),
    net: () => play(netVoice()),
    call: (won) => {
      // A minor third, up or down. Short enough not to sit on top of the next
      // serve, and distinct enough to know the answer without reading the panel.
      const root = won ? 520 : 440;
      play({ tone: root, noise: 0, gain: 0.13, decay: 0.16 });
      play({ tone: won ? root * 1.2 : root * 0.8, noise: 0, gain: 0.12, decay: 0.26 }, 0.12);
    },
    unlock: () => {
      ready();
    },
    setMuted: (next) => {
      muted = next;
      if (master && ctx) master.gain.setTargetAtTime(next ? 0 : 0.9, ctx.currentTime, 0.02);
    },
    muted: () => muted,
  };
};
