const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
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
  
  mainWindow.on('closed', () => {
    mainWindow = null;
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
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Handle app quitting — perform cleanup before exit
app.on('before-quit', (event) => {
  if (!processManager.isQuitting()) {
    event.preventDefault();
    console.log('Starting application shutdown process...');
    
    // Clean up resources
    processManager.cleanupAll();
    
    // Flush store data
    try {
      store.store = { ...store.store };
    } catch (error) {
      console.error('Error saving store data:', error);
    }
    
    // Now actually quit
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

/**
 * Find the NSIS uninstaller executable for this application.
 * electron-builder's NSIS installer writes the uninstaller path into the
 * registry and also places it in the installation directory.
 */
function findUninstallerPath() {
  if (process.platform !== 'win32') return null;

  // The app is typically installed to a directory like:
  //   C:\Users\<user>\AppData\Local\Programs\NeatNote\
  // The uninstaller lives in that same directory.
  const installDir = path.dirname(app.getPath('exe'));
  const uninstallerName = 'Uninstall NeatNote.exe';
  const uninstallerPath = path.join(installDir, uninstallerName);

  if (fs.existsSync(uninstallerPath)) {
    return uninstallerPath;
  }

  // Fallback: look for any Uninstall*.exe in the install directory
  try {
    const files = fs.readdirSync(installDir);
    const uninstaller = files.find(f => f.toLowerCase().startsWith('uninstall') && f.toLowerCase().endsWith('.exe'));
    if (uninstaller) {
      return path.join(installDir, uninstaller);
    }
  } catch (err) {
    console.error('Error searching for uninstaller:', err);
  }

  return null;
}

// Handle uninstall request from renderer
ipcMain.handle('uninstall-app', async () => {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Uninstall NeatNote',
    message: 'Are you sure you want to uninstall NeatNote?',
    detail: 'This will remove the application, but your notes will remain on your computer.',
    buttons: ['Cancel', 'Uninstall'],
    defaultId: 0,
    cancelId: 0
  });
  
  if (response === 1) {
    try {
      if (process.platform === 'win32') {
        const { spawn } = require('child_process');
        const uninstallerPath = findUninstallerPath();

        if (uninstallerPath) {
          // Launch the actual NSIS uninstaller in a detached process
          // so it continues after our app exits.
          spawn(uninstallerPath, ['_?=' + path.dirname(uninstallerPath)], {
            detached: true,
            stdio: 'ignore'
          }).unref();

          // Give the uninstaller a moment to start, then quit ourselves
          // so we don't hold file locks.
          setTimeout(() => {
            processManager.cleanupAll();
            app.quit();
          }, 500);

          return { success: true };
        } else {
          // Couldn't find the uninstaller — direct user to Settings > Apps
          await dialog.showMessageBox({
            type: 'info',
            title: 'Uninstall NeatNote',
            message: 'Please uninstall NeatNote through Windows Settings.',
            detail: 'Go to Settings > Apps > Installed apps, find NeatNote, and click Uninstall.'
          });
          return { success: false, error: 'Uninstaller not found' };
        }
      }
      
      return { success: false, error: 'Uninstall is only supported on Windows through this button.' };
    } catch (error) {
      console.error('Error initiating uninstall:', error);
      return { success: false, error: error.message };
    }
  }
  
  return { success: false, cancelled: true };
});