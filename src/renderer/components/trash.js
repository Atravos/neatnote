import { icons } from '../utils/icons.js';

/**
 * TrashComponent - Manages the trash functionality
 */
export class TrashComponent {
  constructor(container, fileService, editorComponent, folderTreeComponent, dragDropService, modalComponent) {
    this.container = container;
    this.fileService = fileService;
    this.editorComponent = editorComponent;
    this.folderTreeComponent = folderTreeComponent;
    this.dragDropService = dragDropService;
    this.modalComponent = modalComponent;
    
    this.setupTrash();
    console.log('Trash component initialized');
  }

  setupTrash() {
    if (!this.container) return;
    
    const trashIconElement = this.container.querySelector('.trash-icon');
    if (trashIconElement) {
      trashIconElement.innerHTML = icons.trash;
    }
    
    // Use the new single-handler trash drop
    this.dragDropService.setupTrash(this.container, (sourcePath) => {
      this.handleTrashDrop(sourcePath);
    });
    
    console.log('Trash container set up');
  }

  async handleTrashDrop(itemPath) {
    if (!itemPath) return;
    
    const itemName = itemPath.split(/[/\\]/).pop();
    
    this.modalComponent.showConfirm(
      `Delete "${itemName}"? This cannot be undone.`,
      async (confirmed) => {
        if (!confirmed) return;

        try {
          this.container.classList.add('confirm');
          setTimeout(() => this.container.classList.remove('confirm'), 500);
          
          const result = await this.fileService.deleteItem(itemPath);
          
          if (result.success) {
            console.log('Item deleted successfully');
            this.editorComponent.handleFileDeleted(itemPath);
            this.folderTreeComponent.refresh();
          } else {
            console.error('Failed to delete item:', result.error);
          }
        } catch (error) {
          console.error('Error during deletion:', error);
        }
      }
    );
  }
}