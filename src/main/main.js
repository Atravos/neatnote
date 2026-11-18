const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, screen, session, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const fileSystem = require('./fileSystem');
const { SortOrders } = require('./sortOrders');
const { setupIpcHandlers } = require('./ipcHandlers');
const { buildMenuTemplate } = require('./menu');
const { toSafeExternalUrl } = require('./security');
const { createUpdater } = require('./updater');

// Debug logging — enable by launching with NEATNOTE_DEBUG=1
const DEBUG = process.env.NEATNOTE_DEBUG === '1';
function debugLog(...args) {
  if (DEBUG) console.log('[main]', ...args);
}

// Developer conveniences (reload, DevTools) exist only when running from
// source or with NEATNOTE_DEBUG=1 — never in an installed build.
const isDev = !app.isPackaged || DEBUG;
const isMac = process.platform === 'darwin';

const INDEX_HTML = path.join(__dirname, '../../index.html');
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// ---- Single instance ---------------------------------------------------------
// Two running copies would each auto-save over the other's notes and
// config.json. A second launch just brings the existing window forward.
// (NEATNOTE_ALLOW_MULTIPLE=1 is an escape hatch for automated tests.)
const allowMultiple = process.env.NEATNOTE_ALLOW_MULTIPLE === '1';
const hasInstanceLock = allowMultiple || app.requestSingleInstanceLock();
if (!hasInstanceLock) {
  app.quit();
}

// Shows up as the app's identity for taskbar grouping/pinning on Windows;
// must match build.appId in package.json
if (process.platform === 'win32') {
  app.setAppUserModelId('com.neatnote.app');
}

// ---- Spell check dictionaries --------------------------------------------------

/**
 * Put the bundled spell-check dictionaries where Chromium looks for them
 * (<userData>/Dictionaries) so spell check works without any download.
 * Files already present are left alone. macOS uses the system spell
 * checker and needs none of this.
 *
 * Timing matters: the spell checker goes looking for its dictionary the
 * moment the browser session first exists, and if the file is not there
 * yet it gives up for the whole run. So this is called at startup, before
 * the app is "ready" and before anything can touch `session`.
 * @param {string} userDataPath
 */
function seedSpellcheckDictionaries(userDataPath) {
  if (isMac) return;
  try {
    const sourceDir = path.join(__dirname, '../../vendor/dictionaries');
    const targetDir = path.join(userDataPath, 'Dictionaries');

    // Synchronous on purpose: these calls work inside the packaged app
    // archive, the files are small, and it only does real work on the
    // first launch (or the first launch after an update adds a file).
    const names = fs.readdirSync(sourceDir).filter(name => name.endsWith('.bdic'));
    if (names.length === 0) return;

    fs.mkdirSync(targetDir, { recursive: true });
    for (const name of names) {
      const target = path.join(targetDir, name);
      if (fs.existsSync(target)) continue;
      // Write to a temp name and rename, so a crash can't leave a
      // truncated dictionary behind under the real name
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, fs.readFileSync(path.join(sourceDir, name)));
      fs.renameSync(tmp, target);
      debugLog('Installed spell check dictionary', name);
    }
  } catch (error) {
    // Spell check is a convenience; never let it stop the app from starting
    console.error('Could not set up spell check dictionaries:', error.message);
  }
}

if (hasInstanceLock) {
  seedSpellcheckDictionaries(app.getPath('userData'));
}

let store = null;
let mainWindow = null;
let updater = null;
let rendererReady = false;
// True once quitting has been approved; lets windows close unchallenged
let isQuitting = false;
// A close/quit confirmation (flush + possible dialog) is in progress
let closeInProgress = false;

// ---- External links ----------------------------------------------------------

/**
 * Open a URL in the user's default browser / mail client. Only web and
 * mail links are ever handed to the OS — nothing else a note could
 * contain (file:, custom app protocols, ...) gets through.
 * @param {string} url
 */
