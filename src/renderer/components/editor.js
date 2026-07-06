import { debounce } from '../utils/debounce.js';
import { showToast } from '../services/toast.js';

/**
 * EditorComponent - Manages the text editor and file editing functionality
 */
export class EditorComponent {
  /**
   * Initialize the editor component
   * @param {Object} elements - DOM elements
   * @param {HTMLTextAreaElement} elements.editorElement - Editor textarea element
   * @param {HTMLElement} elements.pathDisplay - Element to display current file path
   * @param {HTMLButtonElement} elements.saveButton - Save button element
   * @param {HTMLElement} elements.editorHeader - Editor header element
   * @param {HTMLElement} [elements.wordCount] - Word/character count display element
   * @param {FileService} fileService - File service instance
   */
  constructor(elements, fileService) {
    this.elements = elements;
    this.fileService = fileService;
    this.activeFile = null;
    this.isEditorDirty = false;
    this.hideIndicatorTimer = null;

    this.setupEditor();
  }

  /**
   * Set up editor event listeners and UI elements
   */
  setupEditor() {
    // Create auto-save container with status indicator.
    // All presentation lives in editor.css — JS only toggles classes.
    this.autoSaveContainer = document.createElement('div');
    this.autoSaveContainer.id = 'auto-save-container';

    // Create status dot
    this.statusDot = document.createElement('span');
    this.statusDot.id = 'status-dot';

    // Create text indicator
    this.autoSaveIndicator = document.createElement('span');
    this.autoSaveIndicator.id = 'auto-save-indicator';
    this.autoSaveIndicator.textContent = 'Saved';

    // Add elements to container
    this.autoSaveContainer.appendChild(this.statusDot);
    this.autoSaveContainer.appendChild(this.autoSaveIndicator);

    // Insert before save button
    if (this.elements.editorHeader) {
      this.elements.editorHeader.insertBefore(
        this.autoSaveContainer,
        this.elements.saveButton
      );
    }

    // Set up input event with auto-save and live word count
    if (this.elements.editorElement) {
      this.elements.editorElement.addEventListener('input', () => {
        this.isEditorDirty = true;
        this.updateCounts();
        this.autoSave();
      });
    }

    // Initial (empty) count display
    this.updateCounts();

    // Set up save button
    if (this.elements.saveButton) {
      this.elements.saveButton.onclick = () => this.saveCurrentFile();
    }

    // Create debounced auto-save function
    this.autoSave = debounce(this.performAutoSave.bind(this), 1000);

    // Flush pending saves when the main process is about to quit
    this.fileService.onFlushPendingSaves(async () => {
      try {
        await this.flushPendingSave();
      } finally {
        this.fileService.notifySavesFlushed();
      }
    });
  }

  /**
   * Update the word/character count display in the editor footer.
   */
  updateCounts() {
    if (!this.elements.wordCount || !this.elements.editorElement) return;

    const content = this.elements.editorElement.value;
    const chars = content.length;
    const words = content.trim().length === 0
      ? 0
      : content.trim().split(/\s+/).length;

    this.elements.wordCount.textContent =
      `${words} ${words === 1 ? 'word' : 'words'} \u00b7 ${chars} ${chars === 1 ? 'character' : 'characters'}`;
  }

  /**
   * Update the save status indicator.
   * @param {'saving'|'saved'|'error'} state - Indicator state
   * @param {string} text - Text label to display
   * @param {Object} [options]
   * @param {boolean} [options.autoHide=false] - Fade the indicator out after a delay
   */
  setSaveStatus(state, text, { autoHide = false } = {}) {
    clearTimeout(this.hideIndicatorTimer);

    this.autoSaveIndicator.textContent = text;
    this.autoSaveContainer.classList.add('visible');

    this.statusDot.classList.remove('status-saving', 'status-saved', 'status-error');
    this.statusDot.classList.add(`status-${state}`);

    if (autoHide) {
      this.hideIndicatorTimer = setTimeout(() => {
        this.autoSaveContainer.classList.remove('visible');
      }, 1500);
    }
  }

