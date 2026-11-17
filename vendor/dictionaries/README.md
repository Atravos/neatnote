# Spell-check dictionaries (bundled)

These `.bdic` files are the English Hunspell dictionaries that Electron
publishes with each release (`hunspell_dictionaries.zip`). They are bundled
so spell check works offline, out of the box.

## Why they are here

On Windows and Linux, Electron's spell checker needs a dictionary file and,
by default, downloads it from a Google-hosted server the first time the app
runs. NeatNote makes no network requests, so that download is blocked
(`hardenSession()` in `src/main/main.js`). Instead, at startup the app
copies these files into its data folder (`<userData>/Dictionaries`), which
is where the spell checker looks before trying to download anything.

macOS uses the system spell checker and ignores these files.

## Adding a language

Drop that language's `.bdic` file from the same zip into this folder. Users
whose system language matches will get spell check in it. Without a bundled
dictionary a language simply has no spell check (nothing is downloaded).

## When you upgrade Electron

Dictionary file names carry a version (`en-US-10-2.bdic`). A new Electron
release may expect a newer one; an old file is then ignored and spell check
silently stops. After changing the Electron version:

1. Download `hunspell_dictionaries.zip` from that version's release page:
   `https://github.com/electron/electron/releases/tag/v<version>`
2. Replace the `.bdic` files here with the same languages from the zip
   (and `LICENSE.txt` with the zip's `LICENSE`).
3. Run `npm run test:e2e` — the "spell check works offline" test fails if
   the files don't match the installed Electron.

Bundled files are from Electron v45.3.3.

## License

See `LICENSE.txt` (shipped inside the zip; covers all dictionaries).
