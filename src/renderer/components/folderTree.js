import { icons } from '../utils/icons.js';
import { showToast } from '../services/toast.js';

/**
 * FolderTreeComponent - Manages the folder tree sidebar.
 * Uses a single-delegate drag system — no per-element drop targets.
 * Supports double-click rename and a name filter (search).
 */
export class FolderTreeComponent {
  constructor(container, fileService, editorComponent, dragDropService, modalComponent) {
    this.container = container;
    this.fileService = fileService;
    this.editorComponent = editorComponent;
    this.dragDropService = dragDropService;
    this.modalComponent = modalComponent;
    this.filterQuery = '';

    // Set up the single drag-drop delegate on the container
    this.dragDropService.setupContainer(this.container, {
      onReorder: (draggedPath, refName, position) => this.handleReorder(draggedPath, refName, position),
      onMoveInto: (sourcePath, targetPath) => this.handleItemDrop(sourcePath, targetPath),
      onMoveToRoot: (sourcePath) => this.handleItemDrop(sourcePath, null)
    });

    this.loadFileStructure();
  }

  async loadFileStructure() {
    try {
      // If a filter is active, re-run the search instead of the tree render
      if (this.filterQuery) {
        await this.renderSearchResults(this.filterQuery);
        return;
      }

      const result = await this.fileService.listFiles();
      if (result.success) {
        const sorted = await this.applySortOrder('_root', result.files);
        this.renderFileTree(sorted, this.container, '_root');
      } else {
        showToast(`Could not load notes: ${result.error}`, 'error');
      }
    } catch (error) {
      console.error('Error in loadFileStructure:', error);
    }
  }

  /**
   * Set the name filter. An empty query restores the normal tree view.
   * @param {string} query - Case-insensitive substring to match
   */
  async setFilter(query) {
    this.filterQuery = (query || '').trim().toLowerCase();
    if (this.filterQuery) {
      await this.renderSearchResults(this.filterQuery);
    } else {
      await this.loadFileStructure();
    }
  }

  /**
   * Recursively collect items whose name contains the query.
   * @param {string|null} dirPath - Directory to search (null for root)
   * @param {string} query - Lowercased query
   * @param {Array} results - Accumulator
   * @param {number} depth - Recursion guard
   */
  async collectMatches(dirPath, query, results, depth = 0) {
    if (depth > 10) return;

    const listing = await this.fileService.listFiles(dirPath);
    if (!listing.success) return;

    for (const item of listing.files) {
      if (item.name.toLowerCase().includes(query)) {
        results.push(item);
      }
      if (item.isDirectory) {
        await this.collectMatches(item.path, query, results, depth + 1);
      }
    }
  }

  /**
   * Render a flat list of items matching the current filter.
   * Files open on click and can be renamed; drag is disabled in this view.
   * @param {string} query - Lowercased query
   */
  async renderSearchResults(query) {
    try {
      const results = [];
      await this.collectMatches(null, query, results);

      // A newer query may have superseded this one while we were searching
      if (query !== this.filterQuery) return;

      this.container.innerHTML = '';

      if (results.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'search-empty';
        empty.textContent = 'No matches';
        this.container.appendChild(empty);
        return;
      }

      results.forEach(item => {
        if (item.isDirectory) {
          this.createFolderElement(item, this.container, null, { searchMode: true });
        } else {
          this.createFileElement(item, this.container, null, { searchMode: true });
        }
      });
    } catch (error) {
      console.error('Error in renderSearchResults:', error);
    }
  }

  async applySortOrder(dirKey, items) {
    const savedOrder = await this.fileService.getSortOrder(dirKey);
    if (!savedOrder || !Array.isArray(savedOrder)) return items;

    const orderMap = new Map();
    savedOrder.forEach((name, index) => orderMap.set(name, index));

    return [...items].sort((a, b) => {
      const posA = orderMap.has(a.name) ? orderMap.get(a.name) : 9999;
      const posB = orderMap.has(b.name) ? orderMap.get(b.name) : 9999;
      return posA - posB;
    });
  }

