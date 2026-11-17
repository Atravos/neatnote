import { debounce } from '../utils/debounce.js';
import { showToast } from '../services/toast.js';
import { toolbarIcons } from '../utils/toolbarIcons.js';
import { deltaToMarkdown } from '../utils/markdown.js';
import { baseName, displayName, isWithinPath } from '../utils/paths.js';

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
 * Elements whose text is one line of the document. Inside them every
 * space and tab the user typed is content (the editor renders with
 * `white-space: pre-wrap`), so it must survive a save / reopen exactly.
 */
const LINE_ELEMENTS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, .ql-code-block';

/** Where the last open note is remembered between launches */
const LAST_NOTE_KEY = 'neatnote-last-note';

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
 * Quill's built-in shortcuts that APPLY formatting, wrapped so they do
 * nothing while a plain text note is open.
 *
 * Without this, in a .txt note Ctrl+B showed bold that was never saved,
 * and — worse — typing "- " or "1. " at the start of a line triggered
 * Quill's list auto-format, which DELETES the typed marker and turns the
 * line into a list item. Plain text notes are saved as their visible text,
 * so the marker was gone from the file for good.
 *
 * The originals are wrapped rather than re-implemented, so their rich-text
 * behavior is exactly Quill's.
 * @param {Function} isPlainText - () => boolean
 * @returns {Object} Bindings to merge into the keyboard module's config
 */
