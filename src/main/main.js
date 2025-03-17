const { app, BrowserWindow } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { setupIpcHandlers } = require('./ipcHandlers');

// Create a store for saving application data
const store = new Store();

let mainWindow;

/**
 * Create the main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../../index.html'));
  
  // Enable DevTools to see errors (uncomment for debugging)
  // mainWindow.webContents.openDevTools();
}

// Create window when app is ready
app.whenReady().then(() => {
  createWindow();
  
  // Set up all IPC handlers
  setupIpcHandlers(app);

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});