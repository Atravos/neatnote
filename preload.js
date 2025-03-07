const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script executing');

// Add explicit error handling to help with debugging
const apiMethods = {
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
  // Add delete method
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
  }
};

// Expose our API to the renderer process
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