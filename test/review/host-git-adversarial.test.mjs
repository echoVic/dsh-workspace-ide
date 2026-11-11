/**
 * Independent adversarial review tests for the dsh-workspace-ide Git route.
 *
 * These tests drive the shipped `handleGit` route through real temporary git
 * repositories (created in `os.tmpdir()` with the developer's global/system git
 * config disabled), covering: status grouping, rename/delete/conflict parsing,
 * repository subdirectory roots, every diff flavour, history, branches, unsafe
 * revision spellings and non-repository degradation.
 *
 * Run with: node --test test/review/
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseStatus } from '../../lib/host/git.js';
import { createRoutes } from '../../lib/host/routes.js';

const BASE = 'http://localhost';
const GIT_ENV = {
  ...process.env,
  LC_ALL: 'C',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_COUNT: '2',
  GIT_CONFIG_KEY_0: 'user.name',
  GIT_CONFIG_VALUE_0: 'Review Bot',
  GIT_CONFIG_KEY_1: 'user.email',
  GIT_CONFIG_VALUE_1: 'review@example.com',
};

/** Run git synchronously in a fixture repository (no global config). */
function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', env: GIT_ENV });
}

/** Run a git command that is expected to fail (e.g. a conflicting merge). */
function gitAllowingFailure(root, ...args) {
  try {
    return { ok: true, stdout: git(root, ...args) };
  } catch (error) {
    const failure = /** @type {any} */ (error);
    return { ok: false, stdout: String(failure.stdout ?? ''), stderr: String(failure.stderr ?? '') };
  }
}

