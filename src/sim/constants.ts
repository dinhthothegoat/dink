/**
 * Physical and dimensional constants.
 *
 * Every value here is sourced from either USA Pickleball equipment/court
 * specification or from standard aerodynamics. Where a value is a tuning
 * choice rather than a measured fact it is marked TUNED, so future changes
 * to feel do not quietly corrupt the parts that are meant to be real.
 *
 * Units are SI throughout: metres, kilograms, seconds, radians.
 * Coordinate frame (matches the renderer):
 *   +x  across the court, sideline to sideline
 *   +y  up
 *   +z  along the court, from the net toward the near baseline
 *   net plane is z = 0
 */

const FT = 0.3048;
const IN = 0.0254;

// ---------------------------------------------------------------- court ----

/** Full court is 20 ft x 44 ft, so half-width is 10 ft. */
export const COURT_HALF_WIDTH = 10 * FT; // 3.048 m
/** Half-length is 22 ft from the net to each baseline. */
export const COURT_HALF_LENGTH = 22 * FT; // 6.7056 m
/** Non-volley zone ("the kitchen") extends 7 ft from the net on both sides. */
export const KITCHEN_DEPTH = 7 * FT; // 2.1336 m
/** Net is 36 in at the sidelines and sags to 34 in at the centre. */
export const NET_HEIGHT_POST = 36 * IN; // 0.9144 m
export const NET_HEIGHT_CENTER = 34 * IN; // 0.8636 m
/** Posts sit 1 ft outside each sideline. */
export const NET_HALF_WIDTH = COURT_HALF_WIDTH + 1 * FT;

// ----------------------------------------------------------------- ball ----

/**
 * Outdoor ball mass. USA Pickleball allows 0.78-0.935 oz; we take the middle
 * of that range, which is also the mass the trajectory study below fitted its
 * drag coefficient against. Mass and Cd have to come from the same place or
 * the fitted force is wrong.
 */
export const BALL_MASS = 0.0243;
/** Diameter 2.874-2.972 in; we take the middle at ~74 mm. */
export const BALL_RADIUS = 0.0371;
/**
 * A pickleball is a hollow shell, so its moment of inertia coefficient is
 * closer to 2/3 (thin spherical shell) than to the 2/5 of a solid sphere.
 * This matters: a hollow ball converts bounce friction into spin far more
 * readily, which is why pickleball kicks the way it does.
 */
export const BALL_INERTIA_COEF = 2 / 3;
export const BALL_AREA = Math.PI * BALL_RADIUS * BALL_RADIUS;

// ------------------------------------------------------------ atmosphere ----

export const GRAVITY = 9.80665;
export const AIR_DENSITY = 1.225; // sea level, 15 C

/**
 * MEASURED. Drag coefficient for a 40-hole outdoor ball, from trajectory
 * fitting (Cd = 0.30 +/- 0.02) and corroborated by wind-tunnel work reporting
 * a mean of 0.33 for outdoor balls. Both were taken at an air density of
 * 1.29 kg/m^3; since we simulate at standard 1.225, the coefficient is scaled
 * by 1.29/1.225 so the resulting force matches what was actually measured.
 *
 * Day 1 used 0.45, which is the indoor 26-hole ball. Outdoor balls have more
 * and larger holes and are markedly less draggy.
 */
export const DRAG_COEF = 0.316;

/**
 * MEASURED. Lift slope for the Magnus force, through Cl = LIFT_SLOPE * S with
 * S = r*omega/v. Two independent studies land on Cl = 0.195*S; the same
 * density rescaling as above brings it to 0.205.
 *
 * Day 1 used 1.0, a guess, and it was five times too strong: a 600 rpm
 * backspin drive flew 2.5 m long. This is DINK-14 closed.
 */
export const LIFT_SLOPE = 0.205;
/**
 * Cl is capped where the linear fit stops being supported by data. The
 * measurements cover S up to roughly 0.35, which at 15 m/s is about 1500 rpm,
 * so 0.205*0.35 is where we stop trusting it.
 */