function openExternalSafe(url) {
  const safeUrl = toSafeExternalUrl(url);
  if (!safeUrl) return;
  shell.openExternal(safeUrl).catch((err) => {
    console.error('Failed to open external URL:', err.message);
  });
}

// ---- Global web-contents hardening ------------------------------------------
// Applies to every WebContents the app ever creates, not just the main
// window, so nothing can be created that escapes these rules.
app.on('web-contents-created', (event, contents) => {
  // <webview> is never used
  contents.on('will-attach-webview', (e) => e.preventDefault());

  if (contents.getType() !== 'window') return;

  // Notes are HTML files and the editor renders links, so the renderer must
  // never be allowed to navigate away from the app or spawn child windows
  // (a child window would inherit our webPreferences, including the
  // privileged preload). Web/mail links open in the OS browser instead;
  // everything else is denied outright.
  contents.on('will-navigate', (e, url) => {
    e.preventDefault();
    openExternalSafe(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
});

/**
 * Lock down the session the app's pages run in: NeatNote is local-first,
 * so no request from its own content is ever allowed. (The only network
 * use, checking for updates, runs from the main process in a separate
 * session — see updater.js.)
 */
function hardenSession() {
  const ses = session.defaultSession;

  // No web permission is ever needed (camera, mic, geolocation,
  // notifications, ...)
  ses.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);

  // Block every outbound request from the app's web content. The UI is
  // loaded from local files, so this only ever stops things that should
  // not happen (e.g. a pasted remote image, on top of the page's CSP).
  ses.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => callback({ cancel: true })
  );

  // On Windows/Linux Chromium's spell checker would otherwise download its
  // Hunspell dictionary from a Google-hosted server on first run. Point
  // the downloader at nothing; the dictionaries the app needs are bundled
  // and were put in place by seedSpellcheckDictionaries() at startup.
  try {
    ses.setSpellCheckerDictionaryDownloadURL('http://127.0.0.1:9/');
  } catch (error) {
    debugLog('Could not override the dictionary download URL:', error.message);
  }

  if (DEBUG) {
    ses.on('spellcheck-dictionary-initialized', (event, language) => {
      debugLog('Spell check dictionary ready:', language);
    });
    ses.on('spellcheck-dictionary-download-failure', (event, language) => {
      debugLog(`No bundled spell check dictionary for "${language}" (see vendor/dictionaries/README.md)`);
    });
  }
}

// ---- IPC sender validation -----------------------------------------------------

/**
 * Whether an IPC message really comes from the app's own page: the top
 * frame of the main window, loaded from a local file. Navigation and
 * frames are blocked above, so this is always the case in practice — the
 * check is what makes that an enforced guarantee instead of an assumption.
 * @param {Electron.IpcMainEvent|Electron.IpcMainInvokeEvent} event
 * @returns {boolean}
 */
function isTrustedSender(event) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const contents = mainWindow.webContents;
    if (event.sender !== contents) return false;
    const frame = event.senderFrame;
    if (!frame || frame !== contents.mainFrame) return false;
    return new URL(frame.url).protocol === 'file:';
  } catch (error) {
    return false;
  }
}

/** Register a one-way IPC listener that ignores untrusted senders. */
function onTrusted(channel, listener) {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedSender(event)) return;
    listener(event, ...args);
  });
}

// ---- Window state ------------------------------------------------------------

const DEFAULT_BOUNDS = { width: 1000, height: 700 };

/**
 * Bounds to open the window with: the last saved ones if they are still
 * (mostly) on a connected display, otherwise the defaults.
 * @returns {{width: number, height: number, x?: number, y?: number, isMaximized: boolean}}
 */
