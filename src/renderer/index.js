/**
 * Main entry point for the renderer process
 * Initializes all components and services
 */

// Import services
import { FileService } from './services/fileService.js';
import { ThemeService } from './services/themeService.js';
import { DragDropService } from './services/dragdrop.js';

// Import components
import { TitlebarComponent } from './components/titlebar.js';
import { EditorComponent } from './components/editor.js';
import { FolderTreeComponent } from './components/folderTree.js';
import { ModalComponent } from './components/modals.js';
import { TrashComponent } from './components/trash.js';
import { SettingsComponent } from './components/settings.js';

// Import utils
import { debounce } from './utils/debounce.js';

/**
 * Initialize the application when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', () => {
  // Initialize services
  const fileService = new FileService(window.api);
  const themeService = new ThemeService();
  const dragDropService = new DragDropService();

  // Custom titlebar (frameless window): drag region + window controls
  const titlebarComponent = new TitlebarComponent(
    document.getElementById('titlebar-controls')
  );

  // Get DOM elements for the modal component
  const modalElements = {
    modalOverlay: document.getElementById('modal-overlay'),
    modalTitle: document.getElementById('modal-title'),
    modalInput: document.getElementById('modal-input'),
    cancelButton: document.getElementById('modal-cancel-btn'),
    confirmButton: document.getElementById('modal-confirm-btn')
  };

  // Initialize modal component first (used by the editor's link dialog
  // and by the folder tree for renames)
  const modalComponent = new ModalComponent(modalElements);

  // Get DOM elements for the editor component
  const editorElements = {
    editorElement: document.getElementById('editor'),
    toolbarElement: document.getElementById('editor-toolbar'),
    pathDisplay: document.getElementById('current-file-path'),
    saveButton: document.getElementById('save-btn'),
    editorHeader: document.querySelector('.editor-header'),
    wordCount: document.getElementById('word-count')
  };

  // Initialize editor component
  const editorComponent = new EditorComponent(editorElements, fileService, modalComponent);

  // Initialize folder tree component
  const folderTreeComponent = new FolderTreeComponent(
    document.getElementById('folder-tree'),
    fileService,
    editorComponent,
    dragDropService,
    modalComponent
  );

  // Initialize trash component
  const trashComponent = new TrashComponent(
    document.getElementById('trash-container'),
    fileService,
    editorComponent,
    folderTreeComponent,
    dragDropService,
    modalComponent
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

  /**
   * Prompt for a folder name and create it at root level.
   * To nest folders, drag them into a parent folder after creating.
   * @param {string} [title='Enter folder name'] - Modal title
   */
  function promptNewFolder(title = 'Enter folder name') {
    modalComponent.show(title, (name) => {
      if (!name) return;
      fileService.createFolder(name, null).then(result => {
        if (result.success) {
          folderTreeComponent.refresh();
        } else {
          // Re-prompt with the actual reason (already exists, invalid name, ...)
          promptNewFolder(`${result.error} — enter a different name`);
        }
      });
    });
  }

  /**
   * Prompt for a file name and create it at root level, then open it.
   * To nest files, drag them into a folder after creating.
   * @param {string} [title='Enter file name'] - Modal title
   */
  function promptNewFile(title = 'Enter file name') {
    modalComponent.show(title, (name) => {
      if (!name) return;
      fileService.createFile(name, null).then(result => {
        if (result.success) {
          folderTreeComponent.refresh();
          editorComponent.openFile(result.path);
        } else {
          // Re-prompt with the actual reason (already exists, invalid name, ...)
          promptNewFile(`${result.error} — enter a different name`);
        }
      });
    });
  }

  document.getElementById('new-folder-btn').addEventListener('click', () => promptNewFolder());
  document.getElementById('new-file-btn').addEventListener('click', () => promptNewFile());

  // Search / filter for the folder tree
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    const applyFilter = debounce(() => {
      folderTreeComponent.setFilter(searchInput.value);
    }, 200);

    searchInput.addEventListener('input', applyFilter);

    // Escape clears the search
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        searchInput.value = '';
        folderTreeComponent.setFilter('');
        searchInput.blur();
      }
    });
  }

  /**
   * Whether any modal is currently open (create/rename or settings).
   * @returns {boolean}
   */
  function isModalOpen() {
    return !!document.querySelector('.modal-overlay.show');
  }

  // Keyboard shortcuts:
  //   Ctrl/Cmd+S       - force save
  //   Ctrl/Cmd+N       - new note
  //   Ctrl/Cmd+Shift+N - new folder
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    const key = e.key.toLowerCase();

    if (key === 's' && !e.shiftKey) {
      e.preventDefault();
      editorComponent.saveCurrentFile();
    } else if (key === 'n') {
      e.preventDefault();
      if (isModalOpen()) return;
      if (e.shiftKey) {
        promptNewFolder();
      } else {
        promptNewFile();
      }
    }
  });

  // Load theme from saved preference
  themeService.initialize();
});