export const LIFT_COEF_MAX = 0.072;

/**
 * MEASURED, on shape. Backspin does not lift the way topspin dives.
 *
 * The Magnus force in a textbook is symmetric: reverse the spin and you reverse
 * the force, same magnitude. A pickleball does not do that.
 *
 * Two studies, BOTH trajectory fits from filmed free flight rather than wind
 * tunnel work:
 *
 *   Steyn et al. (2025), six trajectories, fitted Cl = 0.195*S. Symmetric,
 *   linear, and it is where LIFT_SLOPE above comes from.
 *
 *   Tennis Warehouse University, "The Physics of Pickleball Aerodynamics and
 *   Trajectories", 86 trajectories: topspin lift rises strongly and linearly
 *   with S, backspin lift shows "far less dependence on spin than expected" and
 *   clusters near a flat Cl = 0.2. It says explicitly that the simpler linear
 *   model cannot capture this.
 *
 * WHERE THEY DISAGREE, this model does not choose. At S = 0.35 the linear fit
 * gives Cl = 0.072 and the newer study gives backspin roughly 0.2 — a factor of
 * three, and the exact slopes are not published in a form that can be extracted.
 * Taking the larger number because it came from the larger study would be
 * picking a winner in an argument this project is not qualified to settle.
 *
 * WHERE THEY AGREE is that backspin SATURATES and topspin does not, and that is
 * what is implemented: backspin reaches the same modest ceiling the linear fit
 * supports, but reaches it at a much lower spin number and then stops. A hard
 * slice and a gentle one float by nearly the same amount; a hard topspin drive
 * dives far harder than a gentle one.
 *
 * DINK-31: closed on the asymmetry, left open on the magnitude, with the
 * disagreement written down rather than averaged away.
 */
export const BACKSPIN_SATURATION_S = 0.12;

/**
 * How far a ball travels while its spin decays by 1/e, in metres.
 *
 * A LENGTH, not a time, and that is the Day 20 correction. Spin decay was a flat
 * 4-second time constant with no source behind it, which says a ball dawdling
 * through a dink loses spin as fast as one fizzing past at 20 m/s.
 *
 * The governing relation is dw/dt = -c * U * w (Goodwill and Haake, "The Spin
 * Decay of Sports Balls in Flight"): the decay RATE scales with speed, because
 * the aerodynamic torque doing the slowing scales with speed. So the natural
 * constant is a distance, and the time constant falls out as
 * SPIN_DECAY_LENGTH / speed — 2 s at 20 m/s, 8 s at 5 m/s.
 *
 * The magnitude is still not sourced. That paper measured tennis balls and
 * footballs and explicitly has no data on hollow or perforated balls, and no
 * pickleball figure was found. 40 m is chosen so that at 10 m/s, a typical rally
 * speed, this reproduces the old 4-second constant exactly — so nothing that was
 * balanced against the old behaviour moves, and only the SHAPE changes.
 *
 * DINK-32: the form is now sourced, the magnitude is still an anchor.
 */
export const SPIN_DECAY_LENGTH = 40;

/**
 * Realistic spin ceiling. The trajectory study models rotation up to 15 s^-1
 * and calls 10 s^-1 typical, so roughly 600 rpm in normal play and 900 rpm at
 * the top end. The sandbox and, later, the contact model clamp here rather
 * than letting a player dial in tennis-like numbers a paddle cannot produce.
 */
export const MAX_SPIN_RPM = 1500;

// ------------------------------------------------------------- surfaces ----

/**
 * Coefficient of restitution. USA Pickleball specifies a 30-34 in rebound
 * from a 78 in drop onto granite, so e = sqrt(32/78) = 0.64.
 */
export const COURT_RESTITUTION = Math.sqrt(32 / 78); // 0.6405