function loadWindowState() {
  const fallback = { ...DEFAULT_BOUNDS, isMaximized: false };
  try {
    const saved = store.get('windowState');
    if (!saved || typeof saved !== 'object') return fallback;
    const { x, y, width, height } = saved;
    if (![width, height].every(n => Number.isFinite(n) && n >= 200 && n <= 20000)) return fallback;

    // Never open larger than the screen (e.g. after switching to a smaller
    // or lower-resolution display)
    const area = screen.getPrimaryDisplay().workAreaSize;
    const state = {
      width: Math.round(Math.min(width, Math.max(640, area.width))),
      height: Math.round(Math.min(height, Math.max(440, area.height))),
      isMaximized: !!saved.isMaximized
    };
    if (Number.isFinite(x) && Number.isFinite(y)) {
      // Only reuse the position if a reasonable part of the window would
      // land on a display that is still connected
      const visible = screen.getAllDisplays().some(({ workArea }) => {
        const overlapX = Math.min(x + width, workArea.x + workArea.width) - Math.max(x, workArea.x);
        const overlapY = Math.min(y + height, workArea.y + workArea.height) - Math.max(y, workArea.y);
        return overlapX >= 120 && overlapY >= 80;
      });
      if (visible) {
        state.x = Math.round(x);
        state.y = Math.round(y);
      }
    }
    return state;
  } catch (error) {
    return fallback;
  }
}

function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    store.set('windowState', { ...win.getNormalBounds(), isMaximized: win.isMaximized() });
  } catch (error) {
    debugLog('Could not save window state:', error.message);
  }
}

// ---- Application menu ----------------------------------------------------------

/** Ask the renderer to perform an action chosen from the native menu. */
function sendMenuAction(action) {
  if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
    mainWindow.webContents.send('menu-action', action);
  }
}

/**
 * Replace Electron's default menu (see menu.js for why).
 */
function buildApplicationMenu() {
  const template = buildMenuTemplate({
    isMac,
    isDev,
    sendAction: sendMenuAction,
    checkForUpdates: () => { checkForUpdatesFromMenu(); }
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * NeatNote > Check for Updates… (macOS menu bar). Settings shows the
 * result inline; from the menu there is nowhere to show it but a dialog.
 */
async function checkForUpdatesFromMenu() {
  if (!updater) return;
  const result = await updater.check({ manual: true });
  let options = null;
  if (result.status === 'up-to-date') {
    options = {
      type: 'info',
      message: "You're up to date",
      detail: `NeatNote ${result.current} is the newest version.`
    };
  } else if (result.status === 'error') {
    options = { type: 'warning', message: "Couldn't check for updates", detail: result.message };
  } else if (result.status === 'busy') {
    options = { type: 'info', message: 'Already checking for updates', detail: 'Give it a moment.' };
  }
  if (!options) return;
  const parent = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
  const full = { title: 'Check for Updates', buttons: ['OK'], noLink: true, ...options };
  try {
    await (parent ? dialog.showMessageBox(parent, full) : dialog.showMessageBox(full));
  } catch (error) {
    console.error('Could not show the update result:', error.message);
  }
}

/**
 * Native right-click menu for text: spelling suggestions, link actions,
 * and cut / copy / paste. (The sidebar draws its own menu in the renderer
 * and cancels this event.)
 */
function attachContextMenu(win) {
  const contents = win.webContents;
  contents.on('context-menu', (event, params) => {
    const items = [];

    if (params.isEditable && params.misspelledWord) {
      const suggestions = Array.isArray(params.dictionarySuggestions) ? params.dictionarySuggestions : [];
      for (const suggestion of suggestions.slice(0, 6)) {
        items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) });
      }
      if (suggestions.length === 0) {
        items.push({ label: 'No spelling suggestions', enabled: false });
      }
      items.push({
        label: 'Add to Dictionary',
        click: () => contents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      });
      items.push({ type: 'separator' });
    }

    if (toSafeExternalUrl(params.linkURL)) {
      items.push({ label: 'Open Link', click: () => openExternalSafe(params.linkURL) });
      items.push({
        label: 'Copy Link Address',
        click: () => {
          // clipboard.writeText is synchronous in older Electron and
          // returns a Promise in newer ones — handle both
          Promise.resolve()
            .then(() => clipboard.writeText(params.linkURL))
            .catch((err) => console.error('Could not copy link:', err.message));
        }
      });
      items.push({ type: 'separator' });
    }

    if (params.isEditable) {
      const flags = params.editFlags || {};
      items.push(
        { role: 'cut', enabled: !!flags.canCut },
        { role: 'copy', enabled: !!flags.canCopy },
        { role: 'paste', enabled: !!flags.canPaste },
        { role: 'pasteAndMatchStyle', enabled: !!flags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: !!flags.canSelectAll }
      );
    } else if (params.selectionText && params.selectionText.trim()) {
      items.push({ role: 'copy' });
    }

    // Drop a trailing separator, and show nothing if there is nothing to offer
    while (items.length && items[items.length - 1].type === 'separator') items.pop();
    if (items.length === 0) return;

    Menu.buildFromTemplate(items).popup({ window: win });
  });
}

