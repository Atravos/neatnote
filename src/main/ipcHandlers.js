const { ipcMain } = require('electron');
const fileSystem = require('./fileSystem');
const processManager = require('./processManager');

/**
 * Set up all IPC handlers for file system operations
 * @param {Electron.App} app - Electron app instance
 * @returns {Object} Object with cleanup function
 */
function setupIpcHandlers(app) {
  console.log('Setting up IPC handlers');
  
  // Track active handlers for cleanup
  const handlers = [
    'create-folder',
    'create-file',
    'read-file',
    'save-file',
    'list-files',
    'move-file',
    'delete-item'
  ];
  
  // Handler for creating folders
  ipcMain.handle('create-folder', async (event, name, parentPath) => {
    console.log('Main process: create-folder called with:', { name, parentPath });
    return fileSystem.createFolder(name, parentPath, app.getPath('userData'));
  });

  // Handler for creating files
  ipcMain.handle('create-file', async (event, name, parentPath) => {
    console.log('Main process: create-file called with:', { name, parentPath });
    return fileSystem.createFile(name, parentPath, app.getPath('userData'));
  });

  // Handler for reading files
  ipcMain.handle('read-file', async (event, filePath) => {
    console.log('Main process: read-file called with:', { filePath });
    return fileSystem.readFile(filePath);
  });

  // Handler for saving files
  ipcMain.handle('save-file', async (event, filePath, content) => {
    console.log('Main process: save-file called with:', { filePath, contentLength: content?.length });
    return fileSystem.saveFile(filePath, content);
  });

  // Handler for listing files
  ipcMain.handle('list-files', async (event, dirPath = null) => {
    console.log('Main process: list-files called with:', { dirPath });
    return fileSystem.listFiles(dirPath, app.getPath('userData'));
  });

  // Handler for moving files
  ipcMain.handle('move-file', async (event, sourcePath, targetDir) => {
    console.log('Main process: move-file called with:', { sourcePath, targetDir });
    return fileSystem.moveFile(sourcePath, targetDir, app.getPath('userData'));
  });

  // Handler for deleting items
  ipcMain.handle('delete-item', async (event, itemPath) => {
    console.log('Main process: delete-item called with:', itemPath);
    return fileSystem.deleteItem(itemPath);
  });

  console.log('All IPC handlers registered');
  
  // Return cleanup function
  return {
    cleanup: () => {
      console.log('Cleaning up IPC handlers');
      handlers.forEach(handler => {
        try {
          ipcMain.removeHandler(handler);
        } catch (error) {
          console.error(`Error removing handler ${handler}:`, error);
        }
      });
      console.log('IPC handlers cleanup complete');
    }
  };
}

module.exports = {
  setupIpcHandlers
};