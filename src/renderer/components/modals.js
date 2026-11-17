import { focusWhenReady, restoreFocus } from '../utils/focus.js';

/**
 * ModalComponent - Manages modal dialogs in the application
 * Supports both text-input modals and confirmation dialogs.
 *
 * Accessibility / keyboard behavior:
 *   - Enter confirms, Escape cancels (same semantics as the buttons)
 *   - Clicking the backdrop (outside the dialog) cancels
 *   - Tab / Shift+Tab are trapped inside the dialog while it is open
 *   - Focus returns to the previously focused element on close
 */

/**
 * Keep Tab / Shift+Tab cycling within a container's focusable elements.
 * Shared by every dialog in the app.
 * @param {HTMLElement} container - Dialog overlay
 * @param {KeyboardEvent} event - The Tab keydown event
 */
export function trapFocus(container, event) {
  const focusables = Array.from(
    container.querySelectorAll(
      'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => !el.disabled && el.offsetParent !== null);

  if (focusables.length === 0) return;

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;

  if (event.shiftKey) {
    if (active === first || !container.contains(active)) {
      event.preventDefault();
      last.focus();
    }
  } else if (active === last || !container.contains(active)) {
    event.preventDefault();
    first.focus();
  }
}

export class ModalComponent {
  /**
   * Initialize the modal component
   * @param {Object} elements - DOM elements
   * @param {HTMLElement} elements.modalOverlay - Modal overlay element
   * @param {HTMLElement} elements.modalTitle - Modal title element
   * @param {HTMLInputElement} elements.modalInput - Modal input element
   * @param {HTMLButtonElement} elements.cancelButton - Cancel button element
   * @param {HTMLButtonElement} elements.confirmButton - Confirm button element
   */
  constructor(elements) {
    this.elements = elements;
    this.currentCallback = null;
    this.mode = 'input'; // 'input' or 'confirm'
    this.previouslyFocused = null;

    this.setupEventListeners();
  }

  /**
   * Whether the modal is currently visible.
   * @returns {boolean}
   */
  isOpen() {
    return this.elements.modalOverlay.classList.contains('show');
  }

  /**
   * Cancel the modal: hide it and, in confirm mode, report `false`
   * to the callback. Shared by the Cancel button, Escape, and
   * backdrop clicks so all three behave identically.
   */
  cancel() {
    const callback = this.currentCallback;
    const mode = this.mode;
    this.hide();
    if (mode === 'confirm' && callback) {
      callback(false);
    }
  }

  /**
   * Confirm the modal with the current input value (input mode)
   * or `true` (confirm mode).
   */
  confirm() {
    const callback = this.currentCallback;
    if (this.mode === 'confirm') {
      this.hide();
      if (callback) {
        callback(true);
      }
    } else {
      const value = this.elements.modalInput.value.trim();
      this.hide();
      if (callback) {
        callback(value);
      }
    }
  }

  /**
   * Set up event listeners for modal elements
   */
  setupEventListeners() {
    const overlay = this.elements.modalOverlay;

    // Cancel button closes the modal
    if (this.elements.cancelButton) {
      this.elements.cancelButton.onclick = () => this.cancel();
    }

    // Confirm button calls the callback
    if (this.elements.confirmButton) {
      this.elements.confirmButton.onclick = () => this.confirm();
    }

    // Enter in the input field confirms (input mode only).
    //
    // This listens on keyDOWN, with three guards, instead of keyup:
    //   - isComposing / keyCode 229: with an IME (Japanese, Chinese,
    //     Korean, ...) Enter first commits the text being composed. That
    //     Enter must not also submit the dialog with a half-typed name.
    //   - repeat: a held Enter must not confirm a dialog that opened while
    //     the key was already down.
    //   - a keyup listener fired for the release of the very Enter press
    //     that OPENED the dialog (e.g. Enter on the "New File" button),
    //     closing it again immediately.
    if (this.elements.modalInput) {
      this.elements.modalInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || this.mode !== 'input') return;
        if (event.isComposing || event.keyCode === 229 || event.repeat) return;
        event.preventDefault();
        event.stopPropagation();
        this.confirm();
      });
    }

    if (overlay) {
      // Clicking the backdrop (the overlay itself, not the dialog inside
      // it) cancels. mousedown is checked too so a drag that starts inside
      // the dialog and ends on the backdrop doesn't dismiss it.
      let mousedownOnBackdrop = false;
      overlay.addEventListener('mousedown', (event) => {
        mousedownOnBackdrop = event.target === overlay;
      });
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay && mousedownOnBackdrop) {
          this.cancel();
        }
      });

      // Escape cancels; Tab is trapped inside the dialog
      overlay.addEventListener('keydown', (event) => {
        if (!this.isOpen()) return;

        if (event.key === 'Escape') {
          // Escape during IME composition only cancels the composition
          if (event.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          event.stopPropagation();
          this.cancel();
          return;
        }

        if (event.key === 'Tab') {
          trapFocus(overlay, event);
        }
      });
    }
  }

  /**
   * Remember where focus was so hide() can put it back. If a dialog is
   * already open (one dialog replacing another), the element remembered
   * for the first one is kept — the dialog's own button is not a useful
   * place to return to.
   */
  rememberFocus() {
    if (this.isOpen() && this.previouslyFocused) return;
    const active = document.activeElement;
    // Never "return" to something inside the dialog itself
    this.previouslyFocused =
      active && !this.elements.modalOverlay.contains(active) ? active : null;
  }

  /**
   * Show the modal as a text input dialog
   * @param {string} title - Modal title
   * @param {Function} callback - Function to call with input value
   * @param {Object} [options]
   * @param {string} [options.defaultValue=''] - Prefilled input value (selected on focus)
   * @param {string} [options.confirmText='Create'] - Confirm button label
   * @param {string} [options.placeholder='Name'] - Input placeholder
   */
  show(title, callback, { defaultValue = '', confirmText = 'Create', placeholder = 'Name' } = {}) {
    this.rememberFocus();
    this.mode = 'input';
    this.elements.modalTitle.textContent = title;
    this.elements.modalInput.value = defaultValue;
    this.elements.modalInput.placeholder = placeholder;
    this.elements.modalInput.style.display = '';
    this.elements.confirmButton.textContent = confirmText;
    this.elements.cancelButton.textContent = 'Cancel';
    this.elements.modalOverlay.classList.add('show');
    this.currentCallback = callback;
    focusWhenReady(this.elements.modalInput, {
      stillWanted: () => this.isOpen() && this.mode === 'input' && this.currentCallback === callback,
      select: !!defaultValue
    });
  }

  /**
   * Show the modal as a confirmation dialog (no text input)
   * @param {string} title - Modal title / question
   * @param {Function} callback - Function to call with true (confirm) or false (cancel)
   * @param {Object} [options]
   * @param {string} [options.confirmText='Delete'] - Confirm button label
   */
  showConfirm(title, callback, { confirmText = 'Delete' } = {}) {
    this.rememberFocus();
    this.mode = 'confirm';
    this.elements.modalTitle.textContent = title;
    this.elements.modalInput.style.display = 'none';
    this.elements.confirmButton.textContent = confirmText;
    this.elements.cancelButton.textContent = 'Cancel';
    this.elements.modalOverlay.classList.add('show');
    this.currentCallback = callback;
    // Focus the confirm button so Enter key works
    focusWhenReady(this.elements.confirmButton, {
      stillWanted: () => this.isOpen() && this.mode === 'confirm' && this.currentCallback === callback
    });
  }

  /**
   * Hide the modal and restore focus to the element that had it
   * before the modal opened.
   */
  hide() {
    this.elements.modalOverlay.classList.remove('show');
    this.elements.modalInput.value = '';
    this.elements.modalInput.style.display = '';
    this.elements.confirmButton.textContent = 'Create';
    this.currentCallback = null;

    const previous = this.previouslyFocused;
    this.previouslyFocused = null;
    restoreFocus(previous, this.elements.modalOverlay);
  }
}
