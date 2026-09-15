import * as C from './constants';
import { Vec3 } from './vec3';

export type Side = 'near' | 'far';

/**
 * Which player within a team.
 *
 * Until Day 13 `Side` did two jobs — which end of the court, and which player —
 * and singles let them be the same word because a team was one person. Doubles
 * separates them, and the separation is the whole refactor: a fault, a point and
 * a score belong to an END, while a serve turn and a swing belong to a PLAYER.
 * Every place that had to choose one meaning is now forced to say which.
 *
 * Slot 0 is the player who starts the game in the right/even court. That is not
 * an arbitrary label: the rulebook hangs the entire doubles serve rotation off
 * that player, and pinning it to a slot number is what makes the rotation
 * derivable rather than tracked. See `serveBox` in rules.ts.
 */
export type Slot = 0 | 1;

/** A player, unambiguously: which end, and which of the two on it. */
export interface PlayerId {
  side: Side;
  slot: Slot;
}

export const otherSlot = (slot: Slot): Slot => (slot === 0 ? 1 : 0);

/** One player a side, or two. There is no third option in this sport. */
export type TeamSize = 1 | 2;

/** Positive z is the near side, negative z the far side. */
export const sideOf = (z: number): Side => (z >= 0 ? 'near' : 'far');

/**
 * Net height at a given x. The net is strung between posts and sags to
 * 34 in at the centre, so we interpolate. A parabola fits the real sag
 * better than a straight line and costs nothing.
 */
export const netHeightAt = (x: number): number => {
  const t = Math.min(1, Math.abs(x) / C.NET_HALF_WIDTH);
  return (
    C.NET_HEIGHT_CENTER + (C.NET_HEIGHT_POST - C.NET_HEIGHT_CENTER) * t * t
  );
};

/** Is a bounce point inside the court, lines counting as in? */
export const isInBounds = (p: Vec3): boolean =>
  Math.abs(p.x) <= C.COURT_HALF_WIDTH && Math.abs(p.z) <= C.COURT_HALF_LENGTH;

/** Is a bounce point inside the non-volley zone on either side? */
export const isInKitchen = (p: Vec3): boolean =>
  isInBounds(p) && Math.abs(p.z) <= C.KITCHEN_DEPTH;

/**
 * Service courts are the quarters behind the kitchen. Serving is diagonal,
 * so the receiving box is on the opposite side and the opposite half of x.
 */
export const isInServiceBox = (
  p: Vec3,
  side: Side,
  rightHalf: boolean,
): boolean => {
  if (!isInBounds(p)) return false;
  if (sideOf(p.z) !== side) return false;
  if (Math.abs(p.z) < C.KITCHEN_DEPTH) return false;
  return rightHalf ? p.x >= 0 : p.x < 0;
};

/**
 * The other end of the court.
 *
 * Lived in `rules.ts` until Day 9, which was the wrong home: it is a fact about
 * the geometry, not about the rulebook, and the series module needed it without
 * needing anything else in there.
 */
export const opponentOf = (side: Side): Side => (side === 'near' ? 'far' : 'near');
