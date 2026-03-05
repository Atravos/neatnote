/**
 * DragDropService - Single-delegate drag and drop system.
 *
 * Instead of attaching dragover/dragleave to every element (which causes
 * flickering), this uses ONE handler on a container element. It calculates
 * drop position from mouse coordinates and shows a single indicator line.
 */
export class DragDropService {
  constructor() {
    this.draggedPath = null;
    this.indicator = null;
    this.currentDropAction = null; // { type: 'reorder'|'into', ... }
    this.createIndicator();
    console.log('DragDrop service initialized');
  }

  /**
   * Create the single visual indicator element used across the entire app.
   */
  createIndicator() {
    this.indicator = document.createElement('div');
    this.indicator.className = 'drop-indicator';
    document.body.appendChild(this.indicator);
  }

  showIndicator(x, y, width) {
    this.indicator.style.left = `${x}px`;
    this.indicator.style.top = `${y}px`;
    this.indicator.style.width = `${width}px`;
    this.indicator.classList.add('visible');
  }

  hideIndicator() {
    this.indicator.classList.remove('visible');
    this.currentDropAction = null;
  }

  /**
   * Make an element draggable.
   * @param {HTMLElement} el
   * @param {string} dataPath - filesystem path stored in drag data
   */
  makeDraggable(el, dataPath) {
    if (!el) return;
    el.setAttribute('draggable', 'true');

    el.addEventListener('dragstart', (e) => {
      // Set both the data transfer and our internal reference
      e.dataTransfer.setData('text/plain', dataPath);
      e.dataTransfer.effectAllowed = 'move';
      this.draggedPath = dataPath;
      el.classList.add('dragging');

      // Slight delay so the browser captures the drag image first
      requestAnimationFrame(() => {
        el.style.opacity = '0.4';
      });
    });

    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      el.style.opacity = '';
      this.draggedPath = null;
      this.hideIndicator();
      // Remove any folder highlights
      document.querySelectorAll('.drop-target-highlight').forEach(el =>
        el.classList.remove('drop-target-highlight')
      );
    });
  }

  /**
   * Set up a container as a single-delegate drop zone for reordering
   * and moving items into folders.
   *
   * @param {HTMLElement} container - The folder-tree container
   * @param {Function} onReorder - (draggedPath, referenceItemName, position: 'before'|'after') => void
   * @param {Function} onMoveInto - (draggedPath, targetFolderPath) => void
   * @param {Function} onMoveToRoot - (draggedPath) => void
   */
  setupContainer(container, { onReorder, onMoveInto, onMoveToRoot }) {
    if (!container) return;

    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      if (!this.draggedPath) return;

      const items = this.getVisibleItems(container);
      if (items.length === 0) {
        // Empty sidebar — allow drop to root
        this.currentDropAction = { type: 'root' };
        this.hideIndicator();
        return;
      }

      const mouseY = e.clientY;
      const result = this.calcDropPosition(items, mouseY);

      // Clear all folder highlights
      document.querySelectorAll('.drop-target-highlight').forEach(el =>
        el.classList.remove('drop-target-highlight')
      );

      if (result.type === 'into') {
        // Highlight the target folder
        result.element.classList.add('drop-target-highlight');
        this.indicator.classList.remove('visible');
        this.currentDropAction = {
          type: 'into',
          targetPath: result.element.getAttribute('data-path')
        };
      } else if (result.type === 'between') {
        // Show the indicator line between items
        const rect = result.refElement.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const indicatorY = result.position === 'before' ? rect.top : rect.bottom;
        this.showIndicator(containerRect.left + 8, indicatorY - 1, containerRect.width - 16);
        this.currentDropAction = {
          type: 'reorder',
          refName: this.getItemName(result.refElement),
          position: result.position
        };
      } else {
        // After all items — show indicator at bottom
        const lastItem = items[items.length - 1];
        const rect = lastItem.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        this.showIndicator(containerRect.left + 8, rect.bottom - 1, containerRect.width - 16);
        this.currentDropAction = {
          type: 'reorder',
          refName: this.getItemName(lastItem),
          position: 'after'
        };
      }
    });

    container.addEventListener('dragleave', (e) => {
      // Only hide if we're actually leaving the container
      if (!container.contains(e.relatedTarget)) {
        this.hideIndicator();
        document.querySelectorAll('.drop-target-highlight').forEach(el =>
          el.classList.remove('drop-target-highlight')
        );
      }
    });

    container.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.hideIndicator();
      document.querySelectorAll('.drop-target-highlight').forEach(el =>
        el.classList.remove('drop-target-highlight')
      );

      const sourcePath = e.dataTransfer.getData('text/plain');
      if (!sourcePath || !this.currentDropAction) return;

      const action = this.currentDropAction;
      this.currentDropAction = null;

      if (action.type === 'into') {
        // Prevent dropping folder into itself
        if (sourcePath === action.targetPath) return;
        if (action.targetPath && action.targetPath.startsWith(sourcePath + '/')) return;
        if (action.targetPath && action.targetPath.startsWith(sourcePath + '\\')) return;
        onMoveInto(sourcePath, action.targetPath);
      } else if (action.type === 'reorder') {
        onReorder(sourcePath, action.refName, action.position);
      } else if (action.type === 'root') {
        onMoveToRoot(sourcePath);
      }
    });
  }

  /**
   * Set up the trash container as a drop target.
   */
  setupTrash(trashEl, onTrashDrop) {
    if (!trashEl) return;

    trashEl.addEventListener('dragover', (e) => {
      e.preventDefault();
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

      const sourcePath = e.dataTransfer.getData('text/plain');
      if (sourcePath) {
        onTrashDrop(sourcePath);
      }
    });
  }

  /**
   * Get all visible .folder and .file elements in the container,
   * in visual (DOM) order. Only top-level items and items inside
   * expanded folders.
   */
  getVisibleItems(container) {
    const items = [];
    const walk = (el) => {
      for (const child of el.children) {
        if (child.classList.contains('folder') || child.classList.contains('file')) {
          items.push(child);
        }
        // Walk into expanded folder-content containers
        if (child.classList.contains('folder-content') && child.style.display !== 'none') {
          walk(child);
        }
      }
    };
    walk(container);
    return items;
  }

  /**
   * Calculate the intended drop position based on mouse Y coordinate.
   *
   * For each item:
   *   - Top 30%: insert before this item (reorder)
   *   - Middle 40%: drop INTO this item if it's a folder
   *   - Bottom 30%: insert after this item (reorder)
   *
   * For files, the full height is reorder (no "into" zone).
   */
  calcDropPosition(items, mouseY) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rect = item.getBoundingClientRect();

      if (mouseY < rect.top) {
        // Above this item — insert before it
        return { type: 'between', refElement: item, position: 'before' };
      }

      if (mouseY >= rect.top && mouseY <= rect.bottom) {
        const isFolder = item.classList.contains('folder');
        const height = rect.height;
        const relY = mouseY - rect.top;

        if (isFolder) {
          // Folders have a "drop into" zone in the middle
          if (relY < height * 0.3) {
            return { type: 'between', refElement: item, position: 'before' };
          } else if (relY > height * 0.7) {
            return { type: 'between', refElement: item, position: 'after' };
          } else {
            return { type: 'into', element: item };
          }
        } else {
          // Files: top half = before, bottom half = after
          if (relY < height * 0.5) {
            return { type: 'between', refElement: item, position: 'before' };
          } else {
            return { type: 'between', refElement: item, position: 'after' };
          }
        }
      }
    }

    // Below all items
    return { type: 'end' };
  }

  /**
   * Get the display name from a folder or file element.
   */
  getItemName(el) {
    const nameEl = el.querySelector('.folder-name') || el.querySelector('.file-name');
    return nameEl ? nameEl.textContent : '';
  }
}