/**
 * MEASURED, by borrowing. Sliding friction, ball against acrylic-coated
 * concrete.
 *
 * A pickleball court and a tennis hard court are the same surface — acrylic
 * over concrete or asphalt — so the tennis literature applies even though the
 * ball does not. The ITF measures this directly with a ball launcher and sorts
 * courts by the result: friction above 0.71 is a SLOW court (clay), below 0.55
 * is a FAST one (grass), and acrylic hard courts sit in the medium band between
 * them (Cross, "Measurement of the speed and bounce of tennis courts").
 *
 * Day 20 found this constant sitting at exactly 0.55, which is to say the game
 * was being played on grass. 0.63 is the middle of the band the surface actually
 * belongs to.
 *
 * The move costs nothing, and the reason is worth writing down because it was
 * measured rather than assumed. Sweeping this constant against the rally
 * profile:
 *
 *   0.05 .. 0.50   wild and chaotic: 194 to 450 rallies per eight games
 *   0.52 and above BYTE IDENTICAL, all the way to 0.90
 *
 * The bounce model applies friction up to Coulomb's limit but never more than
 * the impulse that exactly cancels slip. Above about 0.52 the limit stops
 * binding: every bounce GRIPS, and the gripping branch does not read this
 * number at all. So across the whole range an acrylic court can physically
 * occupy, the simulation cannot see this constant.
 *
 * That is the finding. It was marked TUNED and treated as a risk for twenty
 * days, and it is inert. A better-sourced value that changes nothing is the
 * best kind of correction, and knowing WHY it changes nothing is worth more
 * than the correction.
 */
export const COURT_FRICTION = 0.63;

/**
 * The net is soft: it eats most of the ball's energy. TUNED, and honestly so.
 *
 * No source was found for either of these, and Day 20 looked. Tennis net
 * measurements exist but a tennis net is strung to a tension a pickleball net
 * is not, and borrowing across that gap is how a plausible number becomes a
 * fake one. They stay tuning choices with their reasoning out loud: a ball into
 * the mesh drops nearly dead, a ball onto the tape can go anywhere, and the gap
 * between the two is what makes a net cord feel like luck.
 */
export const NET_RESTITUTION = 0.18;
/** The net cord (the tape at the top) is much livelier than the mesh. TUNED. */
export const NET_CORD_RESTITUTION = 0.45;

// --------------------------------------------------------------- paddle ---

/**
 * Paddle geometry and mass, from a typical mid-weight composite paddle within
 * the USA Pickleball limits (length no more than 17 in, length plus width no
 * more than 24 in).
 */
export const PADDLE_MASS = 0.226; // 8.0 oz
export const PADDLE_LENGTH = 16 * IN;
export const PADDLE_FACE_LENGTH = 11 * IN;
export const PADDLE_FACE_WIDTH = 8 * IN;
/**
 * Distance from the butt of the handle to the centre of mass, i.e. the
 * balance point. Quoted balance points cluster around 7.5-8 in.
 */
export const PADDLE_BALANCE = 8 * IN;
/**
 * Moment of inertia about the centre of mass, for rotation in the plane of
 * the swing, derived rather than asserted. The paddle is modelled as a
 * uniform handle rod plus a uniform face plate, each contributing its own
 * inertia plus a parallel-axis term. Deriving it means changing the paddle
 * geometry updates the feel of off-centre hits automatically instead of
 * leaving a stale magic number behind.
 */
const HANDLE_LENGTH = PADDLE_LENGTH - PADDLE_FACE_LENGTH;
const HANDLE_CENTER = HANDLE_LENGTH / 2;
const FACE_CENTER_FROM_BUTT = HANDLE_LENGTH + PADDLE_FACE_LENGTH / 2;

/**
 * Share of the paddle's mass in the handle rather than the face. Not a free
 * parameter: it is solved so the two-segment model balances exactly at the
 * published balance point, which is the one paddle property manufacturers
 * actually print on the box.
 */
