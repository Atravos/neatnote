/*
 * End-to-end tests: launches the real app (main process, preload, renderer)
 * against a throwaway data folder and drives it the way a user would.
 *
 *   npm run test:e2e
 *
 * Needs a display. On a headless Linux box:
 *   xvfb-run -a npx electron tests/e2e/run.js
 * (add --no-sandbox after "electron" when running as root, e.g. in CI
 * containers).
 *
 * Nothing here touches your real notes: userData is redirected to a temp
 * directory before the app starts, and the OS trash, external browser and
 * native dialogs are replaced with recording stubs.
 */

const electron = require('electron');
const { app, BrowserWindow } = electron;
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP_ROOT = path.join(__dirname, '..', '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neatnote-e2e-'));
const notesRoot = path.join(userData, 'notes');
const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'neatnote-e2e-export-'));

app.setPath('userData', userData);
process.env.NEATNOTE_ALLOW_MULTIPLE = '1';

// ---- Seed data (before the app starts) ------------------------------------------

function seed(relativePath, content) {
  const full = path.join(notesRoot, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

fs.mkdirSync(path.join(notesRoot, 'My Notes'), { recursive: true });
fs.mkdirSync(path.join(notesRoot, '日本語'), { recursive: true });
fs.mkdirSync(path.join(notesRoot, '中国語'), { recursive: true });
seed('alpha.html', '<p>alpha</p>');
seed('beta.html', '<p>beta</p>');
seed('gamma.txt', 'line1\r\nline2\r\n');
seed('My Notes/inner.html', '<p>inner note with a needle in it</p>');
seed('My Notes/second.html', '<p>second</p>');
seed('日本語/メモ.html', '<p>こんにちは</p>');
seed('中国語/笔记.html', '<p>你好</p>');
seed('.alpha.html.123.456.tmp', 'stale temp');
const staleTime = new Date(Date.now() - 60 * 60 * 1000);
fs.utimesSync(path.join(notesRoot, '.alpha.html.123.456.tmp'), staleTime, staleTime);

// A config.json written by the previous version: lossy "sortOrder" keys
fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
  themeBackground: '#1d1b27', // the "dusk" theme, as saved by the previous version
  sortOrder: {
    _root: ['gamma.txt', 'beta.html', 'alpha.html'],
    My_Notes: ['second.html', 'inner.html']
  }
}));

// ---- Stubs for things that must not really happen in a test ------------------

const recorded = { external: [], openedPaths: [], revealed: [], syncDialogs: [], trashed: [], menus: [] };
let syncDialogResponse = 0;
let saveDialogTarget = null;

electron.shell.openExternal = async (url) => { recorded.external.push(url); };
electron.shell.openPath = async (target) => { recorded.openedPaths.push(target); return ''; };
electron.shell.showItemInFolder = (target) => { recorded.revealed.push(target); };
electron.dialog.showMessageBoxSync = (...args) => {
  recorded.syncDialogs.push(args[args.length - 1]);
  return syncDialogResponse;
};
// Native menus: record what would be shown instead of popping it up
const realBuildFromTemplate = electron.Menu.buildFromTemplate.bind(electron.Menu);
electron.Menu.buildFromTemplate = (template) => {
  const menu = realBuildFromTemplate(template);
  menu.popup = () => { recorded.menus.push(template); };
  return menu;
};
electron.dialog.showSaveDialog = async () => (
  saveDialogTarget ? { canceled: false, filePath: saveDialogTarget } : { canceled: true }
);

const fileSystem = require(path.join(APP_ROOT, 'src/main/fileSystem.js'));
fileSystem.setTrashImplementation(async (target) => {
  recorded.trashed.push(target);
  fs.rmSync(target, { recursive: true, force: true });
});

// Spell check: record what the dictionary loader does
const spellEvents = [];
app.whenReady().then(() => {
  for (const name of ['initialized', 'download-begin', 'download-success', 'download-failure']) {
    electron.session.defaultSession.on(`spellcheck-dictionary-${name}`, (event, language) => {
      spellEvents.push(`${name}:${language}`);
    });
  }
});

// ---- Tiny test runner -----------------------------------------------------------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The app's shortcut key: Cmd on macOS, Ctrl elsewhere (Quill follows the
// same rule for Bold/Italic/Undo)
const MOD = process.platform === 'darwin' ? 'meta' : 'control';

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'Values differ'}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  }
}

let win = null;
let wc = null;
const rendererErrors = [];

const js = (code) => wc.executeJavaScript(code, true);
const readNote = (relativePath) => fs.readFileSync(path.join(notesRoot, relativePath), 'utf8');
const noteExists = (relativePath) => fs.existsSync(path.join(notesRoot, relativePath));
const config = () => JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'));
const cssPath = (p) => JSON.stringify(p);

async function waitFor(check, { timeout = 5000, label = 'condition' } = {}) {
  const start = Date.now();
  for (;;) {
    const value = typeof check === 'string' ? await js(check) : await check();
    if (value) return value;
    if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`);
    await sleep(40);
  }
}

function attach(window) {
  win = window;
  wc = window.webContents;
  wc.on('console-message', (event) => {
    if (event.level === 'error') rendererErrors.push(event.message);
  });
}

async function waitForApp() {
  await waitFor(() => BrowserWindow.getAllWindows().length > 0, { label: 'window' });
  attach(BrowserWindow.getAllWindows()[0]);
  await waitFor(`document.readyState === 'complete' && !!document.querySelector('#folder-tree[role="tree"]')`, { label: 'renderer' });
  await waitFor(`!!document.querySelector('#folder-tree .file, #folder-tree .folder, #folder-tree .tree-message')`, { label: 'tree' });
}

async function reload() {
  wc.reload();
  await sleep(150);
  await waitForApp();
  await sleep(250);
}

/** Send a real key press through Chromium's input pipeline. */
async function press(keyCode, modifiers = []) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (keyCode.length === 1 && modifiers.every(m => m === 'shift')) {
    wc.sendInputEvent({ type: 'char', keyCode, modifiers });
  }
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await sleep(60);
}

/** Real mouse click on the center of an element. */
async function click(selector, { count = 1, button = 'left' } = {}) {
  const found = await js(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    el.scrollIntoView({ block: 'nearest' });
    return true;
  })()`);
  assert(found, `No element matches ${selector}`);
  await sleep(70); // let any scroll settle before measuring and clicking
  const rect = await js(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + Math.min(r.width / 2, 60)), y: Math.round(r.top + r.height / 2) };
  })()`);
  assert(rect, `No element matches ${selector}`);
  for (let i = 1; i <= count; i++) {
    wc.sendInputEvent({ type: 'mouseDown', x: rect.x, y: rect.y, button, clickCount: i });
    wc.sendInputEvent({ type: 'mouseUp', x: rect.x, y: rect.y, button, clickCount: i });
  }
  await sleep(120);
}

// JSON string syntax is also valid CSS string syntax (backslashes included)
const rowSelector = (fullPath) => `#folder-tree [data-path=${cssPath(fullPath)}]`;
const notePath = (relativePath) => path.join(notesRoot, relativePath);

