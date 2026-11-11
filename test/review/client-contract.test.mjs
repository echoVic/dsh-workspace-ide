/**
 * Independent adversarial review tests for the dsh-workspace-ide Client half.
 *
 * The shipped `lib/client.js` is a browser module, so this test loads it in a
 * `node:vm` context with a fake `window.__ModuleLoader__` and a fake React
 * (plain element objects + hooks), then exercises the module face, the HTTP
 * helper (network failure / AbortError / envelope handling), the search
 * highlight (XSS), the diff parser/renders, the error boundary, i18n coverage
 * and the pure helpers.
 *
 * It never boots DSH, never installs the plugin and never touches the network.
 *
 * Run with: node --test test/review/
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..', '..');
const ARTIFACT = path.join(PROJECT, 'lib', 'client.js');
const SOURCE_FILES = ['00-core.js', '10-shell.js', '20-files.js', '30-search.js', '40-git.js', '99-face.js'];

// ─── fake React ──────────────────────────────────────────────────────────────

/** Flatten nested child arrays the way React would. */
function flatten(children) {
  const out = [];
  for (const child of children) {
    if (Array.isArray(child)) out.push(...flatten(child));
    else if (child !== null && child !== undefined && child !== false && child !== true) out.push(child);
  }
  return out;
}

/** Minimal fake React with the hooks the bundle uses. */
function createFakeReact() {
  class Component {
    constructor(props) {
      this.props = props === undefined || props === null ? {} : props;
      this.state = {};
    }

    setState(patch) {
      const next = typeof patch === 'function' ? patch(this.state) : patch;
      this.state = Object.assign({}, this.state, next);
    }
  }
  return {
    Component,
    createElement(type, props, ...children) {
      const flat = flatten(children);
      const elementProps = Object.assign({}, props === undefined || props === null ? {} : props);
      if (flat.length > 0) elementProps.children = flat.length === 1 ? flat[0] : flat;
      return { type, props: elementProps, children: flat };
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}];
    },
    useRef(value) {
      return { current: value };
    },
    useEffect() {},
    useCallback(callback) {
      return callback;
    },
    useMemo(factory) {
      return factory();
    },
  };
}

// ─── storage / DOM stubs ─────────────────────────────────────────────────────

/** A tiny Map-backed localStorage. */
function createStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
    dump() {
      return Object.fromEntries(data);
    },
  };
}

/**
 * Load the shipped client artifact into a vm context.
 *
 * The only in-memory change is turning the factory footer `return S.face;`
 * into `return S;` so the review can reach internal helpers; the committed
 * artifact itself is never modified.
 */
function loadClient(options = {}) {
  const source = readFileSync(ARTIFACT, 'utf8');
  const instrumented = source.replace('    return S.face;', '    return S;');
  assert.notEqual(instrumented, source, 'instrumentation seam must exist exactly once');
  assert.equal(source.split('    return S.face;').length - 1, 1);

  let definition = null;
  const fakeReact = createFakeReact();
  const storage = options.storage ?? createStorage();
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(def) {
          definition = def;
        },
      },
      localStorage: storage,
      addEventListener() {},
      removeEventListener() {},
    },
    document: null,
    navigator: { language: options.language ?? 'en-US' },
    localStorage: storage,
    fetch: options.fetch,
    AbortController,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    console,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(instrumented, context, { filename: 'lib/client.js' });
  assert.ok(definition !== null, 'module face must be registered with the loader');
  assert.equal(definition.id, 'dsh-workspace-ide');
  const S = definition.factory((name) => {
    assert.equal(name, 'react', 'the only allowed require() is react');
    return fakeReact;
  });
  return { S, sandbox, storage, fakeReact, definition };
}

// ─── cross-realm helpers ────────────────────────────────────────────────────

/** Convert a value created inside the vm realm into plain host-realm JSON. */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// ─── render walkers ──────────────────────────────────────────────────────────

/**
 * Execute a component tree (functions/classes) with the fake React and return
 * the rendered element tree. Effects are not committed; state stays initial.
 */
function renderTree(node, depth = 0) {
  if (depth > 120) throw new Error('renderTree depth exceeded');
  if (node === null || node === undefined || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map((child) => renderTree(child, depth + 1));
  if (node.type === undefined) return node;
  const type = node.type;
  if (typeof type === 'string') {
    return { type: node.type, props: node.props, children: renderTree(node.children, depth + 1) };
  }
  if (typeof type === 'function') {
    const isClass = type.prototype !== undefined && type.prototype !== null && typeof type.prototype.render === 'function';
    const rendered = isClass ? new type(node.props).render() : type(node.props);
    return renderTree(rendered, depth + 1);
  }
  return node;
}

/** Walk an element tree, calling visit(element) for every element. */
function walkElements(node, visit) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((child) => walkElements(child, visit));
    return;
  }
  if (typeof node !== 'object') return;
  if (node.type === undefined) return;
  visit(node);
  walkElements(node.children, visit);
}