const HANDLE_MASS_FRACTION =
  (PADDLE_BALANCE - FACE_CENTER_FROM_BUTT) / (HANDLE_CENTER - FACE_CENTER_FROM_BUTT);
const HANDLE_MASS = PADDLE_MASS * HANDLE_MASS_FRACTION;
const FACE_MASS = PADDLE_MASS - HANDLE_MASS;

export const PADDLE_INERTIA =
  (HANDLE_MASS * HANDLE_LENGTH * HANDLE_LENGTH) / 12 +
  HANDLE_MASS * (PADDLE_BALANCE - HANDLE_CENTER) ** 2 +
  (FACE_MASS * PADDLE_FACE_LENGTH * PADDLE_FACE_LENGTH) / 12 +
  FACE_MASS * (FACE_CENTER_FROM_BUTT - PADDLE_BALANCE) ** 2;

/** Where the two-segment model actually balances; tested against PADDLE_BALANCE. */
export const PADDLE_MODEL_BALANCE =
  (HANDLE_MASS * HANDLE_CENTER + FACE_MASS * FACE_CENTER_FROM_BUTT) / PADDLE_MASS;
/** Distance from the butt to the geometric centre of the face. */
export const PADDLE_FACE_CENTER = PADDLE_LENGTH - PADDLE_FACE_LENGTH / 2;

/**
 * Coefficient of restitution between ball and paddle face. USA Pickleball
 * caps paddle COR at 0.43 and that is where competitive paddles sit, so it is
 * both the legal ceiling and a fair default.
 */
export const PADDLE_COR = 0.43;
/**
 * Friction between the ball and a textured paddle face. TUNED: the governing
 * body regulates surface roughness rather than publishing a friction figure.
 *
 * 0.5 was tried first and made every brushed shot grip completely, so any
 * slice at all pinned the spin clamp. A paddle face is smoother than a
 * strung racket, and letting the ball slide through part of the contact is
 * both more physical and what keeps spin a thing players earn by degrees.
 */
export const PADDLE_FRICTION = 0.35;

// --------------------------------------------------------------- player ---

/**
 * Movement. All TUNED, but anchored to the court rather than picked freely:
 * the whole playing surface is 6.1 m wide and 6.7 m deep per side, so a player
 * covers a sideline-to-sideline sprint in a bit over two seconds and spends
 * most of a rally accelerating rather than at top speed. That is why the
 * acceleration figure matters far more to how the game feels than the top
 * speed does, and why it is generous. Logged as DINK-37 to check against
 * broadcast footage.
 */
export const PLAYER_MAX_SPEED = 4.2;
export const PLAYER_ACCEL = 14;
export const PLAYER_DECEL = 18;
/** Body radius, for keeping a player off the net and out of the posts. */
export const PLAYER_RADIUS = 0.28;

/**
 * A physical barrier around the non-volley zone.
 *
 * In the real sport the kitchen is a rule, not a wall: you may stand in it, you
 * just may not volley from it. This makes it a wall instead, which is a
 * deliberate design choice rather than a simplification that got away from us.
 * A rule needs teaching, a fault call, and a moment where the player is
 * punished for something they did not see; a rail teaches itself the first time
 * you walk into it.
 *
 * The trade it makes: balls landing deep in your own kitchen become
 * unreachable, because reach is 1.15 m and the rail holds you 2.41 m from the
 * net. That is the cost, and it is why the real rule stays on the table as
 * DINK-39 if the barrier turns out to hollow out the soft game.
 *
 * The barrier stops players only. The ball passes straight through it, because
 * dinks and drops have to be able to land in there.
 */
