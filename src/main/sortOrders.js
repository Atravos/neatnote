const path = require('path');

/**
 * Custom (drag-and-drop) ordering of the sidebar.
 *
 * Storage format — config.json key "sortOrders":
 *   {
 *     "/":          ["Inbox", "Work", "todo.html"],   // notes root
 *     "/Work":      ["plan.html", "Archive"],
 *     "/Work/日本語": ["メモ.html"]
 *   }
 * Each key is a directory's path RELATIVE to the notes root, always with
 * "/" separators and a leading "/"; each value is the ordered list of item
 * names in that directory. Items missing from the list sort after it, in
 * natural name order.
 *
 * Keys are built here, in the main process, from real paths — the renderer
 * never supplies a key. Because keys are the unmodified relative path:
 *   - two different folders can never share a key (the previous format
 *     replaced every character outside [a-zA-Z0-9_-] with "_", so
 *     "日本語" / "中国語" or "My Notes" / "My_Notes" collided), and
 *   - the leading "/" keeps every key clear of special object property
 *     names and of the root's own key.
 *
 * The previous format lived under the "sortOrder" key. It is read once by
 * migrateLegacy() and then left untouched, so downgrading keeps working.
 */

const STORE_KEY = 'sortOrders';
const LEGACY_STORE_KEY = 'sortOrder';
const ROOT_KEY = '/';
const MAX_ENTRIES = 20000;
const MAX_NAME_LENGTH = 255;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidOrder(order) {
  return Array.isArray(order)
    && order.length <= MAX_ENTRIES
    && order.every(name => typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME_LENGTH);
}

/**
 * Key the previous storage format used for a directory (relative path with
 * each segment sanitized). Only needed to find old entries when migrating.
 * @param {string} relativePath - Path relative to the notes root ('' for root)
 * @returns {string}
 */
function legacyKeyFor(relativePath) {
  const key = relativePath
    .split(/[/\\]/)
    .map(segment => segment.replace(/[^a-zA-Z0-9_-]/g, '_'))
    .filter(Boolean)
    .join('/');
  return key || '_root';
}

/**
 * Sort directory entries by a saved order. Entries the order doesn't
 * mention keep their incoming (natural) order and follow the listed ones.
 * @param {Array<{name: string}>} items - Entries, already in natural order
 * @param {string[]|null} order - Saved order, or null
 * @returns {Array} New sorted array
 */
function applyOrder(items, order) {
  if (!Array.isArray(order) || order.length === 0) return items;
  const position = new Map();
  order.forEach((name, index) => {
    if (!position.has(name)) position.set(name, index);
  });
  // Array.prototype.sort is stable, so unlisted items keep their order
  return [...items].sort((a, b) => {
    const pa = position.has(a.name) ? position.get(a.name) : Number.MAX_SAFE_INTEGER;
    const pb = position.has(b.name) ? position.get(b.name) : Number.MAX_SAFE_INTEGER;
    return pa === pb ? 0 : (pa < pb ? -1 : 1);
  });
}

class SortOrders {
  /**
   * @param {Object} store - electron-store instance (get / set / has)
   * @param {string} notesRoot - Absolute path of the notes root
   */
  constructor(store, notesRoot) {
    this.store = store;
    this.root = path.resolve(notesRoot);
  }

  /**
   * Storage key for a directory.
   * @param {string|null} dirPath - Absolute directory path (null = root)
   * @returns {string|null} Key, or null if the path is not under the root
   */
  keyFor(dirPath) {
    if (dirPath === null || dirPath === undefined) return ROOT_KEY;
    if (typeof dirPath !== 'string' || dirPath.length === 0) return null;
    const target = path.resolve(dirPath);
    if (target === this.root) return ROOT_KEY;
    if (!target.startsWith(this.root + path.sep)) return null;
    return ROOT_KEY + target.slice(this.root.length + 1).split(path.sep).join('/');
  }

  /** @returns {Object} Every saved order, keyed by directory key */
  all() {
    const value = this.store.get(STORE_KEY);
    return isPlainObject(value) ? { ...value } : {};
  }

  /**
   * @param {string|null} dirPath
   * @returns {string[]|null} Saved order for the directory, or null
   */
  get(dirPath) {
    const key = this.keyFor(dirPath);
    if (key === null) return null;
    const all = this.all();
    const order = Object.prototype.hasOwnProperty.call(all, key) ? all[key] : null;
    return isValidOrder(order) ? order : null;
  }

  /**
   * @param {string|null} dirPath
   * @param {string[]} order
   * @returns {boolean} Whether the order was saved
   */
  set(dirPath, order) {
    const key = this.keyFor(dirPath);
    if (key === null || !isValidOrder(order)) return false;
    const all = this.all();
    all[key] = [...new Set(order)];
    this.store.set(STORE_KEY, all);
    return true;
  }

