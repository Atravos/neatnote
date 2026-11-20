/**
 * Photos in notes.
 *
 * Images are stored once, as ordinary files, in a hidden folder inside the
 * notes folder:
 *
 *     <notes>/.neatnote-images/<sha256-prefix>.<png|jpg|gif|webp>
 *
 * Notes refer to them with an app-only address,
 * `neatnote-image://local/<file>`, served by the protocol handler below.
 * Because the name is derived from the content, the same picture pasted
 * twice is stored once, and moving or renaming a note never breaks its
 * pictures.
 *
 * Only real image data is ever written (checked by its leading bytes, not
 * by a file name or a MIME type the renderer claims), and the protocol
 * handler serves nothing but files whose names match the pattern this
 * module creates — so neither side can be used to read or write anywhere
 * else on disk.
 */

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const SCHEME = 'neatnote-image';
const HOST = 'local';
const IMAGES_DIR_NAME = '.neatnote-images';
// Generous for photos straight off a phone camera
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const IMAGE_NAME = /^[0-9a-f]{32}\.(png|jpg|gif|webp)$/;

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
};

/**
 * Identify an image by its leading bytes.
 * @param {Buffer} buffer
 * @returns {string|null} File extension, or null if not a supported image
 */
function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/**
 * @param {string} notesRoot - The notes folder
 * @returns {string} The images folder inside it
 */
function imagesDir(notesRoot) {
  return path.join(notesRoot, IMAGES_DIR_NAME);
}

/**
 * The address a note uses for a stored image.
 * @param {string} fileName
 * @returns {string}
 */
function urlFor(fileName) {
  return `${SCHEME}://${HOST}/${fileName}`;
}

/**
 * The stored file name behind an image address, if it is one of ours.
 * @param {string} url
 * @returns {string|null}
 */
function fileNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== `${SCHEME}:` || parsed.hostname !== HOST) return null;
    const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    return IMAGE_NAME.test(name) ? name : null;
  } catch {
    return null;
  }
}

/**
 * Store image bytes and return the address to put in the note.
 * @param {Buffer} buffer - Image bytes
 * @param {string} notesRoot - The notes folder
 * @param {Function} writeFile - atomic (path, buffer) writer
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
async function saveImage(buffer, notesRoot, writeFile) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return { success: false, error: 'No image data' };
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { success: false, error: 'That image is larger than 25 MB' };
  }
  const ext = detectImageType(buffer);
  if (!ext) {
    return { success: false, error: 'Only PNG, JPEG, GIF and WebP images can be added' };
  }

  const name = `${crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 32)}.${ext}`;
  const dir = imagesDir(notesRoot);
  const target = path.join(dir, name);
  await fsp.mkdir(dir, { recursive: true });
  try {
    const stat = await fsp.stat(target);
    // Already stored (same content, same name) — nothing to write
    if (stat.isFile() && stat.size === buffer.length) return { success: true, url: urlFor(name) };
  } catch {
    // Not stored yet
  }
  await writeFile(target, buffer);
  return { success: true, url: urlFor(name) };
}

/**
 * Serve a stored image for the `neatnote-image://` protocol.
 * @param {string} url - Requested address
 * @param {string} notesRoot - The notes folder
 * @returns {Promise<Response>}
 */
async function serveImage(url, notesRoot) {
  const name = fileNameFromUrl(url);
  if (!name) return new Response('Not found', { status: 404 });
  try {
    const data = await fsp.readFile(path.join(imagesDir(notesRoot), name));
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': MIME_BY_EXT[name.split('.').pop()],
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

/**
 * Copy the images a note uses next to an exported Markdown file, into an
 * "images" folder, so the export is complete on its own.
 * @param {string[]} fileNames - Stored image names (from fileNameFromUrl)
 * @param {string} notesRoot - The notes folder
 * @param {string} exportDir - Folder the Markdown file was written to
 * @returns {Promise<number>} How many images were copied
 */
async function copyImagesForExport(fileNames, notesRoot, exportDir) {
  const names = [...new Set((fileNames || []).filter((name) => typeof name === 'string' && IMAGE_NAME.test(name)))];
  if (names.length === 0) return 0;
  const targetDir = path.join(exportDir, 'images');
  await fsp.mkdir(targetDir, { recursive: true });
  let copied = 0;
  for (const name of names) {
    try {
      await fsp.copyFile(path.join(imagesDir(notesRoot), name), path.join(targetDir, name));
      copied += 1;
    } catch (error) {
      console.error('Could not copy an image for export:', error.message);
    }
  }
  return copied;
}

module.exports = {
  SCHEME,
  IMAGES_DIR_NAME,
  MAX_IMAGE_BYTES,
  detectImageType,
  imagesDir,
  urlFor,
  fileNameFromUrl,
  saveImage,
  serveImage,
  copyImagesForExport
};
