/**
 * Update checking — the pure parts (no Electron imports, so everything here
 * can be unit-tested with plain Node). The Electron side lives in
 * updater.js.
 *
 * How updates work:
 *   1. Ask GitHub for the latest published release of this repository.
 *   2. If its version is newer than the running one, offer it.
 *   3. Windows: download the installer from that release, check its size
 *      and SHA-256 against what GitHub reported, and run it.
 *      macOS/Linux: open the download page (macOS will only let an app
 *      replace itself if it is signed with an Apple Developer ID).
 *
 * Nothing about the user or their notes is ever sent. The only request is
 * a plain GET of public release information.
 */

const crypto = require('crypto');
const fs = require('fs');

const REPO = 'Atravos/neatnote';
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE_PREFIX = `https://github.com/${REPO}/releases/`;
const RELEASE_DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;
const DOWNLOAD_PAGE = 'https://theneatnote.com/thank-you.html';

// Generous ceiling; the real installer is ~120 MB
const MAX_INSTALLER_BYTES = 512 * 1024 * 1024;
const MAX_NOTES_CHARS = 20000;

// Where GitHub may redirect a release download
const DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
]);

const VERSION_PATTERN = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;
const SHA256_DIGEST_PATTERN = /^sha256:([0-9a-f]{64})$/i;

/**
 * Parse "1.2.3" or "v1.2.3". Pre-release suffixes ("1.2.0-beta") are not
 * accepted: those are never offered as updates.
 * @param {*} value
 * @returns {number[]|null} [major, minor, patch]
 */
function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compare two version strings.
 * @returns {number|null} 1 if a > b, -1 if a < b, 0 if equal, null if either is invalid
 */
function compareVersions(a, b) {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return null;
  for (let i = 0; i < 3; i++) {
    if (va[i] !== vb[i]) return va[i] > vb[i] ? 1 : -1;
  }
  return 0;
}

/**
 * Validate GitHub's "latest release" response and keep only what is used.
 * @param {*} json - Parsed response body
 * @returns {{version: string, tag: string, htmlUrl: string, notes: string, assets: Array}|null}
 *          null if the response is not a usable published release
 */
function parseRelease(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  if (json.draft === true || json.prerelease === true) return null;

  const tag = typeof json.tag_name === 'string' ? json.tag_name.trim() : '';
  const parsed = parseVersion(tag);
  if (!parsed) return null;

  const htmlUrl = typeof json.html_url === 'string' && json.html_url.startsWith(RELEASES_PAGE_PREFIX)
    ? json.html_url
    : `${RELEASES_PAGE_PREFIX}latest`;

  const assets = Array.isArray(json.assets)
    ? json.assets.filter((asset) => asset
        && typeof asset.name === 'string'
        && typeof asset.browser_download_url === 'string'
        && Number.isSafeInteger(asset.size))
      .map((asset) => ({
        name: asset.name,
        url: asset.browser_download_url,
        size: asset.size,
        digest: typeof asset.digest === 'string' ? asset.digest : null
      }))
    : [];

  return {
    version: parsed.join('.'),
    tag,
    htmlUrl,
    notes: typeof json.body === 'string' ? json.body.slice(0, MAX_NOTES_CHARS) : '',
    assets
  };
}

/**
 * Find the Windows installer in a release. Only a file named exactly like
 * the build produces it, served from this repository's own release
 * downloads, is accepted.
 * @param {Object} release - From parseRelease
 * @returns {{name: string, url: string, size: number, sha256: string|null}|null}
 */
function findWindowsInstaller(release) {
  if (!release || !Array.isArray(release.assets)) return null;
  const name = `NeatNote-Setup-${release.version}.exe`;
  const expectedUrl = `${RELEASE_DOWNLOAD_PREFIX}${encodeURIComponent(release.tag)}/${name}`;

  const asset = release.assets.find((candidate) => candidate.name === name);
  if (!asset || asset.url !== expectedUrl) return null;
  if (!(asset.size > 0 && asset.size <= MAX_INSTALLER_BYTES)) return null;

  const digest = asset.digest ? SHA256_DIGEST_PATTERN.exec(asset.digest) : null;
  return { name, url: asset.url, size: asset.size, sha256: digest ? digest[1].toLowerCase() : null };
}

/**
 * Turn Markdown release notes into a short plain-text summary for a
 * native dialog.
 * @param {string} markdown
 * @param {Object} [limits]
 * @returns {string}
 */
