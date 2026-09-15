# ADR-0006: Electron for the desktop shell

Day 21. Accepted.

## Context

Nobody outside this repository has played the game, and the Day 23 playtest
needs eight to ten people who will not open a terminal. That means a file they
double-click, on the machines they own, which in practice means Windows first
and macOS second.

The game is a Vite build: one HTML file and one JavaScript bundle that already
runs in a browser. The question is only what wraps it.

## The options

**A plain browser build, hosted.** Send people a link. Costs nothing, works
today, and it is what the published artifact already is.
*Against:* it is not what Steam sells, it cannot be the Day 28 depot, and a
playtest on a hosted page measures a different product from the one being built.
It also loses the thing a packaged build buys on Day 23: a known version on a
known machine, rather than whatever that person's browser did.

**Tauri.** Ships a ~10 MB binary instead of ~120 MB, because it uses the
operating system's own webview rather than bundling a browser.
*Against:* and that is exactly the problem. The system webview is WKWebView on
macOS, WebView2 on Windows, and WebKitGTK on Linux, each with its own WebGL
quirks and its own driver blocklist. A 3D game that renders differently on three
platforms is three games to debug, and the whole point of a desktop build is to
remove variables from a playtest rather than add them. Tauri also needs a Rust
toolchain, which is a second language in the build for a shell that does almost
nothing.

**Electron.** Bundles a known Chromium.
*Against:* 120 MB for a 578 KB game, which is an absurd ratio and is the honest
cost. It is also a bigger attack surface, which the shell has to actively close
rather than assume.

## Decision

Electron.

The deciding argument is not familiarity, it is **one renderer**. Three.js
against a pinned Chromium behaves the same on every machine a build is handed
to, and when a playtester says the court looks wrong, that is a bug in the game
rather than a question about their webview version. Day 23 exists to buy
information, and a shell that adds variance is a shell that makes the
information worse.

The size is accepted and not defended. 120 MB is what a known browser costs, it
is unremarkable for a Steam download, and the alternative was to pay in
debugging instead.

## Consequences

**The game loads over a private `dink://` scheme, not `file://`.** This is not
a preference. Chromium refuses to load an ES module from origin `null`, so the
Vite build over `file://` leaves a canvas on screen and a game that never
started, with nothing thrown. Measured before the shell was written. The usual
workaround is `webSecurity: false`, which disables the protections of the whole
window in order to load a local script; a registered scheme costs fifteen lines
and keeps them. The resolver is a separate pure module so the traversal guard
can be tested.

**The shell has no preload and no IPC bridge.** The game asks the desktop for
nothing, so there is nothing to expose. `contextIsolation` on, `nodeIntegration`
off, `sandbox` on. If any of that has to change, it changes deliberately.

**Navigation is refused.** `will-navigate` and `setWindowOpenHandler` both deny.
A game is not a browser, and a shell that would follow a link is one stray
anchor away from stranding a player on a web page with no back button.

**The default menu is removed.** It ships Reload, Force Reload, Toggle
Developer Tools and a link to electronjs.org. macOS keeps a minimal application
menu because the platform requires one for Cmd+Q to exist.

**`three` moved to devDependencies.** electron-builder ships everything in
`dependencies` regardless of the `files` allowlist, and Vite already bundles
Three.js into the game. It was being shipped twice: 16 MB of asar against 588 KB
once the duplicate was removed, with the packaged app still booting, ticking and
drawing. Anything the renderer imports belongs in devDependencies while the
bundler is doing its job.

**Verification runs against the packaged binary, not `electron .`.** Running the
shell against the source tree loads different files from a different root and
proves nothing about what a player downloads. `npm run desktop:verify` launches
the built executable and drives it over the DevTools protocol.

**What that verification may not assert.** Not "a file was produced", not "a
window opened", and not a screenshot — the CORS failure above satisfies all
three. It presses Play, serves from the keyboard and watches the tick advance.
It uses the keyboard rather than the mouse deliberately: synthetic clicks are
hit-tested against the last composited frame, this container composites about
twice a second, and a click-driven version of this check passed one run in
three. `tools/play.mjs` tests the mouse in a browser at a real frame rate, which
is where a mouse test belongs.

**Signing is deferred.** The macOS builds are unsigned, so Gatekeeper will
require right-click then Open, and Windows will show a SmartScreen warning.
Acceptable for a playtest with people who are told; not acceptable for Steam,
and it is Day 28's problem.