function plainTextSafeBindings(isPlainText) {
  const bindings = {};
  let defaults = {};
  try {
    defaults = Quill.import('modules/keyboard').DEFAULTS.bindings || {};
  } catch (error) {
    console.error('Could not read Quill keyboard defaults:', error);
  }

  // true = "not handled, carry on": the keystroke is typed as plain text
  const passThrough = { 'list autofill': true };
  // false = "handled": the shortcut does nothing
  const swallow = { bold: false, italic: false, underline: false };

  for (const [name, plainResult] of Object.entries({ ...passThrough, ...swallow })) {
    const original = defaults[name];
    if (!original || typeof original.handler !== 'function') continue;
    bindings[name] = {
      ...original,
      handler(range, context) {
        if (isPlainText()) return plainResult;
        return original.handler.call(this, range, context);
      }
    };
  }
  return bindings;
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
   * @param {HTMLButtonElement} [elements.exportButton] - "Export" button element
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

    // Line-ending style of the open .txt note, restored on save so a plain
    // text file is never rewritten in a different convention
    this.plainEol = '\n';
    this.plainEndsWithNewline = false;

    // Saves run one at a time, in order (see persist())
    this.saveChain = Promise.resolve(true);
    // Reason the last save failed (null when it succeeded)
    this.lastSaveError = null;
    // Bumped by every open/close; an async open that finds a newer value
    // when it resumes knows it has been superseded and must not apply
    this.openSequence = 0;
    // Number of openFile() calls currently in progress
    this.pendingOpens = 0;
    // Pending "create a note for text typed into the empty editor"
    this.creatingNote = null;
    this.createFailureShown = false;
    // True only while loadContent() converts one of our own saved notes
    this.preserveWhitespace = false;
    this.syncingWithDisk = false;

    /** Called when notes were added/removed behind the sidebar's back */
    this.onNotesChanged = () => {};
    /** Called with the open note's path (or null) whenever it changes */
    this.onActiveFileChanged = () => {};

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
    // Announce save-state changes to assistive technology without
    // interrupting the user ('polite' waits for a pause)
    this.autoSaveContainer.setAttribute('role', 'status');
    this.autoSaveContainer.setAttribute('aria-live', 'polite');

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

    // Insert before the header buttons
    if (this.elements.editorHeader) {
      this.elements.editorHeader.insertBefore(
        this.autoSaveContainer,
        this.elements.exportButton || this.elements.saveButton
      );
    }

    // Create debounced functions (before wiring events that use them)
    this.autoSave = debounce(() => this.persist(), 1000);
    // The count walks the whole document, so it runs after typing pauses
    // rather than on every keystroke
    this.scheduleCounts = debounce(() => this.updateCounts(), 150);

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
        clipboard: {
          // Runs after Quill's own text matchers; see preserveTextMatcher
          matchers: [
            [Node.TEXT_NODE, (node, delta) => this.preserveTextMatcher(node, delta)]
          ]
        },
        // userOnly keeps programmatic file loads out of the undo stack
        history: { delay: 700, maxStack: 500, userOnly: true },
        keyboard: {
          bindings: {
            // Quill's defaults already cover Ctrl/Cmd+B/I/U, undo/redo,
            // and Tab / Shift+Tab list indent/outdent. The formatting ones
            // are wrapped to be inert in plain text notes; the rest of
            // this list adds shortcuts Quill doesn't have.
            ...plainTextSafeBindings(() => this.isPlainTextFile),
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
                if (!this.isPlainTextFile) {
                  this.quill.format('strike', !context.format.strike, 'user');
                }
                return false;
              }
            },
            clearFormat: {
              key: '\\',
              shortKey: true,
              handler: (range) => {
                if (!this.isPlainTextFile && range && range.length > 0) {
                  this.quill.removeFormat(range.index, range.length, 'user');
                }
                return false;
              }
            }
          }
        }
      }
    });

    this.quill.root.setAttribute('aria-label', 'Note content');
    this.quill.root.setAttribute('aria-multiline', 'true');

    // Dirty tracking + live word count.
    // 'silent' changes (file loads) don't emit this event, so programmatic
    // loads never trigger an auto-save.
    this.quill.on('text-change', (delta, oldDelta, source) => {
      this.scheduleCounts();
      if (source !== 'user') return;

      if (this.isPlainTextFile) this.keepPlainText(delta);

      this.isEditorDirty = true;
      if (this.activeFile) {
        this.autoSave();
      } else if (this.quill.getLength() > 1) {
        // Text typed with no note open must never be thrown away: give it
        // a note of its own. (A format toggled on the still-empty line is
        // not content, so it doesn't create one.)
        this.createNoteForUnsavedText();
      }
    });

    // Ctrl/Cmd+click follows a link (a plain click places the cursor, as in
    // any editor). window.open is intercepted by the main process, which
    // hands web and mail links to the default browser and denies the rest.
    this.quill.root.addEventListener('click', (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!anchor || !this.quill.root.contains(anchor)) return;
      event.preventDefault();
      window.open(anchor.href, '_blank', 'noopener');
    });

    // Initial (empty) count display
    this.updateCounts();

    // Set up header buttons
    if (this.elements.saveButton) {
      this.elements.saveButton.onclick = () => this.saveCurrentFile();
    }
    if (this.elements.exportButton) {
      this.elements.exportButton.title = `Export as Markdown (${mod('E', true)})`;
      this.elements.exportButton.onclick = () => this.exportMarkdown();
    }

    // Write pending edits when the window is about to close. Resolving to
    // false tells the main process the save failed, so it can ask the user
    // before closing instead of discarding the edits.
    this.fileService.onFlushPendingSaves(() => this.flushPendingSave());
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
        {
          format: 'link',
          icon: 'link',
          label: `Insert or edit link (${mod('K')}) — ${IS_MAC ? '⌘' : 'Ctrl+'}click a link to open it`
        },
        // 'clean' is Quill's built-in "remove formatting from selection"
        { format: 'clean', icon: 'clearFormat', label: `Clear formatting (${mod('\\')})` }
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
      `This is a plain text note — it stays plain text and formatting is not saved. New notes (${mod('N')}) support rich text.`;
    container.appendChild(this.plainTextBadge);
  }

  /**
   * Show the open note's name as a clean document title.
   * Displays the filename without its extension; the full path stays
   * available as a tooltip. The window title follows along.
   * @param {string|null} filePath - Path of the open file, or null for none
   */
  setDocumentTitle(filePath) {
    const el = this.elements.pathDisplay;
    const name = filePath ? displayName(filePath, { stripAllExtensions: true }) : '';

    document.title = name ? `${name} — NeatNote` : 'NeatNote';
    if (!el) return;

    if (!filePath) {
      el.textContent = '';
      el.removeAttribute('title');
      return;
    }

    el.textContent = name;
    el.title = filePath;
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
        // Undo/redo are valid operations for plain text notes — only
        // FORMATTING buttons are disabled. (Keyboard undo worked anyway;
        // disabled buttons alongside a working shortcut was just confusing.)
        const isHistory = btn.classList.contains('ql-undo') || btn.classList.contains('ql-redo');
        btn.disabled = isPlain && !isHistory;
      });
    }
    if (this.plainTextBadge) {
      this.plainTextBadge.classList.toggle('visible', isPlain);
    }
  }

  /**
   * Keep a plain text note plain: if an edit brought in formatting or an
   * embed (pasting from a web page, dropping an image), strip it straight
   * away. Otherwise the note would show bold text or a picture that the
   * .txt file cannot hold — it would silently vanish on the next open.
   * @param {Object} delta - The change that was just applied
   */
  keepPlainText(delta) {
    const addsFormatting = delta.ops.some((op) =>
      (op.attributes && Object.keys(op.attributes).length > 0) ||
      (op.insert !== undefined && typeof op.insert !== 'string'));
    if (!addsFormatting) return;

    const hadEmbed = delta.ops.some((op) => op.insert !== undefined && typeof op.insert !== 'string');
    // Up to, but not including, the document's final newline: removeFormat
    // clears the last line's own format too, and including that newline
    // in the range makes Quill append an extra blank line.
    this.quill.removeFormat(0, Math.max(0, this.quill.getLength() - 1), 'silent');
    if (hadEmbed) {
      showToast('Plain text notes can hold text only — the pasted item was left out', 'info');
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
      let text = this.quill.getText();
      // Quill documents always end with a newline. If the file did not
      // end with one when it was opened, that final newline is Quill's,
      // not the user's — drop it so the file's ending is left as it was.
      if (!this.plainEndsWithNewline && text.endsWith('\n')) {
        text = text.slice(0, -1);
      }
      // Write back in the line-ending convention the file came with
      return this.plainEol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
    }
    return this.quill.root.innerHTML;
  }

  /**
   * Text matcher that keeps whitespace exactly as saved when one of our
   * own notes is loaded.
   *
   * Quill's HTML converter is built for pasted web content, where runs of
   * whitespace are insignificant: it collapses them to a single space and
   * trims spaces at the edges of a line (unless inside <pre>). But a saved
   * note is the editor's own DOM, rendered with `white-space: pre-wrap`,
   * where every space and tab is real content. Run through the default
   * converter, "a  b" came back as "a b" and code-block indentation was
   * stripped — and the next save made that permanent.
   *
   * This matcher runs after Quill's built-in ones and, only while a note
   * is being loaded, replaces their collapsed result with the node's exact
   * text. Pasting from other apps is unaffected.
   * @param {Text} node - Text node being converted
   * @param {Object} delta - Result of Quill's default text matchers
   * @returns {Object} Delta for this text node
   */
  preserveTextMatcher(node, delta) {
    if (!this.preserveWhitespace) return delta;

    const text = node.data;
    // A line break inside a text node means hand-written/pretty-printed
    // HTML rather than something this editor saved; leave that to the
    // standard HTML rules.
    if (!text || /[\r\n]/.test(text)) return delta;

    const parent = node.parentElement;
    if (!parent || !parent.closest(LINE_ELEMENTS)) return delta;

    const Delta = Quill.import('delta');
    const exact = new Delta().insert(text);

    // Keep the line break Quill's own matchers may have appended
    const lastOp = delta.ops[delta.ops.length - 1];
    if (lastOp && typeof lastOp.insert === 'string' && lastOp.insert.endsWith('\n')) {
      exact.insert('\n');
    }
    return exact;
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
    const raw = content || '';

    if (isRich) {
      // convertHTML (not convert): convert() is meant for paste and drops a
      // trailing blank line, which made notes lose one empty line at the
      // end every time they were reopened.
      let delta;
      this.preserveWhitespace = true;
      try {
        delta = this.quill.clipboard.convertHTML(raw);
      } finally {
        this.preserveWhitespace = false;
      }
      // setContents expects a complete document, which always ends in "\n"
      const lastOp = delta.ops[delta.ops.length - 1];
      if (!lastOp || typeof lastOp.insert !== 'string' || !lastOp.insert.endsWith('\n')) {
        delta.insert('\n');
      }
      this.quill.setContents(delta, 'silent');
      this.plainEol = '\n';
      this.plainEndsWithNewline = false;
    } else {
      // Plain text: remember the file's conventions, then load with
      // normalized line breaks. Quill renders each line as a <p>.
      this.plainEol = raw.includes('\r\n') ? '\r\n' : '\n';
      this.plainEndsWithNewline = /\n$/.test(raw);
      this.quill.setText(raw.replace(/\r\n?/g, '\n'), 'silent');
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
      { defaultValue: currentUrl, confirmText: editing ? 'Update' : 'Add link', placeholder: 'https://' }
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
    const trimmed = content.trim();
    const words = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;

    this.elements.wordCount.textContent =
      `${words} ${words === 1 ? 'word' : 'words'} · ${chars} ${chars === 1 ? 'character' : 'characters'}`;
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

  // ---- Saving ----------------------------------------------------------------

  /**
   * Queue a save of the open note.
   *
   * Saves are strictly serialized: each one starts only after the previous
   * one finished, and reads the editor's path and content at the moment it
   * starts. An auto-save, a manual save, and a "save before switching
   * notes" can therefore never overlap or write an older snapshot after a
   * newer one.
   * @param {Object} [options]
   * @param {boolean} [options.manual=false] - A save the user asked for
   *        (writes even when the editor has no unsaved changes)
   * @returns {Promise<boolean>} Whether the note is safely on disk (true
   *          when there was nothing to save)
   */
  persist({ manual = false } = {}) {
    const run = this.saveChain.then(() => this.persistNow(manual));
    // A failed save must not break the queue for the saves after it
    this.saveChain = run.catch(() => false);
    return run;
  }

  /**
   * Write the open note to disk. Only called through persist().
   * @param {boolean} manual
   * @returns {Promise<boolean>}
   */
  async persistNow(manual) {
    if (!this.activeFile) return true;
    if (!this.isEditorDirty && !manual) return true;

    // Snapshot the target and content at save start. If the user keeps
    // typing while this save is in flight, the buffer will differ from the
    // snapshot when the save resolves — in that case the editor must STAY
    // dirty so the already-scheduled debounce (or the next manual save)
    // persists those newer edits.
    const targetFile = this.activeFile;
    const content = this.getEditorContent();
    const label = manual ? 'Save' : 'Auto-save';

    this.setSaveStatus('saving', 'Saving...');

    let result;
    try {
      result = await this.fileService.saveFile(targetFile, content);
    } catch (error) {
      result = { success: false, error: error.message };
    }

    if (!result || !result.success) {
      const reason = (result && result.error) || 'unknown error';
      this.setSaveStatus('error', 'Save failed');
      // While a problem persists (disk full, file locked) auto-save retries
      // after every edit. Say so once — the "Save failed" indicator stays
      // up — instead of stacking an identical toast per keystroke burst.
      if (manual || reason !== this.lastSaveError) {
        showToast(`${label} failed: ${reason}`, 'error');
      }
      this.lastSaveError = reason;
      console.error(`${label} failed:`, reason);
      return false;
    }
    this.lastSaveError = null;

    if (this.activeFile === targetFile && this.getEditorContent() === content) {
      this.isEditorDirty = false;
    }
    this.setSaveStatus('saved', 'Saved', { autoHide: true });

    if (result.conflictCopy) {
      // The note was changed outside NeatNote since it was opened. The
      // other version was kept next to it instead of being overwritten.
      showToast(
        `This note was also changed outside NeatNote. That version was kept as "${displayName(result.conflictCopy)}".`,
        'info',
        9000
      );
      this.onNotesChanged();
    }
    return true;
  }

  /**
   * Write any pending edits right now (instead of after the auto-save
   * delay). Called before closing, and before a rename/move/delete.
   * @returns {Promise<boolean>} False if a save failed
   */
  async flushPendingSave() {
    this.autoSave.cancel();
    if (this.creatingNote) await this.creatingNote;
    if (!(await this.ensureNoteForUnsavedText())) return false;
    return this.persist();
  }

  /**
   * Whether the editor holds text that belongs to no note yet (typed with
   * nothing open, and a note could not be created for it).
   * @returns {boolean}
   */
  hasOrphanText() {
    return !this.activeFile && this.isEditorDirty && this.quill.getLength() > 1;
  }

  /**
   * Make sure text typed into the empty editor has a note to live in,
   * retrying the creation once if an earlier attempt failed.
   * @returns {Promise<boolean>} False if the text still has nowhere to go
   */
  async ensureNoteForUnsavedText() {
    if (!this.hasOrphanText()) return true;
    this.createNoteForUnsavedText();
    if (this.creatingNote) await this.creatingNote;
    return !this.hasOrphanText();
  }

  /**
   * Save the current file (the Save button / Ctrl+S).
   * @returns {Promise<boolean>} Whether the save succeeded (true when there
   *          was nothing to save).
   */
  saveCurrentFile() {
    // A manual save supersedes any pending auto-save
    this.autoSave.cancel();
    return this.persist({ manual: true });
  }

  /**
   * Give text typed into the empty editor a note of its own.
   *
   * With no note open, the editor still accepts typing — and that text
   * used to be saved nowhere and silently dropped when a note was opened
   * or the app closed. Now the first edit creates "Untitled" (or
   * "Untitled 2", ...) and the text is auto-saved into it like any other
   * note.
   */
  createNoteForUnsavedText() {
    if (this.creatingNote) return;

    this.creatingNote = (async () => {
      const result = await this.fileService.createFile('Untitled', null, { unique: true });

      if (!result.success) {
        if (!this.createFailureShown) {
          this.createFailureShown = true;
          showToast(`Could not create a note for this text: ${result.error}`, 'error', 7000);
        }
        return;
      }
      this.createFailureShown = false;

      if (this.activeFile) return; // a note was opened in the meantime

      this.activeFile = result.path;
      this.setPlainTextMode(false);
      this.setDocumentTitle(result.path);
      this.notifyActiveFileChanged();
      this.onNotesChanged();
      // isEditorDirty is already true (set by the edit that got us here)
      this.autoSave();
    })()
      .catch((error) => console.error('Error creating note for unsaved text:', error))
      .finally(() => {
        this.creatingNote = null;
      });
  }

  // ---- Opening / closing notes ---------------------------------------------

  /**
   * Save the open note until the editor is clean. Loops because the user
   * can keep typing while a save is in flight.
   * @returns {Promise<boolean>} False if a save failed
   */
  async saveUntilClean() {
    while (this.isEditorDirty && this.activeFile) {
      if (!(await this.saveCurrentFile())) return false;
    }
    return true;
  }

  /**
   * Open a file in the editor
   * @param {string} filePath - Path to the file to open
   * @param {Object} [options]
   * @param {boolean} [options.force=false] - Reload even if already open
   * @param {boolean} [options.quiet=false] - No error toast if it can't be opened
   * @returns {Promise<boolean>} Whether the note is now open
   */
  async openFile(filePath, { force = false, quiet = false } = {}) {
    if (!filePath) return false;

    // Clicking the already-open note is a no-op: reloading it would
    // rebuild the editor content and wipe the undo history for nothing
    if (!force && filePath === this.activeFile) {
      return true;
    }

    // Only the most recent open may apply; an older one that resumes after
    // an await sees a newer sequence number and stops
    const sequence = ++this.openSequence;
    const superseded = () => sequence !== this.openSequence;

    this.pendingOpens += 1;
    try {
      if (this.creatingNote) await this.creatingNote;

      // Text typed with no note open must reach a note before it is replaced
      if (!(await this.ensureNoteForUnsavedText())) {
        showToast('Not opening the note — the text you typed could not be saved yet', 'error');
        return false;
      }
      if (superseded()) return false;

      // Save any unsaved changes before switching files instead of using
      // native confirm() which causes focus issues on Windows. If that
      // save FAILS, abort the switch — loading the new note anyway would
      // silently discard the unsaved buffer.
      if (!(await this.saveUntilClean())) {
        showToast('Not switching notes — the current note could not be saved', 'error');
        return false;
      }
      if (superseded()) return false;

      const result = await this.fileService.readFile(filePath);
      if (superseded()) return false;

      if (!result.success) {
        if (!quiet) showToast(`Could not open note: ${result.error}`, 'error');
        console.error('Failed to open file:', result.error);
        return false;
      }

      // Keystrokes may have landed in the old note while the new one was
      // being read; save them before the buffer is replaced
      if (!(await this.saveUntilClean())) {
        showToast('Not switching notes — the current note could not be saved', 'error');
        return false;
      }
      if (superseded()) return false;

      // From here to the end there is no await: the path and the content
      // change together, so nothing can save one note's text to another
      // note's file.
      this.autoSave.cancel();
      this.activeFile = filePath;
      this.setDocumentTitle(filePath);
      this.loadContent(filePath, result.content);
      this.isEditorDirty = false;
      this.updateCounts();
      this.notifyActiveFileChanged();
      return true;
    } catch (error) {
      if (!quiet) showToast('Could not open note', 'error');
      console.error('Error in openFile:', error);
      return false;
    } finally {
      this.pendingOpens -= 1;
    }
  }

  /**
   * Close the open note and return the editor to its empty state.
   * Does not save — callers flush first when the content matters.
   */
  closeNote() {
    this.openSequence += 1; // cancels any open still in flight
    this.autoSave.cancel();
    this.activeFile = null;
    this.quill.setText('', 'silent');
    this.quill.history.clear();
    this.setPlainTextMode(false);
    this.plainEol = '\n';
    this.plainEndsWithNewline = false;
    this.setDocumentTitle(null);
    this.isEditorDirty = false;
    this.updateCounts();
    this.notifyActiveFileChanged();
  }

  /**
   * Reopen the note that was open when the app was last closed.
   * @returns {Promise<boolean>}
   */
  async restoreLastNote() {
    let lastPath = null;
    try {
      lastPath = localStorage.getItem(LAST_NOTE_KEY);
    } catch (error) {
      return false;
    }
    if (!lastPath || this.activeFile) return false;

    const opened = await this.openFile(lastPath, { quiet: true });
    if (!opened && !this.activeFile) {
      try { localStorage.removeItem(LAST_NOTE_KEY); } catch (error) { /* ignore */ }
    }
    return opened;
  }

  /** Tell listeners which note is open, and remember it for next launch. */
  notifyActiveFileChanged() {
    try {
      if (this.activeFile) {
        localStorage.setItem(LAST_NOTE_KEY, this.activeFile);
      } else {
        localStorage.removeItem(LAST_NOTE_KEY);
      }
    } catch (error) {
      // Remembering the last note is a convenience only
    }
    try {
      this.onActiveFileChanged(this.activeFile);
    } catch (error) {
      console.error('Error in onActiveFileChanged:', error);
    }
  }

  /**
   * Pick up changes made to the open note outside the app (another
   * editor, a sync tool). Called when the window regains focus.
   *   - Unchanged on disk: nothing happens.
   *   - Changed, and the editor has no unsaved edits: reload it.
   *   - Changed, and the editor HAS unsaved edits: keep the editor's
   *     version; the next save preserves the on-disk one as a conflict
   *     copy (see FileService.saveFile).
   *   - Deleted, with no unsaved edits: close it.
   */
  async syncWithDisk() {
    // Never while a note is being opened: a reload started here would
    // cancel the open the user just asked for (clicking a note in an
    // unfocused window both focuses the window and opens the note)
    if (!this.activeFile || this.syncingWithDisk || this.creatingNote || this.pendingOpens > 0) return;
    this.syncingWithDisk = true;

    try {
      const target = this.activeFile;
      const result = await this.fileService.checkFileChanged(target);
      if (!result.success || this.activeFile !== target || this.isEditorDirty) return;
      if (this.pendingOpens > 0) return;

      if (!result.exists) {
        // Look twice before concluding the note is gone: a rename or move
        // started inside the app also makes the old path vanish for a
        // moment, until the editor is told the new path.
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (this.activeFile !== target || this.isEditorDirty || this.pendingOpens > 0) return;
        const recheck = await this.fileService.checkFileChanged(target);
        if (!recheck.success || recheck.exists) return;
        if (this.activeFile !== target || this.isEditorDirty || this.pendingOpens > 0) return;

        this.closeNote();
        showToast(`"${displayName(target)}" was removed outside NeatNote`, 'info');
        this.onNotesChanged();
        return;
      }

      if (result.changed) {
        // Reloading moves focus into the editor; put it back where it was
        const focused = document.activeElement;
        const selection = this.quill.getSelection();
        const hadEditorFocus = this.quill.hasFocus();

        const reloaded = await this.openFile(target, { force: true, quiet: true });
        if (!reloaded) return;

        if (hadEditorFocus && selection) {
          const index = Math.min(selection.index, Math.max(0, this.quill.getLength() - 1));
          this.quill.setSelection(index, 0, 'silent');
        } else if (focused && focused !== document.body && document.contains(focused) &&
                   typeof focused.focus === 'function') {
          focused.focus();
        } else {
          this.quill.blur();
        }
      }
    } catch (error) {
      console.error('Error checking for outside changes:', error);
    } finally {
      this.syncingWithDisk = false;
    }
  }

  // ---- Export ----------------------------------------------------------------

  /**
   * Export the open note as a Markdown file the user picks a place for.
   */
  async exportMarkdown() {
    if (!this.activeFile) {
      showToast('Open a note to export it', 'info');
      return;
    }

    try {
      const name = displayName(this.activeFile, { stripAllExtensions: true });
      const markdown = this.isPlainTextFile
        ? this.quill.getText()
        : deltaToMarkdown(this.quill.getContents().ops);

      const result = await this.fileService.exportNote(name, markdown);
      if (result.success) {
        showToast(`Exported to ${baseName(result.path)}`, 'success');
      } else if (!result.cancelled) {
        showToast(`Export failed: ${result.error}`, 'error');
      }
    } catch (error) {
      showToast('Export failed', 'error');
      console.error('Error exporting note:', error);
    }
  }

  // ---- Reacting to file operations in the sidebar ----------------------------

  /**
   * Flush pending edits before a rename, move, or delete that affects the
   * open note (either the note itself or an ancestor folder). Because
   * saves are serialized, awaiting the flush also waits for any save that
   * was already in flight — so nothing can write to the old path after
   * the operation and recreate a renamed/moved/deleted file.
   * @param {string} affectedPath - Path being renamed, moved, or deleted
   * @returns {Promise<boolean>} False if pending edits could not be saved
   */
  async prepareForPathChange(affectedPath) {
    if (!affectedPath) return true;
    if (this.creatingNote) await this.creatingNote;
    if (!this.activeFile || !isWithinPath(this.activeFile, affectedPath)) return true;
    return this.flushPendingSave();
  }

  /**
   * Update the active path when a file or an ancestor folder is moved
   * or renamed.
   * @param {string} oldPath - Old file or folder path
   * @param {string} newPath - New file or folder path
   */
  updateFilePath(oldPath, newPath) {
    if (!this.activeFile || !isWithinPath(this.activeFile, oldPath)) return;

    // Works for the note itself (the remainder is empty) and for a note
    // inside a moved/renamed folder (the remainder is "/sub/note.html")
    this.activeFile = newPath + this.activeFile.slice(oldPath.length);
    this.setDocumentTitle(this.activeFile);
    this.notifyActiveFileChanged();
  }

  /**
   * Clear the editor when the open note — or a folder containing it — is
   * deleted. (Checking only for an exact match used to leave a "ghost"
   * note open after its folder was trashed, with every later edit failing
   * to save.)
   * @param {string} deletedPath - Path of the deleted file or folder
   */
  handleFileDeleted(deletedPath) {
    if (this.activeFile && isWithinPath(this.activeFile, deletedPath)) {
      this.closeNote();
    }
  }

  /**
   * Get the current active file path
   * @returns {string|null} Active file path or null
   */
  getActiveFile() {
    return this.activeFile;
  }

  /** Move keyboard focus into the note. */
  focus() {
    if (this.quill) this.quill.focus();
  }
}
