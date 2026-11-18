const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const updates = require('../../src/main/updates.js');
const { buildMenuTemplate } = require('../../src/main/menu.js');

const DL = 'https://github.com/Atravos/neatnote/releases/download';

function githubRelease(overrides = {}) {
  return {
    tag_name: 'v1.2.0',
    html_url: 'https://github.com/Atravos/neatnote/releases/tag/v1.2.0',
    draft: false,
    prerelease: false,
    body: 'New\n- Check for updates',
    assets: [
      { name: 'NeatNote-Setup-1.2.0.exe', size: 1000, digest: `sha256:${'a'.repeat(64)}`, browser_download_url: `${DL}/v1.2.0/NeatNote-Setup-1.2.0.exe` },
      { name: 'NeatNote-1.2.0-arm64.dmg', size: 2000, digest: null, browser_download_url: `${DL}/v1.2.0/NeatNote-1.2.0-arm64.dmg` }
    ],
    ...overrides
  };
}

test('versions are compared numerically, with or without a leading v', () => {
  assert.equal(updates.compareVersions('1.2.0', '1.1.0'), 1);
  assert.equal(updates.compareVersions('v1.1.0', '1.1.0'), 0);
  assert.equal(updates.compareVersions('1.1.0', '1.10.0'), -1);
  assert.equal(updates.compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(updates.compareVersions('1.0.10', '1.0.9'), 1);
  for (const bad of ['1.2', '1.2.0-beta', 'latest', '', null, undefined, 'v1.2.0.1', ' 1.2.0x']) {
    assert.equal(updates.compareVersions(bad, '1.0.0'), null, `accepted ${bad}`);
  }
});

test('only a published, non-prerelease release with a version tag is used', () => {
  const release = updates.parseRelease(githubRelease());
  assert.equal(release.version, '1.2.0');
  assert.equal(release.tag, 'v1.2.0');
  assert.equal(release.assets.length, 2);

  assert.equal(updates.parseRelease(githubRelease({ draft: true })), null);
  assert.equal(updates.parseRelease(githubRelease({ prerelease: true })), null);
  assert.equal(updates.parseRelease(githubRelease({ tag_name: 'nightly' })), null);
  assert.equal(updates.parseRelease(null), null);
  assert.equal(updates.parseRelease([]), null);
  assert.equal(updates.parseRelease('v1.2.0'), null);

  // A release page somewhere else is never used
  const odd = updates.parseRelease(githubRelease({ html_url: 'https://evil.example/release' }));
  assert.equal(odd.htmlUrl, 'https://github.com/Atravos/neatnote/releases/latest');
});

test('the Windows installer must be the exact file from this repository', () => {
  const installer = updates.findWindowsInstaller(updates.parseRelease(githubRelease()));
  assert.deepEqual(installer, {
    name: 'NeatNote-Setup-1.2.0.exe',
    url: `${DL}/v1.2.0/NeatNote-Setup-1.2.0.exe`,
    size: 1000,
    sha256: 'a'.repeat(64)
  });

  const withAsset = (asset) => updates.findWindowsInstaller(updates.parseRelease(githubRelease({ assets: [asset] })));
  const good = githubRelease().assets[0];
  assert.equal(withAsset({ ...good, browser_download_url: 'https://evil.example/NeatNote-Setup-1.2.0.exe' }), null);
  assert.equal(withAsset({ ...good, browser_download_url: 'https://github.com/someone/else/releases/download/v1.2.0/NeatNote-Setup-1.2.0.exe' }), null);
  assert.equal(withAsset({ ...good, name: 'NeatNote-Setup-1.1.0.exe' }), null, 'installer for another version');
  assert.equal(withAsset({ ...good, size: 0 }), null);
  assert.equal(withAsset({ ...good, size: 10 * 1024 * 1024 * 1024 }), null);
  assert.equal(withAsset({ ...good, digest: 'md5:abc' }).sha256, null, 'unknown digest is ignored, not trusted');
  assert.equal(updates.findWindowsInstaller(updates.parseRelease(githubRelease({ assets: [] }))), null);
});

test('only Windows installs builds itself; elsewhere the download page opens', () => {
  assert.equal(updates.updateActionFor('win32', true), 'install');
  assert.equal(updates.updateActionFor('win32', false), 'open-page', 'never from source');
  assert.equal(updates.updateActionFor('darwin', true), 'open-page');
  assert.equal(updates.updateActionFor('linux', true), 'open-page');

  const release = updates.parseRelease(githubRelease());
  assert.equal(updates.downloadPageFor('darwin', release), 'https://theneatnote.com/thank-you.html');
  assert.equal(updates.downloadPageFor('win32', release), 'https://theneatnote.com/thank-you.html');
  assert.equal(updates.downloadPageFor('linux', release), release.htmlUrl);
});

test('release notes become a short plain-text summary', () => {
  const summary = updates.summarizeNotes(
    '## New\r\n- **Bold** item with [a link](https://x.y)\n\n\n\n- `code` item\n![img](https://x.y/a.png)\n# Fixes'
  );
  assert.equal(summary, 'New\n• Bold item with a link\n\n• code item\n\nFixes');

  const long = Array.from({ length: 40 }, (_, i) => `- item ${i}`).join('\n');
  const cut = updates.summarizeNotes(long);
  assert.equal(cut.split('\n').length, 15);
  assert.ok(cut.endsWith('…'));
  assert.equal(updates.summarizeNotes(''), '');
  assert.equal(updates.summarizeNotes(undefined), '');
});

// ---- Downloading ---------------------------------------------------------------

function fakeResponse(bytes, { status = 200, url = `${DL}/v1.2.0/x.exe`, chunk = 7 } = {}) {
  let offset = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    body: {
      getReader: () => ({
        read: async () => {
          if (offset >= bytes.length) return { done: true, value: undefined };
          const value = bytes.subarray(offset, offset + chunk);
          offset += chunk;
          return { done: false, value };
        }
      })
    }
  };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'neatnote-updates-'));
}

