/**
 * ModalComponent - Manages modal dialogs in the application
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
      
      this.setupEventListeners();
      console.log('Modal component initialized');
    }
  
    /**
     * Set up event listeners for modal elements
     */
    setupEventListeners() {
      // Cancel button closes the modal
      if (this.elements.cancelButton) {
        this.elements.cancelButton.onclick = () => this.hide();
      }
      
      // Confirm button calls the callback with the input value
      if (this.elements.confirmButton) {
        this.elements.confirmButton.onclick = () => {
          const value = this.elements.modalInput.value.trim();
          this.hide();
          if (this.currentCallback) {
            this.currentCallback(value);
          }
        };
      }
      
      // Enter key in input field also confirms
      if (this.elements.modalInput) {
        this.elements.modalInput.addEventListener('keyup', (event) => {
          if (event.key === 'Enter') {
            const value = this.elements.modalInput.value.trim();
            this.hide();
            if (this.currentCallback) {
              this.currentCallback(value);
            }
          }
        });
      }
    }
  
    /**
     * Show the modal with a title and callback function
     * @param {string} title - Modal title
     * @param {Function} callback - Function to call with input value
     */
    show(title, callback) {
      this.elements.modalTitle.textContent = title;
      this.elements.modalInput.value = '';
      this.elements.modalOverlay.classList.add('show');
      this.elements.modalInput.focus();
      this.currentCallback = callback;
    }
  
    /**
     * Hide the modal
     */
    hide() {
      this.elements.modalOverlay.classList.remove('show');
      this.elements.modalInput.value = '';
    }
  }