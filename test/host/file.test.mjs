/**
 * Code viewer read/write tests: language inference, binary/truncated reads,
 * atomic saves, overwrite-only semantics and path/size safety.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  MAX_FILE_BYTES,
  MAX_SAVE_BODY_BYTES,
  inferLanguage,
  readWorkspaceFile,
  saveWorkspaceFile,
} from '../../lib/host/file.js';
import { call, encode, makeApp, postJson, temporaryDirectory } from './support.mjs';

/**
 * Read one file through the route and decode its JSON body.
 * @param app - routes.
 * @param root - workspace root.
 * @param path - relative file path.
 * @returns the decoded response.
 */
async function getFile(app, root, path) {
  return call(app, 'file', `?root=${encode(root)}&path=${encode(path)}`);
}

describe('inferLanguage', () => {
  it('maps known extensions case-insensitively', () => {
    assert.equal(inferLanguage('a.js'), 'javascript');
    assert.equal(inferLanguage('a.mjs'), 'javascript');
    assert.equal(inferLanguage('a.cjs'), 'javascript');
    assert.equal(inferLanguage('a.ts'), 'typescript');
    assert.equal(inferLanguage('a.tsx'), 'tsx');
    assert.equal(inferLanguage('a.jsx'), 'jsx');
    assert.equal(inferLanguage('a.json'), 'json');
    assert.equal(inferLanguage('a.md'), 'markdown');
    assert.equal(inferLanguage('README.MD'), 'markdown');
    assert.equal(inferLanguage('a.css'), 'css');
    assert.equal(inferLanguage('a.html'), 'html');
    assert.equal(inferLanguage('a.py'), 'python');
    assert.equal(inferLanguage('a.go'), 'go');
    assert.equal(inferLanguage('a.rs'), 'rust');
    assert.equal(inferLanguage('a.java'), 'java');
    assert.equal(inferLanguage('a.c'), 'c');
    assert.equal(inferLanguage('a.cpp'), 'cpp');
    assert.equal(inferLanguage('a.h'), 'c');
    assert.equal(inferLanguage('a.sh'), 'shell');
    assert.equal(inferLanguage('a.yml'), 'yaml');
    assert.equal(inferLanguage('a.yaml'), 'yaml');
    assert.equal(inferLanguage('a.txt'), 'text');
  });

  it('defaults to text for unknown, empty and dotless names', () => {
    assert.equal(inferLanguage('a.unknown'), 'text');
    assert.equal(inferLanguage('Makefile'), 'text');
    assert.equal(inferLanguage(''), 'text');
    assert.equal(inferLanguage(undefined), 'text');
  });
});

describe('GET file', () => {
  it('returns text content with contract fields', async (t) => {
    const root = temporaryDirectory(t);
    writeFileSync(join(root, 'src.js'), 'const answer = 42;\n');
    const { status, body } = await getFile(makeApp(), root, 'src.js');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.root, root);
    assert.equal(body.path, 'src.js');
    assert.equal(body.absolutePath, join(root, 'src.js'));
    assert.equal(body.content, 'const answer = 42;\n');
    assert.equal(body.binary, false);
    assert.equal(body.truncated, false);
    assert.equal(body.size, 19);
    assert.equal(typeof body.mtimeMs, 'number');
    assert.equal(body.language, 'javascript');
  });

  it('detects binary files by NUL byte and nulls the content', async (t) => {
    const root = temporaryDirectory(t);
    writeFileSync(join(root, 'blob.bin'), Buffer.from([0x68, 0x69, 0x00, 0x21]));
    const { status, body } = await getFile(makeApp(), root, 'blob.bin');
    assert.equal(status, 200);
    assert.equal(body.binary, true);
    assert.equal(body.content, null);
  });

  it('reads an empty file as empty text', async (t) => {
    const root = temporaryDirectory(t);
    writeFileSync(join(root, 'empty.txt'), '');
    const { status, body } = await getFile(makeApp(), root, 'empty.txt');
    assert.equal(status, 200);
    assert.equal(body.content, '');
    assert.equal(body.binary, false);
    assert.equal(body.truncated, false);
    assert.equal(body.size, 0);
  });

  it('caps reads at 2 MiB and flags truncation', async (t) => {
    const root = temporaryDirectory(t);
    writeFileSync(join(root, 'big.txt'), Buffer.alloc(MAX_FILE_BYTES + 32, 0x61));
    const { status, body } = await getFile(makeApp(), root, 'big.txt');
    assert.equal(status, 200);
    assert.equal(MAX_FILE_BYTES, 2 * 1024 * 1024);
    assert.equal(body.truncated, true);
    assert.equal(body.size, MAX_FILE_BYTES + 32);
    assert.equal(body.content.length, MAX_FILE_BYTES);
    assert.equal(body.binary, false);
  });

  it('reports missing files as not-found', async (t) => {
    const root = temporaryDirectory(t);
    const { status, body } = await getFile(makeApp(), root, 'ghost.txt');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'not-found');
  });

  it('rejects directories as bad-request', async (t) => {
    const root = temporaryDirectory(t);
    mkdirSync(join(root, 'src'));
    const { status, body } = await getFile(makeApp(), root, 'src');
    assert.equal(status, 400);
    assert.equal(body.error.code, 'bad-request');
  });

  it('rejects a symlink to a file outside the workspace', async (t) => {
    const root = temporaryDirectory(t);
    const outside = temporaryDirectory(t);
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt'));
    const { status, body } = await getFile(makeApp(), root, 'leak.txt');
    assert.equal(status, 403);
    assert.equal(body.error.code, 'outside-workspace');
  });
});