  /**
   * Sort a directory listing by its saved order.
   * @param {string|null} dirPath
   * @param {Array<{name: string}>} items
   * @returns {Array}
   */
  apply(dirPath, items) {
    return applyOrder(items, this.get(dirPath));
  }

  /**
   * Place `name` immediately before or after `refName` in a directory's
   * order. The order is rebuilt from the directory's actual contents, so
   * stale names are dropped and unlisted items get an explicit position.
   * @param {string|null} dirPath
   * @param {string[]} currentNames - Names actually in the directory, in
   *        their currently displayed order
   * @param {string} name - Item being placed
   * @param {string} refName - Item it is placed next to
   * @param {'before'|'after'} position
   * @returns {boolean} Whether an order was saved
   */
  place(dirPath, currentNames, name, refName, position) {
    if (!currentNames.includes(name)) return false;
    const order = currentNames.filter(n => n !== name);
    let index = order.indexOf(refName);
    if (index === -1) {
      index = order.length;
    } else if (position === 'after') {
      index += 1;
    }
    order.splice(index, 0, name);
    return this.set(dirPath, order);
  }

  /** Remove one name from a directory's order (item deleted or moved away). */
  removeName(dirPath, name) {
    const order = this.get(dirPath);
    if (!order || !order.includes(name)) return;
    this.set(dirPath, order.filter(n => n !== name));
  }

  /** Keep an item's position when it is renamed in place. */
  renameName(dirPath, oldName, newName) {
    if (oldName === newName) return;
    const order = this.get(dirPath);
    if (!order || !order.includes(oldName)) return;
    // Drop any stale entry already using the new name, then swap in place
    const next = order.filter(n => n !== newName);
    next[next.indexOf(oldName)] = newName;
    this.set(dirPath, next);
  }

  /**
   * Forget the order of a directory and of everything beneath it
   * (the directory was deleted).
   * @param {string} dirPath
   */
  removeTree(dirPath) {
    const key = this.keyFor(dirPath);
    if (key === null || key === ROOT_KEY) return;
    const all = this.all();
    let changed = false;
    for (const k of Object.keys(all)) {
      if (k === key || k.startsWith(key + '/')) {
        delete all[k];
        changed = true;
      }
    }
    if (changed) this.store.set(STORE_KEY, all);
  }

  /**
   * Carry the order of a directory, and of everything beneath it, over to
   * a new path (the directory was renamed or moved).
   * @param {string} oldPath
   * @param {string} newPath
   */
  moveTree(oldPath, newPath) {
    const oldKey = this.keyFor(oldPath);
    const newKey = this.keyFor(newPath);
    if (oldKey === null || newKey === null) return;
    if (oldKey === ROOT_KEY || newKey === ROOT_KEY || oldKey === newKey) return;

    const all = this.all();
    const next = {};
    let changed = false;
    for (const k of Object.keys(all)) {
      if (k === oldKey) {
        next[newKey] = all[k];
        changed = true;
      } else if (k.startsWith(oldKey + '/')) {
        next[newKey + k.slice(oldKey.length)] = all[k];
        changed = true;
      } else if (!Object.prototype.hasOwnProperty.call(next, k)) {
        next[k] = all[k];
      }
    }
    if (changed) this.store.set(STORE_KEY, next);
  }

  /**
   * One-time migration from the previous "sortOrder" format. For every
   * existing directory, the entry the old (lossy) key scheme would have
   * used is copied to the new exact key. Old keys that collided are copied
   * to each directory that shared them — the same order both already saw.
   * The legacy data itself is left in place.
   * @param {string[]} existingDirs - Absolute paths of every directory
   *        under the notes root (root excluded)
   * @returns {boolean} Whether a migration was performed
   */
  migrateLegacy(existingDirs) {
    if (this.store.has(STORE_KEY)) return false;

    const legacy = this.store.get(LEGACY_STORE_KEY);
    const next = {};

    if (isPlainObject(legacy)) {
      const copy = (legacyKey, key) => {
        const order = Object.prototype.hasOwnProperty.call(legacy, legacyKey) ? legacy[legacyKey] : null;
        if (isValidOrder(order)) next[key] = [...order];
      };

      copy('_root', ROOT_KEY);
      for (const dir of existingDirs) {
        const key = this.keyFor(dir);
        if (key === null || key === ROOT_KEY) continue;
        copy(legacyKeyFor(key.slice(1)), key);
      }
    }

    this.store.set(STORE_KEY, next);
    return true;
  }
}

module.exports = {
  SortOrders,
  applyOrder,
  legacyKeyFor,
  collator,
  STORE_KEY,
  LEGACY_STORE_KEY
};
