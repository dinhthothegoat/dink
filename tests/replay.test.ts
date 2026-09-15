import { describe, expect, it } from 'vitest';
import {
  REPLAY_VERSION,
  Recorder,
  ReplaySetup,
  frames,
  newSeed,
  readReplay,
} from '../src/core/replay';
import { InputFrame, emptyInput } from '../src/sim/input';

const setup = (): ReplaySetup => ({
  version: REPLAY_VERSION,
  build: 'test',
  seed: 1234,
  server: 'near',
  difficulty: 'steady',
  teamSize: 1,
  watching: false,
  farStyle: 'all court',
  nearStyle: 'all court',
});

const f = (over: Partial<InputFrame> = {}): InputFrame => ({ ...emptyInput(), ...over });

const roundTrip = (input: InputFrame[]): InputFrame[] => {
  const r = new Recorder(setup());
  for (const frame of input) r.push(frame);
  const parsed = readReplay(JSON.parse(JSON.stringify(r.finish())));
  if (!parsed.ok) throw new Error(parsed.reason);
  return [...frames(parsed.replay)];
};

describe('recording input', () => {
  it('gives back exactly what went in', () => {
    const input = [
      f(),
      f({ moveX: -1, moveZ: 1 }),
      f({ moveX: -1, moveZ: 1 }),
      f({ swing: true, shape: 'lob', aimX: 0.5 }),
      f({ shape: 'drop', aimX: -1 }),
    ];
    expect(roundTrip(input)).toEqual(input);
  });

  it('collapses a held key into one run', () => {
    const r = new Recorder(setup());
    for (let i = 0; i < 500; i += 1) r.push(f({ moveZ: -1 }));
    const out = r.finish();
    expect(out.runs).toHaveLength(1);
    expect(out.runs[0][0]).toBe(500);
    expect(out.ticks).toBe(500);
  });

  it('does not collapse frames that differ in any single field', () => {
    // Each of these differs from the base in exactly one way. A comparison that
    // forgot a field would merge two of them and the replay would silently
    // play a different match.
    const input = [
      f(),
      f({ moveX: 1 }),
      f({ moveZ: 1 }),
      f({ swing: true }),
      f({ shape: 'drop' }),
      f({ aimX: 0.25 }),
      f({ aimZ: -0.5 }),
    ];
    const r = new Recorder(setup());
    for (const frame of input) r.push(frame);
    expect(r.finish().runs).toHaveLength(input.length);
  });

  it('stores axis values exactly, without quantising', () => {
    // A gamepad stick is continuous. Rounding it would make replays diverge,
    // and the divergence would look like a physics bug rather than a storage
    // one, which is the worst possible place for it to show up.
    const odd = f({ moveX: 0.123456789, aimX: -0.987654321, aimZ: 0.55555 });
    expect(roundTrip([odd])[0]).toEqual(odd);
  });

  it('yields a fresh frame each tick rather than one mutable object', () => {
    // Three separate defects in this project have come from a shared scratch
    // buffer being read after something else mutated it.
    const out = roundTrip([f({ moveX: 1 }), f({ moveX: 1 })]);
    expect(out[0]).not.toBe(out[1]);
    out[0].moveX = -5;
    expect(out[1].moveX).toBe(1);
  });

  it('does not hand out the recorder’s own runs', () => {
    const r = new Recorder(setup());
    r.push(f({ moveX: 1 }));
    const a = r.finish();
    r.push(f({ moveX: 1 }));
    // `finish` is called on every Copy Replay click, mid-match. If it handed
    // back live arrays, the copy in somebody's bug report would keep changing
    // as they played on.
    expect(a.runs[0][0]).toBe(1);
  });
});

describe('reading a replay somebody sends you', () => {
  it('refuses a recording from another simulation', () => {
    const r = new Recorder({ ...setup(), version: REPLAY_VERSION + 1 });
    r.push(f());
    const parsed = readReplay(JSON.parse(JSON.stringify(r.finish())));
    expect(parsed.ok).toBe(false);
    // The reason matters: replaying it anyway would produce a different match
    // and send somebody chasing a defect that does not exist.
    expect(parsed.ok === false && parsed.reason).toContain('format');
  });

  it('spots a truncated file instead of replaying a shorter match', () => {
    const r = new Recorder(setup());
    for (let i = 0; i < 100; i += 1) r.push(f({ moveX: i % 2 }));
    const doc = JSON.parse(JSON.stringify(r.finish()));
    doc.runs = doc.runs.slice(0, 10);
    const parsed = readReplay(doc);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.reason).toContain('truncated');
  });

  it.each([
    ['not an object', 7],
    ['null', null],
    ['no setup', { runs: [] }],
    ['no runs', { setup: setup() }],
    ['a malformed run', { setup: setup(), runs: [[1, 0, 0]] }],
    ['a zero run length', { setup: setup(), runs: [[0, 0, 0, 0, 0, 0]] }],
    ['a NaN axis', { setup: setup(), runs: [[1, Number.NaN, 0, 0, 0, 0]] }],
  ])('refuses %s without throwing', (_label, doc) => {
    expect(() => readReplay(doc)).not.toThrow();
    expect(readReplay(doc).ok).toBe(false);
  });

  it('accepts a file with no tick header, since it is only a checksum', () => {
    const r = new Recorder(setup());
    r.push(f());
    const doc = JSON.parse(JSON.stringify(r.finish()));
    delete doc.ticks;
    expect(readReplay(doc).ok).toBe(true);
  });
});

describe('seeds', () => {
  it('does not hand out the same seed twice', () => {
    // The Day 23 defect, held down: every match ever played used seed 0,
    // so the opponent's error sequence was identical from the first serve of
    // every match, in every session, on every install.
    const seeds = new Set(Array.from({ length: 200 }, newSeed));
    expect(seeds.size).toBeGreaterThan(190);
    expect(seeds.has(0)).toBe(false);
  });

  it('produces a whole number that survives JSON', () => {
    for (let i = 0; i < 50; i += 1) {
      const s = newSeed();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(JSON.parse(JSON.stringify({ s })).s).toBe(s);
    }
  });
});
