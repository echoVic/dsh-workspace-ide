/**
 * `GET /api/dsh-workspace-ide.git` — branch/status, unified diffs, recent
 * commit history and branch listing for the Git tab.
 *
 * Every git invocation goes through `execFile('git', args, { cwd, maxBuffer,
 * timeout, env })` (no shell, so request strings cannot inject commands), and
 * every failure degrades to a JSON envelope: a non-repository root answers
 * `{"ok":true,"repo":false}`, a failing git command answers
 * `{"ok":false,"error":{"code":"git-failed"}}`, and nothing ever throws.
 *
 * @module dsh-workspace-ide/host/git
 */

import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  HttpError,
  badRequest,
  describeError,
  failResponse,
  okResponse,
  queryFlag,
  queryInt,
} from './respond.js';
import {
  normalizeRelativePath,
  resolveExistingTarget,
  resolveWorkspaceRoot,
} from './paths.js';

const execFileAsync = promisify(execFile);

/** Buffer cap for one git command. */
export const GIT_MAX_BUFFER = 32 * 1024 * 1024;
/** Timeout for one git command. */
export const GIT_TIMEOUT_MS = 15000;
/** Cap on returned unified diff text. */
export const MAX_DIFF_BYTES = 400 * 1024;
/** Default and maximum commit history depth. */
export const DEFAULT_COMMIT_LIMIT = 30;
export const MAX_COMMIT_LIMIT = 100;
/** Porcelain-XY codes that mean an unresolved conflict. */
const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);
/** Request kinds the route understands. */
export const GIT_KINDS = Object.freeze(['status', 'diff', 'log', 'branches']);
/** A safe revision spelling: no leading dash, no shell-ish surprises. */
const SAFE_REVISION = /^[0-9A-Za-z_][0-9A-Za-z_./~^@{}-]*$/;

/**
 * Coerce execFile output (string or Buffer) to text.
 * @param {unknown} value - raw output.
 * @returns the text, empty for non-text values.
 */
function textOf(value) {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return '';
}

/**
 * Run one git command, resolving success and failure alike.
 * @param {Array<string>} args - git arguments (no shell involved).
 * @param {string} cwd - workspace root the command runs in.
 * @returns `{ ok, stdout, stderr, message }`.
 */
export async function runGit(args, cwd) {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      maxBuffer: GIT_MAX_BUFFER,
      timeout: GIT_TIMEOUT_MS,
      env: { ...process.env, LC_ALL: 'C' },
      windowsHide: true,
    });
    return { ok: true, stdout: textOf(result.stdout), stderr: textOf(result.stderr), message: '' };
  } catch (error) {
    const failure = /** @type {any} */ (error);
    return {
      ok: false,
      stdout: textOf(failure !== null && failure !== undefined ? failure.stdout : undefined),
      stderr: textOf(failure !== null && failure !== undefined ? failure.stderr : undefined),
      message: describeError(error),
    };
  }
}

/**
 * Build the contracted git failure envelope.
 * @param {any} result - failed `runGit` result.
 * @returns the HTTP response.
 */
function gitFailure(result) {
  const detail = result.stderr.trim().split('\n')[0] || result.message || 'git command failed';
  return failResponse(200, 'git-failed', detail);
}

/**
 * Whether a git failure means "this repository has no commits yet".
 * @param {string} stderr - git stderr.
 * @returns true for the empty-repository shapes.
 */
function isEmptyRepositoryMessage(stderr) {
  return /does not have any commits|does not have any commits yet|unknown revision or path not in the working tree|bad default revision|ambiguous argument 'HEAD'|Needed a single revision/i.test(stderr);
}

/**
 * Inspect whether the workspace root is inside a git work tree, and the path
 * prefix that converts repo-root-relative status paths into root-relative ones.
 * @param {string} realRoot - canonical workspace root.
 * @returns `{ prefix }`, or null when the root is not a git work tree.
 */
