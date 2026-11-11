/**
 * REGRESSION probes for a defect the independent review found in the shipped
 * Client diff renderer (fixed in Lead integration; these three now PASS).
 *
 * `parseDiffLines`/`classifyDiffLine` decide a line's kind from its first
 * characters only, without remembering whether the parser is inside a hunk.
 * Unified-diff body lines are prefixed with one `+`/`-`, so:
 *
 *   - deleting a line whose content starts with `-- ` produces `--- …`, which
 *     is classified as a `--- ` FILE HEADER (`meta`) instead of a deletion;
 *   - adding a line whose content starts with `++ ` produces `+++ …`, which is
 *     also swallowed as a header.
 *
 * Worse, `meta` resets `insideHunk`, so every following row in the same hunk
 * loses its old/new line numbers until the next hunk header. SQL (`-- comment`),
 * Haskell/Lua (`-- comment`) or any content with that prefix triggers it.
 *
 * The contract says `+` lines render green, `-` lines red and only real file
 * headers are muted. These tests encode the contract and therefore FAIL until
 * the implementation becomes hunk-aware. They are intentionally excluded from
 * the pass/fail "all good" set and live here to make the defect reproducible.
 *
 * Run with: node --test test/review/client-diff-defect.test.mjs
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT = path.join(HERE, '..', '..', 'lib', 'client.js');

/** Load the shipped client artifact and expose the internal S object. */
function loadClient() {
  const source = readFileSync(ARTIFACT, 'utf8');
  const instrumented = source.replace('    return S.face;', '    return S;');
  assert.notEqual(instrumented, source);
  let definition = null;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(def) {
          definition = def;
        },
      },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      addEventListener() {},
      removeEventListener() {},
    },
    document: null,
    navigator: { language: 'en-US' },
    AbortController,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(instrumented, sandbox, { filename: 'lib/client.js' });
  const react = {
    Component: class {},
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (value) => ({ current: value }),
    useEffect() {},
    useCallback: (callback) => callback,
    useMemo: (factory) => factory(),
  };
  return definition.factory(() => react);
}

/** A one-file hunk that deletes the SQL comment `-- old comment`. */
const SQL_COMMENT_HUNK = [
  'diff --git a/notes.sql b/notes.sql',
  'index 1111111..2222222 100644',
  '--- a/notes.sql',
  '+++ b/notes.sql',
  '@@ -1,3 +1,2 @@',
  ' SELECT 1;',
  '--- old comment',
  ' SELECT 3;',
  '',
].join('\n');

describe('diff renderer defect (expected failures)', () => {
  it('CONTRACT: a deleted line whose content starts with "-- " stays a deletion row', () => {
    const S = loadClient();
    const rows = S.parseDiffLines(SQL_COMMENT_HUNK);
    const deleted = rows.find((row) => row.text === '--- old comment');
    assert.ok(deleted, 'the deleted SQL comment appears in the parsed rows');
    assert.equal(deleted.kind, 'del', 'contract: deletion lines are red, not muted headers');
  });

  it('CONTRACT: a hunk keeps old/new numbering after a "-- "-prefixed deletion', () => {
    const S = loadClient();
    const rows = S.parseDiffLines(SQL_COMMENT_HUNK);
    const context = rows.find((row) => row.text === ' SELECT 3;');
    assert.ok(context, 'the trailing context line appears');
    assert.equal(context.oldNo, 3, 'old line number continues after a deletion');
    // The hunk header is -1,3 +1,2 (the deletion consumes one old line only), so
    // the trailing context line is new line 2; a parser that guessed by prefix
    // returns null here.
    assert.equal(context.newNo, 2, 'new line number continues after a deletion');
  });

  it('CONTRACT: an added line whose content starts with "++ " stays an addition row', () => {
    const S = loadClient();
    const diff = [
      'diff --git a/notes.sql b/notes.sql',
      '--- a/notes.sql',
      '+++ b/notes.sql',
      '@@ -1,1 +1,2 @@',
      ' SELECT 1;',
      '+++ header comment',
      '',
    ].join('\n');
    const rows = S.parseDiffLines(diff);
    const added = rows.find((row) => row.text === '+++ header comment');
    assert.ok(added, 'the added line appears in the parsed rows');
    assert.equal(added.kind, 'add', 'contract: addition lines are green, not muted headers');
    assert.equal(added.newNo, 2);
  });
});
