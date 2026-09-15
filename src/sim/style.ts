/**
 * What a player does, as opposed to how well they do it.
 *
 * Day 22. Until today every opponent in this game was the same player at a
 * different quality setting. `LEVELS` moves three numbers — reaction time, read
 * error, mis-hit size — and all three answer the question "how good is this
 * person". None of them answers "what kind of player is this", so `easy` and
 * `tough` chose identical shots from identical positions and differed only in
 * how often they pulled them off.
 *
 * That is fine for a difficulty slider and useless for a named rival. "Marco"
 * is not a word for 0.45, and a ladder of eight people who all play the same
 * way is a ladder of one person with eight portraits.
 *
 * So there are two axes now and they are deliberately independent:
 *
 *   Skill  how well the shot is executed        (src/sim/execution.ts, LEVELS)
 *   Style  which shot is chosen in the first place   (here)
 *
 * Independent means a nervous banger and a fearless banger are both bangers,
 * and a weak dinker is bad at the same game a strong dinker is good at. Fold
 * them into one number and you lose the thing that makes an opponent memorable,
 * which is not their rating but the particular way they beat you.
 *
 * Every field is a dial on the existing decision in `chooseShot`, never a new
 * branch. That is a constraint worth stating: a style that needed its own
 * special case in the policy would be a second policy wearing a costume, and
 * the day it disagreed with the first one there would be no way to tell which
 * was meant to win.
 */

/** Named styles. The strings are the ladder's vocabulary, not decoration. */
export type StyleName = 'all court' | 'banger' | 'wall' | 'lobber';

export interface Style {
  name: StyleName;
  /**
   * How a ball that could be driven or dropped gets played, 0 soft to 1 hard.
   *
   * The single most visible dial. At 0 a player will dink from the kitchen and
   * drop from the transition zone all day; at 1 they drive whatever they can
   * reach, which is what most people mean when they complain about bangers.
   */
  aggression: number;
  /**
   * Ground taken after a shot, as a multiple of the base step.
   *
   * 0 is a player who never comes in and plays the whole match from the
   * baseline. Above 1 is somebody who is at the net whether or not the shot
   * they just hit earned it, which is a real and beatable habit.
   */
  netUrge: number;
  /** How wide they aim, as a multiple of the base spread. */
  spread: number;
  /**
   * Contact height above which they will hit down on the ball, in metres.
   *
   * Lower means they attack balls that are not really attackable. This is the
   * dial that makes a banger lose points rather than just hit hard: the height
   * at which hitting down is a good idea is a fact about the net, and a player
   * who ignores it is making an error by choice.
   *
   * Calibrated against the measured distribution, not chosen by eye. Day 22
   * measured where the ball actually is when somebody strikes it:
   *
   *   at the net    median 0.39 m, p75 0.52, p90 0.65
   *   transition    median 0.33 m, p90 0.49
   *
   * `ATTACK_HEIGHT` had been 0.95 since Day 5, set by eye. It sits above the
   * 90th percentile of every zone, which means "attack the high ball" has been
   * close to dead code for seventeen days: the branch existed, was reachable in
   * principle, and almost never fired. Three styles separated by 0.8, 0.95 and
   * 1.15 would have been three thresholds all sitting above the distribution,
   * differing from each other in a region with no data in it.
   *
   * So the styles below are placed inside the measured spread, where a tenth of
   * a metre is a difference in behaviour. `all court` keeps 0.95 deliberately:
   * it is the control for the singles ladder, and moving it is a balance change
   * rather than a career-mode one. That it is near-dead is DINK-115 rather than
   * a secret.
   */
  attackHeight: number;
  /**
   * Will they play a third shot drop, or bang the third ball?
   *
   * A boolean because it is a boolean in real players. Somebody who does not
   * have the shot does not play a slightly worse version of it, they drive
   * instead and take their chances.
   */
  thirdShotDrop: boolean;
  /**
   * How stretched they must be before they reset with a lob, 0 to 1.
   *
   * Lower means they bail out early. A lobber lobs from positions a better
   * player would attack from, which buys them time and gives away the net.
   */
  lobAt: number;
  /**
   * Where they stand when nothing is forcing them anywhere, in metres from the
   * net. The baseline is 6.7, the non-volley line is 2.13.
   */
  homeDepth: number;
}

