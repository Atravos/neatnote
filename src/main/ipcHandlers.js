const { ipcMain } = require('electron');
const fileSystem = require('./fileSystem');

/**
 * Set up all IPC handlers for file system operations
 * @param {Electron.App} app - Electron app instance
 */
function setupIpcHandlers(app) {
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
}

module.exports = {
  setupIpcHandlers
};