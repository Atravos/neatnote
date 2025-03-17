/**
 * DragDropService - Manages drag and drop functionality
 * across the application
 */
export class DragDropService {
  constructor() {
    this.draggedElement = null;
    this.dropTargets = new Set();
    this.isProcessingDrop = false; // Flag to prevent multiple drop processing
    this.processingTimeout = null; // Timeout for resetting the processing flag
    console.log('DragDrop service initialized');
  }

  /**
   * Make an element draggable
   * @param {HTMLElement} element - Element to make draggable
   * @param {string} dataPath - Data path to store in drag data
   */
  makeDraggable(element, dataPath) {
    if (!element) return;
    
    element.setAttribute('draggable', 'true');
    
    element.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', dataPath);
      element.classList.add('dragging');
      this.draggedElement = element;
    });
    
    element.addEventListener('dragend', () => {
      element.classList.remove('dragging');
      this.draggedElement = null;
    });
    
    console.log('Element set as draggable:', dataPath);
  }

  /**
   * Make an element a drop target
   * @param {HTMLElement} element - Element to make a drop target
   * @param {string} targetPath - Target path
   * @param {Function} onDrop - Function to call when an item is dropped
   */
  makeDropTarget(element, targetPath, onDrop) {
    if (!element) return;
    
    const dragOverHandler = (e) => {
      e.preventDefault();
      
      // Don't add highlight if we're dragging over ourselves
      if (this.draggedElement === element) return;
      
      element.classList.add('drag-over');
    };
    
    const dragLeaveHandler = () => {
      element.classList.remove('drag-over');
    };
    
    const dropHandler = async (e) => {
      e.preventDefault();
      e.stopPropagation(); // Prevent event bubbling
      
      // Remove the highlight from ALL drop targets
      this.dropTargets.forEach(target => {
        target.element.classList.remove('drag-over');
      });
      
      // Check if already processing a drop - if so, don't process this one
      if (this.isProcessingDrop) {
        console.log('Already processing a drop, ignoring this one');
        return;
      }
      
      // Set processing flag
      this.isProcessingDrop = true;
      
      // Clear any existing timeout
      if (this.processingTimeout) {
        clearTimeout(this.processingTimeout);
      }
      
      // Set timeout to reset the flag after processing is complete
      this.processingTimeout = setTimeout(() => {
        this.isProcessingDrop = false;
      }, 500); // 500ms should be enough time to process the drop
      
      const sourceFilePath = e.dataTransfer.getData('text/plain');
      
      // Prevent dropping on itself
      if (sourceFilePath === targetPath) {
        console.log('Cannot drop item on itself');
        this.isProcessingDrop = false;
        return;
      }
      
      // Prevent dropping a folder into its own subfolder
      if (targetPath && targetPath.startsWith(sourceFilePath + '/')) {
        console.log('Cannot drop folder into its own subfolder');
        this.isProcessingDrop = false;
        return;
      }
      
      if (sourceFilePath) {
        try {
          console.log('Item dropped:', sourceFilePath, 'to', targetPath);
          await onDrop(sourceFilePath, targetPath);
        } catch (error) {
          console.error('Error processing drop:', error);
        } finally {
          // Ensure flag is reset even if an error occurs
          this.isProcessingDrop = false;
        }
      } else {
        this.isProcessingDrop = false;
      }
    };
    
    element.addEventListener('dragover', dragOverHandler);
    element.addEventListener('dragleave', dragLeaveHandler);
    element.addEventListener('drop', dropHandler);
    
    // Store for potential cleanup
    this.dropTargets.add({
      element,
      handlers: { dragOverHandler, dragLeaveHandler, dropHandler }
    });
    
    console.log('Element set as drop target:', targetPath);
  }

  /**
   * Remove drag and drop functionality from an element
   * @param {HTMLElement} element - Element to clean up
   */
  cleanup(element) {
    this.dropTargets.forEach(target => {
      if (target.element === element) {
        const { dragOverHandler, dragLeaveHandler, dropHandler } = target.handlers;
        element.removeEventListener('dragover', dragOverHandler);
        element.removeEventListener('dragleave', dragLeaveHandler);
        element.removeEventListener('drop', dropHandler);
        this.dropTargets.delete(target);
      }
    });
  }
}