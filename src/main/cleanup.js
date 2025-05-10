const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Get user data path
const userDataPath = app.getPath('userData');

// Function to safely clean up app data
function cleanupAppData() {
  try {
    console.log('Starting cleanup process...');
    
    // Paths to clean up
    const paths = [
      path.join(userDataPath, 'electron-preferences.json'),
      path.join(userDataPath, 'notes')
    ];
    
    // Attempt to clean up each path
    paths.forEach(p => {
      try {
        if (fs.existsSync(p)) {
          const stats = fs.statSync(p);
          if (stats.isDirectory()) {
            // Don't delete user notes, only clean up other files
            // fs.rmdirSync(p, { recursive: true });
            console.log(`Skipped user data directory: ${p}`);
          } else {
            fs.unlinkSync(p);
            console.log(`Removed file: ${p}`);
          }
        }
      } catch (e) {
        console.error(`Error cleaning up ${p}:`, e);
      }
    });
    
    console.log('Cleanup completed');
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
}

// Run cleanup and exit
cleanupAppData();
process.exit(0);