async function openNote(relativePath) {
  // Expand any collapsed folder on the way to the note
  const parts = relativePath.split('/');
  for (let depth = 1; depth < parts.length; depth++) {
    const folder = rowSelector(notePath(parts.slice(0, depth).join('/')));
    if (await js(`(() => { const r = document.querySelector(${JSON.stringify(folder)}); return !!r && !r.classList.contains('folder-open'); })()`)) {
      await click(folder);
      await sleep(320);
    }
  }
  await click(rowSelector(notePath(relativePath)));
  await waitFor(`document.title.startsWith(${JSON.stringify(path.basename(relativePath).replace(/\.[^.]+$/, ''))})`, { label: `open ${relativePath}` });
  await sleep(80);
}

async function typeText(text) {
  await js(`document.querySelector('#editor .ql-editor').focus()`);
  await wc.insertText(text);
  await sleep(60);
}

/** Type with real key events (needed for Quill's keyboard shortcuts to see them). */
async function typeKeys(text) {
  await js(`document.querySelector('#editor .ql-editor').focus()`);
  for (const ch of text) {
    const keyCode = ch === ' ' ? 'Space' : (ch === '\n' ? 'Enter' : ch);
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'char', keyCode: ch === '\n' ? '\r' : ch });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
    await sleep(20);
  }
  await sleep(60);
}

async function saveNow() {
  // Clear the label first: it may still say "Saved" from an earlier save,
  // which would let this return before the new save has happened
  await js(`document.getElementById('auto-save-indicator').textContent = ''`);
  await press('s', [MOD]);
  await waitFor(`document.getElementById('auto-save-indicator').textContent === 'Saved'`, { label: 'save' });
  await sleep(120);
}

const editorHtml = () => js(`document.querySelector('#editor .ql-editor').innerHTML`);
const editorText = () => js(`Quill.find(document.getElementById('editor')).getText()`);
const treeNames = () => js(`Array.from(document.querySelectorAll('#folder-tree > .file, #folder-tree > .folder')).map(r => r.dataset.name)`);
const modalOpen = () => js(`document.getElementById('modal-overlay').classList.contains('show')`);

async function fillModal(value, { confirm = true } = {}) {
  await waitFor(modalOpen, { label: 'modal' });
  await sleep(90); // the dialog focuses its input after a short delay
  await js(`(() => { const i = document.getElementById('modal-input'); i.focus(); i.value = ${JSON.stringify(value)}; })()`);
  if (confirm) {
    await press('Enter');
    await waitFor(async () => !(await modalOpen()), { label: 'modal to close' });
    await sleep(250);
  }
}

async function confirmModal() {
  await waitFor(modalOpen, { label: 'confirm dialog' });
  await sleep(90);
  await click('#modal-confirm-btn');
  await sleep(300);
}

/** Simulate a drag from one sidebar row to a spot on another. */
async function drag(fromPath, toPath, where) {
  await js(`(() => {
    const row = (p) => Array.from(document.querySelectorAll('#folder-tree .file, #folder-tree .folder')).find(r => r.dataset.path === p);
    const from = row(${JSON.stringify(fromPath)});
    const data = new DataTransfer();
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }));
    let target, y, x;
    if (${JSON.stringify(where)} === 'end') {
      target = document.getElementById('folder-tree');
      const rows = Array.from(target.querySelectorAll('.file, .folder')).filter(r => r.offsetParent);
      const last = rows[rows.length - 1].getBoundingClientRect();
      y = last.bottom + 12; x = last.left + 20;
    } else {
      target = row(${JSON.stringify(toPath)});
      const r = target.getBoundingClientRect();
      const f = { before: 0.1, into: 0.5, after: 0.9 }[${JSON.stringify(where)}];
      y = r.top + r.height * f; x = r.left + 20;
    }
    const init = { bubbles: true, cancelable: true, dataTransfer: data, clientX: x, clientY: y };
    target.dispatchEvent(new DragEvent('dragover', init));
    target.dispatchEvent(new DragEvent('drop', init));
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
  })()`);
  await sleep(450);
}

// ---- Tests ---------------------------------------------------------------------

test('starts hardened: sandboxed renderer, no Node, strict CSP', async () => {
  assertEqual(await js(`typeof require`), 'undefined', 'require leaked into the page');
  assertEqual(await js(`typeof process`), 'undefined', 'process leaked into the page');
  assertEqual(await js(`typeof window.api.readFile`), 'function');
  assertEqual(await js(`Object.keys(window.api).includes('ipcRenderer')`), false);
  const prefs = wc.getLastWebPreferences();
  assertEqual(prefs.sandbox, true, 'sandbox');
  assertEqual(prefs.contextIsolation, true, 'contextIsolation');
  assertEqual(prefs.nodeIntegration, false, 'nodeIntegration');
  const csp = await js(`document.querySelector('meta[http-equiv="Content-Security-Policy"]').content`);
  assert(csp.includes("script-src 'self'") && csp.includes("connect-src 'none'"), 'CSP changed unexpectedly');
});

