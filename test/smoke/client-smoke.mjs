#!/usr/bin/env node
/**
 * Smoke test for the dsh-workspace-ide Client half.
 *
 * The panel only ever runs inside the DSH browser runtime, and the Host half is
 * not booted here, so this test:
 *
 *   1. loads the built `lib/client.js` with `node:vm` against a fake
 *      `window.__ModuleLoader__` and a fake `react` (plain objects, no DOM);
 *   2. asserts the module face (`inject`/`apply`) registers exactly the two
 *      slots that make the rail icon open the central panel (same id/key);
 *   3. renders the icon, the panel and every surface/view with the fake React
 *      and walks the returned tree, so a throwing render fails the test;
 *   4. exercises the pure parts (dictionary parity, diff parser, status
 *      grouping, workspace pick, search highlighting, formatters);
 *   5. runs the module-face static checks (`import`/`export`, `require`,
 *      `@deepseek-ai/`) plus `node --check` as a child process;
 *   6. checks the build artifact is current (`scripts/build-client.mjs
 *      --check`) and that `--check` really detects a stale artifact.
 *
 * Plain Node, no third-party dependencies. Exits 0 on success, 1 on failure.
 */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..', '..');
const ARTIFACT = path.join(PROJECT, 'lib', 'client.js');
const SOURCE_DIR = path.join(PROJECT, 'src', 'client');
const BUILD_SCRIPT = path.join(PROJECT, 'scripts', 'build-client.mjs');
const SOURCES = ['00-core.js', '07-highlight.js', '08-markdown.js', '10-shell.js', '20-files.js', '30-search.js', '40-git.js', '99-face.js'];

let activeReact = null;

let checks = 0;
function ok(label) {
  checks = checks + 1;
  process.stdout.write('  ✓ ' + label + '\n');
}
function section(title) {
  process.stdout.write('\n' + title + '\n');
}

// ─── fake react ──────────────────────────────────────────────────────────────

/**
 * The smallest React the bundle actually uses: createElement returning plain
 * nodes, a Component base class and the five hooks. useEffect is a no-op (the
 * render walker never commits) and useState always returns its initial value.
 */
function createFakeReact() {
  // Hook-order tracking: React crashes (or silently corrupts state) when a
  // component calls a different hook sequence between renders, so every
  // component render is scoped and its sequence compared with the first one.
  const hookSequences = new Map();
  let hookScope = null;
  let hookScopeComponent = null;
  function recordHook(name) {
    if (hookScope !== null) hookScope.push(name);
  }

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

  function flatten(children) {
    const out = [];
    const visit = (value) => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (value === null || value === undefined || value === false || value === true) return;
      out.push(value);
    };
    children.forEach(visit);
    return out;
  }

  function createElement(type, props) {
    const merged = Object.assign({}, props === undefined || props === null ? {} : props);
    const children = flatten(Array.prototype.slice.call(arguments, 2));
    if (children.length === 1) merged.children = children[0];
    else if (children.length > 1) merged.children = children;
    return { type: type, props: merged };
  }

  const react = {
    createElement: createElement,
    Component: Component,
    Fragment: 'Fragment',
    useState(initial) {
      recordHook('useState');
      const value = typeof initial === 'function' ? initial() : initial;
      return [value, function setState() {}];
    },
    useRef(initial) {
      recordHook('useRef');
      return { current: initial === undefined ? null : initial };
    },
    useEffect() {
      recordHook('useEffect');
    },
    useLayoutEffect() {
      recordHook('useLayoutEffect');
    },
    useCallback(callback) {
      recordHook('useCallback');
      return callback;
    },
    useMemo(compute) {
      recordHook('useMemo');
      return compute();
    },
    /** Open a hook-order scope for one function-component render. */
    beginHookScope(component) {
      hookScope = [];
      hookScopeComponent = component;
    },
    /** Close the scope and fail loudly when the hook order changed. */
    endHookScope() {
      const component = hookScopeComponent;
      const sequence = hookScope;
      hookScope = null;
      hookScopeComponent = null;
      if (component === null || component === undefined || sequence === null) return;
      const name = component.name === undefined || component.name.length === 0 ? '<anonymous>' : component.name;
      const previous = hookSequences.get(component);
      if (previous === undefined) {
        hookSequences.set(component, sequence);
        return;
      }
      assert.equal(sequence.join(','), previous.join(','), 'hook order of ' + name + ' changed between renders');
    },
    hookScopeCount() {
      return hookSequences.size;
    },
  };
  return react;
}

// ─── render walker ───────────────────────────────────────────────────────────

/**
 * Expand a fake-React tree into host elements and text. Function components are
 * invoked (so every render path under test actually runs), class components are
 * instantiated and rendered, arrays are flattened.
 *
 * @param {any} node - fake React node.
 * @param {(visit: any) => void} visit - host/text visitor.
 * @param {number} [depth] - recursion guard.
 */
function walk(node, visit, depth) {

  const level = depth === undefined ? 0 : depth;
  if (level > 160) throw new Error('render tree is deeper than the walker allows');
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (typeof node === 'string' || typeof node === 'number') {
    visit({ kind: 'text', text: String(node) });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach(function (child) {
      walk(child, visit, level + 1);
    });
    return;
  }
  if (typeof node !== 'object') return;
  if (typeof node.type === 'function') {
    const Comp = node.type;
    const props = node.props === undefined || node.props === null ? {} : node.props;
    if (Comp.prototype !== undefined && Comp.prototype !== null && typeof Comp.prototype.render === 'function') {
      const instance = new Comp(props);
      const rendered = instance.render();
      walk(rendered, visit, level + 1);
      return;
    }
    if (activeReact !== null) activeReact.beginHookScope(Comp);
    let rendered;
    try {
      rendered = Comp(props);
    } finally {
      if (activeReact !== null) activeReact.endHookScope();
    }
    walk(rendered, visit, level + 1);
    return;
  }
  visit({ kind: 'host', type: node.type, props: node.props === undefined || node.props === null ? {} : node.props });
  const children = node.props === undefined || node.props === null ? undefined : node.props.children;
  if (children !== undefined) walk(children, visit, level + 1);
}

/**
 * Render one fake element and return collected host elements / text.
 * @param {unknown} node - element tree.
 * @returns {{hosts: Array, texts: Array<string>}} collected nodes.
 */
function renderTree(node) {
  const hosts = [];
  const texts = [];
  walk(node, function (entry) {
    if (entry.kind === 'host') hosts.push(entry);
    else texts.push(entry.text);
  });
  return { hosts: hosts, texts: texts };
}

function findHost(result, type) {
  return result.hosts.filter(function (host) {
    return host.type === type;
  });
}

// ─── load the bundle ─────────────────────────────────────────────────────────

