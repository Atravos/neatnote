const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('Building cleanup utility...');
console.log('Platform:', os.platform());

// Ensure dist directory exists
if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist', { recursive: true });
}

try {
  const isWindows = os.platform() === 'win32';

  if (isWindows) {
    // On Windows, build the real executable with pkg
    console.log('Building cleanup.exe for Windows...');
    execSync('npx pkg src/main/cleanup.js --target node16-win-x64 --output dist/cleanup.exe', {
      stdio: 'inherit'
    });
    console.log('cleanup.exe built successfully.');
  } else {
    // On non-Windows platforms, create a placeholder so the build doesn't fail
    // when electron-builder tries to include it in extraResources.
    console.log('Non-Windows platform detected — creating placeholder cleanup.exe');
    fs.writeFileSync(
      'dist/cleanup.exe',
      '#!/bin/sh\necho "Cleanup placeholder — Windows only"\n'
    );
    console.log('Placeholder created at dist/cleanup.exe');
  }
} catch (error) {
  console.error('Failed to build cleanup utility:', error.message);
  // Create an empty placeholder so the build can still succeed
  fs.writeFileSync('dist/cleanup.exe', '');
  console.warn('Created empty placeholder to allow build to continue.');
}