// ---- Saving before close / quit ------------------------------------------------

let flushSequence = 0;

/**
 * Ask the renderer to write any pending (debounced) edits to disk.
 * @param {BrowserWindow} win
 * @returns {Promise<{ok: boolean, timedOut: boolean}>} `ok` is false only
 *          when the renderer reported that a save FAILED. A renderer that
 *          is gone, not loaded yet, or does not answer in time resolves as
 *          ok — nothing more can be done for it, and it must never be able
 *          to block shutdown.
 */
function flushRendererSaves(win) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed() ||
        win.webContents.isCrashed() || !rendererReady) {
      resolve({ ok: true, timedOut: true });
      return;
    }

    const id = ++flushSequence;
    let timer = null;

    const finish = (result) => {
      clearTimeout(timer);
      ipcMain.removeListener('pending-saves-flushed', onAck);
      resolve(result);
    };
    const onAck = (event, ackId, ok) => {
      if (ackId !== id || !isTrustedSender(event)) return;
      debugLog('Renderer finished flushing; ok =', ok);
      finish({ ok: ok !== false, timedOut: false });
    };

    timer = setTimeout(() => {
      debugLog('Flush acknowledgement timed out; continuing');
      finish({ ok: true, timedOut: true });
    }, 5000);

    ipcMain.on('pending-saves-flushed', onAck);
    win.webContents.send('flush-pending-saves', id);
  });
}

/**
 * Everything that must happen before a window is destroyed: flush pending
 * edits, give the user a way back if that flush failed, and wait for any
 * write still in flight in this process.
 * @param {BrowserWindow} win
 * @returns {Promise<boolean>} Whether closing may go ahead
 */
