const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

// Debug logging — enable by launching with NEATNOTE_DEBUG=1
const DEBUG = process.env.NEATNOTE_DEBUG === '1';
function debugLog(...args) {
  if (DEBUG) console.log('[fs]', ...args);
}

// Windows-reserved device names (invalid as file/folder names, with or without extension)
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// Characters invalid on Windows; also excluded on other platforms for portability
const INVALID_CHARS = /[<>:"|?*\u0000-\u001F]/;

// Largest note the app will open or save. Far above any real note (even
// one with pasted images) but low enough that a stray multi-gigabyte file
// in the notes folder can't freeze the app.
const MAX_NOTE_BYTES = 25 * 1024 * 1024;
// Largest file whose CONTENT is scanned by search (names always match)
const MAX_SEARCH_BYTES = 5 * 1024 * 1024;
// Extensions whose content search understands
const SEARCHABLE_EXT = /\.(html?|txt|md|markdown)$/i;
// Temp files written by atomicWrite: ".<name>.<pid>.<timestamp>.tmp"
const TEMP_FILE = /^\..+\.\d+\.\d+\.tmp$/;
// OS bookkeeping files that should never show up as notes
const OS_JUNK = /^(thumbs\.db|desktop\.ini|\.ds_store|\.localized|\._.*)$/i;
// Guard against pathological (or cyclic) directory nesting
const MAX_DEPTH = 64;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Moves an item to the OS trash. Resolved lazily so this module can be
 * loaded (and unit-tested) outside the Electron runtime.
 */
let trashImpl = (itemPath) => require('electron').shell.trashItem(itemPath);

/**
 * Replace the trash implementation (tests only).
 * @param {Function} fn - async (absolutePath) => void
 */
function setTrashImplementation(fn) {
  trashImpl = fn;
}

function fail(error, extra) {
  return { success: false, error, ...(extra || {}) };
}

/**
 * Get the root notes directory for the app.
 * @param {string} userDataPath - Electron userData path
 * @returns {string} Absolute path to the notes root
 */
function getNotesRoot(userDataPath) {
  return path.join(userDataPath, 'notes');
}

/**
 * Resolve a path to its real (symlink-free) location. If the path doesn't
 * exist yet (e.g. a file about to be created), the deepest existing
 * ancestor is realpath-resolved and the remaining segments are re-joined.
 * This means containment checks see through symlinks anywhere along the
 * path, including symlinked parents of not-yet-created items.
 * @param {string} p - Path to resolve
 * @returns {Promise<string>} Fully resolved, symlink-free path
 */
async function realResolve(p) {
  let current = path.resolve(p);
  const suffix = [];

  // Walk up until we find a component that exists, then realpath it and
  // re-append the non-existing tail.
  for (;;) {
    try {
      const real = await fsp.realpath(current);
      return suffix.length ? path.join(real, ...suffix) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        // Reached the filesystem root without resolving — fall back to the
        // lexical resolution (nothing along the path exists).
        return path.resolve(p);
      }
      suffix.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Check whether a path resolves inside the notes root.
 * Resolves symlinks on both the root and the target (including symlinked
 * ancestors of not-yet-existing targets), so a symlink placed inside the
 * notes directory cannot be used to read, write, or delete outside it.
 * @param {string} targetPath - Path to check
 * @param {string} userDataPath - Electron userData path
 * @param {boolean} [allowRoot=true] - Whether the notes root itself is acceptable
 * @returns {Promise<boolean>}
 */
async function isInsideNotes(targetPath, userDataPath, allowRoot = true) {
  if (typeof targetPath !== 'string' || targetPath.length === 0) return false;
  // A NUL can never be part of a real path, and Node throws on it
  if (targetPath.includes('\u0000')) return false;

  // Fast lexical pre-check: reject anything that doesn't even claim to be
  // inside the root before touching the filesystem.
  const lexicalRoot = path.resolve(getNotesRoot(userDataPath));
  const lexicalTarget = path.resolve(targetPath);
  if (lexicalTarget !== lexicalRoot && !lexicalTarget.startsWith(lexicalRoot + path.sep)) {
    return false;
  }

  try {
    const realRoot = await realResolve(lexicalRoot);
    const realTarget = await realResolve(lexicalTarget);
    if (realTarget === realRoot) return allowRoot;
    return realTarget.startsWith(realRoot + path.sep);
  } catch (error) {
    // Any resolution failure is treated as outside the sandbox
    console.error('Path resolution failed during containment check:', error.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Per-path operation serialization.
// Save, rename, move, and delete on the same path run strictly in order, so
// an in-flight auto-save can never interleave with (and undo) a rename, move,
// or delete of the same file — e.g. an atomic-write rename landing after a
// delete and "resurrecting" the file.
// ---------------------------------------------------------------------------
const pathLocks = new Map();

/**
 * Run `fn` after all previously queued operations on `key` have settled.
 * @param {string} key - Lock key (a resolved path)
 * @param {Function} fn - Async operation to run
 * @returns {Promise<*>} The result of `fn`
 */
function withPathLock(key, fn) {
  const prev = pathLocks.get(key) || Promise.resolve();
  const run = prev.then(() => fn());
  // The stored tail must never reject, or the chain would stall
  const tail = run.catch(() => {});
  pathLocks.set(key, tail);
  tail.then(() => {
    // Clean up the map entry once the queue for this key drains
    if (pathLocks.get(key) === tail) {
      pathLocks.delete(key);
    }
  });
  return run;
}

/**
 * Resolve once every queued file operation has settled (or the timeout
 * passes). Called before the app exits so a write that is still in flight
 * is never cut off mid-way.
 * @param {number} [timeoutMs=8000] - Upper bound on the wait
 * @returns {Promise<void>}
 */
async function whenIdle(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (pathLocks.size > 0) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    let timer;
    await Promise.race([
      Promise.all([...pathLocks.values()]),
      new Promise((resolve) => { timer = setTimeout(resolve, remaining); })
    ]);
    clearTimeout(timer);
    // Lock entries are removed in a follow-up microtask; yield so they clear
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Revision tracking (external-change detection).
// For every note the app has read or written, remember a hash of the bytes
// it last saw. If the bytes on disk no longer match at save time, something
// outside NeatNote changed the file — the on-disk version is preserved as a
// "conflict" copy before it is overwritten, so neither version is lost.
// Content hashes (not timestamps) keep this immune to coarse or rewritten
// mtimes.
// ---------------------------------------------------------------------------
const knownRevs = new Map();

function revOf(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

function isSameOrInside(candidate, parent) {
  return candidate === parent || candidate.startsWith(parent + path.sep);
}

/** Carry tracked revisions across a rename/move of a file or folder. */
function rekeyRevs(oldPath, newPath) {
  const from = path.resolve(oldPath);
  const to = path.resolve(newPath);
  for (const key of [...knownRevs.keys()]) {
    if (isSameOrInside(key, from)) {
      const rev = knownRevs.get(key);
      knownRevs.delete(key);
      knownRevs.set(to + key.slice(from.length), rev);
    }
  }
}

/** Drop tracked revisions for a deleted file or folder. */
function forgetRevs(itemPath) {
  const target = path.resolve(itemPath);
  for (const key of [...knownRevs.keys()]) {
    if (isSameOrInside(key, target)) knownRevs.delete(key);
  }
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
  if (trimmed.endsWith('.')) {
    return { valid: false, error: 'Name cannot end with a dot' };
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
 * Whether two paths refer to the same file on disk (used to allow
 * case-only renames on case-insensitive filesystems, where the "target"
 * of renaming note -> Note already exists because it IS the source).
 * @param {string} a
 * @param {string} b
 * @returns {Promise<boolean>}
 */
async function isSameFile(a, b) {
  try {
    const [sa, sb] = await Promise.all([
      fsp.stat(a, { bigint: true }),
      fsp.stat(b, { bigint: true })
    ]);
    return sa.ino !== 0n && sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

/**
 * Whether a directory entry should be shown to the user at all. Hides only
 * this app's own temp files and well-known OS bookkeeping files — any
 * other dot-named item a user created stays visible.
 */
function isVisibleName(name) {
  if (name.startsWith('.') && name.endsWith('.tmp')) return false;
  // Where pictures in notes are stored (see images.js) — not a note folder
  if (name === '.neatnote-images') return false;
  return !OS_JUNK.test(name);
}

/**
 * Whether a buffer looks like binary data rather than text. A NUL byte
 * never appears in UTF-8 text, so finding one near the start is a reliable
 * signal (it also catches UTF-16 files, which would not survive a UTF-8
 * round trip either).
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function looksBinary(buffer) {
  const end = Math.min(buffer.length, 8192);
  for (let i = 0; i < end; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * fs.rename with a short retry. On Windows a rename over an existing file
 * fails with EPERM/EBUSY/EACCES while an antivirus scanner, the search
 * indexer, or a sync client briefly holds the target open; retrying a few
 * times turns those into successes instead of "Save failed" errors.
 */
async function renameWithRetry(from, to) {
  const delays = [15, 40, 90, 180, 350];
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (error) {
      const retryable = error && ['EPERM', 'EBUSY', 'EACCES'].includes(error.code);
      if (!retryable || attempt >= delays.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

/**
 * Atomically and durably write content to a file: write to a temp file in
 * the same directory, fsync it, then rename over the target (atomic on the
 * same filesystem). The fsync before rename matters: without it, a power
 * loss can journal the rename ahead of the data and leave a zero-length or
 * truncated file behind the new name.
 * @param {string} filePath - Target file path
 * @param {string|Buffer} content - Content to write (strings are UTF-8)
 */
async function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  let handle = null;
  try {
    handle = await fsp.open(tmpPath, 'w');
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = null;
    await renameWithRetry(tmpPath, filePath);
  } catch (error) {
    // Best-effort cleanup of the temp file on failure
    if (handle) {
      try { await handle.close(); } catch {}
    }
    try { await fsp.unlink(tmpPath); } catch {}
    throw error;
  }
}

/**
 * Resolve the directory an item should be created in. The notes root is
 * created on demand; any other parent must already exist — creating it
 * implicitly would resurrect a folder that was deleted outside the app.
 * @returns {Promise<{ dir?: string, error?: string }>}
 */
async function resolveParentDir(parentPath, userDataPath) {
  if (!parentPath) {
    const root = getNotesRoot(userDataPath);
    await fsp.mkdir(root, { recursive: true });
    return { dir: root };
  }
  try {
    const stats = await fsp.stat(parentPath);
    if (!stats.isDirectory()) return { error: 'Target is not a folder' };
    return { dir: parentPath };
  } catch {
    return { error: 'That folder no longer exists' };
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
      return fail(check.error);
    }

    const parent = await resolveParentDir(parentPath, userDataPath);
    if (parent.error) return fail(parent.error);

    const folderPath = path.join(parent.dir, check.name);
    debugLog('Creating folder at:', folderPath);

    // Non-recursive mkdir on the final segment: unlike { recursive: true },
    // this throws EEXIST if the folder was created concurrently, closing
    // the check-then-act race a separate existence check would leave open.
    try {
      await fsp.mkdir(folderPath);
    } catch (error) {
      if (error.code === 'EEXIST') {
        return fail('Folder already exists');
      }
      throw error;
    }

    return { success: true, path: folderPath };
  } catch (error) {
    console.error('Error creating folder:', error.message);
    return fail(error.message);
  }
}

/**
 * Create a new, empty note.
 * @param {string} name - File name (without extension)
 * @param {string} parentPath - Path to parent folder, or null for root
 * @param {string} userDataPath - User data path
 * @param {Object} [options]
 * @param {boolean} [options.unique=false] - If the name is taken, append
 *        " 2", " 3", ... instead of failing (used for "Untitled" notes)
 * @returns {Promise<Object>} Result object with success flag and path or error
 */
async function createFile(name, parentPath, userDataPath, { unique = false } = {}) {
  try {
    const check = validateName(name);
    if (!check.valid) {
      return fail(check.error);
    }

    const parent = await resolveParentDir(parentPath, userDataPath);
    if (parent.error) return fail(parent.error);

    const attempts = unique ? 999 : 1;
    for (let n = 1; n <= attempts; n++) {
      // New notes are rich text and stored as .html (content fragment only).
      // Existing .txt notes remain plain text and are still supported.
      const candidate = n === 1 ? check.name : `${check.name} ${n}`;
      const filePath = path.join(parent.dir, candidate + '.html');
      debugLog('Creating file at:', filePath);

      try {
        // 'wx' creates the file only if it does not exist — an existing
        // note can never be truncated by a create, even in a race.
        const handle = await fsp.open(filePath, 'wx');
        await handle.close();
        knownRevs.set(path.resolve(filePath), revOf(Buffer.alloc(0)));
        return { success: true, path: filePath };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!unique) return fail('File already exists');
      }
    }
    return fail('Could not find a free name');
  } catch (error) {
    console.error('Error creating file:', error.message);
    return fail(error.message);
  }
}

/**
 * Read a note.
 * @param {string} filePath - Path to the file
 * @returns {Promise<Object>} Result object with success flag and content or error
 */
async function readFile(filePath) {
  try {
    const stats = await fsp.stat(filePath);
    if (!stats.isFile()) {
      return fail('Not a file');
    }
    if (stats.size > MAX_NOTE_BYTES) {
      const mb = (stats.size / (1024 * 1024)).toFixed(0);
      return fail(`This file is too large to open (${mb} MB)`);
    }

    const buffer = await fsp.readFile(filePath);
    if (looksBinary(buffer)) {
      // Opening binary data as text and auto-saving it would corrupt it
      return fail("This file doesn't look like a text note");
    }

    knownRevs.set(path.resolve(filePath), revOf(buffer));
    debugLog('File read:', filePath);
    return { success: true, content: buffer.toString('utf8') };
  } catch (error) {
    console.error('Error reading file:', error.message);
    if (error.code === 'ENOENT') return fail('This note no longer exists', { code: 'ENOENT' });
    return fail(error.message);
  }
}

/**
 * Build a timestamp like "2026-11-16 21.04.33" (safe in file names).
 * @param {Date} date
 * @returns {string}
 */
function fileStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}`;
}

/**
 * Preserve the current on-disk version of a note next to it, as
 * "<name> (conflict <timestamp>).<ext>". Never overwrites anything.
 * @param {string} filePath - The note about to be overwritten
 * @param {Buffer} diskContent - Its current bytes
 * @returns {Promise<string>} Path of the copy
 */
async function writeConflictCopy(filePath, diskContent) {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const stamp = fileStamp(new Date());

  for (let n = 1; n <= 99; n++) {
    const suffix = n === 1 ? '' : ` ${n}`;
    const copyPath = path.join(dir, `${base} (conflict ${stamp}${suffix})${ext}`);
    try {
      const handle = await fsp.open(copyPath, 'wx');
      try {
        await handle.writeFile(diskContent);
        await handle.sync();
      } finally {
        await handle.close();
      }
      knownRevs.set(path.resolve(copyPath), revOf(diskContent));
      return copyPath;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Could not create a conflict copy');
}

/**
 * Save content to a note (atomic: temp file + rename).
 *
 * If the file changed on disk since the app last read or wrote it, the
 * on-disk version is first preserved as a conflict copy and its path is
 * returned as `conflictCopy`, so an edit made outside NeatNote is never
 * silently overwritten.
 * @param {string} filePath - Path to the file
 * @param {string} content - Content to save
 * @returns {Promise<Object>} Result object with success flag or error
 */
async function saveFile(filePath, content) {
  if (typeof content !== 'string') {
    return fail('Invalid note content');
  }
  const next = Buffer.from(content, 'utf8');
  if (next.length > MAX_NOTE_BYTES) {
    return fail('This note is too large to save');
  }

  const key = path.resolve(filePath);
  return withPathLock(key, async () => {
    try {
      const nextRev = revOf(next);
      let conflictCopy = null;

      let current = null;
      try {
        current = await fsp.readFile(filePath);
      } catch (error) {
        if (error.code === 'EISDIR') return fail('Not a file');
        // ENOENT (deleted outside the app) or unreadable: nothing to
        // compare against — fall through and (re)create the file below.
      }

      if (current) {
        const diskRev = revOf(current);
        if (diskRev === nextRev) {
          // Already on disk byte-for-byte — nothing to write
          knownRevs.set(key, nextRev);
          return { success: true };
        }
        const known = knownRevs.get(key);
        if (known !== undefined && diskRev !== known) {
          conflictCopy = await writeConflictCopy(filePath, current);
          debugLog('External change detected; kept copy at', conflictCopy);
        }
      }

      try {
        await atomicWrite(filePath, next);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        // The containing folder was removed outside the app. Recreate it
        // rather than lose the note that is open in the editor.
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        await atomicWrite(filePath, next);
      }

      knownRevs.set(key, nextRev);
      debugLog('File saved:', filePath);
      return conflictCopy ? { success: true, conflictCopy } : { success: true };
    } catch (error) {
      console.error('Error saving file:', error.message);
      return fail(error.message);
    }
  });
}

/**
 * Report whether a note changed on disk since the app last read or wrote it.
 * @param {string} filePath - Path to the note
 * @returns {Promise<{success: boolean, exists?: boolean, changed?: boolean}>}
 */
async function checkExternalChange(filePath) {
  try {
    let buffer;
    try {
      buffer = await fsp.readFile(filePath);
    } catch (error) {
      if (error.code === 'ENOENT') return { success: true, exists: false, changed: true };
      throw error;
    }
    const known = knownRevs.get(path.resolve(filePath));
    return {
      success: true,
      exists: true,
      changed: known !== undefined && revOf(buffer) !== known
    };
  } catch (error) {
    return fail(error.message);
  }
}

/**
 * List the visible contents of a directory, in natural name order.
 * (The caller applies any saved custom order on top.)
 * @param {string} dirPath - Path to directory, or null for root
 * @param {string} userDataPath - User data path
 * @returns {Promise<Object>} Result object with success flag and files array or error
 */
async function listFiles(dirPath, userDataPath) {
  try {
    const rootDir = dirPath || getNotesRoot(userDataPath);
    debugLog('Listing files in:', rootDir);

    // Only the notes root is created on demand. Creating an arbitrary
    // listed path would bring back a folder deleted outside the app.
    if (!dirPath) {
      await fsp.mkdir(rootDir, { recursive: true });
    }

    let items;
    try {
      items = await fsp.readdir(rootDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        return fail('That folder no longer exists', { code: 'ENOENT' });
      }
      throw error;
    }

    const files = items
      // Hides temp files left by an interrupted atomic write and OS
      // bookkeeping files (.DS_Store, Thumbs.db, ...)
      .filter(item => isVisibleName(item.name))
      .map(item => ({
        name: item.name,
        path: path.join(rootDir, item.name),
        isDirectory: item.isDirectory(),
      }))
      .sort((a, b) => collator.compare(a.name, b.name));

    return { success: true, files };
  } catch (error) {
    console.error('Error listing files:', error.message);
    return fail(error.message);
  }
}

/**
 * Move a file or folder into another directory.
 * @param {string} sourcePath - Source file path
 * @param {string} targetDir - Target directory path or null for root
 * @param {string} userDataPath - User data path
 * @returns {Promise<Object>} Result object with success flag and new path or error
 */
async function moveFile(sourcePath, targetDir, userDataPath) {
  return withPathLock(path.resolve(sourcePath), () =>
    moveFileUnlocked(sourcePath, targetDir, userDataPath)
  );
}

async function moveFileUnlocked(sourcePath, targetDir, userDataPath) {
  try {
    let sourceStats;
    try {
      sourceStats = await fsp.lstat(sourcePath);
    } catch {
      return fail('File does not exist');
    }
    const isDirectory = sourceStats.isDirectory();

    const fileName = path.basename(sourcePath);
    const parent = await resolveParentDir(targetDir, userDataPath);
    if (parent.error) return fail(parent.error);
    const destDir = parent.dir;

    // Reject moving an item into itself or its own descendant. Enforced
    // here (the trust boundary) with symlink-resolved paths, and
    // case-insensitively on Windows/macOS where the filesystem is —
    // the renderer's string-prefix check alone is not sufficient.
    const norm = (p) =>
      (process.platform === 'win32' || process.platform === 'darwin')
        ? p.toLowerCase()
        : p;
    const realSource = norm(await realResolve(sourcePath));
    const realDest = norm(await realResolve(destDir));
    if (realDest === realSource || realDest.startsWith(realSource + path.sep)) {
      return fail('Cannot move a folder into itself');
    }

    const targetPath = path.join(destDir, fileName);
    debugLog('Moving file from', sourcePath, 'to', targetPath);

    // Skip if source and destination are the same
    if (path.resolve(sourcePath) === path.resolve(targetPath)) {
      return { success: true, newPath: targetPath, isDirectory, unchanged: true };
    }

    // Check if target already exists to avoid overwriting
    if (await exists(targetPath)) {
      return fail('An item with the same name already exists in the target folder');
    }

    try {
      // A rename is atomic: the item is at the old path or the new one,
      // never duplicated or half-copied if the app dies mid-move.
      await renameWithRetry(sourcePath, targetPath);
    } catch (error) {
      if (error.code !== 'EXDEV' || isDirectory) throw error;
      // Different volume (not expected inside the notes folder, but safe):
      // copy without ever overwriting, then remove the source.
      await fsp.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
      await fsp.unlink(sourcePath);
    }

    rekeyRevs(sourcePath, targetPath);
    return { success: true, newPath: targetPath, isDirectory };
  } catch (error) {
    console.error('Error moving file:', error.message);
    return fail(error.message);
  }
}

/**
 * Move a file or folder to the operating system trash / recycle bin
 * (recoverable), rather than permanently deleting it. If the OS trash is
 * unavailable (some minimal Linux environments), the operation fails with
 * an error instead of silently falling back to a hard delete.
 * @param {string} itemPath - Path to the item to delete
 * @returns {Promise<Object>} Result object with success flag or error
 */
async function deleteItem(itemPath) {
  return withPathLock(path.resolve(itemPath), async () => {
    try {
      let stats;
      try {
        stats = await fsp.lstat(itemPath);
      } catch {
        return fail('Item does not exist');
      }

      debugLog('Moving to trash:', itemPath);
      await trashImpl(path.resolve(itemPath));

      forgetRevs(itemPath);
      return { success: true, isDirectory: stats.isDirectory() };
    } catch (error) {
      console.error('Error moving item to trash:', error.message);
      return fail(error.message);
    }
  });
}

/**
 * Rename a file or folder in place. For files, the original extension is
 * preserved (the new name should not include an extension).
 * @param {string} itemPath - Current path of the item
 * @param {string} newName - New name (without extension for files)
 * @returns {Promise<Object>} Result object with success flag and new path or error
 */
async function renameItem(itemPath, newName) {
  return withPathLock(path.resolve(itemPath), () =>
    renameItemUnlocked(itemPath, newName)
  );
}

async function renameItemUnlocked(itemPath, newName) {
  try {
    let stats;
    try {
      stats = await fsp.lstat(itemPath);
    } catch {
      return fail('Item does not exist');
    }
    const isDirectory = stats.isDirectory();

    const check = validateName(newName);
    if (!check.valid) {
      return fail(check.error);
    }

    const dir = path.dirname(itemPath);
    const finalName = isDirectory
      ? check.name
      : check.name + path.extname(itemPath);
    const targetPath = path.join(dir, finalName);

    if (path.resolve(targetPath) === path.resolve(itemPath)) {
      return { success: true, newPath: itemPath, isDirectory, unchanged: true };
    }

    // On case-insensitive filesystems, renaming "note" to "Note" finds the
    // target "already existing" — because it is the same file. Only a
    // DIFFERENT existing item blocks the rename. Both conditions must hold
    // (names differ only by case AND the OS says it is one file), so an
    // unreliable file id on an unusual filesystem can never let a rename
    // replace another note.
    if (await exists(targetPath)) {
      const caseOnly = finalName.toLowerCase() === path.basename(itemPath).toLowerCase();
      if (!caseOnly || !(await isSameFile(itemPath, targetPath))) {
        return fail('An item with that name already exists');
      }
    }

    debugLog('Renaming', itemPath, 'to', targetPath);
    await renameWithRetry(itemPath, targetPath);

    rekeyRevs(itemPath, targetPath);
    return { success: true, newPath: targetPath, isDirectory };
  } catch (error) {
    console.error('Error renaming item:', error.message);
    return fail(error.message);
  }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Reduce a saved note (an HTML fragment) to its visible text.
 * Only used to build search text and snippets — never rendered as HTML.
 * @param {string} html
 * @returns {string}
 */
function htmlToText(html) {
  return html
    // Block boundaries become spaces so words on adjacent lines don't fuse
    .replace(/<\/?(p|div|li|h[1-6]|blockquote|pre|br|hr|ol|ul|tr|td|th)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
      const lower = code.toLowerCase();
      if (lower[0] === '#') {
        const point = lower[1] === 'x' ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
        try {
          return Number.isFinite(point) ? String.fromCodePoint(point) : match;
        } catch {
          return match;
        }
      }
      return Object.prototype.hasOwnProperty.call(ENTITIES, lower) ? ENTITIES[lower] : match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** Name shown for a note: ".html" is an implementation detail, hide it. */
function displayNameOf(fileName) {
  return fileName.replace(/\.html?$/i, '');
}

/**
 * Cut a short excerpt of `text` around the match at `index`.
 */
function snippetAround(text, index, matchLength) {
  // Little context before the match: the sidebar is narrow and the row is
  // a single line, so the matched words must sit near the start to be seen
  const start = Math.max(0, index - 14);
  const end = Math.min(text.length, index + matchLength + 70);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

/**
 * Test one file against a lowercased query.
 * @returns {Promise<Object|null>} A result row, or null when it doesn't match
 */
async function matchFile(file, query) {
  const nameMatch = displayNameOf(file.name).toLowerCase().includes(query);
  let snippet = null;

  if (SEARCHABLE_EXT.test(file.name)) {
    try {
      const stats = await fsp.stat(file.path);
      if (stats.isFile() && stats.size <= MAX_SEARCH_BYTES) {
        const raw = await fsp.readFile(file.path, 'utf8');
        const text = /\.html?$/i.test(file.name) ? htmlToText(raw) : raw.replace(/\s+/g, ' ');
        const index = text.toLowerCase().indexOf(query);
        if (index !== -1) snippet = snippetAround(text, index, query.length);
      }
    } catch {
      // Unreadable file: it can still match by name
    }
  }

  if (!nameMatch && snippet === null) return null;
  const result = { name: file.name, path: file.path, isDirectory: false };
  if (snippet !== null) result.snippet = snippet;
  return result;
}

/**
 * Search every note and folder under the notes root by name, and notes by
 * content. Runs entirely in the main process — one request from the
 * renderer instead of one per folder — and is breadth-first, so results
 * near the top of the tree come first.
 * @param {string} query - Text to look for (case-insensitive)
 * @param {string} userDataPath - User data path
 * @param {Object} [options]
 * @param {number} [options.limit=200] - Maximum number of results
 * @returns {Promise<{success: boolean, results: Array, truncated: boolean}>}
 */
async function searchNotes(query, userDataPath, { limit = 200 } = {}) {
  // Whitespace is normalized the same way as the text being searched
  const q = (typeof query === 'string' ? query : '').trim().toLowerCase().replace(/\s+/g, ' ');
  const results = [];
  if (!q) return { success: true, results, truncated: false };

  try {
    let truncated = false;
    const queue = [{ dir: getNotesRoot(userDataPath), depth: 0 }];

    while (queue.length > 0 && !truncated) {
      const { dir, depth } = queue.shift();

      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      entries = entries
        .filter(entry => isVisibleName(entry.name))
        .sort((a, b) => collator.compare(a.name, b.name));

      const files = [];
      for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        // Symlinks are neither followed nor read (isDirectory/isFile are
        // both false for them), so search can't wander out of the notes
        // folder or loop.
        if (entry.isDirectory()) {
          if (depth < MAX_DEPTH) queue.push({ dir: entryPath, depth: depth + 1 });
          if (entry.name.toLowerCase().includes(q)) {
            if (results.length >= limit) { truncated = true; break; }
            results.push({ name: entry.name, path: entryPath, isDirectory: true });
          }
        } else if (entry.isFile()) {
          files.push({ name: entry.name, path: entryPath });
        }
      }

      // Read a handful of files at a time: fast, without opening hundreds
      // of file handles at once
      for (let i = 0; i < files.length && !truncated; i += 16) {
        const batch = await Promise.all(files.slice(i, i + 16).map(file => matchFile(file, q)));
        for (const match of batch) {
          if (!match) continue;
          if (results.length >= limit) { truncated = true; break; }
          results.push(match);
        }
      }
    }

    return { success: true, results, truncated };
  } catch (error) {
    console.error('Error searching notes:', error.message);
    return fail(error.message, { results: [], truncated: false });
  }
}

// ---------------------------------------------------------------------------
// Maintenance helpers
// ---------------------------------------------------------------------------

/**
 * List every directory under the notes root (absolute paths, root excluded).
 * @param {string} userDataPath - User data path
 * @returns {Promise<string[]>}
 */
async function listAllDirs(userDataPath) {
  const found = [];
  const queue = [{ dir: getNotesRoot(userDataPath), depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !isVisibleName(entry.name)) continue;
      const entryPath = path.join(dir, entry.name);
      found.push(entryPath);
      if (depth < MAX_DEPTH) queue.push({ dir: entryPath, depth: depth + 1 });
    }
  }
  return found;
}

/**
 * Remove temp files left behind when an atomic write was interrupted (a
 * crash or power loss between "write temp" and "rename into place"). Only
 * files matching this app's own temp-name pattern, and old enough that no
 * running save can still own them, are touched.
 * @param {string} userDataPath - User data path
 * @param {number} [minAgeMs=600000] - Minimum age before a temp file is removed
 * @returns {Promise<number>} Number of files removed
 */
async function cleanupTempFiles(userDataPath, minAgeMs = 10 * 60 * 1000) {
  let removed = 0;
  const root = getNotesRoot(userDataPath);
  const dirs = [root, ...(await listAllDirs(userDataPath))];
  const cutoff = Date.now() - minAgeMs;

  for (const dir of dirs) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !TEMP_FILE.test(entry.name)) continue;
      const tmpPath = path.join(dir, entry.name);
      try {
        const stats = await fsp.stat(tmpPath);
        if (stats.mtimeMs <= cutoff) {
          await fsp.unlink(tmpPath);
          removed += 1;
        }
      } catch {
        // Already gone or not removable — nothing to do
      }
    }
  }
  return removed;
}

module.exports = {
  createFolder,
  createFile,
  readFile,
  saveFile,
  checkExternalChange,
  listFiles,
  moveFile,
  deleteItem,
  renameItem,
  searchNotes,
  listAllDirs,
  cleanupTempFiles,
  atomicWrite,
  whenIdle,
  getNotesRoot,
  isInsideNotes,
  validateName,
  htmlToText,
  displayNameOf,
  setTrashImplementation,
  MAX_NOTE_BYTES
};
