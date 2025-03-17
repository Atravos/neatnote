// Debounce utility function for delaying execution
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// SVG templates for icons
const folderSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;
const folderOpenSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>`;
const fileSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`;
const trashSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
const settingsSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`;

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded');
  
  // Get DOM elements
  const folderTree = document.getElementById('folder-tree');
  const newFolderBtn = document.getElementById('new-folder-btn');
  const newFileBtn = document.getElementById('new-file-btn');
  const editor = document.getElementById('editor');
  const saveBtn = document.getElementById('save-btn');
  const currentFilePath = document.getElementById('current-file-path');
  const settingsIcon = document.getElementById('settings-icon');
  
  // Modal elements
  const modalOverlay = document.getElementById('modal-overlay');
  const modalTitle = document.getElementById('modal-title');
  const modalInput = document.getElementById('modal-input');
  const modalCancelBtn = document.getElementById('modal-cancel-btn');
  const modalConfirmBtn = document.getElementById('modal-confirm-btn');
  
  // Settings modal elements
  const settingsOverlay = document.getElementById('settings-overlay');
  const settingsCloseBtn = document.getElementById('settings-close-btn');
  const themeOptions = document.querySelectorAll('.theme-option');
  
  // Debug logging
  console.log('Elements found:', { 
    folderTree: !!folderTree, 
    newFolderBtn: !!newFolderBtn, 
    newFileBtn: !!newFileBtn, 
    editor: !!editor, 
    saveBtn: !!saveBtn,
    modalOverlay: !!modalOverlay,
    settingsIcon: !!settingsIcon
  });
  
  // IMMEDIATELY insert the settings icon SVG
  if (settingsIcon) {
    console.log('Inserting settings icon SVG');
    settingsIcon.innerHTML = settingsSvg;
  } else {
    console.error('Settings icon element not found');
  }
  
  let activeFile = null;
  let isEditorDirty = false;
  let currentModalCallback = null;
  
  // Load initial file structure
  loadFileStructure();
  
  // Set up event listeners for buttons
  if (newFolderBtn) {
    newFolderBtn.onclick = function() {
      console.log('New folder button clicked');
      showModal('Enter folder name', (name) => {
        if (name) createFolder(name);
      });
    };
  }
  
  if (newFileBtn) {
    newFileBtn.onclick = function() {
      console.log('New file button clicked');
      showModal('Enter file name', (name) => {
        if (name) createFile(name);
      });
    };
  }
  
  if (saveBtn) {
    saveBtn.onclick = saveCurrentFile;
  }
  
  // Editor setup with auto-save functionality
  if (editor) {
    // Create a container for the auto-save indicator with dot
    const autoSaveContainer = document.createElement('div');
    autoSaveContainer.id = 'auto-save-container';
    autoSaveContainer.style.display = 'flex';
    autoSaveContainer.style.alignItems = 'center';
    autoSaveContainer.style.marginRight = '10px';
    autoSaveContainer.style.opacity = '0';
    autoSaveContainer.style.transition = 'opacity 0.5s';
    
    // Create the status dot
    const statusDot = document.createElement('span');
    statusDot.id = 'status-dot';
    statusDot.style.width = '8px';
    statusDot.style.height = '8px';
    statusDot.style.borderRadius = '50%';
    statusDot.style.backgroundColor = '#4CAF50'; // Green for saved
    statusDot.style.marginRight = '6px';
    statusDot.style.transition = 'background-color 0.3s, box-shadow 0.3s';
    
    // Create the text indicator
    const autoSaveIndicator = document.createElement('span');
    autoSaveIndicator.id = 'auto-save-indicator';
    autoSaveIndicator.textContent = 'Saved';
    autoSaveIndicator.style.fontSize = '12px';
    autoSaveIndicator.style.color = '#5f6368';
    
    // Add the elements to the container
    autoSaveContainer.appendChild(statusDot);
    autoSaveContainer.appendChild(autoSaveIndicator);
    
    // Insert the container before the save button in the header
    const editorHeader = document.querySelector('.editor-header');
    if (editorHeader) {
      editorHeader.insertBefore(autoSaveContainer, saveBtn);
    }
    
    // Debounced auto-save function (will wait 1000ms after typing stops)
    const autoSave = debounce(async () => {
      if (activeFile && isEditorDirty) {
        try {
          const content = editor.value;
          console.log('Auto-saving to:', activeFile);
          
          // Show saving indicator
          autoSaveIndicator.textContent = 'Saving...';
          autoSaveContainer.style.opacity = '1';
          statusDot.style.backgroundColor = '#FF9800'; // Orange for saving
          statusDot.style.boxShadow = '0 0 5px #FF9800';
          // Add a subtle pulse animation
          statusDot.style.animation = 'pulse 1s infinite';
          
          // Add the keyframes for the pulse animation if it doesn't exist
          if (!document.getElementById('pulse-animation')) {
            const styleSheet = document.createElement('style');
            styleSheet.id = 'pulse-animation';
            styleSheet.textContent = `
              @keyframes pulse {
                0% { transform: scale(1); }
                50% { transform: scale(1.2); }
                100% { transform: scale(1); }
              }
            `;
            document.head.appendChild(styleSheet);
          }
          
          const result = await window.api.saveFile(activeFile, content);
          
          if (result.success) {
            isEditorDirty = false;
            autoSaveIndicator.textContent = 'Saved';
            statusDot.style.backgroundColor = '#4CAF50'; // Green for saved
            statusDot.style.boxShadow = '0 0 5px #4CAF50';
            statusDot.style.animation = 'none'; // Stop pulsing
            
            // Fade out the indicator after a brief delay
            setTimeout(() => {
              autoSaveContainer.style.opacity = '0';
            }, 1500);
            
            console.log('File auto-saved successfully');
          } else {
            autoSaveIndicator.textContent = 'Save failed';
            statusDot.style.backgroundColor = '#F44336'; // Red for error
            statusDot.style.boxShadow = '0 0 5px #F44336';
            statusDot.style.animation = 'none'; // Stop pulsing
            console.error('Failed to auto-save file:', result.error);
          }
        } catch (error) {
          autoSaveIndicator.textContent = 'Save failed';
          statusDot.style.backgroundColor = '#F44336'; // Red for error
          statusDot.style.boxShadow = '0 0 5px #F44336';
          statusDot.style.animation = 'none'; // Stop pulsing
          console.error('Error in auto-save:', error);
        }
      }
    }, 1000); // 1 second delay before saving
    
    // Add input event with auto-save
    editor.addEventListener('input', () => {
      isEditorDirty = true;
      autoSave();
    });
  }
  
  // Set up modal events
  if (modalCancelBtn) {
    modalCancelBtn.onclick = hideModal;
  }
  
  if (modalConfirmBtn) {
    modalConfirmBtn.onclick = function() {
      const value = modalInput.value.trim();
      hideModal();
      if (currentModalCallback) {
        currentModalCallback(value);
      }
    };
  }
  
  // Modal input enter key handler
  if (modalInput) {
    modalInput.addEventListener('keyup', function(event) {
      if (event.key === 'Enter') {
        const value = modalInput.value.trim();
        hideModal();
        if (currentModalCallback) {
          currentModalCallback(value);
        }
      }
    });
  }
  
  // Set up the trash functionality
  setupTrash();
  
  // Setup settings icon and theme functionality
  setupSettings();
  
  // Custom modal functions
  function showModal(title, callback) {
    modalTitle.textContent = title;
    modalInput.value = '';
    modalOverlay.classList.add('show');
    modalInput.focus();
    currentModalCallback = callback;
  }
  
  function hideModal() {
    modalOverlay.classList.remove('show');
    modalInput.value = '';
  }
  
  // Load file structure from main process
  async function loadFileStructure() {
    try {
      console.log('Loading file structure...');
      
      if (!window.api || !window.api.listFiles) {
        console.error('API not available for listing files');
        return;
      }
      
      const result = await window.api.listFiles();
      console.log('File structure result:', result);
      
      if (result.success) {
        renderFileTree(result.files, folderTree);
        
        // Set up the root folder tree as a drop target
        setupRootDropTarget(folderTree);
      } else {
        console.error('Failed to load file structure:', result.error);
      }
    } catch (error) {
      console.error('Error in loadFileStructure:', error);
    }
  }
  
  // Create a new folder
  async function createFolder(name) {
    try {
      console.log('Creating folder:', name);
      
      // Get the currently selected folder or use root
      const selectedFolder = document.querySelector('.folder.selected');
      const parentPath = selectedFolder ? selectedFolder.getAttribute('data-path') : null;
      console.log('Parent path:', parentPath);
      
      const result = await window.api.createFolder(name, parentPath);
      
      if (result.success) {
        console.log('Folder created successfully');
        // Refresh the file structure
        loadFileStructure();
      } else {
        console.error('Failed to create folder:', result.error);
        alert('Failed to create folder: ' + result.error);
      }
    } catch (error) {
      console.error('Error creating folder:', error);
      alert('Error creating folder: ' + error.message);
    }
  }
  
  // Create a new file
  async function createFile(name) {
    try {
      console.log('Creating file:', name);
      
      // Get the currently selected folder or use root
      const selectedFolder = document.querySelector('.folder.selected');
      const parentPath = selectedFolder ? selectedFolder.getAttribute('data-path') : null;
      console.log('Parent path:', parentPath);
      
      const result = await window.api.createFile(name, parentPath);
      
      if (result.success) {
        console.log('File created successfully at:', result.path);
        // Refresh the file structure and open the new file
        loadFileStructure();
        openFile(result.path);
      } else {
        console.error('Failed to create file:', result.error);
        alert('Failed to create file: ' + result.error);
      }
    } catch (error) {
      console.error('Error creating file:', error);
      alert('Error creating file: ' + error.message);
    }
  }
  
  // Render the file tree recursively
  function renderFileTree(items, container) {
    try {
      console.log('Rendering file tree with', items?.length, 'items');
      
      // Clear the container first
      if (container) {
        container.innerHTML = '';
      } else {
        console.error('Container not found for rendering file tree');
        return;
      }
      
      if (!items || items.length === 0) {
        console.log('No items to render in file tree');
        return;
      }
      
      items.forEach(item => {
        if (item.isDirectory) {
          // Create folder element
          const folderElement = document.createElement('div');
          folderElement.className = 'folder';
          folderElement.setAttribute('data-path', item.path);
          folderElement.setAttribute('draggable', 'true');
          
          // Create toggle element
          const toggleElement = document.createElement('span');
          toggleElement.className = 'folder-toggle';
          
          // Create icon with SVG
          const iconElement = document.createElement('span');
          iconElement.className = 'folder-icon';
          iconElement.innerHTML = folderSvg;
          
          // Create folder name element
          const nameElement = document.createElement('span');
          nameElement.className = 'folder-name';
          nameElement.textContent = item.name;
          
          // Add elements to folder
          folderElement.appendChild(toggleElement);
          folderElement.appendChild(iconElement);
          folderElement.appendChild(nameElement);
          
          // Create container for folder contents
          const folderContent = document.createElement('div');
          folderContent.className = 'folder-content';
          folderContent.style.display = 'none';
          
          // Toggle only when clicking the toggle element
          toggleElement.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFolder(folderElement);
          });
          
          // Select folder on click
          folderElement.addEventListener('click', (e) => {
            e.stopPropagation();
            
            // Toggle selected class
            document.querySelectorAll('.folder.selected').forEach(el => {
              el.classList.remove('selected');
            });
            folderElement.classList.add('selected');
          });
          
          // Make folder a drop target
          setupDropTarget(folderElement);
          
          // Set up drag events for folders too
          setupDragEvents(folderElement);
          
          // Load folder contents on first expand
          toggleElement.addEventListener('click', async (e) => {
            if (folderContent.children.length === 0) {
              const subItems = await window.api.listFiles(item.path);
              if (subItems.success) {
                renderFileTree(subItems.files, folderContent);
              }
            }
          }, { once: true });
          
          container.appendChild(folderElement);
          container.appendChild(folderContent);
        } else {
          // Create file element
          const fileElement = document.createElement('div');
          fileElement.className = 'file';
          fileElement.setAttribute('data-path', item.path);
          fileElement.setAttribute('draggable', 'true');
          
          // Create icon with SVG
          const iconElement = document.createElement('span');
          iconElement.className = 'file-icon';
          iconElement.innerHTML = fileSvg;
          
          // Create file name element
          const nameElement = document.createElement('span');
          nameElement.className = 'file-name';
          nameElement.textContent = item.name;
          
          // Add elements to file
          fileElement.appendChild(iconElement);
          fileElement.appendChild(nameElement);
          
          // Add click listener to open file
          fileElement.addEventListener('click', () => openFile(item.path));
          
          // Set up drag events
          setupDragEvents(fileElement);
          
          container.appendChild(fileElement);
        }
      });
    } catch (error) {
      console.error('Error in renderFileTree:', error);
    }
  }
  
  // Toggle folder open/closed
  function toggleFolder(folderElement) {
    try {
      const folderContent = folderElement.nextElementSibling;
      const iconElement = folderElement.querySelector('.folder-icon');
      
      if (folderContent.style.display === 'none') {
        folderContent.style.display = 'block';
        folderElement.classList.add('folder-open');
        iconElement.innerHTML = folderOpenSvg;
      } else {
        folderContent.style.display = 'none';
        folderElement.classList.remove('folder-open');
        iconElement.innerHTML = folderSvg;
      }
    } catch (error) {
      console.error('Error in toggleFolder:', error);
    }
  }
  
  // Open a file in the editor
  async function openFile(filePath) {
    try {
      console.log('Opening file:', filePath);
      
      // Check if current file has unsaved changes
      if (isEditorDirty && activeFile) {
        if (confirm('You have unsaved changes. Save before opening a new file?')) {
          await saveCurrentFile();
        }
      }
      
      const result = await window.api.readFile(filePath);
      
      if (result.success) {
        editor.value = result.content;
        activeFile = filePath;
        currentFilePath.textContent = filePath;
        isEditorDirty = false;
        console.log('File opened successfully');
      } else {
        console.error('Failed to open file:', result.error);
      }
    } catch (error) {
      console.error('Error in openFile:', error);
    }
  }
  
  // Save current file
  async function saveCurrentFile() {
    try {
      console.log('Saving current file');
      
      if (!activeFile) {
        console.log('No active file to save');
        return;
      }
      
      const content = editor.value;
      console.log('Saving to:', activeFile);
      
      const result = await window.api.saveFile(activeFile, content);
      
      if (result.success) {
        isEditorDirty = false;
        console.log('File saved successfully');
      } else {
        console.error('Failed to save file:', result.error);
      }
    } catch (error) {
      console.error('Error in saveCurrentFile:', error);
    }
  }
  
  // Set up drag events for files and folders
  function setupDragEvents(element) {
    try {
      element.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', element.getAttribute('data-path'));
        element.classList.add('dragging');
      });
      
      element.addEventListener('dragend', () => {
        element.classList.remove('dragging');
      });
    } catch (error) {
      console.error('Error in setupDragEvents:', error);
    }
  }
  
  // Set up drop target for folders
  function setupDropTarget(folderElement) {
    try {
      folderElement.addEventListener('dragover', (e) => {
        e.preventDefault();
        folderElement.classList.add('drag-over');
      });
      
      folderElement.addEventListener('dragleave', () => {
        folderElement.classList.remove('drag-over');
      });
      
      folderElement.addEventListener('drop', async (e) => {
        e.preventDefault();
        folderElement.classList.remove('drag-over');
        
        const sourceFilePath = e.dataTransfer.getData('text/plain');
        const targetFolderPath = folderElement.getAttribute('data-path');
        
        // Prevent dropping on itself
        if (sourceFilePath === targetFolderPath) {
          console.log('Cannot drop item on itself');
          return;
        }
        
        // Prevent dropping a folder into its own subfolder
        if (targetFolderPath.startsWith(sourceFilePath + '/')) {
          console.log('Cannot drop folder into its own subfolder');
          return;
        }
        
        if (sourceFilePath && targetFolderPath) {
          const result = await window.api.moveFile(sourceFilePath, targetFolderPath);
          
          if (result.success) {
            // Refresh the file structure
            loadFileStructure();
            
            // Update active file path if the moved file was open
            if (activeFile === sourceFilePath) {
              activeFile = result.newPath;
              currentFilePath.textContent = result.newPath;
            }
          } else {
            console.error('Failed to move file:', result.error);
          }
        }
      });
    } catch (error) {
      console.error('Error in setupDropTarget:', error);
    }
  }
  
  // Set up the root folder tree as a drop target
  function setupRootDropTarget(folderTreeElement) {
    try {
      console.log('Setting up root folder tree as drop target');
      
      folderTreeElement.addEventListener('dragover', (e) => {
        // Only handle the event if not over a child folder or file element
        // This prevents conflicts with other drop targets
        if (e.target === folderTreeElement) {
          e.preventDefault();
          folderTreeElement.classList.add('drag-over');
        }
      });
      
      folderTreeElement.addEventListener('dragleave', (e) => {
        // Only handle the event if leaving the folder tree itself
        if (e.target === folderTreeElement) {
          folderTreeElement.classList.remove('drag-over');
        }
      });
      
      folderTreeElement.addEventListener('drop', async (e) => {
        // Only handle the drop if it's directly on the folder tree container
        // and not on a child element
        if (e.target === folderTreeElement) {
          e.preventDefault();
          folderTreeElement.classList.remove('drag-over');
          
          const sourceFilePath = e.dataTransfer.getData('text/plain');
          
          if (!sourceFilePath) {
            console.log('No source path in drop data');
            return;
          }
          
          console.log('Item dropped on root folder tree:', sourceFilePath);
          
          try {
            // Get the root notes path from the API
            const rootList = await window.api.listFiles();
            if (!rootList.success) {
              console.error('Failed to get root directory info');
              return;
            }
            
            // We need to extract the root directory path
            // Use the API's listFiles with null to get the root path
            // Then use moveFile to move the source file to that path
            const result = await window.api.moveFile(sourceFilePath, null);
            
            if (result.success) {
              console.log('Item moved to root successfully');
              
              // Update active file path if the moved file was open
              if (activeFile === sourceFilePath) {
                activeFile = result.newPath;
                currentFilePath.textContent = result.newPath;
              }
              
              // Refresh the file structure
              loadFileStructure();
            } else {
              console.error('Failed to move item to root:', result.error);
            }
          } catch (error) {
            console.error('Error moving item to root:', error);
          }
        }
      });
      
      console.log('Root folder tree set up as drop target');
    } catch (error) {
      console.error('Error in setupRootDropTarget:', error);
    }
  }
  
  // Set up the trash container as a drop target
  function setupTrash() {
    const trashContainer = document.getElementById('trash-container');
    
    if (!trashContainer) {
      console.error('Trash container not found');
      return;
    }
    
    // Replace trash icon with SVG
    const trashIconElement = trashContainer.querySelector('.trash-icon');
    if (trashIconElement) {
      trashIconElement.innerHTML = trashSvg;
    }
    
    trashContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      trashContainer.classList.add('drag-over');
    });
    
    trashContainer.addEventListener('dragleave', () => {
      trashContainer.classList.remove('drag-over');
    });
    
    trashContainer.addEventListener('drop', async (e) => {
      e.preventDefault();
      trashContainer.classList.remove('drag-over');
      
      const itemPath = e.dataTransfer.getData('text/plain');
      if (!itemPath) return;
      
      const itemName = itemPath.split('/').pop();
      
      // Ask for confirmation
      if (confirm(`Are you sure you want to delete "${itemName}"? This cannot be undone.`)) {
        try {
          // Visual feedback
          trashContainer.classList.add('confirm');
          setTimeout(() => trashContainer.classList.remove('confirm'), 500);
          
          const result = await window.api.deleteItem(itemPath);
          
          if (result.success) {
            console.log('Item deleted successfully');
            
            // If the deleted item was the active file, clear the editor
            if (activeFile === itemPath) {
              editor.value = '';
              activeFile = null;
              currentFilePath.textContent = '';
              isEditorDirty = false;
            }
            
            // Refresh the file structure
            loadFileStructure();
          } else {
            console.error('Failed to delete item:', result.error);
            alert('Failed to delete: ' + result.error);
          }
        } catch (error) {
          console.error('Error during deletion:', error);
          alert('Error during deletion: ' + error.message);
        }
      }
    });
    
    console.log('Trash container set up');
  }

  // Set up settings icon and theme functionality
  function setupSettings() {
    try {
      console.log('Setting up settings functionality');
      
      // Insert the SVG into the settings icon
      if (settingsIcon) {
        console.log('Inserting settings icon SVG');
        settingsIcon.innerHTML = settingsSvg;
        
        // Open settings on click
        settingsIcon.addEventListener('click', () => {
          console.log('Settings icon clicked');
          settingsOverlay.classList.add('show');
        });
      } else {
        console.error('Settings icon element not found!');
      }
      
      // Close settings dialog
      if (settingsCloseBtn) {
        settingsCloseBtn.addEventListener('click', () => {
          settingsOverlay.classList.remove('show');
        });
      }
      
      // Setup theme options
      if (themeOptions && themeOptions.length > 0) {
        themeOptions.forEach(option => {
          option.addEventListener('click', () => {
            const theme = option.getAttribute('data-theme');
            console.log('Theme selected:', theme);
            
            // Remove selected class from all options
            themeOptions.forEach(opt => opt.classList.remove('selected'));
            
            // Add selected class to clicked option
            option.classList.add('selected');
            
            // Apply theme
            applyTheme(theme);
            
            // Save theme preference
            localStorage.setItem('simplenote-theme', theme);
          });
        });
      } else {
        console.error('Theme options not found!');
      }
      
      // Load saved theme if exists
      const savedTheme = localStorage.getItem('simplenote-theme');
      if (savedTheme) {
        console.log('Loading saved theme:', savedTheme);
        applyTheme(savedTheme);
        
        // Update selected state in UI
        themeOptions.forEach(option => {
          if (option.getAttribute('data-theme') === savedTheme) {
            option.classList.add('selected');
          } else {
            option.classList.remove('selected');
          }
        });
      }
      
      console.log('Settings setup complete');
    } catch (error) {
      console.error('Error in setupSettings:', error);
    }
  }

  // Apply the selected theme
  function applyTheme(theme) {
    try {
      console.log('Applying theme:', theme);
      document.body.className = ''; // Clear existing themes
      document.body.classList.add(`app-theme-${theme}`);
      
      // Apply theme-specific CSS variables
      switch (theme) {
        case 'dark':
          document.documentElement.style.setProperty('--bg-color', '#202124');
          document.documentElement.style.setProperty('--sidebar-bg', '#292a2d');
          document.documentElement.style.setProperty('--text-color', '#e8eaed');
          document.documentElement.style.setProperty('--border-color', '#5f6368');
          document.documentElement.style.setProperty('--hover-color', '#3c4043');
          document.documentElement.style.setProperty('--accent-color', '#8ab4f8');
          break;
        case 'blue':
          document.documentElement.style.setProperty('--bg-color', '#f8fbff');
          document.documentElement.style.setProperty('--sidebar-bg', '#e8f0fe');
          document.documentElement.style.setProperty('--text-color', '#3c4043');
          document.documentElement.style.setProperty('--border-color', '#c6dafc');
          document.documentElement.style.setProperty('--hover-color', '#d2e3fc');
          document.documentElement.style.setProperty('--accent-color', '#1a73e8');
          break;
        case 'sepia':
          document.documentElement.style.setProperty('--bg-color', '#fbf8f2');
          document.documentElement.style.setProperty('--sidebar-bg', '#f4ecd8');
          document.documentElement.style.setProperty('--text-color', '#5f4b32');
          document.documentElement.style.setProperty('--border-color', '#e6d7b8');
          document.documentElement.style.setProperty('--hover-color', '#efe4cf');
          document.documentElement.style.setProperty('--accent-color', '#a3681a');
          break;
        default: // Light theme
          document.documentElement.style.setProperty('--bg-color', '#ffffff');
          document.documentElement.style.setProperty('--sidebar-bg', '#fafafa');
          document.documentElement.style.setProperty('--text-color', '#3c4043');
          document.documentElement.style.setProperty('--border-color', '#eeeeee');
          document.documentElement.style.setProperty('--hover-color', '#f5f5f5');
          document.documentElement.style.setProperty('--accent-color', '#1a73e8');
          break;
      }
    } catch (error) {
      console.error('Error applying theme:', error);
    }
  }
});