describe('POST save', () => {
  it('overwrites an existing file atomically with the new content', async (t) => {
    const root = temporaryDirectory(t);
    const file = join(root, 'note.md');
    writeFileSync(file, 'old content');
    const { status, body } = await postJson(makeApp(), 'save', { root, path: 'note.md', content: 'new content\n' });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.path, 'note.md');
    assert.equal(body.size, 12);
    assert.equal(typeof body.mtimeMs, 'number');
    assert.equal(readFileSync(file, 'utf8'), 'new content\n');
    // No temporary files are left behind.
    assert.deepEqual(readdirSync(root), ['note.md']);
  });

  it('refuses to create missing files', async (t) => {
    const root = temporaryDirectory(t);
    const { status, body } = await postJson(makeApp(), 'save', { root, path: 'new.txt', content: 'x' });
    assert.equal(status, 404);
    assert.equal(body.error.code, 'not-found');
    assert.equal(readdirSync(root).length, 0);
  });

  it('rejects escaped paths', async (t) => {
    const root = temporaryDirectory(t);
    const { status, body } = await postJson(makeApp(), 'save', { root, path: '../escape.txt', content: 'x' });
    assert.equal(status, 403);
    assert.equal(body.error.code, 'outside-workspace');
  });

  it('rejects content above the 4 MiB cap without touching the file', async (t) => {
    const root = temporaryDirectory(t);
    const file = join(root, 'keep.txt');
    writeFileSync(file, 'keep');
    const huge = 'x'.repeat(MAX_SAVE_BODY_BYTES + 1);
    const { status, body } = await postJson(makeApp(), 'save', { root, path: 'keep.txt', content: huge });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'bad-request');
    assert.equal(readFileSync(file, 'utf8'), 'keep');
  });

  it('rejects directories and symbolic links', async (t) => {
    const root = temporaryDirectory(t);
    mkdirSync(join(root, 'dir'));
    const directory = await postJson(makeApp(), 'save', { root, path: 'dir', content: 'x' });
    assert.equal(directory.status, 400);
    writeFileSync(join(root, 'real.txt'), 'real');
    symlinkSync(join(root, 'real.txt'), join(root, 'alias.txt'));
    const alias = await postJson(makeApp(), 'save', { root, path: 'alias.txt', content: 'x' });
    assert.equal(alias.status, 400);
    assert.equal(readFileSync(join(root, 'real.txt'), 'utf8'), 'real');
  });

  it('rejects malformed bodies and non-string content', async (t) => {
    const root = temporaryDirectory(t);
    const badJson = await call(makeApp(), 'save', '', { method: 'POST', body: 'not-json' });
    assert.equal(badJson.status, 400);
    const badContent = await postJson(makeApp(), 'save', { root, path: 'a.txt', content: 42 });
    assert.equal(badContent.status, 400);
  });

  it('direct save rejects a content-only oversized payload', async (t) => {
    const root = temporaryDirectory(t);
    writeFileSync(join(root, 'a.txt'), 'a');
    await assert.rejects(
      saveWorkspaceFile({ requestedRoot: root, realRoot: root }, 'a.txt', 'x'.repeat(MAX_SAVE_BODY_BYTES + 1)),
      (error) => error.status === 400,
    );
  });

  it('direct read maps filesystem edge cases', async (t) => {
    const root = temporaryDirectory(t);
    writeFileSync(join(root, 'a.txt'), 'a');
    const read = await readWorkspaceFile({ requestedRoot: root, realRoot: root }, 'a.txt');
    assert.equal((await read.json()).content, 'a');
  });
});