/** Collect every text node in a rendered tree. */
function collectText(node, out = []) {
  if (node === null || node === undefined || node === false) return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectText(child, out));
    return out;
  }
  if (typeof node === 'object') collectText(node.children, out);
  return out;
}

// ─── module face ────────────────────────────────────────────────────────────

/** Fake Host context capturing slot registrations and locale wiring. */
function makeClientContext(options = {}) {
  const injectors = new Map();
  const effects = [];
  const localeCalls = [];
  const ctx = {
    slots: {
      inject(name, callback) {
        injectors.set(name, callback);
      },
      register(definition, component) {
        return { definition, component };
      },
    },
    effect(callback, label) {
      effects.push({ label, dispose: callback() });
      return () => {};
    },
    get(name) {
      if (options.getThrows === true) throw new Error(`get(${name}) exploded`);
      if (name === 'locale' && options.locale !== undefined) return options.locale;
      return undefined;
    },
  };
  const registered = {};
  for (const [name, callback] of injectors) registered[name] = callback();
  return { ctx, injectors, registered, effects, localeCalls };
}

const DICT_KEYS = ['panel', 'tabs.files', 'tabs.search', 'tabs.git', 'crash.title', 'files.open.title'];

describe('module face', () => {
  it('injects slots and registers a rail icon + main panel with the same workspace-ide id/key', () => {
    const { S } = loadClient();
    assert.deepEqual(Array.from(S.face.inject), ['slots']);
    assert.equal(typeof S.face.apply, 'function');

    const pending = {};
    const ctx = {
      slots: {
        inject(name, callback) {
          pending[name] = callback;
        },
        register(definition, component) {
          return { definition, component };
        },
      },
      effect() {},
      get() {
        return undefined;
      },
    };
    assert.equal(S.face.apply(ctx), undefined);
    assert.deepEqual(Object.keys(pending).sort(), ['main', 'sidebar.panellist']);
    const sidebar = pending['sidebar.panellist']();
    const main = pending.main();
    assert.equal(sidebar.definition.name, 'sidebar.panellist');
    assert.equal(sidebar.definition.id, 'workspace-ide');
    assert.equal(main.definition.name, 'main');
    assert.equal(main.definition.key, 'workspace-ide');
    assert.equal(sidebar.definition.id, main.definition.key, 'rail id must address the main key');
    assert.equal(typeof sidebar.component, 'function');
    assert.equal(typeof main.component, 'function');
    assert.equal(typeof sidebar.definition.label, 'function');
    assert.equal(typeof sidebar.definition.label(), 'string');
    // The rail icon renders an SVG at the requested size.
    const icon = sidebar.component({ size: 18, active: true });
    assert.equal(icon.type, 'svg');
    assert.equal(icon.props.width, 18);
    assert.equal(icon.props.height, 18);
  });

  it('renders the main panel component without throwing when the slot offers no hooks', () => {
    const { S, sandbox } = loadClient({ language: 'en-US' });
    const ctx = makeClientContext();
    S.face.apply(ctx.ctx);
    const main = ctx.injectors.get('main')();
    const element = main.component({ t: (key) => key });
    const rendered = renderTree(element);
    const text = collectText(rendered).join('\n');
    assert.ok(text.length > 0, 'panel renders visible content');
    assert.ok(sandbox.window.__ModuleLoader__ !== undefined);
    // The three tab labels are present (they are data-tab markers + labels).
    const markers = [];
    walkElements(rendered, (node) => {
      if (node.props['data-tab'] !== undefined) markers.push(node.props['data-tab']);
    });
    assert.deepEqual(markers, ['files', 'search', 'git']);
  });

  it('uses the optional locale service when present and falls back cleanly when it throws', () => {
    const { S } = loadClient({ language: 'zh-CN' });
    const registered = {};
    const effects = [];
    const bound = (namespace) => (key) => `LOCALE:${namespace}:${key}`;
    const locale = {
      registrations: [],
      register(namespace, dictionary) {
        this.registrations.push({ namespace, dictionary });
        return () => {};
      },
      bind: bound,
    };
    const ctx = {
      slots: {
        inject(name, callback) {
          registered[name] = callback();
        },
        register(definition, component) {
          return { definition, component };
        },
      },
      effect(callback, label) {
        effects.push({ label, dispose: callback() });
      },
      get(name) {
        return name === 'locale' ? locale : undefined;
      },
    };
    S.face.apply(ctx);
    assert.equal(locale.registrations.length, 1);
    assert.equal(locale.registrations[0].namespace, 'dsh-workspace-ide');
    assert.ok(locale.registrations[0].dictionary.zh && locale.registrations[0].dictionary.en);
    assert.equal(registered['sidebar.panellist'].definition.locale, 'dsh-workspace-ide');
    assert.equal(registered.main.definition.locale, 'dsh-workspace-ide');
    assert.equal(registered['sidebar.panellist'].definition.label(), 'LOCALE:dsh-workspace-ide:panel');
    assert.equal(effects.length, 1);
    assert.match(effects[0].label, /dictionar/i);
    assert.equal(typeof effects[0].dispose, 'function');

    // A locale service whose register() throws must not break activation.
    const throwing = {
      register() {
        throw new Error('locale exploded');
      },
      bind() {
        throw new Error('bind exploded');
      },
    };
    const ctx2 = {
      slots: {
        inject(name, callback) {
          registered[name] = callback();
        },
        register(definition, component) {
          return { definition, component };
        },
      },
      effect() {},
      get(name) {
        return name === 'locale' ? throwing : undefined;
      },
    };
    assert.doesNotThrow(() => S.face.apply(ctx2));
    assert.equal(registered['sidebar.panellist'].definition.locale, undefined);
    assert.equal(registered['sidebar.panellist'].definition.label(), '工作区', 'built-in zh dictionary is the fallback');
  });

  it('survives a Host context whose get() throws', () => {
    const { S } = loadClient({ language: 'en-US' });
    const registeredByName = {};
    const ctx = {
      slots: {
        inject(name, callback) {
          registeredByName[name] = callback();
        },
        register(definition, component) {
          return { definition, component };
        },
      },
      effect() {},
      get() {
        throw new Error('ctx.get exploded');
      },
    };
    assert.doesNotThrow(() => S.face.apply(ctx));
    assert.equal(registeredByName['sidebar.panellist'].definition.id, 'workspace-ide');
    assert.equal(registeredByName.main.definition.key, 'workspace-ide');
  });
});