test('a download is verified before it gets its real name', async () => {
  const dir = tempDir();
  const bytes = crypto.randomBytes(100);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const dest = path.join(dir, 'NeatNote-Setup-1.2.0.exe');
  const progress = [];

  await updates.downloadVerified({
    fetchImpl: async () => fakeResponse(bytes),
    url: `${DL}/v1.2.0/NeatNote-Setup-1.2.0.exe`,
    destPath: dest,
    size: bytes.length,
    sha256,
    onProgress: (received) => progress.push(received)
  });

  assert.deepEqual(fs.readFileSync(dest), bytes);
  assert.equal(progress[progress.length - 1], 100);
  assert.equal(fs.existsSync(`${dest}.part`), false);
  assert.equal(await updates.isVerifiedDownload(dest, { size: 100, sha256 }), true);
  assert.equal(await updates.isVerifiedDownload(dest, { size: 100, sha256: 'b'.repeat(64) }), false);
  assert.equal(await updates.isVerifiedDownload(dest, { size: 99, sha256: null }), false);
  assert.equal(await updates.isVerifiedDownload(path.join(dir, 'missing.exe'), { size: 100, sha256: null }), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a bad download never leaves a file behind', async () => {
  const dir = tempDir();
  const dest = path.join(dir, 'NeatNote-Setup-1.2.0.exe');
  const bytes = crypto.randomBytes(50);
  const url = `${DL}/v1.2.0/NeatNote-Setup-1.2.0.exe`;
  const attempt = (response, overrides = {}) => updates.downloadVerified({
    fetchImpl: async () => response, url, destPath: dest, size: 50, sha256: null, ...overrides
  });

  await assert.rejects(attempt(fakeResponse(bytes), { sha256: 'c'.repeat(64) }), /checksum/);
  await assert.rejects(attempt(fakeResponse(bytes.subarray(0, 40))), /incomplete/);
  await assert.rejects(attempt(fakeResponse(Buffer.concat([bytes, bytes]))), /larger/);
  await assert.rejects(attempt(fakeResponse(bytes, { status: 404 })), /failed \(404\)/);
  await assert.rejects(attempt(fakeResponse(bytes, { url: 'https://evil.example/x.exe' })), /redirected/);
  await assert.rejects(attempt(fakeResponse(bytes), { url: 'https://evil.example/x.exe' }), /not a GitHub release/);
  await assert.rejects(attempt(fakeResponse(bytes), { url: `http://github.com/x.exe` }), /not a GitHub release/);

  assert.deepEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GitHub release download hosts are the only ones allowed', () => {
  assert.equal(updates.isAllowedDownloadUrl(`${DL}/v1.2.0/a.exe`), true);
  assert.equal(updates.isAllowedDownloadUrl('https://objects.githubusercontent.com/x'), true);
  assert.equal(updates.isAllowedDownloadUrl('https://release-assets.githubusercontent.com/x'), true);
  assert.equal(updates.isAllowedDownloadUrl('https://github.com.evil.example/x'), false);
  assert.equal(updates.isAllowedDownloadUrl('http://github.com/x'), false);
  assert.equal(updates.isAllowedDownloadUrl('not a url'), false);
});

test('macOS app menu has Check for Updates when a handler is given', () => {
  let checked = 0;
  const template = buildMenuTemplate({ isMac: true, isDev: false, sendAction() {}, checkForUpdates: () => { checked++; } });
  const appMenu = template[0];
  const item = appMenu.submenu.find((entry) => entry.label === 'Check for Updates…');
  assert.ok(item, 'Check for Updates… missing');
  item.click();
  assert.equal(checked, 1);
  for (const role of ['about', 'hide', 'quit']) {
    assert.ok(appMenu.submenu.some((entry) => entry.role === role), `${role} missing from app menu`);
  }

  const windows = buildMenuTemplate({ isMac: false, isDev: false, sendAction() {}, checkForUpdates() {} });
  assert.equal(JSON.stringify(windows).includes('Check for Updates'), false, 'no hidden menu item on Windows');
});
