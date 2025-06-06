const fs = require('fs');
const path = require('path');
const processManager = require('./processManager');

// Track open file handles
const openHandles = new Map();

/**
 * Register a file handle for tracking
 * @param {string} filePath - Path to the file
 * @param {*} handle - File handle object
 */
function registerHandle(filePath, handle) {
  if (openHandles.has(filePath)) {
    // Close existing handle first
    try {
      const existing = openHandles.get(filePath);
      if (existing && existing.close) {
        existing.close();
      }
    } catch (err) {
      console.error(`Error closing existing handle for ${filePath}:`, err);
    }
  }
  
  openHandles.set(filePath, handle);
  processManager.register(filePath, () => {
    try {
      if (handle && handle.close) {
        handle.close();
      }
      openHandles.delete(filePath);
    } catch (err) {
      console.error(`Error closing handle for ${filePath}:`, err);
    }
  });
}

/**
 * Create a new folder
 * @param {string} name - Folder name
 * @param {string} parentPath - Path to parent folder, or null for root
 * @param {string} userDataPath - User data path
 * @returns {Object} Result object with success flag and path or error
 */
function createFolder(name, parentPath, userDataPath) {
  try {
    const folderPath = parentPath 
      ? path.join(parentPath, name) 
      : path.join(userDataPath, 'notes', name);
    
    console.log('Creating folder at:', folderPath);
    
    // Ensure parent directory exists
    const parentDir = path.dirname(folderPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
      console.log('Folder created successfully');
      return { success: true, path: folderPath };
    }
    
    console.log('Folder already exists');
    return { success: false, error: 'Folder already exists' };
  } catch (error) {
    console.error('Error creating folder:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Create a new file
 * @param {string} name - File name
 * @param {string} parentPath - Path to parent folder, or null for root
 * @param {string} userDataPath - User data path
 * @returns {Object} Result object with success flag and path or error
 */
function createFile(name, parentPath, userDataPath) {
  try {
    let basePath;
    if (parentPath) {
      basePath = parentPath;
    } else {
      basePath = path.join(userDataPath, 'notes');
      // Create notes directory if it doesn't exist
      if (!fs.existsSync(basePath)) {
        fs.mkdirSync(basePath, { recursive: true });
      }
    }
    
    const filePath = path.join(basePath, name + '.txt');
    console.log('Creating file at:', filePath);
    
    if (!fs.existsSync(filePath)) {
      let fileHandle = null;
      try {
        // Use explicit file handle for better tracking
        fileHandle = fs.openSync(filePath, 'w');
        fs.writeSync(fileHandle, '');
      } finally {
        if (fileHandle !== null) {
          fs.closeSync(fileHandle);
        }
      }
      
      console.log('File created successfully');
      return { success: true, path: filePath };
    }
    
    console.log('File already exists');
    return { success: false, error: 'File already exists' };
  } catch (error) {
    console.error('Error creating file:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Read a file
 * @param {string} filePath - Path to the file
 * @returns {Object} Result object with success flag and content or error
 */
function readFile(filePath) {
  let fileHandle = null;
  try {
    fileHandle = fs.openSync(filePath, 'r');
    const stats = fs.fstatSync(fileHandle);
    const buffer = Buffer.alloc(stats.size);
    fs.readSync(fileHandle, buffer, 0, stats.size, 0);
    const content = buffer.toString('utf8');
    
    console.log('File read successfully');
    return { success: true, content };
  } catch (error) {
    console.error('Error reading file:', error);
    return { success: false, error: error.message };
  } finally {
    if (fileHandle !== null) {
      try {
        fs.closeSync(fileHandle);
      } catch (err) {
        console.error('Error closing file handle:', err);
      }
    }
  }
}

/**
 * Save content to a file
 * @param {string} filePath - Path to the file
 * @param {string} content - Content to save
 * @returns {Object} Result object with success flag or error
 */
function saveFile(filePath, content) {
  let fileHandle = null;
  try {
    // Open with explicit file handle
    fileHandle = fs.openSync(filePath, 'w');
    fs.writeSync(fileHandle, content || '');
    
    console.log('File saved successfully');
    return { success: true };
  } catch (error) {
    console.error('Error saving file:', error);
    return { success: false, error: error.message };
  } finally {
    if (fileHandle !== null) {
      try {
        fs.closeSync(fileHandle);
      } catch (err) {
        console.error('Error closing file handle:', err);
      }
    }
  }
}

/**
 * List files in a directory
 * @param {string} dirPath - Path to directory, or null for root
 * @param {string} userDataPath - User data path
 * @returns {Object} Result object with success flag and files array or error
 */
function listFiles(dirPath, userDataPath) {
  try {
    const rootDir = dirPath || path.join(userDataPath, 'notes');
    console.log('Listing files in directory:', rootDir);
    
    // Create root directory if it doesn't exist
    if (!fs.existsSync(rootDir)) {
      fs.mkdirSync(rootDir, { recursive: true });
      console.log('Created root directory:', rootDir);
    }
    
    const items = fs.readdirSync(rootDir, { withFileTypes: true });
    console.log('Found', items.length, 'items in directory');
    
    const files = items.map(item => {
      const itemPath = path.join(rootDir, item.name);
      return {
        name: item.name,
        path: itemPath,
        isDirectory: item.isDirectory(),
      };
    });
    
    return { success: true, files };
  } catch (error) {
    console.error('Error listing files:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Move a file from one location to another
 * @param {string} sourcePath - Source file path
 * @param {string} targetDir - Target directory path or null for root
 * @param {string} userDataPath - User data path
 * @returns {Object} Result object with success flag and new path or error
 */
function moveFile(sourcePath, targetDir, userDataPath) {
  try {
    // First check if source file exists
    if (!fs.existsSync(sourcePath)) {
      console.error('Source file does not exist:', sourcePath);
      return { success: false, error: `File does not exist: ${sourcePath}` };
    }

    const fileName = path.basename(sourcePath);
    let targetPath;
    
    // If targetDir is null, move to the root notes directory
    if (targetDir === null) {
      const rootNotesDir = path.join(userDataPath, 'notes');
      // Ensure root directory exists
      if (!fs.existsSync(rootNotesDir)) {
        fs.mkdirSync(rootNotesDir, { recursive: true });
      }
      targetPath = path.join(rootNotesDir, fileName);
    } else {
      targetPath = path.join(targetDir, fileName);
    }
    
    console.log('Moving file from', sourcePath, 'to', targetPath);
    
    // Skip if source and destination are the same
    if (sourcePath === targetPath) {
      console.log('Source and target paths are identical, no need to move');
      return { success: true, newPath: targetPath };
    }
    
    // Close any open handles to the source file
    if (openHandles.has(sourcePath)) {
      try {
        const handle = openHandles.get(sourcePath);
        if (handle && handle.close) {
          handle.close();
        }
        openHandles.delete(sourcePath);
        processManager.unregister(sourcePath);
      } catch (err) {
        console.error(`Error closing handle for ${sourcePath}:`, err);
      }
    }
    
    // Use a more reliable copy & delete approach instead of rename
    fs.copyFileSync(sourcePath, targetPath);
    fs.unlinkSync(sourcePath);
    
    console.log('File moved successfully');
    return { success: true, newPath: targetPath };
  } catch (error) {
    console.error('Error moving file:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete a file or folder
 * @param {string} itemPath - Path to the item to delete
 * @returns {Object} Result object with success flag or error
 */
function deleteItem(itemPath) {
  try {
    // Close any open handles to this item
    if (openHandles.has(itemPath)) {
      try {
        const handle = openHandles.get(itemPath);
        if (handle && handle.close) {
          handle.close();
        }
        openHandles.delete(itemPath);
        processManager.unregister(itemPath);
      } catch (err) {
        console.error(`Error closing handle for ${itemPath}:`, err);
      }
    }
    
    const stats = fs.statSync(itemPath);
    
    if (stats.isDirectory()) {
      console.log('Deleting directory:', itemPath);
      // Recursively delete directory and all contents
      fs.rmdirSync(itemPath, { recursive: true });
    } else {
      console.log('Deleting file:', itemPath);
      fs.unlinkSync(itemPath);
    }
    
    console.log('Item deleted successfully');
    return { success: true };
  } catch (error) {
    console.error('Error deleting item:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Close all open file handles
 */
function closeAllHandles() {
  console.log(`Closing all open file handles (${openHandles.size})...`);
  
  openHandles.forEach((handle, filePath) => {
    try {
      if (handle && handle.close) {
        handle.close();
      }
      console.log(`Closed handle for ${filePath}`);
    } catch (error) {
      console.error(`Error closing handle for ${filePath}:`, error);
    }
  });
  
  openHandles.clear();
  console.log('All file handles closed');
}

// Register cleanup handler
processManager.register('fileSystem', closeAllHandles);

module.exports = {
  createFolder,
  createFile,
  readFile,
  saveFile,
  listFiles,
  moveFile,
  deleteItem,
  closeAllHandles
};