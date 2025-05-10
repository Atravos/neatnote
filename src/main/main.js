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
  
  if (response === 1) { // User chose "Uninstall"
    try {
      // Clean up app data to prevent locks
      processManager.cleanupAll();
      
      // On Windows, use the Windows API to uninstall
      if (process.platform === 'win32') {
        const { spawn } = require('child_process');
        
        // Use Control Panel's Programs and Features to uninstall
        spawn('control', ['appwiz.cpl'], { detached: true });
        
        // Let the user know they need to complete uninstallation
        dialog.showMessageBox({
          type: 'info',
          title: 'Complete Uninstallation',
          message: 'Please complete uninstallation using the Windows Control Panel that will open.',
          detail: 'Select NeatNote from the list and click Uninstall.'
        });
        
        // Exit the app after showing the message
        setTimeout(() => app.quit(), 2000);
      }
      
      return { success: true };
    } catch (error) {
      console.error('Error initiating uninstall:', error);
      return { success: false, error: error.message };
    }
  }
  
  return { success: false, cancelled: true };
});