// ─── requestJson: failure / abort semantics ─────────────────────────────────

describe('requestJson failure handling', () => {
  it('returns a success envelope unchanged', async () => {
    const { S, sandbox } = loadClient();
    sandbox.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: 7 }) });
    const payload = await S.requestJson('api/test');
    assert.deepEqual(payload, { ok: true, value: 7 });
  });

  it('wraps a network rejection in a RequestFailure with code network', async () => {
    const { S, sandbox } = loadClient();
    sandbox.fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await assert.rejects(
      () => S.requestJson('api/test'),
      (error) => {
        const failure = /** @type {any} */ (error);
        assert.ok(failure instanceof S.RequestFailure);
        assert.equal(failure.code, 'network');
        assert.equal(failure.message, 'Failed to fetch');
        return true;
      },
    );
  });

  it('rethrows an AbortError unchanged so callers can recognise cancellation', async () => {
    const { S, sandbox } = loadClient();
    const abort = new Error('The operation was aborted.');
    abort.name = 'AbortError';
    sandbox.fetch = async () => {
      throw abort;
    };
    await assert.rejects(
      () => S.requestJson('api/test', { signal: new AbortController().signal }),
      (error) => error === abort,
    );

    // An abort while reading the JSON body is also rethrown as the abort.
    const bodyAbort = new Error('aborted during body');
    bodyAbort.name = 'AbortError';
    sandbox.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw bodyAbort;
      },
    });
    await assert.rejects(() => S.requestJson('api/test'), (error) => error === bodyAbort);
  });

  it('turns ok:false envelopes into RequestFailure with the Host code', async () => {
    const { S, sandbox } = loadClient();
    sandbox.fetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ ok: false, error: { code: 'outside-workspace', message: 'escaped' } }),
    });
    await assert.rejects(
      () => S.requestJson('api/test'),
      (error) => /** @type {any} */ (error) instanceof S.RequestFailure && /** @type {any} */ (error).code === 'outside-workspace' && /** @type {any} */ (error).message === 'escaped',
    );

    sandbox.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, error: { code: 'git-failed', message: 'bad revision' } }),
    });
    await assert.rejects(
      () => S.requestJson('api/test'),
      (error) => /** @type {any} */ (error).code === 'git-failed' && /** @type {any} */ (error).message === 'bad revision',
    );
  });

  it('rejects non-JSON bodies and non-ok statuses instead of returning data', async () => {
    const { S, sandbox } = loadClient();
    sandbox.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    });
    await assert.rejects(() => S.requestJson('api/test'), (error) => /** @type {any} */ (error).code === 'http-200');

    sandbox.fetch = async () => ({ ok: false, status: 500, json: async () => ({ ok: true }) });
    await assert.rejects(() => S.requestJson('api/test'), (error) => /** @type {any} */ (error).code === 'http-500');
  });

  it('serialises POST bodies, passes the AbortSignal through and rejects unserialisable bodies', async () => {
    const { S, sandbox } = loadClient();
    const seen = [];
    sandbox.fetch = async (url, init) => {
      seen.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };
    const signal = new AbortController().signal;
    await S.requestJson('api/save', { method: 'POST', body: { a: 1 }, signal });
    assert.equal(seen[0].init.method, 'POST');
    assert.equal(seen[0].init.headers['content-type'], 'application/json');
    assert.equal(seen[0].init.body, JSON.stringify({ a: 1 }));
    assert.equal(seen[0].init.signal, signal);

    await S.requestJson('api/save', { body: { a: 1 } });
    assert.equal(seen[1].init.method, 'POST', 'a body implies POST');

    const circular = { a: 1 };
    circular.self = circular;
    const before = seen.length;
    await assert.rejects(() => S.requestJson('api/save', { body: circular }), (error) => /** @type {any} */ (error).code === 'bad-body');
    assert.equal(seen.length, before, 'unserialisable bodies never reach fetch');
  });

  it('keeps ping fire-and-forget: sync throws, rejections and a missing fetch never propagate', () => {
    const { S, sandbox } = loadClient();
    sandbox.fetch = () => {
      throw new Error('sync boom');
    };
    assert.doesNotThrow(() => S.ping('apply', { anything: true }));
    sandbox.fetch = () => Promise.reject(new Error('async boom'));
    assert.doesNotThrow(() => S.ping('panel'));
    delete sandbox.fetch;
    assert.doesNotThrow(() => S.ping('panel'));
  });
});

