/**
 * FileService - Handles all file system operations
 * Provides a clean interface to the main process API
 */
export class FileService {
    constructor(api) {
      if (!api) {
        throw new Error('API not available. File service cannot be initialized.');
      }
      this.api = api;
      console.log('File service initialized');
    }
  
    async createFolder(name, parentPath = null) {
      try {
        return await this.api.createFolder(name, parentPath);
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  
    async createFile(name, parentPath = null) {
      try {
        return await this.api.createFile(name, parentPath);
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  
    async readFile(path) {
      try {
        return await this.api.readFile(path);
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  
    async saveFile(path, content) {
      try {
        return await this.api.saveFile(path, content);
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  
    async listFiles(dirPath = null) {
      try {
        return await this.api.listFiles(dirPath);
      } catch (error) {
        return { success: false, error: error.message, files: [] };
      }
    }
  
    async moveFile(sourcePath, targetDir) {
      try {
        return await this.api.moveFile(sourcePath, targetDir);
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  
    async deleteItem(path) {
      try {
        return await this.api.deleteItem(path);
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    /**
     * Get the saved sort order for a directory
     * @param {string} dirKey - Directory key (use null or '_root' for root)
     * @returns {Promise<string[]|null>} Array of filenames in order, or null
     */
    async getSortOrder(dirKey) {
      try {
        const result = await this.api.getSortOrder(dirKey);
        return result.order || null;
      } catch (error) {
        return null;
      }
    }

    /**
     * Save the sort order for a directory
     * @param {string} dirKey - Directory key
     * @param {string[]} order - Array of filenames in desired order
     */
    async setSortOrder(dirKey, order) {
      try {
        return await this.api.setSortOrder(dirKey, order);
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  }