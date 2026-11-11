/**
 * Path safety tests: relative-path normalization, root validation (including
 * the workspace-registry allow-list) and canonical (symlink) escape rejection.
 */

import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  joinRelative,
  normalizeRelativePath,
  optionalService,
  resolveExistingTarget,
  resolveWorkspaceRoot,
  toPosixRelative,
} from '../../lib/host/paths.js';
import { makeApp, temporaryDirectory } from './support.mjs';

/**
 * Assert one call throws an HttpError with the given status/code.
 * @param promise - call under test.
 * @param status - expected status.
 * @param code - expected JSON code.
 */
async function rejectsWith(promise, status, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.status, status, `expected status ${status}, got ${error.status} (${error.message})`);
    assert.equal(error.code, code);
    return true;
  });
}

describe('normalizeRelativePath', () => {
  it('normalizes benign relative paths', () => {
    assert.equal(normalizeRelativePath(undefined), '');
    assert.equal(normalizeRelativePath(''), '');
    assert.equal(normalizeRelativePath('src'), 'src');
    assert.equal(normalizeRelativePath('src/a.js'), 'src/a.js');
    assert.equal(normalizeRelativePath('a/../b'), 'b');
    assert.equal(normalizeRelativePath('./src//a.js'), 'src/a.js');
  });

  it('rejects absolute paths as outside-workspace', async () => {
    await rejectsWith(Promise.resolve().then(() => normalizeRelativePath('/etc/passwd')), 403, 'outside-workspace');
    await rejectsWith(Promise.resolve().then(() => normalizeRelativePath('C:\\Windows')), 403, 'outside-workspace');
  });

  it('rejects .. escapes as outside-workspace', async () => {
    await rejectsWith(Promise.resolve().then(() => normalizeRelativePath('../secret')), 403, 'outside-workspace');
    await rejectsWith(Promise.resolve().then(() => normalizeRelativePath('a/../../secret')), 403, 'outside-workspace');
    await rejectsWith(Promise.resolve().then(() => normalizeRelativePath('..')), 403, 'outside-workspace');
  });

  it('rejects NUL bytes as bad-request', async () => {
    await rejectsWith(Promise.resolve().then(() => normalizeRelativePath('a\0b')), 400, 'bad-request');
  });

  it('rejects non-string values', async () => {
    await rejectsWith(Promise.resolve().then(() => normalizeRelativePath(42)), 400, 'bad-request');
  });
});

describe('resolveWorkspaceRoot', () => {
  const noServices = { get: () => undefined };

  it('accepts an existing absolute directory and returns its canonical path', async (t) => {
    const directory = temporaryDirectory(t);
    const resolved = await resolveWorkspaceRoot(noServices, directory);
    assert.equal(resolved.requestedRoot, directory);
    assert.equal(resolved.realRoot, directory);
  });

  it('rejects a missing root parameter', async () => {
    await rejectsWith(resolveWorkspaceRoot(noServices, undefined), 400, 'bad-request');
    await rejectsWith(resolveWorkspaceRoot(noServices, ''), 400, 'bad-request');
    await rejectsWith(resolveWorkspaceRoot(noServices, '   '), 400, 'bad-request');
  });

  it('rejects relative roots and NUL bytes as bad-request', async () => {
    await rejectsWith(resolveWorkspaceRoot(noServices, 'relative/dir'), 400, 'bad-request');
    await rejectsWith(resolveWorkspaceRoot(noServices, '\0/abs'), 400, 'bad-request');
  });

  it('rejects nonexistent roots as not-found', async (t) => {
    const directory = temporaryDirectory(t);
    await rejectsWith(resolveWorkspaceRoot(noServices, join(directory, 'ghost')), 404, 'not-found');
  });

  it('rejects a root that is a regular file as bad-request', async (t) => {
    const directory = temporaryDirectory(t);
    const file = join(directory, 'a.txt');
    writeFileSync(file, 'x');
    await rejectsWith(resolveWorkspaceRoot(noServices, file), 400, 'bad-request');
  });

  it('only admits registered workspaces when the registry exists', async (t) => {
    const known = temporaryDirectory(t);
    const unknown = temporaryDirectory(t);
    const ctx = {
      get(name) {
        return name === 'workspaceRegistry'
          ? { list: () => [{ id: 'w1', path: known, title: 'Known', sessionIds: [] }] }
          : undefined;
      },
    };
    const resolved = await resolveWorkspaceRoot(ctx, known);
    assert.equal(resolved.realRoot, known);
    await rejectsWith(resolveWorkspaceRoot(ctx, unknown), 403, 'outside-workspace');
  });

  it('degrades when the registry is missing or throws', async (t) => {
    const directory = temporaryDirectory(t);
    const broken = {
      get(name) {
        return name === 'workspaceRegistry' ? { list: () => { throw new Error('registry exploded'); } } : undefined;
      },
    };
    assert.equal((await resolveWorkspaceRoot(broken, directory)).realRoot, directory);
  });
});

