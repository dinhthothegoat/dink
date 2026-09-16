# Doubles movement reference

Reference: [Hien Truong/Quan Do vs F. Staksrud/A. Bhatia, men's doubles final](https://www.youtube.com/watch?v=TtnTn7ZSBE4).

Reviewed selected frames at two-second intervals from 0:30–0:52, 5:00–5:22, and 15:00–15:22 in browser playback. This was a visual sample, not a complete viewing or a shot-by-shot analysis of the match.

## Observations and implementation

- At 0:46–0:52, the near-side returner moves forward to join the partner at the kitchen, then reaches wide during the exchange. Dink already advances after a successful return.
- At 5:14–5:18, the near-side receiver again closes forward while the partner holds the front of the court. The pair adjusts laterally as the rally develops.
- During the sampled net exchanges, players maintain coverage alongside the player taking the ball. A fixed recovery station does not capture these adjustments.

The new change makes both doubles recovery stations shift toward the ball by the same bounded amount. The player on the ball side shades toward the sideline, while the other player closes toward the middle. Targets stay in their assigned halves, retain their separation, and keep the team's existing depth. The shot owner still intercepts the ball independently. Serve formations are unaffected because lateral shading only applies during live play.

This is a limited approximation of the observed lateral movement, not a reconstruction of the professionals' tactics. Stacking, poaching, coordinated court switches, and split-step timing remain follow-up work. This doubles video does not establish a singles policy.

## Verification and compatibility

Regression coverage checks both court orientations and score parities, half ownership, spacing, extreme ball positions, and the live rally integration. Simulation replay version is now 4 because changed AI inputs make older recordings incompatible.

The isolated publication build passes typechecking, 382 tests, and the production build. Three doubles recordings replay bit for bit. Across six seeded games per mode, doubles crowding decreased from 4.6% to 3.1%, time at the kitchen increased from 62.6% to 63.9%, and mean rally length changed from 6.50 to 6.67 contacts. Singles mean rally length stayed at 3.64. This small sample checks for regressions; it does not establish competitive balance or human play quality.
