/**
 * `GET /api/dsh-workspace-ide.image` — binary image bytes for the viewer.
 *
 * The Files tab shows raster images (PNG/JPEG/GIF/WebP/BMP/ICO/AVIF) and SVGs
 * inside the panel. Code routes only carry UTF-8 text, so this route returns
 * the bytes base64-encoded together with a magic-byte verified MIME type. Reads
 * are capped at 8 MiB; anything larger is refused instead of silently
 * truncated (a truncated image is not renderable).
 *
 * @module dsh-workspace-ide/host/image
 */

import { open, stat } from 'node:fs/promises';
import path from 'node:path';

import { HttpError, badRequest, okResponse } from './respond.js';
import {
  mapFsError,
  normalizeRelativePath,
  resolveExistingTarget,
  resolveWorkspaceRoot,
} from './paths.js';

/** Largest image served to the viewer. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Extension → MIME type used to pre-select the renderer. */
const MIME_BY_EXTENSION = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jpe': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
});

/**
 * MIME type implied by a path's extension, or null for non-images.
 * @param {unknown} filePath - POSIX relative path (non-strings answer null).
 * @returns the candidate MIME type or null.
 */
export function inferImageMime(filePath) {
  const extension = path.extname(typeof filePath === 'string' ? filePath : '').toLowerCase();
  const table = /** @type {Record<string, string>} */ (MIME_BY_EXTENSION);
  return Object.hasOwn(table, extension) ? table[extension] : null;
}

/** @param {Buffer} bytes - leading file bytes.
 * @returns {boolean} true when the payload looks like SVG text.
 */
function looksLikeSvg(bytes) {
  const head = bytes.subarray(0, 2048).toString('utf8').replace(/^\uFEFF/, '').trimStart().toLowerCase();
  if (head.startsWith('<svg')) return true;
  return head.startsWith('<?xml') && head.indexOf('<svg') !== -1;
}

/**
 * Detect an image MIME type from the leading bytes. The extension only decides
 * whether a text payload may be an SVG; every binary format is identified by
 * its own signature so a renamed file can never smuggle arbitrary bytes into
 * the image viewer.
 * @param bytes - leading file bytes.
 * @param extensionMime - MIME type inferred from the extension (or null).
 * @returns the verified MIME type, or null when unsupported.
 */
/** @param {Buffer} bytes - leading file bytes.
 * @param {string|null} extensionMime - MIME type from the extension.
 * @returns {string|null} verified MIME type.
 */
export function sniffImageMime(bytes, extensionMime) {
  if (Buffer.isBuffer(bytes) === false) return null;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6) {
    const signature = bytes.subarray(0, 6).toString('latin1');
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'image/gif';
  }
  if (bytes.length >= 12) {
    if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    if (bytes.subarray(4, 8).toString('latin1') === 'ftyp' && bytes.subarray(8, 12).toString('latin1') === 'avif') return 'image/avif';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return 'image/x-icon';
  if (extensionMime === 'image/svg+xml' && looksLikeSvg(bytes)) return 'image/svg+xml';
  return null;
}

/**
 * Read up to `length` leading bytes from one regular file.
 * @param {string} absolutePath - canonical file path.
 * @param {number} length - byte count to read.
 * @returns the bytes read (shorter when the file shrinks mid-read).
 */
async function readRange(absolutePath, length) {
  if (length <= 0) return Buffer.alloc(0);
  const handle = await open(absolutePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(buffer, offset, length - offset, offset);
      if (bytesRead <= 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

/**
 * Read one workspace image for the viewer.
 * @param {WorkspaceRoot} workspace - validated `{ requestedRoot, realRoot }`.
 * @param {string} relativePath - normalized POSIX relative file path.
 * @returns the HTTP response with `mime`, `size`, `base64`.
 */
export async function readWorkspaceImage(workspace, relativePath) {
  const target = await resolveExistingTarget(workspace.realRoot, relativePath, 'image');
  let info;
  try {
    info = await stat(target);
  } catch (error) {
    throw mapFsError(error, 'image');
  }
  if (info.isDirectory()) throw badRequest('"path" is a directory; use the list route');
  if (!info.isFile()) throw badRequest('"path" is not a regular file');
  if (info.size > MAX_IMAGE_BYTES) {
    throw new HttpError(413, 'too-large', `image is larger than the ${MAX_IMAGE_BYTES} byte limit`);
  }
  let bytes;
  try {
    bytes = await readRange(target, info.size);
  } catch (error) {
    throw mapFsError(error, 'image');
  }
  const mime = sniffImageMime(bytes, inferImageMime(relativePath));
  if (mime === null) {
    throw new HttpError(415, 'unsupported-image', '"path" is not a supported image');
  }
  return okResponse({
    root: workspace.requestedRoot,
    path: relativePath,
    absolutePath: target,
    size: info.size,
    mtimeMs: info.mtimeMs,
    mime,
    base64: bytes.toString('base64'),
  });
}

/**
 * Handle the image route.
 * @param {HostContext} ctx - Host plugin context.
 * @param {Request} request - incoming GET request.
 * @returns the HTTP response.
 */
export async function handleImage(ctx, request) {
  const params = new URL(request.url).searchParams;
  const workspace = await resolveWorkspaceRoot(ctx, params.get('root'));
  const relativePath = normalizeRelativePath(params.get('path'));
  return readWorkspaceImage(workspace, relativePath);
}