async function inspectRepository(realRoot) {
  const probe = await runGit(['rev-parse', '--is-inside-work-tree'], realRoot);
  if (!probe.ok || probe.stdout.trim() !== 'true') return null;
  let prefix = '';
  const top = await runGit(['rev-parse', '--show-toplevel'], realRoot);
  if (top.ok) {
    const topLevel = top.stdout.trim();
    if (topLevel !== '') {
      let canonicalTop = topLevel;
      try {
        canonicalTop = await realpath(topLevel);
      } catch {
        // Keep the uncanonicalized spelling; the comparison below degrades anyway.
      }
      if (canonicalTop !== realRoot) {
        const relative = path.relative(canonicalTop, realRoot).split(path.sep).join('/');
        prefix = relative === '' || relative.startsWith('..') ? '' : `${relative}/`;
      }
    }
  }
  return { prefix };
}

/**
 * Parse `git status --porcelain=v1 -z --branch --untracked-files=all` output.
 *
 * Exported for tests. Rename/copy entries use the second NUL token as the
 * original path and keep the new path in `path`; status is the 2-character XY
 * code.
 *
 * @param {any} stdout - raw NUL-separated porcelain output.
 * @param {any} options - `{ prefix }` when the workspace root is a repo subdirectory.
 * @returns `{ branch, upstream, ahead, behind, files, counts }`.
 */
export function parseStatus(stdout, options = {}) {
  const prefix = typeof options.prefix === 'string' ? options.prefix : '';
  /** @type {{branch: string, upstream: string|null, ahead: number, behind: number, files: Array<{path: string, index: string, worktree: string, status: string, from?: string}>, counts: {staged: number, unstaged: number, untracked: number, conflicted: number}}} */
  const result = {
    branch: '',
    upstream: null,
    ahead: 0,
    behind: 0,
    files: [],
    counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
  };
  const tokens = textOf(stdout).split('\0');

  /**
   * Convert one repo-root-relative path into a workspace-root-relative path.
   * @param {unknown} value - repo-relative path.
   * @returns the relative path, or null when outside the workspace root.
   */
  const toWorkspacePath = (value) => {
    const text = String(value);
    if (prefix === '') return text;
    if (!text.startsWith(prefix)) return null;
    return text.slice(prefix.length);
  };

  let index = 0;
  if (tokens.length > 0 && tokens[0].startsWith('## ')) {
    parseBranchHeader(tokens[0], result);
    index = 1;
  }
  for (; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.length === 0) continue;
    if (token.startsWith('## ')) {
      parseBranchHeader(token, result);
      continue;
    }
    if (token.length < 4) continue;
    const indexStatus = token[0];
    const worktreeStatus = token[1];
    if (indexStatus === '!' && worktreeStatus === '!') continue; // ignored files are not requested
    let filePath = toWorkspacePath(token.slice(3));
    let from;
    if (indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C') {
      const original = tokens[index + 1];
      if (original !== undefined && original.length > 0) {
        index += 1;
        const projected = toWorkspacePath(original);
        if (projected !== null) from = projected;
      }
    }
    if (filePath === null) continue;
    const status = `${indexStatus}${worktreeStatus}`;
    const entry = /** @type {any} */ ({ path: filePath, index: indexStatus, worktree: worktreeStatus, status });
    if (from !== undefined) entry.from = from;
    result.files.push(entry);

    if (CONFLICT_CODES.has(status)) {
      result.counts.conflicted += 1;
    } else if (status === '??') {
      result.counts.untracked += 1;
    } else {
      if (indexStatus !== ' ' && indexStatus !== '!') result.counts.staged += 1;
      if (worktreeStatus !== ' ' && worktreeStatus !== '!') result.counts.unstaged += 1;
    }
  }
  return result;
}

/**
 * Parse the `##` branch header of porcelain v1 output.
 * @param {string} header - one header token including the `## ` prefix.
 * @param {any} result - parse result mutated in place.
 */
