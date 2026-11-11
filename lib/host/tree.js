/**
 * `GET /api/dsh-workspace-ide.list` — one directory level of the workspace tree.
 *
 * `lstat` decides type/size/mtime so outside-pointing and broken symlinks are
 * never followed; a symlink whose real target stays inside the workspace is
 * reported as its target type (`dir` / `file`) so the tree can open it normally.
 * Entries are ordered directories-first, then case-insensitive name, and capped
 * so a hostile or gigantic directory cannot stall the Host.
 *
 * @module dsh-workspace-ide/host/tree
 */

import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';

import { badRequest, okResponse } from './respond.js';
import {
  joinRelative,
  mapFsError,
  normalizeRelativePath,
  resolveExistingTarget,
  resolveWorkspaceRoot,
} from './paths.js';

/** Maximum entries returned by one list call. */
export const MAX_LIST_ENTRIES = 4000;

/** How many `lstat` calls run at once while enriching entries. */
const LSTAT_CONCURRENCY = 32;

/**
 * Run `worker` over `items` with bounded concurrency, preserving order.
 * @param items - input list.
 * @param limit - maximum concurrent workers.
 * @param worker - async per-item worker.
 * @returns results in input order.
 */
async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Order dirents: directories first, then case-insensitive name, then raw name.
 * @param dirents - readdir entries.
 * @returns a new sorted array.
 */
function sortDirents(dirents) {
  return [...dirents].sort((left, right) => {
    const leftDir = left.isDirectory();
    const rightDir = right.isDirectory();
    if (leftDir !== rightDir) return leftDir ? -1 : 1;
    const leftName = left.name.toLowerCase();
    const rightName = right.name.toLowerCase();
    if (leftName !== rightName) return leftName < rightName ? -1 : 1;
    if (left.name === right.name) return 0;
    return left.name < right.name ? -1 : 1;
  });
}

/**
 * Map a stat/dirent pair onto the contracted entry type.
 * @param info - lstat result, or null when enrichment failed.
 * @param dirent - readdir entry.
 * @returns `dir` | `file` | `symlink` | `other`.
 */
function entryType(info, dirent) {
  if (info !== null) {
    if (info.isSymbolicLink()) return 'symlink';
    if (info.isDirectory()) return 'dir';
    if (info.isFile()) return 'file';
    return 'other';
  }
  if (dirent.isSymbolicLink()) return 'symlink';
  if (dirent.isDirectory()) return 'dir';
  if (dirent.isFile()) return 'file';
  return 'other';
}

/**
 * Resolve a symlink entry to the type it behaves as, but only when its real
 * target stays inside the workspace. Outside/broken/racy links stay `symlink`
 * (the tree renders them as files; the file route rejects them by realpath).
 *
 * @param realRoot - canonical workspace root.
 * @param absolutePath - the entry's absolute path.
 * @param entryInfo - lstat result (or null).
 * @param dirent - readdir entry.
 * @returns `dir` | `file` | `symlink` | `other`.
 */
async function effectiveEntryType(realRoot, absolutePath, entryInfo, dirent) {
  const type = entryType(entryInfo, dirent);
  if (type !== 'symlink') return type;
  try {
    const resolved = await realpath(absolutePath);
    if (resolved !== realRoot && !resolved.startsWith(realRoot + sep)) return 'symlink';
    const followed = await stat(absolutePath);
    if (followed.isDirectory()) return 'dir';
    if (followed.isFile()) return 'file';
  } catch (error) {
    /* broken symlink or racing delete: keep the link itself */
  }
  return 'symlink';
}

/**
 * List one workspace directory.
 * @param workspace - validated `{ requestedRoot, realRoot }`.
 * @param relativePath - normalized POSIX relative directory path.
 * @param options - `{ limit }` override for tests (never above the hard cap).
 * @returns the HTTP response.
 */
export async function listDirectory(workspace, relativePath, options = {}) {
  const requestedLimit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : MAX_LIST_ENTRIES;
  const limit = Math.min(requestedLimit, MAX_LIST_ENTRIES);
  const target = await resolveExistingTarget(workspace.realRoot, relativePath, 'directory');
  let info;
  try {
    info = await stat(target);
  } catch (error) {
    throw mapFsError(error, 'directory');
  }
  if (!info.isDirectory()) throw badRequest('"path" is not a directory');
  let dirents;
  try {
    dirents = await readdir(target, { withFileTypes: true });
  } catch (error) {
    throw mapFsError(error, `directory ${relativePath === '' ? '/' : relativePath}`);
  }
  const ordered = sortDirents(dirents);
  const truncated = ordered.length > limit;
  const selected = ordered.slice(0, limit);
  const absoluteDirectory = target;
  const entries = await mapLimit(selected, LSTAT_CONCURRENCY, async (dirent) => {
    const absolutePath = join(absoluteDirectory, dirent.name);
    /** @type {import('node:fs').Stats|null} */
    let entryInfo = null;
    try {
      entryInfo = await lstat(absolutePath);
    } catch {
      // A racing delete keeps a best-effort entry rather than failing the page.
      entryInfo = null;
    }
    return {
      name: dirent.name,
      path: joinRelative(relativePath, dirent.name),
      type: await effectiveEntryType(workspace.realRoot, absolutePath, entryInfo, dirent),
      size: entryInfo === null ? 0 : entryInfo.size,
      mtimeMs: entryInfo === null ? 0 : entryInfo.mtimeMs,
      hidden: dirent.name.startsWith('.'),
    };
  });
  return okResponse({ root: workspace.requestedRoot, path: relativePath, entries, truncated });
}

/**
 * Handle the list route.
 * @param {HostContext} ctx - Host plugin context.
 * @param request - incoming GET request.
 * @returns the HTTP response.
 */
export async function handleList(ctx, request) {
  const params = new URL(request.url).searchParams;
  const workspace = await resolveWorkspaceRoot(ctx, params.get('root'));
  const relativePath = normalizeRelativePath(params.get('path'));
  return listDirectory(workspace, relativePath);
}