// ─── search highlight: no HTML injection ────────────────────────────────────

describe('search highlighting is text-only (no XSS)', () => {
  it('renders <mark> from JS slices, never from HTML strings', () => {
    const { S } = loadClient({ language: 'en-US' });
    const hostile = '<img src=x onerror=alert(1)>PAYLOAD<script>alert(2)</script>';
    const payloadAt = hostile.indexOf('PAYLOAD');
    const element = S.SearchHitRow({
      t: (key) => key,
      path: 'evil.txt',
      line: 7,
      column: payloadAt + 1,
      length: 7,
      text: hostile,
    });
    const rendered = renderTree(element);
    walkElements(rendered, (node) => {
      assert.equal(Object.prototype.hasOwnProperty.call(node.props, 'dangerouslySetInnerHTML'), false);
      assert.notEqual(node.type, 'img', 'hostile markup must never become an element');
      assert.notEqual(node.type, 'script');
    });
    const mark = [];
    walkElements(rendered, (node) => {
      if (node.type === 'mark') mark.push(node);
    });
    assert.equal(mark.length, 1);
    assert.deepEqual(mark[0].children, ['PAYLOAD']);
    const text = collectText(rendered).join('');
    assert.equal(text, `7${hostile}`, 'hostile text is rendered verbatim as text nodes (7 is the line gutter)');
  });

  it('splitMatch keeps UTF-16 columns, clamps out-of-range values and never throws', () => {
    const { S } = loadClient();
    assert.deepEqual(plain(S.splitMatch('abcdef', 2, 3)), [{ text: 'a', hit: false }, { text: 'bcd', hit: true }, { text: 'ef', hit: false }]);
    assert.deepEqual(plain(S.splitMatch('abcdef', 1, 6)), [{ text: 'abcdef', hit: true }]);
    assert.deepEqual(plain(S.splitMatch('abcdef', 1, 99)), [{ text: 'abcdef', hit: true }]);
    assert.deepEqual(plain(S.splitMatch('abcdef', 99, 2)), [{ text: 'abcdef', hit: false }]);
    assert.deepEqual(plain(S.splitMatch('abcdef', 0, 2)), [{ text: 'abcdef', hit: false }]);
    assert.deepEqual(plain(S.splitMatch('abcdef', Number.NaN, 2)), [{ text: 'abcdef', hit: false }]);
    assert.deepEqual(plain(S.splitMatch('abcdef', 2, 0)), [{ text: 'abcdef', hit: false }]);
    assert.deepEqual(plain(S.splitMatch(undefined, 1, 1)), [{ text: '', hit: false }]);
    // Emoji are two UTF-16 code units: columns line up with Host indices.
    assert.deepEqual(plain(S.splitMatch('😀foo', 3, 3)), [{ text: '😀', hit: false }, { text: 'foo', hit: true }]);
    // Long lines are clamped to 400 chars before slicing.
    const long = `${'x'.repeat(400)}NEEDLE`;
    const segments = S.splitMatch(long, 401, 6);
    assert.equal(segments.length, 1);
    assert.equal(segments[0].hit, false);
  });

  it('renders hostile file paths and git subjects as text', () => {
    const { S } = loadClient();
    const results = S.SearchResults({
      t: (key) => key,
      data: { files: [{ path: '<script>alert(1)</script>.js', matches: [{ line: 1, column: 1, length: 1, text: 'x' }] }], totalMatches: 1, elapsedMs: 1, truncated: false },
      query: '<img>',
      onOpenFile() {},
    });
    const group = S.SearchFileGroup({
      t: (key) => key,
      file: { path: '<script>alert(1)</script>.js', matches: [{ line: 1, column: 1, length: 1, text: 'x' }] },
      onOpen: () => {},
    });
    for (const element of [results, group]) {
      const rendered = renderTree(element);
      walkElements(rendered, (node) => {
        assert.equal(Object.prototype.hasOwnProperty.call(node.props, 'dangerouslySetInnerHTML'), false);
        assert.notEqual(node.type, 'script');
      });
      assert.ok(collectText(rendered).join('').includes('<script>alert(1)</script>'));
    }
  });
});