  renderFileTree(items, container, dirKey) {
    try {
      if (!container) return;
      container.innerHTML = '';
      if (!items || items.length === 0) return;

      items.forEach(item => {
        if (item.isDirectory) {
          this.createFolderElement(item, container, dirKey);
        } else {
          this.createFileElement(item, container, dirKey);
        }
      });
    } catch (error) {
      console.error('Error in renderFileTree:', error);
    }
  }

  createFolderElement(item, container, dirKey, { searchMode = false } = {}) {
    const folderElement = document.createElement('div');
    folderElement.className = 'folder';
    folderElement.setAttribute('data-path', item.path);

    const toggleElement = document.createElement('span');
    toggleElement.className = 'folder-toggle';

    const iconElement = document.createElement('span');
    iconElement.className = 'folder-icon';
    iconElement.innerHTML = icons.folder;

    const nameElement = document.createElement('span');
    nameElement.className = 'folder-name';
    nameElement.textContent = item.name;

    folderElement.appendChild(toggleElement);
    folderElement.appendChild(iconElement);
    folderElement.appendChild(nameElement);

    // Double-click to rename (works in both views)
    folderElement.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.promptRename(item.path, item.name, true, dirKey);
    });

    if (searchMode) {
      folderElement.title = 'Folder';
      container.appendChild(folderElement);
      return;
    }

    const folderContent = document.createElement('div');
    folderContent.className = 'folder-content';
    folderContent.style.display = 'none';

    let contentsLoaded = false;
    const subDirKey = item.name.replace(/[^a-zA-Z0-9_-]/g, '_');

    folderElement.addEventListener('click', async (e) => {
      e.stopPropagation();
      this.toggleFolder(folderElement);

      if (!contentsLoaded) {
        contentsLoaded = true;
        const subItems = await this.fileService.listFiles(item.path);
        if (subItems.success) {
          const sorted = await this.applySortOrder(subDirKey, subItems.files);
          this.renderFileTree(sorted, folderContent, subDirKey);
        }
      }
    });

    // Only make it draggable — drop handling is done by the container delegate
    this.dragDropService.makeDraggable(folderElement, item.path);

    container.appendChild(folderElement);
    container.appendChild(folderContent);
  }

  createFileElement(item, container, dirKey, { searchMode = false } = {}) {
    const fileElement = document.createElement('div');
    fileElement.className = 'file';
    fileElement.setAttribute('data-path', item.path);

    const iconElement = document.createElement('span');
    iconElement.className = 'file-icon';
    iconElement.innerHTML = icons.file;

    const nameElement = document.createElement('span');
    nameElement.className = 'file-name';
    nameElement.textContent = item.name;

    fileElement.appendChild(iconElement);
    fileElement.appendChild(nameElement);

    fileElement.addEventListener('click', () => {
      this.editorComponent.openFile(item.path);
    });

    // Double-click to rename (works in both views)
    fileElement.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.promptRename(item.path, item.name, false, dirKey);
    });

    if (!searchMode) {
      this.dragDropService.makeDraggable(fileElement, item.path);
    }

    container.appendChild(fileElement);
  }

  /**
   * Show the rename modal for an item and apply the rename.
   * @param {string} itemPath - Current path
   * @param {string} currentName - Current display name (files include extension)
   * @param {boolean} isDirectory - Whether the item is a folder
   * @param {string|null} dirKey - Sort-order key of the containing directory
   */
  promptRename(itemPath, currentName, isDirectory, dirKey) {
    // Files are renamed without their extension; the main process preserves it
    const dotIndex = currentName.lastIndexOf('.');
    const baseName = (!isDirectory && dotIndex > 0)
      ? currentName.slice(0, dotIndex)
      : currentName;

    this.modalComponent.show(
      `Rename "${currentName}"`,
      async (newName) => {
        if (!newName || newName === baseName) return;

        const result = await this.fileService.renameItem(itemPath, newName);
        if (result.success) {
          // Keep the editor pointing at the renamed file (or a file inside
          // a renamed folder)
          this.editorComponent.updateFilePath(itemPath, result.newPath);

          // Keep the item's position in the saved sort order
          if (dirKey) {
            const newDisplayName = result.newPath.split(/[/\\]/).pop();
            await this.updateSortOrderName(dirKey, currentName, newDisplayName);
          }

          this.loadFileStructure();
        } else {
          showToast(`Rename failed: ${result.error}`, 'error');
        }
      },
      { defaultValue: baseName, confirmText: 'Rename' }
    );
  }

  /**
   * Replace a name inside a directory's saved sort order.
   * @param {string} dirKey - Sort-order key
   * @param {string} oldName - Name to replace
   * @param {string} newName - Replacement name
   */
  async updateSortOrderName(dirKey, oldName, newName) {
    try {
      const order = await this.fileService.getSortOrder(dirKey);
      if (!order || !Array.isArray(order)) return;
      const index = order.indexOf(oldName);
      if (index === -1) return;
      order[index] = newName;
      await this.fileService.setSortOrder(dirKey, order);
    } catch (error) {
      console.error('Error updating sort order after rename:', error);
    }
  }

  toggleFolder(folderElement) {
    try {
      const folderContent = folderElement.nextElementSibling;
      const iconElement = folderElement.querySelector('.folder-icon');

      if (folderContent.style.display === 'none') {
        folderContent.style.display = 'block';
        folderElement.classList.add('folder-open');
        iconElement.innerHTML = icons.folderOpen;
      } else {
        folderContent.style.display = 'none';
        folderElement.classList.remove('folder-open');
        iconElement.innerHTML = icons.folder;
      }
    } catch (error) {
      console.error('Error in toggleFolder:', error);
    }
  }

  /**
   * Handle reorder: move an item before or after a reference item
   * by updating the saved sort order.
   */
  async handleReorder(draggedPath, refName, position) {
    const draggedName = draggedPath.split(/[/\\]/).pop();

    // Determine which directory this reorder is happening in.
    // For now we handle root-level reordering. Items at the same
    // level share a dirKey.
    // TODO: extend to subfolders by detecting common parent
    const dirKey = '_root';

    // Get current order
    const result = await this.fileService.listFiles();
    if (!result.success) return;

    const savedOrder = await this.fileService.getSortOrder(dirKey);
    let names = savedOrder && Array.isArray(savedOrder)
      ? savedOrder
      : result.files.map(f => f.name);

    // If dragged item isn't in this list, it might be moving from a subfolder
    if (!names.includes(draggedName)) {
      // This is a move-to-root + reorder — do the filesystem move first
      const moveResult = await this.fileService.moveFile(draggedPath, null);
      if (!moveResult.success) {
        showToast(`Move failed: ${moveResult.error}`, 'error');
        return;
      }
      // Refresh the names list
      const freshResult = await this.fileService.listFiles();
      if (freshResult.success) {
        names = freshResult.files.map(f => f.name);
      }
    }

    // Remove dragged item from current position
    const newOrder = names.filter(n => n !== draggedName);

    // Find where to insert
    let insertIndex = newOrder.indexOf(refName);
    if (insertIndex === -1) {
      insertIndex = newOrder.length;
    } else if (position === 'after') {
      insertIndex += 1;
    }

    newOrder.splice(insertIndex, 0, draggedName);

    await this.fileService.setSortOrder(dirKey, newOrder);
    this.loadFileStructure();
  }

  async handleItemDrop(sourcePath, targetPath) {
    try {
      const result = await this.fileService.moveFile(sourcePath, targetPath);
      if (result.success) {
        this.editorComponent.updateFilePath(sourcePath, result.newPath);
        this.loadFileStructure();
      } else {
        showToast(`Move failed: ${result.error}`, 'error');
        console.error('Failed to move file:', result.error);
      }
    } catch (error) {
      console.error('Error in handleItemDrop:', error);
    }
  }

  refresh() {
    this.loadFileStructure();
  }
}