/**
 * The kitchen is a rule again, not a fence. Day 4 to Day 12.
 *
 * The fence was asked for and built, and its cost was logged the same day as
 * DINK-39: "revisit if the dink game feels hollow once there is a rally". Day 12
 * measured it instead of guessing. The rail holds a player 2.41 m from the net
 * and a paddle reaches 1.15 m, so anything landing inside 1.26 m of the net
 * cannot be played AT ALL — that is 59 per cent of the kitchen, unreturnable by
 * geometry rather than by skill. The solver's own drop target sat 2 cm inside
 * the answerable band, at full stretch, which is not a margin but an accident.
 *
 * So there was no dink rally. Every soft ball was an outright winner or a
 * scramble, and the soft exchange is the whole of doubles.
 *
 * Left as a constant rather than deleted because the zone still exists — it is
 * painted on the court, the serve may not land in it, and it is now where you
 * may not VOLLEY from, which is the real rule.
 */
export const KITCHEN_BARRIER = false;
/** Waist height, so it reads as a barrier without blocking the view. */
export const KITCHEN_BARRIER_HEIGHT = 0.5;

/**
 * How long after a volley the striker must stay out of the non-volley zone.
 *
 * The rule people actually get called for: it is not enough to be outside the
 * line when you hit it, your momentum must not carry you in afterwards. Half a
 * second is roughly the time it takes to re-establish both feet, and it is the
 * thing that stops a player volleying hard and then drifting in to cover the
 * next ball for free.
 */
export const NVZ_MOMENTUM = 0.5;

/**
 * How far from the middle of the body the paddle can meet the ball. Shoulder
 * to fingertip is around 0.7 m for an adult, the paddle adds its 0.41 m, and
 * a lunge adds a little more. Anything past this is not a stretch, it is a
 * shot the player does not get to.
 */
export const PLAYER_REACH = 1.15;
/** Comfortable fraction of that reach; past it the contact goes off-centre. */
export const PLAYER_COMFORT_REACH = 0.55;
/** Vertical window the paddle can cover at all. */
export const PLAYER_REACH_LOW = 0.05;
export const PLAYER_REACH_HIGH = 2.35;
/** Height band where contact is comfortable rather than cramped or stretched. */
export const PLAYER_STRIKE_LOW = 0.35;
export const PLAYER_STRIKE_HIGH = 1.35;

/**
 * A swing is not instant. Windup is the delay between pressing and the paddle
 * arriving; recovery is the time before another swing is possible. TUNED to
 * roughly a compact pickleball stroke, which is much shorter than a tennis
 * swing because the ball arrives so much sooner.
 */
export const SWING_WINDUP = 0.12;
export const SWING_RECOVERY = 0.2;
/** How far either side of the ideal contact moment still counts as a hit. */
export const SWING_CONTACT_WINDOW = 0.09;

// ------------------------------------------------------------- solver -----

/**
 * Default game speed, as a fraction of real time.
 *
 * Set to 0.6 after playtesting: at full speed a struck ball crosses the court
 * in about seven tenths of a second, which is accurate and unplayable. Human
 * reaction time does not scale, so slowing the whole game — ball, player and
 * swing together — is what buys a person time to read a shot. The physics is
 * untouched: the simulation still ticks in exact SIM_DT steps, it is just fed
 * less real time per second.
 *
 * The player can change it in the panel, and it does not affect the sim's
 * determinism: the same number of ticks always produces the same result.
 */
export const DEFAULT_GAME_SPEED = 0.6;

/** Simulation runs at a fixed 120 Hz; rendering interpolates between steps. */
export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;
/** Below this vertical speed a bouncing ball is treated as settled. */
export const REST_VELOCITY = 0.25;

// --------------------------------------------------- derived convenience ---

/** a_drag = DRAG_K * |v| * v */
export const DRAG_K = (0.5 * AIR_DENSITY * DRAG_COEF * BALL_AREA) / BALL_MASS;
/** a_magnus = MAGNUS_K * (omega x v), before the Cl cap is applied. */
export const MAGNUS_K =
  (0.5 * AIR_DENSITY * BALL_AREA * LIFT_SLOPE * BALL_RADIUS) / BALL_MASS;
