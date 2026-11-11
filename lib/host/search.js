/**
 * `GET /api/dsh-workspace-ide.search` — recursive full-text workspace search.
 *
 * A small hand-rolled matcher covers literal / regex / case / whole-word modes;
 * a bounded walk skips VCS and dependency directories, binary files and
 * oversized files, and stops at configurable file/match caps or a deadline so a
 * pathological workspace cannot pin the Host. Unreadable files are skipped,
 * never fatal.
 *
 * @module dsh-workspace-ide/host/search
 */

import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  badRequest,
  describeError,
  okResponse,
  queryFlag,
  queryInt,
} from './respond.js';
import { joinRelative, resolveWorkspaceRoot } from './paths.js';

/** Tuning defaults from the contract. */
export const SEARCH_DEFAULTS = Object.freeze({
  maxFiles: 400,
  maxMatches: 500,
  maxFileBytes: 1024 * 1024,
  perFileMatches: 40,
  deadlineMs: 15000,
});

/** Entry names never visited by the walk. */
export const EXCLUDED_NAMES = Object.freeze(new Set(['.git', 'node_modules', '.DS_Store', '.dsh', '.tmp']));

/** Longest line snippet returned per match. */
const MAX_SNIPPET_LENGTH = 400;

/**
 * Escape a string so it matches literally inside a RegExp.
 * @param value - raw text.
 * @returns the escaped source.
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the per-line matcher for one search.
 *
 * Both literal and regex mode compile down to a global RegExp so match columns
 * are measured on the original (uncased) line and whole-word mode can use
 * `\w` lookarounds. A zero-length match is skipped (it would be noise and could
 * loop forever).
 *
 * @param options - `{ query, regex, caseSensitive, whole }`.
 * @returns `(line) => [{ column, length }]` with 0-based columns.
 */
export function createLineMatcher(options) {
  const query = options !== null && typeof options === 'object' ? options.query : undefined;
  if (typeof query !== 'string' || query.length === 0) throw badRequest('"q" must be a non-empty string');
  let source = options.regex === true ? query : escapeRegExp(query);
  if (options.whole === true) source = `(?<![\\w])(?:${source})(?![\\w])`;
  const flags = options.caseSensitive === true ? 'g' : 'gi';
  let pattern;
  try {
    pattern = new RegExp(source, flags);
  } catch (error) {
    throw badRequest(`invalid regular expression: ${describeError(error)}`);
  }
  return (line) => {
    const matches = [];
    pattern.lastIndex = 0;
    for (;;) {
      const match = pattern.exec(line);
      if (match === null) break;
      if (match[0].length > 0) matches.push({ column: match.index, length: match[0].length });
      if (match[0].length === 0) {
        pattern.lastIndex += 1;
        if (pattern.lastIndex > line.length) break;
      }
    }
    return matches;
  };
}

/**
 * Convert one simple glob into an anchored RegExp.
 *
 * Supports `*` (no slash), `**` (any depth, `**​/` also matches zero dirs) and
 * `?` (one non-slash character); everything else is literal.
 *
 * @param glob - the glob pattern.
 * @returns the compiled anchored RegExp.
 */