function parseBranchHeader(header, result) {
  const trimmed = header.slice(3).trim();
  if (trimmed === '') return;
  if (trimmed.startsWith('HEAD (no branch)') || trimmed === 'HEAD') {
    result.branch = 'HEAD';
    return;
  }
  const unborn = /^(?:No commits yet on|Initial commit on)\s+(.+)$/.exec(trimmed);
  if (unborn !== null) {
    result.branch = unborn[1].trim();
    return;
  }
  let branchPart = trimmed;
  let trailer = '';
  const bracket = trimmed.indexOf(' [');
  if (bracket !== -1) {
    branchPart = trimmed.slice(0, bracket);
    const closing = trimmed.lastIndexOf(']');
    trailer = closing === -1 ? '' : trimmed.slice(bracket + 2, closing);
  }
  const divider = branchPart.indexOf('...');
  if (divider !== -1) {
    result.upstream = branchPart.slice(divider + 3);
    branchPart = branchPart.slice(0, divider);
  }
  result.branch = branchPart;
  if (trailer !== '' && !trailer.includes('gone')) {
    const ahead = /\bahead (\d+)/.exec(trailer);
    const behind = /\bbehind (\d+)/.exec(trailer);
    if (ahead !== null) result.ahead = Number.parseInt(ahead[1], 10);
    if (behind !== null) result.behind = Number.parseInt(behind[1], 10);
  }
}

/**
 * Parse `git log --format=%H%x00%h%x00%an%x00%aI%x00%s%x00%D` output.
 * @param {any} stdout - raw log output (one commit per line).
 * @returns the commit rows.
 */
export function parseLog(stdout) {
  const commits = [];
  for (const line of textOf(stdout).split('\n')) {
    if (line === '') continue;
    const fields = line.split('\0');
    if (fields.length < 6) continue;
    const refs = fields[5].trim() === ''
      ? []
      : fields[5].split(',').map((ref) => ref.trim()).filter((ref) => ref.length > 0);
    commits.push({
      hash: fields[0],
      short: fields[1],
      author: fields[2],
      date: fields[3],
      subject: fields[4],
      refs,
    });
  }
  return commits;
}

/**
 * Parse `git branch -a --format=%(HEAD)%09%(refname)%09%(refname:short)` output.
 * @param {any} stdout - raw branch output.
 * @returns `{ current, branches }`.
 */
export function parseBranches(stdout) {
  /** @type {string|null} */
  let current = null;
  const branches = [];
  for (const line of textOf(stdout).split('\n')) {
    if (line === '') continue;
    const [head, refname, short] = line.split('\t');
    if (typeof short !== 'string' || short === '') continue;
    const isCurrent = head === '*';
    if (isCurrent) current = short;
    branches.push({
      name: short,
      current: isCurrent,
      remote: typeof refname === 'string' && refname.startsWith('refs/remotes/'),
    });
  }
  return { current, branches };
}

/**
 * Cap diff text at the contracted 400 KB, reporting truncation.
 * @param {string} rawDiff - full diff text.
 * @returns `{ diff, truncated }`.
 */
function capDiff(rawDiff) {
  const text = textOf(rawDiff);
  if (Buffer.byteLength(text, 'utf8') <= MAX_DIFF_BYTES) return { diff: text, truncated: false };
  let capped = text.slice(0, MAX_DIFF_BYTES);
  while (Buffer.byteLength(capped, 'utf8') > MAX_DIFF_BYTES) {
    capped = capped.slice(0, Math.floor(capped.length * 0.99));
  }
  return { diff: capped, truncated: true };
}

/**
 * `kind=status` payload.
 * @param {WorkspaceRoot} workspace - validated workspace.
 * @param {any} repository - repository inspection result.
 * @returns the HTTP response.
 */
async function gitStatus(workspace, repository) {
  const result = await runGit(
    ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all'],
    workspace.realRoot,
  );
  if (!result.ok) return gitFailure(result);
  const parsed = parseStatus(result.stdout, { prefix: repository.prefix });
  return okResponse({
    repo: true,
    root: workspace.requestedRoot,
    branch: parsed.branch,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    clean: parsed.files.length === 0,
    files: parsed.files,
    counts: parsed.counts,
  });
}

/**
 * `kind=diff` payload: working-tree, staged, untracked or commit diff.
 * @param {WorkspaceRoot} workspace - validated workspace.
 * @param {URLSearchParams} params - request query parameters.
 * @returns the HTTP response.
 */