// ─── diff parsing / rendering ───────────────────────────────────────────────

describe('diff parsing', () => {
  it('classifies headers, hunks, additions, deletions and context', () => {
    const { S } = loadClient();
    assert.equal(S.classifyDiffLine('diff --git a/x b/x'), 'meta');
    assert.equal(S.classifyDiffLine('index 123..456 100644'), 'meta');
    assert.equal(S.classifyDiffLine('--- a/x'), 'meta');
    assert.equal(S.classifyDiffLine('+++ b/x'), 'meta');
    assert.equal(S.classifyDiffLine('new file mode 100644'), 'meta');
    assert.equal(S.classifyDiffLine('@@ -1 +1 @@'), 'hunk');
    assert.equal(S.classifyDiffLine('+added'), 'add');
    assert.equal(S.classifyDiffLine('-removed'), 'del');
    assert.equal(S.classifyDiffLine(' context'), 'ctx');
    assert.equal(S.classifyDiffLine(''), 'empty');
    assert.equal(S.classifyDiffLine('\\ No newline at end of file'), 'meta');
  });

  it('numbers old/new lines from hunk headers and resets on the next file', () => {
    const { S } = loadClient();
    const diff = [
      'diff --git a/a.txt b/a.txt',
      'index 1..2 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -10,3 +10,4 @@ section',
      ' ctx one',
      '-old line',
      '+new line a',
      '+new line b',
      ' ctx two',
      '',
      'diff --git a/b.txt b/b.txt',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1 +1 @@',
      '-before',
      '+after',
      '',
    ].join('\n');
    const rows = S.parseDiffLines(diff);
    const byText = new Map(rows.map((row) => [row.text, row]));
    assert.deepEqual([byText.get(' ctx one').oldNo, byText.get(' ctx one').newNo], [10, 10]);
    assert.deepEqual([byText.get('-old line').oldNo, byText.get('-old line').newNo], [11, null]);
    assert.deepEqual([byText.get('+new line a').oldNo, byText.get('+new line a').newNo], [null, 11]);
    assert.deepEqual([byText.get('+new line b').oldNo, byText.get('+new line b').newNo], [null, 12]);
    assert.deepEqual([byText.get(' ctx two').oldNo, byText.get(' ctx two').newNo], [12, 13]);
    assert.equal(byText.get('-before').kind, 'del');
    assert.equal(byText.get('-before').oldNo, 1);
    assert.equal(byText.get('+after').newNo, 1);
    // File headers are not numbered.
    assert.equal(rows.find((row) => row.text === '--- a/a.txt').oldNo, null);
  });

  it('renders an empty diff as "no differences" and caps rendered rows', () => {
    const { S } = loadClient();
    const empty = renderTree(S.DiffView({ t: (key) => key, diff: '' }));
    assert.ok(collectText(empty).join('').includes('git.diff.empty'));

    const lines = ['diff --git a/a b/a', '--- a/a', '+++ b/a', '@@ -1,1 +1,4001 @@'];
    for (let index = 0; index < 5000; index += 1) lines.push(` context line ${index}`);
    const big = renderTree(S.DiffView({ t: (key) => key, diff: lines.join('\n') }));
    assert.ok(collectText(big).join('').includes('git.diff.capped'));
    const rowCount = [];
    walkElements(big, (node) => {
      if (node.props['data-kind'] !== undefined) rowCount.push(node);
    });
    assert.equal(rowCount.length, S.MAX_DIFF_LINES);
  });
});

