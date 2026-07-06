import { debounce } from '../utils/debounce.js';
import { showToast } from '../services/toast.js';
import { toolbarIcons } from '../utils/toolbarIcons.js';

/*
 * Rich text editor built on Quill 2 (vendored in /vendor/quill, loaded as a
 * global by index.html — no bundler, no CDN, works offline).
 *
 * File format:
 *   - New notes are `.html` files containing only the editor content
 *     fragment (Quill's root innerHTML), not a full HTML document.
 *   - Legacy `.txt` notes still open (as plain text) and stay plain text:
 *     saving a .txt writes plain text, never HTML, so old notes are not
 *     silently converted. The toolbar is disabled for .txt notes and a
 *     "Plain text" badge explains why.
 */

/** Quill global from the vendored UMD bundle */
const Quill = window.Quill;

// ---------------------------------------------------------------------------
// Custom "divider" blot (horizontal rule) — Quill has no built-in <hr>.
// Registered once; the tagName mapping makes <hr> round-trip through
// Quill's clipboard converter when loading saved notes.
// ---------------------------------------------------------------------------
let dividerRegistered = false;
function registerDividerBlot() {
  if (dividerRegistered || !Quill) return;
  const BlockEmbed = Quill.import('blots/block/embed');
  class DividerBlot extends BlockEmbed {}
  DividerBlot.blotName = 'divider';
  DividerBlot.tagName = 'hr';
  Quill.register(DividerBlot);
  dividerRegistered = true;
}

/** True when running on macOS (used for shortcut labels in tooltips) */
const IS_MAC = /mac/i.test(
  (navigator.userAgentData && navigator.userAgentData.platform) ||
  navigator.platform ||
  ''
);

/**
 * Format a shortcut label for tooltips, e.g. mod('B') -> "Ctrl+B" / "⌘B".
 * @param {string} key - Key name
 * @param {boolean} [shift=false] - Whether Shift is part of the shortcut
 * @returns {string}
 */
function mod(key, shift = false) {
  if (IS_MAC) {
    return `${shift ? '⇧' : ''}⌘${key}`;
  }
  return `Ctrl+${shift ? 'Shift+' : ''}${key}`;
}

/**
 * EditorComponent - Manages the rich text editor and file editing functionality
 */
export class EditorComponent {
  /**
   * Initialize the editor component
   * @param {Object} elements - DOM elements
   * @param {HTMLElement} elements.editorElement - Editor mount point (div)
   * @param {HTMLElement} elements.toolbarElement - Toolbar container (div)
   * @param {HTMLElement} elements.pathDisplay - Element to display current file path
   * @param {HTMLButtonElement} elements.saveButton - Save button element
   * @param {HTMLElement} elements.editorHeader - Editor header element
   * @param {HTMLElement} [elements.wordCount] - Word/character count display element
   * @param {FileService} fileService - File service instance
   * @param {ModalComponent} modalComponent - Modal component (used for the link dialog)
   */
  constructor(elements, fileService, modalComponent) {
    this.elements = elements;
    this.fileService = fileService;
    this.modalComponent = modalComponent;
    this.activeFile = null;
    this.isEditorDirty = false;
    this.isPlainTextFile = false;
    this.hideIndicatorTimer = null;

    this.setupEditor();
  }

