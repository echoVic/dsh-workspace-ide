/**
 * Independent adversarial review tests for the dsh-workspace-ide Host half.
 *
 * Written by the review verifier (not the implementer). These tests import the
 * shipped route/handler modules directly, build fake WHATWG Requests and drive
 * the real handlers; they never boot DSH, never install the plugin and only
 * touch `os.tmpdir()` (plus a temporary `$DSH_HOME` for the ping route, which
 * is always restored).
 *
 * Run with: node --test test/review/
 */

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { MAX_FILE_BYTES } from '../../lib/host/file.js';
import { createRoutes } from '../../lib/host/routes.js';
import { SEARCH_DEFAULTS } from '../../lib/host/search.js';
import { appendStatusRecord, statusFilePath } from '../../lib/host/status.js';
import { MAX_LIST_ENTRIES } from '../../lib/host/tree.js';

const BASE = 'http://localhost';

/** Build every route against a fake Host context.
 * @param {Record<string, any>} [services] - fake services.
 * @returns {Array<any>} route descriptors.
 */
function makeApp(services = {}) {
  return createRoutes({
    get(name) {
      return services[name];
    },
    logger: { warn() {} },
  });
}

/** Call one route with an optional raw query string and decode the JSON body.
 * @param {Array<any>} app - routes.
 * @param {string} name - route name.
 * @param {string} [query] - raw query string.
 * @param {RequestInit} [init] - fetch init.
 * @returns {Promise<{response: Response, status: number, headers: Headers, body: any, text: string}>} decoded response.
 */
async function call(app, name, query = '', init) {
  const route = app.find((entry) => entry.name === name);
  assert.ok(route, `route ${name} must exist`);
  const response = await route.fetch(new Request(`${BASE}/api/dsh-workspace-ide.${name}${query}`, init));
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { response, status: response.status, headers: response.headers, body, text };
}

/** Call a GET route, URL-encoding every parameter.
 * @param {Array<any>} app - routes.
 * @param {string} name - route name.
 * @param {Record<string, any>} [params] - query parameters.
 * @returns {Promise<any>} decoded response.
 */
async function get(app, name, params = {}) {
  const entries = Object.entries(params ?? {}).filter(([, value]) => value !== undefined && value !== null);
  const query = entries.length === 0 ? '' : `?${new URLSearchParams(entries.map(([key, value]) => [key, String(value)])).toString()}`;
  return call(app, name, query);
}

/** Call a POST route with a JSON body.
 * @param {Array<any>} app - routes.
 * @param {string} name - route name.
 * @param {any} payload - JSON body.
 * @returns {Promise<any>} decoded response.
 */
