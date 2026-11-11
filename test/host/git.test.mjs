/**
 * Git route tests against real temporary repositories created with
 * `execFileSync('git', ...)` in `os.tmpdir()`: status, diffs (working tree,
 * staged, untracked, commit), history, branches and non-repository degradation.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseBranches, parseLog, parseStatus } from '../../lib/host/git.js';
import { call, encode, makeApp, temporaryDirectory } from './support.mjs';

/**
 * Run git synchronously in a test repository.
 * @param root - repository working tree.
 * @param args - git arguments.
 * @returns stdout.
 */
function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    // Bypass the developer's global git config (commit hook / trace2 socket)
    // so the isolated fixtures stay fast and deterministic.
    env: {
      ...process.env,
      LC_ALL: 'C',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
}

/**
 * Create a repository with one commit and configured identity.
 * @param t - test context.
 * @returns the repository root.
 */
function makeRepository(t) {
  const root = temporaryDirectory(t, 'wsi-git-');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test User');
  git(root, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'tracked.txt'), 'one\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'initial commit');
  return root;
}

/**
 * Run one git route request.
 * @param root - workspace root.
 * @param query - query string (without leading `?`, root excluded).
 * @returns the decoded response.
 */
async function gitRoute(root, query = '') {
  return call(makeApp(), 'git', `?root=${encode(root)}${query}`);
}

describe('parseStatus', () => {
  it('parses branch header, ahead/behind, entries, renames and conflict counts', () => {
    const stdout = [
      '## main...origin/main [ahead 2, behind 1]',
      'R  renamed file.txt',
      'old file.txt',
      ' M tracked.txt',
      '?? fresh.txt',
      'UU conflict.txt',
      'A  added.txt',
      '!! ignored.txt',
    ].join('\0') + '\0';
    const parsed = parseStatus(stdout);
    assert.equal(parsed.branch, 'main');
    assert.equal(parsed.upstream, 'origin/main');
    assert.equal(parsed.ahead, 2);
    assert.equal(parsed.behind, 1);
    assert.deepEqual(parsed.counts, { staged: 2, unstaged: 1, untracked: 1, conflicted: 1 });
    const renamed = parsed.files.find((file) => file.status === 'R ');
    assert.equal(renamed.path, 'renamed file.txt');
    assert.equal(renamed.from, 'old file.txt');
    assert.equal(parsed.files.find((file) => file.path === 'tracked.txt').status, ' M');
    assert.equal(parsed.files.find((file) => file.path === 'fresh.txt').status, '??');
  });

  it('parses unborn and detached headers', () => {
    assert.equal(parseStatus('## No commits yet on main\0').branch, 'main');
    assert.equal(parseStatus('## HEAD (no branch)\0').branch, 'HEAD');
  });

  it('projects repo-relative paths into a workspace subdirectory', () => {
    const parsed = parseStatus('## main\0 M sub/a.txt\0 M other.txt\0', { prefix: 'sub/' });
    assert.deepEqual(parsed.files.map((file) => file.path), ['a.txt']);
  });
});

describe('parseLog / parseBranches', () => {
  it('parses NUL-separated log lines', () => {
    const stdout = ['abc', 'abcdefg', 'Ann', '2026-01-02T03:04:05+00:00', 'subject one', 'HEAD -> main, tag: v1']
      .join('\0') + '\n';
    const commits = parseLog(stdout);
    assert.deepEqual(commits, [{
      hash: 'abc',
      short: 'abcdefg',
      author: 'Ann',
      date: '2026-01-02T03:04:05+00:00',
      subject: 'subject one',
      refs: ['HEAD -> main', 'tag: v1'],
    }]);
    assert.deepEqual(parseLog(''), []);
  });

  it('parses branch listings', () => {
    const stdout = '*\trefs/heads/main\tmain\n \trefs/heads/feature\tfeature\n \trefs/remotes/origin/main\torigin/main\n';
    const parsed = parseBranches(stdout);
    assert.equal(parsed.current, 'main');
    assert.deepEqual(parsed.branches, [
      { name: 'main', current: true, remote: false },
      { name: 'feature', current: false, remote: false },
      { name: 'origin/main', current: false, remote: true },
    ]);
  });
});

describe('GET git kind=status', () => {
  it('reports a clean repository', async (t) => {
    const root = makeRepository(t);
    const { status, body } = await gitRoute(root, '&kind=status');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.repo, true);
    assert.equal(body.root, root);
    assert.equal(body.branch, 'main');
    assert.equal(body.upstream, null);
    assert.equal(body.ahead, 0);
    assert.equal(body.behind, 0);
    assert.equal(body.clean, true);
    assert.deepEqual(body.files, []);
    assert.deepEqual(body.counts, { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 });
  });

  it('classifies staged, unstaged and untracked changes', async (t) => {
    const root = makeRepository(t);
    writeFileSync(join(root, 'tracked.txt'), 'one\ntwo\n');
    writeFileSync(join(root, 'staged.txt'), 'staged\n');
    git(root, 'add', 'staged.txt');
    writeFileSync(join(root, 'untracked.txt'), 'untracked\n');
    const { body } = await gitRoute(root, '&kind=status');
    assert.equal(body.clean, false);
    const byPath = new Map(body.files.map((file) => [file.path, file]));
    assert.equal(byPath.get('staged.txt').status, 'A ');
    assert.equal(byPath.get('tracked.txt').status, ' M');
    assert.equal(byPath.get('untracked.txt').status, '??');
    assert.deepEqual(body.counts, { staged: 1, unstaged: 1, untracked: 1, conflicted: 0 });
  });
});

