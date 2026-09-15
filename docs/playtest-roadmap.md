# Windows Playtest Readiness

Reviewed 2026-09-15. This is planned follow-up work, not functionality delivered by repository publication.

## Goal

Prepare a reliable Windows build for eight first-time players before changing controls, physics, or balance. Windows desktop and keyboard are the primary target. Preserve the simulation/rendering boundary.

## Review findings

- Difficulty changes mutate the live opponent but not the recorded setup. Career opponents can also be made easier during a challenge.
- Challenges inherit Watch mode; completed challenges award progress without checking human participation.
- Desktop verification targets Linux and requires xvfb. The portable Windows executable needs its own launch check.
- Clipboard denial leaves replay data in the developer console. Starting another game replaces the recording.
- Replay parsing trusts setup fields after checking version and coerces malformed swing/shape values.

## 1. Stable match configuration

- Capture difficulty when a best-of-three match starts and retain it across games. Disable changes until it ends; permit selection before the next friendly.
- Keep selected friendly difficulty separate from active career difficulty.
- Starting a career challenge switches Watch off and uses the rival's difficulty and style.
- Restart, mode changes, and Watch changes abandon a challenge without awarding progress.

Acceptance: settings cannot alter active match difficulty or invalidate its replay. Watching cannot advance a career; abandoned challenges award nothing.

## 2. Reproducible bug reports

- Retain every game recording in the current match and the last completed or abandoned match.
- Add a versioned report envelope with build information and existing version-2 game replays. Continue accepting standalone version-2 replays.
- Validate required setup fields, enums, finite axes, swing and shape values, and safe integer run counts before playback.
- Keep Copy Replay and provide selectable text when clipboard access fails.
- Add CLI file input to validate and replay submitted reports, printing results and clear rejection reasons.
- Extract match configuration and report lifecycle into small core modules for focused testing.

Acceptance: multi-game reports survive export/import, malformed reports are rejected, and clipboard denial leaves usable report text.

## 3. Windows verification

- Add `--binary <path>` to desktop verification and invoke it directly on Windows. Make Linux rendering flags opt-in.
- Verify the exact portable executable intended for testers: launch, players rendering, simulation advancing, pause/resume, saved settings and career results, and report export.
- Require typecheck, unit tests, production build, and browser interaction checks before packaging. Capture browser console errors.

Repository publication fixes browser CI paths and uses Playwright-managed Chromium. Broader legacy tooling portability remains follow-up work.

## 4. First outside sessions

- Retain current onboarding and gameplay as the baseline. Use [playtest.md](playtest.md), with build IDs and report instructions.
- Observe eight first-time players; designate three to try doubles.
- Record time to first intentional movement, first won point, blockers, and verbatim control questions.
- Fix launch/progression blockers. Require three independent reports before changing the control scheme.
- After fixes, two fresh players must reach their first won point without coaching.

## Completion boundary

Engineering ends with a verified executable and session materials. Human testing is a separate gate: eight sessions completed, blockers resolved, and two fresh players reaching their first won point unaided.

Multiplayer, new content, balance tuning, and tutorial redesign are deferred until evidence exists. Recruiting testers and distributing builds require a separate request; neither is part of publishing the repository.
