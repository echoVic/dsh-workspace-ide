/**
 * Workspace file index for the client's quick-open palette.
 *
 * Walks the workspace once and returns the POSIX relative paths of regular
 * files (plus how many were left out) so `Cmd/Ctrl+P` can search the whole
 * project instead of only the lazily-expanded tree. `.git` is skipped; every
 * other directory is walked (node_modules included) up to the requested cap.
 *
 * @module dsh-workspace-ide/host/files
 */

import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkspaceRoot } from './paths.js';
import { okResponse, queryInt } from './respond.js';

/** Default number of paths returned by one index call. */
export const MAX_INDEX_FILES = 8000;
/** Hard cap for the `limit` query parameter. */
export const MAX_INDEX_FILES_CAP = 20000;
/** Directory names never walked (the tree filters the same markers). */
const SKIP_DIRECTORIES = new Set(['.git']);

/**
 * Recursively list regular files under one workspace root.
 * @param {string} realRoot - canonical workspace root.
 * @param {number} limit - maximum paths to collect.
 * @returns {Promise<{files: Array<string>, truncated: boolean}>} relative paths and the truncation flag.
 */
async function indexFiles(realRoot, limit) {
  /** @type {Array<string>} */
  const files = [];
  /** @type {Array<string>} */
  const stack = [''];
  let truncated = false;
  while (stack.length > 0) {
    if (files.length >= limit) {
      truncated = true;
      break;
    }
    const relativeDir = stack.pop();
    if (relativeDir === undefined) break;
    let dirents;
    try {
      dirents = await readdir(path.join(realRoot, relativeDir), { withFileTypes: true });
    } catch {
      // An unreadable directory is simply absent from the index.
      continue;
    }
    for (const dirent of dirents) {
      if (SKIP_DIRECTORIES.has(dirent.name)) continue;
      const relativePath = relativeDir === '' ? dirent.name : relativeDir + '/' + dirent.name;
      if (dirent.isDirectory()) {
        stack.push(relativePath);
        continue;
      }
      if (!dirent.isFile()) continue;
      files.push(relativePath);
      if (files.length >= limit) {
        truncated = true;
        break;
      }
    }
  }
  files.sort();
  return { files, truncated };
}

/**
 * Handle the files route: the workspace-relative file index for quick open.
 * @param {HostContext|undefined|null} ctx - Host plugin context.
 * @param {Request} request - incoming GET request with `root` and optional `limit`.
 * @returns {Promise<Response>} the HTTP response.
 */
export async function handleFiles(ctx, request) {
  const params = new URL(request.url).searchParams;
  const workspace = await resolveWorkspaceRoot(ctx, params.get('root'));
  const limit = queryInt(params, 'limit', MAX_INDEX_FILES, { min: 100, max: MAX_INDEX_FILES_CAP });
  const { files, truncated } = await indexFiles(workspace.realRoot, limit);
  return okResponse({ root: workspace.requestedRoot, files, truncated });
}
