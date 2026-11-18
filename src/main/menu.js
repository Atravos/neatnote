/**
 * Application menu template (pure data — no Electron imports, so the
 * production/development difference can be unit-tested with plain Node).
 *
 * Why the app defines its own menu at all: Electron's DEFAULT menu ships
 * Reload, Force Reload and Toggle Developer Tools with live shortcuts. In
 * an installed app, Ctrl+R would reload the window and throw away undo
 * history and any not-yet-saved keystrokes. Those entries exist here only
 * in development.
 *
 * On Windows/Linux the window is frameless, so this menu is never visible;
 * it is kept (rather than removed) because its Edit and zoom roles are
 * what make the standard shortcuts work.
 *
 * @param {Object} options
 * @param {boolean} options.isMac - Building for macOS (visible menu bar)
 * @param {boolean} options.isDev - Include developer-only items
 * @param {Function} options.sendAction - (action: string) => void; asks the
 *        renderer to run an app action ('new-note', 'save', ...)
 * @param {Function} [options.checkForUpdates] - Runs a manual update check
 *        (macOS: NeatNote > Check for Updates…)
 * @returns {Array<Object>} Template for Menu.buildFromTemplate
 */
function buildMenuTemplate({ isMac, isDev, sendAction, checkForUpdates }) {
  const template = [];

  if (isMac) {
    // The standard app menu, plus Check for Updates… under About
    const appItems = [{ role: 'about' }];
    if (typeof checkForUpdates === 'function') {
      appItems.push({ label: 'Check for Updates…', click: () => checkForUpdates() });
    }
    appItems.push(
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' }
    );
    template.push({ label: 'NeatNote', submenu: appItems });
    template.push({
      label: 'File',
      submenu: [
        { label: 'New Note', click: () => sendAction('new-note') },
        { label: 'New Folder', click: () => sendAction('new-folder') },
        { type: 'separator' },
        { label: 'Save', click: () => sendAction('save') },
        { label: 'Export as Markdown…', click: () => sendAction('export-markdown') },
        { type: 'separator' },
        { label: 'Search Notes', click: () => sendAction('search') },
        { type: 'separator' },
        { role: 'close' }
      ]
    });
  }

  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'pasteAndMatchStyle' },
      { role: 'delete' },
      { role: 'selectAll' }
    ]
  });

  const viewItems = [
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  ];
  if (isDev) {
    viewItems.push(
      { type: 'separator' },
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' }
    );
  }
  template.push({ label: 'View', submenu: viewItems });

  template.push(isMac
    ? { role: 'windowMenu' }
    : { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] });

  return template;
}

module.exports = { buildMenuTemplate };
