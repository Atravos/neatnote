import { icons } from '../utils/icons.js';

/**
 * FolderTreeComponent - Manages the folder tree sidebar
 */
export class FolderTreeComponent {
  /**
   * Initialize the folder tree component
   * @param {HTMLElement} container - Folder tree container element
   * @param {FileService} fileService - File service instance
   * @param {EditorComponent} editorComponent - Editor component instance
   * @param {DragDropService} dragDropService - Drag and drop service instance
   */
  constructor(container, fileService, editorComponent, dragDropService) {
    this.container = container;
    this.fileService = fileService;
    this.editorComponent = editorComponent;
    this.dragDropService = dragDropService;
    
    this.loadFileStructure();
    console.log('Folder tree component initialized');
  }

  /**
   * Load file structure from the file system
   */
  async loadFileStructure() {
    try {
      console.log('Loading file structure...');
      
      const result = await this.fileService.listFiles();
      console.log('File structure result:', result);
      
      if (result.success) {
        this.renderFileTree(result.files, this.container);
        this.setupRootDropTarget(this.container);
      } else {
        console.error('Failed to load file structure:', result.error);
      }
    } catch (error) {
      console.error('Error in loadFileStructure:', error);
    }
  }

  /**
   * Render the file tree recursively
   * @param {Array} items - Array of files and folders
   * @param {HTMLElement} container - Container element
   */
  renderFileTree(items, container) {
    try {
      console.log('Rendering file tree with', items?.length, 'items');
      
      if (container) {
        container.innerHTML = '';
      } else {
        console.error('Container not found for rendering file tree');
        return;
      }
      
      if (!items || items.length === 0) {
        console.log('No items to render in file tree');
        return;
      }
      
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

  /**
   * Create a folder element
   * @param {Object} item - Folder item
   * @param {HTMLElement} container - Container element
   */
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
    
    // Container for folder contents
    const folderContent = document.createElement('div');
    folderContent.className = 'folder-content';
    folderContent.style.display = 'none';
    
    // Track whether contents have been loaded from disk
    let contentsLoaded = false;
    
    // Clicking the folder row toggles open/close (no selection)
    folderElement.addEventListener('click', async (e) => {
      e.stopPropagation();
      this.toggleFolder(folderElement);
      
      // Lazy-load contents on first expand
      if (!contentsLoaded) {
        contentsLoaded = true;
        const subItems = await this.fileService.listFiles(item.path);
        if (subItems.success) {
          this.renderFileTree(subItems.files, folderContent);
        }
      }
    });
    
    // Make folder a drop target
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

  /**
   * Create a file element
   * @param {Object} item - File item
   * @param {HTMLElement} container - Container element
   */
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

  /**
   * Toggle folder open/closed
   * @param {HTMLElement} folderElement - Folder element
   */
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
   * Set up the root folder tree as a drop target.
   * Dropping here moves items to the root notes directory.
   * @param {HTMLElement} folderTreeElement - Folder tree element
   */
  setupRootDropTarget(folderTreeElement) {
    try {
      console.log('Setting up root folder tree as drop target');
      
      this.dragDropService.makeDropTarget(
        folderTreeElement,
        null,
        (sourcePath, targetPath) => this.handleItemDrop(sourcePath, targetPath)
      );
      
      console.log('Root folder tree set up as drop target');
    } catch (error) {
      console.error('Error in setupRootDropTarget:', error);
    }
  }

  /**
   * Handle item drop event
   * @param {string} sourcePath - Source file path
   * @param {string} targetPath - Target directory path
   */
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

  /**
   * Refresh the folder tree
   */
  refresh() {
    this.loadFileStructure();
  }
}