describe('GET git kind=diff', () => {
  it('renders a working-tree diff', async (t) => {
    const root = makeRepository(t);
    writeFileSync(join(root, 'tracked.txt'), 'one\ntwo\n');
    const { status, body } = await gitRoute(root, `&kind=diff&path=${encode('tracked.txt')}`);
    assert.equal(status, 200);
    assert.equal(body.repo, true);
    assert.equal(body.path, 'tracked.txt');
    assert.equal(body.staged, false);
    assert.equal(body.commit, null);
    assert.equal(body.truncated, false);
    assert.match(body.diff, /^diff --git a\/tracked\.txt b\/tracked\.txt/m);
    assert.match(body.diff, /^--- a\/tracked\.txt$/m);
    assert.match(body.diff, /^\+two$/m);
  });

  it('renders a staged diff', async (t) => {
    const root = makeRepository(t);
    writeFileSync(join(root, 'staged.txt'), 'staged content\n');
    git(root, 'add', 'staged.txt');
    const { body } = await gitRoute(root, `&kind=diff&path=${encode('staged.txt')}&staged=1`);
    assert.equal(body.staged, true);
    assert.match(body.diff, /new file mode/);
    assert.match(body.diff, /\+staged content/);
  });

  it('renders an untracked file against /dev/null', async (t) => {
    const root = makeRepository(t);
    writeFileSync(join(root, 'untracked.txt'), 'untracked content\n');
    const { status, body } = await gitRoute(root, `&kind=diff&path=${encode('untracked.txt')}`);
    assert.equal(status, 200);
    assert.match(body.diff, /\+untracked content/);
  });

  it('renders a commit diff and rejects invalid revisions', async (t) => {
    const root = makeRepository(t);
    const log = await gitRoute(root, '&kind=log');
    const hash = log.body.commits[0].hash;
    const { body } = await gitRoute(root, `&kind=diff&commit=${encode(hash)}`);
    assert.equal(body.commit, hash);
    assert.match(body.diff, /\+one/);
    assert.match(body.diff, /initial commit/);
    const invalid = await gitRoute(root, `&kind=diff&commit=${encode('--help')}`);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'bad-request');
  });

  it('rejects escaped diff paths', async (t) => {
    const root = makeRepository(t);
    const escaped = await gitRoute(root, `&kind=diff&path=${encode('../escape.txt')}`);
    assert.equal(escaped.status, 403);
    assert.equal(escaped.body.error.code, 'outside-workspace');
  });
});

describe('GET git kind=log / kind=branches', () => {
  it('lists commits newest-first with the contracted fields', async (t) => {
    const root = makeRepository(t);
    writeFileSync(join(root, 'tracked.txt'), 'one\ntwo\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'second commit');
    const { body } = await gitRoute(root, '&kind=log');
    assert.equal(body.repo, true);
    assert.equal(body.commits.length, 2);
    const [newest, oldest] = body.commits;
    assert.equal(newest.subject, 'second commit');
    assert.equal(oldest.subject, 'initial commit');
    assert.equal(newest.author, 'Test User');
    assert.match(newest.hash, /^[0-9a-f]{40}$/);
    assert.equal(newest.short, newest.hash.slice(0, 7));
    assert.equal(Number.isNaN(Date.parse(newest.date)), false);
    assert.ok(Array.isArray(newest.refs));
    const limited = await gitRoute(root, '&kind=log&limit=1');
    assert.equal(limited.body.commits.length, 1);
  });

  it('lists local and remote branches with the current one flagged', async (t) => {
    const root = makeRepository(t);
    git(root, 'branch', 'feature');
    git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const { body } = await gitRoute(root, '&kind=branches');
    assert.equal(body.repo, true);
    assert.equal(body.current, 'main');
    const main = body.branches.find((branch) => branch.name === 'main');
    assert.deepEqual(main, { name: 'main', current: true, remote: false });
    const feature = body.branches.find((branch) => branch.name === 'feature');
    assert.deepEqual(feature, { name: 'feature', current: false, remote: false });
    const remote = body.branches.find((branch) => branch.name === 'origin/main');
    assert.equal(remote.remote, true);
  });
});

describe('GET git degradation', () => {
  it('reports repo:false for a non-repository directory', async (t) => {
    const root = temporaryDirectory(t);
    const { status, body } = await gitRoute(root, '&kind=status');
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, repo: false });
  });

  it('handles an empty repository (no commits)', async (t) => {
    const root = temporaryDirectory(t, 'wsi-git-empty-');
    git(root, 'init', '-q', '-b', 'main');
    const status = await gitRoute(root, '&kind=status');
    assert.equal(status.body.repo, true);
    assert.equal(status.body.branch, 'main');
    assert.equal(status.body.clean, true);
    const log = await gitRoute(root, '&kind=log');
    assert.equal(log.body.repo, true);
    assert.deepEqual(log.body.commits, []);
    const branches = await gitRoute(root, '&kind=branches');
    assert.equal(branches.body.repo, true);
    assert.ok(Array.isArray(branches.body.branches));
  });

  it('rejects unknown kinds and bad roots', async (t) => {
    const root = makeRepository(t);
    const unknown = await gitRoute(root, '&kind=bogus');
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error.code, 'bad-request');
    const missingRoot = await call(makeApp(), 'git', '?kind=status');
    assert.equal(missingRoot.status, 400);
    const ghost = await gitRoute(join(root, 'ghost'), '&kind=status');
    assert.equal(ghost.status, 404);
  });
});
