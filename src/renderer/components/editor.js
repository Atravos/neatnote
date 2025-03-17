import { debounce } from '../utils/debounce.js';

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
   * @param {FileService} fileService - File service instance
   */
  constructor(elements, fileService) {
    this.elements = elements;
    this.fileService = fileService;
    this.activeFile = null;
    this.isEditorDirty = false;
    
    this.setupEditor();
    console.log('Editor component initialized');
  }

  /**
   * Set up editor event listeners and UI elements
   */
  setupEditor() {
    // Create auto-save container with status indicator
    this.autoSaveContainer = document.createElement('div');
    this.autoSaveContainer.id = 'auto-save-container';
    this.autoSaveContainer.style.display = 'flex';
    this.autoSaveContainer.style.alignItems = 'center';
    this.autoSaveContainer.style.marginRight = '10px';
    this.autoSaveContainer.style.opacity = '0';
    this.autoSaveContainer.style.transition = 'opacity 0.5s';
    
    // Create status dot
    this.statusDot = document.createElement('span');
    this.statusDot.id = 'status-dot';
    this.statusDot.style.width = '8px';
    this.statusDot.style.height = '8px';
    this.statusDot.style.borderRadius = '50%';
    this.statusDot.style.backgroundColor = '#4CAF50'; // Green for saved
    this.statusDot.style.marginRight = '6px';
    this.statusDot.style.transition = 'background-color 0.3s, box-shadow 0.3s';
    
    // Create text indicator
    this.autoSaveIndicator = document.createElement('span');
    this.autoSaveIndicator.id = 'auto-save-indicator';
    this.autoSaveIndicator.textContent = 'Saved';
    this.autoSaveIndicator.style.fontSize = '12px';
    this.autoSaveIndicator.style.color = '#5f6368';
    
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
    
    // Add pulse animation for saving indicator
    if (!document.getElementById('pulse-animation')) {
      const styleSheet = document.createElement('style');
      styleSheet.id = 'pulse-animation';
      styleSheet.textContent = `
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
      `;
      document.head.appendChild(styleSheet);
    }
    
    // Set up input event with auto-save
    if (this.elements.editorElement) {
      this.elements.editorElement.addEventListener('input', () => {
        this.isEditorDirty = true;
        this.autoSave();
      });
    }
    
    // Set up save button
    if (this.elements.saveButton) {
      this.elements.saveButton.onclick = () => this.saveCurrentFile();
    }
    
    // Create debounced auto-save function
    this.autoSave = debounce(this.performAutoSave.bind(this), 1000);
  }

  /**
   * Auto-save the current file
   */
  async performAutoSave() {
    if (this.activeFile && this.isEditorDirty) {
      try {
        const content = this.elements.editorElement.value;
        console.log('Auto-saving to:', this.activeFile);
        
        // Show saving indicator
        this.autoSaveIndicator.textContent = 'Saving...';
        this.autoSaveContainer.style.opacity = '1';
        this.statusDot.style.backgroundColor = '#FF9800'; // Orange for saving
        this.statusDot.style.boxShadow = '0 0 5px #FF9800';
        this.statusDot.style.animation = 'pulse 1s infinite';
        
        const result = await this.fileService.saveFile(this.activeFile, content);
        
        if (result.success) {
          this.isEditorDirty = false;
          this.autoSaveIndicator.textContent = 'Saved';
          this.statusDot.style.backgroundColor = '#4CAF50'; // Green for saved
          this.statusDot.style.boxShadow = '0 0 5px #4CAF50';
          this.statusDot.style.animation = 'none'; // Stop pulsing
          
          // Fade out the indicator after a brief delay
          setTimeout(() => {
            this.autoSaveContainer.style.opacity = '0';
          }, 1500);
          
          console.log('File auto-saved successfully');
        } else {
          this.autoSaveIndicator.textContent = 'Save failed';
          this.statusDot.style.backgroundColor = '#F44336'; // Red for error
          this.statusDot.style.boxShadow = '0 0 5px #F44336';
          this.statusDot.style.animation = 'none'; // Stop pulsing
          console.error('Failed to auto-save file:', result.error);
        }
      } catch (error) {
        this.autoSaveIndicator.textContent = 'Save failed';
        this.statusDot.style.backgroundColor = '#F44336'; // Red for error
        this.statusDot.style.boxShadow = '0 0 5px #F44336';
        this.statusDot.style.animation = 'none'; // Stop pulsing
        console.error('Error in auto-save:', error);
      }
    }
  }

  /**
   * Save the current file
   */
  async saveCurrentFile() {
    try {
      console.log('Saving current file');
      
      if (!this.activeFile) {
        console.log('No active file to save');
        return;
      }
      
      const content = this.elements.editorElement.value;
      console.log('Saving to:', this.activeFile);
      
      const result = await this.fileService.saveFile(this.activeFile, content);
      
      if (result.success) {
        this.isEditorDirty = false;
        console.log('File saved successfully');
        
        // Show saved indicator briefly
        this.autoSaveIndicator.textContent = 'Saved';
        this.autoSaveContainer.style.opacity = '1';
        this.statusDot.style.backgroundColor = '#4CAF50';
        this.statusDot.style.boxShadow = '0 0 5px #4CAF50';
        
        setTimeout(() => {
          this.autoSaveContainer.style.opacity = '0';
        }, 1500);
      } else {
        console.error('Failed to save file:', result.error);
        alert(`Failed to save file: ${result.error}`);
      }
    } catch (error) {
      console.error('Error in saveCurrentFile:', error);
      alert(`Error saving file: ${error.message}`);
    }
  }

  /**
   * Open a file in the editor
   * @param {string} filePath - Path to the file to open
   */
  async openFile(filePath) {
    try {
      console.log('Opening file:', filePath);
      
      // Check if current file has unsaved changes
      if (this.isEditorDirty && this.activeFile) {
        if (confirm('You have unsaved changes. Save before opening a new file?')) {
          await this.saveCurrentFile();
        }
      }
      
      const result = await this.fileService.readFile(filePath);
      
      if (result.success) {
        this.elements.editorElement.value = result.content;
        this.activeFile = filePath;
        this.elements.pathDisplay.textContent = filePath;
        this.isEditorDirty = false;
        console.log('File opened successfully');
      } else {
        console.error('Failed to open file:', result.error);
        alert(`Failed to open file: ${result.error}`);
      }
    } catch (error) {
      console.error('Error in openFile:', error);
      alert(`Error opening file: ${error.message}`);
    }
  }

  /**
   * Update the path when a file is moved
   * @param {string} oldPath - Old file path
   * @param {string} newPath - New file path
   */
  updateFilePath(oldPath, newPath) {
    if (this.activeFile === oldPath) {
      this.activeFile = newPath;
      this.elements.pathDisplay.textContent = newPath;
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