async function confirmSafeToClose(win) {
  const flush = await flushRendererSaves(win);

  if (!flush.ok && win && !win.isDestroyed()) {
    // Closing now would silently discard the user's latest edits.
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      title: 'NeatNote',
      message: 'Your latest changes could not be saved.',
      detail: 'If you close now, the most recent edits to the open note will be lost. ' +
        'Go back to copy your text somewhere safe or try saving again.',
      buttons: ['Go Back', 'Close Without Saving'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (choice === 0) return false;
  }

  await fileSystem.whenIdle(8000);
  return true;
}

// ---- Main window ---------------------------------------------------------------

/**
 * Create the main application window
 */
function createWindow() {
  // Use the last theme's background so a dark-theme user doesn't get a
  // white flash before the renderer paints (persisted via 'theme-bg-changed')
  let startBackground = '#ffffff';
  try {
    const saved = store.get('themeBackground');
    if (typeof saved === 'string' && HEX_COLOR.test(saved)) {
      startBackground = saved;
    }
  } catch (error) {
    // Fall back to white
  }

  // Platform-adaptive chrome:
  //   - macOS: native traffic lights over our custom titlebar
  //     (titleBarStyle 'hidden' keeps the real close/minimize/zoom buttons,
  //     so fullscreen, option-click zoom, and window tiling all behave
  //     natively; the renderer draws no imitation controls on mac)
  //   - Windows/Linux: fully frameless; the renderer draws caption buttons
  //     (see src/renderer/components/titlebar.js)
  const chromeOptions = isMac
    ? {
        titleBarStyle: 'hidden',
        // Center the traffic lights vertically in the 40px custom titlebar
        trafficLightPosition: { x: 14, y: 13 }
      }
    : { frame: false };

  const state = loadWindowState();
  const bounds = { width: state.width, height: state.height };
  if (state.x !== undefined) {
    bounds.x = state.x;
    bounds.y = state.y;
  }

  rendererReady = false;
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 640,
    minHeight: 440,
    ...chromeOptions,
    // Shown once the first frame is painted, so the window never appears
    // half-drawn or in the wrong theme
    show: false,
    backgroundColor: startBackground,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: true,
      devTools: isDev
    }
  });
  mainWindow = win;

  let shown = false;
  const reveal = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    if (state.isMaximized) win.maximize();
    win.show();
  };
  win.once('ready-to-show', reveal);
  // Safety net: never leave the app running with an invisible window
  const revealTimer = setTimeout(reveal, 3000);

  win.webContents.on('did-finish-load', () => {
    rendererReady = true;
  });

  // A crashed renderer leaves a blank window; offer a way out. Everything
  // typed up to ~1s before the crash has already been auto-saved.
  win.webContents.on('render-process-gone', (event, details) => {
    rendererReady = false;
    if (details.reason === 'clean-exit' || isQuitting || win.isDestroyed()) return;
    console.error('Renderer process gone:', details.reason);
    const choice = dialog.showMessageBoxSync(win, {
      type: 'error',
      title: 'NeatNote',
      message: 'NeatNote ran into a problem and needs to reload.',
      detail: 'Your notes are saved automatically as you type.',
      buttons: ['Reload', 'Quit'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (choice === 0) {
      win.webContents.reload();
    } else {
      isQuitting = true;
      app.quit();
    }
  });

  attachContextMenu(win);

  win.loadFile(INDEX_HTML);

  // ---- Flush-before-close ---------------------------------------------------
  // Intercept the window close (the X button / custom close control — the
  // normal exit path on Windows and Linux) so pending debounced auto-saves
  // are written while the renderer is still alive, and so a failed save
  // gets a "go back" prompt instead of silent data loss.
  let closeApproved = false;
  win.on('close', (event) => {
    if (isQuitting || closeApproved) return;
    event.preventDefault();
    if (closeInProgress) return;
    closeInProgress = true;
    debugLog('Close intercepted; flushing pending saves...');
    saveWindowState(win);

    confirmSafeToClose(win)
      .catch((error) => {
        console.error('Error preparing to close:', error.message);
        return true;
      })
      .then((ok) => {
        closeInProgress = false;
        if (!ok || win.isDestroyed()) return;
        closeApproved = true;
        win.close();
      });
  });

  // Windows is shutting down, restarting, or logging the user off: write
  // pending edits right away, without waiting to be asked to close. (Not
  // delayed with preventDefault — the write takes milliseconds, and
  // blocking a shutdown is worse than the at-most-one-second it protects.)
  win.on('query-session-end', () => {
    flushRendererSaves(win).catch(() => {});
  });

  // Remember size/position (debounced — these fire continuously while dragging)
  let stateTimer = null;
  const scheduleStateSave = () => {
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => saveWindowState(win), 400);
  };
  win.on('resize', scheduleStateSave);
  win.on('move', scheduleStateSave);

  // Keep the renderer's maximize/restore button in sync
  const sendMaximized = (isMaximized) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('window-maximized-changed', isMaximized);
    }
    scheduleStateSave();
  };
  win.on('maximize', () => sendMaximized(true));
  win.on('unmaximize', () => sendMaximized(false));

  win.on('closed', () => {
    clearTimeout(stateTimer);
    clearTimeout(revealTimer);
    if (mainWindow === win) {
      mainWindow = null;
      rendererReady = false;
    }
  });
}

// ---- Window control IPC (custom titlebar) ----------------------------------

