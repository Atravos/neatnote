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
 * Letter of a keyboard shortcut, independent of the keyboard layout.
 * `event.key` is the character the layout produces — on a Cyrillic, Greek
 * or Hebrew layout Ctrl+S reports a non-Latin letter and would never
 * match "s". `event.code` names the physical key, so it is the fallback.
 * @param {KeyboardEvent} event
 * @returns {string} Lowercase key name
 */
function shortcutKey(event) {
  const key = event.key || '';
  if (/^[a-z]$/i.test(key)) return key.toLowerCase();
  const code = event.code || '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  return key.toLowerCase();
}

/**
 * Initialize the application when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', () => {
  // Initialize services
  const fileService = new FileService(window.api);
  const themeService = new ThemeService();
  const dragDropService = new DragDropService();

  // Custom titlebar (frameless window): drag region + window controls
  new TitlebarComponent(document.getElementById('titlebar-controls'));

  // Initialize modal component first (used by the editor's link dialog
  // and by the folder tree for create/rename/delete)
  const modalComponent = new ModalComponent({
    modalOverlay: document.getElementById('modal-overlay'),
    modalTitle: document.getElementById('modal-title'),
    modalInput: document.getElementById('modal-input'),
    cancelButton: document.getElementById('modal-cancel-btn'),
    confirmButton: document.getElementById('modal-confirm-btn')
  });

  // Initialize editor component
  const editorComponent = new EditorComponent(
    {
      editorElement: document.getElementById('editor'),
      toolbarElement: document.getElementById('editor-toolbar'),
      pathDisplay: document.getElementById('current-file-path'),
      saveButton: document.getElementById('save-btn'),
      exportButton: document.getElementById('export-btn'),
      editorHeader: document.querySelector('.editor-header'),
      wordCount: document.getElementById('word-count')
    },
    fileService,
    modalComponent
  );

  // Initialize folder tree component
  const folderTreeComponent = new FolderTreeComponent(
    document.getElementById('folder-tree'),
    fileService,
    editorComponent,
    dragDropService,
    modalComponent
  );

  // The editor tells the sidebar when the open note changes, and when
  // notes appeared or disappeared without the sidebar's involvement
  editorComponent.onActiveFileChanged = () => {
    folderTreeComponent.highlightActiveFile();
    folderTreeComponent.updateTabStop();
  };
  editorComponent.onNotesChanged = () => folderTreeComponent.refresh();

  // Initialize trash component
  new TrashComponent(
    document.getElementById('trash-container'),
    editorComponent,
    folderTreeComponent,
    dragDropService
  );

  // Initialize settings component (also applies the saved theme)
  new SettingsComponent(
    {
      settingsIcon: document.getElementById('settings-icon'),
      settingsOverlay: document.getElementById('settings-overlay'),
      closeButton: document.getElementById('settings-close-btn'),
      themeOptions: document.querySelectorAll('.theme-option')
    },
    themeService,
    fileService
  );

  // Once the sidebar is loaded, pick up where the user left off — and make
  // sure the restored note is visible in the tree
  folderTreeComponent.ready
    .then(() => editorComponent.restoreLastNote())
    .then((restored) => {
      if (restored) return folderTreeComponent.revealFile(editorComponent.getActiveFile());
      return null;
    })
    .catch((error) => console.error('Error restoring the last session:', error));

  // ---- Sidebar buttons -------------------------------------------------------

  const newNote = () => folderTreeComponent.promptCreate('file', null);
  const newFolder = () => folderTreeComponent.promptCreate('folder', null);

  document.getElementById('new-folder-btn').addEventListener('click', newFolder);
  document.getElementById('new-file-btn').addEventListener('click', newNote);

  // ---- Search ------------------------------------------------------------------

  const searchInput = document.getElementById('search-input');

  const focusSearch = () => {
    if (!searchInput) return;
    searchInput.focus();
    searchInput.select();
  };

  if (searchInput) {
    const applyFilter = debounce(() => {
      folderTreeComponent.setFilter(searchInput.value);
    }, 200);

    searchInput.addEventListener('input', applyFilter);

    searchInput.addEventListener('keydown', (e) => {
      // Keys pressed while composing text with an IME belong to the IME
      if (e.isComposing || e.keyCode === 229) return;

      if (e.key === 'Escape') {
        // Escape clears the search
        e.preventDefault();
        applyFilter.cancel();
        searchInput.value = '';
        folderTreeComponent.setFilter('');
        searchInput.blur();
      } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
        // Step from the search box into the results
        const first = folderTreeComponent.visibleRows()[0];
        if (first) {
          e.preventDefault();
          folderTreeComponent.setCurrentRow(first, { focus: true });
        }
      }
    });
  }

  // ---- Keyboard shortcuts ---------------------------------------------------

  /**
   * Whether any modal is currently open (create/rename or settings).
   * @returns {boolean}
   */
  function isModalOpen() {
    return !!document.querySelector('.modal-overlay.show');
  }

  /**
   * Run an app-level action. Shared by keyboard shortcuts and the native
   * macOS menu bar.
   * @param {string} action
   */
  function runAction(action) {
    switch (action) {
      case 'save':
        editorComponent.saveCurrentFile();
        break;
      case 'new-note':
        if (!isModalOpen()) newNote();
        break;
      case 'new-folder':
        if (!isModalOpen()) newFolder();
        break;
      case 'export-markdown':
        if (!isModalOpen()) editorComponent.exportMarkdown();
        break;
      case 'search':
        if (!isModalOpen()) focusSearch();
        break;
      default:
        break;
    }
  }

  // Keyboard shortcuts:
  //   Ctrl/Cmd+S       - save now
  //   Ctrl/Cmd+N       - new note
  //   Ctrl/Cmd+Shift+N - new folder
  //   Ctrl/Cmd+P, Ctrl/Cmd+Shift+F - search notes
  //   Ctrl/Cmd+Shift+E - export the open note as Markdown
  //
  // The modifier is Cmd on macOS and Ctrl elsewhere — not "either": on
  // macOS Ctrl+N / Ctrl+P / Ctrl+E are the system's text-navigation keys
  // and must keep working in the editor. Alt is excluded so AltGr
  // (reported as Ctrl+Alt on Windows) can still type characters.
  const isMac = !!(window.api && window.api.windowControls &&
    window.api.windowControls.platform === 'darwin');

  document.addEventListener('keydown', (e) => {
    const modifier = isMac ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey);
    if (!modifier || e.altKey) return;

    const key = shortcutKey(e);
    let action = null;

    if (key === 's' && !e.shiftKey) action = 'save';
    else if (key === 'n') action = e.shiftKey ? 'new-folder' : 'new-note';
    else if (key === 'p' && !e.shiftKey) action = 'search';
    else if (key === 'f' && e.shiftKey) action = 'search';
    else if (key === 'e' && e.shiftKey) action = 'export-markdown';

    if (!action) return;
    e.preventDefault();
    runAction(action);
  });

  if (window.api && typeof window.api.onMenuAction === 'function') {
    window.api.onMenuAction(runAction);
  }

  // ---- Window-level behavior --------------------------------------------------

  // Coming back to the app: pick up anything that changed on disk while
  // it was in the background (an edit in another program, a sync client).
  // Both calls are no-ops when nothing changed.
  window.addEventListener('focus', () => {
    editorComponent.syncWithDisk();
    folderTreeComponent.refreshIfChanged();
  });

  // Files dragged in from the desktop are not something the app imports.
  // Outside the editor, show "not allowed" rather than letting the window
  // react to the drop. (The sidebar and trash already do this themselves.)
  const isOverEditor = (event) =>
    event.target instanceof Element && !!event.target.closest('#editor');

  document.addEventListener('dragover', (event) => {
    if (dragDropService.isDragging() || isOverEditor(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  });
  document.addEventListener('drop', (event) => {
    if (isOverEditor(event)) return;
    event.preventDefault();
  });

  // Surface unexpected errors instead of failing silently
  window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
  });

});
