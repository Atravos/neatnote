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
    this.selectedFolder = null;
    
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
      
      // Clear the container first
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
    // Create folder element
    const folderElement = document.createElement('div');
    folderElement.className = 'folder';
    folderElement.setAttribute('data-path', item.path);
    
    // Create toggle element
    const toggleElement = document.createElement('span');
    toggleElement.className = 'folder-toggle';
    
    // Create icon with SVG
    const iconElement = document.createElement('span');
    iconElement.className = 'folder-icon';
    iconElement.innerHTML = icons.folder;
    
    // Create folder name element
    const nameElement = document.createElement('span');
    nameElement.className = 'folder-name';
    nameElement.textContent = item.name;
    
    // Add elements to folder
    folderElement.appendChild(toggleElement);
    folderElement.appendChild(iconElement);
    folderElement.appendChild(nameElement);
    
    // Create container for folder contents
    const folderContent = document.createElement('div');
    folderContent.className = 'folder-content';
    folderContent.style.display = 'none';
    
    // Toggle only when clicking the toggle element
    toggleElement.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleFolder(folderElement);
    });
    
    // Select folder on click
    folderElement.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Toggle selected class
      document.querySelectorAll('.folder.selected').forEach(el => {
        el.classList.remove('selected');
      });
      folderElement.classList.add('selected');
      this.selectedFolder = folderElement;
    });
    
    // Make folder a drop target for drag and drop
    this.dragDropService.makeDropTarget(
      folderElement, 
      item.path,
      (sourcePath, targetPath) => this.handleItemDrop(sourcePath, targetPath)
    );
    
    // Make folder draggable
    this.dragDropService.makeDraggable(folderElement, item.path);
    
    // Load folder contents on first expand
    toggleElement.addEventListener('click', async () => {
      if (folderContent.children.length === 0) {
        const subItems = await this.fileService.listFiles(item.path);
        if (subItems.success) {
          this.renderFileTree(subItems.files, folderContent);
        }
      }
    }, { once: true });
    
    container.appendChild(folderElement);
    container.appendChild(folderContent);
  }

  /**
   * Create a file element
   * @param {Object} item - File item
   * @param {HTMLElement} container - Container element
   */
  createFileElement(item, container) {
    // Create file element
    const fileElement = document.createElement('div');
    fileElement.className = 'file';
    fileElement.setAttribute('data-path', item.path);
    
    // Create icon with SVG
    const iconElement = document.createElement('span');
    iconElement.className = 'file-icon';
    iconElement.innerHTML = icons.file;
    
    // Create file name element
    const nameElement = document.createElement('span');
    nameElement.className = 'file-name';
    nameElement.textContent = item.name;
    
    // Add elements to file
    fileElement.appendChild(iconElement);
    fileElement.appendChild(nameElement);
    
    // Add click listener to open file
    fileElement.addEventListener('click', () => {
      this.editorComponent.openFile(item.path);
    });
    
    // Make file draggable
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
   * Set up the root folder tree as a drop target
   * @param {HTMLElement} folderTreeElement - Folder tree element
   */
  setupRootDropTarget(folderTreeElement) {
    try {
      console.log('Setting up root folder tree as drop target');
      
      this.dragDropService.makeDropTarget(
        folderTreeElement,
        null, // null target path means root directory
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
        // Notify editor of the path change
        this.editorComponent.updateFilePath(sourcePath, result.newPath);
        
        // IMPORTANT: Update any cached paths or references to the moved file
        // For example, if the dropped element is cached somewhere, update its path
        
        // Refresh the file structure
        this.loadFileStructure();
      } else {
        console.error('Failed to move file:', result.error);
        alert(`Failed to move file: ${result.error}`);
      }
    } catch (error) {
      console.error('Error in handleItemDrop:', error);
      alert(`Error moving file: ${error.message}`);
    }
  }

  /**
   * Get currently selected folder
   * @returns {string|null} Path of selected folder or null
   */
  getSelectedFolderPath() {
    if (this.selectedFolder) {
      return this.selectedFolder.getAttribute('data-path');
    }
    return null;
  }

  /**
   * Refresh the folder tree
   */
  refresh() {
    this.loadFileStructure();
  }
}