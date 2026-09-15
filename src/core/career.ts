/**
 * The ladder: eight rivals, and a reason to come back tomorrow.
 *
 * Day 22. The game has been a complete match engine with nothing to do twice.
 * A career is the cheapest honest fix, and "cheapest" matters — everything here
 * is a small amount of state over the top of a match that already works, and
 * none of it reaches into the simulation.
 *
 * The design rule, stated so it can be broken deliberately rather than by
 * accident: **a rival is a Style plus a Difficulty and nothing else.** No hidden
 * bonuses, no rubber-banding, no secret extra reach for the rival at the top.
 * If the player can beat Marco, it is because they worked out how Marco plays,
 * and that is only true while Marco is made of the same parts everybody else is.
 *
 * The arithmetic of the ladder is separated from its storage for the usual
 * reason: the rules are worth testing and `localStorage` is two lines of
 * try/catch. Everything above `loadCareer` is pure.
 */

import { Difficulty } from '../sim/opponent';
import { STYLES, Style, StyleName, STYLE_BLURB } from '../sim/style';

export interface Rival {
  id: string;
  name: string;
  /** A word the player can hold on to, shown next to the name. */
  styleName: StyleName;
  difficulty: Difficulty;
  /** One line of scouting, from the style. */
  blurb: string;
}

const rival = (
  id: string,
  name: string,
  styleName: StyleName,
  difficulty: Difficulty,
): Rival => ({ id, name, styleName, difficulty, blurb: STYLE_BLURB[styleName] });

/**
 * The ladder, hardest first.
 *
 * The ORDER is not a guess. `tools/styles.mjs` measured each style against the
 * `all court` reference, and the rally-win column came out, in doubles:
 *
 *   banger 87.8%   wall 60.4%   all court 58.6%   lobber 40.0%
 *
 * So a banger at a given difficulty is a harder opponent than a wall at the
 * same one, and the rungs interleave style with difficulty rather than simply
 * running easy-steady-tough three times. That is also what keeps the climb from
 * feeling like a slider: rung 5 is an easy banger and rung 4 is a steady
 * lobber, and which of those is harder depends on how you play rather than on
 * which number is bigger.
 *
 * The banger's 87.8 per cent is not a balance triumph and is recorded as
 * DINK-114. It wins by hitting hard, flat and unreturnable, which works because
 * this game's players cannot cover a hard flat ball — DINK-37, the movement
 * model, seen from a new angle. A style that beats the sport by exploiting the
 * engine is a finding, not a difficulty setting, and the ladder places bangers
 * carefully rather than pretending the number is fine.
 */
export const LADDER: readonly Rival[] = [
  rival('marco', 'Marco Bassi', 'banger', 'tough'),
  rival('dee', 'Dee Chen', 'all court', 'tough'),
  rival('otto', 'Otto Lindqvist', 'wall', 'tough'),
  rival('priya', 'Priya Raman', 'banger', 'steady'),
  rival('sam', 'Sam Okafor', 'all court', 'steady'),
  rival('kiri', 'Kiri Tane', 'wall', 'steady'),
  rival('dev', 'Dev Arora', 'banger', 'easy'),
  rival('nan', 'Nan Whitlock', 'lobber', 'easy'),
];

/** Rank 1 is the top. The player starts one rung below the bottom rival. */
export const BOTTOM_RANK = LADDER.length + 1;

export interface Record_ {
  won: number;
  lost: number;
}

export interface Career {
  /** 1 is champion; BOTTOM_RANK is where everybody starts. */
  rank: number;
  /** Best rank ever held, so a bad run does not erase the good one. */
  best: number;
  /** Per rival, by id. */
  results: Record<string, Record_>;
  matches: number;
}

export const newCareer = (): Career => ({
  rank: BOTTOM_RANK,
  best: BOTTOM_RANK,
  results: {},
  matches: 0,
});

/**
 * Who the player may challenge from where they are.
 *
 * The rival one rung up, and nobody else. A ladder where you can challenge
 * anybody is a menu, and a menu is what the game already had. Restricting it to
 * one opponent is what makes the next match a specific problem to solve rather
 * than a difficulty to pick — and the whole value of named rivals is that you
 * go away and think about how to beat *that* person.
 *
 * Returns null only when the player is champion, which is the one state with
 * nobody above them.
 */
export const nextOpponent = (career: Career): Rival | null =>
  career.rank <= 1 ? null : LADDER[career.rank - 2];