async function gitDiff(workspace, params) {
  const commit = (params.get('commit') ?? '').trim();
  if (commit !== '' && !SAFE_REVISION.test(commit)) throw badRequest('invalid "commit" revision');
  const staged = commit === '' && queryFlag(params, 'staged', false);
  const context = queryInt(params, 'context', 3, { min: 0, max: 50 });
  const relativePath = normalizeRelativePath(params.get('path'));

  if (commit !== '') {
    const args = ['show', '--no-color', '--stat', '--patch', commit];
    if (relativePath !== '') args.push('--', relativePath);
    const result = await runGit(args, workspace.realRoot);
    if (!result.ok) return gitFailure(result);
    const capped = capDiff(result.stdout);
    return okResponse({
      repo: true,
      path: relativePath,
      staged: false,
      commit,
      diff: capped.diff,
      truncated: capped.truncated,
    });
  }

  const args = ['diff'];
  if (staged) args.push('--cached');
  args.push(`-U${String(context)}`, '--no-color');
  if (relativePath !== '') args.push('--', relativePath);
  const result = await runGit(args, workspace.realRoot);
  if (!result.ok) return gitFailure(result);
  let diffText = result.stdout;
  if (diffText === '' && relativePath !== '' && !staged) {
    // An untracked file has no working-tree diff; render it against /dev/null.
    const untracked = await runGit(
      ['ls-files', '--others', '--exclude-standard', '--', relativePath],
      workspace.realRoot,
    );
    if (untracked.ok && untracked.stdout.trim() !== '') {
      const absolute = await resolveExistingTarget(workspace.realRoot, relativePath, 'file');
      const noIndex = await runGit(
        ['diff', '--no-index', '--no-color', '/dev/null', absolute],
        workspace.realRoot,
      );
      // `git diff --no-index` exits 1 when files differ: stdout is still the diff.
      diffText = noIndex.stdout;
    }
  }
  const capped = capDiff(diffText);
  return okResponse({
    repo: true,
    path: relativePath,
    staged,
    commit: null,
    diff: capped.diff,
    truncated: capped.truncated,
  });
}

/**
 * `kind=log` payload.
 * @param {WorkspaceRoot} workspace - validated workspace.
 * @param {URLSearchParams} params - request query parameters.
 * @returns the HTTP response.
 */
async function gitLog(workspace, params) {
  const limit = queryInt(params, 'limit', DEFAULT_COMMIT_LIMIT, { min: 1, max: MAX_COMMIT_LIMIT });
  const result = await runGit(
    ['log', '-n', String(limit), '--no-color', '--format=%H%x00%h%x00%an%x00%aI%x00%s%x00%D'],
    workspace.realRoot,
  );
  if (!result.ok) {
    if (isEmptyRepositoryMessage(result.stderr)) return okResponse({ repo: true, commits: [] });
    return gitFailure(result);
  }
  return okResponse({ repo: true, commits: parseLog(result.stdout) });
}

/**
 * `kind=branches` payload.
 * @param {WorkspaceRoot} workspace - validated workspace.
 * @returns the HTTP response.
 */
async function gitBranches(workspace) {
  const result = await runGit(
    ['branch', '-a', '--no-color', '--format=%(HEAD)%09%(refname)%09%(refname:short)'],
    workspace.realRoot,
  );
  if (!result.ok) return gitFailure(result);
  const parsed = parseBranches(result.stdout);
  return okResponse({ repo: true, current: parsed.current, branches: parsed.branches });
}

/**
 * Handle the git route.
 * @param {HostContext} ctx - Host plugin context.
 * @param {Request} request - incoming GET request.
 * @returns the HTTP response.
 */
export async function handleGit(ctx, request) {
  const params = new URL(request.url).searchParams;
  const workspace = await resolveWorkspaceRoot(ctx, params.get('root'));
  const kind = (params.get('kind') ?? '').trim() || 'status';
  if (!GIT_KINDS.includes(kind)) throw badRequest(`unknown git kind: ${kind}`);
  const repository = await inspectRepository(workspace.realRoot);
  if (repository === null) return okResponse({ repo: false });
  try {
    if (kind === 'status') return await gitStatus(workspace, repository);
    if (kind === 'diff') return await gitDiff(workspace, params);
    if (kind === 'log') return await gitLog(workspace, params);
    return await gitBranches(workspace);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    return failResponse(200, 'git-failed', describeError(error));
  }
}
