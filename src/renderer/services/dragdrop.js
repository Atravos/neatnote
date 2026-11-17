/**
 * DragDropService - Single-delegate drag and drop system.
 *
 * Instead of attaching drag listeners to every row (which causes
 * flickering and scales badly), this uses ONE set of handlers on the tree
 * container. The row under the pointer comes straight from the event
 * target, so working out a drop position costs the same for 10 notes or
 * 10,000 — no per-event scan of every row.
 *
 * Rows opt in with `draggable="true"` and carry their filesystem path in
 * `data-path`.
 */

const ROW_SELECTOR = '.folder, .file';
// Private drag type: dropping a note onto another app or into the editor
// must not paste its file path as text
const DRAG_TYPE = 'application/x-neatnote-item';

function isInside(candidate, parent) {
  return candidate === parent ||
    candidate.startsWith(parent + '/') ||
    candidate.startsWith(parent + '\\');
}

export class DragDropService {
  constructor() {
    this.draggedPath = null;
    this.draggedElement = null;
    this.indicator = null;
    this.highlighted = null;
    this.currentDropAction = null; // { type: 'reorder'|'into'|'end'|'root', ... }
    this.createIndicator();
  }

  /**
   * Create the single visual indicator element used across the entire app.
   */
  createIndicator() {
    this.indicator = document.createElement('div');
    this.indicator.className = 'drop-indicator';
    this.indicator.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.indicator);
  }

  showIndicator(x, y, width) {
    this.indicator.style.left = `${x}px`;
    this.indicator.style.top = `${y}px`;
    this.indicator.style.width = `${Math.max(0, width)}px`;
    this.indicator.classList.add('visible');
  }

  setHighlight(element) {
    if (this.highlighted === element) return;
    if (this.highlighted) this.highlighted.classList.remove('drop-target-highlight');
    this.highlighted = element;
    if (element) element.classList.add('drop-target-highlight');
  }

  /** Remove every drop affordance and forget the pending action. */
  clearDropState() {
    this.indicator.classList.remove('visible');
    this.setHighlight(null);
    this.currentDropAction = null;
  }

  /** End the current drag: clear the dragged item and every affordance. */
  finishDrag() {
    if (this.draggedElement) this.draggedElement.classList.remove('dragging');
    this.draggedElement = null;
    this.draggedPath = null;
    this.clearDropState();
  }

  /** Whether an item is being dragged right now. */
  isDragging() {
    return this.draggedPath !== null;
  }

  /**
   * Set up a container as a single-delegate drag source and drop zone for
   * reordering and moving items.
   *
   * @param {HTMLElement} container - The folder-tree container
   * @param {Object} handlers
   * @param {Function} handlers.onReorder - (draggedPath, refPath, position: 'before'|'after') => void
   *        Place the dragged item next to the reference item (in the
   *        reference item's directory)
   * @param {Function} handlers.onMoveInto - (draggedPath, targetFolderPath|null) => void
   *        Move into a folder (null = the top level)
   * @param {Function} handlers.onDropAtEnd - (draggedPath) => void
   *        Dropped in the empty space below the list: top level, last
   */
  setupContainer(container, { onReorder, onMoveInto, onDropAtEnd }) {
    if (!container) return;

    container.addEventListener('dragstart', (e) => {
      const row = e.target instanceof Element ? e.target.closest(ROW_SELECTOR) : null;
      if (!row || !container.contains(row) || row.getAttribute('draggable') !== 'true') return;

      e.dataTransfer.setData(DRAG_TYPE, '1');
      e.dataTransfer.effectAllowed = 'move';
      this.draggedPath = row.getAttribute('data-path');
      this.draggedElement = row;

      // Slight delay so the browser captures the drag image first
      requestAnimationFrame(() => {
        if (this.draggedElement === row) row.classList.add('dragging');
      });
    });

    container.addEventListener('dragend', () => this.finishDrag());
    // Safety net: if the dragged row was re-rendered away mid-drag, its
    // dragend never reaches the container
    document.addEventListener('dragend', () => this.finishDrag());

    container.addEventListener('dragover', (e) => {
      // External drags (files from the OS, text from another app) are not
      // accepted: preventDefault + dropEffect 'none' makes the cursor show
      // a visible "not allowed" state instead of a silent no-op drop.
      e.preventDefault();
      if (!this.draggedPath) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }

      const action = this.resolveDropAction(container, e);
      if (action === undefined) {
        // Pointer is in the 2px gap between rows: keep the last action so
        // the indicator doesn't flicker
        e.dataTransfer.dropEffect = this.currentDropAction ? 'move' : 'none';
        return;
      }
      if (action === null) {
        // Not a valid target (the item itself, or inside itself)
        this.clearDropState();
        e.dataTransfer.dropEffect = 'none';
        return;
      }

      e.dataTransfer.dropEffect = 'move';
      this.currentDropAction = action;
    });

    container.addEventListener('dragleave', (e) => {
      // Only hide if we're actually leaving the container
      if (!container.contains(e.relatedTarget)) {
        this.clearDropState();
      }
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Save the action BEFORE clearing it. this.draggedPath (set only by
      // our own dragstart) is the source of truth — external drags never
      // populate it, so data from outside the app can't be misread as a
      // move request.
      const action = this.currentDropAction;
      const sourcePath = this.draggedPath;
      this.finishDrag();

      if (!sourcePath || !action) return;

      if (action.type === 'into') {
        onMoveInto(sourcePath, action.targetPath);
      } else if (action.type === 'reorder') {
        onReorder(sourcePath, action.refPath, action.position);
      } else if (action.type === 'end') {
        onDropAtEnd(sourcePath);
      } else if (action.type === 'root') {
        onMoveInto(sourcePath, null);
      }
    });
  }

  /**
   * Work out what dropping at the current pointer position would do, and
   * update the indicator / highlight to show it.
   *
   * Over a row:
   *   - Folder, middle 40%: drop INTO it (also the bottom of an open
   *     folder, where "after" would land among its children anyway)
   *   - Otherwise: insert before (upper part) or after (lower part)
   * Not over a row:
   *   - Below the last row: top level, at the end
   *   - Empty tree: top level
   *   - In the small gap between rows: no change (returns undefined)
   *
   * @returns {Object|null|undefined} The action; null if the position is
   *          not a valid target; undefined to keep the previous action
   */
  resolveDropAction(container, event) {
    const row = event.target instanceof Element ? event.target.closest(ROW_SELECTOR) : null;
    const containerRect = container.getBoundingClientRect();
    const rightEdge = containerRect.right - 8;

    if (row && container.contains(row)) {
      const rowPath = row.getAttribute('data-path');

      // Dropping an item on itself, or a folder onto something inside it,
      // would do nothing or be rejected — don't offer it
      if (!rowPath || isInside(rowPath, this.draggedPath)) return null;

      const rect = row.getBoundingClientRect();
      const relY = event.clientY - rect.top;
      const isFolder = row.classList.contains('folder');
      const isOpenFolder = isFolder && row.classList.contains('folder-open');

      if (isFolder && relY >= rect.height * 0.3 && (isOpenFolder || relY <= rect.height * 0.7)) {
        this.indicator.classList.remove('visible');
        this.setHighlight(row);
        return { type: 'into', targetPath: rowPath };
      }

      const position = relY < rect.height * (isFolder ? 0.3 : 0.5) ? 'before' : 'after';
      this.setHighlight(null);
      // The line starts at the row's own left edge, so its indentation
      // shows which level the item will land in
      this.showIndicator(rect.left, (position === 'before' ? rect.top : rect.bottom) - 1, rightEdge - rect.left);
      return { type: 'reorder', refPath: rowPath, position };
    }

    const rows = container.querySelectorAll(ROW_SELECTOR);
    if (rows.length === 0) {
      this.clearDropState();
      return { type: 'root' };
    }

    // Find the last row that is actually displayed
    let lastVisible = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].offsetParent !== null) {
        lastVisible = rows[i];
        break;
      }
    }
    if (!lastVisible) return { type: 'root' };

    const lastRect = lastVisible.getBoundingClientRect();
    if (event.clientY > lastRect.bottom) {
      this.setHighlight(null);
      this.showIndicator(containerRect.left + 8, lastRect.bottom + 2, containerRect.width - 16);
      return { type: 'end' };
    }

    return undefined;
  }

  /**
   * Set up the trash container as a drop target.
   */
  setupTrash(trashEl, onTrashDrop) {
    if (!trashEl) return;

    trashEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!this.draggedPath) {
        // External drag — visibly rejected (see container dragover)
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      e.dataTransfer.dropEffect = 'move';
      trashEl.classList.add('drag-over');
    });

    trashEl.addEventListener('dragleave', (e) => {
      if (!trashEl.contains(e.relatedTarget)) {
        trashEl.classList.remove('drag-over');
      }
    });

    trashEl.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      trashEl.classList.remove('drag-over');

      const sourcePath = this.draggedPath;
      this.finishDrag();
      if (sourcePath) {
        onTrashDrop(sourcePath);
      }
    });
  }
}
