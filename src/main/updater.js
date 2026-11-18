/**
 * Update checking — the Electron side (dialogs, network, installing).
 * The pure logic it relies on is in updates.js.
 *
 * Network: every other part of the app runs in a session that blocks all
 * outbound requests (see hardenSession in main.js). Update checks use a
 * separate, in-memory session that is only ever used from here, so that
 * block stays in force for the app's own pages.
 *
 * Consent: NeatNote connects to nothing until the user allows it. The first
 * time an installed build starts, it asks once whether to check for
 * updates automatically. Until that is answered "yes", the only way a
 * request is made is the user pressing "Check for updates" themselves.
 */

const { app, dialog, session, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const updates = require('./updates');

const AUTO_CHECK_KEY = 'updates.autoCheck';
const SKIPPED_VERSION_KEY = 'updates.skippedVersion';
const STARTUP_CHECK_DELAY_MS = 8000;
const CONSENT_PROMPT_DELAY_MS = 2500;
const REQUEST_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

// Tests replace the network with a fake fetch (see setFetchImplementation)
let fetchOverride = null;

/** For tests: route all update requests to `fn` instead of the network. */
function setFetchImplementation(fn) {
  fetchOverride = typeof fn === 'function' ? fn : null;
}

/**
 * @param {Object} deps
 * @param {Object} deps.store - electron-store instance
 * @param {Function} deps.getMainWindow - () => BrowserWindow|null
 * @param {Function} [deps.debugLog]
 */
let lastCreated = null;

/** For tests: the updater main.js created. */
function getUpdaterForTests() {
  return lastCreated;
}

function createUpdater(deps) {
  lastCreated = buildUpdater(deps);
  return lastCreated;
}

function buildUpdater({ store, getMainWindow, debugLog = () => {} }) {
  let updateSession = null;
  let busy = false;
  let pendingInstaller = null; // { version, filePath } once downloaded

  // ---- Settings -------------------------------------------------------------

  /**
   * @returns {boolean|null} true/false once the user has chosen, null if
   *          they have not been asked yet (which means: don't check)
   */
  function autoCheckChoice() {
    try {
      const value = store.get(AUTO_CHECK_KEY);
      return typeof value === 'boolean' ? value : null;
    } catch {
      return null;
    }
  }

  function setAutoCheckEnabled(enabled) {
    store.set(AUTO_CHECK_KEY, enabled === true);
  }

  /**
   * The running version. NEATNOTE_UPDATE_TEST_VERSION pretends to be an
   * older version so the whole update flow can be tried against the real
   * latest release.
   */
  function currentVersion() {
    const override = process.env.NEATNOTE_UPDATE_TEST_VERSION;
    return updates.parseVersion(override) ? override.replace(/^v/, '') : app.getVersion();
  }

  // ---- Network ----------------------------------------------------------------

  function getSession() {
    if (!updateSession) {
      // No "persist:" prefix: nothing from these requests is written to disk
      updateSession = session.fromPartition('neatnote-updates', { cache: false });
      updateSession.setPermissionRequestHandler((webContents, permission, callback) => callback(false));
      updateSession.setPermissionCheckHandler(() => false);
      updateSession.setUserAgent(`NeatNote/${app.getVersion()}`);
    }
    return updateSession;
  }

  function doFetch(url, init) {
    if (fetchOverride) return fetchOverride(url, init);
    return getSession().fetch(url, init);
  }

  /**
   * @returns {Promise<Object|null>} The latest release (parseRelease shape),
   *          or null if the repository has no usable release
   */
  async function fetchLatestRelease() {
    let response;
    try {
      response = await doFetch(updates.LATEST_RELEASE_API, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
    } catch (error) {
      debugLog('Update check request failed:', error.message);
      throw new Error("Couldn't reach GitHub. Check your internet connection.");
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub answered with an error (${response.status}). Try again later.`);
    let json;
    try {
      json = await response.json();
    } catch {
      throw new Error('GitHub sent an unreadable answer. Try again later.');
    }
    return updates.parseRelease(json);
  }

  // ---- Talking to the user ----------------------------------------------------

  function sendStatus(status) {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('update-status', status);
  }

  function setTaskbarProgress(fraction) {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) win.setProgressBar(fraction);
  }

  function showMessage(options) {
    const win = getMainWindow();
    return win && !win.isDestroyed()
      ? dialog.showMessageBox(win, options)
      : dialog.showMessageBox(options);
  }

  // ---- Checking ---------------------------------------------------------------

  /**
   * Check GitHub for a newer version and, if there is one, offer it.
   * @param {Object} [options]
   * @param {boolean} [options.manual] - The user asked (Settings / menu):
   *        report "up to date" and errors, and ignore "Skip This Version"
   * @returns {Promise<{status: string, current: string, latest?: string, message?: string}>}
   *   status: 'up-to-date' | 'available' | 'downloading' | 'skipped' | 'busy' | 'error'
   */
  async function check({ manual = false } = {}) {
    const current = currentVersion();
    if (busy) return { status: 'busy', current };
    busy = true;
    let keepBusy = false;
    try {
      const release = await fetchLatestRelease();
      if (!release || updates.compareVersions(release.version, current) !== 1) {
        debugLog('No newer version; latest is', release ? release.version : 'none');
        return { status: 'up-to-date', current, latest: release ? release.version : current };
      }

      if (!manual && store.get(SKIPPED_VERSION_KEY) === release.version) {
        debugLog('Newer version', release.version, 'was skipped by the user');
        return { status: 'skipped', current, latest: release.version };
      }

      const choice = await offerUpdate(release, current);
      if (choice === 'download') {
        keepBusy = true;
        // Runs on its own; the Settings screen follows it via update-status
        downloadAndInstall(release)
          .catch((error) => {
            console.error('Update failed:', error.message);
            sendStatus({ state: 'error', version: release.version, message: error.message });
            showMessage({
              type: 'error',
              title: 'Update failed',
              message: "NeatNote couldn't download the update.",
              detail: `${error.message}\n\nYou can download it from ${updates.DOWNLOAD_PAGE} instead.`,
              buttons: ['OK'],
              noLink: true
            }).catch(() => {});
          })
          .finally(() => {
            setTaskbarProgress(-1);
            busy = false;
          });
        return { status: 'downloading', current, latest: release.version };
      }
      return { status: 'available', current, latest: release.version };
    } catch (error) {
      return { status: 'error', current, message: error.message };
    } finally {
      if (!keepBusy) busy = false;
    }
  }

  /**
   * Ask the user what to do about a newer version.
   * @returns {Promise<'download'|'opened-page'|'later'|'skip'>}
   */
  async function offerUpdate(release, current) {
    const action = updates.updateActionFor(process.platform, app.isPackaged);
    const installer = action === 'install' ? updates.findWindowsInstaller(release) : null;
    const canInstall = installer !== null;

    const notes = updates.summarizeNotes(release.notes);
    const how = canInstall
      ? 'NeatNote will download the update, then close and open the installer. Your notes are saved first, and your notes and settings carry over.'
      : 'Your browser will open the NeatNote download page. Install the new version over this one — your notes and settings carry over.';

    const { response } = await showMessage({
      type: 'info',
      title: 'Update available',
      message: `NeatNote ${release.version} is available`,
      detail: `You have version ${current}.\n\n${notes ? `${notes}\n\n` : ''}${how}`,
      buttons: [canInstall ? 'Update' : 'Download', 'Later', 'Skip This Version'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });

    if (response === 2) {
      store.set(SKIPPED_VERSION_KEY, release.version);
      return 'skip';
    }
    if (response !== 0) return 'later';

    if (canInstall) return 'download';
    await shell.openExternal(updates.downloadPageFor(process.platform, release));
    return 'opened-page';
  }

  // ---- Installing (Windows) ---------------------------------------------------

  function downloadDir() {
    return path.join(app.getPath('temp'), 'NeatNote Update');
  }

  /**
   * Remove installers left from earlier updates (only files this code
   * names, never anything else in the folder).
   */
  async function removeOldDownloads(keepName) {
    let entries = [];
    try {
      entries = await fs.promises.readdir(downloadDir());
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === keepName) continue;
      if (/^NeatNote-Setup-\d+\.\d+\.\d+\.exe(\.part)?$/.test(name)) {
        await fs.promises.rm(path.join(downloadDir(), name), { force: true }).catch(() => {});
      }
    }
  }

  async function downloadAndInstall(release) {
    const installer = updates.findWindowsInstaller(release);
    if (!installer) throw new Error('This release has no Windows installer.');

    await fs.promises.mkdir(downloadDir(), { recursive: true });
    await removeOldDownloads(installer.name);
    const filePath = path.join(downloadDir(), installer.name);

    if (await updates.isVerifiedDownload(filePath, installer)) {
      debugLog('Using the installer downloaded earlier:', filePath);
    } else {
      sendStatus({ state: 'downloading', version: release.version, percent: 0 });
      let lastPercent = -1;
      await updates.downloadVerified({
        fetchImpl: doFetch,
        url: installer.url,
        destPath: filePath,
        size: installer.size,
        sha256: installer.sha256,
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        onProgress: (received, total) => {
          const percent = Math.floor((received / total) * 100);
          if (percent === lastPercent) return;
          lastPercent = percent;
          setTaskbarProgress(received / total);
          sendStatus({ state: 'downloading', version: release.version, percent });
        }
      });
    }

    setTaskbarProgress(-1);
    pendingInstaller = { version: release.version, filePath };
    sendStatus({ state: 'ready', version: release.version });

    const { response } = await showMessage({
      type: 'info',
      title: 'Update ready',
      message: `NeatNote ${release.version} is ready to install`,
      detail: 'NeatNote will close and the installer will open. Your notes are saved first.',
      buttons: ['Install Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (response === 0) await installNow();
  }

  /**
   * Start the downloaded installer, then quit through the normal path
   * (which saves pending edits first).
   */
  async function installNow() {
    if (!pendingInstaller) return { success: false, error: 'No update has been downloaded.' };
    const { filePath } = pendingInstaller;
    if (!fs.existsSync(filePath)) {
      pendingInstaller = null;
      return { success: false, error: 'The downloaded update is missing. Check for updates again.' };
    }

    // --updated: the installer skips the questions it already has answers
    // for (install location, all users or just me) and goes straight to
    // installing over the current version.
    const launched = await new Promise((resolve) => {
      try {
        const child = spawn(filePath, ['--updated'], { detached: true, stdio: 'ignore', windowsHide: false });
        child.once('spawn', () => { child.unref(); resolve(true); });
        child.once('error', (error) => {
          console.error('Could not start the installer:', error.message);
          resolve(false);
        });
      } catch (error) {
        console.error('Could not start the installer:', error.message);
        resolve(false);
      }
    });

    if (!launched) {
      // Fall back to letting Windows open it (shows an elevation prompt if
      // one is needed); the full setup wizard runs in that case
      const failure = await shell.openPath(filePath);
      if (failure) return { success: false, error: failure };
    }

    setTimeout(() => app.quit(), 300);
    return { success: true };
  }

  // ---- Wiring -----------------------------------------------------------------

  /**
   * Ask once whether NeatNote may check for updates on its own.
   * Closing the dialog counts as "Don't Check" (the safe answer); it can
   * be changed any time in Settings.
   * @returns {Promise<boolean>} The choice
   */
  async function askForConsent() {
    const { response } = await showMessage({
      type: 'question',
      title: 'Updates',
      message: 'Check for updates automatically?',
      detail: 'When it opens, NeatNote can ask GitHub whether a newer version is out. '
        + 'Nothing about you or your notes is sent, and nothing is installed without your OK.\n\n'
        + 'You can change this any time in Settings → Updates.',
      buttons: ['Check Automatically', "Don't Check"],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    const allowed = response === 0;
    setAutoCheckEnabled(allowed);
    return allowed;
  }

  /**
   * What happens at launch: nothing unless the user has said yes (or is
   * asked now and says yes), then one check. Only installed builds do
   * this on their own; from source, use the Settings button (or
   * NEATNOTE_UPDATE_TEST_VERSION).
   * @returns {Promise<string>} What happened, for logs and tests
   */
  async function runStartupFlow() {
    let choice = autoCheckChoice();
    if (choice === null) {
      try {
        choice = await askForConsent();
      } catch (error) {
        debugLog('Could not ask about updates:', error.message);
        return 'not-asked';
      }
      if (!choice) return 'declined';
      const result = await check({ manual: false });
      return `checked:${result.status}`;
    }
    if (!choice) return 'off';
    await new Promise((resolve) => setTimeout(resolve, STARTUP_CHECK_DELAY_MS - CONSENT_PROMPT_DELAY_MS));
    const result = await check({ manual: false });
    return `checked:${result.status}`;
  }

  function scheduleStartupCheck() {
    if (process.env.NEATNOTE_DISABLE_UPDATE_CHECK === '1') return;
    if (!app.isPackaged && !process.env.NEATNOTE_UPDATE_TEST_VERSION) return;
    setTimeout(() => {
      runStartupFlow().then((outcome) => debugLog('Startup update flow:', outcome));
    }, CONSENT_PROMPT_DELAY_MS);
  }

  function getState() {
    return {
      version: currentVersion(),
      autoCheck: autoCheckChoice() === true,
      busy,
      readyVersion: pendingInstaller ? pendingInstaller.version : null
    };
  }

  return {
    check,
    installNow,
    getState,
    setAutoCheckEnabled,
    scheduleStartupCheck,
    runStartupFlow,
    /** For tests: forget the answer, as on a fresh install. */
    forgetConsentForTests: () => store.delete(AUTO_CHECK_KEY)
  };
}

module.exports = { createUpdater, setFetchImplementation, getUpdaterForTests };
