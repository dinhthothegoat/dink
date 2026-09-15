/**
 * The desktop shell. Day 21.
 *
 * This file does as little as possible on purpose. The game is the same build
 * that runs in a browser, and everything here exists to give it a window and
 * then stay out of the way. Any logic that ends up in this file is logic that
 * only runs on the desktop and is therefore only tested on the desktop, which
 * is the one place this project cannot run its test suite.
 *
 * CommonJS rather than ESM: the package is `"type": "module"`, and Electron's
 * main process only recently learned ESM. `.cjs` is the boring choice and the
 * boring choice is correct for a file that must start before anything else can.
 */

const { app, BrowserWindow, Menu, protocol, net, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { resolveAsset } = require('./resolve.cjs');

const DIST = path.join(__dirname, '..', 'dist');

/**
 * Why a custom protocol instead of just loading the file.
 *
 * Vite emits `<script type="module">`, and Chromium refuses to load an ES
 * module over file:// — origin `null` fails the CORS check, every time, on
 * every platform. This was MEASURED before the shell was written rather than
 * discovered afterwards, and the failure is the nasty kind:
 *
 *   canvas present: true
 *   debug hook:     undefined
 *   error:          blocked by CORS policy
 *
 * The canvas is in index.html, so it renders. A screenshot looks like a game
 * that has not started yet. Nothing throws. This is the exact shape of defect
 * this project has shipped six times, and it would have shipped a seventh if
 * the check had been "does a canvas exist".
 *
 * The alternative fix is `webSecurity: false`, which turns the whole shell into
 * a browser with its protections off in order to load a local script. A private
 * scheme costs fifteen lines and keeps every protection.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'dink',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/** Serve dist/, and refuse to serve anything outside it. See resolve.cjs. */
const serve = (request) => {
  const resolved = resolveAsset(DIST, request.url);
  if (!resolved.ok) return new Response(resolved.reason, { status: 403 });
  return net.fetch(pathToFileURL(resolved.file).toString());
};

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // Below 820 px the panel stacks under the court, which works but is not
    // what somebody wants on a desktop. The minimum is set where the layout
    // stops being usable at all rather than where it stops being ideal.
    minWidth: 760,
    minHeight: 540,
    backgroundColor: '#0b1219',
    title: 'Dink: Pickleball Rivals',
    // Do not show a white rectangle for half a second while Chromium boots.
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // No preload. The game asks the desktop for nothing, so there is no
      // bridge to expose and nothing to get wrong. If that changes, it changes
      // deliberately and this comment is the place the decision gets revisited.
    },
  });

  win.once('ready-to-show', () => win.show());

  /**
   * A game is not a browser.
   *
   * Nothing in the build navigates anywhere, but a shell that would follow a
   * link if one appeared is a shell one stray anchor tag away from stranding
   * the player on a web page with no back button. Both handlers below refuse,
   * and external links open in the real browser where they belong.
   */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('dink://')) event.preventDefault();
  });

  win.loadURL('dink://game/index.html');
  return win;
};

/**
 * The menu is a game menu, not an Electron one.
 *
 * The default template ships Reload, Force Reload, Toggle Developer Tools and a
 * "Learn More" link to electronjs.org. Shipping that to a player on Steam is
 * telling them what the game is made of, and Reload mid-match is a way to lose
 * a game to a keyboard shortcut.
 *
 * macOS keeps an application menu because the platform requires one for Cmd+Q
 * to exist at all. Everywhere else the menu is removed entirely and the two
 * bindings a player needs are handled below.
 */
const buildMenu = () => {
  if (process.platform !== 'darwin') return Menu.setApplicationMenu(null);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
      },
      {
        label: 'View',
        submenu: [{ role: 'togglefullscreen' }],
      },
    ]),
  );
};

app.whenReady().then(() => {
  protocol.handle('dink', serve);
  buildMenu();
  const win = createWindow();

  // F11 to fullscreen, Escape to leave it. Handled here rather than in the game
  // because a browser tab already has F11 and the game must not fight it.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'Escape' && win.isFullScreen()) {
      win.setFullScreen(false);
      event.preventDefault();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/**
 * Quit when the window closes, on every platform including macOS.
 *
 * The macOS convention is to stay alive in the dock with no windows, and that
 * convention is for documents and editors. Closing a game's window means you
 * are done playing, and a pickleball game sitting in the dock doing nothing is
 * a bug report waiting to happen.
 */
app.on('window-all-closed', () => app.quit());
