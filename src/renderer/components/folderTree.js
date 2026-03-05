import { icons } from '../utils/icons.js';

/**
 * FolderTreeComponent - Manages the folder tree sidebar
 * Supports drag-to-reorder and drag-into-folder.
 */
export class FolderTreeComponent {
  constructor(container, fileService, editorComponent, dragDropService) {
    this.container = container;
    this.fileService = fileService;
    this.editorComponent = editorComponent;
    this.dragDropService = dragDropService;
    
    this.loadFileStructure();
    console.log('Folder tree component initialized');
  }

  async loadFileStructure() {
    try {
      const result = await this.fileService.listFiles();
      if (result.success) {
        const sorted = await this.applySortOrder('_root', result.files);
        this.renderFileTree(sorted, this.container, '_root');
        this.setupRootDropTarget(this.container);
      }
    } catch (error) {
      console.error('Error in loadFileStructure:', error);
    }
  }

  /**
   * Apply saved sort order to an array of file items.
   * Items not in the saved order appear at the end in their original order.
   */
  async applySortOrder(dirKey, items) {
    const savedOrder = await this.fileService.getSortOrder(dirKey);
    if (!savedOrder || !Array.isArray(savedOrder)) return items;

    const orderMap = new Map();
    savedOrder.forEach((name, index) => orderMap.set(name, index));

    const sorted = [...items].sort((a, b) => {
      const posA = orderMap.has(a.name) ? orderMap.get(a.name) : 9999;
      const posB = orderMap.has(b.name) ? orderMap.get(b.name) : 9999;
      return posA - posB;
    });

    return sorted;
  }

  /**
   * Save the current visual order of items in a container
   */
  saveContainerOrder(dirKey, containerEl) {
    // Collect item names from the DOM in their current visual order.
    // Items are .folder and .file elements (skip .folder-content and .reorder-zone).
    const names = [];
    for (const child of containerEl.children) {
      if (child.classList.contains('folder') || child.classList.contains('file')) {
        const nameEl = child.querySelector('.folder-name') || child.querySelector('.file-name');
        if (nameEl) names.push(nameEl.textContent);
      }
    }
    this.fileService.setSortOrder(dirKey, names);
  }

  renderFileTree(items, container, dirKey) {
    try {
      if (!container) return;
      container.innerHTML = '';

      if (!items || items.length === 0) return;

      items.forEach((item, index) => {
        // Add a reorder drop zone before each item
        container.appendChild(this.createReorderZone(container, dirKey, index));

        if (item.isDirectory) {
          this.createFolderElement(item, container, dirKey);
        } else {
          this.createFileElement(item, container);
        }
      });

      // Add a final reorder zone after the last item
      container.appendChild(this.createReorderZone(container, dirKey, items.length));
    } catch (error) {
      console.error('Error in renderFileTree:', error);
    }
  }

  /**
   * Create a thin drop zone between items for reordering.
   * When an item is dragged over this zone, it expands and highlights.
   * Dropping here reorders the item to this position.
   */
  createReorderZone(container, dirKey, insertIndex) {
    const zone = document.createElement('div');
    zone.className = 'reorder-zone';
    zone.setAttribute('data-insert-index', insertIndex);

    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add('reorder-active');
    });

    zone.addEventListener('dragleave', () => {
      zone.classList.remove('reorder-active');
    });

    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('reorder-active');

      const sourcePath = e.dataTransfer.getData('text/plain');
      if (!sourcePath) return;

      // Get the source item's name from its path
      const sourceName = sourcePath.split(/[/\\]/).pop();

      // Check if the source is in the same directory as this container.
      // Get current item names in visual order.
      const currentNames = [];
      for (const child of container.children) {
        if (child.classList.contains('folder') || child.classList.contains('file')) {
          const nameEl = child.querySelector('.folder-name') || child.querySelector('.file-name');
          if (nameEl) currentNames.push(nameEl.textContent);
        }
      }

      // Only reorder if the item is already in this container
      const sourceIndex = currentNames.indexOf(sourceName);
      if (sourceIndex === -1) return; // Not in this container — let folder drop handle it

      // Build new order: remove from old position, insert at new position
      const newOrder = currentNames.filter(n => n !== sourceName);
      // Adjust insert index since we removed one item
      let targetIndex = insertIndex;
      if (sourceIndex < insertIndex) {
        targetIndex = Math.max(0, targetIndex - 1);
      }
      newOrder.splice(targetIndex, 0, sourceName);

      // Save and re-render
      await this.fileService.setSortOrder(dirKey, newOrder);
      
      // Re-render just this level
      if (dirKey === '_root') {
        this.loadFileStructure();
      } else {
        // For subfolders, reload the parent's contents
        this.loadFileStructure();
      }
    });

    return zone;
  }

  createFolderElement(item, container, dirKey) {
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

    // Container for folder contents
    const folderContent = document.createElement('div');
    folderContent.className = 'folder-content';
    folderContent.style.display = 'none';

    let contentsLoaded = false;

    // Sanitize the path for use as a storage key
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

    // Make folder a drop target for moving items INTO the folder
    this.dragDropService.makeDropTarget(
      folderElement,
      item.path,
      (sourcePath, targetPath) => this.handleItemDrop(sourcePath, targetPath)
    );

    // Make folder draggable
    this.dragDropService.makeDraggable(folderElement, item.path);

    container.appendChild(folderElement);
    container.appendChild(folderContent);
  }

  createFileElement(item, container) {
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

    this.dragDropService.makeDraggable(fileElement, item.path);

    container.appendChild(fileElement);
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

  setupRootDropTarget(folderTreeElement) {
    try {
      this.dragDropService.makeDropTarget(
        folderTreeElement,
        null,
        (sourcePath, targetPath) => this.handleItemDrop(sourcePath, targetPath)
      );
    } catch (error) {
      console.error('Error in setupRootDropTarget:', error);
    }
  }

  async handleItemDrop(sourcePath, targetPath) {
    try {
      console.log('Item dropped:', sourcePath, 'to', targetPath);

      const result = await this.fileService.moveFile(sourcePath, targetPath);

      if (result.success) {
        this.editorComponent.updateFilePath(sourcePath, result.newPath);
        this.loadFileStructure();
      } else {
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