async function postJson(app, name, payload) {
  return call(app, name, '', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/** Create a canonical temporary directory that is removed after the test.
 * @param {any} t - node:test TestContext.
 * @param {string} [prefix] - directory prefix.
 * @returns {string} canonical directory path.
 */
function tempDir(t, prefix = 'wsi-review-') {
  const directory = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Every answer (success or failure envelope) must carry cache-control: no-store.
 * @param {any} result - decoded route result.
 */
function assertNoStore(result) {
  assert.equal(result.response.headers.get('cache-control'), 'no-store', 'cache-control: no-store');
  assert.match(result.response.headers.get('content-type') ?? '', /application\/json/);
}

describe('route-level path safety', () => {
  it('rejects absolute, traversal, Windows-absolute and NUL file paths with the contracted codes', async (t) => {
    const ws = tempDir(t);
    writeFileSync(join(ws, 'ok.txt'), 'ok\n');
    const app = makeApp();

    for (const [path, status, code] of [
      ['/etc/passwd', 403, 'outside-workspace'],
      ['..', 403, 'outside-workspace'],
      ['../secret', 403, 'outside-workspace'],
      ['a/../../secret', 403, 'outside-workspace'],
      ['a/b/../../../secret', 403, 'outside-workspace'],
      ['C:\\Windows\\win.ini', 403, 'outside-workspace'],
      ['\\\\server\\share\\secret', 403, 'outside-workspace'],
      ['a\0b', 400, 'bad-request'],
    ]) {
      const result = await get(app, 'file', { root: ws, path });
      assert.equal(result.status, status, `path=${JSON.stringify(path)} status`);
      assert.equal(result.body.ok, false);
      assert.equal(result.body.error.code, code, `path=${JSON.stringify(path)} code`);
      assertNoStore(result);
    }

    // A URL-encoded traversal must be decoded first and then rejected.
    const encoded = await call(app, 'file', `?root=${encodeURIComponent(ws)}&path=%2e%2e%2fsecret`);
    assert.equal(encoded.status, 403);
    assert.equal(encoded.body.error.code, 'outside-workspace');

    // Benign paths still work.
    const good = await get(app, 'file', { root: ws, path: 'ok.txt' });
    assert.equal(good.status, 200);
    assert.equal(good.body.ok, true);
    assert.equal(good.body.content, 'ok\n');
    assertNoStore(good);
  });

  it('rejects traversal/absolute/NUL save paths before writing anything', async (t) => {
    const ws = tempDir(t);
    writeFileSync(join(ws, 'target.txt'), 'original\n');
    const outside = tempDir(t, 'wsi-review-outside-');
    writeFileSync(join(outside, 'pwn.txt'), 'untouched\n');
    const app = makeApp();

    for (const [path, status, code] of [
      ['../pwn.txt', 403, 'outside-workspace'],
      [`${outside}/pwn.txt`, 403, 'outside-workspace'],
      ['/tmp/pwn.txt', 403, 'outside-workspace'],
      ['a\0b', 400, 'bad-request'],
    ]) {
      const result = await postJson(app, 'save', { root: ws, path, content: 'pwned' });
      assert.equal(result.status, status, `save path=${JSON.stringify(path)} status`);
      assert.equal(result.body.error.code, code);
      assertNoStore(result);
    }
    assert.equal(readFileSync(join(outside, 'pwn.txt'), 'utf8'), 'untouched\n');
    assert.equal(readFileSync(join(ws, 'target.txt'), 'utf8'), 'original\n');
  });

  it('rejects symlinks escaping the workspace on read, list and save, and leaks no outside bytes', async (t) => {
    const base = tempDir(t);
    const ws = join(base, 'ws');
    const outside = join(base, 'outside');
    mkdirSync(ws);
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'TOP-SECRET-CONTENT\n');
    symlinkSync(join(outside, 'secret.txt'), join(ws, 'escape.txt'));
    symlinkSync(outside, join(ws, 'escape-dir'));
    const app = makeApp();

    const file = await get(app, 'file', { root: ws, path: 'escape.txt' });
    assert.equal(file.status, 403);
    assert.equal(file.body.error.code, 'outside-workspace');
    assert.ok(!file.text.includes('TOP-SECRET-CONTENT'), 'outside content must not leak');

    const list = await get(app, 'list', { root: ws, path: 'escape-dir' });
    assert.equal(list.status, 403);
    assert.equal(list.body.error.code, 'outside-workspace');
    assert.ok(!list.text.includes('TOP-SECRET-CONTENT'));

    const save = await postJson(app, 'save', { root: ws, path: 'escape.txt', content: 'pwned' });
    assert.equal(save.status, 403);
    assert.equal(save.body.error.code, 'outside-workspace');
    assert.equal(readFileSync(join(outside, 'secret.txt'), 'utf8'), 'TOP-SECRET-CONTENT\n');

    // The symlink itself is still listed as a symlink (metadata only, not followed).
    const rootList = await get(app, 'list', { root: ws });
    assert.equal(rootList.status, 200);
    const escape = rootList.body.entries.find((entry) => entry.name === 'escape.txt');
    assert.equal(escape.type, 'symlink');
  });

  it('allows symlinks that stay inside the workspace for reads but never overwrites them', async (t) => {
    const ws = tempDir(t);
    writeFileSync(join(ws, 'inside.txt'), 'inside-content\n');
    symlinkSync(join(ws, 'inside.txt'), join(ws, 'alias.txt'));
    mkdirSync(join(ws, 'realdir'));
    writeFileSync(join(ws, 'realdir', 'nested.txt'), 'nested\n');
    symlinkSync(join(ws, 'realdir'), join(ws, 'dirlink'));
    const app = makeApp();

    const read = await get(app, 'file', { root: ws, path: 'alias.txt' });
    assert.equal(read.status, 200);
    assert.equal(read.body.content, 'inside-content\n');

    const viaDirLink = await get(app, 'file', { root: ws, path: 'dirlink/nested.txt' });
    assert.equal(viaDirLink.status, 200);
    assert.equal(viaDirLink.body.content, 'nested\n');

    const dirList = await get(app, 'list', { root: ws, path: 'dirlink' });
    assert.equal(dirList.status, 200);
    assert.equal(dirList.body.entries[0].path, 'dirlink/nested.txt');

    const save = await postJson(app, 'save', { root: ws, path: 'alias.txt', content: 'pwned' });
    assert.equal(save.status, 400);
    assert.equal(save.body.error.code, 'bad-request');
    assert.equal(readFileSync(join(ws, 'inside.txt'), 'utf8'), 'inside-content\n');
  });

  it('reports a broken symlink as type symlink and a read of it as not-found', async (t) => {
    const ws = tempDir(t);
    symlinkSync(join(ws, 'does-not-exist'), join(ws, 'broken.txt'));
    const app = makeApp();
    const list = await get(app, 'list', { root: ws });
    assert.equal(list.status, 200);
    const broken = list.body.entries.find((entry) => entry.name === 'broken.txt');
    assert.equal(broken.type, 'symlink');
    const read = await get(app, 'file', { root: ws, path: 'broken.txt' });
    assert.equal(read.status, 404);
    assert.equal(read.body.error.code, 'not-found');
  });

  it('validates root as an existing absolute directory (no registry = any directory, per contract)', async (t) => {
    const ws = tempDir(t);
    const file = join(ws, 'plain.txt');
    writeFileSync(file, 'x\n');
    const app = makeApp();

    for (const [root, status, code] of [
      ['', 400, 'bad-request'],
      ['relative/dir', 400, 'bad-request'],
      [`${ws}\0suffix`, 400, 'bad-request'],
      [join(ws, 'missing'), 404, 'not-found'],
      [file, 400, 'bad-request'],
    ]) {
      const result = await get(app, 'list', { root });
      assert.equal(result.status, status, `root=${JSON.stringify(root)}`);
      assert.equal(result.body.error.code, code);
      assertNoStore(result);
    }

    // No registry service: any existing absolute directory is admitted.
    const etc = await get(app, 'list', { root: '/etc' });
    assert.equal(etc.status, 200);
    assert.ok(Array.isArray(etc.body.entries));

    // A symlinked root is canonicalized (still the same directory).
    const rootAlias = join(tempDir(t, 'wsi-review-alias-'), 'ws-link');
    symlinkSync(ws, rootAlias);
    const viaAlias = await get(app, 'list', { root: rootAlias });
    assert.equal(viaAlias.status, 200);
    assert.equal(viaAlias.body.root, rootAlias);
  });
});

describe('workspaceRegistry allow-list', () => {
  /** Build a registry service over the given paths. */
  function registry(paths) {
    return { list: () => paths.map((path) => ({ id: path, path })) };
  }

  it('admits only exact canonical workspace roots, not subdirectories', async (t) => {
    const base = tempDir(t);
    const wsA = join(base, 'ws-a');
    const wsB = join(base, 'ws-b');
    const other = join(base, 'other');
    for (const directory of [wsA, wsB, other]) {
      mkdirSync(directory);
      writeFileSync(join(directory, 'f.txt'), 'x\n');
    }
    mkdirSync(join(wsA, 'sub'));
    const app = makeApp({ workspaceRegistry: registry([wsA, wsB]) });

    assert.equal((await get(app, 'list', { root: wsA })).status, 200);
    assert.equal((await get(app, 'list', { root: wsB })).status, 200);

    const sub = await get(app, 'list', { root: join(wsA, 'sub') });
    assert.equal(sub.status, 403);
    assert.equal(sub.body.error.code, 'outside-workspace');

    const foreign = await get(app, 'list', { root: other });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.error.code, 'outside-workspace');

    // A symlink spelling of a registered root canonicalizes to the same root.
    const alias = join(base, 'ws-a-alias');
    symlinkSync(wsA, alias);
    assert.equal((await get(app, 'list', { root: alias })).status, 200);
  });

  it('ignores missing/invalid registry entries and fails closed when the allow-list is empty', async (t) => {
    const base = tempDir(t);
    const ws = join(base, 'ws');
    mkdirSync(ws);
    writeFileSync(join(ws, 'f.txt'), 'x\n');

    const emptyRegistry = makeApp({ workspaceRegistry: registry([join(base, 'gone'), 'relative/path', 42]) });
    const rejected = await get(emptyRegistry, 'list', { root: ws });
    assert.equal(rejected.status, 403);
    assert.equal(rejected.body.error.code, 'outside-workspace');

    const brokenRegistry = makeApp({
      workspaceRegistry: {
        list() {
          throw new Error('registry exploded');
        },
      },
    });
    // Contract: a registry that throws is treated as unavailable (degraded, not fatal).
    const failOpen = await get(brokenRegistry, 'list', { root: ws });
    assert.equal(failOpen.status, 200);

    const nonArray = makeApp({ workspaceRegistry: { list: () => ({ nope: true }) } });
    assert.equal((await get(nonArray, 'list', { root: ws })).status, 200);
  });
});

describe('workspaces route projection', () => {
  it('projects registry order, live sessions and .git markers (directory or worktree file)', async (t) => {
    const base = tempDir(t);
    const wsA = join(base, 'a');
    const wsB = join(base, 'b');
    const wsC = join(base, 'c');
    for (const directory of [wsA, wsB, wsC]) mkdirSync(directory);
    mkdirSync(join(wsA, '.git')); // normal repository marker
    writeFileSync(join(wsB, '.git'), 'gitdir: /elsewhere\n'); // linked worktree marker
    const registry = {
      list: () => [
        { id: 'alpha', path: wsA, title: 'Alpha', sessionIds: ['s1', 's2'] },
        { path: wsB, sessionIds: ['s3'] },
        { id: 'gamma', path: wsC, title: '', sessionIds: 'not-an-array' },
        null,
        42,
      ],
    };
    const sessions = { list: () => [{ id: 's1' }, { id: 'other' }] };
    const app = makeApp({ workspaceRegistry: registry, sessions });
    const result = await get(app, 'workspaces');
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assertNoStore(result);
    assert.equal(result.body.workspaces.length, 3, 'null/primitive entities are skipped');
    const [alpha, beta, gamma] = result.body.workspaces;
    assert.deepEqual([alpha.id, alpha.path, alpha.title, alpha.sessionCount, alpha.live, alpha.git], ['alpha', wsA, 'Alpha', 2, true, true]);
    assert.deepEqual([beta.id, beta.path, beta.title, beta.sessionCount, beta.live, beta.git], [wsB, wsB, 'b', 1, false, true]);
    assert.deepEqual([gamma.id, gamma.path, gamma.title, gamma.sessionCount, gamma.live, gamma.git], ['gamma', wsC, 'c', 0, false, false]);
  });

  it('degrades to an empty list without the registry and when it throws or returns garbage', async (t) => {
    const empty = await get(makeApp(), 'workspaces');
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body, { ok: true, workspaces: [] });

    const throwing = makeApp({ workspaceRegistry: { list() { throw new Error('boom'); } } });
    assert.deepEqual((await get(throwing, 'workspaces')).body, { ok: true, workspaces: [] });

    const garbage = makeApp({ workspaceRegistry: { list: () => 'nope' } });
    assert.deepEqual((await get(garbage, 'workspaces')).body, { ok: true, workspaces: [] });

    const brokenSessions = makeApp({
      workspaceRegistry: { list: () => [{ path: '/w', sessionIds: ['s1'] }] },
      sessions: { list() { throw new Error('sessions boom'); } },
    });
    const broken = await get(brokenSessions, 'workspaces');
    assert.equal(broken.body.workspaces[0].live, false);
  });
});