// ─── error boundary ─────────────────────────────────────────────────────────

describe('error boundary', () => {
  it('renders children, shows a contained crash card and remounts them on retry', () => {
    const { S } = loadClient();
    const boundary = new S.PanelBoundary({ t: (key) => key, children: { type: 'div', props: {}, children: [] } });
    const healthy = boundary.render();
    assert.equal(healthy.type, 'div');
    assert.deepEqual(healthy.children, [{ type: 'div', props: {}, children: [] }]);

    const state = S.PanelBoundary.getDerivedStateFromError(new Error('boom'));
    assert.equal(state.error.message, 'boom');
    boundary.state = { error: new Error('boom'), attempt: 0 };
    const crashed = boundary.render();
    walkElements(crashed, (node) => {
      assert.notEqual(node.type, 'pre', 'crash card is not raw HTML');
    });
    const text = collectText(crashed).join('\n');
    assert.ok(text.includes('crash.title'));
    assert.ok(text.includes('crash'));
    assert.ok(text.includes('action.retry'));

    boundary.retry();
    assert.equal(boundary.state.error, null);
    assert.equal(boundary.state.attempt, 1);
    const recovered = boundary.render();
    assert.equal(recovered.type, 'div');
    assert.match(String(recovered.props.key), /workspace-ide-attempt-1/);
  });
});

// ─── i18n coverage ─────────────────────────────────────────────────────────

describe('i18n completeness', () => {
  it('has identical zh/en key sets', () => {
    const { S } = loadClient();
    assert.deepEqual(Object.keys(S.I18N.zh).sort(), Object.keys(S.I18N.en).sort());
    for (const key of Object.keys(S.I18N.en)) {
      assert.equal(typeof S.I18N.zh[key], 'string', `zh.${key}`);
      assert.equal(typeof S.I18N.en[key], 'string', `en.${key}`);
    }
  });

  it('renders every component with a translator that throws on unknown keys', () => {
    const { S } = loadClient({ language: 'zh-CN' });
    const dict = S.I18N.zh;
    const t = (key, params) => {
      if (!Object.prototype.hasOwnProperty.call(dict, key)) throw new Error(`missing i18n key: ${key}`);
      if (params === undefined) return key;
      return `${key}(${Object.keys(params).join(',')})`;
    };
    const views = [
      S.ShellToolbar({ t, tab: 'files', root: '/ws', workspaces: [{ path: '/ws', title: 'ws', live: true }], loading: false, onSelectTab() {}, onSelectRoot() {}, onRefresh() {} }),
      S.SearchView({ t, root: '/ws', reloadToken: 0, onOpenFile() {} }),
      S.SearchResults({ t, data: { files: [{ path: 'a.txt', matches: [{ line: 1, column: 1, length: 1, text: 'x' }] }], totalMatches: 1, elapsedMs: 12, truncated: true }, query: 'x', onOpenFile() {} }),
      S.FilesView({ t, root: '/ws', reloadToken: 0, openRequest: null }),
      S.FileViewer({ t, path: 'src/a.ts', value: 'a', lineCount: 1, language: 'typescript', size: 1, mtimeMs: Date.now(), dirty: true, saving: false, readOnly: false, caret: { line: 1, column: 1 } }),
      S.GitView({ t, root: '/ws', reloadToken: 0, workspaces: [], onSelectWorkspace() {} }),
      S.GitNotRepoState({ t, root: '/ws', workspaces: [{ path: '/other', title: 'other', git: true }], onRetry() {}, onSelectWorkspace() {} }),
      S.GitHeader({ t, status: { repo: true, branch: 'main', upstream: 'origin/main', ahead: 1, behind: 2, clean: false }, view: 'changes', totalChanges: 3, onChangeView() {}, onRefresh() {} }),
      S.GitChangesList({ t, groups: S.groupChanges([{ path: 'a.txt', index: 'M', worktree: ' ', status: 'M ', from: 'old.txt' }]), selection: null, onSelect() {} }),
      S.GitHistoryList({ t, commits: [{ hash: 'a'.repeat(40), short: 'aaaaaaa', author: 'a', date: new Date().toISOString(), subject: 's', refs: ['HEAD'] }], selection: null, onSelect() {} }),
      S.DiffView({ t, diff: '@@ -1 +1 @@\n-a\n+b\n', truncated: true }),
      S.EmptyState({ t, title: 'x', body: 'y', actionLabel: 'z', onAction() {} }),
      S.InlineError({ t, title: 'x', message: 'y', onRetry() {} }),
      S.NoticeBar({ t, kind: 'error', text: 'x', onDismiss() {} }),
      S.LoadingIndicator({ t, label: 'x', hint: 'y' }),
    ];
    for (const view of views) {
      const rendered = renderTree(view);
      assert.ok(collectText(rendered).length >= 0);
    }
  });

  it('keeps every CJK literal inside the dictionary block', () => {
    const cjk = /[\u3400-\u9fff]/;
    for (const file of SOURCE_FILES) {
      const text = readFileSync(path.join(PROJECT, 'src', 'client', file), 'utf8');
      const lines = text.split('\n');
      const zhStart = lines.findIndex((line) => line.trim() === 'zh: {');
      const zhEnd = lines.findIndex((line) => line.trim() === 'en: {');
      lines.forEach((line, index) => {
        if (!cjk.test(line)) return;
        const inDictionary = file === '00-core.js' && zhStart !== -1 && zhEnd !== -1 && index > zhStart && index < zhEnd;
        assert.ok(inDictionary, `hard-coded CJK outside the dictionary in ${file}:${index + 1}: ${line.trim()}`);
      });
    }
  });

  it('interpolates {name} placeholders in both languages', () => {
    const { S, sandbox } = loadClient({ language: 'zh-CN' });
    assert.equal(S.translate('search.summary', { files: 1, matches: 2, ms: 3 }), '1 个文件 · 2 个结果 · 3ms');
    sandbox.navigator.language = 'en-US';
    assert.equal(S.translate('search.summary', { files: 1, matches: 2, ms: 3 }), '1 files · 2 matches · 3ms');
    assert.equal(S.translate('does.not.exist'), 'does.not.exist');
  });
});

