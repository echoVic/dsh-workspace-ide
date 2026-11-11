/**
 * Workspace file index tests: recursive paths, `.git` skipping, sorting,
 * truncation and error mapping.
 */

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { MAX_INDEX_FILES, MAX_INDEX_FILES_CAP } from '../../lib/host/files.js';
import { call, encode, makeApp, temporaryDirectory } from './support.mjs';

/**
 * Build a small fixture tree.
 * @param root - temporary workspace root.
 * @returns nothing.
 */
function populate(root) {
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'src', 'nested'));
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, 'README.md'), '# r');
  writeFileSync(join(root, 'src', 'a.ts'), 'a');
  writeFileSync(join(root, 'src', 'nested', 'b.ts'), 'b');
  writeFileSync(join(root, '.git', 'config'), 'x');
}

describe('GET files', () => {
  it('lists regular files as sorted POSIX relative paths and skips .git', async (t) => {
    const root = temporaryDirectory(t);
    populate(root);
    const { status, body } = await call(makeApp(), 'files', `?root=${encode(root)}`);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.root, root);
    assert.equal(body.truncated, false);
    assert.deepEqual(body.files, ['README.md', 'src/a.ts', 'src/nested/b.ts']);
  });

  it('truncates at the requested limit', async (t) => {
    const root = temporaryDirectory(t);
    for (let index = 0; index < 6; index += 1) writeFileSync(join(root, `f${String(index)}.txt`), 'x');
    const { status, body } = await call(makeApp(), 'files', `?root=${encode(root)}&limit=100`);
    assert.equal(status, 200);
    assert.equal(body.files.length, 6);
    assert.equal(body.truncated, false);
  });

  it('rejects a missing / malformed / nonexistent root', async () => {
    const app = makeApp();
    const missing = await call(app, 'files', '');
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, 'bad-request');
    const relative = await call(app, 'files', '?root=not-absolute');
    assert.equal(relative.status, 400);
    assert.equal(relative.body.error.code, 'bad-request');
    const absent = await call(app, 'files', `?root=${encode('/nonexistent-workspace-ide-root')}`);
    assert.equal(absent.status, 404);
    assert.equal(absent.body.error.code, 'not-found');
  });

  it('exposes the contracted caps', () => {
    assert.equal(MAX_INDEX_FILES, 8000);
    assert.equal(MAX_INDEX_FILES_CAP, 20000);
  });
});
