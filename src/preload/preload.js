const { contextBridge, ipcRenderer } = require('electron');

/**
 * API methods to expose to the renderer process
 */
const apiMethods = {
  createFolder: async (name, parentPath) => {
    try {
      return await ipcRenderer.invoke('create-folder', name, parentPath);
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  createFile: async (name, parentPath) => {
    try {
      return await ipcRenderer.invoke('create-file', name, parentPath);
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  readFile: async (path) => {
    try {
      return await ipcRenderer.invoke('read-file', path);
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  saveFile: async (path, content) => {
    try {
      return await ipcRenderer.invoke('save-file', path, content);
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  listFiles: async (dirPath) => {
    try {
      return await ipcRenderer.invoke('list-files', dirPath);
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  moveFile: async (sourcePath, targetDir) => {
    try {
      return await ipcRenderer.invoke('move-file', sourcePath, targetDir);
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  deleteItem: async (path) => {
    try {
      return await ipcRenderer.invoke('delete-item', path);
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  renameItem: async (itemPath, newName) => {
    try {
      return await ipcRenderer.invoke('rename-item', itemPath, newName);
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  uninstallApp: async () => {
    try {
      return await ipcRenderer.invoke('uninstall-app');
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  getSortOrder: async (dirKey) => {
    try {
      return await ipcRenderer.invoke('get-sort-order', dirKey);
    } catch (error) {
      return { success: true, order: null };
    }
  },

  setSortOrder: async (dirKey, order) => {
    try {
      return await ipcRenderer.invoke('set-sort-order', dirKey, order);
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  /**
   * Register a callback invoked when the main process asks the renderer
   * to flush any pending (debounced) auto-save before the app quits.
   */
  onFlushPendingSaves: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('flush-pending-saves', () => callback());
  },

  /**
   * Notify the main process that all pending saves have been flushed
   * and shutdown may proceed.
   */
  notifySavesFlushed: () => {
    ipcRenderer.send('pending-saves-flushed');
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
