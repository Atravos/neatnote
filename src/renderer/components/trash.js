import { icons } from '../utils/icons.js';

/**
 * TrashComponent - Manages the trash functionality
 */
export class TrashComponent {
  /**
   * Initialize the trash component
   * @param {HTMLElement} container - Trash container element
   * @param {FileService} fileService - File service instance
   * @param {EditorComponent} editorComponent - Editor component instance
   * @param {FolderTreeComponent} folderTreeComponent - Folder tree component instance
   * @param {DragDropService} dragDropService - Drag and drop service instance
   */
  constructor(container, fileService, editorComponent, folderTreeComponent, dragDropService) {
    this.container = container;
    this.fileService = fileService;
    this.editorComponent = editorComponent;
    this.folderTreeComponent = folderTreeComponent;
    this.dragDropService = dragDropService;
    
    this.setupTrash();
    console.log('Trash component initialized');
  }

  /**
   * Set up the trash container
   */
  setupTrash() {
    if (!this.container) {
      console.error('Trash container not found');
      return;
    }
    
    // Replace trash icon with SVG
    const trashIconElement = this.container.querySelector('.trash-icon');
    if (trashIconElement) {
      trashIconElement.innerHTML = icons.trash;
    }
    
    // Make trash a drop target
    this.dragDropService.makeDropTarget(
      this.container,
      'trash', // Special identifier for trash
      (sourcePath) => this.handleTrashDrop(sourcePath)
    );
    
    console.log('Trash container set up');
  }

  /**
   * Handle item drop on trash
   * @param {string} itemPath - Path of item to delete
   */
  async handleTrashDrop(itemPath) {
    if (!itemPath) return;
    
    const itemName = itemPath.split('/').pop();
    
    // Ask for confirmation
    if (confirm(`Are you sure you want to delete "${itemName}"? This cannot be undone.`)) {
      try {
        // Visual feedback
        this.container.classList.add('confirm');
        setTimeout(() => this.container.classList.remove('confirm'), 500);
        
        const result = await this.fileService.deleteItem(itemPath);
        
        if (result.success) {
          console.log('Item deleted successfully');
          
          // If the deleted item was the active file, clear the editor
          this.editorComponent.handleFileDeleted(itemPath);
          
          // Refresh the file structure
          this.folderTreeComponent.refresh();
        } else {
          console.error('Failed to delete item:', result.error);
          alert('Failed to delete: ' + result.error);
        }
      } catch (error) {
        console.error('Error during deletion:', error);
        alert('Error during deletion: ' + error.message);
      }
    }
  }
}