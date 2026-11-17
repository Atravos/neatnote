/**
 * FileService - the renderer's interface to the file system.
 *
 * Every method forwards to the preload bridge (window.api), which already
 * turns failures into `{ success: false, error }` results, so there is one
 * error shape to handle everywhere and nothing here ever throws.
 */
export class FileService {
  constructor(api) {
    if (!api) {
      throw new Error('API not available. File service cannot be initialized.');
    }
    this.api = api;
  }

  createFolder(name, parentPath = null) {
    return this.api.createFolder(name, parentPath);
  }

  /**
   * @param {string} name - Note name without extension
   * @param {string|null} [parentPath=null] - Folder to create it in (null = top level)
   * @param {Object} [options]
   * @param {boolean} [options.unique] - Pick "Name 2", "Name 3", ... if taken
   */
  createFile(name, parentPath = null, options = undefined) {
    return this.api.createFile(name, parentPath, options);
  }

  readFile(path) {
    return this.api.readFile(path);
  }

  /**
   * @returns {Promise<{success: boolean, error?: string, conflictCopy?: string}>}
   *          `conflictCopy` is set when the note had been changed outside
   *          the app; it is the path where that other version was kept.
   */
  saveFile(path, content) {
    return this.api.saveFile(path, content);
  }

  /** @returns {Promise<{success: boolean, exists?: boolean, changed?: boolean}>} */
  checkFileChanged(path) {
    return this.api.checkFileChanged(path);
  }

  /** Entries come back already in display order (saved order applied). */
  async listFiles(dirPath = null) {
    const result = await this.api.listFiles(dirPath);
    return result.success ? result : { ...result, files: [] };
  }

  /** Search note/folder names and note contents under the whole notes root. */
  async searchNotes(query) {
    const result = await this.api.searchNotes(query);
    return result.success ? result : { ...result, results: [], truncated: false };
  }

  moveFile(sourcePath, targetDir) {
    return this.api.moveFile(sourcePath, targetDir);
  }

  /**
   * Place an item immediately before/after a sibling in its directory.
   * @param {string|null} dirPath - Directory containing both items (null = top level)
   * @param {string} name - File/folder name being placed
   * @param {string} refName - Sibling it goes next to
   * @param {'before'|'after'} position
   */
  reorderItem(dirPath, name, refName, position) {
    return this.api.reorderItem(dirPath, name, refName, position);
  }

  deleteItem(path) {
    return this.api.deleteItem(path);
  }

  /**
   * Rename a file or folder in place.
   * @param {string} itemPath - Current path of the item
   * @param {string} newName - New name (without extension for files)
   */
  renameItem(itemPath, newName) {
    return this.api.renameItem(itemPath, newName);
  }

  /**
   * Get the absolute path of the notes root directory.
   * @returns {Promise<string|null>}
   */
  async getNotesRoot() {
    const result = await this.api.getNotesRoot();
    return result.success ? result.path : null;
  }

  /** Reveal an item in the OS file manager (null opens the notes folder). */
  showInFolder(itemPath = null) {
    return this.api.showInFolder(itemPath);
  }

  /**
   * Save text to a location the user picks in a native dialog.
   * @param {string} suggestedName - File name to suggest (no extension)
   * @param {string} content - Text to write
   * @returns {Promise<{success: boolean, path?: string, cancelled?: boolean, error?: string}>}
   */
  exportNote(suggestedName, content) {
    return this.api.exportNote(suggestedName, content);
  }

  /**
   * Register the function the app calls to write pending edits before the
   * window closes. It should resolve to false if a save failed.
   * @param {Function} callback - async () => boolean
   */
  onFlushPendingSaves(callback) {
    if (this.api.onFlushPendingSaves) {
      this.api.onFlushPendingSaves(callback);
    }
  }
}