describe('resolveExistingTarget', () => {
  it('returns canonical targets inside the root', async (t) => {
    const root = temporaryDirectory(t);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.js'), 'x');
    const target = await resolveExistingTarget(root, 'src/a.js');
    assert.equal(target, join(root, 'src', 'a.js'));
    assert.equal(await resolveExistingTarget(root, ''), root);
  });

  it('rejects missing targets as not-found', async (t) => {
    const root = temporaryDirectory(t);
    await rejectsWith(resolveExistingTarget(root, 'ghost.txt'), 404, 'not-found');
  });

  it('rejects a symlink that points outside the workspace', async (t) => {
    const root = temporaryDirectory(t);
    const outside = temporaryDirectory(t);
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    symlinkSync(outside, join(root, 'escape-dir'));
    symlinkSync(join(outside, 'secret.txt'), join(root, 'escape-file.txt'));
    await rejectsWith(resolveExistingTarget(root, 'escape-dir/secret.txt'), 403, 'outside-workspace');
    await rejectsWith(resolveExistingTarget(root, 'escape-file.txt'), 403, 'outside-workspace');
  });

  it('allows a symlink that stays inside the workspace', async (t) => {
    const root = temporaryDirectory(t);
    writeFileSync(join(root, 'real.txt'), 'inside');
    symlinkSync(join(root, 'real.txt'), join(root, 'alias.txt'));
    assert.equal(await resolveExistingTarget(root, 'alias.txt'), join(root, 'real.txt'));
  });
});

describe('path helpers', () => {
  it('joins and relativizes POSIX paths', () => {
    assert.equal(joinRelative('', 'a'), 'a');
    assert.equal(joinRelative('src', 'a.js'), 'src/a.js');
    assert.equal(toPosixRelative('/root', '/root'), '');
    assert.equal(toPosixRelative('/root', '/root/src/a.js'), 'src/a.js');
  });

  it('looks up optional services defensively', () => {
    assert.equal(optionalService(undefined, 'x'), undefined);
    assert.equal(optionalService({}, 'x'), undefined);
    assert.equal(optionalService({ get: () => 5 }, 'x'), 5);
    assert.equal(optionalService({ get: () => { throw new Error('x'); } }, 'x'), undefined);
  });
});

describe('routes reject escaped paths end-to-end', () => {
  it('refuses ../ and absolute paths on the file route', async (t) => {
    const root = temporaryDirectory(t);
    const app = makeApp();
    const escape = await app.find((route) => route.name === 'file').fetch(
      new Request(`http://localhost/api/dsh-workspace-ide.file?root=${encodeURIComponent(root)}&path=..%2Fsecret`),
    );
    assert.equal(escape.status, 403);
    const absolute = await app.find((route) => route.name === 'file').fetch(
      new Request(`http://localhost/api/dsh-workspace-ide.file?root=${encodeURIComponent(root)}&path=%2Fetc%2Fpasswd`),
    );
    assert.equal(absolute.status, 403);
  });
});
