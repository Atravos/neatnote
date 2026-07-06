const { ipcMain } = require('electron');
const fileSystem = require('./fileSystem');

// Debug logging — enable by launching with NEATNOTE_DEBUG=1
const DEBUG = process.env.NEATNOTE_DEBUG === '1';
function debugLog(...args) {
  if (DEBUG) console.log('[ipc]', ...args);
}

/**
 * Set up all IPC handlers for file system operations
 * @param {Electron.App} app - Electron app instance
 * @param {Object} store - electron-store instance
 * @returns {Object} Object with cleanup function
 */
function setupIpcHandlers(app, store) {
  const userDataPath = app.getPath('userData');

  /**
   * Validate that a path is inside the notes root.
   * @param {string} p - Path to validate
   * @param {Object} [options]
   * @param {boolean} [options.allowNull=false] - Whether null/undefined is acceptable
   * @param {boolean} [options.allowRoot=true] - Whether the notes root itself is acceptable
   * @returns {Object|null} An error result object if invalid, or null if valid
   */
  function rejectOutsideNotes(p, { allowNull = false, allowRoot = true } = {}) {
    if (p === null || p === undefined) {
      return allowNull ? null : { success: false, error: 'Invalid path' };
    }
    if (!fileSystem.isInsideNotes(p, userDataPath, allowRoot)) {
      console.error('Rejected path outside notes directory');
      return { success: false, error: 'Invalid path' };
    }
    return null;
  }

  // Track active handlers for cleanup
  const handlers = [
    'create-folder',
    'create-file',
    'read-file',
    'save-file',
    'list-files',
    'move-file',
    'delete-item',
    'rename-item',
    'get-sort-order',
    'set-sort-order'
  ];

  // Handler for creating folders
  ipcMain.handle('create-folder', async (event, name, parentPath) => {
    debugLog('create-folder', { name, parentPath });
    const invalid = rejectOutsideNotes(parentPath, { allowNull: true });
    if (invalid) return invalid;
    return fileSystem.createFolder(name, parentPath, userDataPath);
  });

  // Handler for creating files
  ipcMain.handle('create-file', async (event, name, parentPath) => {
    debugLog('create-file', { name, parentPath });
    const invalid = rejectOutsideNotes(parentPath, { allowNull: true });
    if (invalid) return invalid;
    return fileSystem.createFile(name, parentPath, userDataPath);
  });

  // Handler for reading files
  ipcMain.handle('read-file', async (event, filePath) => {
    debugLog('read-file', { filePath });
    const invalid = rejectOutsideNotes(filePath, { allowRoot: false });
    if (invalid) return invalid;
    return fileSystem.readFile(filePath);
  });

  // Handler for saving files
  ipcMain.handle('save-file', async (event, filePath, content) => {
    debugLog('save-file', { filePath, contentLength: content?.length });
    const invalid = rejectOutsideNotes(filePath, { allowRoot: false });
    if (invalid) return invalid;
    return fileSystem.saveFile(filePath, content);
  });

  // Handler for listing files
  ipcMain.handle('list-files', async (event, dirPath = null) => {
    debugLog('list-files', { dirPath });
    const invalid = rejectOutsideNotes(dirPath, { allowNull: true });
    if (invalid) return invalid;
    return fileSystem.listFiles(dirPath, userDataPath);
  });

  // Handler for moving files
  ipcMain.handle('move-file', async (event, sourcePath, targetDir) => {
    debugLog('move-file', { sourcePath, targetDir });
    const invalidSource = rejectOutsideNotes(sourcePath, { allowRoot: false });
    if (invalidSource) return invalidSource;
    const invalidTarget = rejectOutsideNotes(targetDir, { allowNull: true });
    if (invalidTarget) return invalidTarget;
    return fileSystem.moveFile(sourcePath, targetDir, userDataPath);
  });

  // Handler for deleting items
  ipcMain.handle('delete-item', async (event, itemPath) => {
    debugLog('delete-item', { itemPath });
    // Never allow deleting the notes root itself
    const invalid = rejectOutsideNotes(itemPath, { allowRoot: false });
    if (invalid) return invalid;
    return fileSystem.deleteItem(itemPath);
  });

  // Handler for renaming items
  ipcMain.handle('rename-item', async (event, itemPath, newName) => {
    debugLog('rename-item', { itemPath, newName });
    // Never allow renaming the notes root itself
    const invalid = rejectOutsideNotes(itemPath, { allowRoot: false });
    if (invalid) return invalid;
    return fileSystem.renameItem(itemPath, newName);
  });

  // Handler for getting sort order for a directory
  ipcMain.handle('get-sort-order', async (event, dirKey) => {
    try {
      const key = `sortOrder.${dirKey || '_root'}`;
      const order = store.get(key, null);
      return { success: true, order };
    } catch (error) {
      console.error('Error getting sort order:', error.message);
      return { success: true, order: null };
    }
  });

  // Handler for setting sort order for a directory
  ipcMain.handle('set-sort-order', async (event, dirKey, order) => {
    try {
      const key = `sortOrder.${dirKey || '_root'}`;
      store.set(key, order);
      return { success: true };
    } catch (error) {
      console.error('Error setting sort order:', error.message);
      return { success: false, error: error.message };
    }
  });

  return {
    cleanup: () => {
      handlers.forEach(handler => {
        try {
          ipcMain.removeHandler(handler);
        } catch (error) {
          console.error(`Error removing handler ${handler}:`, error.message);
        }
      });
    }
  };
}

module.exports = {
  setupIpcHandlers
};
