const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script executing');

/**
 * API methods to expose to the renderer process
 */
const apiMethods = {
  /**
   * Create a new folder
   * @param {string} name - Folder name
   * @param {string} parentPath - Path to parent folder or null for root
   * @returns {Promise<Object>} Result with success flag and path or error
   */
  createFolder: async (name, parentPath) => {
    try {
      console.log('Renderer: Creating folder:', name, 'in', parentPath);
      const result = await ipcRenderer.invoke('create-folder', name, parentPath);
      console.log('Create folder result:', result);
      return result;
    } catch (error) {
      console.error('Create folder error:', error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * Create a new file
   * @param {string} name - File name
   * @param {string} parentPath - Path to parent folder or null for root
   * @returns {Promise<Object>} Result with success flag and path or error
   */
  createFile: async (name, parentPath) => {
    try {
      console.log('Renderer: Creating file:', name, 'in', parentPath);
      const result = await ipcRenderer.invoke('create-file', name, parentPath);
      console.log('Create file result:', result);
      return result;
    } catch (error) {
      console.error('Create file error:', error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * Read file content
   * @param {string} path - Path to the file
   * @returns {Promise<Object>} Result with success flag and content or error
   */
  readFile: async (path) => {
    try {
      console.log('Renderer: Reading file:', path);
      const result = await ipcRenderer.invoke('read-file', path);
      console.log('Read file result:', result.success);
      return result;
    } catch (error) {
      console.error('Read file error:', error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * Save content to a file
   * @param {string} path - Path to the file
   * @param {string} content - Content to save
   * @returns {Promise<Object>} Result with success flag or error
   */
  saveFile: async (path, content) => {
    try {
      console.log('Renderer: Saving file:', path);
      const result = await ipcRenderer.invoke('save-file', path, content);
      console.log('Save file result:', result.success);
      return result;
    } catch (error) {
      console.error('Save file error:', error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * List files in a directory
   * @param {string} dirPath - Path to directory or null for root
   * @returns {Promise<Object>} Result with success flag and files array or error
   */
  listFiles: async (dirPath) => {
    try {
      console.log('Renderer: Listing files in:', dirPath);
      const result = await ipcRenderer.invoke('list-files', dirPath);
      console.log('List files result:', result.success, result.files?.length);
      return result;
    } catch (error) {
      console.error('List files error:', error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * Move a file from one location to another
   * @param {string} sourcePath - Source file path
   * @param {string} targetDir - Target directory path or null for root
   * @returns {Promise<Object>} Result with success flag and new path or error
   */
  moveFile: async (sourcePath, targetDir) => {
    try {
      console.log('Renderer: Moving file from', sourcePath, 'to', targetDir);
      const result = await ipcRenderer.invoke('move-file', sourcePath, targetDir);
      console.log('Move file result:', result.success);
      return result;
    } catch (error) {
      console.error('Move file error:', error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * Delete a file or folder
   * @param {string} path - Path to the item to delete
   * @returns {Promise<Object>} Result with success flag or error
   */
  deleteItem: async (path) => {
    try {
      console.log('Renderer: Deleting item at path:', path);
      const result = await ipcRenderer.invoke('delete-item', path);
      console.log('Delete item result:', result.success);
      return result;
    } catch (error) {
      console.error('Delete item error:', error);
      return { success: false, error: error.message };
    }
  },
  
  /**
   * Uninstall the application
   * @returns {Promise<Object>} Result with success flag or error
   */
  uninstallApp: async () => {
    try {
      console.log('Renderer: Requesting app uninstallation');
      const result = await ipcRenderer.invoke('uninstall-app');
      console.log('Uninstall request result:', result);
      return result;
    } catch (error) {
      console.error('Uninstall request error:', error);
      return { success: false, error: error.message };
    }
  }
};

// Expose API to the renderer process
try {
  contextBridge.exposeInMainWorld('api', apiMethods);
  console.log('API exposed successfully to renderer process');
} catch (error) {
  console.error('Failed to expose API:', error);
}

// Test if window.api will be available
setTimeout(() => {
  console.log('Preload script completed');
}, 0);