const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('Building cleanup utility...');

try {
  // Detect platform
  const isWindows = os.platform() === 'win32';

  // Skip actual build on macOS but create a placeholder
  if (!isWindows) {
    console.log('Building on non-Windows platform - creating placeholder cleanup utility');
    
    // Create dist directory if needed
    if (!fs.existsSync('dist')) {
      fs.mkdirSync('dist', { recursive: true });
    }
    
    // Create a simple text file as placeholder
    fs.writeFileSync('dist/cleanup.exe', 'This is a placeholder for the cleanup utility.\n');
    
    console.log('Placeholder cleanup utility created');
  } else {
    // On Windows, actually build the executable
    execSync('npx pkg src/main/cleanup.js --target node14-win-x64 --output dist/cleanup.exe');
    console.log('Cleanup utility built on Windows');
  }
  
  // Note: This step depends on running electron-builder first to create the resources directory
  console.log('Cleanup utility process completed');
} catch (error) {
  console.error('Failed to handle cleanup utility:', error);
  // Don't exit - let the build continue
}