const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Debug logging — enable by launching with NEATNOTE_DEBUG=1
const DEBUG = process.env.NEATNOTE_DEBUG === '1';
function debugLog(...args) {
  if (DEBUG) console.log('[fs]', ...args);
}

// Windows-reserved device names (invalid as file/folder names, with or without extension)
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// Characters invalid on Windows; also excluded on other platforms for portability
const INVALID_CHARS = /[<>:"|?*\u0000-\u001F]/;

/**
 * Get the root notes directory for the app.
 * @param {string} userDataPath - Electron userData path
 * @returns {string} Absolute path to the notes root
 */
function getNotesRoot(userDataPath) {
  return path.join(userDataPath, 'notes');
}

/**
 * Check whether a path resolves inside the notes root.
 * @param {string} targetPath - Path to check
 * @param {string} userDataPath - Electron userData path
 * @param {boolean} [allowRoot=true] - Whether the notes root itself is acceptable
 * @returns {boolean}
 */
function isInsideNotes(targetPath, userDataPath, allowRoot = true) {
  if (typeof targetPath !== 'string' || targetPath.length === 0) return false;
  const root = path.resolve(getNotesRoot(userDataPath));
  const resolved = path.resolve(targetPath);
  if (resolved === root) return allowRoot;
  return resolved.startsWith(root + path.sep);
}

/**
 * Validate a user-supplied file or folder name.
 * @param {string} name - Proposed name (without extension)
 * @returns {{ valid: boolean, name?: string, error?: string }}
 *          On success, `name` is the trimmed, safe name to use.
 */
function validateName(name) {
  if (typeof name !== 'string') {
    return { valid: false, error: 'Name must be a string' };
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'Name cannot be empty' };
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return { valid: false, error: 'Name cannot contain path separators' };
  }
  if (trimmed === '.' || trimmed === '..') {
    return { valid: false, error: 'Invalid name' };
  }
  if (INVALID_CHARS.test(trimmed)) {
    return { valid: false, error: 'Name contains invalid characters (< > : " | ? *)' };
  }
  if (RESERVED_NAMES.test(trimmed)) {
    return { valid: false, error: 'Name is reserved by the operating system' };
  }
  if (trimmed.endsWith('.') || trimmed.endsWith(' ')) {
    return { valid: false, error: 'Name cannot end with a dot or space' };
  }
  if (trimmed.length > 200) {
    return { valid: false, error: 'Name is too long' };
  }
  return { valid: true, name: trimmed };
}

/**
 * Async existence check.
 * @param {string} p - Path to check
 * @returns {Promise<boolean>}
 */
async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Atomically write content to a file: write to a temp file in the same
 * directory, then rename over the target (atomic on the same filesystem).
 * @param {string} filePath - Target file path
 * @param {string} content - Content to write
 */
async function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  try {
    await fsp.writeFile(tmpPath, content, 'utf8');
    await fsp.rename(tmpPath, filePath);
  } catch (error) {
    // Best-effort cleanup of the temp file on failure
    try { await fsp.unlink(tmpPath); } catch {}
    throw error;
  }
}

/**
 * Create a new folder
 * @param {string} name - Folder name
 * @param {string} parentPath - Path to parent folder, or null for root
 * @param {string} userDataPath - User data path
 * @returns {Promise<Object>} Result object with success flag and path or error
 */