test('recovers the theme from the settings file when the saved choice was wiped', async () => {
  // Browser-side storage starts empty here (as after an update from <= 1.0.5)
  await waitFor(`document.body.classList.contains('app-theme-dusk')`, { label: 'dusk theme' });
  assertEqual(await js(`localStorage.getItem('simplenote-theme')`), 'dusk');
  assertEqual(await js(`document.querySelector('.theme-option[data-theme="dusk"]').getAttribute('aria-checked')`), 'true');
  assertEqual(await js(`getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim()`), '#1d1b27');
});

test('migrates the previous sort-order format and applies it', async () => {
  const saved = config();
  assert(saved.sortOrders, 'sortOrders key missing after migration');
  assertEqual(JSON.stringify(saved.sortOrders['/']), JSON.stringify(['gamma.txt', 'beta.html', 'alpha.html']));
  assertEqual(JSON.stringify(saved.sortOrders['/My Notes']), JSON.stringify(['second.html', 'inner.html']));
  assert(saved.sortOrder && saved.sortOrder._root, 'legacy data should be left in place');

  const names = await treeNames();
  // Listed items first in saved order; folders (unlisted) follow in name order
  assertEqual(JSON.stringify(names.slice(0, 3)), JSON.stringify(['gamma.txt', 'beta.html', 'alpha.html']));
});

test('removes stale temp files from an interrupted save, hides them meanwhile', async () => {
  await waitFor(() => !noteExists('.alpha.html.123.456.tmp'), { label: 'temp cleanup' });
  assert(!(await treeNames()).some(n => n.endsWith('.tmp')), 'temp file shown in the tree');
});

test('sidebar hides the .html extension but keeps others', async () => {
  const labels = await js(`Array.from(document.querySelectorAll('#folder-tree > .file .file-name')).map(e => e.textContent)`);
  assert(labels.includes('alpha') && labels.includes('gamma.txt'), `labels were ${JSON.stringify(labels)}`);
});

test('typing with no note open creates a note instead of losing the text', async () => {
  assertEqual(await js(`document.title`), 'NeatNote', 'expected no note open at start');
  await typeText('typed before any note existed');
  await waitFor(() => noteExists('Untitled.html'), { label: 'Untitled.html' });
  await waitFor(() => readNote('Untitled.html').includes('typed before any note existed'), { label: 'auto-save', timeout: 4000 });
  assert((await js(`document.title`)).startsWith('Untitled'), 'window title should follow the new note');
  assert((await treeNames()).includes('Untitled.html'), 'new note missing from the sidebar');
});

test('whitespace survives save and reopen (spaces, tabs, code indentation)', async () => {
  seed('ws.html',
    '<p>a  b   c\td</p><p>   leading</p>' +
    '<div class="ql-code-block-container" spellcheck="false">' +
    '<div class="ql-code-block">function f() {</div>' +
    '<div class="ql-code-block">    return 1;</div>' +
    '<div class="ql-code-block">\t\ttabbed</div>' +
    '<div class="ql-code-block">}</div></div>');
  await js(`window.dispatchEvent(new Event('focus'))`);
  await waitFor(async () => (await treeNames()).includes('ws.html'), { label: 'ws.html in tree' });
  await openNote('ws.html');

  const text = await editorText();
  assert(text.includes('a  b   c\td'), `inline spacing collapsed: ${JSON.stringify(text)}`);
  assert(text.includes('   leading'), 'leading spaces lost');
  assert(text.includes('    return 1;'), 'code indentation lost');
  assert(text.includes('\t\ttabbed'), 'tabs lost');

  // Edit, save, reopen: still intact, and the file on disk agrees
  await js(`(() => { const q = Quill.find(document.getElementById('editor')); q.setSelection(q.getLength() - 1, 0); })()`);
  await typeText('x  y');
  await saveNow();
  const onDisk = readNote('ws.html');
  assert(onDisk.includes('a  b   c\td') && onDisk.includes('    return 1;') && onDisk.includes('x  y'), `file lost whitespace: ${onDisk}`);

  await reload();
  const after = await editorText();
  assert(after.includes('a  b   c\td') && after.includes('    return 1;') && after.includes('x  y'), 'whitespace lost after reopening');
});

test('reopening restores the last open note and leaves the file byte-identical', async () => {
  assert((await js(`document.title`)).startsWith('ws'), 'last note was not restored');
  const before = readNote('ws.html');
  await sleep(1400); // longer than the auto-save delay: a load must not trigger a save
  assertEqual(readNote('ws.html'), before, 'loading a note rewrote it');
});

test('trailing blank lines are kept', async () => {
  seed('blank.html', '<p>a</p><p><br></p><p><br></p>');
  await js(`window.dispatchEvent(new Event('focus'))`);
  await waitFor(async () => (await treeNames()).includes('blank.html'), { label: 'blank.html in tree' });
  await openNote('blank.html');
  assertEqual(await editorText(), 'a\n\n\n');
});

test('plain text notes keep CRLF line endings and their final newline', async () => {
  await openNote('gamma.txt');
  assert(await js(`document.querySelector('.plain-text-badge').classList.contains('visible')`), 'plain text badge missing');
  await js(`Quill.find(document.getElementById('editor')).setSelection(0, 0)`);
  await typeText('X');
  await saveNow();
  assertEqual(readNote('gamma.txt'), 'Xline1\r\nline2\r\n');
});

test('plain text notes stay plain: list markers are kept, shortcuts and pasted formatting do nothing', async () => {
  seed('todo.txt', '');
  await js(`window.dispatchEvent(new Event('focus'))`);
  await waitFor(async () => (await treeNames()).includes('todo.txt'), { label: 'todo.txt in tree' });
  await openNote('todo.txt');

  // Typing "- " / "1. " must not be eaten by list auto-formatting
  await typeKeys('- milk\n1. eggs');
  await press('b', [MOD]);
  await typeKeys(' x');
  // Pasting rich content must not leave formatting or pictures behind
  await js(`(() => {
    const q = Quill.find(document.getElementById('editor'));
    q.updateContents([{ retain: q.getLength() - 1 }, { insert: ' pasted', attributes: { bold: true, link: 'https://example.com' } }, { insert: { image: 'data:image/png;base64,AAAA' } }], 'user');
  })()`);
  await saveNow();

  assertEqual(readNote('todo.txt'), '- milk\n1. eggs x pasted');
  const html = await editorHtml();
  assert(!/<(ol|ul|li|strong|a|img)\b/.test(html), `formatting leaked into a plain text note: ${html}`);
});