  /**
   * Set up the Quill editor, toolbar, and all event listeners
   */
  setupEditor() {
    if (!Quill) {
      showToast('Editor failed to load (Quill missing)', 'error');
      console.error('window.Quill is not available — check vendor/quill/quill.js');
      return;
    }

    registerDividerBlot();
    this.buildToolbar();

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

    // Create debounced auto-save function (before wiring events that use it)
    this.autoSave = debounce(this.performAutoSave.bind(this), 1000);

    // Initialize Quill on the editor mount point.
    // No theme module: the custom toolbar + our own CSS provide all chrome.
    this.quill = new Quill(this.elements.editorElement, {
      placeholder: 'Start typing...',
      modules: {
        toolbar: {
          container: this.elements.toolbarElement,
          handlers: {
            // Custom actions the toolbar module doesn't know natively
            link: () => this.handleLinkAction(),
            divider: () => this.insertDivider(),
            undo: () => this.quill.history.undo(),
            redo: () => this.quill.history.redo()
          }
        },
        // userOnly keeps programmatic file loads out of the undo stack
        history: { delay: 700, maxStack: 500, userOnly: true },
        keyboard: {
          bindings: {
            // Quill's defaults already cover Ctrl/Cmd+B/I/U, undo/redo,
            // and Tab / Shift+Tab list indent/outdent. These add the rest.
            link: {
              key: 'k',
              shortKey: true,
              handler: () => {
                this.handleLinkAction();
                return false;
              }
            },
            strike: {
              key: 'x',
              shortKey: true,
              shiftKey: true,
              handler: (range, context) => {
                this.quill.format('strike', !context.format.strike, 'user');
                return false;
              }
            }
          }
        }
      }
    });

    // Dirty tracking + live word count.
    // 'silent' changes (file loads) don't emit this event, so programmatic
    // loads never trigger an auto-save.
    this.quill.on('text-change', (delta, oldDelta, source) => {
      this.updateCounts();
      if (source === 'user') {
        this.isEditorDirty = true;
        this.autoSave();
      }
    });

    // Initial (empty) count display
    this.updateCounts();

    // Set up save button
    if (this.elements.saveButton) {
      this.elements.saveButton.onclick = () => this.saveCurrentFile();
    }

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
   * Build the formatting toolbar inside the toolbar container.
   * Buttons use Quill's `ql-<format>` class convention so the toolbar
   * module wires clicks and active-state highlighting automatically;
   * link / divider / undo / redo use the custom handlers above.
   */
  buildToolbar() {
    const container = this.elements.toolbarElement;
    if (!container) return;
    container.innerHTML = '';

    const groups = [
      [
        { format: 'bold', icon: 'bold', label: `Bold (${mod('B')})` },
        { format: 'italic', icon: 'italic', label: `Italic (${mod('I')})` },
        { format: 'underline', icon: 'underline', label: `Underline (${mod('U')})` },
        { format: 'strike', icon: 'strike', label: `Strikethrough (${mod('X', true)})` }
      ],
      [
        { format: 'header', value: '1', icon: 'header1', label: 'Heading 1' },
        { format: 'header', value: '2', icon: 'header2', label: 'Heading 2' },
        { format: 'header', value: '3', icon: 'header3', label: 'Heading 3' }
      ],
      [
        { format: 'list', value: 'bullet', icon: 'bulletList', label: 'Bulleted list (Tab / Shift+Tab to indent)' },
        { format: 'list', value: 'ordered', icon: 'orderedList', label: 'Numbered list (Tab / Shift+Tab to indent)' }
      ],
      [
        { format: 'blockquote', icon: 'blockquote', label: 'Blockquote' },
        { format: 'code-block', icon: 'codeBlock', label: 'Code block' },
        { format: 'code', icon: 'inlineCode', label: 'Inline code' }
      ],
      [
        { format: 'divider', icon: 'horizontalRule', label: 'Horizontal rule' },
        { format: 'link', icon: 'link', label: `Insert or edit link (${mod('K')})` }
      ],
      [
        { format: 'undo', icon: 'undo', label: `Undo (${mod('Z')})` },
        { format: 'redo', icon: 'redo', label: `Redo (${mod('Z', true)})` }
      ]
    ];

    groups.forEach((group, groupIndex) => {
      if (groupIndex > 0) {
        const sep = document.createElement('span');
        sep.className = 'toolbar-separator';
        sep.setAttribute('aria-hidden', 'true');
        container.appendChild(sep);
      }
      group.forEach((btn) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `toolbar-btn ql-${btn.format}`;
        if (btn.value !== undefined) button.setAttribute('value', btn.value);
        button.title = btn.label;
        button.setAttribute('aria-label', btn.label);
        button.innerHTML = toolbarIcons[btn.icon];
        container.appendChild(button);
      });
    });

    // Badge shown when a legacy plain text (.txt) note is open
    this.plainTextBadge = document.createElement('span');
    this.plainTextBadge.className = 'plain-text-badge';
    this.plainTextBadge.textContent = 'Plain text';
    this.plainTextBadge.title =
      'This is a legacy .txt note — it stays plain text and formatting is not saved. New notes (Ctrl+N) support rich text.';
    container.appendChild(this.plainTextBadge);
  }

  /**
   * Whether a file should be treated as rich text based on its extension.
   * Anything that isn't .html/.htm is treated as plain text for safety.
   * @param {string} filePath - File path
   * @returns {boolean}
   */
  isRichTextFile(filePath) {
    return /\.html?$/i.test(filePath || '');
  }

  /**
   * Toggle plain text mode: disables the formatting toolbar and shows a
   * badge so it's clear why formatting isn't available for .txt notes.
   * @param {boolean} isPlain - Whether the open file is plain text
   */
  setPlainTextMode(isPlain) {
    this.isPlainTextFile = isPlain;

    const toolbar = this.elements.toolbarElement;
    if (toolbar) {
      toolbar.classList.toggle('toolbar-disabled', isPlain);
      toolbar.querySelectorAll('button').forEach((btn) => {
        btn.disabled = isPlain;
      });
    }
    if (this.plainTextBadge) {
      this.plainTextBadge.classList.toggle('visible', isPlain);
    }
  }

