import { icons } from '../utils/icons.js';
import { showToast } from '../services/toast.js';
import { showContextMenu, closeContextMenu } from './contextMenu.js';
import { baseName, parentDir, displayName, isWithinPath } from '../utils/paths.js';

const ROW_SELECTOR = '.folder, .file';

/** Platform string from the preload ('win32' | 'darwin' | 'linux') */
const PLATFORM = (window.api && window.api.windowControls && window.api.windowControls.platform) || 'win32';
const IS_MAC = PLATFORM === 'darwin';
const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';
const REVEAL_LABEL = IS_MAC
  ? 'Reveal in Finder'
  : (PLATFORM === 'win32' ? 'Show in Explorer' : 'Show in File Manager');

/** Where the set of expanded folders is remembered between launches */
const EXPANDED_KEY = 'neatnote-expanded-folders';
const MAX_REMEMBERED_FOLDERS = 500;

/**
 * FolderTreeComponent - Manages the folder tree sidebar.
 *
 * Rendering: the whole tree (the top level plus every expanded folder) is
 * fetched first, built off-screen, and swapped in with one DOM operation.
 * A refresh therefore never flickers, never shows a half-loaded subtree,
 * and keeps the scroll position; a refresh that finds nothing changed
 * doesn't touch the DOM at all.
 *
 * Interaction: one set of delegated listeners on the container handles
 * clicks, double-click rename, the right-click menu, and keyboard
 * navigation (it is an ARIA tree with a roving tab stop). Drag and drop is
 * handled by DragDropService, also via delegation.
 *
 * The sidebar's custom order is stored and applied in the main process;
 * listings arrive here already in display order.
 */
export class FolderTreeComponent {
  constructor(container, fileService, editorComponent, dragDropService, modalComponent) {
    this.container = container;
    this.fileService = fileService;
    this.editorComponent = editorComponent;
    this.dragDropService = dragDropService;
    this.modalComponent = modalComponent;
    this.filterQuery = '';

    // Paths of folders the user has expanded, so refreshes (rename, move,
    // delete, create) can restore the open subtree instead of collapsing
    // the whole sidebar. Remembered across launches too.
    this.expandedPaths = this.loadExpandedState();

    // Monotonic counter guarding against stale async renders: only the
    // most recently started load is allowed to touch the DOM
    this.loadGeneration = 0;

    // Fingerprint of what is currently rendered; lets a refresh skip the
    // DOM entirely when nothing changed
    this.lastSignature = null;

    // Path of the row that owns the keyboard tab stop
    this.currentPath = null;

    // Notes root path, fetched once; used to tell top-level items apart
    this.notesRoot = null;

    this.container.setAttribute('role', 'tree');
    this.container.setAttribute('aria-label', 'Notes');

    this.dragDropService.setupContainer(this.container, {
      onReorder: (draggedPath, refPath, position) => this.handleReorder(draggedPath, refPath, position),
      onMoveInto: (sourcePath, targetPath) => this.handleItemDrop(sourcePath, targetPath),
      onDropAtEnd: (sourcePath) => this.handleDropAtEnd(sourcePath)
    });

    this.setupEvents();
    this.ready = this.init();
  }

  /**
   * Fetch the notes root, then render.
   */
  async init() {
    try {
      this.notesRoot = await this.fileService.getNotesRoot();
    } catch (error) {
      console.error('Could not fetch notes root:', error);
    }
    await this.loadFileStructure();
  }

  // ---- Path helpers ---------------------------------------------------------

  /**
   * Whether a directory path is the notes root (trailing separators
   * ignored). A null/undefined path also means root.
   * @param {string|null} dirPath
   * @returns {boolean}
   */
  isRootPath(dirPath) {
    if (dirPath === null || dirPath === undefined) return true;
    if (!this.notesRoot) return false;
    const trim = (p) => p.replace(/[/\\]+$/, '');
    return trim(dirPath) === trim(this.notesRoot);
  }

  /**
   * Directory argument for the file service: null for the top level.
   * @param {string|null} dirPath
   * @returns {string|null}
   */
  toDirArg(dirPath) {
    return this.isRootPath(dirPath) ? null : dirPath;
  }

  /**
   * Find the rendered row for a path.
   * @param {string} itemPath
   * @returns {HTMLElement|null}
   */
  rowForPath(itemPath) {
    if (!itemPath) return null;
    for (const row of this.container.querySelectorAll(ROW_SELECTOR)) {
      if (row.getAttribute('data-path') === itemPath) return row;
    }
    return null;
  }

  /** Rows that are currently displayed, in visual order. */
  visibleRows() {
    return Array.from(this.container.querySelectorAll(ROW_SELECTOR))
      .filter(row => row.offsetParent !== null);
  }

  isFolderRow(row) {
    return !!row && row.classList.contains('folder');
  }