describe('list route adversarial behaviour', () => {
  it('sorts directories first then case-insensitive names, flags hidden entries, no truncation', async (t) => {
    const ws = tempDir(t);
    mkdirSync(join(ws, 'beta'));
    mkdirSync(join(ws, 'Alpha'));
    writeFileSync(join(ws, 'zeta.txt'), 'z');
    writeFileSync(join(ws, 'Zoo.txt'), 'z');
    writeFileSync(join(ws, 'apple.txt'), 'a');
    writeFileSync(join(ws, '.hidden'), 'h');
    const app = makeApp();
    const result = await get(app, 'list', { root: ws });
    assert.equal(result.status, 200);
    assert.equal(result.body.truncated, false);
    assert.deepEqual(
      result.body.entries.map((entry) => `${entry.type}:${entry.name}`),
      ['dir:Alpha', 'dir:beta', 'file:.hidden', 'file:apple.txt', 'file:zeta.txt', 'file:Zoo.txt'],
    );
    const hidden = result.body.entries.find((entry) => entry.name === '.hidden');
    assert.equal(hidden.hidden, true);
    const leaf = result.body.entries.find((entry) => entry.name === 'apple.txt');
    assert.equal(leaf.path, 'apple.txt');
    assert.ok(leaf.size > 0);
    assert.ok(leaf.mtimeMs > 0);
    assert.equal(typeof result.body.root, 'string');
    assert.equal(result.body.path, '');
    assertNoStore(result);
  });

  it('nul byte and non-string paths are bad-request; missing directory is not-found; file path is bad-request', async (t) => {
    const ws = tempDir(t);
    writeFileSync(join(ws, 'file.txt'), 'x');
    const app = makeApp();
    assert.equal((await get(app, 'list', { root: ws, path: 'a\0b' })).status, 400);
    assert.equal((await get(app, 'list', { root: ws, path: 'missing-dir' })).status, 404);
    const filePath = await get(app, 'list', { root: ws, path: 'file.txt' });
    assert.equal(filePath.status, 400);
    assert.equal(filePath.body.error.code, 'bad-request');
  });

  it('reports the hard entry cap as a documented constant (cap itself covered by test/host/list.test.mjs)', () => {
    assert.equal(MAX_LIST_ENTRIES, 4000);
  });
});
describe('file route byte/binary edge cases', () => {
  it('caps reads at 2 MiB and flags truncation on both sides of the boundary', async (t) => {
    const ws = tempDir(t);
    const exact = Buffer.alloc(MAX_FILE_BYTES, 0x61); // "a"
    writeFileSync(join(ws, 'exact.txt'), exact);
    const over = Buffer.alloc(MAX_FILE_BYTES + 1, 0x61);
    writeFileSync(join(ws, 'over.txt'), over);
    const app = makeApp();

    const exactResult = await get(app, 'file', { root: ws, path: 'exact.txt' });
    assert.equal(exactResult.status, 200);
    assert.equal(exactResult.body.truncated, false);
    assert.equal(exactResult.body.size, MAX_FILE_BYTES);
    assert.equal(exactResult.body.content.length, MAX_FILE_BYTES);

    const overResult = await get(app, 'file', { root: ws, path: 'over.txt' });
    assert.equal(overResult.status, 200);
    assert.equal(overResult.body.truncated, true);
    assert.equal(overResult.body.size, MAX_FILE_BYTES + 1);
    assert.equal(overResult.body.content.length, MAX_FILE_BYTES);
    assert.equal(overResult.body.binary, false);
  });

  it('detects binary by NUL byte in the read window and nulls content', async (t) => {
    const ws = tempDir(t);
    writeFileSync(join(ws, 'bin.dat'), Buffer.from([0x61, 0x62, 0x00, 0x63]));
    writeFileSync(join(ws, 'text.txt'), 'plain text\n');
    const app = makeApp();
    const binary = await get(app, 'file', { root: ws, path: 'bin.dat' });
    assert.equal(binary.status, 200);
    assert.equal(binary.body.binary, true);
    assert.equal(binary.body.content, null);
    // Documented limitation: a NUL only past the 2 MiB read window is not seen.
    const lateNul = Buffer.alloc(MAX_FILE_BYTES + 16, 0x61);
    lateNul[lateNul.length - 1] = 0;
    writeFileSync(join(ws, 'late-nul.txt'), lateNul);
    const late = await get(app, 'file', { root: ws, path: 'late-nul.txt' });
    assert.equal(late.status, 200);
    assert.equal(late.body.binary, false);
    assert.equal(late.body.truncated, true);
  });

  it('infers the language chip from the extension and serves directories as bad-request', async (t) => {
    const ws = tempDir(t);
    writeFileSync(join(ws, 'x.TS'), 'export {};\n');
    mkdirSync(join(ws, 'dir'));
    const app = makeApp();
    const ts = await get(app, 'file', { root: ws, path: 'x.TS' });
    assert.equal(ts.body.language, 'typescript');
    const dir = await get(app, 'file', { root: ws, path: 'dir' });
    assert.equal(dir.status, 400);
    assert.equal(dir.body.error.code, 'bad-request');
    const rootAsFile = await get(app, 'file', { root: ws });
    assert.equal(rootAsFile.status, 400);
  });
});