/** The rival occupying a rank, or null for the player's own rung. */
export const rivalAt = (rank: number): Rival | null => LADDER[rank - 1] ?? null;

/**
 * Apply a finished match.
 *
 * Winning swaps you with the rival above. Losing costs nothing but the match.
 *
 * No relegation, and that is a decision rather than an omission. This game is
 * forty minutes deep at most, and a ladder that can send a player backwards
 * turns a bad session into lost progress — which is the mechanic most likely to
 * make somebody close it and not come back. The cost of leaving it out is that
 * the climb is monotonic and therefore slightly cheap, and that is the better
 * of the two problems while the game is still this young.
 *
 * Returns a NEW career rather than mutating, so the caller can show a before
 * and after without keeping a copy.
 */
export const recordMatch = (career: Career, rivalId: string, won: boolean): Career => {
  const prior = career.results[rivalId] ?? { won: 0, lost: 0 };
  const results = {
    ...career.results,
    [rivalId]: { won: prior.won + (won ? 1 : 0), lost: prior.lost + (won ? 0 : 1) },
  };
  // Only a win against the rival directly above moves you. Beating somebody
  // else — which the UI does not currently offer, but a save file from a later
  // build might — counts on the record and changes nothing else.
  const climbed = won && LADDER[career.rank - 2]?.id === rivalId;
  const rank = climbed ? career.rank - 1 : career.rank;
  return {
    rank,
    best: Math.min(career.best, rank),
    results,
    matches: career.matches + 1,
  };
};

export const isChampion = (career: Career): boolean => career.rank <= 1;

/** Wins and losses across the whole ladder, for the career screen. */
export const totals = (career: Career): Record_ =>
  Object.values(career.results).reduce(
    (acc, r) => ({ won: acc.won + r.won, lost: acc.lost + r.lost }),
    { won: 0, lost: 0 },
  );

export const styleFor = (r: Rival): Style => STYLES[r.styleName];

// ------------------------------------------------------------- storage ----

const KEY = 'dink.career.v1';

/**
 * Take what is usable and default the rest.
 *
 * Same posture as `coerce` in settings.ts, and for a sharper reason: this is the
 * only state in the game a player can LOSE. A settings file that fails to parse
 * costs somebody their camera preference; a career file that fails to parse
 * costs them an evening. So every field is checked individually, a rank from a
 * build with a longer ladder is clamped rather than rejected, and an unknown
 * rival id is dropped without taking the rest of the record with it.
 */
export const coerceCareer = (raw: unknown): Career => {
  const c = newCareer();
  if (typeof raw !== 'object' || raw === null) return c;
  const v = raw as Record<string, unknown>;

  if (typeof v.rank === 'number' && Number.isFinite(v.rank)) {
    c.rank = Math.min(BOTTOM_RANK, Math.max(1, Math.round(v.rank)));
  }
  if (typeof v.best === 'number' && Number.isFinite(v.best)) {
    c.best = Math.min(BOTTOM_RANK, Math.max(1, Math.round(v.best)));
  }
  // A best that is worse than the current rank is incoherent, and the honest
  // repair is to believe the rank: it is the one the player can see.
  c.best = Math.min(c.best, c.rank);

  if (typeof v.matches === 'number' && Number.isFinite(v.matches) && v.matches >= 0) {
    c.matches = Math.round(v.matches);
  }

  const known = new Set(LADDER.map((r) => r.id));
  if (typeof v.results === 'object' && v.results !== null) {
    for (const [id, r] of Object.entries(v.results as Record<string, unknown>)) {
      if (!known.has(id) || typeof r !== 'object' || r === null) continue;
      const rec = r as Record<string, unknown>;
      const won = typeof rec.won === 'number' && rec.won >= 0 ? Math.round(rec.won) : 0;
      const lost = typeof rec.lost === 'number' && rec.lost >= 0 ? Math.round(rec.lost) : 0;
      c.results[id] = { won, lost };
    }
  }
  return c;
};

const storage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export const loadCareer = (): Career => {
  const store = storage();
  if (!store) return newCareer();
  try {
    const text = store.getItem(KEY);
    return text === null ? newCareer() : coerceCareer(JSON.parse(text));
  } catch {
    return newCareer();
  }
};

/** Best effort. A failure here must never interrupt a game. */
export const saveCareer = (career: Career): void => {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(career));
  } catch {
    /* full, blocked, or private. The match still counted on screen. */
  }
};
