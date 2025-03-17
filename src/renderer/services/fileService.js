/**
 * FileService - Handles all file system operations
 * Provides a clean interface to the main process API
 */
export class FileService {
    /**
     * Initialize the file service
     * @param {Object} api - The window.api object from preload script
     */
    constructor(api) {
      if (!api) {
        throw new Error('API not available. File service cannot be initialized.');
      }
      this.api = api;
      console.log('File service initialized');
    }
  
    /**
     * Create a new folder
     * @param {string} name - Folder name
     * @param {string} parentPath - Path to parent folder or null for root
     * @returns {Promise<Object>} Result with success flag and path or error
     */
    async createFolder(name, parentPath = null) {
      try {
        console.log('Creating folder:', name, 'in', parentPath);
        return await this.api.createFolder(name, parentPath);
      } catch (error) {
        console.error('Error in createFolder:', error);
        return { success: false, error: error.message };
      }
    }
  
    /**
     * Create a new file
     * @param {string} name - File name
     * @param {string} parentPath - Path to parent folder or null for root
     * @returns {Promise<Object>} Result with success flag and path or error
     */
    async createFile(name, parentPath = null) {
      try {
        console.log('Creating file:', name, 'in', parentPath);
        return await this.api.createFile(name, parentPath);
      } catch (error) {
        console.error('Error in createFile:', error);
        return { success: false, error: error.message };
      }
    }
  
    /**
     * Read file content
     * @param {string} path - Path to the file
     * @returns {Promise<Object>} Result with success flag and content or error
     */
    async readFile(path) {
      try {
        console.log('Reading file:', path);
        return await this.api.readFile(path);
      } catch (error) {
        console.error('Error in readFile:', error);
        return { success: false, error: error.message };
      }
    }
  
    /**
     * Save content to a file
     * @param {string} path - Path to the file
     * @param {string} content - Content to save
     * @returns {Promise<Object>} Result with success flag or error
     */
    async saveFile(path, content) {
      try {
        console.log('Saving file:', path);
        return await this.api.saveFile(path, content);
      } catch (error) {
        console.error('Error in saveFile:', error);
        return { success: false, error: error.message };
      }
    }
  
    /**
     * List files in a directory
     * @param {string} dirPath - Path to directory or null for root
     * @returns {Promise<Object>} Result with success flag and files array or error
     */
    async listFiles(dirPath = null) {
      try {
        console.log('Listing files in:', dirPath);
        return await this.api.listFiles(dirPath);
      } catch (error) {
        console.error('Error in listFiles:', error);
        return { success: false, error: error.message, files: [] };
      }
    }
  
    /**
     * Move a file from one location to another
     * @param {string} sourcePath - Source file path
     * @param {string} targetDir - Target directory path or null for root
     * @returns {Promise<Object>} Result with success flag and new path or error
     */
    async moveFile(sourcePath, targetDir) {
      try {
        console.log('Moving file from', sourcePath, 'to', targetDir);
        return await this.api.moveFile(sourcePath, targetDir);
      } catch (error) {
        console.error('Error in moveFile:', error);
        return { success: false, error: error.message };
      }
    }
  
    /**
     * Delete a file or folder
     * @param {string} path - Path to the item to delete
     * @returns {Promise<Object>} Result with success flag or error
     */
    async deleteItem(path) {
      try {
        console.log('Deleting item at path:', path);
        return await this.api.deleteItem(path);
      } catch (error) {
        console.error('Error in deleteItem:', error);
        return { success: false, error: error.message };
      }
    }
  }