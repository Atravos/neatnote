!macro customUnInstall
  ; Clean up our data to prevent file locks during uninstall
  Exec '"$INSTDIR\resources\app\cleanup.exe"'
  Sleep 1000 ; Wait for cleanup to complete
!macroend