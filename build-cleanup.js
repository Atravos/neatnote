const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Compile cleanup.js into an executable
console.log('Building cleanup utility...');

try {
  // Install pkg if not already installed
  execSync('npm install -g pkg');
  
  // Compile cleanup.js
  execSync('pkg src/main/cleanup.js --target node14-win-x64 --output dist/cleanup.exe');
  
  // Ensure it will be included in the installer
  const resourcesPath = path.join('dist', 'win-unpacked', 'resources', 'app');
  if (!fs.existsSync(resourcesPath)) {
    fs.mkdirSync(resourcesPath, { recursive: true });
  }
  
  // Copy the executable
  fs.copyFileSync(
    path.join('dist', 'cleanup.exe'),
    path.join(resourcesPath, 'cleanup.exe')
  );
  
  console.log('Cleanup utility built successfully');
} catch (error) {
  console.error('Failed to build cleanup utility:', error);
  process.exit(1);
}