// ─── root selection logic ──────────────────────────────────────────────────

describe('workspace root selection', () => {
  it('follows the contracted preference order', () => {
    const storage = createStorage({
      'dsh.sessions.current': JSON.stringify({ sessionId: 'session-1' }),
      'dsh-workspace-ide:root': JSON.stringify({ root: '/stored', sessionId: 'session-1' }),
    });
    const { S } = loadClient({ storage });
    const list = [{ path: '/a' }, { path: '/b', live: true }, { path: '/stored' }];

    // 1. The currently displayed root wins while it is still listed.
    assert.equal(S.pickRoot(list, '/a'), '/a');
    // 2. An explicit pick made in the current session sticks.
    assert.equal(S.pickRoot(list, null), '/stored');
    // 3. Otherwise the workspace owning the viewed session wins.
    assert.equal(S.pickRoot(list, null, '/b'), '/stored', 'session-scoped pick still wins over the session workspace');

    storage.removeItem('dsh-workspace-ide:root');
    assert.equal(S.pickRoot(list, null, '/a'), '/a', 'session workspace when no pick exists');
    // 4. No session info: a live workspace wins over registry order.
    assert.equal(S.pickRoot([{ path: '/x' }, { path: '/y', live: true }], null), '/y');
    // 5. Registry order is the last resort.
    assert.equal(S.pickRoot([{ path: '/x' }, { path: '/y' }], null), '/x');
    // 6. Empty list has no answer.
    assert.equal(S.pickRoot([], null), null);
    assert.equal(S.pickRoot(null, null), null);
    // A stale stored root not present in the list is ignored.
    storage.setItem('dsh-workspace-ide:root', JSON.stringify({ root: '/gone', sessionId: 'session-1' }));
    assert.equal(S.pickRoot([{ path: '/x' }], null), '/x');
  });

  it('reads the viewed session defensively and normalises malformed workspace payloads', () => {
    const storage = createStorage({ 'dsh.sessions.current': JSON.stringify({ sessionId: 's-42' }) });
    const { S } = loadClient({ storage });
    assert.equal(S.getCurrentSessionId(), 's-42');

    storage.setItem('dsh.sessions.current', 'not-json');
    assert.equal(S.getCurrentSessionId(), null);
    storage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: 42 }));
    assert.equal(S.getCurrentSessionId(), null);

    const snapshot = {
      items: [
        { path: '/a', sessionIds: ['s-1'] },
        { path: '/b', sessionIds: ['s-42', 's-2'] },
        { sessionIds: ['s-42'] },
        null,
      ],
    };
    assert.equal(S.preferredWorkspaceRoot(snapshot, 's-42'), '/b');
    assert.equal(S.preferredWorkspaceRoot(snapshot, 'missing'), null);
    assert.equal(S.preferredWorkspaceRoot(null, 's-1'), null);

    const normalized = S.normalizeWorkspaces({
      workspaces: [
        { id: 'one', path: '/one', title: 'One', sessionCount: 'nope', live: true, git: true },
        { path: '/two' },
        { path: '' },
        null,
        { title: 'no path' },
      ],
    });
    assert.equal(normalized.length, 2);
    assert.deepEqual(plain(normalized[0]), { id: 'one', path: '/one', title: 'One', sessionCount: 0, live: true, git: true });
    assert.deepEqual(plain(normalized[1]), { id: '/two', path: '/two', title: 'two', sessionCount: 0, live: false, git: false });
  });
});

