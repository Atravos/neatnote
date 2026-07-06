!macro customInstall
  ; Ensure any previous instance is fully closed before installing
  nsExec::ExecToLog 'taskkill /f /im "NeatNote.exe"'
  Sleep 500
!macroend

!macro customUnInstall
  ; Ensure the application is not running before uninstalling
  nsExec::ExecToLog 'taskkill /f /im "NeatNote.exe"'
  Sleep 1000

  ; Run the cleanup utility to release file locks on app data.
  ; The cleanup.exe is placed in the extraResources directory by electron-builder.
  IfFileExists "$INSTDIR\resources\cleanup.exe" 0 +3
    nsExec::ExecToLog '"$INSTDIR\resources\cleanup.exe"'
    Sleep 2000
!macroend
