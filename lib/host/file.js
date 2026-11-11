/**
 * `GET /api/dsh-workspace-ide.file` and `POST /api/dsh-workspace-ide.save`
 * — the code viewer's read/write pair.
 *
 * Reads are capped at 2 MiB with NUL-byte binary detection; writes only ever
 * replace an existing regular file inside the workspace, atomically through a
 * same-directory temp file plus rename, and never create new files or folders.
 *
 * @module dsh-workspace-ide/host/file
 */

import { lstat, open, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  HttpError,
  badRequest,
  describeError,
  okResponse,
  readJsonBody,
} from './respond.js';
import {
  mapFsError,
  normalizeRelativePath,
  resolveExistingTarget,
  resolveWorkspaceRoot,
} from './paths.js';

/** Bytes read from a file at most; larger files report `truncated`. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Maximum JSON request body size accepted by the save route. */
export const MAX_SAVE_BODY_BYTES = 4 * 1024 * 1024;

/** Extension → language chip shown by the viewer. Unknown extensions are `text`. */
const LANGUAGE_BY_EXTENSION = Object.freeze({
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.json': 'json',
  '.jsonc': 'json',
  '.json5': 'json',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'markdown',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',
  '.html': 'html',
  '.htm': 'html',
  '.xml': 'xml',
  '.svg': 'xml',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cc': 'cpp',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
  '.ps1': 'powershell',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.txt': 'text',
  '.log': 'text',
  '.csv': 'text',
  '.tsv': 'text',
  '.lock': 'text',
});

/**
 * Infer the language chip for a workspace-relative path.
 * @param {unknown} filePath - POSIX relative path (non-strings answer `text`).
 * @returns the language name, `text` when unknown.
 */
export function inferLanguage(filePath) {
  const extension = path.extname(typeof filePath === 'string' ? filePath : '').toLowerCase();
  const table = /** @type {Record<string, string>} */ (LANGUAGE_BY_EXTENSION);
  return Object.hasOwn(table, extension) ? table[extension] : 'text';
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
 * Read one workspace file for the viewer.
 * @param {WorkspaceRoot} workspace - validated `{ requestedRoot, realRoot }`.
 * @param {string} relativePath - normalized POSIX relative file path.
 * @returns the HTTP response.
 */
export async function readWorkspaceFile(workspace, relativePath) {
  const target = await resolveExistingTarget(workspace.realRoot, relativePath, 'file');
  let info;
  try {
    info = await stat(target);
  } catch (error) {
    throw mapFsError(error, 'file');
  }
  if (info.isDirectory()) throw badRequest('"path" is a directory; use the list route');
  if (!info.isFile()) throw badRequest('"path" is not a regular file');
  const truncated = info.size > MAX_FILE_BYTES;
  let bytes;
  try {
    bytes = await readRange(target, Math.min(info.size, MAX_FILE_BYTES));
  } catch (error) {
    throw mapFsError(error, 'file');
  }
  const binary = bytes.indexOf(0) !== -1;
  return okResponse({
    root: workspace.requestedRoot,
    path: relativePath,
    absolutePath: target,
    size: info.size,
    mtimeMs: info.mtimeMs,
    binary,
    truncated,
    content: binary ? null : bytes.toString('utf8'),
    language: inferLanguage(relativePath),
  });
}

/**
 * Overwrite one existing regular file atomically.
 * @param {WorkspaceRoot} workspace - validated `{ requestedRoot, realRoot }`.
 * @param {string} relativePath - normalized POSIX relative file path.
 * @param {string} content - new UTF-8 text content.
 * @returns the HTTP response.
 */
export async function saveWorkspaceFile(workspace, relativePath, content) {
  if (relativePath === '') throw badRequest('"path" must name a file');
  const byteLength = Buffer.byteLength(content, 'utf8');
  if (byteLength > MAX_SAVE_BODY_BYTES) throw badRequest('"content" exceeds the 4 MiB limit');
  // Rejects symlinked directories that escape the workspace before any write.
  await resolveExistingTarget(workspace.realRoot, relativePath, 'file');
  const lexical = path.join(workspace.realRoot, relativePath);
  let info;
  try {
    info = await lstat(lexical);
  } catch (error) {
    throw mapFsError(error, 'file');
  }
  if (info.isSymbolicLink()) throw badRequest('refusing to overwrite a symbolic link');
  if (!info.isFile()) throw badRequest('"path" is not a regular file');
  const directory = path.dirname(lexical);
  const temporary = path.join(
    directory,
    `.wsi-save-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: info.mode & 0o777, flag: 'wx' });
    await rename(temporary, lexical);
  } catch (error) {
    try {
      await unlink(temporary);
    } catch {
      // The temp file never existed or is already gone.
    }
    throw new HttpError(500, 'internal', `save failed: ${describeError(error)}`);
  }
  let saved;
  try {
    saved = await stat(lexical);
  } catch {
    saved = null;
  }
  return okResponse({
    path: relativePath,
    size: saved === null ? byteLength : saved.size,
    mtimeMs: saved === null ? Date.now() : saved.mtimeMs,
  });
}

/**
 * Handle the file route.
 * @param {HostContext} ctx - Host plugin context.
 * @param {Request} request - incoming GET request.
 * @returns the HTTP response.
 */
export async function handleFile(ctx, request) {
  const params = new URL(request.url).searchParams;
  const workspace = await resolveWorkspaceRoot(ctx, params.get('root'));
  const relativePath = normalizeRelativePath(params.get('path'));
  return readWorkspaceFile(workspace, relativePath);
}

/**
 * Handle the save route.
 * @param {HostContext} ctx - Host plugin context.
 * @param {Request} request - incoming POST request.
 * @returns the HTTP response.
 */
export async function handleSave(ctx, request) {
  const body = await readJsonBody(request, MAX_SAVE_BODY_BYTES);
  const relativePath = normalizeRelativePath(body.path);
  if (typeof body.content !== 'string') throw badRequest('"content" must be a string');
  const workspace = await resolveWorkspaceRoot(ctx, body.root);
  return saveWorkspaceFile(workspace, relativePath, body.content);
}