describe('save route adversarial behaviour', () => {
  it('overwrites an existing file, returns size/mtime, preserves mode, and creates nothing else', async (t) => {
    const ws = tempDir(t);
    const target = join(ws, 'notes.txt');
    writeFileSync(target, 'old\n', { mode: 0o640 });
    chmodSync(target, 0o640);
    const app = makeApp();
    const result = await postJson(app, 'save', { root: ws, path: 'notes.txt', content: 'new content\n' });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.path, 'notes.txt');
    assert.equal(result.body.size, 'new content\n'.length);
    assert.ok(result.body.mtimeMs > 0);
    assert.equal(readFileSync(target, 'utf8'), 'new content\n');
    assert.equal((await get(app, 'list', { root: ws })).body.entries.length, 1, 'no temp file left behind');
    assert.equal(Number(readFileSync(target).length), result.body.size);
  });

  it('refuses to create files, write directories/symlinks or accept empty/odd paths', async (t) => {
    const ws = tempDir(t);
    writeFileSync(join(ws, 'real.txt'), 'real\n');
    symlinkSync(join(ws, 'real.txt'), join(ws, 'link.txt'));
    mkdirSync(join(ws, 'dir'));
    const app = makeApp();

    assert.equal((await postJson(app, 'save', { root: ws, path: 'new.txt', content: 'x' })).status, 404);
    assert.equal((await postJson(app, 'save', { root: ws, path: 'missing/new.txt', content: 'x' })).status, 404);
    assert.equal((await postJson(app, 'save', { root: ws, path: 'dir', content: 'x' })).status, 400);
    assert.equal((await postJson(app, 'save', { root: ws, path: 'link.txt', content: 'x' })).status, 400);
    assert.equal((await postJson(app, 'save', { root: ws, path: '', content: 'x' })).status, 400);
    assert.equal((await postJson(app, 'save', { root: ws, path: 'real.txt', content: 42 })).status, 400);
    assert.equal((await postJson(app, 'save', { root: ws, path: 'real.txt' })).status, 400);
    assert.equal((await postJson(app, 'save', { path: 'real.txt', content: 'x' })).status, 400);
    assert.equal(readFileSync(join(ws, 'real.txt'), 'utf8'), 'real\n');
    assert.equal(readFileSync(join(ws, 'link.txt'), 'utf8'), 'real\n');
  });

  it('rejects malformed bodies and oversized bodies without touching the file', async (t) => {
    const ws = tempDir(t);
    const target = join(ws, 'guard.txt');
    writeFileSync(target, 'guard\n');
    const app = makeApp();

    const malformed = await call(app, 'save', '', { method: 'POST', body: 'not json at all' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'bad-request');

    const arrayBody = await call(app, 'save', '', { method: 'POST', body: '[1,2,3]' });
    assert.equal(arrayBody.status, 400);

    const hugeBody = JSON.stringify({ root: ws, path: 'guard.txt', content: 'x'.repeat(4 * 1024 * 1024 + 64) });
    const huge = await call(app, 'save', '', { method: 'POST', headers: { 'content-type': 'application/json' }, body: hugeBody });
    assert.equal(huge.status, 400);
    assert.equal(huge.body.error.code, 'bad-request');
    assert.match(huge.body.error.message, /limit/i);
    assert.equal(readFileSync(target, 'utf8'), 'guard\n');

    // Direct handler-level cap: content just above 4 MiB is rejected before any write.
    const { saveWorkspaceFile, readWorkspaceFile } = await import('../../lib/host/file.js');
    const workspace = { requestedRoot: ws, realRoot: ws };
    await assert.rejects(
      () => saveWorkspaceFile(workspace, 'guard.txt', 'x'.repeat(4 * 1024 * 1024 + 1)),
      (error) => /** @type {any} */ (error).status === 400 && /** @type {any} */ (error).code === 'bad-request',
    );
    assert.equal(readFileSync(target, 'utf8'), 'guard\n');
    const read = await readWorkspaceFile(workspace, 'guard.txt');
    assert.equal(read.status, 200);
  });
});

