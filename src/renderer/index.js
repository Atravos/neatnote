/**
 * Main entry point for the renderer process
 * Initializes all components and services
 */

// Import services
import { FileService } from './services/fileService.js';
import { ThemeService } from './services/themeService.js';
import { DragDropService } from './services/dragdrop.js';

// Import components
import { EditorComponent } from './components/editor.js';
import { FolderTreeComponent } from './components/folderTree.js';
import { ModalComponent } from './components/modals.js';
import { TrashComponent } from './components/trash.js';
import { SettingsComponent } from './components/settings.js';

/**
 * Initialize the application when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing application');
  
  // Initialize services
  const fileService = new FileService(window.api);
  const themeService = new ThemeService();
  const dragDropService = new DragDropService();
  
  // Get DOM elements for the editor component
  const editorElements = {
    editorElement: document.getElementById('editor'),
    pathDisplay: document.getElementById('current-file-path'),
    saveButton: document.getElementById('save-btn'),
    editorHeader: document.querySelector('.editor-header')
  };
  
  // Initialize editor component
  const editorComponent = new EditorComponent(editorElements, fileService);
  
  // Initialize folder tree component
  const folderTreeComponent = new FolderTreeComponent(
    document.getElementById('folder-tree'),
    fileService,
    editorComponent,
    dragDropService
  );
  
  // Get DOM elements for the modal component
  const modalElements = {
    modalOverlay: document.getElementById('modal-overlay'),
    modalTitle: document.getElementById('modal-title'),
    modalInput: document.getElementById('modal-input'),
    cancelButton: document.getElementById('modal-cancel-btn'),
    confirmButton: document.getElementById('modal-confirm-btn')
  };
  
  // Initialize modal component
  const modalComponent = new ModalComponent(modalElements);
  
  // Initialize trash component
  const trashComponent = new TrashComponent(
    document.getElementById('trash-container'),
    fileService,
    editorComponent,
    folderTreeComponent,
    dragDropService
  );
  
  // Get DOM elements for the settings component
  const settingsElements = {
    settingsIcon: document.getElementById('settings-icon'),
    settingsOverlay: document.getElementById('settings-overlay'),
    closeButton: document.getElementById('settings-close-btn'),
    themeOptions: document.querySelectorAll('.theme-option')
  };
  
  // Initialize settings component
  const settingsComponent = new SettingsComponent(settingsElements, themeService);
  
  // Set up new folder button
  document.getElementById('new-folder-btn').addEventListener('click', () => {
    modalComponent.show('Enter folder name', (name) => {
      if (name) {
        // Get selected folder path or null for root
        const parentPath = folderTreeComponent.getSelectedFolderPath();
        fileService.createFolder(name, parentPath).then(result => {
          if (result.success) {
            folderTreeComponent.refresh();
          } else {
            alert('Failed to create folder: ' + result.error);
          }
        });
      }
    });
  });
  
  // Set up new file button
  document.getElementById('new-file-btn').addEventListener('click', () => {
    modalComponent.show('Enter file name', (name) => {
      if (name) {
        // Get selected folder path or null for root
        const parentPath = folderTreeComponent.getSelectedFolderPath();
        fileService.createFile(name, parentPath).then(result => {
          if (result.success) {
            folderTreeComponent.refresh();
            editorComponent.openFile(result.path);
          } else {
            alert('Failed to create file: ' + result.error);
          }
        });
      }
    });
  });
  
  // Load theme from saved preference
  themeService.initialize();
  
  console.log('Application initialized successfully');
});