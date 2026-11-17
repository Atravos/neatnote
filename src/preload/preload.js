const { contextBridge, ipcRenderer } = require('electron');

/*
 * The only bridge between the sandboxed renderer and the main process.
 *
 * Everything exposed here is a narrow, purpose-built function: the
 * renderer never receives ipcRenderer itself, cannot choose a channel
 * name, and every path it passes is re-validated in the main process.
 */

/**
 * Call a main-process handler; a transport failure becomes an ordinary
 * `{ success: false }` result so callers have one error shape to handle.
 * @param {string} channel
 * @param {...*} args
 * @returns {Promise<Object>}
 */
async function invoke(channel, ...args) {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    return { success: false, error: error.message };
  }
}

const apiMethods = {
  // ---- Notes and folders ---------------------------------------------------
  createFolder: (name, parentPath) => invoke('create-folder', name, parentPath),
  createFile: (name, parentPath, options) => invoke('create-file', name, parentPath, options),
  readFile: (path) => invoke('read-file', path),
  saveFile: (path, content) => invoke('save-file', path, content),
  checkFileChanged: (path) => invoke('check-file-changed', path),
  listFiles: (dirPath) => invoke('list-files', dirPath),
  searchNotes: (query) => invoke('search-notes', query),
  moveFile: (sourcePath, targetDir) => invoke('move-file', sourcePath, targetDir),
  reorderItem: (dirPath, name, refName, position) =>
    invoke('reorder-item', dirPath, name, refName, position),
  deleteItem: (path) => invoke('delete-item', path),
  renameItem: (itemPath, newName) => invoke('rename-item', itemPath, newName),
  getNotesRoot: () => invoke('get-notes-root'),
  showInFolder: (itemPath) => invoke('show-in-folder', itemPath),
  exportNote: (suggestedName, content) => invoke('export-note', suggestedName, content),

  // ---- App -------------------------------------------------------------------
  uninstallApp: () => invoke('uninstall-app'),
  canUninstall: async () => {
    try {
      return (await ipcRenderer.invoke('can-uninstall')) === true;
    } catch (error) {
      return false;
    }
  },

  /**
   * Register the function that writes pending edits to disk when the
   * window is about to close. It should resolve to `false` if a save
   * failed; the main process then asks the user before closing. The
   * acknowledgement is sent from here so it can never be skipped.
   * @param {Function} callback - async () => boolean
   */
  onFlushPendingSaves: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.removeAllListeners('flush-pending-saves');
    ipcRenderer.on('flush-pending-saves', async (event, requestId) => {
      let ok = true;
      try {
        ok = (await callback()) !== false;
      } catch (error) {
        ok = false;
      }
      ipcRenderer.send('pending-saves-flushed', requestId, ok);
    });
  },

  /**
   * Register a handler for actions chosen from the native application
   * menu (macOS menu bar): 'new-note', 'new-folder', 'save', ...
   * @param {Function} callback - (action: string) => void
   */
  onMenuAction: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.removeAllListeners('menu-action');
    ipcRenderer.on('menu-action', (event, action) => {
      if (typeof action === 'string') callback(action);
    });
  },

  /**
   * Persist the active theme's background color so the next launch
   * paints the window in that color (no white flash on dark themes).
   * @param {string} color - Hex color like "#1c1e22"
   */
  setThemeBackground: (color) => {
    ipcRenderer.send('theme-bg-changed', color);
  },

  /**
   * The background color saved by setThemeBackground in an earlier
   * session, or null.
   * @returns {Promise<string|null>}
   */
  getThemeBackground: async () => {
    try {
      return await ipcRenderer.invoke('get-theme-background');
    } catch (error) {
      return null;
    }
  },

  /**
   * Window controls for the custom titlebar (frameless window).
   */
  windowControls: {
    platform: process.platform,
    minimize: () => ipcRenderer.send('window-minimize'),
    maximizeToggle: () => ipcRenderer.send('window-maximize-toggle'),
    close: () => ipcRenderer.send('window-close'),
    isMaximized: async () => {
      try {
        return await ipcRenderer.invoke('window-is-maximized');
      } catch (error) {
        return false;
      }
    },
    onMaximizedChange: (callback) => {
      if (typeof callback !== 'function') return;
      ipcRenderer.removeAllListeners('window-maximized-changed');
      ipcRenderer.on('window-maximized-changed', (event, isMaximized) => {
        callback(!!isMaximized);
      });
    }
  }
};

try {
  contextBridge.exposeInMainWorld('api', apiMethods);
} catch (error) {
  console.error('Failed to expose API:', error);
}
