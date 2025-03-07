document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded');
    
    // Get DOM elements
    const folderTree = document.getElementById('folder-tree');
    const newFolderBtn = document.getElementById('new-folder-btn');
    const newFileBtn = document.getElementById('new-file-btn');
    const editor = document.getElementById('editor');
    const saveBtn = document.getElementById('save-btn');
    const currentFilePath = document.getElementById('current-file-path');
    
    // Modal elements
    const modalOverlay = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-title');
    const modalInput = document.getElementById('modal-input');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');
    
    // Debug logging
    console.log('Elements found:', { 
      folderTree: !!folderTree, 
      newFolderBtn: !!newFolderBtn, 
      newFileBtn: !!newFileBtn, 
      editor: !!editor, 
      saveBtn: !!saveBtn,
      modalOverlay: !!modalOverlay
    });
    
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
    
    if (editor) {
      editor.addEventListener('input', () => {
        isEditorDirty = true;
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
        } else {
          console.error('Failed to load file structure:', result.error);
        }
      } catch (error) {
        console.error('Error in loadFileStructure:', error);
      }
    }
    
    // Create a new folder (replacement for createNewFolder)
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
    
    // Create a new file (replacement for createNewFile)
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
            folderElement.setAttribute('draggable', 'true'); // Make folders draggable too
            folderElement.innerHTML = `
              <span class="folder-icon"></span>
              <span class="folder-name">${item.name}</span>
            `;
            
            // Add click listener to toggle folder
            folderElement.addEventListener('click', (e) => {
              e.stopPropagation();
              toggleFolder(folderElement);
              
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
            
            // Create container for folder contents
            const folderContent = document.createElement('div');
            folderContent.className = 'folder-content';
            folderContent.style.display = 'none';
            
            // Load folder contents on first open
            folderElement.addEventListener('click', async () => {
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
            fileElement.innerHTML = `
              <span class="file-icon"></span>
              <span class="file-name">${item.name}</span>
            `;
            
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
        
        if (folderContent.style.display === 'none') {
          folderContent.style.display = 'block';
          folderElement.querySelector('.folder-icon').classList.add('folder-open');
        } else {
          folderContent.style.display = 'none';
          folderElement.querySelector('.folder-icon').classList.remove('folder-open');
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
    
    // Set up the trash container as a drop target
    function setupTrash() {
      const trashContainer = document.getElementById('trash-container');
      
      if (!trashContainer) {
        console.error('Trash container not found');
        return;
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
  });