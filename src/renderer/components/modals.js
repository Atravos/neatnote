/**
 * ModalComponent - Manages modal dialogs in the application
 * Supports both text-input modals and confirmation dialogs
 */
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
      
      this.setupEventListeners();
      console.log('Modal component initialized');
    }
  
    /**
     * Set up event listeners for modal elements
     */
    setupEventListeners() {
      // Cancel button closes the modal
      if (this.elements.cancelButton) {
        this.elements.cancelButton.onclick = () => {
          const callback = this.currentCallback;
          const mode = this.mode;
          this.hide();
          // For confirm mode, call callback with false
          if (mode === 'confirm' && callback) {
            callback(false);
          }
        };
      }
      
      // Confirm button calls the callback with the input value
      if (this.elements.confirmButton) {
        this.elements.confirmButton.onclick = () => {
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
        };
      }
      
      // Enter key in input field also confirms
      if (this.elements.modalInput) {
        this.elements.modalInput.addEventListener('keyup', (event) => {
          if (event.key === 'Enter') {
            if (this.mode === 'input') {
              const value = this.elements.modalInput.value.trim();
              const callback = this.currentCallback;
              this.hide();
              if (callback) {
                callback(value);
              }
            }
          }
        });
      }
    }
  
    /**
     * Show the modal as a text input dialog
     * @param {string} title - Modal title
     * @param {Function} callback - Function to call with input value
     */
    show(title, callback) {
      this.mode = 'input';
      this.elements.modalTitle.textContent = title;
      this.elements.modalInput.value = '';
      this.elements.modalInput.style.display = '';
      this.elements.confirmButton.textContent = 'Create';
      this.elements.modalOverlay.classList.add('show');
      // Use setTimeout to ensure focus works reliably on Windows
      setTimeout(() => {
        this.elements.modalInput.focus();
      }, 50);
      this.currentCallback = callback;
    }

    /**
     * Show the modal as a confirmation dialog (no text input)
     * @param {string} title - Modal title / question
     * @param {Function} callback - Function to call with true (confirm) or false (cancel)
     */
    showConfirm(title, callback) {
      this.mode = 'confirm';
      this.elements.modalTitle.textContent = title;
      this.elements.modalInput.style.display = 'none';
      this.elements.confirmButton.textContent = 'Delete';
      this.elements.cancelButton.textContent = 'Cancel';
      this.elements.modalOverlay.classList.add('show');
      // Focus the confirm button so Enter key works
      setTimeout(() => {
        this.elements.confirmButton.focus();
      }, 50);
      this.currentCallback = callback;
    }
  
    /**
     * Hide the modal
     */
    hide() {
      this.elements.modalOverlay.classList.remove('show');
      this.elements.modalInput.value = '';
      this.elements.modalInput.style.display = '';
      this.elements.confirmButton.textContent = 'Create';
      this.currentCallback = null;
    }
  }