/**
 * Full-text search tests: literal/regex/case/whole-word matching, include and
 * exclude filters, binary/oversized skips, scan caps, ordering and exact
 * line/column reporting (UTF-16 code units).
 */

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  SEARCH_DEFAULTS,
  createLineMatcher,
  matchGlob,
  searchWorkspace,
  splitPatterns,
} from '../../lib/host/search.js';
import { call, encode, makeApp, temporaryDirectory } from './support.mjs';

/**
 * Run the search route.
 * @param app - routes.
 * @param root - workspace root.
 * @param query - raw query string without the leading `?`.
 * @returns the decoded response.
 */
async function search(app, root, query) {
  return call(app, 'search', `?root=${encode(root)}&${query}`);
}

/**
 * Run the search core directly (for cap/per-file options).
 * @param root - workspace root.
 * @param options - search options.
 * @returns the result payload.
 */
async function searchCore(root, options) {
  return searchWorkspace({ requestedRoot: root, realRoot: root }, options);
}

describe('line matcher', () => {
  it('matches literally, case-insensitively by default', () => {
    const matcher = createLineMatcher({ query: 'hello', regex: false, caseSensitive: false, whole: false });
    assert.deepEqual(matcher('Hello hello HELLO'), [
      { column: 0, length: 5 },
      { column: 6, length: 5 },
      { column: 12, length: 5 },
    ]);
  });

  it('is case-sensitive when asked', () => {
    const matcher = createLineMatcher({ query: 'Hello', regex: false, caseSensitive: true, whole: false });
    assert.deepEqual(matcher('Hello hello'), [{ column: 0, length: 5 }]);
  });

  it('enforces whole words', () => {
    const matcher = createLineMatcher({ query: 'hello', regex: false, caseSensitive: false, whole: true });
    assert.deepEqual(matcher('hello helloWorld _hello hello_'), [{ column: 0, length: 5 }]);
  });

  it('escapes literal regex metacharacters', () => {
    const matcher = createLineMatcher({ query: 'a.b(c)', regex: false, caseSensitive: true, whole: false });
    assert.deepEqual(matcher('xa.b(c)y'), [{ column: 1, length: 6 }]);
    assert.deepEqual(matcher('axb(c)'), []);
  });

  it('compiles regular expressions', () => {
    const matcher = createLineMatcher({ query: 'h.llo', regex: true, caseSensitive: false, whole: false });
    assert.deepEqual(matcher('say hello'), [{ column: 4, length: 5 }]);
  });

  it('rejects invalid regular expressions', () => {
    assert.throws(
      () => createLineMatcher({ query: 'hello(', regex: true, caseSensitive: false, whole: false }),
      (error) => /** @type {any} */ (error).status === 400 && /** @type {any} */ (error).code === 'bad-request',
    );
  });

  it('rejects an empty query', () => {
    assert.throws(() => createLineMatcher({ query: '', regex: false }), (error) => /** @type {any} */ (error).status === 400);
  });
});

describe('glob matching', () => {
  it('treats patterns without glob metacharacters as substrings', () => {
    assert.equal(matchGlob('src/a.ts', 'src'), true);
    assert.equal(matchGlob('lib/a.ts', 'src'), false);
  });

  it('matches basename globs and path globs', () => {
    assert.equal(matchGlob('src/a.ts', '*.ts'), true);
    assert.equal(matchGlob('src/a.js', '*.ts'), false);
    assert.equal(matchGlob('src/deep/a.ts', 'src/**'), true);
    assert.equal(matchGlob('src/deep/a.ts', '**/*.ts'), true);
    assert.equal(matchGlob('src/a.ts', 'src/*.ts'), true);
    assert.equal(matchGlob('src/deep/a.ts', 'src/*.ts'), false);
    assert.equal(matchGlob('a.ts', '**/*.ts'), true);
    assert.equal(matchGlob('a.ts', '?.ts'), true);
  });

  it('splits comma-separated patterns', () => {
    assert.deepEqual(splitPatterns('*.ts, src/** ,, '), ['*.ts', 'src/**']);
    assert.deepEqual(splitPatterns(''), []);
    assert.deepEqual(splitPatterns(undefined), []);
  });
});

