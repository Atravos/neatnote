/*
 * Tests for pictures in notes (src/main/images.js).
 * Run with:  npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const images = require('../../src/main/images');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(24, 2)]);
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(24, 3)]);
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1'), Buffer.alloc(16, 4)]);
const writeFile = (file, data) => fs.promises.writeFile(file, data);
const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nn-images-'));

test('image types are recognised by their bytes, not their names', () => {
  assert.equal(images.detectImageType(PNG), 'png');
  assert.equal(images.detectImageType(JPG), 'jpg');
  assert.equal(images.detectImageType(GIF), 'gif');
  assert.equal(images.detectImageType(WEBP), 'webp');
  assert.equal(images.detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null, 'SVG (can hold script) is refused');
  assert.equal(images.detectImageType(Buffer.from('<html><script>alert(1)</script></html>')), null);
  assert.equal(images.detectImageType(Buffer.alloc(4)), null);
  assert.equal(images.detectImageType('not a buffer'), null);
});

test('only addresses this app creates map to a stored file', () => {
  const name = 'a'.repeat(32) + '.png';
  assert.equal(images.fileNameFromUrl(images.urlFor(name)), name);
  for (const bad of [
    'neatnote-image://local/../../etc/passwd',
    'neatnote-image://local/%2e%2e%2fsecret.png',
    'neatnote-image://local/' + 'a'.repeat(32) + '.svg',
    'neatnote-image://local/' + 'A'.repeat(32) + '.png',
    'neatnote-image://other/' + name,
    'file:///' + name,
    'https://example.com/' + name,
    'not a url'
  ]) {
    assert.equal(images.fileNameFromUrl(bad), null, bad);
  }
});

test('saving stores the picture once, by content, in the hidden images folder', async () => {
  const root = tempRoot();
  const first = await images.saveImage(PNG, root, writeFile);
  assert.equal(first.success, true);
  const name = images.fileNameFromUrl(first.url);
  assert.ok(name && name.endsWith('.png'));
  assert.deepEqual(fs.readFileSync(path.join(root, images.IMAGES_DIR_NAME, name)), PNG);

  let writes = 0;
  const again = await images.saveImage(PNG, root, async (f, d) => { writes += 1; await writeFile(f, d); });
  assert.equal(again.url, first.url, 'same picture, same address');
  assert.equal(writes, 0, 'the same picture is not written twice');

  const other = await images.saveImage(JPG, root, writeFile);
  assert.notEqual(other.url, first.url);
  assert.equal(fs.readdirSync(path.join(root, images.IMAGES_DIR_NAME)).length, 2);
});

test('saving refuses non-images, empty data and oversized files', async () => {
  const root = tempRoot();
  assert.equal((await images.saveImage(Buffer.from('<svg/>'.padEnd(40)), root, writeFile)).success, false);
  assert.equal((await images.saveImage(Buffer.alloc(0), root, writeFile)).success, false);
  const huge = Buffer.concat([PNG, Buffer.alloc(images.MAX_IMAGE_BYTES)]);
  const result = await images.saveImage(huge, root, writeFile);
  assert.equal(result.success, false);
  assert.match(result.error, /25 MB/);
  assert.equal(fs.existsSync(path.join(root, images.IMAGES_DIR_NAME)), false, 'nothing written for refused data');
});

test('serving returns stored pictures with the right type, and 404 for anything else', async () => {
  const root = tempRoot();
  const { url } = await images.saveImage(GIF, root, writeFile);
  const ok = await images.serveImage(url, root);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/gif');
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await ok.arrayBuffer()), GIF);

  fs.writeFileSync(path.join(root, 'secret.txt'), 'private');
  for (const bad of ['neatnote-image://local/../secret.txt', 'neatnote-image://local/' + 'b'.repeat(32) + '.png']) {
    assert.equal((await images.serveImage(bad, root)).status, 404, bad);
  }
});

test('export copies a note\'s pictures into an images folder next to the Markdown file', async () => {
  const root = tempRoot();
  const out = tempRoot();
  const a = images.fileNameFromUrl((await images.saveImage(PNG, root, writeFile)).url);
  const b = images.fileNameFromUrl((await images.saveImage(WEBP, root, writeFile)).url);
  const copied = await images.copyImagesForExport([a, b, a, '../evil.png', 'c'.repeat(32) + '.png'], root, out);
  assert.equal(copied, 2, 'duplicates, bad names and missing files are skipped');
  assert.deepEqual(fs.readdirSync(path.join(out, 'images')).sort(), [a, b].sort());
  assert.equal(await images.copyImagesForExport([], root, tempRoot()), 0);
});