onTrusted('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

onTrusted('window-maximize-toggle', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

onTrusted('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('window-is-maximized', (event) => {
  if (!isTrustedSender(event) || !mainWindow) return false;
  return mainWindow.isMaximized();
});

// The theme's background color as last saved (null if none). The renderer
// uses it to recover the theme if its own copy of the preference is gone.
ipcMain.handle('get-theme-background', (event) => {
  if (!isTrustedSender(event) || !store) return null;
  try {
    const saved = store.get('themeBackground');
    return typeof saved === 'string' && HEX_COLOR.test(saved) ? saved : null;
  } catch (error) {
    return null;
  }
});

// Remember the active theme's background color for the next launch
// (avoids the white flash before the renderer paints on dark themes)
onTrusted('theme-bg-changed', (event, color) => {
  if (typeof color === 'string' && HEX_COLOR.test(color)) {
    try {
      store.set('themeBackground', color);
      if (mainWindow) mainWindow.setBackgroundColor(color);
    } catch (error) {
      console.error('Error saving theme background:', error.message);
    }
  }
});

// ---- Updates ---------------------------------------------------------------------

ipcMain.handle('updates-get-state', (event) => {
  if (!isTrustedSender(event) || !updater) return null;
  return updater.getState();
});

ipcMain.handle('updates-set-auto-check', (event, enabled) => {
  if (!isTrustedSender(event) || !updater || typeof enabled !== 'boolean') return { success: false };
  try {
    updater.setAutoCheckEnabled(enabled);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('updates-check-now', async (event) => {
  if (!isTrustedSender(event) || !updater) return { status: 'error', message: 'Unavailable' };
  return updater.check({ manual: true });
});

ipcMain.handle('updates-install-now', async (event) => {
  if (!isTrustedSender(event) || !updater) return { success: false, error: 'Unavailable' };
  return updater.installNow();
});

// ---- Startup -------------------------------------------------------------------

/**
 * One-off housekeeping that must not delay the window: migrate saved
 * sidebar orders to the current format and sweep temp files left behind
 * by an interrupted save.
 * @param {string} userDataPath
 * @param {SortOrders} sortOrders
 * @returns {Promise<void>} Never rejects
 */
async function runStartupMaintenance(userDataPath, sortOrders) {
  try {
    if (!store.has('sortOrders')) {
      const dirs = await fileSystem.listAllDirs(userDataPath);
      if (sortOrders.migrateLegacy(dirs)) debugLog('Migrated saved sidebar orders');
    }
  } catch (error) {
    console.error('Sort-order migration failed:', error.message);
  }

  // Deliberately not awaited: nothing depends on it
  fileSystem.cleanupTempFiles(userDataPath)
    .then((removed) => { if (removed) debugLog(`Removed ${removed} stale temp file(s)`); })
    .catch((error) => console.error('Temp file cleanup failed:', error.message));
}

if (hasInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    // Created here (not at module load) so a second instance that is about
    // to exit never touches config.json
    store = new Store();

    const userDataPath = app.getPath('userData');
    const sortOrders = new SortOrders(store, fileSystem.getNotesRoot(userDataPath));

    hardenSession();
    updater = createUpdater({
      store,
      getMainWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
      debugLog
    });
    buildApplicationMenu();

    setupIpcHandlers({
      userDataPath,
      store,
      sortOrders,
      isTrustedSender,
      getMainWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
      ready: runStartupMaintenance(userDataPath, sortOrders)
    });

    createWindow();
    updater.scheduleStartupCheck();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

// Handle app quitting (Cmd+Q, OS shutdown, app.quit()) — flush pending
// saves first, exactly like closing the window
app.on('before-quit', (event) => {
  if (isQuitting) return;

  const win = mainWindow;
  if (!win || win.isDestroyed()) {
    // No window left to flush (the close path already did it)
    isQuitting = true;
    return;
  }

  event.preventDefault();
  if (closeInProgress) return;
  closeInProgress = true;
  debugLog('Quit requested; flushing pending saves...');
  saveWindowState(win);

  confirmSafeToClose(win)
    .catch((error) => {
      console.error('Error preparing to quit:', error.message);
      return true;
    })
    .then((ok) => {
      closeInProgress = false;
      if (!ok) return; // the user chose to go back
      isQuitting = true;
      app.quit();
    });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit();
  }
});

// ---- Uninstall (Windows) -----------------------------------------------------

/**
 * Find the NSIS uninstaller executable for this application.
 * electron-builder's NSIS installer writes the uninstaller path into the
 * registry and also places it in the installation directory.
 */
function findUninstallerPath() {
  if (process.platform !== 'win32') return null;

  // The app is typically installed to a directory like:
  //   C:\Users\<user>\AppData\Local\Programs\NeatNote\
  // The uninstaller lives in that same directory.
  const installDir = path.dirname(app.getPath('exe'));
  const uninstallerPath = path.join(installDir, 'Uninstall NeatNote.exe');

  if (fs.existsSync(uninstallerPath)) {
    return uninstallerPath;
  }

  // Fallback: look for any Uninstall*.exe in the install directory
  try {
    const files = fs.readdirSync(installDir);
    const uninstaller = files.find(f => f.toLowerCase().startsWith('uninstall') && f.toLowerCase().endsWith('.exe'));
    if (uninstaller) {
      return path.join(installDir, uninstaller);
    }
  } catch (err) {
    console.error('Error searching for uninstaller:', err.message);
  }

  return null;
}

// Whether the in-app uninstall button makes sense: only for an installed
// Windows build. Running from source (`npm start`) or from an unpacked
// folder there is nothing to uninstall.
ipcMain.handle('can-uninstall', (event) => {
  if (!isTrustedSender(event)) return false;
  return process.platform === 'win32' && app.isPackaged && findUninstallerPath() !== null;
});

// Handle uninstall request from renderer
ipcMain.handle('uninstall-app', async (event) => {
  if (!isTrustedSender(event)) return { success: false, error: 'Unauthorized' };

  if (process.platform !== 'win32') {
    return { success: false, error: 'Uninstalling from inside the app is only available on Windows.' };
  }

  // Parent the dialog to the main window so it's modal and can't be lost
  // behind it; fall back to an unparented dialog if the window is gone.
  const parent = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
  const show = (options) => (parent && !parent.isDestroyed())
    ? dialog.showMessageBox(parent, options)
    : dialog.showMessageBox(options);

  const { response } = await show({
    type: 'warning',
    title: 'Uninstall NeatNote',
    message: 'Are you sure you want to uninstall NeatNote?',
    detail: 'This will remove the application, but your notes will remain on your computer.',
    buttons: ['Cancel', 'Uninstall'],
    defaultId: 0,
    cancelId: 0,
    noLink: true
  });

  if (response !== 1) {
    return { success: false, cancelled: true };
  }

  try {
    const uninstallerPath = findUninstallerPath();
    if (!uninstallerPath) {
      // Couldn't find the uninstaller — direct user to Settings > Apps
      await show({
        type: 'info',
        title: 'Uninstall NeatNote',
        message: 'Please uninstall NeatNote through Windows Settings.',
        detail: 'Go to Settings > Apps > Installed apps, find NeatNote, and click Uninstall.'
      });
      return { success: false, error: 'Uninstaller not found' };
    }

    // Launch the NSIS uninstaller through the shell (no `_?=`): it copies
    // itself to a temp location, which lets it delete its own executable
    // and the install directory. Going through the shell — rather than
    // spawning it directly — lets Windows show its elevation prompt for
    // per-machine installs, and reports a failure to launch as a value
    // instead of an unhandled error.
    const launchError = await shell.openPath(uninstallerPath);
    if (launchError) {
      console.error('Could not start the uninstaller:', launchError);
      return { success: false, error: launchError };
    }

    // Give the uninstaller a moment to start, then quit through the normal
    // path (which saves pending edits) so we don't hold file locks.
    setTimeout(() => app.quit(), 500);
    return { success: true };
  } catch (error) {
    console.error('Error initiating uninstall:', error.message);
    return { success: false, error: error.message };
  }
});