describe('GET search', () => {
  it('returns matches with 1-based line and column, length and snippet', async (t) => {
    const root = temporaryDirectory(t);
    writeFileSync(join(root, 'a.txt'), 'Hello world\nsecond line Hello\n');
    writeFileSync(join(root, 'b.txt'), 'no match here\n');
    const { status, body } = await search(makeApp(), root, 'q=hello');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.root, root);
    assert.equal(body.query, 'hello');
    assert.deepEqual(body.options, {
      regex: false,
      case: false,
      whole: false,
      include: '',
      exclude: '',
      maxFiles: 400,
      maxMatches: 500,
      maxFileBytes: 1024 * 1024,
    });
    assert.equal(body.totalMatches, 2);
    assert.equal(body.scannedFiles, 2);
    assert.equal(typeof body.scannedBytes, 'number');
    assert.equal(body.truncated, false);
    assert.equal(typeof body.elapsedMs, 'number');
    assert.deepEqual(body.files, [
      {
        path: 'a.txt',
        matches: [
          { line: 1, column: 1, length: 5, text: 'Hello world' },
          { line: 2, column: 13, length: 5, text: 'second line Hello' },
        ],
      },
    ]);
  });

  it('honours case and whole-word flags', async (t) => {
    const caseRoot = temporaryDirectory(t);
    writeFileSync(join(caseRoot, 'a.txt'), 'hello HELLO Hello\n');
    assert.equal((await search(makeApp(), caseRoot, 'q=hello&case=1')).body.totalMatches, 1);
    assert.equal((await search(makeApp(), caseRoot, 'q=HELLO&case=1')).body.totalMatches, 1);
    assert.equal((await search(makeApp(), caseRoot, 'q=hello&case=0')).body.totalMatches, 3);
    const wordRoot = temporaryDirectory(t);
    writeFileSync(join(wordRoot, 'a.txt'), 'hello helloWorld _hello hello_\n');
    assert.equal((await search(makeApp(), wordRoot, 'q=hello&whole=1')).body.totalMatches, 1);
    assert.equal((await search(makeApp(), wordRoot, 'q=helloWorld&whole=1')).body.totalMatches, 1);
    assert.equal((await search(makeApp(), wordRoot, 'q=hello&whole=0')).body.totalMatches, 4);
  });

  it('supports regex queries and rejects malformed ones', async (t) => {
    const root = temporaryDirectory(t);
    writeFileSync(join(root, 'a.txt'), 'alpha\nsecond line\n');
    assert.equal((await search(makeApp(), root, 'q=h.llo&regex=1')).body.totalMatches, 0);
    const regexHit = await search(makeApp(), root, `q=${encodeURIComponent('^second')}&regex=1`);
    assert.equal(regexHit.body.totalMatches, 1);
    assert.equal(regexHit.body.files[0].matches[0].line, 2);
    const invalid = await search(makeApp(), root, `q=${encodeURIComponent('hello(')}&regex=1`);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error.code, 'bad-request');
  });

  it('requires a non-empty q', async (t) => {
    const root = temporaryDirectory(t);
    const missing = await call(makeApp(), 'search', `?root=${encode(root)}`);
    assert.equal(missing.status, 400);
    const empty = await search(makeApp(), root, 'q=');
    assert.equal(empty.status, 400);
  });

  it('skips default excluded names and applies include/exclude filters', async (t) => {
    const root = temporaryDirectory(t);
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, 'a.ts'), 'needle\n');
    writeFileSync(join(root, 'b.js'), 'needle\n');
    writeFileSync(join(root, 'src', 'c.ts'), 'needle\n');
    writeFileSync(join(root, 'node_modules', 'pkg', 'x.js'), 'needle\n');
    writeFileSync(join(root, '.git', 'config'), 'needle\n');
    writeFileSync(join(root, '.DS_Store'), 'needle\n');
    const all = await search(makeApp(), root, 'q=needle');
    assert.deepEqual(all.body.files.map((file) => file.path), ['a.ts', 'b.js', 'src/c.ts']);
    const included = await search(makeApp(), root, `q=needle&include=${encode('*.ts')}`);
    assert.deepEqual(included.body.files.map((file) => file.path), ['a.ts', 'src/c.ts']);
    const pathGlob = await search(makeApp(), root, `q=needle&include=${encode('src/**')}`);
    assert.deepEqual(pathGlob.body.files.map((file) => file.path), ['src/c.ts']);
    const excluded = await search(makeApp(), root, `q=needle&exclude=${encode('src')}`);
    assert.deepEqual(excluded.body.files.map((file) => file.path), ['a.ts', 'b.js']);
  });

  it('skips binary files and files above maxFileBytes', async (t) => {
    const root = temporaryDirectory(t);
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0x68, 0x69, 0x00, 0x6c, 0x6c, 0x6f]));
    writeFileSync(join(root, 'large.txt'), `needle ${'x'.repeat(2 * 1024 * 1024)}`);
    writeFileSync(join(root, 'small.txt'), 'needle\n');
    const defaults = await search(makeApp(), root, 'q=needle');
    assert.deepEqual(defaults.body.files.map((file) => file.path), ['small.txt']);
    const raised = await search(makeApp(), root, `q=needle&maxFileBytes=${3 * 1024 * 1024}`);
    assert.deepEqual(raised.body.files.map((file) => file.path), ['large.txt', 'small.txt']);
  });

  it('orders files by path and matches by line', async (t) => {
    const root = temporaryDirectory(t);
    writeFileSync(join(root, 'b.txt'), 'hit\n');
    writeFileSync(join(root, 'a.txt'), 'hit\nhit\n');
    const { body } = await search(makeApp(), root, 'q=hit');
    assert.deepEqual(body.files.map((file) => file.path), ['a.txt', 'b.txt']);
    assert.deepEqual(body.files[0].matches.map((match) => match.line), [1, 2]);
  });

  it('counts columns in UTF-16 code units', async (t) => {
    const root = temporaryDirectory(t);
    writeFileSync(join(root, 'utf16.txt'), '\u{1F600} hello\n\u00e9 hello\n');
    const { body } = await search(makeApp(), root, 'q=hello');
    assert.deepEqual(body.files[0].matches.map((match) => [match.line, match.column]), [[1, 4], [2, 3]]);
  });

  it('skips unreadable files instead of failing', async (t) => {
    const root = temporaryDirectory(t);
    const unreadable = join(root, 'secret.txt');
    writeFileSync(unreadable, 'needle\n');
    chmodSync(unreadable, 0o000);
    writeFileSync(join(root, 'open.txt'), 'needle\n');
    const { status, body } = await search(makeApp(), root, 'q=needle');
    assert.equal(status, 200);
    assert.deepEqual(body.files.map((file) => file.path), ['open.txt']);
  });

  it('caps matching files/matches and per-file matches', async (t) => {
    const root = temporaryDirectory(t);
    for (let index = 0; index < 4; index += 1) {
      writeFileSync(join(root, `f${index}.txt`), 'hit\n'.repeat(10));
    }
    const cappedMatches = await searchCore(root, { query: 'hit', maxMatches: 2, maxFiles: 100 });
    assert.equal(cappedMatches.totalMatches, 2);
    assert.equal(cappedMatches.files.length, 1);
    assert.equal(cappedMatches.truncated, true);

    const cappedFiles = await searchCore(root, { query: 'hit', maxFiles: 1, maxMatches: 100 });
    assert.equal(cappedFiles.scannedFiles, 1);
    assert.equal(cappedFiles.truncated, true);
    assert.equal(cappedFiles.files.length, 1);

    const perFile = await searchCore(root, { query: 'hit', perFileMatches: 3 });
    assert.equal(perFile.files.length, 4);
    assert.equal(perFile.files[0].matches.length, 3);
    assert.equal(perFile.totalMatches, 12);
    assert.equal(perFile.truncated, true);

    assert.equal(SEARCH_DEFAULTS.perFileMatches, 40);
  });
});
