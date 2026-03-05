import { icons } from '../utils/icons.js';

/**
 * FolderTreeComponent - Manages the folder tree sidebar.
 * Uses a single-delegate drag system — no per-element drop targets.
 */
export class FolderTreeComponent {
  constructor(container, fileService, editorComponent, dragDropService) {
    this.container = container;
    this.fileService = fileService;
    this.editorComponent = editorComponent;
    this.dragDropService = dragDropService;

    // Set up the single drag-drop delegate on the container
    this.dragDropService.setupContainer(this.container, {
      onReorder: (draggedPath, refName, position) => this.handleReorder(draggedPath, refName, position),
      onMoveInto: (sourcePath, targetPath) => this.handleItemDrop(sourcePath, targetPath),
      onMoveToRoot: (sourcePath) => this.handleItemDrop(sourcePath, null)
    });

    this.loadFileStructure();
    console.log('Folder tree component initialized');
  }

  async loadFileStructure() {
    try {
      const result = await this.fileService.listFiles();
      if (result.success) {
        const sorted = await this.applySortOrder('_root', result.files);
        this.renderFileTree(sorted, this.container, '_root');
      }
    } catch (error) {
      console.error('Error in loadFileStructure:', error);
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
          this.createFolderElement(item, container);
        } else {
          this.createFileElement(item, container);
        }
      });
    } catch (error) {
      console.error('Error in renderFileTree:', error);
    }
  }

  createFolderElement(item, container) {
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
      if (!moveResult.success) return;
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