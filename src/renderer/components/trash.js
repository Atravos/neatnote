import { icons } from '../utils/icons.js';
import { showToast } from '../services/toast.js';

/**
 * TrashComponent - the trash target at the bottom of the sidebar.
 *
 * Drag a note or folder onto it, or click it (Enter/Space when focused)
 * to trash the note that is currently open. Either way the item goes to
 * the operating system's trash after a confirmation, so it can be
 * restored. The actual delete flow lives in FolderTreeComponent so the
 * Delete key and the context menu behave identically.
 */
export class TrashComponent {
  constructor(container, editorComponent, folderTreeComponent, dragDropService) {
    this.container = container;
    this.editorComponent = editorComponent;
    this.folderTreeComponent = folderTreeComponent;
    this.dragDropService = dragDropService;

    this.setupTrash();
  }

  setupTrash() {
    if (!this.container) return;

    const trashIconElement = this.container.querySelector('.trash-icon');
    if (trashIconElement) {
      trashIconElement.innerHTML = icons.trash;
    }

    this.dragDropService.setupTrash(this.container, (sourcePath) => {
      this.flash();
      this.folderTreeComponent.requestDelete(sourcePath);
    });

    const trashOpenNote = () => {
      const activeFile = this.editorComponent.getActiveFile();
      if (!activeFile) {
        showToast('Drag a note or folder here, or select one and press Delete', 'info');
        return;
      }
      this.folderTreeComponent.requestDelete(activeFile);
    };

    this.container.addEventListener('click', trashOpenNote);
    this.container.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        trashOpenNote();
      }
    });
  }

  /** Brief visual acknowledgement that something was dropped here. */
  flash() {
    this.container.classList.add('confirm');
    setTimeout(() => this.container.classList.remove('confirm'), 500);
  }
}
