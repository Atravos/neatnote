/**
 * Pure security helpers for the main process (no Electron imports, so they
 * can be unit-tested with plain Node).
 */

const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);
const MAX_EXTERNAL_URL_LENGTH = 2048;

/**
 * Normalize a URL that is about to be handed to the operating system, or
 * reject it.
 *
 * Notes are HTML files, so a link in a note is untrusted input. Passing an
 * arbitrary URL to the OS can launch any registered handler (file:, smb:,
 * ms-msdt:, custom app schemes, ...). Only ordinary web and mail links are
 * ever allowed through.
 * @param {*} url - Candidate URL
 * @returns {string|null} The normalized URL, or null if it must not be opened
 */
function toSafeExternalUrl(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_EXTERNAL_URL_LENGTH) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol)) return null;
  // http(s) links must actually point at a host
  if (parsed.protocol !== 'mailto:' && !parsed.hostname) return null;
  return parsed.href;
}

module.exports = { toSafeExternalUrl };