test('rich notes still auto-format lists and take keyboard formatting', async () => {
  seed('rich.html', '');
  await js(`window.dispatchEvent(new Event('focus'))`);
  await waitFor(async () => (await treeNames()).includes('rich.html'), { label: 'rich.html in tree' });
  await openNote('rich.html');
  await typeKeys('- item');
  await press('b', [MOD]);
  await typeKeys('B');
  const html = await editorHtml();
  assert(/<li data-list="bullet">/.test(html), `list auto-format stopped working: ${html}`);
  assert(/<strong>B<\/strong>/.test(html), `Ctrl+B stopped working: ${html}`);
  await saveNow();
});

test('clicking two notes quickly ends on the second, with the right one highlighted', async () => {
  await js(`(() => {
    const row = (name) => Array.from(document.querySelectorAll('#folder-tree .file')).find(r => r.dataset.name === name);
    row('ws.html').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    row('beta.html').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  })()`);
  await waitFor(`document.title.startsWith('beta')`, { label: 'second note to open' });
  await sleep(300);
  assert((await js(`document.title`)).startsWith('beta'), 'the first click overtook the second');
  assertEqual(await js(`Array.from(document.querySelectorAll('#folder-tree .file.active')).map(r => r.dataset.name).join(',')`), 'beta.html');
  assert((await editorText()).includes('beta'), 'editor shows a different note than the title');
});

test('a single click opens instantly; double-click renames without a second open', async () => {
  await click(rowSelector(notePath('alpha.html')));
  // No timer-based click handling: the note must be loading within one frame
  await waitFor(`document.title.startsWith('alpha')`, { timeout: 400, label: 'instant open' });

  await click(rowSelector(notePath('beta.html')), { count: 2 });
  await waitFor(modalOpen, { label: 'rename dialog' });
  assert((await js(`document.getElementById('modal-title').textContent`)).includes('Rename'), 'expected the rename dialog');
  assertEqual(await js(`document.getElementById('modal-input').value`), 'beta');
  await press('Escape');
  await waitFor(async () => !(await modalOpen()), { label: 'dialog closed' });
});

