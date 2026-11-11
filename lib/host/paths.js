/**
 * Workspace root and inside-root path safety for every workspace-ide route.
 *
 * Two layers of defence:
 *
 * 1. lexical — the request `path` must be a POSIX relative path; absolute
 *    spellings and `..` escapes are rejected before touching the filesystem;
 * 2. canonical — when a root or path is resolved, `fs.realpath` is compared
 *    against the real workspace root, so a symlink inside the workspace that
 *    points outside it is rejected as `outside-workspace`.
 *
 * @module dsh-workspace-ide/host/paths
 */

import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  HttpError,
  badRequest,
  describeError,
  notFound,
  outsideWorkspace,
} from './respond.js';

/** A Windows drive/UNC absolute spelling; rejected on every platform. */
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;

/**
 * Look up one optional Host service without letting a missing service throw.
 * @param {HostContext|undefined|null} ctx - Host plugin context.
 * @param {string} name - service key.
 * @returns the service, or undefined.
 */
export function optionalService(ctx, name) {
  try {
    return ctx !== null && ctx !== undefined && typeof ctx.get === 'function' ? ctx.get(name) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Normalize a structural filesystem failure into its contracted HTTP failure.
 * @param {unknown} error - thrown filesystem error.
 * @param {string} label - what was being accessed, for the message.
 * @returns the throwable failure.
 */
export function mapFsError(error, label = 'path') {
  const failure = /** @type {any} */ (error);
  const code = failure !== null && typeof failure === 'object' ? failure.code : undefined;
  if (code === 'ENOENT' || code === 'ENOTDIR') return notFound(`${label} does not exist`);
  return new HttpError(500, 'internal', describeError(error));
}

/**
 * Validate the workspace directory canonical path against the live registry.
 *
 * A missing registry degrades to "any existing absolute directory". An
 * available registry only admits roots whose canonical path equals one of its
 * workspaces (also canonicalized). A registry that throws is treated as
 * unavailable, so a Host bug cannot brick every route.
 *
 * @param {HostContext|undefined|null} ctx - Host plugin context.
 * @param {string} realRoot - canonical workspace root.
 * @returns nothing; throws `outside-workspace` when the root is not known.
 */
async function assertKnownWorkspace(ctx, realRoot) {
  const registry = optionalService(ctx, 'workspaceRegistry');
  if (registry === undefined || registry === null || typeof registry.list !== 'function') return;
  let listed;
  try {
    listed = registry.list();
  } catch {
    return;
  }
  if (!Array.isArray(listed)) return;
  const known = [];
  for (const workspace of listed) {
    const workspacePath = workspace !== null && typeof workspace === 'object' && typeof workspace.path === 'string'
      ? workspace.path
      : undefined;
    if (workspacePath === undefined || workspacePath === '' || !path.isAbsolute(workspacePath)) continue;
    try {
      known.push(await realpath(workspacePath));
    } catch {
      // A registered workspace whose directory vanished is simply not a match.
    }
  }
  if (!known.includes(realRoot)) throw outsideWorkspace('root is not a registered workspace');
}

/**
 * Resolve and validate the `root` parameter shared by the list/file/search/git/save routes.
 *
 * @param {HostContext|undefined|null} ctx - Host plugin context (for the optional workspace registry).
 * @param {unknown} rawRoot - raw request value.
 * @returns `{ requestedRoot, realRoot }`.
 */
export async function resolveWorkspaceRoot(ctx, rawRoot) {
  if (typeof rawRoot !== 'string' || rawRoot.trim() === '') {
    throw badRequest('missing required parameter "root"');
  }
  const requestedRoot = rawRoot.trim();
  if (requestedRoot.includes('\0')) throw badRequest('"root" contains a NUL byte');
  if (!path.isAbsolute(requestedRoot) || WINDOWS_ABSOLUTE.test(requestedRoot) || requestedRoot.startsWith('\\\\')) {
    throw badRequest('"root" must be an absolute directory path');
  }
  let realRoot;
  try {
    realRoot = await realpath(requestedRoot);
  } catch (error) {
    const failure = /** @type {any} */ (error);
    if (failure !== null && failure !== undefined && (failure.code === 'ENOENT' || failure.code === 'ENOTDIR')) {
      throw notFound(`workspace root does not exist: ${requestedRoot}`);
    }
    throw new HttpError(500, 'internal', describeError(error));
  }
  let info;
  try {
    info = await stat(realRoot);
  } catch (error) {
    throw mapFsError(error, 'workspace root');
  }
  if (!info.isDirectory()) throw badRequest('"root" is not a directory');
  await assertKnownWorkspace(ctx, realRoot);
  return { requestedRoot, realRoot };
}

/**
 * Normalize one relative workspace path.
 *
 * @param {unknown} rawPath - raw request value; absent means the root itself ("").
 * @returns the POSIX relative path ("" for the root).
 */
export function normalizeRelativePath(rawPath) {
  if (rawPath === null || rawPath === undefined) return '';
  if (typeof rawPath !== 'string') throw badRequest('"path" must be a string');
  if (rawPath.includes('\0')) throw badRequest('"path" contains a NUL byte');
  if (rawPath === '') return '';
  if (path.posix.isAbsolute(rawPath) || rawPath.startsWith('/') || WINDOWS_ABSOLUTE.test(rawPath) || rawPath.startsWith('\\')) {
    throw outsideWorkspace('absolute paths are not allowed inside the workspace');
  }
  const normalized = path.posix.normalize(rawPath);
  if (normalized === '.') return '';
  if (normalized === '..' || normalized.startsWith('../')) {
    throw outsideWorkspace('path escapes the workspace root');
  }
  return normalized;
}

/**
 * Reject a canonical target outside the canonical root.
 * @param {string} realRoot - canonical workspace root.
 * @param {string} realTarget - canonical target path.
 * @param {string} label - what was resolved, for the message.
 */
function assertInsideRoot(realRoot, realTarget, label) {
  if (realTarget === realRoot) return;
  const prefix = realRoot.endsWith(path.sep) ? realRoot : `${realRoot}${path.sep}`;
  if (!realTarget.startsWith(prefix)) {
    throw outsideWorkspace(`${label} resolves outside the workspace root`);
  }
}

/**
 * Resolve an existing path inside the workspace and prove its canonical
 * location is still inside the workspace.
 *
 * @param {string} realRoot - canonical workspace root.
 * @param {string} relativePath - normalized POSIX relative path ("" = root).
 * @param {string} label - what is being resolved, for error messages.
 * @returns the canonical absolute target path.
 */
export async function resolveExistingTarget(realRoot, relativePath, label = 'path') {
  const lexical = relativePath === '' ? realRoot : path.join(realRoot, relativePath);
  assertInsideRoot(realRoot, path.resolve(lexical), label);
  let realTarget;
  try {
    realTarget = await realpath(lexical);
  } catch (error) {
    const failure = /** @type {any} */ (error);
    if (failure !== null && failure !== undefined && (failure.code === 'ENOENT' || failure.code === 'ENOTDIR')) {
      throw notFound(`${label} does not exist: ${relativePath === '' ? '/' : relativePath}`);
    }
    throw new HttpError(500, 'internal', describeError(error));
  }
  assertInsideRoot(realRoot, realTarget, label);
  return realTarget;
}

/**
 * Convert an absolute path into a POSIX path relative to the workspace root.
 * @param {string} realRoot - canonical workspace root.
 * @param {string} absolutePath - absolute path inside the root.
 * @returns the POSIX relative path ("" for the root itself).
 */
export function toPosixRelative(realRoot, absolutePath) {
  const relative = path.relative(realRoot, absolutePath);
  return relative === '' ? '' : relative.split(path.sep).join('/');
}

/**
 * Join a parent relative POSIX path with a child name.
 * @param {string} parentRelative - parent POSIX relative path ("" for the root).
 * @param {string} name - child name.
 * @returns the child POSIX relative path.
 */
export function joinRelative(parentRelative, name) {
  return parentRelative === '' ? name : `${parentRelative}/${name}`;
}