describe('search route adversarial behaviour', () => {
  /** Build a small search fixture tree. */
  function fixture(t) {
    const base = tempDir(t);
    const ws = join(base, 'ws');
    mkdirSync(ws);
    mkdirSync(join(ws, 'src'));
    mkdirSync(join(ws, 'src', 'nested'));
    mkdirSync(join(ws, 'skip'));
    mkdirSync(join(ws, 'node_modules'));
    mkdirSync(join(ws, '.git'));
    writeFileSync(join(ws, 'a.txt'), 'alpha beta\nALPHA\ncat concatenate\n');
    writeFileSync(join(ws, 'src', 'b.ts'), 'alpha in ts\n');
    writeFileSync(join(ws, 'src', 'nested', 'c.ts'), 'alpha nested\n');
    writeFileSync(join(ws, 'skip', 'd.md'), 'alpha skip\n');
    writeFileSync(join(ws, 'node_modules', 'x.js'), 'alpha node_modules\n');
    writeFileSync(join(ws, '.git', 'config'), 'alpha git\n');
    writeFileSync(join(ws, 'bin.dat'), Buffer.from('alpha\0binary\n', 'latin1'));
    writeFileSync(join(ws, 'utf.txt'), '😀 x foo\n');
    writeFileSync(join(ws, 'crlf.txt'), 'line1\r\nfoo bar\r\n');
    writeFileSync(join(ws, 'long.txt'), `${'x'.repeat(450)} needle\n`);
    writeFileSync(join(ws, 'empty.txt'), '');
    return { base, ws };
  }

  /** Find one file group by path. */
  function groupOf(body, path) {
    return (body.files ?? []).find((file) => file.path === path);
  }

  it('requires a non-empty q and rejects invalid regexes with bad-request', async (t) => {
    const { ws } = fixture(t);
    const app = makeApp();
    assert.equal((await get(app, 'search', { root: ws })).status, 400);
    assert.equal((await get(app, 'search', { root: ws, q: '' })).status, 400);
    const invalid = await get(app, 'search', { root: ws, q: '[', regex: '1' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'bad-request');
    assert.match(invalid.body.error.message, /regular expression/i);
    assertNoStore(invalid);
  });

  it('literal / regex / case / whole-word semantics match the contract', async (t) => {
    const { ws } = fixture(t);
    const app = makeApp();

    const literal = await get(app, 'search', { root: ws, q: 'alpha' });
    assert.equal(literal.status, 200);
    const literalPaths = literal.body.files.map((file) => file.path);
    assert.deepEqual(literalPaths, ['a.txt', 'skip/d.md', 'src/b.ts', 'src/nested/c.ts']);
    assert.ok(literal.body.totalMatches >= 3);
    assert.ok(!literalPaths.includes('node_modules/x.js'));
    assert.ok(!literalPaths.includes('.git/config'));
    assert.ok(!literalPaths.includes('bin.dat'));

    // Literal mode escapes regex metacharacters.
    const dotted = await get(app, 'search', { root: ws, q: 'a.p' });
    assert.equal(dotted.body.totalMatches, 0);
    const dots = await get(app, 'search', { root: ws, q: '.*' });
    assert.equal(dots.body.totalMatches, 0);

    const regex = await get(app, 'search', { root: ws, q: 'alp.a', regex: '1' });
    assert.ok(regex.body.totalMatches >= 3);

    const caseSensitive = await get(app, 'search', { root: ws, q: 'alpha', case: '1' });
    assert.deepEqual(caseSensitive.body.files.map((file) => file.path), ['a.txt', 'skip/d.md', 'src/b.ts', 'src/nested/c.ts']);
    assert.equal(groupOf(caseSensitive.body, 'a.txt').matches.length, 1);
    assert.equal(groupOf(caseSensitive.body, 'a.txt').matches[0].line, 1);

    const whole = await get(app, 'search', { root: ws, q: 'cat', whole: '1' });
    const wholeMatches = whole.body.files.flatMap((file) => file.matches);
    assert.equal(wholeMatches.length, 1);
    assert.equal(wholeMatches[0].column, 1);

    const wholeRegex = await get(app, 'search', { root: ws, q: '(cat|beta)', regex: '1', whole: '1' });
    assert.equal(wholeRegex.body.totalMatches, 2, 'cat + beta, both whole words');
    assert.deepEqual(wholeRegex.body.files.map((file) => file.path), ['a.txt']);

    // true/false flag spellings are accepted.
    const boolFlags = await get(app, 'search', { root: ws, q: 'alpha', case: 'true' });
    assert.equal(boolFlags.status, 200);
    const ignoredFlag = await get(app, 'search', { root: ws, q: 'alpha', case: 'maybe' });
    assert.equal(ignoredFlag.status, 200);
  });

  it('honours include/exclude globs, substrings and comma lists', async (t) => {
    const { ws } = fixture(t);
    const app = makeApp();

    const onlyTs = await get(app, 'search', { root: ws, q: 'alpha', include: '*.ts' });
    assert.deepEqual(onlyTs.body.files.map((file) => file.path).sort(), ['src/b.ts', 'src/nested/c.ts']);

    const srcGlob = await get(app, 'search', { root: ws, q: 'alpha', include: 'src/**' });
    assert.deepEqual(srcGlob.body.files.map((file) => file.path).sort(), ['src/b.ts', 'src/nested/c.ts']);

    const singleLevel = await get(app, 'search', { root: ws, q: 'alpha', include: 'src/*.ts' });
    assert.deepEqual(singleLevel.body.files.map((file) => file.path), ['src/b.ts']);

    const excluded = await get(app, 'search', { root: ws, q: 'alpha', exclude: 'src/**' });
    assert.ok(!excluded.body.files.some((file) => file.path.startsWith('src/')));

    const excludedGlob = await get(app, 'search', { root: ws, q: 'alpha', exclude: '**/c.ts' });
    assert.ok(!excludedGlob.body.files.some((file) => file.path === 'src/nested/c.ts'));

    const commaList = await get(app, 'search', { root: ws, q: 'alpha', include: '*.md,*.txt' });
    assert.deepEqual(commaList.body.files.map((file) => file.path).sort(), ['a.txt', 'skip/d.md']);

    const substringExclude = await get(app, 'search', { root: ws, q: 'alpha', exclude: 'skip' });
    assert.ok(!substringExclude.body.files.some((file) => file.path.startsWith('skip/')));
    assert.equal(substringExclude.status, 200);
  });

  it('skips binary, oversized, unreadable files and never follows symlinks out of the workspace', async (t) => {
    const { base, ws } = fixture(t);
    const outside = join(base, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'RARE-OUTSIDE-TOKEN\n');
    symlinkSync(join(outside, 'secret.txt'), join(ws, 'out-link.txt'));
    symlinkSync(outside, join(ws, 'out-dir'));
    writeFileSync(join(ws, 'unreadable.txt'), 'RARE-UNREADABLE-TOKEN\n');
    chmodSync(join(ws, 'unreadable.txt'), 0o000);
    mkdirSync(join(ws, 'private'));
    writeFileSync(join(ws, 'private', 'inside.txt'), 'RARE-PRIVATE-TOKEN\n');
    chmodSync(join(ws, 'private'), 0o000);
    const app = makeApp();

    const outsideToken = await get(app, 'search', { root: ws, q: 'RARE-OUTSIDE-TOKEN' });
    assert.equal(outsideToken.status, 200);
    assert.deepEqual(outsideToken.body.files, [], 'symlinked file outside must not be searched');

    const dirToken = await get(app, 'search', { root: ws, q: 'RARE-UNREADABLE-TOKEN' });
    assert.deepEqual(dirToken.body.files, []);

    const privateToken = await get(app, 'search', { root: ws, q: 'RARE-PRIVATE-TOKEN' });
    assert.deepEqual(privateToken.body.files, []);

    // Restore permissions before the cleanup hook removes the tree.
    chmodSync(join(ws, 'private'), 0o755);
    chmodSync(join(ws, 'unreadable.txt'), 0o600);

    // maxFileBytes: a correctly sized fixture is searched; a 10-byte ceiling skips it.
    const tight = await get(app, 'search', { root: ws, q: 'alpha', maxFileBytes: '10' });
    assert.equal(tight.status, 200);
    assert.deepEqual(tight.body.files, []);
    assert.ok(tight.body.scannedFiles <= 1, 'only the zero-byte file can pass a 10-byte ceiling');
  });

  it('reports 1-based UTF-16 line/column, strips CR, and caps snippets at 400 chars', async (t) => {
    const { ws } = fixture(t);
    const app = makeApp();

    const utf = await get(app, 'search', { root: ws, q: 'foo', include: 'utf.txt' });
    const utfMatch = groupOf(utf.body, 'utf.txt').matches[0];
    assert.equal(utfMatch.line, 1);
    assert.equal(utfMatch.column, 6, 'emoji counts as 2 UTF-16 units');
    assert.equal(utfMatch.length, 3);

    const crlf = await get(app, 'search', { root: ws, q: 'foo', include: 'crlf.txt' });
    const crlfMatch = groupOf(crlf.body, 'crlf.txt').matches[0];
    assert.equal(crlfMatch.line, 2);
    assert.equal(crlfMatch.column, 1);
    assert.equal(crlfMatch.text, 'foo bar');

    const long = await get(app, 'search', { root: ws, q: 'needle', include: 'long.txt' });
    const longMatch = groupOf(long.body, 'long.txt').matches[0];
    assert.ok(longMatch.text.length <= 400);
    assert.equal(longMatch.text.length, 400);
    assert.equal(longMatch.column, 452);
  });

  it('applies maxFiles / maxMatches / per-file caps and flags truncation', async (t) => {
    const base = tempDir(t);
    const ws = join(base, 'ws');
    mkdirSync(ws);
    for (let index = 0; index < 4; index += 1) {
      writeFileSync(join(ws, `f${index}.txt`), 'hit\n');
    }
    const app = makeApp();

    const fileCap = await get(app, 'search', { root: ws, q: 'hit', maxFiles: '2' });
    assert.equal(fileCap.status, 200);
    assert.equal(fileCap.body.files.length, 2);
    assert.equal(fileCap.body.truncated, true);

    const exactFiles = await get(app, 'search', { root: ws, q: 'hit', maxFiles: '4' });
    assert.equal(exactFiles.body.files.length, 4);
    assert.equal(exactFiles.body.truncated, false);

    const tenLines = Array.from({ length: 10 }, (_, index) => `hit ${index}`).join('\n');
    writeFileSync(join(ws, 'many.txt'), `${tenLines}\n`);
    const matchCap = await get(app, 'search', { root: ws, q: 'hit', include: 'many.txt', maxMatches: '3' });
    assert.equal(matchCap.body.totalMatches, 3);
    assert.equal(matchCap.body.truncated, true);

    const fortyOne = Array.from({ length: 41 }, () => 'hit').join('\n');
    writeFileSync(join(ws, 'forty-one.txt'), `${fortyOne}\n`);
    const perFile = await get(app, 'search', { root: ws, q: 'hit', include: 'forty-one.txt' });
    assert.equal(groupOf(perFile.body, 'forty-one.txt').matches.length, SEARCH_DEFAULTS.perFileMatches);
    assert.equal(perFile.body.truncated, true);
    assert.deepEqual(
      groupOf(perFile.body, 'forty-one.txt').matches.map((match) => match.line),
      Array.from({ length: SEARCH_DEFAULTS.perFileMatches }, (_, index) => index + 1),
    );
  });

  it('orders files by path and matches by line, and survives zero-length regex matches', async (t) => {
    const { ws } = fixture(t);
    const app = makeApp();
    const ordered = await get(app, 'search', { root: ws, q: 'alpha' });
    const paths = ordered.body.files.map((file) => file.path);
    assert.deepEqual(paths, [...paths].sort());
    for (const file of ordered.body.files) {
      const lines = file.matches.map((match) => match.line);
      assert.deepEqual(lines, [...lines].sort((left, right) => left - right));
    }

    writeFileSync(join(ws, 'no-a.txt'), 'bbb\n');
    const zeroLength = await get(app, 'search', { root: ws, q: 'x*', regex: '1', include: 'no-a.txt' });
    assert.equal(zeroLength.status, 200);
    assert.deepEqual(zeroLength.body.files, []);
  });
});

describe('ping verification channel', () => {
  it('appends one JSON line under $DSH_HOME/workspace-ide/status.jsonl and always answers ok', async (t) => {
    const home = tempDir(t);
    const previous = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    t.after(() => {
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
    });
    const app = makeApp();

    const first = await postJson(app, 'ping', { stage: 'apply', detail: { from: 'review' } });
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assertNoStore(first);

    const line = readFileSync(statusFilePath(process.env), 'utf8').trim();
    const record = JSON.parse(line);
    assert.equal(record.stage, 'apply');
    assert.deepEqual(record.detail, { from: 'review' });
    assert.equal(typeof record.pid, 'number');
    assert.ok(!Number.isNaN(Date.parse(record.at)));

    const garbage = await call(app, 'ping', '', { method: 'POST', body: 'not-json' });
    assert.equal(garbage.status, 200);
    assert.equal(garbage.body.ok, true);
    const empty = await call(app, 'ping', '', { method: 'POST', body: '' });
    assert.equal(empty.body.ok, true);

    const longStage = await postJson(app, 'ping', { stage: 's'.repeat(500), detail: 'd'.repeat(9000) });
    assert.equal(longStage.body.ok, true);
    const lines = readFileSync(statusFilePath(process.env), 'utf8').trim().split('\n');
    const longRecord = JSON.parse(lines[lines.length - 1]);
    assert.equal(longRecord.stage.length, 200);
    assert.ok(String(longRecord.detail).length <= 4000);
  });

  it('swallows filesystem failures (DSH_HOME points at a regular file)', async (t) => {
    const home = tempDir(t);
    const filePath = join(home, 'not-a-dir');
    writeFileSync(filePath, 'x');
    const previous = process.env.DSH_HOME;
    process.env.DSH_HOME = filePath;
    t.after(() => {
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
    });
    const app = makeApp();
    const result = await postJson(app, 'ping', { stage: 'panel' });
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
  });

  it('appendStatusRecord creates the directory and writes one line', async (t) => {
    const home = tempDir(t);
    await appendStatusRecord({ at: 'now', stage: 'x' }, { DSH_HOME: home });
    const content = readFileSync(statusFilePath({ DSH_HOME: home }), 'utf8').trim().split('\n');
    assert.equal(content.length, 1);
    assert.deepEqual(JSON.parse(content[0]), { at: 'now', stage: 'x' });
  });
});

describe('route table, registration and common HTTP behaviour', () => {
  it('exposes exactly the nine contracted Fetch routes', () => {
    const app = makeApp();
    assert.deepEqual(
      app.map((route) => [route.name, route.path, route.methods.join(','), route.requestBody]),
      [
        ['workspaces', '/api/dsh-workspace-ide.workspaces', 'GET', 'buffered'],
        ['list', '/api/dsh-workspace-ide.list', 'GET', 'buffered'],
        ['files', '/api/dsh-workspace-ide.files', 'GET', 'buffered'],
        ['file', '/api/dsh-workspace-ide.file', 'GET', 'buffered'],
        ['image', '/api/dsh-workspace-ide.image', 'GET', 'buffered'],
        ['search', '/api/dsh-workspace-ide.search', 'GET', 'buffered'],
        ['git', '/api/dsh-workspace-ide.git', 'GET', 'buffered'],
        ['save', '/api/dsh-workspace-ide.save', 'POST', 'buffered'],
        ['ping', '/api/dsh-workspace-ide.ping', 'POST', 'buffered'],
      ],
    );
    for (const route of app) {
      assert.equal(typeof route.fetch, 'function');
      assert.equal(Object.isFrozen(route), true, 'route descriptors are frozen');
    }
  });

  it('registers every route through ctx.effect and degrades without the Fetch service', async () => {
    const registered = [];
    const disposed = [];
    const ctx = {
      get() { return undefined; },
      effect(callback, label) {
        const dispose = callback();
        disposed.push({ label, dispose });
        return dispose;
      },
      connection: {
        fetch: {
          register(route) {
            registered.push(route);
            return () => {};
          },
        },
      },
    };
    const { registerRoutes } = await import('../../lib/host/routes.js');
    registerRoutes(ctx);
    assert.equal(registered.length, 9);
    assert.equal(disposed.length, 9);
    assert.ok(disposed.every((entry) => typeof entry.label === 'string' && entry.label.includes('dsh-workspace-ide')));

    const withoutConnection = { get() { return undefined; } };
    assert.doesNotThrow(() => registerRoutes(withoutConnection));
    assert.doesNotThrow(() => registerRoutes(null));
    assert.doesNotThrow(() => registerRoutes({ connection: { fetch: { register: () => { throw new Error('boom'); } } } }));
  });

  it('every route answer, including failures, is JSON with cache-control: no-store', async (t) => {
    const ws = tempDir(t);
    // The ping route writes under $DSH_HOME; isolate it so a test run never
    // appends to the developer's real status log.
    const home = tempDir(t);
    const previous = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    t.after(() => {
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
    });
    const app = makeApp();
    const cases = [
      await get(app, 'workspaces'),
      await get(app, 'list', { root: ws }),
      await get(app, 'file', { root: ws, path: 'missing.txt' }),
      await get(app, 'search', { root: ws }),
      await get(app, 'git', { root: ws }),
      await postJson(app, 'save', { root: ws, path: 'missing.txt', content: 'x' }),
      await postJson(app, 'ping', {}),
    ];
    for (const result of cases) assertNoStore(result);
  });
});
