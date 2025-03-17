const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');

// Create a store for saving application data
const store = new Store();

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  
  // Enable DevTools to see errors
  //mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handlers for file operations with better logging
ipcMain.handle('create-folder', async (event, name, parentPath) => {
  console.log('Main process: create-folder called with:', { name, parentPath });
  
  try {
    const folderPath = parentPath ? path.join(parentPath, name) : path.join(app.getPath('userData'), 'notes', name);
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
});

ipcMain.handle('create-file', async (event, name, parentPath) => {
  console.log('Main process: create-file called with:', { name, parentPath });
  
  try {
    let basePath;
    if (parentPath) {
      basePath = parentPath;
    } else {
      basePath = path.join(app.getPath('userData'), 'notes');
      // Create notes directory if it doesn't exist
      if (!fs.existsSync(basePath)) {
        fs.mkdirSync(basePath, { recursive: true });
      }
    }
    
    const filePath = path.join(basePath, name + '.txt');
    console.log('Creating file at:', filePath);
    
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '');
      console.log('File created successfully');
      return { success: true, path: filePath };
    }
    
    console.log('File already exists');
    return { success: false, error: 'File already exists' };
  } catch (error) {
    console.error('Error creating file:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-file', async (event, filePath) => {
  console.log('Main process: read-file called with:', { filePath });
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    console.log('File read successfully');
    return { success: true, content };
  } catch (error) {
    console.error('Error reading file:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-file', async (event, filePath, content) => {
  console.log('Main process: save-file called with:', { filePath, contentLength: content?.length });
  
  try {
    fs.writeFileSync(filePath, content);
    console.log('File saved successfully');
    return { success: true };
  } catch (error) {
    console.error('Error saving file:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-files', async (event, dirPath = null) => {
  console.log('Main process: list-files called with:', { dirPath });
  
  try {
    const rootDir = dirPath || path.join(app.getPath('userData'), 'notes');
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
});

ipcMain.handle('move-file', async (event, sourcePath, targetDir) => {
  console.log('Main process: move-file called with:', { sourcePath, targetDir });
  
  try {
    const fileName = path.basename(sourcePath);
    let targetPath;
    
    // If targetDir is null, move to the root notes directory
    if (targetDir === null) {
      const rootNotesDir = path.join(app.getPath('userData'), 'notes');
      // Ensure root directory exists
      if (!fs.existsSync(rootNotesDir)) {
        fs.mkdirSync(rootNotesDir, { recursive: true });
      }
      targetPath = path.join(rootNotesDir, fileName);
    } else {
      targetPath = path.join(targetDir, fileName);
    }
    
    console.log('Moving file from', sourcePath, 'to', targetPath);
    
    fs.renameSync(sourcePath, targetPath);
    console.log('File moved successfully');
    return { success: true, newPath: targetPath };
  } catch (error) {
    console.error('Error moving file:', error);
    return { success: false, error: error.message };
  }
});

// Add this new handler to main.js
ipcMain.handle('delete-item', async (event, itemPath) => {
    console.log('Main process: delete-item called with:', itemPath);
    
    try {
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
  });