function summarizeNotes(markdown, { maxLines = 14, maxChars = 900 } = {}) {
  if (typeof markdown !== 'string' || markdown.trim() === '') return '';

  const lines = [];
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    let line = raw
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')          // images
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')       // links -> their text
      .replace(/^\s{0,3}#{1,6}\s+/, '')              // heading marks
      .replace(/^\s*[-*+]\s+/, '• ')                 // bullets
      .replace(/(\*\*|__|`)/g, '')                   // bold / code marks
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
      .trimEnd();
    // Collapse runs of blank lines into one
    if (line.trim() === '') {
      if (lines.length === 0 || lines[lines.length - 1] === '') continue;
      line = '';
    }
    lines.push(line);
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();

  let text = lines.slice(0, maxLines).join('\n');
  let cut = lines.length > maxLines;
  if (text.length > maxChars) {
    text = text.slice(0, maxChars);
    const lastBreak = text.lastIndexOf('\n');
    if (lastBreak > maxChars / 2) text = text.slice(0, lastBreak);
    cut = true;
  }
  return cut ? `${text.trimEnd()}\n…` : text;
}

/**
 * What "Update" does on this platform.
 * @param {string} platform - process.platform
 * @param {boolean} isPackaged - Running an installed build (not from source)
 * @returns {'install'|'open-page'}
 */
function updateActionFor(platform, isPackaged) {
  return platform === 'win32' && isPackaged ? 'install' : 'open-page';
}

/**
 * The page "Update" opens when the app cannot install the update itself.
 * Linux has no download on the website, so it gets the release page.
 */
function downloadPageFor(platform, release) {
  if (platform === 'linux') return (release && release.htmlUrl) || `${RELEASES_PAGE_PREFIX}latest`;
  return DOWNLOAD_PAGE;
}

function isAllowedDownloadUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && DOWNLOAD_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * SHA-256 of a file, or null if it cannot be read.
 * @param {string} filePath
 * @returns {Promise<string|null>}
 */
async function sha256OfFile(filePath) {
  try {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
    return hash.digest('hex');
  } catch {
    return null;
  }
}

/**
 * Whether a previously downloaded installer is still intact (same size and
 * checksum as the release reports), so it need not be downloaded again.
 * @param {string} filePath
 * @param {{size: number, sha256: string|null}} asset
 * @returns {Promise<boolean>}
 */
async function isVerifiedDownload(filePath, asset) {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size !== asset.size) return false;
  } catch {
    return false;
  }
  if (!asset.sha256) return true;
  return (await sha256OfFile(filePath)) === asset.sha256;
}

/**
 * Download a release file to disk, verifying it as it streams in.
 *
 * Written to "<destPath>.part" and renamed only once the size (and the
 * SHA-256, when GitHub provides one) match, so a half-finished or
 * tampered download is never left under the real name.
 *
 * @param {Object} options
 * @param {Function} options.fetchImpl - fetch(url, init) => Response
 * @param {string} options.url
 * @param {string} options.destPath
 * @param {number} options.size - Expected byte count
 * @param {string|null} options.sha256 - Expected hex digest, if known
 * @param {Function} [options.onProgress] - (received, total) => void
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<void>} Rejects with a user-readable Error on failure
 */
async function downloadVerified({ fetchImpl, url, destPath, size, sha256, onProgress, signal }) {
  if (!isAllowedDownloadUrl(url)) throw new Error('The download address is not a GitHub release.');

  const response = await fetchImpl(url, { redirect: 'follow', signal });
  if (!response || !response.ok) {
    throw new Error(`The download failed (${response ? response.status : 'no response'}).`);
  }
  if (response.url && !isAllowedDownloadUrl(response.url)) {
    throw new Error('The download was redirected somewhere unexpected.');
  }
  if (!response.body) throw new Error('The download was empty.');

  const partPath = `${destPath}.part`;
  const hash = crypto.createHash('sha256');
  let received = 0;
  const handle = await fs.promises.open(partPath, 'w');
  let ok = false;
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > size) throw new Error('The download is larger than expected.');
      hash.update(value);
      await handle.write(value);
      if (onProgress) onProgress(received, size);
    }
    if (received !== size) throw new Error('The download was incomplete.');
    if (sha256 && hash.digest('hex') !== sha256) {
      throw new Error('The downloaded file did not match its checksum.');
    }
    await handle.sync();
    ok = true;
  } finally {
    await handle.close().catch(() => {});
    if (!ok) await fs.promises.rm(partPath, { force: true }).catch(() => {});
  }
  await fs.promises.rename(partPath, destPath);
}

module.exports = {
  LATEST_RELEASE_API,
  DOWNLOAD_PAGE,
  RELEASES_PAGE_PREFIX,
  parseVersion,
  compareVersions,
  parseRelease,
  findWindowsInstaller,
  summarizeNotes,
  updateActionFor,
  downloadPageFor,
  isAllowedDownloadUrl,
  isVerifiedDownload,
  downloadVerified
};
