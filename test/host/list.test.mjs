/**
 * Directory listing tests: ordering, hidden flags, entry types (including
 * symlinks and broken symlinks), paths, truncation and error mapping.
 */

import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { MAX_LIST_ENTRIES, listDirectory } from '../../lib/host/tree.js';
import { call, encode, makeApp, temporaryDirectory } from './support.mjs';

/**
 * Build a small fixture tree.
 * @param root - temporary workspace root.
 * @returns nothing.
 */
function populate(root) {
  mkdirSync(join(root, 'beta'));
  mkdirSync(join(root, 'Alpha'));
  mkdirSync(join(root, 'beta', 'nested'));
  writeFileSync(join(root, 'b.txt'), 'b');
  writeFileSync(join(root, 'A.txt'), 'a');
  writeFileSync(join(root, '.hidden.txt'), 'h');
  writeFileSync(join(root, 'Alpha', 'inner.js'), 'x');
  symlinkSync('/tmp', join(root, 'link-out'));
  symlinkSync(join(root, 'missing-target'), join(root, 'broken-link'));
}

describe('GET list', () => {
  it('lists directories first then case-insensitive names, with all metadata', async (t) => {
    const root = temporaryDirectory(t);
    populate(root);
    const { status, body } = await call(makeApp(), 'list', `?root=${encode(root)}`);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.root, root);
    assert.equal(body.path, '');
    assert.equal(body.truncated, false);
    assert.deepEqual(
      body.entries.map((entry) => entry.name),
      ['Alpha', 'beta', '.hidden.txt', 'A.txt', 'b.txt', 'broken-link', 'link-out'],
    );
    const byName = new Map(body.entries.map((entry) => [entry.name, entry]));
    assert.equal(byName.get('Alpha').type, 'dir');
    assert.equal(byName.get('A.txt').type, 'file');
    assert.equal(byName.get('.hidden.txt').hidden, true);
    assert.equal(byName.get('A.txt').hidden, false);
    assert.equal(byName.get('link-out').type, 'symlink');
    assert.equal(byName.get('broken-link').type, 'symlink');
    assert.equal(byName.get('Alpha').path, 'Alpha');
    assert.equal(typeof byName.get('A.txt').size, 'number');
    assert.equal(typeof byName.get('A.txt').mtimeMs, 'number');
    assert.equal(byName.get('A.txt').size, 1);
  });

  it('lists nested directories with prefixed child paths', async (t) => {
    const root = temporaryDirectory(t);
    populate(root);
    const { status, body } = await call(makeApp(), 'list', `?root=${encode(root)}&path=beta`);
    assert.equal(status, 200);
    assert.equal(body.path, 'beta');
    assert.deepEqual(body.entries.map((entry) => entry.name), ['nested']);
    assert.equal(body.entries[0].path, 'beta/nested');
    assert.deepEqual(body.entries[0].path, 'beta/nested');
  });

  it('resolves in-workspace symlinks to the type they act as', async (t) => {
    const root = temporaryDirectory(t);
    mkdirSync(join(root, 'real-dir'));
    writeFileSync(join(root, 'real.txt'), 'x');
    symlinkSync(join(root, 'real-dir'), join(root, 'alias-dir'));
    symlinkSync(join(root, 'real.txt'), join(root, 'alias-file'));
    const { status, body } = await call(makeApp(), 'list', `?root=${encode(root)}`);
    assert.equal(status, 200);
    const byName = new Map(body.entries.map((entry) => [entry.name, entry]));
    assert.equal(byName.get('alias-dir').type, 'dir');
    assert.equal(byName.get('alias-file').type, 'file');
    // A symlinked directory can be entered as a directory.
    const nested = await call(makeApp(), 'list', `?root=${encode(root)}&path=alias-dir`);
    assert.equal(nested.status, 200);
    assert.equal(nested.body.path, 'alias-dir');
  });

  it('reports a missing directory as not-found', async (t) => {
    const root = temporaryDirectory(t);
    const { status, body } = await call(makeApp(), 'list', `?root=${encode(root)}&path=ghost`);
    assert.equal(status, 404);
    assert.equal(body.error.code, 'not-found');
  });

  it('reports a root that is a file as bad-request', async (t) => {
    const root = temporaryDirectory(t);
    const file = join(root, 'a.txt');
    writeFileSync(file, 'x');
    const { status, body } = await call(makeApp(), 'list', `?root=${encode(file)}`);
    assert.equal(status, 400);
    assert.equal(body.error.code, 'bad-request');
  });

  it('reports a file path as bad-request', async (t) => {
    const root = temporaryDirectory(t);
    writeFileSync(join(root, 'a.txt'), 'x');
    const { status, body } = await call(makeApp(), 'list', `?root=${encode(root)}&path=a.txt`);
    assert.equal(status, 400);
    assert.equal(body.error.code, 'bad-request');
  });

  it('truncates beyond the entry cap and flags it', async (t) => {
    const root = temporaryDirectory(t);
    for (let index = 0; index < 5; index += 1) writeFileSync(join(root, `f${index}.txt`), String(index));
    const workspace = { requestedRoot: root, realRoot: root };
    const response = await listDirectory(workspace, '', { limit: 3 });
    const body = await response.json();
    assert.equal(body.truncated, true);
    assert.equal(body.entries.length, 3);
    assert.deepEqual(body.entries.map((entry) => entry.name), ['f0.txt', 'f1.txt', 'f2.txt']);
    assert.equal(MAX_LIST_ENTRIES, 4000);
  });

  it('does not flag truncation when the directory exactly fits', async (t) => {
    const root = temporaryDirectory(t);
    writeFileSync(join(root, 'only.txt'), 'x');
    const body = await (await listDirectory({ requestedRoot: root, realRoot: root }, '', { limit: 1 })).json();
    assert.equal(body.truncated, false);
    assert.equal(body.entries.length, 1);
  });
});