// ─── pure helpers ──────────────────────────────────────────────────────────

describe('pure helpers', () => {
  it('counts lines and formats byte sizes / counts defensively', () => {
    const { S } = loadClient();
    assert.equal(S.countLines(''), 1);
    assert.equal(S.countLines('a'), 1);
    assert.equal(S.countLines('a\n'), 2);
    assert.equal(S.countLines('a\nb\nc'), 3);
    assert.equal(S.countLines(null), 0);
    assert.equal(S.countLines(undefined), 0);

    assert.equal(S.formatBytes(0), '0 B');
    assert.equal(S.formatBytes(1023), '1023 B');
    assert.equal(S.formatBytes(1024), '1.00 KB');
    assert.equal(S.formatBytes(1024 * 1024), '1.00 MB');
    assert.equal(S.formatBytes(-1), '—');
    assert.equal(S.formatBytes('nope'), '—');

    assert.deepEqual(plain(S.caretFromIndex('ab\ncd', 0)), { line: 1, column: 1 });
    assert.deepEqual(plain(S.caretFromIndex('ab\ncd', 4)), { line: 2, column: 2 });
    assert.deepEqual(plain(S.caretFromIndex('ab\ncd', 999)), { line: 2, column: 3 });
    assert.deepEqual(plain(S.caretFromIndex('ab\ncd', Number.NaN)), { line: 1, column: 1 });
    assert.deepEqual(plain(S.caretFromIndex('', 0)), { line: 1, column: 1 });

    assert.equal(S.lineNumbersText(3), '1\n2\n3');
    assert.equal(S.lineNumbersText(0), '1');
    assert.equal(S.clamp(5, 0, 10), 5);
    assert.equal(S.clamp(50, 0, 10), 10);
    assert.equal(S.clamp(-5, 0, 10), 0);
    assert.equal(S.clamp(Number.NaN, 2, 10), 2);
  });

  it('exposes only --dsw theme tokens for colours and fonts', () => {
    const artifact = readFileSync(ARTIFACT, 'utf8');
    const colourLines = artifact.split('\n').filter((line) => /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(line));
    assert.ok(colourLines.length > 0, 'colour fallbacks are present');
    for (const line of colourLines) {
      assert.ok(
        line.includes('alias(') || line.includes('var(--dsw-') || line.includes("'--dsw-alias-") || line.includes('--ide-tok-'),
        `hard-coded colour outside a theme token fallback or a named DSH-token override: ${line.trim()}`,
      );
    }
    const { S } = loadClient();
    assert.match(S.FONT_UI, /^var\(--dsw-/);
    assert.match(S.FONT_MONO, /^var\(--dsw-/);
    for (const value of Object.values(S.C)) {
      assert.match(value, /^var\(--dsw-alias-/, `theme colour token: ${value}`);
    }
  });

  it('meets the module-face constraints: only require("react"), no import/export, no HTML sinks', () => {
    const artifact = readFileSync(ARTIFACT, 'utf8');
    assert.equal((artifact.match(/\brequire\s*\(/g) ?? []).length, 1);
    assert.match(artifact, /require\('react'\)/);
    assert.ok(!/^[ \t]*(?:import|export)[ \t{*]/m.test(artifact), 'no import/export statements');
    assert.ok(!/dangerouslySetInnerHTML|innerHTML|outerHTML|document\.write|new Function|[^A-Za-z0-9_$]eval\(/.test(artifact), 'no HTML/JS sinks');
    assert.ok(!/@deepseek-ai\//.test(artifact), 'no DSH package imports');
    for (const file of SOURCE_FILES) {
      const source = readFileSync(path.join(PROJECT, 'src', 'client', file), 'utf8');
      assert.ok(!/^[ \t]*(?:import|export)[ \t{*]/m.test(source), `${file} has no import/export`);
    }
  });
});
