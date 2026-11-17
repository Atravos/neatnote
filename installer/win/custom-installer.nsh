; =============================================================================
; NeatNote — hooks for electron-builder's NSIS installer / uninstaller
;
; Where data lives:  %APPDATA%\NeatNote
;   notes\         the user's notes            -> NEVER touched here
;   config.json    settings (sidebar order, window size, theme color)
;   everything else: Chromium's own storage and caches
;
; Paths below are spelled out one by one on purpose. Nothing in this file
; deletes by wildcard or walks the data folder, so no mistake here can ever
; reach the notes.
; =============================================================================

; -----------------------------------------------------------------------------
; Installer start.
;
; Versions up to 1.0.5 deleted config.json from their uninstaller — and when
; this installer upgrades one of them, it is that OLD uninstaller that runs.
; Keep a copy of the settings so the upgrade doesn't reset them; customInstall
; puts it back if the old uninstaller removed it.
; -----------------------------------------------------------------------------
!macro customInit
  InitPluginsDir

  ; Electron keeps app data per user, even for an all-users install
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}

  ${if} ${FileExists} "$APPDATA\NeatNote\config.json"
    CopyFiles /SILENT "$APPDATA\NeatNote\config.json" "$PLUGINSDIR\neatnote-config-backup.json"
  ${endif}

  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}
!macroend

; -----------------------------------------------------------------------------
; After the new files are in place.
; -----------------------------------------------------------------------------
!macro customInstall
  ; Electron keeps app data per user, even for an all-users install
  ${if} $installMode == "all"
    SetShellVarContext current
  ${endif}

  ${if} ${FileExists} "$PLUGINSDIR\neatnote-config-backup.json"
  ${andIfNot} ${FileExists} "$APPDATA\NeatNote\config.json"
    CreateDirectory "$APPDATA\NeatNote"
    CopyFiles /SILENT "$PLUGINSDIR\neatnote-config-backup.json" "$APPDATA\NeatNote\config.json"
  ${endif}

  ${if} $installMode == "all"
    SetShellVarContext all
  ${endif}
!macroend

; -----------------------------------------------------------------------------
; Uninstall.
;
; IMPORTANT: this macro also runs while UPGRADING — the new installer removes
; the previous version by running its uninstaller with --updated. Settings may
; only be removed on a real uninstall, so everything is inside
; "ifNot isUpdated". (Without that guard every update reset the theme and the
; sidebar order.)
;
; electron-builder has already made sure the app is closed before this point
; (gracefully first, so pending edits are saved), so nothing is force-killed
; here.
; -----------------------------------------------------------------------------
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${if} $installMode == "all"
      SetShellVarContext current
    ${endif}

    ; Settings
    Delete "$APPDATA\NeatNote\config.json"

    ; Chromium / Electron storage and caches (all recreated on next launch)
    RMDir /r "$APPDATA\NeatNote\Local Storage"
    RMDir /r "$APPDATA\NeatNote\Session Storage"
    RMDir /r "$APPDATA\NeatNote\Cache"
    RMDir /r "$APPDATA\NeatNote\Code Cache"
    RMDir /r "$APPDATA\NeatNote\GPUCache"
    RMDir /r "$APPDATA\NeatNote\DawnGraphiteCache"
    RMDir /r "$APPDATA\NeatNote\DawnWebGPUCache"
    RMDir /r "$APPDATA\NeatNote\Crashpad"
    RMDir /r "$APPDATA\NeatNote\blob_storage"
    RMDir /r "$APPDATA\NeatNote\databases"
    RMDir /r "$APPDATA\NeatNote\IndexedDB"
    RMDir /r "$APPDATA\NeatNote\Network"
    RMDir /r "$APPDATA\NeatNote\Service Worker"
    RMDir /r "$APPDATA\NeatNote\Shared Dictionary"
    Delete "$APPDATA\NeatNote\SharedStorage"
    RMDir /r "$APPDATA\NeatNote\WebStorage"
    RMDir /r "$APPDATA\NeatNote\Dictionaries"
    Delete "$APPDATA\NeatNote\Local State"
    Delete "$APPDATA\NeatNote\Preferences"
    Delete "$APPDATA\NeatNote\Network Persistent State"
    Delete "$APPDATA\NeatNote\TransportSecurity"
    Delete "$APPDATA\NeatNote\DIPS"
    Delete "$APPDATA\NeatNote\DIPS-wal"
    Delete "$APPDATA\NeatNote\SharedStorage-wal"
    Delete "$APPDATA\NeatNote\lockfile"

    ; Removes the data folder only if it is now empty — i.e. only when the
    ; user has no notes. (RMDir without /r never deletes a non-empty folder.)
    RMDir "$APPDATA\NeatNote\notes"
    RMDir "$APPDATA\NeatNote"

    ${if} $installMode == "all"
      SetShellVarContext all
    ${endif}
  ${endif}
!macroend