/**
 * The five archetypes.
 *
 * These are not five points on one line. Each one is built around a single
 * commitment that a real player would recognise, and the numbers follow from
 * the commitment rather than being spread out to look varied:
 *
 *   banger   hits hard from everywhere and does not own a soft shot
 *   wall     never misses, never attacks, wins by outlasting
 *   lobber   gives ground and puts it over your head
 *   all court  the Day 5 policy, unchanged, as the reference
 *
 * There were five. `crasher` — a player who lives on the kitchen line and takes
 * everything early — was built, measured, and deleted the same day, which is
 * the second time this project has done that and the second time it was right.
 *
 * It separated cleanly in singles and was indistinguishable from `all court` in
 * doubles, and the measurement said why in one number: `at line` came out 67.9
 * per cent for `all court`, `wall` AND `crasher`. Identical to a tenth. In
 * doubles a player's court position is owned by `planTeam`, not by the
 * individual, so `homeDepth` and `netUrge` are singles-only dials and a style
 * built on court position has nothing to express in half the game.
 *
 * Reviving it means teaching team plans about style, which is a day's work and
 * changes doubles positioning globally. That is DINK-116, not a tuning pass.
 * Four styles that are different everywhere beat five where one is a duplicate
 * in the mode the career ladder will mostly be played in.
 *
 * `all court` keeps exactly the constants the game shipped with, so it is the
 * control: any measured difference between the others and this one is the
 * style doing something, not the refactor.
 */
export const STYLES: Record<StyleName, Style> = {
  /**
   * The control, and the game's policy up to Day 22 exactly.
   *
   * `attackHeight` 0.95 and `lobAt` 0.78 were constants in `opponent.ts` called
   * ATTACK_HEIGHT and STRETCHED. The second one is worth its history: it was
   * 0.62 first, and a third of every shot in a self-play game came out as a
   * defensive lob, because with any read error at all a player is routinely
   * half a metre off and half a metre is 0.62 of a 1.15 m reach. A lob belongs
   * where a ball is genuinely unplayable, not merely awkward.
   */
  'all court': {
    name: 'all court',
    aggression: 0.5,
    netUrge: 1,
    spread: 1,
    attackHeight: 0.95,
    thirdShotDrop: true,
    lobAt: 0.78,
    homeDepth: 6.2,
  },

  /**
   * Drives the third ball, drives from the kitchen, and hits down on balls
   * that are not high enough to hit down on. `attackHeight` at 0.36 is at the tenth
   * percentile of contacts at the net, so this player tries to hit down on
   * essentially every ball including ones well below the tape. That is not a
   * bug in the style, it is the style: the errors are the point.
   */
  banger: {
    name: 'banger',
    aggression: 0.95,
    netUrge: 0.45,
    spread: 1.25,
    attackHeight: 0.36,
    thirdShotDrop: false,
    lobAt: 0.9,
    homeDepth: 6.5,
  },

  /**
   * The opposite commitment. Drops, dinks, resets, and only attacks a ball
   * that is genuinely sitting up. Takes the net and holds it. Beats anybody
   * who is in a hurry and loses to anybody willing to stay in a dink rally
   * longer, which is exactly the matchup a player should learn to recognise.
   */
  wall: {
    name: 'wall',
    aggression: 0.08,
    netUrge: 1.35,
    spread: 0.7,
    attackHeight: 0.7,
    thirdShotDrop: true,
    lobAt: 0.86,
    homeDepth: 3.4,
  },

  /**
   * Bails out early and puts it over your head. `lobAt` well below the others
   * means they reset from positions a better player would attack from, which
   * costs them the initiative and buys them time. Sits deep on purpose.
   */
  lobber: {
    name: 'lobber',
    aggression: 0.25,
    netUrge: 0.7,
    spread: 0.85,
    attackHeight: 0.95,
    thirdShotDrop: true,
    lobAt: 0.5,
    homeDepth: 5.6,
  },

};

export const STYLE_NAMES: readonly StyleName[] = Object.keys(STYLES) as StyleName[];

/**
 * One line a player can read, and act on.
 *
 * A named opponent is only worth naming if you can learn something about them,
 * and the thing you learn has to be actionable before the first point rather
 * than after the third game.
 */
export const STYLE_BLURB: Record<StyleName, string> = {
  'all court': 'Plays every shot in the book. No obvious way in.',
  banger: 'Drives everything, even the balls that are too low to drive.',
  wall: 'Will dink all day. Beats anyone in a hurry.',
  lobber: 'Resets early and puts it over your head. Give them no time.',
};

export const styleOf = (name: StyleName): Style => STYLES[name];