  /**
   * Get the content to persist for the currently open file.
   * Rich notes store the editor's content HTML fragment; plain text notes
   * store visible text only (so legacy .txt files are never converted).
   * @returns {string}
   */
  getEditorContent() {
    if (this.isPlainTextFile) {
      const text = this.quill.getText();
      // Quill documents always end with a newline it adds itself —
      // strip that single trailing newline so files stay byte-stable.
      return text.endsWith('\n') ? text.slice(0, -1) : text;
    }
    return this.quill.root.innerHTML;
  }

  /**
   * Load file content into the editor based on the file type.
   * Uses 'silent' so loads never mark the editor dirty or trigger
   * auto-save, and clears undo history so Ctrl+Z can't restore the
   * previously open note.
   * @param {string} filePath - Path of the file being opened
   * @param {string} content - Raw file content
   */
  loadContent(filePath, content) {
    const isRich = this.isRichTextFile(filePath);

    if (isRich) {
      const delta = this.quill.clipboard.convert({ html: content || '' });
      this.quill.setContents(delta, 'silent');
    } else {
      // Legacy plain text: load as-is. Quill renders each line as a <p>.
      this.quill.setText(content || '', 'silent');
    }

    this.quill.history.clear();
    this.setPlainTextMode(!isRich);

    // Place the cursor at the start; this also refreshes the toolbar's
    // active-state highlighting for the new document.
    this.quill.setSelection(0, 0, 'api');
  }

  /**
   * Insert a horizontal rule at the cursor.
   */
  insertDivider() {
    if (this.isPlainTextFile) return;
    const range = this.quill.getSelection(true);
    // Split the current block, insert the rule, and put the cursor after it
    this.quill.insertText(range.index, '\n', 'user');
    this.quill.insertEmbed(range.index + 1, 'divider', true, 'user');
    this.quill.setSelection(range.index + 2, 0, 'silent');
  }

  /**
   * Find the full range and URL of the link blot at a document index.
   * @param {number} index - Document index
   * @returns {{range: {index: number, length: number}, url: string}|null}
   */
  findLinkBlotAt(index) {
    try {
      const [leaf] = this.quill.getLeaf(index);
      let blot = leaf;
      while (blot && blot !== this.quill.scroll && blot.statics.blotName !== 'link') {
        blot = blot.parent;
      }
      if (!blot || blot === this.quill.scroll || blot.statics.blotName !== 'link') {
        return null;
      }
      const url =
        (typeof blot.formats === 'function' && blot.formats().link) ||
        (blot.domNode && blot.domNode.getAttribute('href')) ||
        '';
      return {
        range: { index: this.quill.getIndex(blot), length: blot.length() },
        url
      };
    } catch (error) {
      console.error('Error locating link blot:', error);
      return null;
    }
  }

  /**
   * Insert, edit, or remove a link via the app's modal dialog.
   * - Text selected: add/replace a link on the selection.
   * - Cursor inside an existing link: edit that whole link.
   * - Confirming with an empty URL removes the link.
   */
  handleLinkAction() {
    if (this.isPlainTextFile) return;

    const range = this.quill.getSelection(true);
    if (!range) return;

    let target = null;
    let currentUrl = '';

    if (range.length > 0) {
      target = range;
      currentUrl = this.quill.getFormat(range).link || '';
    } else {
      const existing = this.findLinkBlotAt(range.index);
      if (!existing) {
        showToast('Select some text first to add a link', 'info');
        return;
      }
      target = existing.range;
      currentUrl = existing.url;
    }

    const editing = !!currentUrl;
    this.modalComponent.show(
      editing ? 'Edit link — leave empty to remove' : 'Link URL',
      (value) => {
        const url = (value || '').trim();

        if (url === '') {
          if (editing) {
            this.quill.formatText(target.index, target.length, 'link', false, 'user');
          }
          return;
        }

        // Default to https:// when no scheme is given ("example.com").
        // Quill's Link format additionally sanitizes unsafe protocols.
        const normalized = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) ? url : `https://${url}`;
        this.quill.formatText(target.index, target.length, 'link', normalized, 'user');
      },
      { defaultValue: currentUrl, confirmText: editing ? 'Update' : 'Add link' }
    );
  }

  /**
   * Update the word/character count display in the editor footer.
   * Counts visible text only — never HTML tags.
   */
  updateCounts() {
    if (!this.elements.wordCount || !this.quill) return;

    const raw = this.quill.getText();
    // Ignore the trailing newline Quill always appends to the document
    const content = raw.endsWith('\n') ? raw.slice(0, -1) : raw;

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
        const content = this.getEditorContent();

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

      const content = this.getEditorContent();
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
        // Set the active file and mode before loading so nothing
        // in between can save the new content to the old path.
        this.activeFile = filePath;
        this.elements.pathDisplay.textContent = filePath;
        this.loadContent(filePath, result.content);
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
      this.activeFile = null;
      this.quill.setText('', 'silent');
      this.quill.history.clear();
      this.setPlainTextMode(false);
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