  /**
   * Auto-save the current file
   */
  async performAutoSave() {
    if (this.activeFile && this.isEditorDirty) {
      try {
        const content = this.elements.editorElement.value;

        this.setSaveStatus('saving', 'Saving...');

        const result = await this.fileService.saveFile(this.activeFile, content);

        if (result.success) {
          this.isEditorDirty = false;
          this.setSaveStatus('saved', 'Saved', { autoHide: true });
        } else {
          this.setSaveStatus('error', 'Save failed');
          showToast(`Auto-save failed: ${result.error}`, 'error');
          console.error('Failed to auto-save file:', result.error);
        }
      } catch (error) {
        this.setSaveStatus('error', 'Save failed');
        showToast('Auto-save failed', 'error');
        console.error('Error in auto-save:', error);
      }
    }
  }

  /**
   * Flush any pending debounced auto-save immediately.
   * Called on shutdown so unsaved edits are not lost, and safe to call
   * at any time.
   */
  async flushPendingSave() {
    this.autoSave.cancel();
    if (this.activeFile && this.isEditorDirty) {
      await this.performAutoSave();
    }
  }

  /**
   * Save the current file
   */
  async saveCurrentFile() {
    try {
      if (!this.activeFile) {
        return;
      }

      // A manual save supersedes any pending auto-save
      this.autoSave.cancel();

      const content = this.elements.editorElement.value;
      const result = await this.fileService.saveFile(this.activeFile, content);

      if (result.success) {
        this.isEditorDirty = false;
        this.setSaveStatus('saved', 'Saved', { autoHide: true });
      } else {
        this.setSaveStatus('error', 'Save failed');
        showToast(`Save failed: ${result.error}`, 'error');
        console.error('Failed to save file:', result.error);
      }
    } catch (error) {
      this.setSaveStatus('error', 'Save failed');
      showToast('Save failed', 'error');
      console.error('Error in saveCurrentFile:', error);
    }
  }

  /**
   * Open a file in the editor
   * @param {string} filePath - Path to the file to open
   */
  async openFile(filePath) {
    try {
      // Auto-save any unsaved changes before switching files
      // instead of using native confirm() which causes focus issues on Windows
      if (this.isEditorDirty && this.activeFile) {
        await this.saveCurrentFile();
      }

      const result = await this.fileService.readFile(filePath);

      if (result.success) {
        this.elements.editorElement.value = result.content;
        this.activeFile = filePath;
        this.elements.pathDisplay.textContent = filePath;
        this.isEditorDirty = false;
        this.updateCounts();
      } else {
        showToast(`Could not open file: ${result.error}`, 'error');
        console.error('Failed to open file:', result.error);
      }
    } catch (error) {
      showToast('Could not open file', 'error');
      console.error('Error in openFile:', error);
    }
  }

  /**
   * Update the active path when a file or an ancestor folder is moved
   * or renamed.
   * @param {string} oldPath - Old file or folder path
   * @param {string} newPath - New file or folder path
   */
  updateFilePath(oldPath, newPath) {
    if (!this.activeFile) return;

    if (this.activeFile === oldPath) {
      // The open file itself was moved/renamed
      this.activeFile = newPath;
      this.elements.pathDisplay.textContent = newPath;
    } else if (
      this.activeFile.startsWith(oldPath + '/') ||
      this.activeFile.startsWith(oldPath + '\\')
    ) {
      // An ancestor folder of the open file was moved/renamed
      const sep = this.activeFile.charAt(oldPath.length);
      this.activeFile = newPath + sep + this.activeFile.slice(oldPath.length + 1);
      this.elements.pathDisplay.textContent = this.activeFile;
    }
  }

  /**
   * Clear the editor when a file is deleted
   * @param {string} path - Path of deleted file
   */
  handleFileDeleted(path) {
    if (this.activeFile === path) {
      this.elements.editorElement.value = '';
      this.activeFile = null;
      this.elements.pathDisplay.textContent = '';
      this.isEditorDirty = false;
      this.updateCounts();
    }
  }

  /**
   * Get the current active file path
   * @returns {string|null} Active file path or null
   */
  getActiveFile() {
    return this.activeFile;
  }
}