  // ---- Expanded-state bookkeeping -------------------------------------------

  /**
   * Read the folders that were expanded when the app was last used.
   * Entries for folders that no longer exist are dropped as the tree is
   * built (see buildModel).
   * @returns {Set<string>}
   */
  loadExpandedState() {
    try {
      const saved = JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]');
      if (Array.isArray(saved)) {
        return new Set(saved.filter(p => typeof p === 'string').slice(0, MAX_REMEMBERED_FOLDERS));
      }
    } catch (error) {
      // Corrupt or unavailable storage: start with everything collapsed
    }
    return new Set();
  }

  /** Remember the expanded folders for the next launch. */
  saveExpandedState() {
    try {
      localStorage.setItem(
        EXPANDED_KEY,
        JSON.stringify([...this.expandedPaths].slice(0, MAX_REMEMBERED_FOLDERS))
      );
    } catch (error) {
      // A convenience only
    }
  }

  /**
   * Re-key expanded paths when a folder is renamed or moved so its open
   * subtree survives the refresh.
   */
  updateExpandedPrefix(oldPath, newPath) {
    const updated = new Set();
    for (const p of this.expandedPaths) {
      updated.add(isWithinPath(p, oldPath) ? newPath + p.slice(oldPath.length) : p);
    }
    this.expandedPaths = updated;
  }

  /**
   * Drop expanded entries for a deleted folder and its descendants.
   */
  removeExpandedPrefix(itemPath) {
    for (const p of [...this.expandedPaths]) {
      if (isWithinPath(p, itemPath)) this.expandedPaths.delete(p);
    }
  }

  // ---- Loading ----------------------------------------------------------------

  /**
   * Fetch a directory and, recursively, every expanded folder inside it.
   * @param {string|null} dirPath - Directory (null for the top level)
   * @returns {Promise<Array|null>} Items in display order, or null if the
   *          directory could not be listed
   */
  async buildModel(dirPath) {
    const listing = await this.fileService.listFiles(dirPath);
    if (!listing.success) return null;

    return Promise.all(listing.files.map(async (file) => {
      const item = {
        name: file.name,
        path: file.path,
        isDirectory: !!file.isDirectory,
        children: null
      };
      if (item.isDirectory && this.expandedPaths.has(item.path)) {
        const children = await this.buildModel(item.path);
        if (children) {
          item.children = children;
        } else {
          // Folder vanished between listings
          this.expandedPaths.delete(item.path);
        }
      }
      return item;
    }));
  }

  /**
   * (Re)load whatever the sidebar should currently show.
   * @param {Object} [options]
   * @param {boolean} [options.force=false] - Re-render even if the
   *        content looks unchanged
   */
  async loadFileStructure({ force = false } = {}) {
    // Every (re)load claims a new generation; any async work belonging to
    // an older generation bails before touching the DOM, so a slow listing
    // can never render over a newer one
    const generation = ++this.loadGeneration;
    try {
      // If a filter is active, show search results instead of the tree
      if (this.filterQuery) {
        await this.renderSearchResults(this.filterQuery, generation);
        return;
      }

      const model = await this.buildModel(null);
      if (generation !== this.loadGeneration) return;

      if (!model) {
        showToast('Could not load notes', 'error');
        return;
      }

      // Only names, types and nesting affect what is drawn
      const signature = JSON.stringify(model, ['name', 'isDirectory', 'children']);
      if (!force && signature === this.lastSignature) {
        this.highlightActiveFile();
        return;
      }

      this.renderTree(model);
      this.lastSignature = signature;
      // Every change to the expanded set is followed by a render, so this
      // one call keeps the remembered state current
      this.saveExpandedState();
    } catch (error) {
      console.error('Error in loadFileStructure:', error);
    }
  }

  /**
   * Set the search filter. An empty query restores the normal tree view.
   * @param {string} query - Case-insensitive text to look for
   */
  async setFilter(query) {
    const next = (query || '').trim().toLowerCase();
    if (next === this.filterQuery) return;
    this.filterQuery = next;
    this.lastSignature = null;
    await this.loadFileStructure();
  }

  /** Reload the sidebar after an operation that changed it. */
  refresh() {
    return this.loadFileStructure({ force: true });
  }

  /**
   * Reload only if something actually changed on disk (used when the
   * window regains focus). Skipped mid-drag so a drag is never interrupted.
   */
  refreshIfChanged() {
    if (this.dragDropService.isDragging()) return Promise.resolve();
    return this.loadFileStructure();
  }

  // ---- Rendering ----------------------------------------------------------------

  /**
   * Swap freshly built content into the sidebar, keeping the scroll
   * position and — if the sidebar had it — keyboard focus.
   * @param {DocumentFragment} fragment
   */
  commit(fragment) {
    const hadFocus = this.container.contains(document.activeElement);
    const scrollTop = this.container.scrollTop;

    closeContextMenu();
    this.container.replaceChildren(fragment);
    this.container.scrollTop = scrollTop;

    this.highlightActiveFile();
    this.updateTabStop();
    if (hadFocus) {
      const row = this.rowForPath(this.currentPath) || this.visibleRows()[0];
      if (row) row.focus({ preventScroll: true });
    }
  }

  /**
   * Render the normal tree view.
   * @param {Array} model - Output of buildModel(null)
   */
  renderTree(model) {
    const fragment = document.createDocumentFragment();
    if (model.length === 0) {
      fragment.appendChild(this.createMessage(
        'No notes yet',
        `Press ${MOD_LABEL}N to create one — or just start typing.`
      ));
    } else {
      this.appendItems(model, fragment, 1);
    }
    this.container.classList.remove('search-mode');
    this.commit(fragment);
  }

  /**
   * Build rows for a list of items.
   * @param {Array} items - Model items
   * @param {Node} parent - Where to append them
   * @param {number} level - 1-based nesting depth (for assistive tech)
   */
  appendItems(items, parent, level) {
    for (const item of items) {
      if (item.isDirectory) {
        this.appendFolder(item, parent, level);
      } else {
        parent.appendChild(this.createFileRow(item, level));
      }
    }
  }

  /**
   * Create the element shown when there is nothing to list.
   * @param {string} title
   * @param {string} [detail]
   * @returns {HTMLElement}
   */
  createMessage(title, detail) {
    const box = document.createElement('div');
    box.className = 'tree-message';
    const heading = document.createElement('div');
    heading.className = 'tree-message-title';
    heading.textContent = title;
    box.appendChild(heading);
    if (detail) {
      const text = document.createElement('div');
      text.className = 'tree-message-detail';
      text.textContent = detail;
      box.appendChild(text);
    }
    return box;
  }

  /**
   * Create the shared skeleton of a row.
   * @returns {HTMLElement}
   */
  createRow(className, item, level) {
    const row = document.createElement('div');
    row.className = className;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(level));
    row.setAttribute('data-path', item.path);
    row.setAttribute('data-name', item.name);
    row.tabIndex = -1;
    return row;
  }

  appendFolder(item, parent, level) {
    const isOpen = Array.isArray(item.children);

    const row = this.createRow('folder', item, level);
    row.setAttribute('aria-expanded', String(isOpen));
    row.setAttribute('draggable', 'true');
    if (isOpen) row.classList.add('folder-open');

    const toggle = document.createElement('span');
    toggle.className = 'folder-toggle';
    toggle.setAttribute('aria-hidden', 'true');

    const icon = document.createElement('span');
    icon.className = 'folder-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = isOpen ? icons.folderOpen : icons.folder;

    const name = document.createElement('span');
    name.className = 'folder-name';
    name.textContent = item.name;

    row.append(toggle, icon, name);

    const content = document.createElement('div');
    content.className = 'folder-content';
    content.setAttribute('role', 'group');
    if (isOpen) {
      content.dataset.loaded = 'true';
      this.appendItems(item.children, content, level + 1);
    } else {
      content.style.display = 'none';
    }

    parent.append(row, content);
  }

  createFileRow(item, level) {
    const row = this.createRow('file', item, level);
    row.setAttribute('aria-selected', 'false');
    row.setAttribute('draggable', 'true');

    const icon = document.createElement('span');
    icon.className = 'file-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = icons.file;

    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = displayName(item.name);

    row.append(icon, name);
    return row;
  }

  // ---- Search -------------------------------------------------------------------

  /**
   * Where an item lives, relative to the notes root ("Work / Archive").
   * @param {string} itemPath
   * @returns {string} Empty for top-level items
   */
  locationLabel(itemPath) {
    const dir = parentDir(itemPath);
    if (!this.notesRoot || this.isRootPath(dir) || !isWithinPath(dir, this.notesRoot)) return '';
    return dir.slice(this.notesRoot.length).split(/[/\\]/).filter(Boolean).join(' / ');
  }

  /**
   * Fill an element with a snippet, emphasizing the part that matched.
   * Built from text nodes only — search text is never treated as markup.
   */
  fillSnippet(element, snippet, query) {
    const index = snippet.toLowerCase().indexOf(query);
    if (index === -1) {
      element.textContent = snippet;
      return;
    }
    const mark = document.createElement('mark');
    mark.textContent = snippet.slice(index, index + query.length);
    element.append(snippet.slice(0, index), mark, snippet.slice(index + query.length));
  }

  /**
   * Render a flat list of notes and folders matching the current search.
   * The search itself (names and note contents) runs in the main process.
   * Rows open on click and can be renamed; drag is disabled in this view.
   * @param {string} query - Lowercased query
   * @param {number} generation - Load generation this render belongs to
   */
  async renderSearchResults(query, generation) {
    try {
      const response = await this.fileService.searchNotes(query);

      // A newer query or load may have superseded this one while we
      // were searching
      if (query !== this.filterQuery || generation !== this.loadGeneration) return;

      const fragment = document.createDocumentFragment();

      if (!response.success) {
        fragment.appendChild(this.createMessage('Search failed', response.error || ''));
      } else if (response.results.length === 0) {
        fragment.appendChild(this.createMessage('No matches', 'Nothing in your notes contains that text.'));
      } else {
        for (const item of response.results) {
          fragment.appendChild(this.createSearchRow(item, query));
        }
        if (response.truncated) {
          fragment.appendChild(this.createMessage(
            `Showing the first ${response.results.length} matches`,
            'Type more to narrow it down.'
          ));
        }
      }

      this.container.classList.add('search-mode');
      this.lastSignature = null;
      this.commit(fragment);
    } catch (error) {
      console.error('Error in renderSearchResults:', error);
    }
  }

  createSearchRow(item, query) {
    const row = this.createRow(item.isDirectory ? 'folder search-row' : 'file search-row', item, 1);
    if (item.isDirectory) {
      row.title = 'Show in tree';
    } else {
      row.setAttribute('aria-selected', 'false');
    }

    const icon = document.createElement('span');
    icon.className = item.isDirectory ? 'folder-icon' : 'file-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = item.isDirectory ? icons.folder : icons.file;

    const text = document.createElement('span');
    text.className = 'search-row-text';

    const name = document.createElement('span');
    name.className = item.isDirectory ? 'folder-name' : 'file-name';
    name.textContent = displayName(item.name, { isDirectory: item.isDirectory });
    text.appendChild(name);

    // Second line: the matching text if the content matched, otherwise
    // the folder the item lives in
    const detail = document.createElement('span');
    detail.className = 'search-row-detail';
    if (item.snippet) {
      this.fillSnippet(detail, item.snippet, query);
    } else {
      detail.textContent = this.locationLabel(item.path);
    }
    if (detail.textContent) text.appendChild(detail);

    row.append(icon, text);
    return row;
  }

  // ---- Active note / keyboard tab stop ---------------------------------------

  /**
   * Re-apply the "open note" highlight from the editor's active file.
   */
  highlightActiveFile() {
    try {
      const activePath = this.editorComponent && this.editorComponent.getActiveFile
        ? this.editorComponent.getActiveFile()
        : null;

      for (const row of this.container.querySelectorAll('.file')) {
        const isActive = !!activePath && row.getAttribute('data-path') === activePath;
        row.classList.toggle('active', isActive);
        row.setAttribute('aria-selected', String(isActive));
      }
    } catch (error) {
      console.error('Error highlighting active file:', error);
    }
  }

  /**
   * Make exactly one row reachable with Tab (a "roving tab stop"): the
   * row last used, else the open note, else the first row. Arrow keys
   * move between rows from there.
   */
  updateTabStop() {
    const rows = this.visibleRows();
    const activePath = this.editorComponent.getActiveFile();
    const target =
      rows.find(row => row.getAttribute('data-path') === this.currentPath) ||
      rows.find(row => row.getAttribute('data-path') === activePath) ||
      rows[0] ||
      null;

    for (const row of this.container.querySelectorAll(ROW_SELECTOR)) {
      row.tabIndex = row === target ? 0 : -1;
    }
    this.currentPath = target ? target.getAttribute('data-path') : null;
  }

  /**
   * Make a row the current one, optionally moving keyboard focus to it.
   */
  setCurrentRow(row, { focus = false } = {}) {
    if (!row) return;
    this.currentPath = row.getAttribute('data-path');
    for (const other of this.container.querySelectorAll(ROW_SELECTOR)) {
      other.tabIndex = other === row ? 0 : -1;
    }
    if (focus) {
      row.focus({ preventScroll: true });
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  // ---- Events -------------------------------------------------------------------

  /**
   * Row an event happened on (null if it was on empty space).
   */
  rowFromEvent(event) {
    const row = event.target instanceof Element ? event.target.closest(ROW_SELECTOR) : null;
    return row && this.container.contains(row) ? row : null;
  }

  setupEvents() {
    // Single click: open a note / toggle a folder — INSTANTLY. The second
    // click of a double-click (event.detail > 1) is ignored, so a
    // double-click-to-rename opens or toggles exactly once, and single
    // clicks carry no artificial delay. (Do not replace this with a click
    // timer: any added latency here is very noticeable.)
    this.container.addEventListener('click', (event) => {
      const row = this.rowFromEvent(event);
      if (!row || event.detail > 1) return;
      this.setCurrentRow(row);
      this.activateRow(row);
    });

    // Double-click to rename (works in both views)
    this.container.addEventListener('dblclick', (event) => {
      const row = this.rowFromEvent(event);
      if (!row) return;
      this.promptRename(row.getAttribute('data-path'), this.isFolderRow(row));
    });

    this.container.addEventListener('contextmenu', (event) => {
      // Handled here; cancelling also stops the main process's text menu
      event.preventDefault();
      const row = this.rowFromEvent(event);
      if (row) this.setCurrentRow(row);
      this.openContextMenu(row, event.clientX, event.clientY);
    });

    this.container.addEventListener('focusin', (event) => {
      const row = this.rowFromEvent(event);
      if (row && event.target === row) this.setCurrentRow(row);
    });

    this.container.addEventListener('keydown', (event) => this.handleKeyDown(event));
  }

  /**
   * Primary action for a row: open a note, toggle a folder, or (in search
   * results) reveal a folder in the tree.
   */
  activateRow(row) {
    const itemPath = row.getAttribute('data-path');
    if (!this.isFolderRow(row)) {
      // Highlight immediately for instant feedback; the editor confirms
      // (or corrects) it when the note has actually loaded
      for (const other of this.container.querySelectorAll('.file.active')) {
        other.classList.remove('active');
      }
      row.classList.add('active');
      this.editorComponent.openFile(itemPath).then((opened) => {
        if (!opened) this.highlightActiveFile();
      });
    } else if (row.classList.contains('search-row')) {
      this.revealFolder(itemPath);
    } else {
      this.toggleFolder(row);
    }
  }

  /**
   * Keyboard navigation, following the standard tree pattern:
   *   Up/Down - previous/next row        Home/End - first/last row
   *   Right   - open folder, then into it
   *   Left    - close folder, else go to its parent
   *   Enter   - open note / toggle folder    Space - same
   *   F2      - rename          Delete (⌘⌫ on macOS) - move to trash
   *   Menu key / Shift+F10 - context menu
   */
  handleKeyDown(event) {
    const row = this.rowFromEvent(event);
    if (!row || event.target !== row) return;
    if (event.isComposing) return;

    const rows = this.visibleRows();
    const index = rows.indexOf(row);
    const isFolder = this.isFolderRow(row);
    const isSearchRow = row.classList.contains('search-row');
    const isOpen = row.classList.contains('folder-open');
    const itemPath = row.getAttribute('data-path');
    const go = (target) => { if (target) this.setCurrentRow(target, { focus: true }); };

    switch (event.key) {
      case 'ArrowDown':
        go(rows[index + 1]);
        break;
      case 'ArrowUp':
        go(rows[index - 1]);
        break;
      case 'Home':
        go(rows[0]);
        break;
      case 'End':
        go(rows[rows.length - 1]);
        break;
      case 'ArrowRight':
        if (isFolder && !isSearchRow) {
          if (!isOpen) {
            this.toggleFolder(row);
          } else {
            const next = rows[index + 1];
            if (next && row.nextElementSibling && row.nextElementSibling.contains(next)) go(next);
          }
        }
        break;
      case 'ArrowLeft':
        if (isFolder && isOpen && !isSearchRow) {
          this.toggleFolder(row);
        } else {
          const group = row.parentElement;
          if (group && group.classList.contains('folder-content')) {
            go(group.previousElementSibling);
          }
        }
        break;
      case 'Enter':
      case ' ':
        this.activateRow(row);
        break;
      case 'F2':
        this.promptRename(itemPath, isFolder);
        break;
      case 'Delete':
        this.requestDelete(itemPath);
        break;
      case 'Backspace':
        if (!(IS_MAC && event.metaKey)) return;
        this.requestDelete(itemPath);
        break;
      case 'ContextMenu':
        this.openContextMenuForRow(row);
        break;
      case 'F10':
        if (!event.shiftKey) return;
        this.openContextMenuForRow(row);
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  // ---- Context menu ---------------------------------------------------------

  openContextMenuForRow(row) {
    const rect = row.getBoundingClientRect();
    this.openContextMenu(row, rect.left + 24, rect.bottom - 4);
  }

  /**
   * Show the right-click menu for a row, or for the empty area.
   * @param {HTMLElement|null} row
   * @param {number} x
   * @param {number} y
   */
  openContextMenu(row, x, y) {
    const items = [];

    if (!row) {
      items.push(
        { label: 'New Note', hint: `${MOD_LABEL}N`, action: () => this.promptCreate('file', null) },
        { label: 'New Folder', hint: `${MOD_LABEL}${IS_MAC ? '⇧' : 'Shift+'}N`, action: () => this.promptCreate('folder', null) },
        { separator: true },
        { label: 'Open Notes Folder', action: () => this.showInFolder(null) }
      );
    } else {
      const itemPath = row.getAttribute('data-path');
      const isFolder = this.isFolderRow(row);
      const isSearchRow = row.classList.contains('search-row');

      if (isFolder) {
        items.push(
          { label: 'New Note in Folder', action: () => this.promptCreate('file', itemPath) },
          { label: 'New Folder in Folder', action: () => this.promptCreate('folder', itemPath) },
          { separator: true }
        );
        if (isSearchRow) {
          items.push({ label: 'Show in Tree', action: () => this.revealFolder(itemPath) });
        }
      } else {
        items.push({ label: 'Open', action: () => this.activateRow(row) });
      }

      items.push(
        { label: 'Rename', hint: 'F2', action: () => this.promptRename(itemPath, isFolder) },
        { label: REVEAL_LABEL, action: () => this.showInFolder(itemPath) },
        { separator: true },
        { label: 'Move to Trash', hint: IS_MAC ? '⌘⌫' : 'Del', danger: true, action: () => this.requestDelete(itemPath) }
      );
    }

    showContextMenu(x, y, items, { returnFocus: row || null });
  }

  async showInFolder(itemPath) {
    const result = await this.fileService.showInFolder(itemPath);
    if (!result.success) {
      showToast(`Could not open the folder: ${result.error}`, 'error');
    }
  }

  // ---- Folders: expand / collapse / reveal ---------------------------------

  /**
   * Expand or collapse a folder. Contents are fetched the first time a
   * folder is opened, and rendered before the animation starts so the
   * reveal can measure the real height.
   * @param {HTMLElement} row - The folder's row
   */
  async toggleFolder(row) {
    const content = row.nextElementSibling;
    if (!content || !content.classList.contains('folder-content')) return;
    if (row.dataset.busy === 'true') return;

    const itemPath = row.getAttribute('data-path');
    const opening = !row.classList.contains('folder-open');

    try {
      if (opening && content.dataset.loaded !== 'true') {
        row.dataset.busy = 'true';
        this.expandedPaths.add(itemPath);
        const children = await this.buildModel(itemPath);
        if (!row.isConnected) return; // the tree was re-rendered meanwhile

        if (!children) {
          this.expandedPaths.delete(itemPath);
          showToast('That folder no longer exists', 'error');
          this.refresh();
          return;
        }

        const level = Number(row.getAttribute('aria-level')) || 1;
        const fragment = document.createDocumentFragment();
        this.appendItems(children, fragment, level + 1);
        content.replaceChildren(fragment);
        content.dataset.loaded = 'true';
        this.highlightActiveFile();
        this.updateTabStop();
      }

      // Track expansion so refreshes can restore the open subtree. On
      // collapse only the folder itself is forgotten — descendants keep
      // their entries so re-expanding restores the nested state.
      if (opening) {
        this.expandedPaths.add(itemPath);
      } else {
        this.expandedPaths.delete(itemPath);
      }

      this.animateFolder(row, content, opening);
      this.saveExpandedState();
      // What is on screen no longer matches the last full render
      this.lastSignature = null;
    } catch (error) {
      console.error('Error toggling folder:', error);
    } finally {
      delete row.dataset.busy;
    }
  }

  /**
   * Open/close a folder with a smooth height + fade animation.
   * The `folder-open` class on the folder row is the source of truth for
   * state; display is still toggled (after the animation) so closed
   * subtrees cost nothing in layout.
   */
  animateFolder(row, content, opening) {
    const iconElement = row.querySelector('.folder-icon');
    clearTimeout(content._animTimer);

    row.classList.toggle('folder-open', opening);
    row.setAttribute('aria-expanded', String(opening));
    if (iconElement) iconElement.innerHTML = opening ? icons.folderOpen : icons.folder;

    if (opening) {
      content.style.display = 'block';
      content.style.overflow = 'hidden';
      content.style.maxHeight = '0px';
      content.style.opacity = '0';
      requestAnimationFrame(() => {
        // scrollHeight reports full content height even while clipped
        content.style.maxHeight = `${content.scrollHeight}px`;
        content.style.opacity = '1';
      });
      // Release the height cap so lazily-loaded/nested content can grow
      content._animTimer = setTimeout(() => {
        content.style.maxHeight = '';
        content.style.overflow = '';
        content.style.opacity = '';
      }, 200);
    } else {
      content.style.overflow = 'hidden';
      content.style.maxHeight = `${content.scrollHeight}px`;
      requestAnimationFrame(() => {
        content.style.maxHeight = '0px';
        content.style.opacity = '0';
      });
      content._animTimer = setTimeout(() => {
        content.style.display = 'none';
        content.style.maxHeight = '';
        content.style.opacity = '';
        content.style.overflow = '';
      }, 200);
    }
  }

  /**
   * Make sure a note is visible in the tree by expanding the folders that
   * contain it (used when the last open note is restored at startup).
   * @param {string} filePath - Absolute path of the note
   */
  async revealFile(filePath) {
    if (!filePath || this.filterQuery) return;
    let changed = false;
    let current = parentDir(filePath);
    while (current && !this.isRootPath(current)) {
      if (!this.expandedPaths.has(current)) {
        this.expandedPaths.add(current);
        changed = true;
      }
      const parent = parentDir(current);
      if (parent === current) break;
      current = parent;
    }
    if (changed) await this.loadFileStructure();
  }

  /**
   * Reveal a folder in the normal tree view: clears the search filter,
   * expands the folder and all its ancestors, and reloads.
   * @param {string} folderPath - Absolute path of the folder to reveal
   */
  async revealFolder(folderPath) {
    try {
      // Expand the folder and every ancestor up to (but excluding) the root
      let current = folderPath;
      while (current && !this.isRootPath(current)) {
        this.expandedPaths.add(current);
        const parent = parentDir(current);
        if (parent === current) break;
        current = parent;
      }

      // Clear the filter, keeping the search input in sync
      this.filterQuery = '';
      const searchInput = document.getElementById('search-input');
      if (searchInput) searchInput.value = '';

      this.currentPath = folderPath;
      await this.refresh();

      const row = this.rowForPath(folderPath);
      if (row) this.setCurrentRow(row, { focus: true });
    } catch (error) {
      console.error('Error in revealFolder:', error);
    }
  }

  // ---- Create / rename / delete -------------------------------------------

  /**
   * Prompt for a name and create a note or folder.
   * @param {'file'|'folder'} kind
   * @param {string|null} parentPath - Folder to create it in (null = top level)
   * @param {string} [title] - Dialog title (used to re-prompt with an error)
   */
  promptCreate(kind, parentPath, title) {
    const isFile = kind === 'file';
    const where = parentPath ? ` in "${baseName(parentPath)}"` : '';
    const heading = title || (isFile ? `New note${where}` : `New folder${where}`);

    this.modalComponent.show(
      heading,
      async (name) => {
        if (!name) return;

        const dirArg = this.toDirArg(parentPath);
        const result = isFile
          ? await this.fileService.createFile(name, dirArg)
          : await this.fileService.createFolder(name, dirArg);

        if (!result.success) {
          // Re-prompt with the actual reason (already exists, invalid name, ...)
          this.promptCreate(kind, parentPath, `${result.error} — try a different name`);
          return;
        }

        if (dirArg) this.expandedPaths.add(dirArg);
        this.currentPath = result.path;
        await this.refresh();

        if (isFile) {
          // Opening the note also moves the cursor into it, ready to type
          await this.editorComponent.openFile(result.path);
          this.highlightActiveFile();
        }
      },
      { confirmText: 'Create', placeholder: isFile ? 'Note name' : 'Folder name' }
    );
  }

  /**
   * Show the rename modal for an item and apply the rename.
   * @param {string} itemPath - Current path
   * @param {boolean} isDirectory - Whether the item is a folder
   */
  promptRename(itemPath, isDirectory) {
    const currentName = baseName(itemPath);
    // Files are renamed without their extension; the main process preserves it
    const editableName = isDirectory
      ? currentName
      : displayName(currentName, { stripAllExtensions: true });

    this.modalComponent.show(
      `Rename "${displayName(currentName, { isDirectory })}"`,
      async (newName) => {
        if (!newName || newName === editableName) return;

        // Flush pending edits first so no stale-path auto-save can
        // recreate the file under its old name after the rename
        await this.editorComponent.prepareForPathChange(itemPath);

        const result = await this.fileService.renameItem(itemPath, newName);
        if (!result.success) {
          showToast(`Rename failed: ${result.error}`, 'error');
          return;
        }

        this.applyPathChange(itemPath, result.newPath, result.isDirectory);
        await this.refresh();
      },
      { defaultValue: editableName, confirmText: 'Rename' }
    );
  }

  /**
   * Bookkeeping shared by every operation that changes an item's path
   * (rename, move): keeps the editor pointing at the note (or at a note
   * inside a moved folder), and keeps expanded folders and the keyboard
   * tab stop attached to the item. Saved sidebar orders are re-keyed by
   * the main process as part of the operation itself.
   * @param {string} oldPath - Previous absolute path
   * @param {string} newPath - New absolute path
   * @param {boolean} isDirectory - Whether the item is a folder
   */
  applyPathChange(oldPath, newPath, isDirectory) {
    this.editorComponent.updateFilePath(oldPath, newPath);
    if (isDirectory) this.updateExpandedPrefix(oldPath, newPath);
    if (this.currentPath && isWithinPath(this.currentPath, oldPath)) {
      this.currentPath = newPath + this.currentPath.slice(oldPath.length);
    }
  }

  /**
   * Ask for confirmation, then move a note or folder to the system trash.
   * Used by drag-to-trash, the Delete key, and the context menu.
   * @param {string} itemPath
   */
  requestDelete(itemPath) {
    if (!itemPath) return;
    const row = this.rowForPath(itemPath);
    const label = displayName(itemPath, { isDirectory: this.isFolderRow(row) });

    this.modalComponent.showConfirm(
      `Move "${label}" to the trash?`,
      async (confirmed) => {
        if (!confirmed) return;

        try {
          // Flush any pending edits for the affected note first, so the
          // trashed copy holds the latest content and no late auto-save
          // can recreate the file after it's trashed
          await this.editorComponent.prepareForPathChange(itemPath);

          // Keep the tab stop near where the item was
          const rows = this.visibleRows();
          const index = rows.findIndex(r => r.getAttribute('data-path') === itemPath);
          const neighbour = rows.slice(index + 1).find(r => !isWithinPath(r.getAttribute('data-path'), itemPath))
            || rows[index - 1];

          const result = await this.fileService.deleteItem(itemPath);
          if (!result.success) {
            showToast(`Could not move to trash: ${result.error}`, 'error');
            return;
          }

          this.editorComponent.handleFileDeleted(itemPath);
          this.removeExpandedPrefix(itemPath);
          if (neighbour && this.currentPath && isWithinPath(this.currentPath, itemPath)) {
            this.currentPath = neighbour.getAttribute('data-path');
          }
          await this.refresh();
          showToast(`Moved "${label}" to the system trash`, 'success');
        } catch (error) {
          showToast('Could not move to trash', 'error');
          console.error('Error during deletion:', error);
        }
      },
      { confirmText: 'Move to Trash' }
    );
  }

  // ---- Drag and drop ------------------------------------------------------------

  /**
   * Move an item into a directory, keeping the editor and tree state in
   * step. Shows a toast and returns null on failure.
   * @param {string} sourcePath
   * @param {string|null} targetDir - Destination (null = top level)
   * @returns {Promise<Object|null>} The move result, or null if it failed
   */
  async moveItem(sourcePath, targetDir) {
    // Flush pending edits first so no stale-path auto-save can
    // recreate the file at its old location after the move
    await this.editorComponent.prepareForPathChange(sourcePath);

    const result = await this.fileService.moveFile(sourcePath, this.toDirArg(targetDir));
    if (!result.success) {
      showToast(`Move failed: ${result.error}`, 'error');
      return null;
    }
    if (!result.unchanged) {
      this.applyPathChange(sourcePath, result.newPath, result.isDirectory);
    }
    return result;
  }

  /**
   * Place an item before or after a reference item, in the REFERENCE
   * item's directory:
   *   - Same directory: a pure reorder.
   *   - Different directory: a real move there first, then the reorder.
   */
  async handleReorder(draggedPath, refPath, position) {
    try {
      if (!draggedPath || !refPath) return;
      // Dropped on itself or beside something inside itself: nothing to do
      if (isWithinPath(refPath, draggedPath)) return;

      const name = baseName(draggedPath);
      const refDir = parentDir(refPath);

      if (parentDir(draggedPath) !== refDir) {
        const moved = await this.moveItem(draggedPath, refDir);
        if (!moved) return;
      }

      const result = await this.fileService.reorderItem(
        this.toDirArg(refDir), name, baseName(refPath), position
      );
      if (!result.success) {
        console.error('Could not save the new order:', result.error);
      }
      await this.refresh();
    } catch (error) {
      console.error('Error in handleReorder:', error);
    }
  }

  /** Drop INTO a folder (or onto an empty tree, which means the top level). */
  async handleItemDrop(sourcePath, targetPath) {
    try {
      if (targetPath && isWithinPath(targetPath, sourcePath)) return;
      const moved = await this.moveItem(sourcePath, targetPath);
      if (!moved) return;
      if (targetPath) this.expandedPaths.add(targetPath);
      await this.refresh();
    } catch (error) {
      console.error('Error in handleItemDrop:', error);
    }
  }

  /**
   * Dropped in the empty space below the list: the item goes to the top
   * level, after the last top-level item.
   */
  async handleDropAtEnd(sourcePath) {
    try {
      const topLevel = Array.from(this.container.children).filter(el => el.matches(ROW_SELECTOR));
      const last = topLevel[topLevel.length - 1];
      const lastPath = last ? last.getAttribute('data-path') : null;

      if (lastPath && lastPath !== sourcePath && !isWithinPath(lastPath, sourcePath)) {
        await this.handleReorder(sourcePath, lastPath, 'after');
      } else if (!this.isRootPath(parentDir(sourcePath))) {
        await this.handleItemDrop(sourcePath, null);
      }
    } catch (error) {
      console.error('Error in handleDropAtEnd:', error);
    }
  }
}
