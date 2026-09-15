/**
 * What the player chose last time.
 *
 * Day 19. Everything here is a convenience, never state the game needs to be
 * correct: a fresh browser, a private window, or storage that throws must all
 * produce a working game on the defaults. That is why every read is guarded and
 * every value is validated on the way back in rather than trusted because it
 * came from us — the thing in storage may have been written by an older build,
 * by a different tab, or by somebody editing it by hand.
 *
 * It deliberately does NOT store anything about a match in progress. Scores,
 * serve rotation and who is at the net belong to the simulation, and a half-
 * restored rally is worse than no rally. DINK-66 asked for a session record
 * across matches; this is the settings half of it and the results half is still
 * open.
 */

export type Mode = 'singles' | 'doubles';

export interface Settings {
  difficulty: 'easy' | 'steady' | 'tough';
  mode: Mode;
  /** The computer plays both ends and the keyboard is ignored. */
  watch: boolean;
  view: 'broadcast' | 'side' | 'top';
  speed: number;
  muted: boolean;
}

export const DEFAULTS: Settings = {
  difficulty: 'steady',
  mode: 'singles',
  watch: false,
  view: 'broadcast',
  speed: 0.6,
  muted: false,
};

const KEY = 'dink.settings.v1';

/** The speeds the buttons offer. Anything else is somebody else's writing. */
const SPEEDS = [0.45, 0.6, 0.8, 1];

/**
 * Take what is usable from an unknown value and default the rest.
 *
 * Field by field rather than all or nothing: a build that adds a setting should
 * not throw away the four a player already chose, and one bad field should not
 * cost the others. Exported because it is the part worth testing — the storage
 * around it is two lines of try/catch.
 */
export const coerce = (raw: unknown): Settings => {
  const s = { ...DEFAULTS };
  if (typeof raw !== 'object' || raw === null) return s;
  const v = raw as Record<string, unknown>;
  if (v.difficulty === 'easy' || v.difficulty === 'steady' || v.difficulty === 'tough') {
    s.difficulty = v.difficulty;
  }
  if (v.mode === 'singles' || v.mode === 'doubles') s.mode = v.mode;
  if (typeof v.watch === 'boolean') s.watch = v.watch;
  if (v.view === 'broadcast' || v.view === 'side' || v.view === 'top') s.view = v.view;
  if (typeof v.speed === 'number' && SPEEDS.includes(v.speed)) s.speed = v.speed;
  if (typeof v.muted === 'boolean') s.muted = v.muted;
  return s;
};

/**
 * A storage that cannot throw.
 *
 * `localStorage` is not merely absent sometimes — the accessor itself throws in
 * a few contexts, including thumbnail capture and browsers set to block site
 * data. Reaching for it without a guard turns a settings feature into a blank
 * page.
 */
const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export const loadSettings = (): Settings => {
  const store = storage();
  if (!store) return { ...DEFAULTS };
  try {
    const text = store.getItem(KEY);
    return text === null ? { ...DEFAULTS } : coerce(JSON.parse(text));
  } catch {
    return { ...DEFAULTS };
  }
};

/** Best effort. A failure here must never interrupt a game. */
export const saveSettings = (settings: Settings): void => {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* full, blocked, or private. The game does not care. */
  }
};

export const teamSizeOf = (mode: Mode): 1 | 2 => (mode === 'doubles' ? 2 : 1);
