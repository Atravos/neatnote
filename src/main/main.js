const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { setupIpcHandlers } = require('./ipcHandlers');
const processManager = require('./processManager');

// Create a store for saving application data
const store = new Store();

let mainWindow;
let ipcHandlersCleanup;

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
  
  // Ensure clean shutdown when window is closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  // Register main window as a resource to track
  processManager.register(mainWindow, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  });
}

// Create window when app is ready
app.whenReady().then(() => {
  createWindow();
  
  // Set up all IPC handlers
  const handlers = setupIpcHandlers(app);
  ipcHandlersCleanup = handlers.cleanup;
  
  // Register IPC handlers for cleanup
  processManager.register('ipcHandlers', ipcHandlersCleanup);

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Handle app quitting
app.on('before-quit', (event) => {
  if (!processManager.isQuitting()) {
    // First time we're attempting to quit - do cleanup first
    event.preventDefault();
    console.log('Starting application shutdown process...');
    
    // Clean up resources
    processManager.cleanupAll();
    
    // Flush store data
    try {
      store.store = {...store.store}; // Force a save
    } catch (error) {
      console.error('Error saving store data:', error);
    }
    
    // Queue up actual quit for next tick
    setTimeout(() => {
      console.log('Quitting application...');
      app.quit();
    }, 100);
  }
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle uninstall request from renderer
ipcMain.handle('uninstall-app', async () => {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Uninstall NeatNote',
    message: 'Are you sure you want to uninstall NeatNote?',
    detail: 'This will remove the application, but your notes will remain on your computer. You will need to run the uninstaller after this process completes.',
    buttons: ['Cancel', 'Uninstall'],
    defaultId: 0,
    cancelId: 0
  });
  
  if (response === 1) { // User chose "Uninstall"
    try {
      // Clean up app data to prevent locks
      processManager.cleanupAll();
      
      // Create uninstall script path
      const uninstallerPath = path.join(process.resourcesPath, '..', 'Uninstall NeatNote.exe');
      
      // Exit app and run uninstaller
      const { exec } = require('child_process');
      exec(`start "" "${uninstallerPath}"`, (error) => {
        if (error) {
          console.error('Failed to launch uninstaller:', error);
          return;
        }
        app.exit(0);
      });
      
      return { success: true };
    } catch (error) {
      console.error('Error initiating uninstall:', error);
      return { success: false, error: error.message };
    }
  }
  
  return { success: false, cancelled: true };
});