async function createFolder(name, parentPath, userDataPath) {
  try {
    const check = validateName(name);
    if (!check.valid) {
      return { success: false, error: check.error };
    }

    const folderPath = parentPath
      ? path.join(parentPath, check.name)
      : path.join(getNotesRoot(userDataPath), check.name);

    debugLog('Creating folder at:', folderPath);

    // Ensure parent directory exists
    const parentDir = path.dirname(folderPath);
    await fsp.mkdir(parentDir, { recursive: true });

    if (await exists(folderPath)) {
      return { success: false, error: 'Folder already exists' };
    }

    await fsp.mkdir(folderPath, { recursive: true });
    return { success: true, path: folderPath };
  } catch (error) {
    console.error('Error creating folder:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Create a new file
 * @param {string} name - File name (without extension)
 * @param {string} parentPath - Path to parent folder, or null for root
 * @param {string} userDataPath - User data path
 * @returns {Promise<Object>} Result object with success flag and path or error
 */
async function createFile(name, parentPath, userDataPath) {
  try {
    const check = validateName(name);
    if (!check.valid) {
      return { success: false, error: check.error };
    }

    const basePath = parentPath || getNotesRoot(userDataPath);
    await fsp.mkdir(basePath, { recursive: true });

    const filePath = path.join(basePath, check.name + '.txt');
    debugLog('Creating file at:', filePath);

    if (await exists(filePath)) {
      return { success: false, error: 'File already exists' };
    }

    await atomicWrite(filePath, '');
    return { success: true, path: filePath };
  } catch (error) {
    console.error('Error creating file:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Read a file
 * @param {string} filePath - Path to the file
 * @returns {Promise<Object>} Result object with success flag and content or error
 */
async function readFile(filePath) {
  try {
    const content = await fsp.readFile(filePath, 'utf8');
    debugLog('File read:', filePath);
    return { success: true, content };
  } catch (error) {
    console.error('Error reading file:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Save content to a file (atomic: temp file + rename)
 * @param {string} filePath - Path to the file
 * @param {string} content - Content to save
 * @returns {Promise<Object>} Result object with success flag or error
 */
async function saveFile(filePath, content) {
  try {
    await atomicWrite(filePath, content || '');
    debugLog('File saved:', filePath);
    return { success: true };
  } catch (error) {
    console.error('Error saving file:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * List files in a directory
 * @param {string} dirPath - Path to directory, or null for root
 * @param {string} userDataPath - User data path
 * @returns {Promise<Object>} Result object with success flag and files array or error
 */
async function listFiles(dirPath, userDataPath) {
  try {
    const rootDir = dirPath || getNotesRoot(userDataPath);
    debugLog('Listing files in:', rootDir);

    await fsp.mkdir(rootDir, { recursive: true });

    const items = await fsp.readdir(rootDir, { withFileTypes: true });

    const files = items
      // Hide temp files left behind by an interrupted atomic write
      .filter(item => !(item.name.startsWith('.') && item.name.endsWith('.tmp')))
      .map(item => ({
        name: item.name,
        path: path.join(rootDir, item.name),
        isDirectory: item.isDirectory(),
      }));

    return { success: true, files };
  } catch (error) {
    console.error('Error listing files:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Move a file from one location to another (atomic at the destination:
 * copy to a temp file in the target directory, rename into place, then
 * remove the source).
 * @param {string} sourcePath - Source file path
 * @param {string} targetDir - Target directory path or null for root
 * @param {string} userDataPath - User data path
 * @returns {Promise<Object>} Result object with success flag and new path or error
 */
async function moveFile(sourcePath, targetDir, userDataPath) {
  try {
    if (!(await exists(sourcePath))) {
      return { success: false, error: 'File does not exist' };
    }

    const fileName = path.basename(sourcePath);
    const destDir = targetDir === null ? getNotesRoot(userDataPath) : targetDir;
    await fsp.mkdir(destDir, { recursive: true });
    const targetPath = path.join(destDir, fileName);

    debugLog('Moving file from', sourcePath, 'to', targetPath);

    // Skip if source and destination are the same
    if (path.resolve(sourcePath) === path.resolve(targetPath)) {
      return { success: true, newPath: targetPath };
    }

    // Check if target already exists to avoid overwriting
    if (await exists(targetPath)) {
      return { success: false, error: 'A file with the same name already exists in the target folder' };
    }

    const sourceStats = await fsp.stat(sourcePath);
    if (sourceStats.isDirectory()) {
      // Directories: rename works within the same filesystem (notes dir)
      await fsp.rename(sourcePath, targetPath);
    } else {
      // Files: copy to temp in the target dir, atomically rename, then unlink source
      const tmpPath = path.join(destDir, `.${fileName}.${process.pid}.${Date.now()}.tmp`);
      try {
        await fsp.copyFile(sourcePath, tmpPath);
        await fsp.rename(tmpPath, targetPath);
      } catch (error) {
        try { await fsp.unlink(tmpPath); } catch {}
        throw error;
      }
      await fsp.unlink(sourcePath);
    }

    return { success: true, newPath: targetPath };
  } catch (error) {
    console.error('Error moving file:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Delete a file or folder
 * @param {string} itemPath - Path to the item to delete
 * @returns {Promise<Object>} Result object with success flag or error
 */
async function deleteItem(itemPath) {
  try {
    if (!(await exists(itemPath))) {
      return { success: false, error: 'Item does not exist' };
    }

    const stats = await fsp.stat(itemPath);
    debugLog('Deleting:', itemPath);

    if (stats.isDirectory()) {
      await fsp.rm(itemPath, { recursive: true, force: true });
    } else {
      await fsp.unlink(itemPath);
    }

    return { success: true };
  } catch (error) {
    console.error('Error deleting item:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Rename a file or folder in place. For files, the original extension is
 * preserved (the new name should not include an extension).
 * @param {string} itemPath - Current path of the item
 * @param {string} newName - New name (without extension for files)
 * @returns {Promise<Object>} Result object with success flag and new path or error
 */
async function renameItem(itemPath, newName) {
  try {
    if (!(await exists(itemPath))) {
      return { success: false, error: 'Item does not exist' };
    }

    const check = validateName(newName);
    if (!check.valid) {
      return { success: false, error: check.error };
    }

    const stats = await fsp.stat(itemPath);
    const dir = path.dirname(itemPath);
    const finalName = stats.isDirectory()
      ? check.name
      : check.name + path.extname(itemPath);
    const targetPath = path.join(dir, finalName);

    if (path.resolve(targetPath) === path.resolve(itemPath)) {
      return { success: true, newPath: itemPath };
    }

    if (await exists(targetPath)) {
      return { success: false, error: 'An item with that name already exists' };
    }

    debugLog('Renaming', itemPath, 'to', targetPath);
    await fsp.rename(itemPath, targetPath);

    return { success: true, newPath: targetPath };
  } catch (error) {
    console.error('Error renaming item:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  createFolder,
  createFile,
  readFile,
  saveFile,
  listFiles,
  moveFile,
  deleteItem,
  renameItem,
  getNotesRoot,
  isInsideNotes,
  validateName
};
