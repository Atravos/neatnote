const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Standalone cleanup utility for NeatNote uninstaller.
 * This runs as an independent executable (via pkg), NOT inside Electron,
 * so it must NOT import anything from 'electron'.
 *
 * It cleans up application data files that could hold file locks
 * and interfere with the NSIS uninstaller.
 */

// Determine the user data path the same way Electron does on each platform,
// without requiring the Electron runtime.
function getUserDataPath() {
  const appName = 'neatnote';

  switch (os.platform()) {
    case 'win32':
      // Electron uses %APPDATA%/<appName> on Windows
      return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName);
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', appName);
    default:
      // Linux / others
      return path.join(os.homedir(), '.config', appName);
  }
}

function cleanupAppData() {
  const userDataPath = getUserDataPath();

  console.log('NeatNote cleanup starting...');
  console.log('User data path:', userDataPath);

  if (!fs.existsSync(userDataPath)) {
    console.log('User data directory does not exist, nothing to clean up.');
    return;
  }

  // Files/dirs that can safely be removed to release locks.
  // We intentionally keep the "notes" folder so users don't lose data.
  const pathsToClean = [
    path.join(userDataPath, 'config.json'),
    path.join(userDataPath, 'electron-preferences.json'),
    path.join(userDataPath, 'window-state.json'),
    // Electron internal files that may hold locks
    path.join(userDataPath, 'Local Storage'),
    path.join(userDataPath, 'Session Storage'),
    path.join(userDataPath, 'GPUCache'),
    path.join(userDataPath, 'Cache'),
    path.join(userDataPath, 'Code Cache'),
    path.join(userDataPath, 'Crashpad'),
    path.join(userDataPath, 'blob_storage'),
    path.join(userDataPath, 'databases'),
    path.join(userDataPath, 'IndexedDB'),
    path.join(userDataPath, 'Local State'),
    path.join(userDataPath, 'Network Persistent State'),
    path.join(userDataPath, 'Preferences'),
    path.join(userDataPath, 'TransportSecurity'),
  ];

  pathsToClean.forEach(p => {
    try {
      if (!fs.existsSync(p)) return;

      const stats = fs.statSync(p);
      if (stats.isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
        console.log('Removed directory:', p);
      } else {
        fs.unlinkSync(p);
        console.log('Removed file:', p);
      }
    } catch (e) {
      // Non-fatal — the uninstaller will try to remove leftovers anyway
      console.error('Could not remove', p, '-', e.message);
    }
  });

  console.log('Cleanup completed.');
}

// Run and exit
try {
  cleanupAppData();
} catch (error) {
  console.error('Cleanup failed:', error.message);
}
process.exit(0);