function loadBundle() {
  const source = readFileSync(ARTIFACT, 'utf8');
  const loaded = [];
  const fakeWindow = {
    __ModuleLoader__: {
      load(definition) {
        loaded.push(definition);
      },
    },
  };
  const previousWindow = globalThis.window;
  globalThis.window = /** @type {any} */ (fakeWindow);
  try {
    vm.runInThisContext(source, { filename: ARTIFACT });
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  assert.equal(loaded.length, 1, 'the bundle must register exactly one module factory');
  return { definition: loaded[0], source: source, react: createFakeReact() };
}

/** Deterministic translator: keeps the key visible and marks interpolated params. */
function keyTranslator(key, params) {
  if (params === undefined || params === null) return key;
  const pairs = Object.keys(params).map(function (name) { return name + '=' + String(params[name]); });
  return key + '[' + pairs.join(',') + ']';
}

/** Build the fake slot/effect context the face expects. */
function makeContext(options) {
  const settings = options === undefined || options === null ? {} : options;
  const registrations = [];
  const effects = [];
  const ctx = {
    get(name) {
      if (typeof settings.get === 'function') return settings.get(name);
      return undefined;
    },
    effect(callback, label) {
      effects.push(label);
      const dispose = typeof callback === 'function' ? callback() : undefined;
      return function () {
        if (typeof dispose === 'function') dispose();
      };
    },
    slots: {
      inject(owner, callback) {
        const dispose = callback();
        return typeof dispose === 'function' ? dispose : function () {};
      },
      register(options2, component) {
        registrations.push({ options: options2, component: component });
        return function () {};
      },
    },
  };
  return { ctx: ctx, registrations: registrations, effects: effects };
}

// ─── main ────────────────────────────────────────────────────────────────────

function run() {
  section('build artifact');
  for (const file of SOURCES) {
    assert.ok(readFileSync(path.join(SOURCE_DIR, file), 'utf8').length > 0, 'missing source ' + file);
  }
  const check = spawnSync(process.execPath, [BUILD_SCRIPT, '--check'], { encoding: 'utf8' });
  assert.equal(check.status, 0, 'scripts/build-client.mjs --check must pass: ' + String(check.stderr || check.stdout));
  ok('lib/client.js is current (build --check exits 0)');

  const syntax = spawnSync(process.execPath, ['--check', ARTIFACT], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, 'node --check lib/client.js failed: ' + String(syntax.stderr));
  ok('node --check lib/client.js passes');

  const { definition, source, react } = loadBundle();
  activeReact = react;
  assert.equal(definition.id, 'dsh-workspace-ide', 'module id must equal the package name');
  assert.equal(typeof definition.factory, 'function', 'factory must be a function');
  ok('module loader definition: id + factory');

  section('module-face static checks');
  const artifactStatements = /^[ \t]*(?:import|export)[ \t{*]/m;
  assert.equal(artifactStatements.test(source), false, 'the artifact must not contain import/export statements');
  assert.equal(source.includes('@deepseek-ai/'), false, 'the artifact must not reference @deepseek-ai/ packages');
  for (const match of source.matchAll(/\brequire[ \t]*\([ \t]*(["'])([^"']+)\1[ \t]*\)/g)) {
    assert.equal(match[2], 'react', 'only require("react") is allowed, found require("' + match[2] + '")');
  }
  assert.equal(source.startsWith('/* generated by scripts/build-client.mjs'), true, 'missing generated banner');
  assert.equal(source.trimEnd().endsWith('});'), true, 'artifact must close the loader call');
  for (const file of SOURCES) {
    assert.equal(source.includes('src/client/' + file), true, 'artifact must inline source ' + file);
  }
  ok('no import/export, only require("react"), no @deepseek-ai, banner + all six sources');

  section('module face + slot registration');
  const face = definition.factory(function requireReact(name) {
    assert.equal(name, 'react', 'factory may only require "react"');
    return react;
  });
  assert.equal(typeof face, 'object', 'factory must return the plugin face');
  assert.equal(Array.isArray(face.inject), true, 'face.inject must be an array');
  assert.equal(face.inject.includes('slots'), true, 'face.inject must include "slots"');
  assert.equal(typeof face.apply, 'function', 'face.apply must be a function');
  assert.equal(typeof face.__test, 'function', 'face.__test seam must exist for the smoke test');
  ok('face.inject = ' + JSON.stringify(face.inject) + ', apply + __test');

  const plain = makeContext();
  const pings = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (function fakeFetch(url, init) {
    pings.push({ url: String(url), init: init });
    return Promise.resolve({ ok: true, json: async function json() { return { ok: true }; } });
  });
  try {
    face.apply(plain.ctx);
  } finally {
    if (realFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = realFetch;
  }

  assert.equal(plain.registrations.length, 2, 'apply must register exactly two slots');
  const rail = plain.registrations.filter(function (entry) { return entry.options.name === 'sidebar.panellist'; });
  const main = plain.registrations.filter(function (entry) { return entry.options.name === 'main'; });
  assert.equal(rail.length, 1, 'one sidebar.panellist entry');
  assert.equal(main.length, 1, 'one main entry');
  assert.equal(rail[0].options.id, 'workspace-ide', 'rail id must be workspace-ide');
  assert.equal(main[0].options.key, 'workspace-ide', 'main key must be workspace-ide');
  assert.equal(rail[0].options.id, main[0].options.key, 'rail id and main key must be identical');
  assert.equal(typeof rail[0].options.label, 'function', 'rail label must be a thunk (locale aware)');
  assert.equal(typeof rail[0].component, 'function', 'rail component must be a function');
  assert.equal(typeof main[0].component, 'function', 'main component must be a function');
  assert.equal(pings.length >= 1, true, 'apply must ping the Host telemetry route');
  assert.equal(pings[pings.length - 1].url, 'api/dsh-workspace-ide.ping', 'ping route must be browser-relative (no leading slash)');
  ok('apply registers sidebar.panellist{id} + main{key} with identical id/key; ping uses api/dsh-workspace-ide.ping');

  section('sidebar icon');
  const iconTree = rail[0].component({ size: 18, active: true });
  const iconRender = renderTree(iconTree);
  const svgs = findHost(iconRender, 'svg');
  assert.equal(svgs.length >= 1, true, 'the rail icon must render an svg');
  const svg = svgs[0];
  assert.equal(svg.props.width, 18, 'svg width must follow the owner size');
  assert.equal(svg.props.height, 18, 'svg height must follow the owner size');
  assert.equal(svg.props['aria-hidden'], true, 'the decorative icon must be aria-hidden');
  const iconOff = renderTree(rail[0].component({ size: 16, active: false }));
  assert.equal(findHost(iconOff, 'svg')[0].props.width, 16, 'inactive icon size');
  ok('PanelIcon renders svg at {size} for size 16 and 18');

  section('panel render');
  const panelTree = main[0].component({ t: keyTranslator });
  const panelRender = renderTree(panelTree);
  const tabs = panelRender.hosts
    .filter(function (host) { return host.props['data-tab'] !== undefined; })
    .map(function (host) { return host.props['data-tab']; });
  assert.deepEqual(tabs.sort(), ['files', 'git', 'search'], 'the toolbar must expose the three view tabs');
  for (const tab of ['files', 'search', 'git']) {
    const host = panelRender.hosts.filter(function (entry) { return entry.props['data-tab'] === tab; })[0];
    assert.equal(host.props['aria-label'], 'tabs.' + tab, 'tab aria-label must come from the dictionary');
    assert.equal(host.props.title, 'tabs.' + tab, 'tab title must come from the dictionary');
    assert.equal(host.type, 'button', 'tabs must be buttons');
  }
  const fallbackPanel = renderTree(main[0].component({}));
  assert.equal(fallbackPanel.hosts.filter(function (host) { return host.props['data-tab'] !== undefined; }).length, 3, 'panel must render without a t prop too');

  // Colour theme: the panel root carries the active theme id and its inline
  // `--dsw-alias-*` overrides; `auto` (no stored selection) overrides nothing,
  // so the panel follows DSH itself.
  const themeRoots = panelRender.hosts.filter(function (host) { return host.props['data-ide-theme'] !== undefined; });
  assert.equal(themeRoots.length, 1, 'the panel root exposes data-ide-theme');
  assert.equal(themeRoots[0].props['data-ide-theme'], 'auto', 'auto theme by default');
  assert.equal(themeRoots[0].props.style['--dsw-alias-bg-base'], undefined, 'auto overrides no DSH token');
  const themeButtons = panelRender.hosts.filter(function (host) { return host.props['data-theme-button'] !== undefined; });
  assert.equal(themeButtons.length, 1, 'the toolbar renders one theme button');
  assert.equal(themeButtons[0].type, 'button', 'the theme trigger is a button');
  assert.equal(themeButtons[0].props['aria-haspopup'], 'listbox', 'the theme trigger advertises its popover');
  assert.equal(themeButtons[0].props['aria-expanded'], 'false', 'the theme popover starts closed');
  assert.equal(themeButtons[0].props['aria-label'], 'theme.label', 'the theme trigger label comes from the dictionary');
  assert.equal(
    panelRender.hosts.some(function (host) {
      return host.type === 'path' && typeof host.props.d === 'string' && host.props.d.indexOf('M12 2C6.5 2 2 6.5') === 0;
    }),
    true,
    'the theme trigger renders the vendored Lucide palette icon',
  );
  assert.equal(panelRender.hosts.some(function (host) { return host.props.role === 'listbox'; }), false, 'the popover is not rendered until opened');

  // A persisted theme mounts the panel with that palette's override table.
  const previousWindow = globalThis.window;
  globalThis.window = /** @type {any} */ ({
    localStorage: {
      getItem: function (key) { return key === 'dsh-workspace-ide:theme' ? 'dracula' : null; },
      setItem: function () {},
      removeItem: function () {},
    },
  });
  let themedRender;
  try {
    themedRender = renderTree(main[0].component({ t: keyTranslator }));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  const themedRoots = themedRender.hosts.filter(function (host) { return host.props['data-ide-theme'] !== undefined; });
  assert.equal(themedRoots.length, 1, 'the themed panel still exposes data-ide-theme');
  assert.equal(themedRoots[0].props['data-ide-theme'], 'dracula', 'the persisted theme is applied on mount');
  assert.equal(themedRoots[0].props.style['--dsw-alias-bg-base'], '#282a36', 'the root carries the palette bg override');
  assert.equal(themedRoots[0].props.style['--dsw-alias-link'], '#bd93f9', 'the root carries the palette accent override');

  // Unknown persisted values fall back to the DSH theme.
  globalThis.window = /** @type {any} */ ({ localStorage: { getItem: function () { return 'not-a-theme'; }, setItem: function () {}, removeItem: function () {} } });
  let invalidRender;
  try {
    invalidRender = renderTree(main[0].component({ t: keyTranslator }));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  assert.equal(
    invalidRender.hosts.filter(function (host) { return host.props['data-ide-theme'] !== undefined; })[0].props['data-ide-theme'],
    'auto',
    'an invalid persisted theme falls back to auto',
  );

  // Static table check: all six palettes override every themed alias token.
  const paletteTokens = [
    'bg-base', 'bg-layer-1', 'bg-layer-2', 'bg-module-platform', 'border-l1', 'border-l2',
    'label-primary', 'label-secondary', 'label-tertiary', 'label-caption', 'brand-primary', 'link',
    'interactive-bg-hover', 'interactive-bg-active', 'label-primary-inverted', 'state-error-primary',
    'state-success-primary', 'state-warn-primary', 'state-warn-label', 'file-diff-added-marker',
    'file-diff-deleted-marker', 'code-diff-added', 'code-diff-deleted',
  ];
  paletteTokens.forEach(function (token) {
    const matches = source.match(new RegExp("'--dsw-alias-" + token + "':", 'g'));
    assert.equal(matches === null ? 0 : matches.length, 6, 'six palettes override --dsw-alias-' + token);
  });
  ['dark-plus', 'light-plus', 'one-dark-pro', 'dracula', 'github-dark', 'solarized-light'].forEach(function (id) {
    assert.equal(source.indexOf("'" + id + "'") !== -1, true, 'theme ' + id + ' is defined');
  });

  ok('panel renders three icon buttons (data-tab files/search/git) with dictionary aria-labels; theme root + closed palette picker');
  assert.ok(react.hookScopeCount() >= 5, 'the render walker must exercise several function components');

  section('locale service path');
  const localeDicts = [];
  const localeBound = [];
  const localeCtx = makeContext({
    get(name) {
      if (name !== 'locale') return undefined;
      return {
        register(namespace, dictionary) {
          localeDicts.push({ namespace: namespace, dictionary: dictionary });
          return function () {};
        },
        bind(namespace) {
          localeBound.push(namespace);
          return function translator(key) {
            return 'L:' + key;
          };
        },
      };
    },
  });
  const realFetchForLocale = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (function fakeFetch() {
    return Promise.resolve({ ok: true, json: async function json() { return { ok: true }; } });
  });
  try {
    face.apply(localeCtx.ctx);
  } finally {
    if (realFetchForLocale === undefined) delete globalThis.fetch;
    else globalThis.fetch = realFetchForLocale;
  }
  assert.equal(localeDicts.length, 1, 'locale.register must be called once');
  assert.equal(localeDicts[0].namespace, 'dsh-workspace-ide', 'locale namespace');
  assert.equal(typeof localeDicts[0].dictionary.zh, 'object', 'zh dictionary registered');
  assert.equal(typeof localeDicts[0].dictionary.en, 'object', 'en dictionary registered');
  assert.equal(localeDicts[0].dictionary.zh.panel, '工作区', 'zh panel label');
  assert.equal(localeCtx.registrations.length, 2, 'locale path still registers two slots');
  assert.equal(localeCtx.registrations[0].options.locale, 'dsh-workspace-ide', 'slot registrations must carry the locale namespace');
  assert.equal(localeCtx.registrations[1].options.locale, 'dsh-workspace-ide', 'main registration must carry the locale namespace');
  assert.equal(localeBound.length >= 1, true, 'locale.bind must back the rail label');
  ok('optional locale service: dictionaries + locale option + bound translator');

  section('dictionary + pure helpers');
  const T = face.__test();
  assert.deepEqual(Object.keys(T.I18N.zh).sort(), Object.keys(T.I18N.en).sort(), 'zh and en dictionaries must share the same keys');
  assert.ok(Object.keys(T.I18N.zh).length >= 100, 'dictionary must cover the panel');
  Object.keys(T.I18N.zh).forEach(function (key) {
    assert.equal(typeof T.I18N.zh[key], 'string', 'zh.' + key + ' must be a string');
    assert.equal(T.I18N.zh[key].length > 0, true, 'zh.' + key + ' must not be empty');
  });
  ok('zh/en key parity (' + String(Object.keys(T.I18N.zh).length) + ' keys)');

  // Every literal t('…') key in the sources must exist in the dictionary, and no
  // visible Chinese may be hardcoded outside the dictionary literal.
  const coreSource = readFileSync(path.join(SOURCE_DIR, '00-core.js'), 'utf8');
  const dictStart = coreSource.indexOf('const DICT = {');
  const dictEnd = coreSource.indexOf('\n};', dictStart) + 3;
  assert.ok(dictStart > 0 && dictEnd > dictStart, 'the dictionary literal must be locatable');
  const withoutDict = coreSource.slice(0, dictStart) + coreSource.slice(dictEnd);
  assert.equal(/[\u4e00-\u9fff]/.test(withoutDict), false, 'visible Chinese must live in the dictionary, not hardcoded in the panel');
  const usedKeys = new Set();
  for (const file of SOURCES) {
    const text = readFileSync(path.join(SOURCE_DIR, file), 'utf8');
    for (const match of text.matchAll(/(?:\bt|S\.tt|tt)\(\s*'([^']+)'/g)) {
      // Dynamic keys ("tabs." + id) are assembled at runtime; only complete
      // dictionary keys are checked here.
      if (/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(match[1])) usedKeys.add(match[1]);
    }
  }
  const missingKeys = Array.from(usedKeys).filter(function (key) { return T.I18N.zh[key] === undefined || T.I18N.en[key] === undefined; });
  assert.deepEqual(missingKeys, [], 'every literal dictionary key used by the panel must exist in zh + en');
  ok('every literal t() key is defined (' + String(usedKeys.size) + ' keys); no hardcoded Chinese outside the dictionary');

  assert.deepEqual(T.TABS.map(function (tab) { return tab.id; }), ['files', 'search', 'git'], 'TABS order');
  ['PanelIcon', 'Files', 'Search', 'Git'].forEach(function (name) {
    assert.equal(typeof T.Icons[name], 'function', 'missing icon ' + name);
    const rendered = renderTree(T.Icons[name]({ size: 14, active: false }));
    assert.equal(findHost(rendered, 'svg').length, 1, 'icon ' + name + ' must render one svg');
  });
  ok('TABS = files/search/git; every tab icon renders');

  assert.equal(T.formatBytes(0), '0 B');
  assert.equal(T.formatBytes(1536), '1.50 KB');
  assert.equal(T.countLines(''), 1);
  assert.equal(T.countLines('a\nb\n'), 3);
  assert.equal(T.lineNumbersText(3), '1\n2\n3');
  assert.deepEqual(T.caretFromIndex('ab\ncd', 4), { line: 2, column: 2 });
  assert.deepEqual(T.splitMatch('foo bar baz', 5, 3), [
    { text: 'foo ', hit: false },
    { text: 'bar', hit: true },
    { text: ' baz', hit: false },
  ]);
  assert.deepEqual(T.splitMatch('abc', 1, 9), [{ text: 'abc', hit: true }]);
  assert.deepEqual(T.splitMatch('abc', 0, 3), [{ text: 'abc', hit: false }]);
  assert.equal(T.Routes.workspaces, 'api/dsh-workspace-ide.workspaces', 'routes must be browser-relative');
  ok('formatBytes / countLines / lineNumbersText / caretFromIndex / splitMatch / routes');

  const normal = T.normalizeWorkspaces({
    workspaces: [
      { id: 'a', path: '/w/a', title: 'A', sessionCount: 2, live: false, git: true },
      { id: 'b', path: '/w/b', title: '', sessionCount: 0, live: true },
      { path: '' },
      null,
    ],
  });
  assert.equal(normal.length, 2, 'invalid workspace rows are dropped');
  assert.equal(normal[1].title, 'b', 'empty titles fall back to the basename');
  assert.equal(normal[1].live, true, 'live flag survives normalisation');
  assert.equal(normal[0].git, true, 'git flag survives normalisation');
  assert.equal(normal[1].git, false, 'missing git flag normalises to false');
  assert.equal(T.pickRoot([{ path: '/w/a', live: false }, { path: '/w/b', live: true }], null), '/w/b', 'first live workspace wins');
  assert.equal(T.pickRoot([{ path: '/w/a', live: false }], null), '/w/a', 'falls back to the first workspace');
  assert.equal(T.pickRoot([{ path: '/w/a' }, { path: '/w/b' }], '/w/b'), '/w/b', 'current root wins when still listed');
  assert.equal(T.pickRoot([], null), null, 'empty list selects nothing');
  ok('workspace normalisation + live-session root preference');

  section('syntax highlighting engine');
  assert.equal(typeof T.highlightLines, 'function', 'S.highlightLines must be exported');
  assert.equal(typeof T.HIGHLIGHT_LANGUAGES, 'object', 'S.HIGHLIGHT_LANGUAGES must be exported');
  assert.equal(Array.isArray(T.HIGHLIGHT_KINDS), true, 'S.HIGHLIGHT_KINDS must be exported');
  const hostLanguages = [
    'javascript', 'jsx', 'typescript', 'tsx', 'json', 'markdown', 'css', 'html', 'xml', 'python', 'go',
    'rust', 'java', 'kotlin', 'swift', 'c', 'cpp', 'csharp', 'ruby', 'php', 'shell', 'powershell',
    'yaml', 'toml', 'ini', 'sql', 'graphql', 'vue', 'svelte', 'text',
  ];
  hostLanguages.forEach(function (language) {
    assert.equal(typeof T.HIGHLIGHT_LANGUAGES[language], 'string', 'Host language value ' + language + ' is mapped');
    const canonical = T.normalizeHighlightLanguage(language);
    assert.equal(typeof T.HIGHLIGHT_LANGUAGES[canonical], 'string', 'canonical id ' + canonical + ' is one of the aliases');
  });
  [
    ['js', 'javascript'], ['py', 'python'], ['md', 'markdown'], ['yml', 'yaml'], ['rs', 'rust'],
    ['kt', 'kotlin'], ['cs', 'csharp'], ['ts', 'typescript'], ['sh', 'shell'], ['gql', 'graphql'],
    ['not-a-language', 'text'],
  ].forEach(function (pair) {
    assert.equal(T.normalizeHighlightLanguage(pair[0]), pair[1], 'alias ' + pair[0] + ' normalises to ' + pair[1]);
  });
  ok('HIGHLIGHT_LANGUAGES maps all ' + String(hostLanguages.length) + ' Host language values + common aliases');

  const jsSample = 'const s = "x"; // hi';
  const jsLines = T.highlightLines(jsSample, 'javascript');
  assert.equal(jsLines.length, 1, 'one result entry per source line');
  const jsSegments = jsLines[0];
  const jsKinds = jsSegments.map(function (segment) { return segment[0]; });
  ['keyword', 'string', 'comment', 'plain'].forEach(function (kind) {
    assert.equal(jsKinds.indexOf(kind) !== -1, true, 'the JS sample yields a ' + kind + ' segment');
  });
  assert.equal(jsSegments.map(function (segment) { return segment[1]; }).join(''), jsSample, 'JS segments concatenate back to the line');
  assert.deepEqual(T.highlightLines('', 'javascript'), [], 'empty source returns []');
  assert.deepEqual(
    T.highlightLines('alpha beta\n\ngamma', 'not-a-language'),
    [[['plain', 'alpha beta']], [], [['plain', 'gamma']]],
    'unknown language degrades to plain lines',
  );
  assert.deepEqual(
    T.highlightLines('a\nb', 'text'),
    [[['plain', 'a']], [['plain', 'b']]],
    'text language degrades to plain lines',
  );
  ok('highlightLines: keyword/string/comment/plain, concat invariant, empty / unknown / text fallbacks');

  // Round-trip invariant + the kind enum, across multi-line constructs.
  /** @type {Array<[string, string, string[]]>} */
  const invariantSamples = [
    ['javascript', 'a /* start\nmiddle */ b\n`t ${x}`', ['comment', 'string']],
    ['typescript', 'interface A { b: string }\nconst c: number = 1;', ['keyword', 'type', 'number']],
    ['python', 'def f():\n    x = """doc\nline""" + 1', ['keyword', 'string']],
    ['html', '<div\n  class="a">t &amp; u</div>', ['tag', 'attr']],
    ['markdown', '# T\n```js\nconst a = 1;\n```\n- item **b**', ['keyword', 'meta']],
    ['json', '{"a": [1, null], "b": "s"}', ['property', 'constant']],
    ['yaml', 'key: value\n# c\nlist:\n  - a', ['property', 'comment']],
    ['sql', 'SELECT * FROM t -- c', ['keyword', 'comment']],
  ];
  invariantSamples.forEach(function (sample) {
    const language = sample[0];
    const code = sample[1];
    const lines = T.highlightLines(code, language);
    const sourceLines = code.split('\n');
    assert.equal(lines.length, sourceLines.length, language + ': one entry per line');
    const kinds = [];
    lines.forEach(function (segments, index) {
      assert.equal(
        segments.map(function (segment) { return segment[1]; }).join(''),
        sourceLines[index],
        language + ': line ' + String(index) + ' segments concatenate back',
      );
      segments.forEach(function (segment) {
        assert.equal(T.HIGHLIGHT_KINDS.indexOf(segment[0]) !== -1, true, language + ': kind ' + segment[0] + ' is in the enum');
        kinds.push(segment[0]);
      });
    });
    sample[2].forEach(function (kind) {
      assert.equal(kinds.indexOf(kind) !== -1, true, language + ' emits a ' + kind + ' segment');
    });
  });
  ok('concat invariant + kind enum hold across js/ts/python/html/markdown/json/yaml/sql samples');

  // Every canonical language must survive the same round-trip.
  const canonicalIds = Array.from(
    new Set(Object.keys(T.HIGHLIGHT_LANGUAGES).map(function (alias) { return T.HIGHLIGHT_LANGUAGES[alias]; })),
  ).sort();
  const genericSample = 'foo(1, "x") // hi\n<div class="a">t</div>\n/* c */\nkey: value\n# not\n';
  const genericLines = genericSample.split('\n');
  canonicalIds.forEach(function (language) {
    const lines = T.highlightLines(genericSample, language);
    assert.equal(lines.length, genericLines.length, language + ': isolated line mapping');
    lines.forEach(function (segments, index) {
      assert.equal(
        segments.map(function (segment) { return segment[1]; }).join(''),
        genericLines[index],
        language + ': segments concatenate back',
      );
      segments.forEach(function (segment) {
        assert.equal(T.HIGHLIGHT_KINDS.indexOf(segment[0]) !== -1, true, language + ': valid kind');
      });
    });
  });
  ok('round-trip invariant holds for all ' + String(canonicalIds.length) + ' canonical languages');

  // Oversized sources never enter the scanner and stay plain.
  const oversized = 'const a = 1;\n'.repeat(Math.ceil((T.MAX_HIGHLIGHT_CHARS + 1) / 13));
  assert.equal(oversized.length > T.MAX_HIGHLIGHT_CHARS, true, 'the oversized sample is above the guard');
  const oversizeStart = Date.now();
  const oversizeLines = T.highlightLines(oversized, 'javascript');
  const oversizeMs = Date.now() - oversizeStart;
  assert.equal(oversizeLines.length, oversized.split('\n').length, 'oversized source keeps its line count');
  assert.equal(
    oversizeLines.every(function (segments) {
      return segments.length <= 1 && (segments.length === 0 || segments[0][0] === 'plain');
    }),
    true,
    'oversized source degrades to plain lines',
  );
  assert.ok(oversizeMs < 100, 'the >300 KB guard stays cheap (' + String(oversizeMs) + ' ms)');

  // 100 KB of realistic JS: the contract budget is < 150 ms for one sync pass.
  const jsChunk = 'function foo(a, b) {\n  const s = "value " + a; // comment\n  return { x: 1, y: [2, 3], z: `tpl ${b}` };\n}\n';
  let bigJs = '';
  while (bigJs.length < 100 * 1024) bigJs = bigJs + jsChunk;
  const perfStart = Date.now();
  const bigLines = T.highlightLines(bigJs, 'javascript');
  const perfMs = Date.now() - perfStart;
  assert.equal(bigLines.length, bigJs.split('\n').length, '100 KB JS keeps one entry per line');
  assert.ok(perfMs < 150, 'highlighting 100 KB of JS stays under 150 ms (got ' + String(perfMs) + ' ms)');
  process.stdout.write('    · 100 KB JS highlight: ' + String(perfMs) + ' ms over ' + String(bigLines.length) + ' lines\n');
  ok('performance: 100 KB JS in ' + String(perfMs) + ' ms (< 150 ms), >300 KB falls back to plain');

  section('syntax colours + theme linkage');
  const syntaxKinds = ['keyword', 'string', 'comment', 'number', 'constant', 'function', 'type', 'variable', 'operator', 'punctuation', 'tag', 'attr', 'property', 'regexp', 'meta'];
  syntaxKinds.forEach(function (kind) {
    const value = T.SYN[kind];
    assert.equal(typeof value, 'string', 'SYN.' + kind + ' is defined');
    assert.equal(value.indexOf('var(--ide-tok-') === 0, true, 'SYN.' + kind + ' reads the --ide-tok-* override first');
  });
  assert.ok(T.SYN.variable.indexOf('var(--dsw-alias-label-primary') !== -1, 'the auto variable colour follows the DSH label token');
  assert.equal(T.SYN.plain, 'inherit', 'plain text inherits the editor colour');
  assert.equal(T.themeVars('auto')['--ide-tok-keyword'], undefined, 'auto contributes no syntax override (inherits --shiki-token-*)');
  assert.equal(T.themeVars('dracula')['--ide-tok-keyword'], '#FF79C6', 'dracula keyword colour');
  const paletteIds = ['dark-plus', 'light-plus', 'one-dark-pro', 'dracula', 'github-dark', 'solarized-light'];
  paletteIds.forEach(function (id) {
    const vars = T.themeVars(id);
    syntaxKinds.forEach(function (kind) {
      assert.match(vars['--ide-tok-' + kind], /^#[0-9A-F]{6}$/i, id + ' carries a hex --ide-tok-' + kind);
    });
  });
  syntaxKinds.forEach(function (kind) {
    const matches = source.match(new RegExp("'--ide-tok-" + kind + "':", 'g'));
    assert.equal(matches === null ? 0 : matches.length, 6, 'six palettes override --ide-tok-' + kind);
  });
  assert.equal(/innerHTML|dangerouslySetInnerHTML|outerHTML|document\.write/.test(source), false, 'the bundled client has no HTML/JS sinks');
  assert.equal(/innerHTML|dangerouslySetInnerHTML/.test(readFileSync(path.join(SOURCE_DIR, '07-highlight.js'), 'utf8')), false, 'the highlighter only returns data');
  ok('SYN -> --ide-tok-* -> --shiki-token-* chain; 6 palettes x 15 token colours; auto inherits DSH; no innerHTML');

  section('comment toggle (Cmd/Ctrl+/)');
  assert.equal(typeof T.toggleLineComments, 'function', 'S.toggleLineComments must be exported');
  const jsOne = T.toggleLineComments('const a = 1;', 3, 3, 'javascript');
  assert.equal(jsOne.text, '// const a = 1;', 'JS single line is prefixed with //');
  assert.equal(jsOne.changed, true, 'the JS toggle reports a change');
  assert.equal(T.toggleLineComments(jsOne.text, jsOne.selectionStart, jsOne.selectionEnd, 'javascript').text, 'const a = 1;', 'JS toggle is reversible');
  const multi = '  const a = 1;\n  const b = 2;';
  const multiResult = T.toggleLineComments(multi, 0, multi.length, 'typescript');
  assert.equal(multiResult.text, '  // const a = 1;\n  // const b = 2;', 'multi-line selection keeps indentation');
  assert.equal(T.toggleLineComments(multiResult.text, multiResult.selectionStart, multiResult.selectionEnd, 'typescript').text, multi, 'multi-line toggle is reversible');
  assert.equal(T.toggleLineComments('x = 1', 0, 0, 'python').text, '# x = 1', 'python uses #');
  assert.equal(T.toggleLineComments('SELECT 1;', 0, 0, 'sql').text, '-- SELECT 1;', 'sql uses --');
  const blank = 'a\n\nb';
  assert.equal(T.toggleLineComments(blank, 0, blank.length, 'javascript').text, '// a\n\n// b', 'blank lines are left untouched');
  const css = 'color: red;';
  const cssWrapped = T.toggleLineComments(css, 0, css.length, 'css');
  assert.equal(cssWrapped.text, '/* color: red; */', 'CSS wraps the selection in /* */');
  assert.equal(T.toggleLineComments(cssWrapped.text, cssWrapped.selectionStart, cssWrapped.selectionEnd, 'css').text, css, 'CSS unwrap is reversible');
  assert.equal(T.toggleLineComments('<div></div>', 5, 5, 'html').text, '<!-- <div></div> -->', 'HTML wraps the current line in <!-- -->');
  const noComment = T.toggleLineComments('hello', 0, 5, 'text');
  assert.equal(noComment.changed, false, 'plain text has no comment form');
  assert.equal(noComment.text, 'hello', 'plain text is unchanged');
  ok('comment toggle: JS/TS/Python/SQL tokens, indent kept, blank lines untouched, CSS/HTML block fallback, text unchanged');

  section('diff parser + change grouping');
  const sampleDiff = [
    'diff --git a/a.js b/a.js',
    'index 1234567..89abcde 100644',
    '--- a/a.js',
    '+++ b/a.js',
    '@@ -1,3 +1,4 @@',
    ' const a = 1;',
    '-const b = 2;',
    '+const b = 3;',
    '+const c = 4;',
  ].join('\n');
  const rows = T.parseDiffLines(sampleDiff);
  assert.deepEqual(rows.map(function (row) { return row.kind; }), ['meta', 'meta', 'meta', 'meta', 'hunk', 'ctx', 'del', 'add', 'add']);
  assert.deepEqual({ old: rows[5].oldNo, next: rows[5].newNo }, { old: 1, next: 1 });
  assert.equal(rows[6].oldNo, 2, 'deleted line keeps the old line number');
  assert.equal(rows[6].newNo, null);
  assert.equal(rows[7].newNo, 2, 'added line keeps the new line number');
  assert.equal(rows[8].newNo, 3);
  assert.deepEqual(T.parseDiffLines(''), []);
  assert.equal(T.classifyDiffLine('+x'), 'add');
  assert.equal(T.classifyDiffLine('-x'), 'del');
  assert.equal(T.classifyDiffLine('@@ -1 +1 @@'), 'hunk');
  assert.equal(T.classifyDiffLine('\\ No newline at end of file'), 'meta');
  ok('unified diff parser classifies lines and tracks old/new numbers');

  const grouped = T.groupChanges([
    { path: 'src/a.js', status: 'M ', index: 'M', worktree: ' ' },
    { path: 'src/b.js', status: ' M', index: ' ', worktree: 'M' },
    { path: 'src/c.js', status: '??', index: '?', worktree: '?' },
    { path: 'src/d.js', status: 'UU', index: 'U', worktree: 'U' },
    { path: 'src/e.js', status: 'R ', index: 'R', worktree: ' ', from: 'src/old.js' },
  ]);
  assert.deepEqual(grouped.staged.map(function (entry) { return entry.path; }), ['src/a.js', 'src/e.js']);
  assert.deepEqual(grouped.unstaged.map(function (entry) { return entry.path; }), ['src/b.js']);
  assert.deepEqual(grouped.untracked.map(function (entry) { return entry.path; }), ['src/c.js']);
  assert.deepEqual(grouped.conflicted.map(function (entry) { return entry.path; }), ['src/d.js']);
  assert.equal(grouped.staged[1].from, 'src/old.js', 'rename source path is preserved');
  ok('status grouping splits staged / unstaged / untracked / conflicted');

  section('view renders');
  const filesRender = renderTree(T.FilesView({ t: keyTranslator, root: '/tmp/workspace', openRequest: null, reloadToken: 0 }));
  assert.equal(findHost(filesRender, 'textarea').length, 0, 'no file is open yet, so no textarea');
  assert.equal(filesRender.hosts.filter(function (host) { return host.props.role === 'tree'; }).length, 1, 'the tree pane renders even before the first list response');
  ok('FilesView renders tree + empty viewer without a DOM');

  const viewerRender = renderTree(T.FileViewer({
    t: keyTranslator,
    path: 'src/client/00-core.js',
    value: 'const a = 1;\nconst b = 2;\n',
    lineCount: 2,
    language: 'js',
    size: 30,
    mtimeMs: 1700000000000,
    dirty: true,
    saving: false,
    readOnly: false,
    tooBig: false,
    truncated: false,
    notice: null,
    caret: { line: 2, column: 3 },
    textareaRef: { current: null },
    gutterRef: { current: null },
    onChange: function () {},
    onKeyDown: function () {},
    onScroll: function () {},
    onSelect: function () {},
    onSave: function () {},
    onDismissNotice: function () {},
  }));
  const textareas = findHost(viewerRender, 'textarea');
  assert.equal(textareas.length, 1, 'the editable viewer renders one textarea');
  assert.equal(textareas[0].props.value, 'const a = 1;\nconst b = 2;\n', 'textarea is controlled by the draft');
  assert.equal(textareas[0].props.spellCheck, false, 'spellcheck off');
  assert.equal(viewerRender.texts.includes('files.modified'), true, 'dirty marker comes from the dictionary');
  const readOnlyRender = renderTree(T.FileViewer({
    t: keyTranslator, path: 'big.txt', value: 'x', lineCount: 1, language: 'text', size: 5000000, mtimeMs: 0,
    dirty: false, saving: false, readOnly: true, tooBig: true, truncated: false, notice: null, caret: { line: 1, column: 1 },
    textareaRef: { current: null }, gutterRef: { current: null }, onChange: function () {}, onKeyDown: function () {}, onScroll: function () {},
    onSelect: function () {}, onSave: function () {}, onDismissNotice: function () {},
  }));
  assert.equal(findHost(readOnlyRender, 'textarea').length, 0, 'read-only files render a pre, not a textarea');
  assert.equal(findHost(readOnlyRender, 'pre').length >= 1, true, 'read-only body is a pre');
  ok('FileViewer: editable textarea, dirty marker, read-only pre');

  // Syntax overlay: highlighted files paint the colours behind a transparent
  // textarea whose metrics the layer's <pre> mirrors exactly.
  const syntaxLayers = viewerRender.hosts.filter(function (host) { return host.props['data-ide-highlight'] === 'layer'; });
  assert.equal(syntaxLayers.length, 1, 'a highlighted file renders one syntax layer');
  assert.equal(textareas[0].props.style.color, 'transparent', 'the textarea text is transparent over the syntax layer');
  assert.equal(typeof textareas[0].props.style.caretColor, 'string', 'the caret keeps an explicit colour');
  assert.equal(typeof textareas[0].props.onScroll, 'function', 'the textarea scroll handler syncs the layer');
  const syntaxPre = viewerRender.hosts.filter(function (host) {
    return host.type === 'pre' && host.props.style !== undefined && host.props.style.willChange === 'transform';
  })[0];
  assert.ok(syntaxPre !== undefined, 'the syntax layer renders its own pre');
  ['fontFamily', 'fontSize', 'lineHeight', 'padding', 'tabSize', 'whiteSpace'].forEach(function (key) {
    assert.deepEqual(syntaxPre.props.style[key], textareas[0].props.style[key], 'the syntax layer mirrors the textarea ' + key);
  });
  const tokenSpans = viewerRender.hosts.filter(function (host) {
    return host.type === 'span' && host.props.style !== undefined
      && typeof host.props.style.color === 'string' && host.props.style.color.indexOf('--ide-tok-') !== -1;
  });
  assert.equal(tokenSpans.length >= 2, true, 'coloured token spans carry --ide-tok-* colours');
  ok('FileViewer: syntax overlay mirrors textarea metrics, transparent text, token spans');

  const plainViewerProps = {
    t: keyTranslator, path: 'notes.txt', value: 'plain a\nplain b', lineCount: 2, language: 'text', size: 17,
    mtimeMs: 0, dirty: false, saving: false, readOnly: false, tooBig: false, truncated: false, notice: null,
    caret: { line: 1, column: 1 }, textareaRef: { current: null }, gutterRef: { current: null },
    onChange: function () {}, onKeyDown: function () {}, onScroll: function () {}, onSelect: function () {},
    onSave: function () {}, onDismissNotice: function () {},
  };
  const plainViewer = renderTree(T.FileViewer(plainViewerProps));
  assert.equal(plainViewer.hosts.filter(function (host) { return host.props['data-ide-highlight'] === 'layer'; }).length, 0, 'plain text renders no syntax layer');
  assert.equal(findHost(plainViewer, 'textarea')[0].props.style.color, T.C.text, 'plain text keeps the normal text colour');
  const readOnlySyntax = renderTree(T.FileViewer(Object.assign({}, plainViewerProps, {
    path: 'big.ts', value: 'const a: number = 1;', lineCount: 1, language: 'typescript', size: 5000000, readOnly: true, tooBig: true,
  })));
  assert.equal(
    readOnlySyntax.hosts.filter(function (host) { return host.type === 'pre' && host.props['data-ide-highlight'] === 'syntax'; }).length,
    1,
    'a read-only code file renders a syntax pre',
  );
  assert.equal(
    readOnlySyntax.hosts.some(function (host) {
      return host.type === 'span' && host.props.style !== undefined
        && typeof host.props.style.color === 'string' && host.props.style.color.indexOf('--ide-tok-') !== -1;
    }),
    true,
    'the read-only pre colours its tokens',
  );
  ok('FileViewer: plain language skips the layer; read-only code highlights inside the pre');

  section('markdown preview');
  assert.equal(typeof T.parseMarkdown, 'function', 'S.parseMarkdown must be exported');
  assert.equal(typeof T.renderMarkdown, 'function', 'S.renderMarkdown must be exported');
  const mdFixture = [
    '# Title',
    '',
    'Some **bold** text with `code` and a [link](https://example.com).',
    '',
    '- one',
    '- two',
    '',
    '```js',
    'const answer = 42;',
    '```',
    '',
    '> quoted',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '---',
  ].join('\n');
  const mdBlocks = T.parseMarkdown(mdFixture);
  assert.deepEqual(
    mdBlocks.map(function (block) { return block.type; }),
    ['heading', 'paragraph', 'list', 'code', 'blockquote', 'table', 'hr'],
    'block parser: heading, paragraph, list, fence, quote, table, rule',
  );
  assert.equal(mdBlocks[0].depth, 1, 'ATX heading depth');
  assert.equal(mdBlocks[2].items.length, 2, 'two list items');
  assert.equal(mdBlocks[2].ordered, false, 'bullet list is unordered');
  assert.equal(mdBlocks[3].lang, 'js', 'fence info string is the language');
  assert.equal(mdBlocks[3].text, 'const answer = 42;', 'fence body is captured verbatim');
  assert.equal(mdBlocks[4].blocks[0].type, 'paragraph', 'blockquote parses nested blocks');
  assert.equal(mdBlocks[5].header.length, 2, 'table header cells');
  assert.equal(mdBlocks[5].rows.length, 1, 'table body rows');
  const mdInline = T.parseMarkdownInline('a **b** `c` [d](https://e) ~~f~~');
  assert.deepEqual(
    mdInline.map(function (node) { return node.type; }),
    ['text', 'strong', 'text', 'code', 'text', 'link', 'text', 'del'],
    'inline parser: strong, code, link, strikethrough',
  );

  const mdProps = Object.assign({}, plainViewerProps, {
    path: 'README.md',
    value: mdFixture,
    lineCount: mdFixture.split('\n').length,
    language: 'markdown',
    markdownMode: 'preview',
  });
  const mdRender = renderTree(T.FileViewer(mdProps));
  assert.equal(mdRender.hosts.filter(function (host) { return host.props['data-md-preview'] === '1'; }).length, 1, 'preview container is marked');
  assert.equal(findHost(mdRender, 'h1').length, 1, 'heading renders as h1');
  ['p', 'ul', 'li', 'pre', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr'].forEach(function (tag) {
    assert.equal(findHost(mdRender, tag).length >= 1, true, 'preview renders <' + tag + '>');
  });
  const mdTokenSpans = mdRender.hosts.filter(function (host) {
    return host.type === 'span' && host.props.style !== undefined
      && typeof host.props.style.color === 'string' && host.props.style.color.indexOf('--ide-tok-') !== -1;
  });
  assert.equal(mdTokenSpans.length >= 2, true, 'code fences inside the preview are syntax-highlighted');
  const mdLinks = findHost(mdRender, 'a');
  assert.equal(mdLinks.length, 1, 'safe link renders an anchor');
  assert.equal(mdLinks[0].props.href, 'https://example.com', 'anchor keeps the safe href');
  assert.equal(mdLinks[0].props.rel, 'noreferrer noopener', 'external links are isolated');
  const unsafeRender = renderTree(T.FileViewer(Object.assign({}, mdProps, { value: '[x](javascript:alert(1))' })));
  assert.equal(findHost(unsafeRender, 'a').length, 0, 'javascript: URLs never become anchors');

  const mdSourceRender = renderTree(T.FileViewer(Object.assign({}, mdProps, { markdownMode: 'source' })));
  const mdToggleButtons = mdSourceRender.hosts.filter(function (host) {
    return host.type === 'button' && host.props['data-md-mode'] !== undefined;
  });
  assert.deepEqual(
    mdToggleButtons.map(function (button) { return button.props['data-md-mode']; }),
    ['source', 'preview'],
    'Markdown files expose the source/preview toggle',
  );
  assert.equal(findHost(mdSourceRender, 'textarea').length, 1, 'source mode keeps the editable textarea');
  assert.equal(mdSourceRender.hosts.filter(function (host) { return host.props['data-md-preview'] === '1'; }).length, 0, 'source mode renders no preview');
  ok('markdown preview: block/inline parser, syntax-highlighted fences, table/quote/list, safe links, source/preview toggle');

  section('images and SVG preview');
  assert.equal(typeof T.imageMimeForPath, 'function', 'S.imageMimeForPath must be exported');
  assert.equal(T.imageMimeForPath('public/logo.svg'), 'image/svg+xml', 'svg detected');
  assert.equal(T.imageMimeForPath('a/b/photo.PNG'), 'image/png', 'extension matching is case-insensitive');
  assert.equal(T.imageMimeForPath('a/photo.jpeg'), 'image/jpeg', 'jpeg detected');
  assert.equal(T.imageMimeForPath('notes.txt'), null, 'text is not an image');
  assert.equal(T.imageMimeForPath('Makefile'), null, 'dotless names are not images');
  assert.equal(T.buildImageDataUrl('image/png', 'iVBORw0KGgo='), 'data:image/png;base64,iVBORw0KGgo=', 'raster data URL');
  assert.equal(T.buildImageDataUrl(null, 'x'), null, 'missing MIME yields no data URL');
  const svgUrl = T.buildSvgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>');
  assert.equal(svgUrl.indexOf('data:image/svg+xml;charset=utf-8,') === 0, true, 'SVG data URL prefix');
  assert.equal(decodeURIComponent(svgUrl.slice(svgUrl.indexOf(',') + 1)).indexOf('<svg') !== -1, true, 'SVG source survives the data URL');

  const imageRender = renderTree(T.ImageViewer({
    t: keyTranslator,
    path: 'public/logo.png',
    src: 'data:image/png;base64,iVBORw0KGgo=',
    mime: 'image/png',
    size: 1234,
    mtimeMs: 1700000000000,
    dimensions: { width: 640, height: 480 },
    onDimensions: function () {},
  }));
  const imageTags = findHost(imageRender, 'img');
  assert.equal(imageTags.length, 1, 'ImageViewer renders one img');
  assert.equal(imageTags[0].props.src, 'data:image/png;base64,iVBORw0KGgo=', 'img uses the data URL');
  assert.equal(imageRender.texts.includes('files.image.badge'), true, 'image badge comes from the dictionary');
  assert.equal(imageRender.texts.includes('files.image.dimensions[width=640,height=480]'), true, 'natural dimensions are shown');

  const svgProps = Object.assign({}, plainViewerProps, {
    path: 'public/logo.svg',
    value: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="8" height="8"/></svg>',
    lineCount: 1,
    language: 'xml',
    isSvg: true,
    svgMode: 'image',
    svgDataUrl: svgUrl,
    dimensions: null,
  });
  const svgRender = renderTree(T.FileViewer(svgProps));
  const svgImages = svgRender.hosts.filter(function (host) { return host.props['data-svg-image'] === '1'; });
  assert.equal(svgImages.length, 1, 'SVG image mode renders the img');
  assert.equal(svgImages[0].props.src, svgUrl, 'SVG img uses the source data URL');
  const svgModes = svgRender.hosts
    .filter(function (host) { return host.type === 'button' && host.props['data-svg-mode'] !== undefined; })
    .map(function (button) { return button.props['data-svg-mode']; });
  assert.deepEqual(svgModes, ['image', 'source'], 'SVG files expose the image/source toggle');
  assert.equal(findHost(svgRender, 'textarea').length, 0, 'image mode renders no editor');
  assert.equal(svgRender.texts.includes('files.svg.shortcut'), true, 'status bar advertises the toggle shortcut');
  const svgSourceRender = renderTree(T.FileViewer(Object.assign({}, svgProps, { svgMode: 'source' })));
  assert.equal(findHost(svgSourceRender, 'textarea').length, 1, 'source mode keeps the editable textarea');
  assert.equal(svgSourceRender.hosts.filter(function (host) { return host.props['data-svg-image'] === '1'; }).length, 0, 'source mode renders no image');
  ok('images: mime detection, data URLs, ImageViewer, SVG image/source toggle');

  const searchData = {
    files: [
      { path: 'src/a.js', matches: [{ line: 7, column: 5, length: 3, text: 'foo bar baz' }] },
    ],
    totalMatches: 1,
    elapsedMs: 4,
    truncated: false,
  };
  const searchRender = renderTree(T.SearchResults({ t: keyTranslator, data: searchData, query: 'bar', onOpenFile: function () {} }));
  assert.equal(findHost(searchRender, 'mark').length, 1, 'a hit is wrapped in <mark>');
  assert.equal(findHost(searchRender, 'mark')[0].props.children, 'bar', 'the mark holds the matched slice');
  assert.equal(searchRender.texts.some(function (text) { return text.indexOf('search.summary[') === 0; }), true, 'summary text is built from the dictionary with interpolated params');
  assert.equal(searchRender.texts.indexOf('bar') !== -1, true, 'marked text appears in the tree');
  ok('SearchResults groups by file and highlights with <mark>');

  const diffRender = renderTree(T.DiffView({ t: keyTranslator, diff: sampleDiff }));
  const kinds = diffRender.hosts
    .filter(function (host) { return host.type === 'div' && host.props['data-kind'] !== undefined; })
    .map(function (host) { return host.props['data-kind']; });
  assert.deepEqual(kinds, ['meta', 'meta', 'meta', 'meta', 'hunk', 'ctx', 'del', 'add', 'add'], 'DiffView renders one row per parsed line');
  ok('DiffView renders metadata, hunk, context, deletions and additions');

  const gitRender = renderTree(T.GitView({ t: keyTranslator, root: '/tmp/workspace', reloadToken: 0 }));
  assert.equal(findHost(gitRender, 'button').length >= 1, true, 'the git header renders with its controls');
  ok('GitView renders its loading state');

  const gitLists = renderTree(T.GitChangesList({ t: keyTranslator, groups: T.groupChanges([
    { path: 'src/a.js', status: 'M ', index: 'M', worktree: ' ' },
    { path: 'src/b.js', status: '??', index: '?', worktree: '?' },
  ]), selection: null, onSelect: function () {} }));
  assert.equal(gitLists.texts.includes('git.group.staged'), true, 'staged group label');
  assert.equal(gitLists.texts.includes('git.group.untracked'), true, 'untracked group label');
  assert.equal(gitLists.texts.includes('git.group.conflicted'), false, 'empty groups are not rendered');
  const historyRender = renderTree(T.GitHistoryList({ t: keyTranslator, commits: [{ hash: 'abcdef1234567890', short: 'abcdef1', author: 'Ada', date: '2026-01-02T03:04:05Z', subject: 'init', refs: ['HEAD'] }], selection: null, onSelect: function () {} }));
  assert.equal(historyRender.texts.includes('abcdef1'), true, 'history row shows the short hash');
  assert.equal(historyRender.texts.includes('init'), true, 'history row shows the subject');
  ok('Git changes list + history list render rows');

  const notRepoWorkspaces = [
    { id: 'cur', path: '/w/current', title: 'current-ws', live: true, git: false },
    { id: 'g1', path: '/w/g1', title: 'git-one', git: true },
    { id: 'g2', path: '/w/g2', title: 'git-two', git: true },
    { id: 'g3', path: '/w/g3', title: 'git-three', git: true },
    { id: 'g4', path: '/w/g4', title: 'git-four', git: true },
    { id: 'g5', path: '/w/g5', title: 'git-five', git: true },
    { id: 'g6', path: '/w/g6', title: 'git-six', git: true },
    { id: 'n1', path: '/w/plain', title: 'also-not-git', git: false },
  ];
  const pickedWorkspaces = [];
  const notRepoRender = renderTree(T.GitNotRepoState({
    t: keyTranslator,
    root: '/w/current',
    workspaces: notRepoWorkspaces,
    onRetry: function () {},
    onSelectWorkspace: function (next) { pickedWorkspaces.push(next); },
  }));
  assert.equal(
    notRepoRender.texts.some(function (text) { return text.indexOf('git.notRepo.current[title=current-ws]') === 0; }),
    true,
    'the not-a-repo state names the current workspace',
  );
  assert.equal(notRepoRender.texts.includes('git.notRepo.title'), true, 'the not-a-repo state keeps the headline');
  assert.equal(notRepoRender.texts.includes('action.retry'), true, 'the not-a-repo state offers a retry');
  const quickSwitches = notRepoRender.hosts.filter(function (host) {
    return host.type === 'button' && host.props['data-workspace'] !== undefined;
  });
  assert.equal(quickSwitches.length, 5, 'quick switches are capped at five workspaces');
  assert.equal(quickSwitches.some(function (host) { return host.props['data-workspace'] === '/w/current'; }), false, 'the current workspace is not offered again');
  assert.equal(quickSwitches.some(function (host) { return host.props['data-workspace'] === '/w/plain'; }), false, 'non-git workspaces are not offered');
  quickSwitches[0].props.onClick();
  assert.deepEqual(pickedWorkspaces, [quickSwitches[0].props['data-workspace']], 'clicking a quick switch selects that workspace root');
  const noCandidateRender = renderTree(T.GitNotRepoState({
    t: keyTranslator,
    root: '/w/current',
    workspaces: [notRepoWorkspaces[0]],
    onRetry: function () {},
    onSelectWorkspace: function () {},
  }));
  assert.equal(noCandidateRender.hosts.filter(function (host) { return host.props['data-workspace'] !== undefined; }).length, 0, 'no quick switches when no other git workspace exists');
  assert.equal(noCandidateRender.texts.includes('git.notRepo.body'), true, 'the generic hint is shown instead');
  ok('GitNotRepoState: names the root, retries, offers up to 5 git workspaces');

  const shellSource = readFileSync(path.join(SOURCE_DIR, '10-shell.js'), 'utf8');
  assert.ok(/GitView[\s\S]{0,700}?workspaces:\s*workspaces/.test(shellSource), 'Shell must pass the workspace list to GitView');
  assert.ok(/GitView[\s\S]{0,700}?onSelectWorkspace:\s*selectRoot/.test(shellSource), 'Shell must pass onSelectWorkspace to GitView');
  ok('Shell wires workspaces + onSelectWorkspace into GitView');

  const toolbarRender = renderTree(T.ShellToolbar({
    t: keyTranslator,
    tab: 'files',
    root: '/w/a',
    workspaces: [
      { id: 'a', path: '/w/a', title: 'A', sessionCount: 1, live: true },
      { id: 'b', path: '/w/b', title: 'B', sessionCount: 0, live: false },
    ],
    loading: false,
    onSelectTab: function () {},
    onSelectRoot: function () {},
    onRefresh: function () {},
  }));
  const selects = findHost(toolbarRender, 'select');
  assert.equal(selects.length, 1, 'the workspace picker renders a native select');
  assert.equal(selects[0].props.value, '/w/a', 'the select reflects the active root');
  assert.equal(findHost(toolbarRender, 'option').length, 2, 'one option per workspace');
  ok('ShellToolbar: three tabs + workspace select + refresh');

  section('error boundary');
  const boundary = new (T.PanelBoundary)({ t: keyTranslator, children: { type: 'div', props: { children: 'ok' } } });
  assert.equal(typeof T.PanelBoundary.getDerivedStateFromError, 'function', 'PanelBoundary must implement getDerivedStateFromError');
  const healthy = renderTree(boundary.render());
  assert.equal(healthy.texts.includes('ok'), true, 'a healthy boundary renders its children');
  const derived = T.PanelBoundary.getDerivedStateFromError(new Error('boom'));
  assert.equal(derived.error.message, 'boom', 'the boundary captures the error');
  boundary.state = Object.assign({}, boundary.state, derived);
  const crashed = renderTree(boundary.render());
  assert.equal(crashed.texts.includes('crash.title'), true, 'the boundary renders its crash title');
  assert.equal(crashed.texts.some(function (text) { return text.indexOf('boom') !== -1; }), true, 'the boundary renders the error message');
  ok('PanelBoundary: renders children, captures errors, shows crash card');

  assert.ok(react.hookScopeCount() >= 20, 'all rendered components must be hook-order tracked (got ' + String(react.hookScopeCount()) + ')');
  ok('hook order is stable across every rendered component (' + String(react.hookScopeCount()) + ' components)');

  section('stale artifact detection');
  const original = readFileSync(ARTIFACT, 'utf8');
  try {
    writeFileSync(ARTIFACT, original + '\n/* stale marker for the smoke test */\n', 'utf8');
    const stale = spawnSync(process.execPath, [BUILD_SCRIPT, '--check'], { encoding: 'utf8' });
    assert.notEqual(stale.status, 0, 'build --check must fail on a stale artifact');
    assert.ok(String(stale.stderr).includes('stale'), 'build --check reports a stale artifact: ' + String(stale.stderr));
  } finally {
    writeFileSync(ARTIFACT, original, 'utf8');
  }
  const restored = spawnSync(process.execPath, [BUILD_SCRIPT, '--check'], { encoding: 'utf8' });
  assert.equal(restored.status, 0, 'the restored artifact is current again');
  ok('build --check detects a stale artifact and passes again after restore');

  process.stdout.write('\nall good: ' + String(checks) + ' checks\n');
}

try {
  run();
} catch (cause) {
  process.stderr.write('\nclient smoke test failed: ' + String(cause !== null && cause !== undefined && cause.stack ? cause.stack : cause) + '\n');
  process.exit(1);
}
