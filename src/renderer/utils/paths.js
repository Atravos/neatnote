/**
 * Small path helpers for the renderer.
 *
 * Paths arrive from the main process in the operating system's native
 * form, so every helper accepts both "/" and "\" separators. They are
 * plain string functions — all real validation happens in the main
 * process.
 */

/**
 * Last segment of a path ("a/b/note.html" -> "note.html").
 * @param {string} p
 * @returns {string}
 */
export function baseName(p) {
  const text = String(p || '');
  const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  return index === -1 ? text : text.slice(index + 1);
}

/**
 * Parent directory of a path. A path with no parent is returned unchanged.
 * @param {string} p
 * @returns {string}
 */
export function parentDir(p) {
  const text = String(p || '');
  const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  return index > 0 ? text.slice(0, index) : text;
}

/**
 * Name to show for a note or folder.
 * Rich notes are stored as ".html", which is an implementation detail —
 * it is hidden. Other extensions (".txt", ".md") stay visible so
 * different kinds of note can be told apart, unless `stripAllExtensions`
 * asks for a bare title.
 * @param {string} pathOrName - A path or a bare file name
 * @param {Object} [options]
 * @param {boolean} [options.stripAllExtensions=false]
 * @param {boolean} [options.isDirectory=false] - Folder names are never trimmed
 * @returns {string}
 */
export function displayName(pathOrName, { stripAllExtensions = false, isDirectory = false } = {}) {
  const name = baseName(pathOrName);
  if (isDirectory) return name;

  if (stripAllExtensions) {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  }
  const stripped = name.replace(/\.html?$/i, '');
  return stripped.length > 0 ? stripped : name;
}

/**
 * Whether `candidate` is `parent` itself or something inside it.
 * @param {string} candidate
 * @param {string} parent
 * @returns {boolean}
 */
export function isWithinPath(candidate, parent) {
  if (!candidate || !parent) return false;
  return candidate === parent ||
    candidate.startsWith(parent + '/') ||
    candidate.startsWith(parent + '\\');
}