function globToRegExp(glob) {
  let source = '^';
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    if (character === '*') {
      if (glob[index + 1] === '*') {
        if (glob[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (character === '?') {
      source += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(character)) {
      source += `\\${character}`;
    } else {
      source += character;
    }
  }
  return new RegExp(`${source}$`);
}

/**
 * Match one workspace-relative path against one include/exclude pattern.
 *
 * A pattern without glob metacharacters is a plain path substring; a glob
 * without `/` matches the basename; a glob with `/` matches the full relative
 * path.
 *
 * @param relativePath - POSIX path relative to the workspace root.
 * @param pattern - one comma-separated pattern.
 * @returns true when the path matches.
 */
export function matchGlob(relativePath, pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0) return false;
  const normalized = pattern.startsWith('./') ? pattern.slice(2) : pattern;
  if (normalized.length === 0) return false;
  if (!/[*?]/.test(normalized)) return relativePath.includes(normalized);
  const pattern_ = globToRegExp(normalized);
  if (normalized.includes('/')) return pattern_.test(relativePath);
  const slash = relativePath.lastIndexOf('/');
  return pattern_.test(slash === -1 ? relativePath : relativePath.slice(slash + 1));
}

/**
 * Split a comma-separated pattern list.
 * @param raw - raw query value.
 * @returns the trimmed, non-empty patterns.
 */
export function splitPatterns(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  return raw.split(',').map((pattern) => pattern.trim()).filter((pattern) => pattern.length > 0);
}

/**
 * Whether a path matches any of the patterns.
 * @param relativePath - POSIX relative path.
 * @param patterns - pattern list.
 * @returns true when at least one pattern matches.
 */
function matchesAny(relativePath, patterns) {
  return patterns.some((pattern) => matchGlob(relativePath, pattern));
}

/**
 * Run one full-text search.
 * @param workspace - validated `{ requestedRoot, realRoot }`.
 * @param options - matcher + cap options.
 * @returns the result payload fields.
 */
export async function searchWorkspace(workspace, options) {
  const startedAt = Date.now();
  const deadline = startedAt + SEARCH_DEFAULTS.deadlineMs;
  const matcher = createLineMatcher(options);
  const include = splitPatterns(options.include);
  const exclude = splitPatterns(options.exclude);
  const maxFiles = Number.isInteger(options.maxFiles) ? options.maxFiles : SEARCH_DEFAULTS.maxFiles;
  const maxMatches = Number.isInteger(options.maxMatches) ? options.maxMatches : SEARCH_DEFAULTS.maxMatches;
  const maxFileBytes = Number.isInteger(options.maxFileBytes) ? options.maxFileBytes : SEARCH_DEFAULTS.maxFileBytes;
  const perFileMatches = Number.isInteger(options.perFileMatches) ? options.perFileMatches : SEARCH_DEFAULTS.perFileMatches;

  const files = [];
  let totalMatches = 0;
  let scannedFiles = 0;
  let scannedBytes = 0;
  let truncated = false;

  const pending = [{ absolute: workspace.realRoot, relative: '' }];
  let stop = false;
  while (pending.length > 0 && !stop) {
    if (Date.now() > deadline) {
      truncated = true;
      break;
    }
    const directory = pending.pop();
    if (directory === undefined) break;
    let dirents;
    try {
      dirents = await readdir(directory.absolute, { withFileTypes: true });
    } catch {
      continue; // unreadable directory: skip, never fail the search
    }
    dirents.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const dirent of dirents) {
      const name = dirent.name;
      if (EXCLUDED_NAMES.has(name)) continue;
      const relative = joinRelative(directory.relative, name);
      if (dirent.isDirectory()) {
        if (matchesAny(relative, exclude)) continue;
        pending.push({ absolute: join(directory.absolute, name), relative });
        continue;
      }
      if (!dirent.isFile()) continue; // symlinks and specials are not followed
      if (matchesAny(relative, exclude)) continue;
      if (include.length > 0 && !matchesAny(relative, include)) continue;
      if (scannedFiles >= maxFiles) {
        truncated = true;
        stop = true;
        break;
      }
      if (Date.now() > deadline) {
        truncated = true;
        stop = true;
        break;
      }
      const absolute = join(directory.absolute, name);
      let info;
      try {
        info = await lstat(absolute);
      } catch {
        continue;
      }
      if (!info.isFile() || info.size > maxFileBytes) continue;
      let buffer;
      try {
        buffer = await readFile(absolute);
      } catch {
        continue;
      }
      scannedFiles += 1;
      scannedBytes += buffer.length;
      if (buffer.length > maxFileBytes) continue;
      if (buffer.indexOf(0) !== -1) continue; // binary: skip
      const lines = buffer.toString('utf8').split(/\r?\n/);
      const matches = [];
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        const found = matcher(line);
        for (const match of found) {
          if (matches.length >= perFileMatches) {
            truncated = true;
            break;
          }
          matches.push({
            line: lineIndex + 1,
            column: match.column + 1,
            length: match.length,
            text: line.slice(0, MAX_SNIPPET_LENGTH),
          });
          totalMatches += 1;
          if (totalMatches >= maxMatches) {
            truncated = true;
            stop = true;
            break;
          }
        }
        if (stop) break;
        if (matches.length >= perFileMatches) {
          // Reaching the per-file cap stops collecting this file; the total may
          // be complete, but callers must know a cap applied.
          truncated = true;
          break;
        }
      }
      if (matches.length > 0) files.push({ path: relative, matches });
      if (stop) break;
    }
  }

  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return {
    files,
    totalMatches,
    scannedFiles,
    scannedBytes,
    truncated,
    elapsedMs: Date.now() - startedAt,
  };
}

/**
 * Handle the search route.
 * @param {HostContext} ctx - Host plugin context.
 * @param request - incoming GET request.
 * @returns the HTTP response.
 */
export async function handleSearch(ctx, request) {
  const params = new URL(request.url).searchParams;
  const workspace = await resolveWorkspaceRoot(ctx, params.get('root'));
  const query = params.get('q');
  if (query === null || query === '') throw badRequest('missing required parameter "q"');
  const options = {
    query,
    regex: queryFlag(params, 'regex', false),
    caseSensitive: queryFlag(params, 'case', false),
    whole: queryFlag(params, 'whole', false),
    include: params.get('include') ?? '',
    exclude: params.get('exclude') ?? '',
    maxFiles: queryInt(params, 'maxFiles', SEARCH_DEFAULTS.maxFiles, { min: 1, max: 20000 }),
    maxMatches: queryInt(params, 'maxMatches', SEARCH_DEFAULTS.maxMatches, { min: 1, max: 200000 }),
    maxFileBytes: queryInt(params, 'maxFileBytes', SEARCH_DEFAULTS.maxFileBytes, { min: 1, max: 64 * 1024 * 1024 }),
  };
  const result = await searchWorkspace(workspace, options);
  return okResponse({
    root: workspace.requestedRoot,
    query,
    options: {
      regex: options.regex,
      case: options.caseSensitive,
      whole: options.whole,
      include: options.include,
      exclude: options.exclude,
      maxFiles: options.maxFiles,
      maxMatches: options.maxMatches,
      maxFileBytes: options.maxFileBytes,
    },
    ...result,
  });
}