/** Create a canonical temporary directory removed after the test. */
function tempDir(t, prefix = 'wsi-review-git-') {
  const directory = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Build every route against a fake Host context with no optional services. */
function makeApp() {
  return createRoutes({ get: () => undefined, logger: { warn() {} } });
}

/** Call one route and decode its JSON body. */
async function call(app, name, params) {
  const route = app.find((entry) => entry.name === name);
  const query = new URLSearchParams(Object.entries(params ?? {}).map(([key, value]) => [key, String(value)])).toString();
  const response = await route.fetch(new Request(`${BASE}/api/dsh-workspace-ide.${name}?${query}`));
  const body = await response.json();
  return { response, status: response.status, body };
}

/** GET the git route. */
async function gitRoute(params) {
  return call(makeApp(), 'git', params);
}

/** Create a repository with one commit: tracked.txt, old.txt, deleted.txt, gone.txt. */
function repoWithCommit(t) {
  const root = tempDir(t);
  git(root, 'init', '-q', '-b', 'main');
  writeFileSync(join(root, 'tracked.txt'), 'line one\nline two\n');
  writeFileSync(join(root, 'old.txt'), 'rename me\n');
  writeFileSync(join(root, 'deleted.txt'), 'delete me from the worktree\n');
  writeFileSync(join(root, 'gone.txt'), 'delete me from the index\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'initial commit');
  return root;
}

describe('git status', () => {
  it('classifies staged / unstaged / untracked / renamed / deleted changes and counts them', async (t) => {
    const root = repoWithCommit(t);
    // unstaged modification
    writeFileSync(join(root, 'tracked.txt'), 'line one\nline two modified\n');
    // staged new file
    writeFileSync(join(root, 'staged.txt'), 'staged line\n');
    git(root, 'add', 'staged.txt');
    // untracked file
    writeFileSync(join(root, 'untracked.txt'), 'hello untracked\n');
    // staged rename
    git(root, 'mv', 'old.txt', 'new.txt');
    // unstaged deletion
    rmSync(join(root, 'deleted.txt'));
    // staged deletion
    git(root, 'rm', '-q', 'gone.txt');

    const result = await gitRoute({ root, kind: 'status' });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.repo, true);
    assert.equal(result.body.root, root);
    assert.equal(result.body.branch, 'main');
    assert.equal(result.body.clean, false);
    assert.equal(result.body.counts.staged, 3, 'staged.txt added + old.txt renamed + gone.txt deleted');
    assert.equal(result.body.counts.unstaged, 2, 'tracked.txt modified + deleted.txt deleted');
    assert.equal(result.body.counts.untracked, 1);

    const byStatus = new Map(result.body.files.map((file) => [file.path, file.status]));
    assert.equal(byStatus.get('tracked.txt'), ' M');
    assert.equal(byStatus.get('staged.txt'), 'A ');
    assert.equal(byStatus.get('untracked.txt'), '??');
    assert.equal(byStatus.get('deleted.txt'), ' D');
    assert.equal(byStatus.get('gone.txt'), 'D ');
    const renamed = result.body.files.find((file) => file.path === 'new.txt');
    assert.equal(renamed.status, 'R ');
    assert.equal(renamed.from, 'old.txt');
    assert.equal(byStatus.has('old.txt'), false, 'rename reports only the new path');

    for (const file of result.body.files) {
      assert.equal(file.status.length, 2);
      assert.equal(file.status, `${file.index}${file.worktree}`);
    }
  });

  it('reports a clean repository and unborn branch shapes', async (t) => {
    const root = repoWithCommit(t);
    const clean = await gitRoute({ root, kind: 'status' });
    assert.equal(clean.body.repo, true);
    assert.equal(clean.body.clean, true);
    assert.deepEqual(clean.body.counts, { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 });
    assert.equal(clean.body.branch, 'main');

    const empty = tempDir(t);
    git(empty, 'init', '-q', '-b', 'main');
    const unborn = await gitRoute({ root: empty, kind: 'status' });
    assert.equal(unborn.status, 200);
    assert.equal(unborn.body.repo, true);
    assert.equal(unborn.body.branch, 'main');
    assert.equal(unborn.body.clean, true);
    const unbornLog = await gitRoute({ root: empty, kind: 'log' });
    assert.equal(unbornLog.status, 200);
    assert.equal(unbornLog.body.ok, true);
    assert.equal(unbornLog.body.repo, true);
    assert.deepEqual(unbornLog.body.commits, []);
  });

  it('reports merge conflicts with the conflicted group and UU codes', async (t) => {
    const root = repoWithCommit(t);
    writeFileSync(join(root, 'conflict.txt'), 'base\n');
    git(root, 'add', 'conflict.txt');
    git(root, 'commit', '-qm', 'add conflict base');
    git(root, 'checkout', '-q', '-b', 'other');
    writeFileSync(join(root, 'conflict.txt'), 'other side\n');
    git(root, 'commit', '-qam', 'other side');
    git(root, 'checkout', '-q', 'main');
    writeFileSync(join(root, 'conflict.txt'), 'main side\n');
    git(root, 'commit', '-qam', 'main side');
    const merge = gitAllowingFailure(root, 'merge', 'other');
    assert.equal(merge.ok, false, 'merge must conflict');

    const result = await gitRoute({ root, kind: 'status' });
    assert.equal(result.status, 200);
    assert.equal(result.body.counts.conflicted, 1);
    const conflicted = result.body.files.find((file) => file.path === 'conflict.txt');
    assert.ok(conflicted, 'conflicted file is listed');
    assert.equal(conflicted.status, 'UU');
    assert.equal(conflicted.index, 'U');
    assert.equal(conflicted.worktree, 'U');

    const diff = await gitRoute({ root, kind: 'diff', path: 'conflict.txt' });
    assert.equal(diff.status, 200);
    assert.equal(diff.body.repo, true);
    assert.equal(typeof diff.body.diff, 'string');
  });

  it('degrades a non-repository root to repo:false for every kind', async (t) => {
    const root = tempDir(t);
    writeFileSync(join(root, 'plain.txt'), 'x\n');
    for (const kind of ['status', 'diff', 'log', 'branches']) {
      const result = await gitRoute({ root, kind });
      assert.equal(result.status, 200, `kind=${kind} status`);
      assert.deepEqual(result.body, { ok: true, repo: false }, `kind=${kind} body`);
    }
    // kind defaults to status
    const defaulted = await gitRoute({ root });
    assert.equal(defaulted.body.repo, false);
  });

  it('reports ahead/behind against a tracked upstream branch', async (t) => {
    const root = repoWithCommit(t);
    git(root, 'remote', 'add', 'origin', root);
    git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(root, 'branch', '--set-upstream-to=origin/main', 'main');
    writeFileSync(join(root, 'tracked.txt'), 'one commit ahead\n');
    git(root, 'commit', '-qam', 'local commit');

    const status = await gitRoute({ root, kind: 'status' });
    assert.equal(status.status, 200);
    assert.equal(status.body.branch, 'main');
    assert.equal(status.body.upstream, 'origin/main');
    assert.equal(status.body.ahead, 1);
    assert.equal(status.body.behind, 0);
  });

  it('works when the workspace root is a linked worktree (a .git file, not a directory)', async (t) => {
    const root = repoWithCommit(t);
    const worktree = join(path.dirname(root), `${path.basename(root)}-wt`);
    t.after(() => rmSync(worktree, { recursive: true, force: true }));
    git(root, 'worktree', 'add', '-q', '-b', 'linked', worktree);
    assert.equal(existsSync(join(worktree, '.git')), true);
    assert.equal(statSync(join(worktree, '.git')).isDirectory(), false, 'linked worktree .git is a file');

    const status = await gitRoute({ root: worktree, kind: 'status' });
    assert.equal(status.status, 200);
    assert.equal(status.body.repo, true);
    assert.equal(status.body.branch, 'linked');

    writeFileSync(join(worktree, 'tracked.txt'), 'worktree change\n');
    const changed = await gitRoute({ root: worktree, kind: 'status' });
    assert.deepEqual(changed.body.files.map((file) => file.path), ['tracked.txt']);
    const diff = await gitRoute({ root: worktree, kind: 'diff', path: 'tracked.txt' });
    assert.match(diff.body.diff, /\+worktree change/);
  });

  it('projects status paths into a repository subdirectory root', async (t) => {
    const root = repoWithCommit(t);
    mkdirSync(join(root, 'sub'));
    mkdirSync(join(root, 'sub', 'deep'));
    writeFileSync(join(root, 'sub', 'inner.txt'), 'inner base\n');
    writeFileSync(join(root, 'sub', 'deep', 'nested.txt'), 'nested base\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'add sub tree');
    writeFileSync(join(root, 'sub', 'inner.txt'), 'inner changed\n');
    writeFileSync(join(root, 'sub', 'deep', 'nested.txt'), 'nested changed\n');
    writeFileSync(join(root, 'root-only.txt'), 'outside the subdir\n');

    const subRoot = join(root, 'sub');
    const status = await gitRoute({ root: subRoot, kind: 'status' });
    assert.equal(status.status, 200);
    assert.equal(status.body.repo, true);
    assert.deepEqual(status.body.files.map((file) => file.path).sort(), ['deep/nested.txt', 'inner.txt']);
    assert.ok(!status.body.files.some((file) => file.path.includes('root-only')), 'root-level changes are outside the subdir');

    // The diff of a subdir-relative path still renders.
    const diff = await gitRoute({ root: subRoot, kind: 'diff', path: 'inner.txt' });
    assert.equal(diff.status, 200);
    assert.equal(diff.body.repo, true);
    assert.match(diff.body.diff, /-inner base/);
    assert.match(diff.body.diff, /\+inner changed/);

    const log = await gitRoute({ root: subRoot, kind: 'log' });
    assert.equal(log.body.repo, true);
    assert.ok(Array.isArray(log.body.commits) && log.body.commits.length >= 2);
    const branches = await gitRoute({ root: subRoot, kind: 'branches' });
    assert.equal(branches.body.repo, true);
    assert.equal(branches.body.current, 'main');

    // A commit diff restricted to a subdir-relative path works too.
    const commitDiff = await gitRoute({ root: subRoot, kind: 'diff', commit: 'HEAD', path: 'inner.txt' });
    assert.equal(commitDiff.status, 200);
    assert.match(commitDiff.body.diff, /sub\/inner\.txt/);
  });
});

describe('git diff flavours', () => {
  it('renders working-tree, staged, untracked and commit diffs', async (t) => {
    const root = repoWithCommit(t);
    writeFileSync(join(root, 'tracked.txt'), 'line one\nline two working\n');
    writeFileSync(join(root, 'staged.txt'), 'staged line\n');
    git(root, 'add', 'staged.txt');
    writeFileSync(join(root, 'untracked.txt'), 'hello untracked\n');

    const working = await gitRoute({ root, kind: 'diff', path: 'tracked.txt' });
    assert.equal(working.status, 200);
    assert.equal(working.body.repo, true);
    assert.match(working.body.diff, /-line two/);
    assert.match(working.body.diff, /\+line two working/);
    assert.equal(working.body.truncated, false);
    assert.equal(working.body.staged, false);
    assert.equal(working.body.commit, null);

    const staged = await gitRoute({ root, kind: 'diff', path: 'staged.txt', staged: '1' });
    assert.equal(staged.status, 200);
    assert.equal(staged.body.staged, true);
    assert.match(staged.body.diff, /\+staged line/);

    const untracked = await gitRoute({ root, kind: 'diff', path: 'untracked.txt' });
    assert.equal(untracked.status, 200);
    assert.match(untracked.body.diff, /\+hello untracked/);
    assert.match(untracked.body.diff, /dev\/null/);

    const commit = await gitRoute({ root, kind: 'diff', commit: 'HEAD' });
    assert.equal(commit.status, 200);
    assert.equal(commit.body.commit, 'HEAD');
    assert.match(commit.body.diff, /initial commit/);
    assert.match(commit.body.diff, /diff --git/);

    // An unchanged tracked file yields an empty (not failing) diff.
    const unchanged = await gitRoute({ root, kind: 'diff', path: 'deleted.txt' });
    assert.equal(unchanged.status, 200);
    assert.equal(unchanged.body.ok, true);

    // A staged deletion shows the removed lines.
    git(root, 'rm', '-q', 'gone.txt');
    const stagedDelete = await gitRoute({ root, kind: 'diff', path: 'gone.txt', staged: '1' });
    assert.match(stagedDelete.body.diff, /-delete me from the index/);
  });

  it('honours the context parameter and clamps bad values instead of failing', async (t) => {
    const root = repoWithCommit(t);
    writeFileSync(join(root, 'tracked.txt'), 'line one\nline two changed\n');
    const zero = await gitRoute({ root, kind: 'diff', path: 'tracked.txt', context: '0' });
    assert.match(zero.body.diff, /@@ -2 \+2 @@/);
    for (const context of ['-5', '999', 'not-a-number', '']) {
      const result = await gitRoute({ root, kind: 'diff', path: 'tracked.txt', context });
      assert.equal(result.status, 200, `context=${JSON.stringify(context)}`);
      assert.equal(result.body.ok, true);
    }
  });

  it('caps very large diffs at 400 KB and flags truncation', async (t) => {
    const root = repoWithCommit(t);
    const original = Array.from({ length: 15000 }, (_, index) => `${'x'.repeat(12)} original line ${index}`).join('\n');
    writeFileSync(join(root, 'big.txt'), `${original}\n`);
    git(root, 'add', 'big.txt');
    git(root, 'commit', '-qm', 'big file');
    writeFileSync(join(root, 'big.txt'), `${original.replace(/original/g, 'changed')}\n`);

    const result = await gitRoute({ root, kind: 'diff', path: 'big.txt' });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.truncated, true);
    const bytes = Buffer.byteLength(result.body.diff, 'utf8');
    assert.ok(bytes <= 400 * 1024, `diff capped at 400 KB (got ${bytes} bytes)`);
    assert.ok(bytes > 100 * 1024, 'the cap still returns a substantial prefix');
  });

  it('rejects unsafe revision spellings with bad-request before running git', async (t) => {
    const root = repoWithCommit(t);
    for (const commit of ['--output=/tmp/wsi-pwn', '-n', 'HEAD; rm -rf /', '$(reboot)', '`id`', '../../etc', 'HEAD --']) {
      const result = await gitRoute({ root, kind: 'diff', commit });
      assert.equal(result.status, 400, `commit=${JSON.stringify(commit)}`);
      assert.equal(result.body.error.code, 'bad-request');
    }
    // A syntactically safe but nonexistent revision becomes a git-failed envelope.
    const missing = await gitRoute({ root, kind: 'diff', commit: 'does-not-exist' });
    assert.equal(missing.status, 200);
    assert.equal(missing.body.ok, false);
    assert.equal(missing.body.error.code, 'git-failed');
    // Safe revisions still work.
    const safe = await gitRoute({ root, kind: 'diff', commit: 'HEAD~0' });
    assert.equal(safe.status, 200);
    assert.equal(safe.body.ok, true);
  });

  it('handles file names with spaces and non-ASCII characters through status and diff', async (t) => {
    const root = repoWithCommit(t);
    writeFileSync(join(root, 'with space.txt'), 'base\n');
    writeFileSync(join(root, 'uni-文件.txt'), 'base\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'add odd names');
    writeFileSync(join(root, 'with space.txt'), 'base changed\n');
    writeFileSync(join(root, 'uni-文件.txt'), 'base changed\n');

    const status = await gitRoute({ root, kind: 'status' });
    const paths = status.body.files.map((file) => file.path);
    assert.ok(paths.includes('with space.txt'));
    assert.ok(paths.includes('uni-文件.txt'));

    const spaced = await gitRoute({ root, kind: 'diff', path: 'with space.txt' });
    assert.equal(spaced.status, 200);
    assert.match(spaced.body.diff, /with space\.txt/);
    const unicode = await gitRoute({ root, kind: 'diff', path: 'uni-文件.txt' });
    assert.equal(unicode.status, 200);
    assert.match(unicode.body.diff, /base changed/);
  });
});

describe('git log and branches', () => {
  it('lists commits newest-first with contracted fields and clamps the limit', async (t) => {
    const root = repoWithCommit(t);
    writeFileSync(join(root, 'tracked.txt'), 'second\n');
    git(root, 'commit', '-qam', 'second commit');
    writeFileSync(join(root, 'tracked.txt'), 'third\n');
    git(root, 'commit', '-qam', 'third commit');

    const all = await gitRoute({ root, kind: 'log' });
    assert.equal(all.status, 200);
    assert.equal(all.body.repo, true);
    assert.equal(all.body.commits.length, 3);
    assert.equal(all.body.commits[0].subject, 'third commit');
    assert.match(all.body.commits[0].hash, /^[0-9a-f]{40}$/);
    assert.equal(all.body.commits[0].short.length, 7);
    assert.equal(all.body.commits[0].author, 'Review Bot');
    assert.ok(!Number.isNaN(Date.parse(all.body.commits[0].date)));
    assert.ok(Array.isArray(all.body.commits[0].refs));

    assert.equal((await gitRoute({ root, kind: 'log', limit: '1' })).body.commits.length, 1);
    assert.equal((await gitRoute({ root, kind: 'log', limit: '0' })).body.commits.length, 1, 'limit clamps to 1');
    assert.equal((await gitRoute({ root, kind: 'log', limit: '1000' })).body.commits.length, 3, 'max 100 is above the fixture size');
    assert.equal((await gitRoute({ root, kind: 'log', limit: 'garbage' })).body.commits.length, 3, 'invalid limit keeps the default');
  });

  it('lists local and remote branches and flags the current one', async (t) => {
    const root = repoWithCommit(t);
    git(root, 'branch', 'feature');
    git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const result = await gitRoute({ root, kind: 'branches' });
    assert.equal(result.status, 200);
    assert.equal(result.body.repo, true);
    assert.equal(result.body.current, 'main');
    const main = result.body.branches.find((branch) => branch.name === 'main');
    const feature = result.body.branches.find((branch) => branch.name === 'feature');
    const remote = result.body.branches.find((branch) => branch.name === 'origin/main');
    assert.equal(main.current, true);
    assert.equal(feature.current, false);
    assert.equal(remote.remote, true);
  });

  it('reports a detached HEAD and rejects unknown kinds', async (t) => {
    const root = repoWithCommit(t);
    git(root, 'checkout', '-q', '--detach', 'HEAD');
    const status = await gitRoute({ root, kind: 'status' });
    assert.equal(status.body.branch, 'HEAD');
    const branches = await gitRoute({ root, kind: 'branches' });
    // `git branch -a` lists a `(HEAD detached at …)` pseudo-entry; the route
    // faithfully flags it as current rather than returning null.
    assert.match(String(branches.body.current), /\(HEAD detached/);
    assert.ok(branches.body.branches.some((branch) => branch.current === true));

    const unknown = await gitRoute({ root, kind: 'nonsense' });
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error.code, 'bad-request');
    const missingRoot = await gitRoute({ kind: 'status' });
    assert.equal(missingRoot.status, 400);
    const nonexistentRoot = await gitRoute({ root: join(root, 'nope'), kind: 'status' });
    assert.equal(nonexistentRoot.status, 404);
  });
});

describe('parseStatus adversarial shapes', () => {
  it('keeps rename originals only when they are inside the workspace prefix', () => {
    const inside = parseStatus('## main\0R  sub/new.txt\0sub/old.txt\0', { prefix: 'sub/' });
    assert.deepEqual(inside.files, [{ path: 'new.txt', index: 'R', worktree: ' ', status: 'R ', from: 'old.txt' }]);
    assert.deepEqual(inside.counts, { staged: 1, unstaged: 0, untracked: 0, conflicted: 0 });

    const outside = parseStatus('## main\0R  sub/new.txt\0elsewhere/old.txt\0', { prefix: 'sub/' });
    assert.equal(outside.files.length, 1);
    assert.equal(outside.files[0].path, 'new.txt');
    assert.equal(outside.files[0].from, undefined, 'original outside the workspace is not projected');

    // A file whose name contains tabs/newlines survives the NUL-token parser.
    const odd = parseStatus('## main\0 M sub/weird\tname\nwith newline.txt\0', { prefix: 'sub/' });
    assert.equal(odd.files.length, 1);
    assert.equal(odd.files[0].path, 'weird\tname\nwith newline.txt');
    assert.equal(odd.files[0].status, ' M');
    assert.equal(odd.counts.unstaged, 1);
  });
});
