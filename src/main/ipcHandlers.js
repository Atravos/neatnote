const { ipcMain, dialog, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const fileSystem = require('./fileSystem');

// Debug logging — enable by launching with NEATNOTE_DEBUG=1
const DEBUG = process.env.NEATNOTE_DEBUG === '1';
function debugLog(...args) {
  if (DEBUG) console.log('[ipc]', ...args);
}

const INVALID_PATH = { success: false, error: 'Invalid path' };
const MAX_QUERY_LENGTH = 200;

/**
 * Set up all IPC handlers for file system operations.
 * @param {Object} deps
 * @param {string} deps.userDataPath - Electron userData path
 * @param {Object} deps.store - electron-store instance
 * @param {import('./sortOrders').SortOrders} deps.sortOrders - Sidebar ordering
 * @param {Function} deps.isTrustedSender - (event) => boolean; whether an
 *        IPC event really comes from the app's own window
 * @param {Function} deps.getMainWindow - () => BrowserWindow|null
 * @param {Promise<void>} deps.ready - Resolves when startup maintenance
 *        (sort-order migration) is done; handlers that touch orders wait
 *        for it so they never race the migration
 */
function setupIpcHandlers({ userDataPath, store, sortOrders, isTrustedSender, getMainWindow, ready }) {
  /**
   * Register an invoke handler that only answers the app's own window.
   * Every handler below goes through this, so sender validation can't be
   * forgotten on a new channel.
   */
  function handle(channel, listener) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event)) {
        console.error(`Rejected IPC "${channel}" from an untrusted sender`);
        return { success: false, error: 'Unauthorized' };
      }
      try {
        return await listener(event, ...args);
      } catch (error) {
        console.error(`Error in IPC "${channel}":`, error.message);
        return { success: false, error: error.message };
      }
    });
  }

  /**
   * Validate that a path is inside the notes root.
   * @param {string} p - Path to validate
   * @param {Object} [options]
   * @param {boolean} [options.allowNull=false] - Whether null/undefined is acceptable
   * @param {boolean} [options.allowRoot=true] - Whether the notes root itself is acceptable
   * @returns {Promise<boolean>} Whether the path may be used
   *          (async because containment checks resolve symlinks on disk)
   */
  async function isAllowedPath(p, { allowNull = false, allowRoot = true } = {}) {
    if (p === null || p === undefined) return allowNull;
    if (!(await fileSystem.isInsideNotes(p, userDataPath, allowRoot))) {
      console.error('Rejected path outside notes directory');
      return false;
    }
    return true;
  }

  // ---- Create ---------------------------------------------------------------

  handle('create-folder', async (event, name, parentPath) => {
    debugLog('create-folder', { name, parentPath });
    if (!(await isAllowedPath(parentPath, { allowNull: true }))) return INVALID_PATH;
    return fileSystem.createFolder(name, parentPath || null, userDataPath);
  });

  handle('create-file', async (event, name, parentPath, options) => {
    debugLog('create-file', { name, parentPath });
    if (!(await isAllowedPath(parentPath, { allowNull: true }))) return INVALID_PATH;
    const unique = !!(options && options.unique === true);
    return fileSystem.createFile(name, parentPath || null, userDataPath, { unique });
  });

  // ---- Read / write ---------------------------------------------------------

  handle('read-file', async (event, filePath) => {
    debugLog('read-file', { filePath });
    if (!(await isAllowedPath(filePath, { allowRoot: false }))) return INVALID_PATH;
    return fileSystem.readFile(filePath);
  });

  handle('save-file', async (event, filePath, content) => {
    debugLog('save-file', { filePath, contentLength: content?.length });
    if (!(await isAllowedPath(filePath, { allowRoot: false }))) return INVALID_PATH;
    return fileSystem.saveFile(filePath, content);
  });

  // Has the note changed on disk since the app last read or wrote it?
  handle('check-file-changed', async (event, filePath) => {
    if (!(await isAllowedPath(filePath, { allowRoot: false }))) return INVALID_PATH;
    return fileSystem.checkExternalChange(filePath);
  });

  // ---- List / search --------------------------------------------------------

  handle('list-files', async (event, dirPath = null) => {
    debugLog('list-files', { dirPath });
    if (!(await isAllowedPath(dirPath, { allowNull: true }))) return INVALID_PATH;
    await ready;
    const result = await fileSystem.listFiles(dirPath || null, userDataPath);
    if (result.success) {
      // The saved custom order is applied here so the renderer always
      // receives entries in display order
      result.files = sortOrders.apply(dirPath || null, result.files);
    }
    return result;
  });

  handle('search-notes', async (event, query) => {
    if (typeof query !== 'string' || query.length > MAX_QUERY_LENGTH) {
      return { success: false, error: 'Invalid search', results: [], truncated: false };
    }
    return fileSystem.searchNotes(query, userDataPath);
  });

  // ---- Move / reorder / rename / delete ------------------------------------
  // Sidebar-order bookkeeping happens here, in the same handler as the file
  // operation, so the saved order can never drift out of step with what is
  // actually on disk.

  handle('move-file', async (event, sourcePath, targetDir) => {
    debugLog('move-file', { sourcePath, targetDir });
    if (!(await isAllowedPath(sourcePath, { allowRoot: false }))) return INVALID_PATH;
    if (!(await isAllowedPath(targetDir, { allowNull: true }))) return INVALID_PATH;
    await ready;
    const result = await fileSystem.moveFile(sourcePath, targetDir || null, userDataPath);
    if (result.success && !result.unchanged) {
      sortOrders.removeName(path.dirname(sourcePath), path.basename(sourcePath));
      if (result.isDirectory) sortOrders.moveTree(sourcePath, result.newPath);
    }
    return result;
  });

  // Place an item immediately before/after a sibling in its directory
  handle('reorder-item', async (event, dirPath, name, refName, position) => {
    debugLog('reorder-item', { dirPath, name, refName, position });
    if (!(await isAllowedPath(dirPath, { allowNull: true }))) return INVALID_PATH;
    if (typeof name !== 'string' || typeof refName !== 'string' ||
        (position !== 'before' && position !== 'after')) {
      return { success: false, error: 'Invalid reorder request' };
    }
    await ready;
    const listing = await fileSystem.listFiles(dirPath || null, userDataPath);
    if (!listing.success) return listing;
    const names = sortOrders.apply(dirPath || null, listing.files).map(file => file.name);
    const saved = sortOrders.place(dirPath || null, names, name, refName, position);
    return saved ? { success: true } : { success: false, error: 'Item not found' };
  });

  handle('delete-item', async (event, itemPath) => {
    debugLog('delete-item', { itemPath });
    // Never allow deleting the notes root itself
    if (!(await isAllowedPath(itemPath, { allowRoot: false }))) return INVALID_PATH;
    await ready;
    const result = await fileSystem.deleteItem(itemPath);
    if (result.success) {
      sortOrders.removeName(path.dirname(itemPath), path.basename(itemPath));
      if (result.isDirectory) sortOrders.removeTree(itemPath);
    }
    return result;
  });

  handle('rename-item', async (event, itemPath, newName) => {
    debugLog('rename-item', { itemPath, newName });
    // Never allow renaming the notes root itself
    if (!(await isAllowedPath(itemPath, { allowRoot: false }))) return INVALID_PATH;
    await ready;
    const result = await fileSystem.renameItem(itemPath, newName);
    if (result.success && !result.unchanged) {
      sortOrders.renameName(
        path.dirname(itemPath),
        path.basename(itemPath),
        path.basename(result.newPath)
      );
      if (result.isDirectory) sortOrders.moveTree(itemPath, result.newPath);
    }
    return result;
  });

  // ---- Misc -----------------------------------------------------------------

  // The renderer uses the root path to tell "top level" from nested items
  handle('get-notes-root', async () => {
    return { success: true, path: fileSystem.getNotesRoot(userDataPath) };
  });

  // Reveal a note/folder in the OS file manager (null opens the notes folder)
  handle('show-in-folder', async (event, itemPath) => {
    if (!(await isAllowedPath(itemPath, { allowNull: true }))) return INVALID_PATH;
    if (itemPath === null || itemPath === undefined) {
      const root = fileSystem.getNotesRoot(userDataPath);
      await fileSystem.listFiles(null, userDataPath); // makes sure it exists
      const error = await shell.openPath(root);
      return error ? { success: false, error } : { success: true };
    }
    shell.showItemInFolder(path.resolve(itemPath));
    return { success: true };
  });

  // Export the current note to a file the user picks. The destination comes
  // only from the native save dialog shown here — the renderer supplies a
  // suggested file name and the text, never a path.
  handle('export-note', async (event, suggestedName, content) => {
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > fileSystem.MAX_NOTE_BYTES) {
      return { success: false, error: 'Invalid export content' };
    }

    const check = fileSystem.validateName(typeof suggestedName === 'string' ? suggestedName : '');
    const baseName = check.valid ? check.name : 'Note';

    let startDir = store.get('lastExportDir');
    if (typeof startDir !== 'string' || startDir.length === 0) {
      startDir = app.getPath('documents');
    }

    const options = {
      title: 'Export as Markdown',
      defaultPath: path.join(startDir, `${baseName}.md`),
      filters: [
        { name: 'Markdown', extensions: ['md'] },
        { name: 'Plain text', extensions: ['txt'] }
      ]
    };
    const win = getMainWindow();
    const { canceled, filePath } = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);

    if (canceled || !filePath) return { success: false, cancelled: true };

    // A plain write: the destination is outside the notes folder, where
    // leaving a temp file behind on failure would be littering
    await fs.promises.writeFile(filePath, content, 'utf8');
    try {
      store.set('lastExportDir', path.dirname(filePath));
    } catch (error) {
      // Remembering the folder is a convenience only
    }
    return { success: true, path: filePath };
  });
}

module.exports = {
  setupIpcHandlers
};
