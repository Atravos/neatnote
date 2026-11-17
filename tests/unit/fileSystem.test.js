/*
 * Behavioral tests for the main-process file layer.
 * Run with:  npm test   (plain Node — no Electron needed)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fileSystem = require('../../src/main/fileSystem.js');

// The OS trash isn't available under plain Node: stand in for it
const trashed = [];
fileSystem.setTrashImplementation(async (target) => {
  trashed.push(target);
  fs.rmSync(target, { recursive: true, force: true });
});

function makeUserData() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'neatnote-unit-'));
  const root = fileSystem.getNotesRoot(userData);
  fs.mkdirSync(root, { recursive: true });
  return { userData, root };
}

const read = (p) => fs.readFileSync(p, 'utf8');
const tempFilesIn = (dir) => fs.readdirSync(dir).filter(n => n.endsWith('.tmp'));

test('validateName accepts ordinary names and rejects dangerous ones', () => {
  for (const good of ['Notes', 'My Notes', '日本語', 'v1.2 plan', '  padded  ', '.hidden']) {
    assert.equal(fileSystem.validateName(good).valid, true, good);
  }
  assert.equal(fileSystem.validateName('  padded  ').name, 'padded');

  for (const bad of ['', '   ', '.', '..', 'a/b', 'a\\b', 'a:b', 'what?', 'CON', 'nul.txt', 'lpt1',
    'ends.', 'x'.repeat(201), 'tab\there', null, 42, undefined]) {
    assert.equal(fileSystem.validateName(bad).valid, false, String(bad));
  }
});

test('isInsideNotes: containment, traversal and symlink escapes', async () => {
  const { userData, root } = makeUserData();
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'sub', 'a.html'), '');

  assert.equal(await fileSystem.isInsideNotes(path.join(root, 'sub', 'a.html'), userData), true);
  assert.equal(await fileSystem.isInsideNotes(path.join(root, 'new', 'not-yet.html'), userData), true);
  assert.equal(await fileSystem.isInsideNotes(root, userData), true);
  assert.equal(await fileSystem.isInsideNotes(root, userData, false), false, 'root rejected when allowRoot=false');

  assert.equal(await fileSystem.isInsideNotes(userData, userData), false);
  assert.equal(await fileSystem.isInsideNotes(path.join(root, '..', 'config.json'), userData), false);
  assert.equal(await fileSystem.isInsideNotes(root + '-evil', userData), false, 'sibling with a shared prefix');
  assert.equal(await fileSystem.isInsideNotes(path.join(root, 'a\u0000b'), userData), false);
  for (const junk of ['', null, undefined, 7, {}, []]) {
    assert.equal(await fileSystem.isInsideNotes(junk, userData), false);
  }

  // A symlink inside the notes folder must not open a door out of it
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'neatnote-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  let linked = true;
  try {
    fs.symlinkSync(outside, path.join(root, 'link'), 'dir');
  } catch {
    linked = false; // symlinks need extra rights on some Windows setups
  }
  if (linked) {
    assert.equal(await fileSystem.isInsideNotes(path.join(root, 'link', 'secret.txt'), userData), false);
    assert.equal(await fileSystem.isInsideNotes(path.join(root, 'link', 'new.html'), userData), false);
    assert.equal(await fileSystem.isInsideNotes(path.join(root, 'link'), userData), false);
  }
});

test('createFile never overwrites, and can pick a free name', async () => {
  const { userData, root } = makeUserData();

  const first = await fileSystem.createFile('Idea', null, userData);
  assert.equal(first.success, true);
  assert.equal(first.path, path.join(root, 'Idea.html'));
  fs.writeFileSync(first.path, '<p>precious</p>');

  const dup = await fileSystem.createFile('Idea', null, userData);
  assert.equal(dup.success, false);
  assert.equal(read(first.path), '<p>precious</p>', 'existing note must be untouched');

  // Two creates racing for one name: exactly one wins
  const race = await Promise.all([
    fileSystem.createFile('Race', null, userData),
    fileSystem.createFile('Race', null, userData)
  ]);
  assert.equal(race.filter(r => r.success).length, 1);

  const a = await fileSystem.createFile('Untitled', null, userData, { unique: true });
  const b = await fileSystem.createFile('Untitled', null, userData, { unique: true });
  const c = await fileSystem.createFile('Untitled', null, userData, { unique: true });
  assert.deepEqual([a.path, b.path, c.path].map(p => path.basename(p)),
    ['Untitled.html', 'Untitled 2.html', 'Untitled 3.html']);

  assert.equal((await fileSystem.createFile('../escape', null, userData)).success, false);
});

test('a folder deleted outside the app is not brought back by listing or creating in it', async () => {
  const { userData, root } = makeUserData();
  const gone = path.join(root, 'Gone');

  const listing = await fileSystem.listFiles(gone, userData);
  assert.equal(listing.success, false);
  assert.equal(fs.existsSync(gone), false, 'listFiles recreated the folder');

  assert.equal((await fileSystem.createFile('n', gone, userData)).success, false);
  assert.equal((await fileSystem.createFolder('f', gone, userData)).success, false);
  assert.equal(fs.existsSync(gone), false, 'create recreated the folder');

  // ...while the notes root itself is still created on demand
  fs.rmSync(root, { recursive: true });
  assert.equal((await fileSystem.listFiles(null, userData)).success, true);
  assert.equal(fs.existsSync(root), true);
});

test('listFiles: natural order, hides temp and OS files, keeps user dot-files', async () => {
  const { userData, root } = makeUserData();
  for (const name of ['note10.html', 'note2.html', 'Note1.html', '.note2.html.9.9.tmp',
    'Thumbs.db', 'desktop.ini', '.DS_Store', '.mine.html']) {
    fs.writeFileSync(path.join(root, name), '');
  }
  fs.mkdirSync(path.join(root, 'Folder'));

  const result = await fileSystem.listFiles(null, userData);
  assert.deepEqual(result.files.map(f => f.name),
    ['.mine.html', 'Folder', 'Note1.html', 'note2.html', 'note10.html']);
  assert.equal(result.files.find(f => f.name === 'Folder').isDirectory, true);
});

test('saveFile is atomic, leaves no temp files, and validates its input', async () => {
  const { userData, root } = makeUserData();
  const file = path.join(root, 'a.html');

  assert.equal((await fileSystem.saveFile(file, '<p>one</p>')).success, true);
  assert.equal(read(file), '<p>one</p>');
  assert.equal((await fileSystem.saveFile(file, '')).success, true);
  assert.equal(read(file), '');
  assert.deepEqual(tempFilesIn(root), []);

  for (const bad of [null, undefined, 5, { a: 1 }, ['x']]) {
    assert.equal((await fileSystem.saveFile(file, bad)).success, false);
  }
  assert.equal(read(file), '', 'a rejected save must not change the file');

  const tooBig = 'x'.repeat(fileSystem.MAX_NOTE_BYTES + 1);
  assert.equal((await fileSystem.saveFile(file, tooBig)).success, false);

  fs.mkdirSync(path.join(root, 'dir.html'));
  assert.equal((await fileSystem.saveFile(path.join(root, 'dir.html'), 'x')).success, false);
  assert.equal(void userData, undefined);
});

test('concurrent saves to one note are applied in order', async () => {
  const { root } = makeUserData();
  const file = path.join(root, 'busy.html');
  const results = await Promise.all(
    Array.from({ length: 25 }, (_, i) => fileSystem.saveFile(file, `v${i}`))
  );
  assert.ok(results.every(r => r.success));
  assert.equal(read(file), 'v24');
  assert.equal(results.some(r => r.conflictCopy), false, 'our own writes are not conflicts');
  assert.deepEqual(fs.readdirSync(root), ['busy.html']);
});

test('an outside edit is kept as a conflict copy instead of being overwritten', async () => {
  const { root } = makeUserData();
  const file = path.join(root, 'shared.html');
  fs.writeFileSync(file, '<p>original</p>');

  assert.equal((await fileSystem.readFile(file)).content, '<p>original</p>');
  assert.deepEqual(await fileSystem.checkExternalChange(file), { success: true, exists: true, changed: false });

  fs.writeFileSync(file, '<p>theirs</p>');
  assert.equal((await fileSystem.checkExternalChange(file)).changed, true);

  const saved = await fileSystem.saveFile(file, '<p>mine</p>');
  assert.equal(saved.success, true);
  assert.ok(saved.conflictCopy, 'expected a conflict copy');
  assert.match(path.basename(saved.conflictCopy), /^shared \(conflict \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d\)\.html$/);
  assert.equal(read(saved.conflictCopy), '<p>theirs</p>');
  assert.equal(read(file), '<p>mine</p>');

  // The next ordinary save is not a conflict
  const again = await fileSystem.saveFile(file, '<p>mine 2</p>');
  assert.equal(again.conflictCopy, undefined);

  // An outside edit that happens to equal what we are saving loses nothing
  fs.writeFileSync(file, '<p>same</p>');
  const same = await fileSystem.saveFile(file, '<p>same</p>');
  assert.equal(same.success, true);
  assert.equal(same.conflictCopy, undefined);
});

test('saving a note whose file or folder vanished recreates it (the text is not lost)', async () => {
  const { root } = makeUserData();
  fs.mkdirSync(path.join(root, 'Folder'));
  const file = path.join(root, 'Folder', 'n.html');
  await fileSystem.saveFile(file, 'first');

  fs.rmSync(file);
  assert.deepEqual(await fileSystem.checkExternalChange(file), { success: true, exists: false, changed: true });
  assert.equal((await fileSystem.saveFile(file, 'second')).success, true);
  assert.equal(read(file), 'second');

  fs.rmSync(path.join(root, 'Folder'), { recursive: true });
  assert.equal((await fileSystem.saveFile(file, 'third')).success, true);
  assert.equal(read(file), 'third');
});

test('readFile refuses binaries, directories and oversized files', async () => {
  const { root } = makeUserData();

  const binary = path.join(root, 'photo.png');
  fs.writeFileSync(binary, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x00, 0x00]));
  const refused = await fileSystem.readFile(binary);
  assert.equal(refused.success, false);
  assert.match(refused.error, /text note/);

  fs.mkdirSync(path.join(root, 'dir'));
  assert.equal((await fileSystem.readFile(path.join(root, 'dir'))).success, false);

  const huge = path.join(root, 'huge.txt');
  fs.writeFileSync(huge, '');
  fs.truncateSync(huge, fileSystem.MAX_NOTE_BYTES + 1);
  const tooLarge = await fileSystem.readFile(huge);
  assert.equal(tooLarge.success, false);
  assert.match(tooLarge.error, /too large/);

  const missing = await fileSystem.readFile(path.join(root, 'nope.html'));
  assert.equal(missing.success, false);
  assert.equal(missing.code, 'ENOENT');

  const unicode = path.join(root, 'u.txt');
  fs.writeFileSync(unicode, 'héllo 日本語 \u{1F600}\r\n');
  assert.equal((await fileSystem.readFile(unicode)).content, 'héllo 日本語 \u{1F600}\r\n');
});

test('renameItem keeps the extension, refuses collisions, and follows the note', async () => {
  const { root } = makeUserData();
  const file = path.join(root, 'old.html');
  fs.writeFileSync(file, 'body');
  fs.writeFileSync(path.join(root, 'taken.html'), 'other');
  await fileSystem.readFile(file);

  assert.equal((await fileSystem.renameItem(file, 'taken')).success, false);
  assert.equal(read(path.join(root, 'taken.html')), 'other');
  assert.equal((await fileSystem.renameItem(file, 'bad/name')).success, false);
  assert.equal((await fileSystem.renameItem(path.join(root, 'ghost.html'), 'x')).success, false);

  const same = await fileSystem.renameItem(file, 'old');
  assert.equal(same.success, true);
  assert.equal(same.unchanged, true);

  const renamed = await fileSystem.renameItem(file, 'new name');
  assert.equal(renamed.success, true);
  assert.equal(renamed.isDirectory, false);
  assert.equal(renamed.newPath, path.join(root, 'new name.html'));
  assert.equal(fs.existsSync(file), false);

  // The revision travelled with the file: saving is not mistaken for a conflict
  const saved = await fileSystem.saveFile(renamed.newPath, 'body 2');
  assert.equal(saved.conflictCopy, undefined);

  // Case-only rename (only meaningful on case-insensitive filesystems)
  const probe = path.join(root, 'CaseProbe.txt');
  fs.writeFileSync(probe, '');
  if (fs.existsSync(path.join(root, 'caseprobe.txt'))) {
    const recased = await fileSystem.renameItem(renamed.newPath, 'New Name');
    assert.equal(recased.success, true, recased.error);
    assert.ok(fs.readdirSync(root).includes('New Name.html'));
  }

  fs.mkdirSync(path.join(root, 'Dir'));
  const dir = await fileSystem.renameItem(path.join(root, 'Dir'), 'Dir 2');
  assert.equal(dir.isDirectory, true);
  assert.equal(dir.newPath, path.join(root, 'Dir 2'));
});

test('moveFile moves notes and folders, never into themselves, never over another item', async () => {
  const { userData, root } = makeUserData();
  fs.mkdirSync(path.join(root, 'A', 'Inner'), { recursive: true });
  fs.mkdirSync(path.join(root, 'B'));
  fs.writeFileSync(path.join(root, 'n.html'), 'note');
  fs.writeFileSync(path.join(root, 'A', 'Inner', 'deep.html'), 'deep');
  fs.writeFileSync(path.join(root, 'B', 'n.html'), 'occupied');
  await fileSystem.readFile(path.join(root, 'A', 'Inner', 'deep.html'));

  assert.equal((await fileSystem.moveFile(path.join(root, 'A'), path.join(root, 'A', 'Inner'), userData)).success, false);
  assert.equal((await fileSystem.moveFile(path.join(root, 'A'), path.join(root, 'A'), userData)).success, false);
  assert.equal((await fileSystem.moveFile(path.join(root, 'n.html'), path.join(root, 'B'), userData)).success, false);
  assert.equal(read(path.join(root, 'B', 'n.html')), 'occupied');
  assert.equal((await fileSystem.moveFile(path.join(root, 'n.html'), path.join(root, 'Missing'), userData)).success, false);
  assert.equal(fs.existsSync(path.join(root, 'Missing')), false);

  const stay = await fileSystem.moveFile(path.join(root, 'n.html'), null, userData);
  assert.equal(stay.success, true);
  assert.equal(stay.unchanged, true);

  const moved = await fileSystem.moveFile(path.join(root, 'n.html'), path.join(root, 'A'), userData);
  assert.equal(moved.success, true);
  assert.equal(moved.newPath, path.join(root, 'A', 'n.html'));
  assert.equal(fs.existsSync(path.join(root, 'n.html')), false);
  assert.deepEqual(tempFilesIn(path.join(root, 'A')), []);

  const folder = await fileSystem.moveFile(path.join(root, 'A'), path.join(root, 'B'), userData);
  assert.equal(folder.success, true);
  assert.equal(folder.isDirectory, true);
  const deep = path.join(root, 'B', 'A', 'Inner', 'deep.html');
  assert.equal(read(deep), 'deep');

  // The tracked revision followed the folder move
  const saved = await fileSystem.saveFile(deep, 'deep 2');
  assert.equal(saved.conflictCopy, undefined);

  const back = await fileSystem.moveFile(path.join(root, 'B', 'A'), null, userData);
  assert.equal(back.newPath, path.join(root, 'A'));
});

test('deleteItem trashes the item; a save queued before it cannot resurrect the file', async () => {
  const { root } = makeUserData();
  const file = path.join(root, 'doomed.html');
  fs.writeFileSync(file, 'x');

  const [saved, deleted] = await Promise.all([
    fileSystem.saveFile(file, 'final words'),
    fileSystem.deleteItem(file)
  ]);
  assert.equal(saved.success, true);
  assert.equal(deleted.success, true);
  assert.equal(deleted.isDirectory, false);
  assert.equal(fs.existsSync(file), false, 'the file came back after being trashed');
  assert.ok(trashed.includes(file));
  assert.deepEqual(tempFilesIn(root), []);

  assert.equal((await fileSystem.deleteItem(file)).success, false);

  fs.mkdirSync(path.join(root, 'Dir'));
  assert.equal((await fileSystem.deleteItem(path.join(root, 'Dir'))).isDirectory, true);
});

test('whenIdle waits for in-flight writes and gives up after its timeout', async () => {
  const { root } = makeUserData();
  const file = path.join(root, 'slow.html');
  const pending = fileSystem.saveFile(file, 'content');
  await fileSystem.whenIdle(5000);
  assert.equal(read(file), 'content', 'whenIdle returned before the save finished');
  await pending;

  const started = Date.now();
  await fileSystem.whenIdle(50); // nothing pending: returns immediately
  assert.ok(Date.now() - started < 40);
});

test('searchNotes matches names and contents, strips markup, respects the limit', async () => {
  const { userData, root } = makeUserData();
  fs.mkdirSync(path.join(root, 'Recipes', 'Deep'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Chili.html'), '<h1>Chili</h1><p>Use <strong>black</strong>&nbsp;beans &amp; cumin.</p>');
  fs.writeFileSync(path.join(root, 'Recipes', 'Salmon bowl.html'), '<p>Salmon with rice</p><p>and black beans</p>');
  fs.writeFileSync(path.join(root, 'Recipes', 'Deep', 'plain.txt'), 'line one\r\nBLACK beans again');
  fs.writeFileSync(path.join(root, 'tags.html'), '<p class="black beans">nothing here</p><img src="data:image/png;base64,black beans">');
  fs.writeFileSync(path.join(root, 'photo.png'), Buffer.from([0, 1, 2]));

  const found = await fileSystem.searchNotes('Black Beans', userData);
  assert.equal(found.success, true);
  assert.deepEqual(found.results.map(r => r.name).sort(), ['Chili.html', 'Salmon bowl.html', 'plain.txt']);
  const chili = found.results.find(r => r.name === 'Chili.html');
  assert.match(chili.snippet, /black beans & cumin/, 'entities decoded, tags removed');
  assert.ok(!/</.test(chili.snippet));

  const byName = await fileSystem.searchNotes('recipes', userData);
  assert.deepEqual(byName.results.map(r => [r.name, r.isDirectory]), [['Recipes', true]]);

  // ".html" is hidden in the UI, so it must not make every note match
  assert.deepEqual((await fileSystem.searchNotes('html', userData)).results, []);
  assert.deepEqual((await fileSystem.searchNotes('   ', userData)).results, []);
  assert.deepEqual((await fileSystem.searchNotes(null, userData)).results, []);

  const limited = await fileSystem.searchNotes('black beans', userData, { limit: 2 });
  assert.equal(limited.results.length, 2);
  assert.equal(limited.truncated, true);
});

test('htmlToText keeps words on separate lines apart', () => {
  assert.equal(fileSystem.htmlToText('<p>one</p><p>two</p><ul><li>three</li></ul>'), 'one two three');
  assert.equal(fileSystem.htmlToText('a&lt;b&gt;c &#65;&#x42; &unknown; &amp;amp;'), 'a<b>c AB &unknown; &amp;');
});

test('cleanupTempFiles removes only old temp files of this app', async () => {
  const { userData, root } = makeUserData();
  fs.mkdirSync(path.join(root, 'Sub'));
  const old = path.join(root, 'Sub', '.note.html.4242.1700000000000.tmp');
  const fresh = path.join(root, '.note.html.4242.1700000000001.tmp');
  const userFile = path.join(root, '.my-own.tmp');
  const note = path.join(root, 'note.html');
  for (const f of [old, fresh, userFile, note]) fs.writeFileSync(f, 'x');
  const hourAgo = new Date(Date.now() - 3600 * 1000);
  fs.utimesSync(old, hourAgo, hourAgo);
  fs.utimesSync(userFile, hourAgo, hourAgo);

  assert.equal(await fileSystem.cleanupTempFiles(userData), 1);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true, 'a save in progress may still own a fresh temp file');
  assert.equal(fs.existsSync(userFile), true, 'not this app\'s naming pattern');
  assert.equal(fs.existsSync(note), true);
});