test('name dialog: Enter while composing with an IME does not submit', async () => {
  await press('n', [MOD]);
  await waitFor(modalOpen, { label: 'new note dialog' });
  await sleep(90);
  await js(`(() => {
    const input = document.getElementById('modal-input');
    input.focus();
    input.value = 'にほん';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);
  await sleep(150);
  assert(await modalOpen(), 'dialog was submitted by the IME commit key');
  assert(!noteExists('にほん.html'), 'note was created from half-composed text');

  // A normal Enter still confirms
  await js(`document.getElementById('modal-input').value = 'にほんご'`);
  await press('Enter');
  await waitFor(() => noteExists('にほんご.html'), { label: 'note created' });
  await waitFor(`document.title.startsWith('にほんご')`, { label: 'new note opened' });
});

test('context menu creates a note inside a folder', async () => {
  const folder = notePath('My Notes');
  await click(rowSelector(folder), { button: 'right' });
  await waitFor(`!!document.querySelector('.context-menu')`, { label: 'context menu' });
  const labels = await js(`Array.from(document.querySelectorAll('.context-menu-item .context-menu-label')).map(e => e.textContent)`);
  assert(labels.includes('New Note in Folder') && labels.includes('Move to Trash'), `menu was ${JSON.stringify(labels)}`);
  await js(`Array.from(document.querySelectorAll('.context-menu-item')).find(b => b.textContent.includes('New Note in Folder')).click()`);
  await fillModal('nested');
  await waitFor(() => noteExists('My Notes/nested.html'), { label: 'nested note' });
  await waitFor(`document.title.startsWith('nested')`, { label: 'nested note opened' });
  assert(await js(`document.querySelector(${JSON.stringify(rowSelector(folder))}).classList.contains('folder-open')`), 'folder should be expanded to show the new note');
});

test('renaming the open note keeps editing it under the new name', async () => {
  await typeText('nested body');
  const row = rowSelector(notePath('My Notes/nested.html'));
  await js(`document.querySelector(${JSON.stringify(row)}).focus()`);
  await press('F2');
  await fillModal('renamed');
  await waitFor(() => noteExists('My Notes/renamed.html'), { label: 'renamed file' });
  assert(!noteExists('My Notes/nested.html'), 'old name still exists (a stale save recreated it?)');
  assert(readNote('My Notes/renamed.html').includes('nested body'), 'pending edit was not flushed before the rename');
  await typeText(' more');
  await saveNow();
  assert(readNote('My Notes/renamed.html').includes('more'), 'edits after rename went elsewhere');
  assert(!noteExists('My Notes/nested.html'), 'old path was recreated by a later save');
});

test('keyboard: arrows move through the tree, Enter opens, Left/Right fold', async () => {
  const first = await js(`(() => { const r = document.querySelector('#folder-tree .file, #folder-tree .folder'); r.focus(); return r.dataset.path; })()`);
  await press('Down');
  const second = await js(`document.activeElement.dataset.path`);
  assert(second && second !== first, 'ArrowDown did not move focus');
  assertEqual(await js(`document.querySelectorAll('#folder-tree [tabindex="0"]').length`), 1, 'exactly one row should be the tab stop');

  const folder = rowSelector(notePath('日本語'));
  await js(`document.querySelector(${JSON.stringify(folder)}).focus()`);
  await press('Right');
  await waitFor(`document.querySelector(${JSON.stringify(folder)}).getAttribute('aria-expanded') === 'true'`, { label: 'folder to expand' });
  await sleep(260);
  await press('Right');
  assertEqual(await js(`document.activeElement.dataset.name`), 'メモ.html', 'Right should step into the open folder');
  await press('Enter');
  await waitFor(`document.title.startsWith('メモ')`, { label: 'note opened with Enter' });
});

test('custom order is per folder: non-ASCII names no longer share one key', async () => {
  seed('日本語/あ.html', '<p>a</p>');
  seed('中国語/乙.html', '<p>b</p>');
  await js(`window.dispatchEvent(new Event('focus'))`);
  const jp = notePath('日本語');
  await waitFor(`!!Array.from(document.querySelectorAll('#folder-tree .file')).find(r => r.dataset.name === 'あ.html')`, { label: 'new note listed' });

  await drag(path.join(jp, 'メモ.html'), path.join(jp, 'あ.html'), 'before');
  const orders = config().sortOrders;
  assertEqual(JSON.stringify(orders['/日本語']), JSON.stringify(['メモ.html', 'あ.html']));
  assert(!('/中国語' in orders), 'reordering one folder wrote an order for another');
  const shown = await js(`Array.from(document.querySelector(${JSON.stringify(rowSelector(jp))}).nextElementSibling.querySelectorAll('.file')).map(r => r.dataset.name)`);
  assertEqual(JSON.stringify(shown), JSON.stringify(['メモ.html', 'あ.html']));
});

test('drag and drop: dropping on itself is a no-op; below the list means top level', async () => {
  const before = JSON.stringify(await treeNames());
  await drag(notePath('alpha.html'), notePath('alpha.html'), 'after');
  assertEqual(JSON.stringify(await treeNames()), before, 'self-drop changed the order');

  // A nested note dropped in the empty space under the list goes to the root, last
  await drag(notePath('日本語/あ.html'), null, 'end');
  await waitFor(() => noteExists('あ.html'), { label: 'note moved to top level' });
  const names = await treeNames();
  assertEqual(names[names.length - 1], 'あ.html', 'should be the last top-level item');
});

test('drag and drop: moving the open note into a folder keeps it open and saving', async () => {
  await openNote('alpha.html');
  await typeText('moved-marker ');
  await drag(notePath('alpha.html'), notePath('My Notes'), 'into');
  await waitFor(() => noteExists('My Notes/alpha.html'), { label: 'moved file' });
  assert(!noteExists('alpha.html'), 'source still exists after the move');
  assert(readNote('My Notes/alpha.html').includes('moved-marker'), 'pending edit lost in the move');
  await typeText('after-move ');
  await saveNow();
  assert(readNote('My Notes/alpha.html').includes('after-move'), 'save after move went to the wrong place');
  assert(!noteExists('alpha.html'), 'a save recreated the note at its old location');
});

test('renaming a folder keeps the open note inside it attached and saving', async () => {
  await openNote('My Notes/second.html');
  await typeText('before-folder-rename ');
  const folder = rowSelector(notePath('My Notes'));
  await js(`document.querySelector(${JSON.stringify(folder)}).focus()`);
  await press('F2');
  await fillModal('Projects');
  await waitFor(() => noteExists('Projects/second.html'), { label: 'folder renamed' });
  assert(!noteExists('My Notes'), 'old folder still exists');
  assert(readNote('Projects/second.html').includes('before-folder-rename'), 'pending edit lost in folder rename');

  await typeText('after-folder-rename ');
  await saveNow();
  assert(readNote('Projects/second.html').includes('after-folder-rename'), 'save after folder rename went elsewhere');
  assert(!noteExists('My Notes'), 'a save recreated the old folder');

  // The folder's saved order and expanded state moved with it
  const orders = config().sortOrders;
  assert('/Projects' in orders && !('/My Notes' in orders), `orders not re-keyed: ${JSON.stringify(Object.keys(orders))}`);
  assert(await js(`document.querySelector(${JSON.stringify(rowSelector(notePath('Projects')))}).classList.contains('folder-open')`), 'renamed folder collapsed');

  // Put the name back for the tests that follow
  await js(`document.querySelector(${JSON.stringify(rowSelector(notePath('Projects')))}).focus()`);
  await press('F2');
  await fillModal('My Notes');
  await waitFor(() => noteExists('My Notes/second.html'), { label: 'folder renamed back' });
});

test('top-level reorder by drag is saved and survives a reload', async () => {
  const names = await treeNames();
  const first = names[0];
  const last = names[names.length - 1];
  await drag(notePath(last), notePath(first), 'before');
  const reordered = await treeNames();
  assertEqual(reordered[0], last, 'dragged item should now be first');
  assertEqual(reordered[1], first);
  assertEqual(config().sortOrders['/'][0], last, 'order not persisted');

  await reload();
  assertEqual((await treeNames())[0], last, 'order lost after reload');
});

test('expanded folders and the open note come back after a restart', async () => {
  await openNote('My Notes/inner.html');
  const folder = rowSelector(notePath('My Notes'));
  assert(await js(`document.querySelector(${JSON.stringify(folder)}).classList.contains('folder-open')`), 'folder should be open');

  await reload();
  await waitFor(`document.title.startsWith('inner')`, { label: 'last note restored' });
  await waitFor(`!!document.querySelector(${JSON.stringify(folder)}) && document.querySelector(${JSON.stringify(folder)}).classList.contains('folder-open')`, { label: 'folder still expanded' });
  assertEqual(await js(`Array.from(document.querySelectorAll('#folder-tree .file.active')).map(r => r.dataset.name).join(',')`), 'inner.html', 'restored note should be highlighted in the tree');
});

test('folders can be created at the top level and inside other folders', async () => {
  await press('n', [MOD, 'shift']);
  await fillModal('Top Folder');
  await waitFor(() => noteExists('Top Folder'), { label: 'top-level folder' });

  await click(rowSelector(notePath('Top Folder')), { button: 'right' });
  await waitFor(`!!document.querySelector('.context-menu')`, { label: 'context menu' });
  await js(`Array.from(document.querySelectorAll('.context-menu-item')).find(b => b.textContent.includes('New Folder in Folder')).click()`);
  await fillModal('Inner Folder');
  await waitFor(() => noteExists('Top Folder/Inner Folder'), { label: 'nested folder' });
  assert(await js(`!!Array.from(document.querySelectorAll('#folder-tree .folder')).find(r => r.dataset.name === 'Inner Folder')`), 'nested folder not shown');

  // A duplicate name re-prompts with the reason instead of failing silently
  await press('n', [MOD, 'shift']);
  await fillModal('Top Folder', { confirm: false });
  await press('Enter');
  await waitFor(`/already exists/i.test(document.getElementById('modal-title').textContent)`, { label: 're-prompt explaining the duplicate name' });
  assert(await modalOpen(), 'dialog should stay open for another try');
  await press('Escape');
  await waitFor(async () => !(await modalOpen()), { label: 'dialog closed' });
});

test('theme choice is applied, remembered, and painted before first render after reload', async () => {
  await click('#settings-icon');
  await waitFor(`document.getElementById('settings-overlay').classList.contains('show')`, { label: 'settings dialog' });
  await sleep(120);
  assertEqual(await js(`document.activeElement.id`), 'settings-close-btn', 'focus should move into the dialog');
  await click('.theme-option[data-theme="moss"]');
  assert(await js(`document.body.classList.contains('app-theme-moss')`), 'theme not applied');
  await press('Escape');
  await waitFor(`!document.getElementById('settings-overlay').classList.contains('show')`, { label: 'settings closed' });
  assertEqual(await js(`document.activeElement.id`), 'settings-icon', 'focus should return to the gear');
  assertEqual(config().themeBackground, '#181f1a');

  await reload();
  assert(await js(`document.body.classList.contains('app-theme-moss')`), 'theme not restored');
  assertEqual(await js(`JSON.parse(localStorage.getItem('neatnote-theme-palette'))['--bg-color']`), '#181f1a', 'palette for the pre-paint script missing');
  assertEqual(await js(`document.documentElement.style.getPropertyValue('--bg-color')`), '#181f1a');
});

test('word count follows the text', async () => {
  await openNote('beta.html');
  await js(`Quill.find(document.getElementById('editor')).setContents([{ insert: 'one two three\\n' }], 'user')`);
  await waitFor(`document.getElementById('word-count').textContent.startsWith('3 words')`, { label: 'word count', timeout: 2000 });
  assert((await js(`document.getElementById('word-count').textContent`)).includes('13 characters'));
  await saveNow();
});

test('search finds text inside notes and shows where it matched', async () => {
  await js(`(() => { const i = document.getElementById('search-input'); i.focus(); i.value = 'needle'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(`!!document.querySelector('#folder-tree .search-row')`, { label: 'search results' });
  const rows = await js(`Array.from(document.querySelectorAll('#folder-tree .search-row')).map(r => ({ name: r.dataset.name, detail: (r.querySelector('.search-row-detail') || {}).textContent || '', mark: (r.querySelector('mark') || {}).textContent || '' }))`);
  assertEqual(rows.length, 1, `expected one result, got ${JSON.stringify(rows)}`);
  assertEqual(rows[0].name, 'inner.html');
  assertEqual(rows[0].mark, 'needle');

  await click('#folder-tree .search-row');
  await waitFor(`document.title.startsWith('inner')`, { label: 'result opened' });

  // Escape clears the search and brings the tree back
  await js(`document.getElementById('search-input').focus()`);
  await press('Escape');
  await waitFor(`!document.querySelector('#folder-tree .search-row') && !!document.querySelector('#folder-tree > .folder')`, { label: 'tree restored' });
});

test('an edit made outside the app is picked up when the window regains focus', async () => {
  await openNote('beta.html');
  fs.writeFileSync(notePath('beta.html'), '<p>changed elsewhere</p>');
  await js(`window.dispatchEvent(new Event('focus'))`);
  await waitFor(async () => (await editorText()).includes('changed elsewhere'), { label: 'reload of the changed note' });
});

test('conflicting outside edit is preserved as a copy, never overwritten', async () => {
  await typeText('mine ');
  fs.writeFileSync(notePath('beta.html'), '<p>theirs</p>');
  await saveNow();
  assert(readNote('beta.html').includes('mine'), 'the editor version should be saved');
  const copies = fs.readdirSync(notesRoot).filter(n => /^beta \(conflict .*\)\.html$/.test(n));
  assertEqual(copies.length, 1, `expected one conflict copy, found ${JSON.stringify(copies)}`);
  assert(readNote(copies[0]).includes('theirs'), 'conflict copy should hold the outside version');
  await waitFor(async () => (await treeNames()).includes(copies[0]), { label: 'conflict copy in the sidebar' });

  // A normal follow-up save must not produce another copy
  await typeText('again ');
  await saveNow();
  assertEqual(fs.readdirSync(notesRoot).filter(n => /^beta \(conflict/.test(n)).length, 1, 'ordinary save created a second copy');
});

test('refreshing a long sidebar keeps the scroll position', async () => {
  for (let i = 1; i <= 60; i++) seed(`bulk/n${String(i).padStart(2, '0')}.html`, '<p>x</p>');
  await js(`window.dispatchEvent(new Event('focus'))`);
  await waitFor(async () => (await treeNames()).includes('bulk'), { label: 'bulk folder' });
  await click(rowSelector(notePath('bulk')));
  await waitFor(`document.querySelectorAll('#folder-tree .file').length >= 60`, { label: 'bulk contents' });
  await sleep(300);

  await js(`document.getElementById('folder-tree').scrollTop = 420`);
  const before = await js(`document.getElementById('folder-tree').scrollTop`);
  assert(before > 300, `sidebar did not scroll (scrollTop=${before})`);

  // Something changes on disk -> the tree re-renders
  seed('bulk/n99.html', '<p>new</p>');
  await js(`window.dispatchEvent(new Event('focus'))`);
  await waitFor(`!!Array.from(document.querySelectorAll('#folder-tree .file')).find(r => r.dataset.name === 'n99.html')`, { label: 're-render' });
  assertEqual(await js(`document.getElementById('folder-tree').scrollTop`), before, 'scroll position jumped on refresh');

  fs.rmSync(notePath('bulk'), { recursive: true });
  await js(`document.getElementById('folder-tree').scrollTop = 0; window.dispatchEvent(new Event('focus'))`);
  await waitFor(async () => !(await treeNames()).includes('bulk'), { label: 'bulk folder gone' });
});

test('a note deleted outside the app is closed, not left as a ghost', async () => {
  seed('doomed.html', '<p>bye</p>');
  await js(`window.dispatchEvent(new Event('focus'))`);
  await waitFor(async () => (await treeNames()).includes('doomed.html'), { label: 'doomed.html in tree' });
  await openNote('doomed.html');
  fs.rmSync(notePath('doomed.html'));
  await js(`window.dispatchEvent(new Event('focus'))`);
  await waitFor(`document.title === 'NeatNote'`, { label: 'note to close', timeout: 4000 });
  assert(!(await treeNames()).includes('doomed.html'), 'deleted note still listed');
  assert(!noteExists('doomed.html'), 'the note was recreated');
});

test('trashing a folder closes the open note inside it', async () => {
  await click(rowSelector(notePath('中国語')));
  await waitFor(`!!Array.from(document.querySelectorAll('#folder-tree .file')).find(r => r.dataset.name === '笔记.html')`, { label: 'folder contents' });
  await sleep(250);
  await openNote('中国語/笔记.html');

  await js(`document.querySelector(${JSON.stringify(rowSelector(notePath('中国語')))}).focus()`);
  await press('Delete');
  await confirmModal();
  await waitFor(() => !noteExists('中国語'), { label: 'folder trashed' });
  assertEqual(await js(`document.title`), 'NeatNote', 'a ghost note was left open');
  assertEqual(await editorText(), '\n', 'editor should be empty');
  assert(recorded.trashed.some(p => p.endsWith('中国語')), 'item was not sent to the OS trash');
  assert(!('/中国語' in config().sortOrders), 'saved order for the deleted folder should be gone');
});

test('links open in the browser only for web/mail addresses', async () => {
  await openNote('beta.html');
  await js(`(() => {
    const q = Quill.find(document.getElementById('editor'));
    q.setContents([{ insert: 'site', attributes: { link: 'https://example.com/page' } }, { insert: '\\n' }], 'user');
  })()`);
  recorded.external.length = 0;
  await js(`document.querySelector('#editor a').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }))`);
  await waitFor(() => recorded.external.length === 1, { label: 'link handed to the browser' });
  assertEqual(recorded.external[0], 'https://example.com/page');

  const windowsBefore = BrowserWindow.getAllWindows().length;
  const opened = await js(`(() => { const w = window.open('file:///etc/passwd'); return w === null; })()`);
  assert(opened, 'window.open should be denied');
  await js(`window.open('javascript:alert(1)'); window.open('smb://host/share'); 1`);
  await sleep(150);
  assertEqual(BrowserWindow.getAllWindows().length, windowsBefore, 'a child window was created');
  assertEqual(recorded.external.length, 1, 'a non-web URL reached the OS');

  // The page itself can never navigate away
  const url = wc.getURL();
  await js(`location.href = 'https://example.com/'; 1`);
  await sleep(250);
  assertEqual(wc.getURL(), url, 'the app window navigated away');
  await saveNow();
});

test('right-click in the editor offers spelling, link and clipboard actions only', async () => {
  const labelsOf = (template) => template.map(item => item.label || item.role || item.type);

  recorded.menus.length = 0;
  wc.emit('context-menu', {}, {
    isEditable: true,
    misspelledWord: 'teh',
    dictionarySuggestions: ['the', 'ten'],
    linkURL: 'https://example.com/x',
    selectionText: 'teh',
    editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true }
  });
  assertEqual(recorded.menus.length, 1, 'expected one menu');
  const full = labelsOf(recorded.menus[0]);
  for (const expected of ['the', 'ten', 'Add to Dictionary', 'Open Link', 'Copy Link Address', 'cut', 'copy', 'paste', 'selectAll']) {
    assert(full.includes(expected), `missing "${expected}" in ${JSON.stringify(full)}`);
  }

  // A link that is not a web/mail address gets no link actions
  recorded.menus.length = 0;
  wc.emit('context-menu', {}, { isEditable: false, linkURL: 'file:///etc/passwd', selectionText: 'word', dictionarySuggestions: [], editFlags: {} });
  assertEqual(JSON.stringify(labelsOf(recorded.menus[0])), JSON.stringify(['copy']));

  // Nothing useful to offer: no menu at all
  recorded.menus.length = 0;
  wc.emit('context-menu', {}, { isEditable: false, linkURL: '', selectionText: '', dictionarySuggestions: [], editFlags: {} });
  assertEqual(recorded.menus.length, 0, 'an empty menu was shown');
});

test('a format toggled in the empty editor does not create a note', async () => {
  const before = fs.readdirSync(notesRoot).length;
  // Close the open note by trashing it through the app, then click "bold"
  await openNote('blank.html');
  await js(`document.querySelector(${JSON.stringify(rowSelector(notePath('blank.html')))}).focus()`);
  await press('Delete');
  await confirmModal();
  await waitFor(() => !noteExists('blank.html'), { label: 'note trashed' });
  assertEqual(await js(`document.title`), 'NeatNote');
  await js(`document.querySelector('#editor .ql-editor').focus()`);
  await click('#editor-toolbar .ql-header[value="1"]');
  await sleep(600);
  assertEqual(fs.readdirSync(notesRoot).length, before - 1, 'a note was created for an empty editor');
  await click('#editor-toolbar .ql-header[value="1"]');
});

test('search treats runs of spaces like the text it searches', async () => {
  const result = await js(`window.api.searchNotes('  needle   in  ')`);
  assertEqual(JSON.stringify(result.results.map(r => r.name)), JSON.stringify(['inner.html']));
});

test('spell check works offline: bundled dictionary is used, nothing is downloaded', async () => {
  if (process.platform === 'darwin') return; // macOS uses the system spell checker

  const bundled = fs.readdirSync(path.join(APP_ROOT, 'vendor', 'dictionaries')).filter(n => n.endsWith('.bdic'));
  assert(bundled.length > 0, 'no bundled dictionaries found');
  const installed = fs.readdirSync(path.join(userData, 'Dictionaries'));
  for (const name of bundled) assert(installed.includes(name), `${name} was not installed`);

  const languages = electron.session.defaultSession.getSpellCheckerLanguages();
  await waitFor(() => spellEvents.length > 0, { label: 'spell check dictionary to load', timeout: 8000 });
  assert(!spellEvents.some(e => e.startsWith('download-success')), 'a dictionary was downloaded');
  if (languages.some(l => l.startsWith('en'))) {
    // If this fails after an Electron upgrade, the bundled .bdic files are
    // for an older version: see vendor/dictionaries/README.md
    assert(spellEvents.some(e => e.startsWith('initialized:en')),
      `bundled English dictionary was not accepted (events: ${JSON.stringify(spellEvents)})`);
    assert(!spellEvents.some(e => e.startsWith('download-begin:en')),
      `tried to download an English dictionary (events: ${JSON.stringify(spellEvents)})`);
  }
});

test('IPC rejects paths outside the notes folder', async () => {
  const outside = path.join(userData, 'config.json');
  const attempts = await js(`Promise.all([
    window.api.readFile(${JSON.stringify(outside)}),
    window.api.readFile(${JSON.stringify(path.join(notesRoot, '..', 'config.json'))}),
    window.api.saveFile(${JSON.stringify(path.join(notesRoot, '..', 'evil.html'))}, 'x'),
    window.api.deleteItem(${JSON.stringify(notesRoot)}),
    window.api.renameItem(${JSON.stringify(notesRoot)}, 'gone'),
    window.api.moveFile(${JSON.stringify(notePath('beta.html'))}, ${JSON.stringify(os.tmpdir())}),
    window.api.listFiles(${JSON.stringify(os.tmpdir())}),
    window.api.createFile('x', ${JSON.stringify(os.tmpdir())}),
    window.api.saveFile(${JSON.stringify(notePath('beta.html'))}, { not: 'a string' }),
    window.api.createFile('../escape', null),
    window.api.reorderItem(${JSON.stringify(os.tmpdir())}, 'a', 'b', 'before')
  ])`);
  attempts.forEach((result, index) => assertEqual(result.success, false, `attempt ${index} was allowed`));
  assert(!fs.existsSync(path.join(userData, 'evil.html')), 'a file was written outside the notes folder');
  assert(fs.existsSync(notesRoot) && noteExists('beta.html'), 'notes were damaged');
});

test('a binary file is refused instead of being opened (and later corrupted) as text', async () => {
  seed('image.bin', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x00]));
  const result = await js(`window.api.readFile(${JSON.stringify(notePath('image.bin'))})`);
  assertEqual(result.success, false);
  assert(/text note/.test(result.error), `unexpected error: ${result.error}`);
});

test('Markdown export writes the note to the chosen file', async () => {
  await openNote('beta.html');
  await js(`(() => {
    const q = Quill.find(document.getElementById('editor'));
    q.setContents([
      { insert: 'Heading' }, { insert: '\\n', attributes: { header: 1 } },
      { insert: 'Some ' }, { insert: 'bold', attributes: { bold: true } }, { insert: ' text\\n' },
      { insert: 'item' }, { insert: '\\n', attributes: { list: 'bullet' } }
    ], 'user');
  })()`);
  saveDialogTarget = path.join(exportDir, 'out.md');
  await click('#export-btn');
  await waitFor(() => fs.existsSync(saveDialogTarget), { label: 'exported file' });
  assertEqual(fs.readFileSync(saveDialogTarget, 'utf8'), '# Heading\n\nSome **bold** text\n\n- item\n');
  saveDialogTarget = null;
  await saveNow();
});

test('a failed save on close asks before discarding; "Go Back" keeps the window', async () => {
  await openNote('My Notes/second.html');
  await typeText('unsaved ');
  // Make the next save fail: swap the note for a directory of the same name
  fs.rmSync(notePath('My Notes/second.html'));
  fs.mkdirSync(notePath('My Notes/second.html'));

  recorded.syncDialogs.length = 0;
  syncDialogResponse = 0; // "Go Back"
  win.close();
  await waitFor(() => recorded.syncDialogs.length === 1, { label: 'unsaved-changes prompt' });
  await sleep(300);
  assert(!win.isDestroyed(), 'window closed even though the save failed and the user chose to go back');
  assert(/could not be saved/i.test(recorded.syncDialogs[0].message), 'unexpected dialog');
  assert((await editorText()).includes('unsaved'), 'the unsaved text should still be in the editor');

  // Put things right; the text is still there and now saves
  fs.rmdirSync(notePath('My Notes/second.html'));
  await saveNow();
  assert(readNote('My Notes/second.html').includes('unsaved'), 'text was not saved after recovery');
});

test('closing the window writes pending edits first', async () => {
  await openNote('beta.html');
  await typeText('last-second-edit ');
  recorded.syncDialogs.length = 0;
  win.close(); // well inside the 1s auto-save delay
  await waitFor(() => win.isDestroyed(), { label: 'window to close' });
  assert(readNote('beta.html').includes('last-second-edit'), 'edits typed just before closing were lost');
  assertEqual(recorded.syncDialogs.length, 0, 'no prompt expected when the save succeeds');
  const state = config().windowState;
  assert(state && state.width > 0 && state.height > 0, 'window size was not remembered');
});

// ---- Run -------------------------------------------------------------------------

// The app quits when its window closes; hold it open until the tests that
// run after the window is gone have finished
let finished = false;
app.on('will-quit', (event) => {
  if (!finished) event.preventDefault();
});

async function run() {
  require(path.join(APP_ROOT, 'src/main/main.js'));
  await app.whenReady();
  await waitForApp();
  await sleep(300);

  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ok    ${name}`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  ${name}\n      ${error.message}`);
    }
  }

  if (rendererErrors.length) {
    console.log(`\nRenderer console errors (${rendererErrors.length}):`);
    for (const message of [...new Set(rendererErrors)].slice(0, 20)) console.log('  ' + message);
  }

  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  finished = true;
  try {
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(exportDir, { recursive: true, force: true });
  } catch (error) {
    // Temp folders; the OS will clear them
  }
  app.exit(failed === 0 ? 0 : 1);
}

process.on('uncaughtException', (error) => {
  console.log('UNCAUGHT in main process:', error.stack);
  app.exit(1);
});

run().catch((error) => {
  console.log('Test run crashed:', error.stack);
  app.exit(1);
});
