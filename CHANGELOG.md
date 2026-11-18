# NeatNote 1.2.0

## New
- **Updates built in — only if you allow it.** The first time it opens,
  NeatNote asks whether it may check for updates automatically. If you say
  yes, it checks GitHub for a newer version each time it opens and offers
  it: **Update**, **Later**, or **Skip This Version**. Nothing is ever
  installed without your OK.
  - Windows: downloads the installer, checks its size and SHA-256 against
    the release, then closes NeatNote (saving first) and runs the installer
    over the current version. Taskbar shows download progress.
  - macOS: opens the download page. (macOS only lets an app replace itself
    when it is signed with an Apple Developer ID, which these builds aren't.)
  - Settings → Updates: current version, the "Check for updates when
    NeatNote opens" switch (off until you agree), and a **Check for
    updates** button that works either way. macOS also has
    NeatNote → Check for Updates… in the menu bar.

## Privacy
- NeatNote connects to nothing until you allow it. The update check is the
  only network request it ever makes: a plain request for the latest public
  release on GitHub. It runs in a separate,
  in-memory session from the main process; the app's own pages are still
  blocked from the network entirely. Answering "Don't Check" (or turning
  the switch off) means NeatNote never connects unless you press **Check for
  updates**.

# NeatNote 1.1.0

Full audit pass on 1.0.5. Every item below was fixed; the Critical and most
High/Medium ones were first reproduced on 1.0.5 running in Electron.

## Critical
- **Reopening a note destroyed whitespace.** Double spaces, leading spaces,
  tabs and code-block indentation were collapsed on load, and the next save
  made it permanent. Saved notes now round-trip byte-for-byte.
- **Text typed with no note open was thrown away.** It now goes into a new
  "Untitled" note (Untitled 2, 3, ... if taken) and auto-saves.

## High
- Electron 28 (end of life) → **45.3.3**; electron-builder → 26.
- **Updates wiped settings.** The uninstall hook also ran during upgrades and
  deleted config.json and Local Storage. Now only a real uninstall cleans up,
  and the installer protects settings even when the *old* 1.0.5 uninstaller
  runs. The `pkg`-built `cleanup.exe` (and the fake one shipped in mac/Linux
  builds) is gone; cleanup is plain NSIS that never touches `notes\`.
- **A failed save on close lost edits silently.** Closing now waits for the
  save; if it failed you get "Go Back / Close Without Saving". Quit also
  waits for any write still in flight.
- **Single-instance lock**: a second launch focuses the existing window
  instead of two copies overwriting each other.
- **Linux .deb build failed** (empty `author`). Fixed in package.json.

## Medium
- No Reload / DevTools menu items or shortcuts in installed builds.
- Trashing a folder containing the open note no longer leaves a ghost note.
- Name dialog no longer submits on the Enter that commits Japanese/IME text.
- Notes edited outside the app: reloaded on window focus if you have no
  unsaved edits; if you do, the other version is kept as
  "name (conflict <date>).html" instead of being overwritten. Notes deleted
  outside the app are closed.
- Sidebar order keys rebuilt: non-ASCII folders (日本語 / 中国語), spaces vs
  underscores, and a folder named `_root` no longer share one order. Old
  orders are migrated automatically; the old data is left in place.
- Trailing blank lines kept; .txt notes keep CRLF and their final newline.
- Plain .txt notes stay plain: typing "- " or "1. " no longer deletes the
  marker (list auto-format), Ctrl+B etc. do nothing, pasted formatting and
  images are stripped instead of silently vanishing later.
- Drag and drop: dropping on itself is a no-op; dropping below the list goes
  to the top level (not into the last open folder).
- IPC hardening: every channel checks the sender; save content validated;
  25 MB cap; binary files refused instead of being corrupted by auto-save.
- Folders deleted outside the app are no longer recreated by listing; note
  creation can never overwrite (atomic `wx`).
- Uninstall button: shown only in an installed Windows build (hidden when
  running from source); launched through the shell (elevation prompt works),
  errors reported, pending edits saved before quitting. Windows only.
- Keyboard-accessible sidebar (arrows, Home/End, Enter, F2, Delete, menu key),
  right-click menu (new note/folder inside a folder, rename, reveal, trash),
  editor right-click menu with spelling suggestions and link actions.
  Ctrl/Cmd+click opens links (web/mail only).
- Notes and folders can be created inside folders.
- Sidebar refresh keeps scroll position and doesn't flicker.
- Fast clicking between notes can't show one note with another highlighted,
  and keystrokes during a switch are saved to the right note.
- Spell check works fully offline: English dictionaries are bundled
  (vendor/dictionaries) and the Google download is blocked. All web
  permissions denied; all outbound requests blocked.
- Packaging: universal mac targets (arm64 + x64), Linux category, AppUserModelId,
  Electron fuses (no run-as-node, no NODE_OPTIONS/inspect, asar-only; the
  macOS ad-hoc signature is re-applied after the fuses are set, without
  which Apple Silicon refuses to launch the unsigned build).

## Low
- No white/default-theme flash at startup (palette applied before first paint).
- Theme recovered automatically if the saved choice was wiped (as 1.0.5
  updates did).
- Word count debounced; drag-over no longer measures every row.
- Search now covers note contents (with highlighted snippets), runs in one
  call, no depth limit.
- Case-only rename ("note" → "Note") works on Windows/macOS.
- Shortcuts work on non-Latin keyboard layouts; Cmd on mac, Ctrl elsewhere
  (mac Ctrl+N/P/E text navigation no longer hijacked).
- Crash-leftover temp files cleaned up; moves are atomic renames.
- Repeated identical save errors show one toast, not one per keystroke burst.
- Window size/position, last open note and expanded folders remembered.
- `.html` hidden in the sidebar; empty-state messages; renderer-crash dialog.
- Dialog roles, focus trapping and reliable focus; keyboard theme picker.
- Dead code removed (processManager.js, cleanup.js, build-cleanup.js).

## App icon
- Added `build/icon.png` (1024×1024) and its source `build/icon.svg`.
  electron-builder generates the Mac, Windows and Linux icons from it.

## New features
- **Export as Markdown** (Export button, Ctrl/Cmd+Shift+E).
- **Full-text search** across all notes.
- **Clear formatting** button (Ctrl/Cmd+\).

## Judgment calls
- Sidebar orders saved by 1.0.5 under colliding keys are copied to every
  folder that shared them (that is the order both were already showing).
- Uninstall still keeps your notes; it now also leaves the data folder if
  any notes exist.
- Spell check languages other than English need their `.bdic` dropped into
  vendor/dictionaries (see its README). Must be refreshed on Electron upgrades.
- Version bumped to 1.1.0; `author` set to "NeatNote <theneatnoteapp@gmail.com>"
  (shown as the maintainer of the Linux .deb; Windows shows "NeatNote" as Publisher).
- Requires Node 22.12+ to build (Electron 45 / electron-builder 26).

## Tests
- `npm test`: 34 unit tests (file layer, ordering + migration, Markdown,
  URL safety, menu).
- `npm run test:e2e`: 43 end-to-end tests driving the real app against a
  throwaway data folder (needs a display; `xvfb-run -a` on headless Linux).

## Verified
- Linux AppImage and .deb built and the packaged app smoke-tested.
- Windows NSIS installer script compiled on Linux. **Not run on real
  Windows or macOS** — install/upgrade-over-1.0.5/uninstall on Windows is
  the one thing to try by hand before shipping.
