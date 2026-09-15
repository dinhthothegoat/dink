# AI positioning update

2026-09-15. Addresses idle-looking AI, passive singles play, incorrect doubles formations, and servers standing inside the baseline.

## Behaviour changes

- Servers stand 0.6 m behind the baseline, keeping their feet and the held ball outside it. This applies to both ends, server slots, and score parities.
- In doubles, both serving players start back. The receiver starts behind the opposite baseline and their partner starts at the non-volley line.
- Receiver assignment now converts world left/right into the receiving team's own left/right. Previously the far-side pair started in halves that disagreed with their recovery stations.
- AI recovers immediately after its own shot and continues recovering while reading an opponent's shot, rather than stopping on every hit.
- Successful returns and comfortable singles approach shots set a net approach. Doubles pairs follow drops only after contact, not when a swing begins.
- A bounced ball remains eligible for a kitchen pickup; prediction no longer forgets a bounce that already happened.
- Middle-ball conventions yield to the partner when the preferred player is substantially farther away. Legal server/receiver assignments still override coverage choices.
- AI shot selection uses the actual contact comfort model. Comfortable net exchanges can be sped up after six contacts; low or stretched balls still get a soft response.

## Verification

Six seeded games per mode at Steady, with the starting server alternating, measured using `npm run doubles`:

| Metric | Before | After |
| --- | ---: | ---: |
| Singles mean shots per rally | 3.37 | 3.64 |
| Singles longest rally | 8 | 9 |
| Doubles mean shots per rally | 4.32 | 6.50 |
| Doubles time at the net | 39.6% | 62.6% |
| Doubles lateral separation | 2.56 m | 2.77 m |
| Doubles depth gap | 1.18 m | 0.65 m |
| Doubles crowding | 4.5% | 4.6% |

These are small deterministic samples, not proof of competitive balance or human enjoyment. Regression tests cover formations, both court orientations, continuous recovery, bounce handling, actual-contact approaches, and middle-ball coverage. Full games remain covered by the existing rally and team tests.

Typecheck, all 378 unit tests, the production build, and the browser playtest pass. Three doubles recordings replay bit for bit. A three-match-per-level club stand-in won 97%, 67%, and 57% of rallies against Easy, Steady, and Tough respectively; difficulty remains ordered, but the older balance calibration should not be assumed to carry over.

## Replay compatibility

Replay version changes from 2 to 3. The input-row format is unchanged, but the same old inputs would produce a different game after the AI and serve changes. Old simulation versions are intentionally rejected.
