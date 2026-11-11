/**
 * dsh-workspace-ide — client half, shared core.
 *
 * A VS Code-like workspace panel mounted in the central `main` slot and opened
 * from one left-rail icon. This file owns everything the three surfaces share:
 *
 *   - the module constants (ids, routes, limits),
 *   - the built-in zh/en dictionary and the `t()` plumbing,
 *   - the small HTTP helper every view talks through (same-origin `fetch`,
 *     JSON envelope unwrapping, `AbortSignal` pass-through),
 *   - inline SVG icons, the neutral formatters and the shared UI primitives
 *     (buttons, split pane, empty/error/loading states, notice bars),
 *   - the inline style objects. Every colour is a `--dsw-alias-*` theme token
 *     so the panel follows DSH dark *and* light themes; no CSS file, no class
 *     names, no build-time style step.
 *
 * The file is concatenated into the `factory(require)` body by
 * `scripts/build-client.mjs`: it must stay plain script (no import/export, no
 * JSX) and attach everything to the shared `S` object.
 */

/** One id binds the sidebar rail cell to the central panel it addresses. */
const PANEL_ID = 'workspace-ide';
/** Locale namespace for every visible string in this plugin. */
const NS = 'dsh-workspace-ide';
/** Host routes, browser-relative: the connection service authorises a same-origin fetch. */
const ROUTES = Object.freeze({
  workspaces: 'api/dsh-workspace-ide.workspaces',
  list: 'api/dsh-workspace-ide.list',
  file: 'api/dsh-workspace-ide.file',
  search: 'api/dsh-workspace-ide.search',
  git: 'api/dsh-workspace-ide.git',
  save: 'api/dsh-workspace-ide.save',
  ping: 'api/dsh-workspace-ide.ping',
});
/** Where the shell remembers the chosen workspace root across reloads. */
const STORAGE_ROOT = 'dsh-workspace-ide:root';
/** Persisted store the DSH workspace UI writes the currently viewed session to. */
const STORAGE_CURRENT_SESSION = 'dsh.sessions.current';
/** Above this size a file opens read-only (the editor would crawl). */
const MAX_EDITABLE_BYTES = 400 * 1024;
/** Diff views cap their rendered rows to keep huge patches cheap. */
const MAX_DIFF_LINES = 4000;
/** Editor metrics: the gutter scroll sync and line jumps rely on these. */
const EDITOR_LINE_HEIGHT = 20;
const EDITOR_PADDING_TOP = 10;
/**
 * Rendering guard: the editor paints one span per coloured token, so a very
 * dense file (minified bundles) can explode the element count even when it is
 * below the highlighter's 300 KB scanner guard. Above this many segments the
 * viewer drops the coloured layer and keeps plain text, which is instant.
 */
const MAX_SYNTAX_SEGMENTS = 50000;
/** Split pane bounds shared by the Files tree and the Git change list. */
const SPLIT_MIN = 180;
const SPLIT_MAX = 560;

/** The three toolbar tabs, left to right — the centrepiece of the panel. */
S.TABS = [
  { id: 'files', icon: 'Files' },
  { id: 'search', icon: 'Search' },
  { id: 'git', icon: 'Git' },
];

// ─── locale ──────────────────────────────────────────────────────────────────
//
// The dictionary is registered with the Client locale service when that service
// is present (see 99-face.js); the slot then hands the panel its own `t`. When
// the service is absent the same dictionary is used with the page language.

const DICT = {
  zh: {
    panel: '工作区',
    'tabs.label': '视图',
    'tabs.files': '文件',
    'tabs.search': '搜索',
    'tabs.git': 'Git',
    'action.refresh': '刷新',
    'action.retry': '重试',
    'action.save': '保存',
    'action.saving': '保存中…',
    'action.dismiss': '关闭',
    'action.loading': '加载中…',
    'root.pick': '选择工作区',
    'root.loading': '正在读取工作区…',
    'root.empty.title': '还没有可用的工作区',
    'root.empty.body': 'DSH 还没有登记任何工作区。先打开一个对话或新建工作区，然后重试。',
    'root.error.title': '无法读取工作区列表',
    'root.select.title': '切换工作区',
    'root.switch': '工作区：{title}',
    crash: '面板渲染失败：{message}',
    'crash.title': '工作区面板出错了',
    'crash.body': '错误已被限制在面板内部，DSH 的其余部分不受影响。',
    'common.request': '请求失败：{message}',
    'common.unknown': '未知错误',
    'common.none': '—',
    'common.retry': '重试',
    'common.cancel': '取消',
    'files.loading': '正在打开文件…',
    'files.error': '无法打开文件：{message}',
    'files.error.title': '无法打开文件',
    'files.open.title': '从左侧选择一个文件',
    'files.open.body': '浏览工作区、打开并编辑文件，或在搜索视图里查找整个工作区的内容。',
    'files.tree.loading': '正在读取目录…',
    'files.tree.empty': '空目录',
    'files.tree.error': '无法读取目录：{message}',
    'files.tree.truncated': '目录条目过多，列表已截断',
    'files.tree.label': '文件树',
    'files.binary.title': '二进制文件',
    'files.binary.body': '这个文件不是文本，无法在代码查看器中打开。',
    'files.readonly.big': '文件大于 {limit}，以只读方式打开。',
    'files.readonly.truncated': '文件超过 2 MiB，只读取了开头部分。',
    'files.readonly': '只读',
    'files.modified': '已修改',
    'files.saved': '已保存',
    'files.saveError': '保存失败：{message}',
    'files.saveShortcut': '保存（Ctrl/Cmd+S）',
    'files.escapeHint': '按 Esc 放弃修改',
    'files.discard': '已放弃未保存的修改',
    'files.dirtyHint': '未保存的修改在切换文件或刷新时会丢失',
    'files.commentShortcut': '⌘/ 注释',
    'files.commentHint': '注释/取消注释当前行或选中的行（Cmd 或 Ctrl + /）',
    'files.caret': '行 {line}，列 {column}',
    'files.lines': '{count} 行',
    'files.encoding': 'UTF-8',
    'files.language': '语言：{language}',
    'files.modifiedAt': '修改于 {time}',
    'files.saveUnavailable': '当前文件不可编辑',
    'search.placeholder': '在工作区中搜索',
    'search.include': '包含文件',
    'search.includePlaceholder': '包含文件，例如 *.ts, src/**',
    'search.case': '区分大小写',
    'search.regex': '使用正则表达式',
    'search.whole': '全字匹配',
    'search.run': '搜索',
    'search.running': '搜索中…',
    'search.summary': '{files} 个文件 · {matches} 个结果 · {ms}ms',
    'search.truncated': '结果已截断，缩小范围可获得更完整的结果',
    'search.idle.title': '搜索整个工作区',
    'search.idle.body': '输入关键词后按 Enter 或点击搜索。支持正则、区分大小写与全字匹配。',
    'search.empty': '没有匹配项：{query}',
    'search.empty.body': '试试更短的关键词，或放宽大小写 / 全字 / 正则限制。',
    'search.error': '搜索失败：{message}',
    'search.error.title': '搜索失败',
    'search.matches': '{count} 个结果',
    'search.open': '打开 {path}',
    'search.scanned': '扫描了 {files} 个文件',
    'git.loading': '正在读取 Git 状态…',
    'git.error': '无法读取 Git 信息：{message}',
    'git.error.title': '无法读取 Git 信息',
    'git.notRepo.title': '这不是 Git 仓库',
    'git.notRepo.body': '当前工作区没有 Git 仓库，或该目录不在仓库工作树内。',
    'git.notRepo.current': '当前工作区「{title}」不是 Git 仓库。',
    'git.notRepo.others': '以下工作区是 Git 仓库，可直接切换：',
    'git.changes': '更改',
    'git.history': '历史',
    'git.clean': '工作区干净',
    'git.counts': '{count} 项更改',
    'git.branch': '分支 {branch}',
    'git.ahead': '领先 {count}',
    'git.behind': '落后 {count}',
    'git.group.staged': '已暂存',
    'git.group.unstaged': '未暂存',
    'git.group.untracked': '未跟踪',
    'git.group.conflicted': '冲突',
    'git.changes.empty': '没有更改',
    'git.changes.empty.body': '工作区是干净的，暂存区也还没有内容。',
    'git.changes.loading': '正在读取更改…',
    'git.diff.title': '差异',
    'git.diff.loading': '正在读取差异…',
    'git.diff.error': '无法读取差异：{message}',
    'git.diff.error.title': '无法读取差异',
    'git.diff.empty': '无差异',
    'git.diff.truncated': '差异超过 {lines} 行，已截断',
    'git.diff.capped': '差异过大，只显示开头部分',
    'git.diff.select': '选择一个更改以查看差异',
    'git.diff.selectCommit': '选择一次提交以查看差异',
    'git.diff.staged': '已暂存',
    'git.diff.untracked': '未跟踪',
    'git.diff.commit': '提交',
    'git.history.loading': '正在读取提交历史…',
    'git.history.empty': '还没有提交',
    'git.history.empty.body': '这个仓库还没有任何提交记录。',
    'git.history.count': '{count} 次提交',
    'git.commit.meta': '{author} · {date}',
    'git.refresh': '刷新 Git 状态',
    'git.renamedFrom': '来自 {path}',
    'git.aheadHint': '本地领先上游 {count} 个提交',
    'git.behindHint': '本地落后上游 {count} 个提交',
    'git.upstream': '上游 {branch}',
    'theme.label': '主题',
    'theme.title': '界面主题',
    'theme.auto': '跟随 DSH 主题',
    'theme.close': '关闭',
  },
  en: {
    panel: 'Workspace',
    'tabs.label': 'Views',
    'tabs.files': 'Files',
    'tabs.search': 'Search',
    'tabs.git': 'Git',
    'action.refresh': 'Refresh',
    'action.retry': 'Retry',
    'action.save': 'Save',
    'action.saving': 'Saving…',
    'action.dismiss': 'Dismiss',
    'action.loading': 'Loading…',
    'root.pick': 'Select workspace',
    'root.loading': 'Loading workspaces…',
    'root.empty.title': 'No workspace available',
    'root.empty.body': 'DSH has no registered workspace yet. Open a conversation or create a workspace, then retry.',
    'root.error.title': 'Could not load the workspace list',
    'root.select.title': 'Switch workspace',
    'root.switch': 'Workspace: {title}',
    crash: 'The panel failed to render: {message}',
    'crash.title': 'The workspace panel hit an error',
    'crash.body': 'The error is contained inside the panel; the rest of DSH keeps working.',
    'common.request': 'Request failed: {message}',
    'common.unknown': 'Unknown error',
    'common.none': '—',
    'common.retry': 'Retry',
    'common.cancel': 'Cancel',
    'files.loading': 'Opening file…',
    'files.error': 'Could not open the file: {message}',
    'files.error.title': 'Could not open the file',
    'files.open.title': 'Select a file from the tree',
    'files.open.body': 'Browse the workspace, open a file to view or edit it, or search the whole workspace from the search view.',
    'files.tree.loading': 'Loading directory…',
    'files.tree.empty': 'Empty directory',
    'files.tree.error': 'Could not read this directory: {message}',
    'files.tree.truncated': 'Too many entries; the listing is truncated',
    'files.tree.label': 'File tree',
    'files.binary.title': 'Binary file',
    'files.binary.body': 'This file is not text, so it cannot open in the code viewer.',
    'files.readonly.big': 'This file is larger than {limit} and opens read-only.',
    'files.readonly.truncated': 'The file exceeds 2 MiB; only the beginning was read.',
    'files.readonly': 'Read-only',
    'files.modified': 'Modified',
    'files.saved': 'Saved',
    'files.saveError': 'Save failed: {message}',
    'files.saveShortcut': 'Save (Ctrl/Cmd+S)',
    'files.escapeHint': 'Press Esc to discard changes',
    'files.discard': 'Unsaved changes discarded',
    'files.dirtyHint': 'Unsaved edits are lost when you switch files or refresh',
    'files.commentShortcut': '⌘/ comment',
    'files.commentHint': 'Comment or uncomment the current line or selection (Cmd/Ctrl + /)',
    'files.caret': 'Ln {line}, Col {column}',
    'files.lines': '{count} lines',
    'files.encoding': 'UTF-8',
    'files.language': 'Language: {language}',
    'files.modifiedAt': 'Modified {time}',
    'files.saveUnavailable': 'This file is not editable',
    'search.placeholder': 'Search the workspace',
    'search.include': 'Include files',
    'search.includePlaceholder': 'Include files, e.g. *.ts, src/**',
    'search.case': 'Match case',
    'search.regex': 'Use regular expression',
    'search.whole': 'Match whole word',
    'search.run': 'Search',
    'search.running': 'Searching…',
    'search.summary': '{files} files · {matches} matches · {ms}ms',
    'search.truncated': 'Results were truncated; narrow the search for complete results',
    'search.idle.title': 'Search the whole workspace',
    'search.idle.body': 'Type a query and press Enter or click Search. Regex, case-sensitive and whole-word matching are supported.',
    'search.empty': 'No matches for “{query}”',
    'search.empty.body': 'Try a shorter query, or relax the case / whole-word / regex options.',
    'search.error': 'Search failed: {message}',
    'search.error.title': 'Search failed',
    'search.matches': '{count} matches',
    'search.open': 'Open {path}',
    'search.scanned': 'scanned {files} files',
    'git.loading': 'Reading git status…',
    'git.error': 'Could not read git information: {message}',
    'git.error.title': 'Could not read git information',
    'git.notRepo.title': 'Not a git repository',
    'git.notRepo.body': 'This workspace has no git repository, or the directory is outside a working tree.',
    'git.notRepo.current': 'The current workspace “{title}” is not a git repository.',
    'git.notRepo.others': 'These workspaces are git repositories — switch to one:',
    'git.changes': 'Changes',
    'git.history': 'History',
    'git.clean': 'Working tree clean',
    'git.counts': '{count} changes',
    'git.branch': 'Branch {branch}',
    'git.ahead': '{count} ahead',
    'git.behind': '{count} behind',
    'git.group.staged': 'Staged',
    'git.group.unstaged': 'Unstaged',
    'git.group.untracked': 'Untracked',
    'git.group.conflicted': 'Conflicts',
    'git.changes.empty': 'No changes',
    'git.changes.empty.body': 'The working tree is clean and the index is empty.',
    'git.changes.loading': 'Reading changes…',
    'git.diff.title': 'Diff',
    'git.diff.loading': 'Loading diff…',
    'git.diff.error': 'Could not load the diff: {message}',
    'git.diff.error.title': 'Could not load the diff',
    'git.diff.empty': 'No differences',
    'git.diff.truncated': 'The diff exceeds {lines} lines and was truncated',
    'git.diff.capped': 'The diff is large; only the beginning is shown',
    'git.diff.select': 'Select a change to view its diff',
    'git.diff.selectCommit': 'Select a commit to view its diff',
    'git.diff.staged': 'Staged',
    'git.diff.untracked': 'Untracked',
    'git.diff.commit': 'Commit',
    'git.history.loading': 'Reading commit history…',
    'git.history.empty': 'No commits yet',
    'git.history.empty.body': 'This repository has no commits yet.',
    'git.history.count': '{count} commits',
    'git.commit.meta': '{author} · {date}',
    'git.refresh': 'Refresh git status',
    'git.renamedFrom': 'from {path}',
    'git.aheadHint': '{count} commits ahead of the upstream',
    'git.behindHint': '{count} commits behind the upstream',
    'git.upstream': 'Upstream {branch}',
    'theme.label': 'Theme',
    'theme.title': 'Color theme',
    'theme.auto': 'Follow DSH theme',
    'theme.close': 'Close',
  },
};

S.I18N = DICT;

/**
 * Active page language: the document element's lang wins, then the browser
 * language. Defensive because the smoke test renders without a DOM.
 * @returns {string} a language tag ('' when nothing is known).
 */
function localePref() {
  try {
    if (typeof document !== 'undefined' && document !== null && document.documentElement) {
      const lang = document.documentElement.lang;
      if (typeof lang === 'string' && lang.length > 0) return lang;
    }
  } catch (error) {
    /* no DOM */
  }
  try {
    if (typeof navigator !== 'undefined' && navigator !== null && typeof navigator.language === 'string') {
      return navigator.language;
    }
  } catch (error) {
    /* no navigator */
  }
  return 'en';
}

/** @param {string} lang - language tag. @returns {boolean} true for Chinese. */
function isChinese(lang) {
  return typeof lang === 'string' && lang.toLowerCase().indexOf('zh') === 0;
}

/**
 * Dictionary lookup with `{name}` interpolation and an English fallback.
 * @param {string} lang - active language tag.
 * @param {string} key - dictionary key.
 * @param {object} [params] - interpolation values.
 * @returns {string} translated text (the key when unknown).
 */
function translateText(lang, key, params) {
  const table = isChinese(lang) ? DICT.zh : DICT.en;
  let template = table[key];
  if (typeof template !== 'string') template = DICT.en[key];
  if (typeof template !== 'string') return key;
  if (params === undefined || params === null) return template;
  return template.replace(/\{(\w+)\}/g, function (match, name) {
    return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match;
  });
}

/**
 * The fallback translator hook used when the slot supplies no `t` prop.
 * @returns {(key: string, params?: object) => string} stable translator.
 */
S.useT = function useT() {
  const lang = localePref();
  return useCallback(function (key, params) {
    return translateText(lang, key, params);
  }, [lang]);
};

/** @returns {string} the active language tag. */
S.localePref = localePref;

/**
 * Translate with the current page language (non-hook form).
 * @param {string} key - dictionary key.
 * @param {object} [params] - interpolation values.
 * @returns {string} translated text.
 */
S.translate = function translate(key, params) {
  return translateText(localePref(), key, params);
};

/**
 * Translate through an optional translator, falling back to the key — handy for
 * presentational components that may be rendered without a locale seat.
 * @param {Function|undefined} translator - a `t` function when provided.
 * @param {string} key - dictionary key.
 * @param {object} [params] - interpolation values.
 * @returns {string} translated text or the key.
 */
function translateOrKey(translator, key, params) {
  return typeof translator === 'function' ? translator(key, params) : key;
}

S.tt = translateOrKey;

// ─── formatting ──────────────────────────────────────────────────────────────

/**
 * @param {number} bytes - byte count.
 * @returns {string} compact binary size (e.g. "12.4 KB"), "—" when unknown.
 */
function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return value + ' B';
  const units = ['KB', 'MB', 'GB'];
  let scaled = value / 1024;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled = scaled / 1024;
    index = index + 1;
  }
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return scaled.toFixed(digits) + ' ' + units[index];
}

/**
 * @param {number|string} value - epoch ms or parseable date string.
 * @returns {string} locale-aware "YYYY/MM/DD HH:mm"-style timestamp or "—".
 */
function formatDateTime(value) {
  const ms = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(ms)) return '—';
  const lang = localePref();
  try {
    return new Intl.DateTimeFormat(isChinese(lang) ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms));
  } catch (error) {
    try {
      return new Date(ms).toLocaleString();
    } catch (nested) {
      return '—';
    }
  }
}

/**
 * @param {number} value - integer.
 * @returns {string} grouped integer when Intl exists.
 */
function formatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  const lang = localePref();
  try {
    return new Intl.NumberFormat(isChinese(lang) ? 'zh-CN' : 'en-US').format(number);
  } catch (error) {
    return String(number);
  }
}

/**
 * @param {number} value - candidate.
 * @param {number} min - lower bound.
 * @param {number} max - upper bound.
 * @returns {number} clamped value.
 */
function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  if (number < min) return min;
  if (number > max) return max;
  return number;
}

// ─── storage ─────────────────────────────────────────────────────────────────

/** @param {string} key - localStorage key. @returns {string|null} stored text. */
function readStorage(key) {
  try {
    if (typeof window === 'undefined' || window === null) return null;
    const store = window.localStorage;
    if (!store || typeof store.getItem !== 'function') return null;
    const value = store.getItem(key);
    return typeof value === 'string' ? value : null;
  } catch (error) {
    return null;
  }
}

/** @param {string} key - localStorage key. @param {string|null} value - text or null. */
function writeStorage(key, value) {
  try {
    if (typeof window === 'undefined' || window === null) return;
    const store = window.localStorage;
    if (!store || typeof store.setItem !== 'function') return;
    if (value === null || value === undefined) store.removeItem(key);
    else store.setItem(key, String(value));
  } catch (error) {
    /* private mode / no DOM */
  }
}

/** @param {string} key - localStorage key. @returns {number|null} stored number. */
function readStoredNumber(key) {
  const raw = readStorage(key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** @param {string} key - localStorage key. @param {number} value - number to store. */
function writeStoredNumber(key, value) {
  if (typeof key !== 'string' || !Number.isFinite(value)) return;
  writeStorage(key, String(Math.round(value)));
}

S.readStorage = readStorage;
S.writeStorage = writeStorage;
S.readStoredNumber = readStoredNumber;
S.writeStoredNumber = writeStoredNumber;

// ─── colour themes ───────────────────────────────────────────────────────────
//
// A VSCode-style colour theme is *not* a second set of colour values in the
// components: it is a table of DSH alias-token overrides laid on the panel root
// as inline custom properties. Every `C` colour above stays a
// `var(--dsw-alias-*)` reference, so the panel subtree resolves the overridden
// value while the rest of DSH keeps its own theme. `auto` (the default)
// overrides nothing and therefore follows DSH's active light/dark theme.
// Every literal colour in the Client half lives in THEME_PALETTES below.

/** Where the shell remembers the selected colour theme across reloads. */
const STORAGE_THEME = 'dsh-workspace-ide:theme';

/**
 * Per-theme DSH alias-token override tables — the six mainstream VSCode
 * palettes. Each palette opens with its syntax-highlighting `--ide-tok-*`
 * colours (the VSCode token colours the Files editor overlay reads through
 * `S.SYN`) and then overrides the DSH alias tokens. `auto` contributes no
 * `--ide-tok-*`, so the code follows DSH's own `--shiki-token-*` values
 * (which is why the panel stays in sync with the app's light/dark switch).
 * Override keys keep the full `--dsw-alias-*` token name so the table doubles
 * as the audit list. The critical alias token order is fixed and identical in
 * every palette: bg-base, bg-layer-1, bg-layer-2, bg-module-platform, border-l1,
 * border-l2, label-primary, label-secondary, label-tertiary, label-caption,
 * brand-primary, link, interactive-bg-hover, interactive-bg-active,
 * label-primary-inverted, state-error-primary, state-success-primary,
 * state-warn-primary, state-warn-label, file-diff-added-marker,
 * file-diff-deleted-marker, code-diff-added, code-diff-deleted.
 * The four dark palettes additionally raise the scrollbar thumb so it stays
 * visible on their dark panel background.
 */
const THEME_PALETTES = Object.freeze({
  'dark-plus': Object.freeze({
    // Syntax-highlighting token colours (`--ide-tok-*`) for this palette.
    '--ide-tok-keyword': '#569CD6',
    '--ide-tok-string': '#CE9178',
    '--ide-tok-comment': '#6A9955',
    '--ide-tok-number': '#B5CEA8',
    '--ide-tok-constant': '#4FC1FF',
    '--ide-tok-function': '#DCDCAA',
    '--ide-tok-type': '#4EC9B0',
    '--ide-tok-variable': '#9CDCFE',
    '--ide-tok-operator': '#D4D4D4',
    '--ide-tok-punctuation': '#D4D4D4',
    '--ide-tok-tag': '#569CD6',
    '--ide-tok-attr': '#9CDCFE',
    '--ide-tok-property': '#DCDCAA',
    '--ide-tok-regexp': '#CE9178',
    '--ide-tok-meta': '#6A9955',
    '--dsw-alias-bg-base': '#1e1e1e',
    '--dsw-alias-bg-layer-1': '#252526',
    '--dsw-alias-bg-layer-2': '#2d2d30',
    '--dsw-alias-bg-module-platform': '#2d2d30',
    '--dsw-alias-border-l1': '#2b2b2b',
    '--dsw-alias-border-l2': '#3c3c3c',
    '--dsw-alias-label-primary': '#cccccc',
    '--dsw-alias-label-secondary': '#9d9d9d',
    '--dsw-alias-label-tertiary': '#868686',
    '--dsw-alias-label-caption': '#6e7681',
    '--dsw-alias-brand-primary': '#0e639c',
    '--dsw-alias-link': '#4daafc',
    '--dsw-alias-interactive-bg-hover': 'rgba(90,93,94,0.31)',
    '--dsw-alias-interactive-bg-active': 'rgba(90,93,94,0.45)',
    '--dsw-alias-label-primary-inverted': '#ffffff',
    '--dsw-alias-state-error-primary': '#f85149',
    '--dsw-alias-state-success-primary': '#3fb950',
    '--dsw-alias-state-warn-primary': '#cca700',
    '--dsw-alias-state-warn-label': '#cca700',
    '--dsw-alias-file-diff-added-marker': '#3fb950',
    '--dsw-alias-file-diff-deleted-marker': '#f85149',
    '--dsw-alias-code-diff-added': 'rgba(46,160,67,0.15)',
    '--dsw-alias-code-diff-deleted': 'rgba(248,81,73,0.15)',
    '--dsw-alias-scrollbar-bg-l1': 'rgba(121,121,121,0.4)',
    '--dsw-alias-scrollbar-bg-l2': 'rgba(121,121,121,0.4)',
  }),
  'light-plus': Object.freeze({
    '--ide-tok-keyword': '#0000FF',
    '--ide-tok-string': '#A31515',
    '--ide-tok-comment': '#008000',
    '--ide-tok-number': '#098658',
    '--ide-tok-constant': '#0070C1',
    '--ide-tok-function': '#795E26',
    '--ide-tok-type': '#267F99',
    '--ide-tok-variable': '#001080',
    '--ide-tok-operator': '#000000',
    '--ide-tok-punctuation': '#000000',
    '--ide-tok-tag': '#800000',
    '--ide-tok-attr': '#E50000',
    '--ide-tok-property': '#795E26',
    '--ide-tok-regexp': '#A31515',
    '--ide-tok-meta': '#008000',
    '--dsw-alias-bg-base': '#ffffff',
    '--dsw-alias-bg-layer-1': '#f3f3f3',
    '--dsw-alias-bg-layer-2': '#ffffff',
    '--dsw-alias-bg-module-platform': '#f3f3f3',
    '--dsw-alias-border-l1': '#e5e5e5',
    '--dsw-alias-border-l2': '#cecece',
    '--dsw-alias-label-primary': '#3b3b3b',
    '--dsw-alias-label-secondary': '#616161',
    '--dsw-alias-label-tertiary': '#8b949e',
    '--dsw-alias-label-caption': '#9d9d9d',
    '--dsw-alias-brand-primary': '#005fb8',
    '--dsw-alias-link': '#005fb8',
    '--dsw-alias-interactive-bg-hover': 'rgba(0,0,0,0.05)',
    '--dsw-alias-interactive-bg-active': 'rgba(0,0,0,0.08)',
    '--dsw-alias-label-primary-inverted': '#ffffff',
    '--dsw-alias-state-error-primary': '#f14c4c',
    '--dsw-alias-state-success-primary': '#16825d',
    '--dsw-alias-state-warn-primary': '#bf8803',
    '--dsw-alias-state-warn-label': '#bf8803',
    '--dsw-alias-file-diff-added-marker': '#16825d',
    '--dsw-alias-file-diff-deleted-marker': '#d1242f',
    '--dsw-alias-code-diff-added': 'rgba(46,160,67,0.12)',
    '--dsw-alias-code-diff-deleted': 'rgba(255,129,130,0.2)',
  }),
  'one-dark-pro': Object.freeze({
    '--ide-tok-keyword': '#C678DD',
    '--ide-tok-string': '#98C379',
    '--ide-tok-comment': '#5C6370',
    '--ide-tok-number': '#D19A66',
    '--ide-tok-constant': '#D19A66',
    '--ide-tok-function': '#61AFEF',
    '--ide-tok-type': '#E5C07B',
    '--ide-tok-variable': '#E06C75',
    '--ide-tok-operator': '#56B6C2',
    '--ide-tok-punctuation': '#ABB2BF',
    '--ide-tok-tag': '#E06C75',
    '--ide-tok-attr': '#D19A66',
    '--ide-tok-property': '#61AFEF',
    '--ide-tok-regexp': '#98C379',
    '--ide-tok-meta': '#5C6370',
    '--dsw-alias-bg-base': '#282c34',
    '--dsw-alias-bg-layer-1': '#21252b',
    '--dsw-alias-bg-layer-2': '#2c313a',
    '--dsw-alias-bg-module-platform': '#2c313a',
    '--dsw-alias-border-l1': '#3b4048',
    '--dsw-alias-border-l2': '#4b5263',
    '--dsw-alias-label-primary': '#abb2bf',
    '--dsw-alias-label-secondary': '#7f848e',
    '--dsw-alias-label-tertiary': '#5c6370',
    '--dsw-alias-label-caption': '#5c6370',
    '--dsw-alias-brand-primary': '#3d6fd1',
    '--dsw-alias-link': '#61afef',
    '--dsw-alias-interactive-bg-hover': 'rgba(99,123,156,0.2)',
    '--dsw-alias-interactive-bg-active': 'rgba(99,123,156,0.3)',
    '--dsw-alias-label-primary-inverted': '#ffffff',
    '--dsw-alias-state-error-primary': '#e06c75',
    '--dsw-alias-state-success-primary': '#98c379',
    '--dsw-alias-state-warn-primary': '#e5c07b',
    '--dsw-alias-state-warn-label': '#d19a66',
    '--dsw-alias-file-diff-added-marker': '#98c379',
    '--dsw-alias-file-diff-deleted-marker': '#e06c75',
    '--dsw-alias-code-diff-added': 'rgba(152,195,121,0.12)',
    '--dsw-alias-code-diff-deleted': 'rgba(224,108,117,0.12)',
    '--dsw-alias-scrollbar-bg-l1': 'rgba(121,121,121,0.4)',
    '--dsw-alias-scrollbar-bg-l2': 'rgba(121,121,121,0.4)',
  }),
  'dracula': Object.freeze({
    '--ide-tok-keyword': '#FF79C6',
    '--ide-tok-string': '#F1FA8C',
    '--ide-tok-comment': '#6272A4',
    '--ide-tok-number': '#BD93F9',
    '--ide-tok-constant': '#BD93F9',
    '--ide-tok-function': '#50FA7B',
    '--ide-tok-type': '#8BE9FD',
    '--ide-tok-variable': '#F8F8F2',
    '--ide-tok-operator': '#FF79C6',
    '--ide-tok-punctuation': '#F8F8F2',
    '--ide-tok-tag': '#FF79C6',
    '--ide-tok-attr': '#50FA7B',
    '--ide-tok-property': '#50FA7B',
    '--ide-tok-regexp': '#F1FA8C',
    '--ide-tok-meta': '#6272A4',
    '--dsw-alias-bg-base': '#282a36',
    '--dsw-alias-bg-layer-1': '#21222c',
    '--dsw-alias-bg-layer-2': '#44475a',
    '--dsw-alias-bg-module-platform': '#343746',
    '--dsw-alias-border-l1': '#3d4152',
    '--dsw-alias-border-l2': '#4e5266',
    '--dsw-alias-label-primary': '#f8f8f2',
    '--dsw-alias-label-secondary': '#a4a8c0',
    '--dsw-alias-label-tertiary': '#6272a4',
    '--dsw-alias-label-caption': '#6272a4',
    '--dsw-alias-brand-primary': '#7c5bd9',
    '--dsw-alias-link': '#bd93f9',
    '--dsw-alias-interactive-bg-hover': 'rgba(189,147,249,0.12)',
    '--dsw-alias-interactive-bg-active': 'rgba(189,147,249,0.2)',
    '--dsw-alias-label-primary-inverted': '#f8f8f2',
    '--dsw-alias-state-error-primary': '#ff5555',
    '--dsw-alias-state-success-primary': '#50fa7b',
    '--dsw-alias-state-warn-primary': '#f1fa8c',
    '--dsw-alias-state-warn-label': '#ffb86c',
    '--dsw-alias-file-diff-added-marker': '#50fa7b',
    '--dsw-alias-file-diff-deleted-marker': '#ff5555',
    '--dsw-alias-code-diff-added': 'rgba(80,250,123,0.12)',
    '--dsw-alias-code-diff-deleted': 'rgba(255,85,85,0.12)',
    '--dsw-alias-scrollbar-bg-l1': 'rgba(121,121,121,0.4)',
    '--dsw-alias-scrollbar-bg-l2': 'rgba(121,121,121,0.4)',
  }),
  'github-dark': Object.freeze({
    '--ide-tok-keyword': '#FF7B72',
    '--ide-tok-string': '#A5D6FF',
    '--ide-tok-comment': '#8B949E',
    '--ide-tok-number': '#79C0FF',
    '--ide-tok-constant': '#79C0FF',
    '--ide-tok-function': '#D2A8FF',
    '--ide-tok-type': '#FFA657',
    '--ide-tok-variable': '#E6EDF3',
    '--ide-tok-operator': '#FF7B72',
    '--ide-tok-punctuation': '#E6EDF3',
    '--ide-tok-tag': '#7EE787',
    '--ide-tok-attr': '#79C0FF',
    '--ide-tok-property': '#D2A8FF',
    '--ide-tok-regexp': '#A5D6FF',
    '--ide-tok-meta': '#8B949E',
    '--dsw-alias-bg-base': '#0d1117',
    '--dsw-alias-bg-layer-1': '#161b22',
    '--dsw-alias-bg-layer-2': '#21262d',
    '--dsw-alias-bg-module-platform': '#21262d',
    '--dsw-alias-border-l1': '#30363d',
    '--dsw-alias-border-l2': '#3d444d',
    '--dsw-alias-label-primary': '#e6edf3',
    '--dsw-alias-label-secondary': '#8b949e',
    '--dsw-alias-label-tertiary': '#6e7681',
    '--dsw-alias-label-caption': '#6e7681',
    '--dsw-alias-brand-primary': '#238636',
    '--dsw-alias-link': '#58a6ff',
    '--dsw-alias-interactive-bg-hover': 'rgba(177,186,196,0.12)',
    '--dsw-alias-interactive-bg-active': 'rgba(177,186,196,0.2)',
    '--dsw-alias-label-primary-inverted': '#ffffff',
    '--dsw-alias-state-error-primary': '#f85149',
    '--dsw-alias-state-success-primary': '#3fb950',
    '--dsw-alias-state-warn-primary': '#d29922',
    '--dsw-alias-state-warn-label': '#d29922',
    '--dsw-alias-file-diff-added-marker': '#3fb950',
    '--dsw-alias-file-diff-deleted-marker': '#f85149',
    '--dsw-alias-code-diff-added': 'rgba(46,160,67,0.15)',
    '--dsw-alias-code-diff-deleted': 'rgba(248,81,73,0.15)',
    '--dsw-alias-scrollbar-bg-l1': 'rgba(121,121,121,0.4)',
    '--dsw-alias-scrollbar-bg-l2': 'rgba(121,121,121,0.4)',
  }),
  'solarized-light': Object.freeze({
    '--ide-tok-keyword': '#859900',
    '--ide-tok-string': '#2AA198',
    '--ide-tok-comment': '#93A1A1',
    '--ide-tok-number': '#D33682',
    '--ide-tok-constant': '#CB4B16',
    '--ide-tok-function': '#268BD2',
    '--ide-tok-type': '#B58900',
    '--ide-tok-variable': '#657B83',
    '--ide-tok-operator': '#859900',
    '--ide-tok-punctuation': '#657B83',
    '--ide-tok-tag': '#268BD2',
    '--ide-tok-attr': '#B58900',
    '--ide-tok-property': '#268BD2',
    '--ide-tok-regexp': '#2AA198',
    '--ide-tok-meta': '#93A1A1',
    '--dsw-alias-bg-base': '#fdf6e3',
    '--dsw-alias-bg-layer-1': '#eee8d5',
    '--dsw-alias-bg-layer-2': '#fdf6e3',
    '--dsw-alias-bg-module-platform': '#eee8d5',
    '--dsw-alias-border-l1': '#e6dfc8',
    '--dsw-alias-border-l2': '#d5cfbd',
    '--dsw-alias-label-primary': '#586e75',
    '--dsw-alias-label-secondary': '#657b83',
    '--dsw-alias-label-tertiary': '#93a1a1',
    '--dsw-alias-label-caption': '#93a1a1',
    '--dsw-alias-brand-primary': '#268bd2',
    '--dsw-alias-link': '#268bd2',
    '--dsw-alias-interactive-bg-hover': 'rgba(38,139,210,0.08)',
    '--dsw-alias-interactive-bg-active': 'rgba(38,139,210,0.14)',
    '--dsw-alias-label-primary-inverted': '#ffffff',
    '--dsw-alias-state-error-primary': '#dc322f',
    '--dsw-alias-state-success-primary': '#859900',
    '--dsw-alias-state-warn-primary': '#b58900',
    '--dsw-alias-state-warn-label': '#b58900',
    '--dsw-alias-file-diff-added-marker': '#859900',
    '--dsw-alias-file-diff-deleted-marker': '#dc322f',
    '--dsw-alias-code-diff-added': 'rgba(133,153,0,0.1)',
    '--dsw-alias-code-diff-deleted': 'rgba(220,50,47,0.1)',
  }),
});

/** The theme ids and their (English, proper-noun) display names, fixed order. */
const THEME_DEFS = Object.freeze([
  Object.freeze(['dark-plus', 'Dark+']),
  Object.freeze(['light-plus', 'Light+']),
  Object.freeze(['one-dark-pro', 'One Dark Pro']),
  Object.freeze(['dracula', 'Dracula']),
  Object.freeze(['github-dark', 'GitHub Dark']),
  Object.freeze(['solarized-light', 'Solarized Light']),
]);

/**
 * Ordered theme list for the picker: `auto` first (label from the dictionary),
 * then the six VSCode palettes with their override table attached.
 */
S.THEMES = [{ id: 'auto', label: null, palette: null }].concat(
  THEME_DEFS.map(function (definition) {
    return { id: definition[0], label: definition[1], palette: THEME_PALETTES[definition[0]] };
  }),
);

/**
 * @param {unknown} id - candidate theme id.
 * @returns {boolean} true when it names one of the six palettes.
 */
function isThemeId(id) {
  if (typeof id !== 'string' || id.length === 0) return false;
  return THEME_DEFS.some(function (definition) {
    return definition[0] === id;
  });
}

/**
 * @param {unknown} id - candidate theme id.
 * @returns {string} a valid theme id (`auto` for anything unknown).
 */
function normalizeThemeId(id) {
  return isThemeId(id) ? id : 'auto';
}

/**
 * The persisted theme: unknown/missing/corrupt values fall back to `auto`.
 * @returns {string} a valid theme id.
 */
function readTheme() {
  return normalizeThemeId(readStorage(STORAGE_THEME));
}

/**
 * Persist the selected theme (an invalid id is stored as `auto`).
 * @param {unknown} id - theme id.
 * @returns {string} the normalised id that was stored.
 */
function writeTheme(id) {
  const next = normalizeThemeId(id);
  writeStorage(STORAGE_THEME, next);
  return next;
}

/**
 * The inline custom-property overrides for one theme. `auto` returns an empty
 * table: the panel then inherits DSH's own theme untouched.
 * @param {unknown} id - theme id.
 * @returns {object} a fresh `--dsw-alias-*` -> colour map.
 */
function themeVars(id) {
  const palette = THEME_PALETTES[normalizeThemeId(id)];
  if (palette === null || palette === undefined) return {};
  return Object.assign({}, palette);
}

S.STORAGE_THEME = STORAGE_THEME;
S.THEME_PALETTES = THEME_PALETTES;
S.isThemeId = isThemeId;
S.normalizeThemeId = normalizeThemeId;
S.readTheme = readTheme;
S.writeTheme = writeTheme;
S.themeVars = themeVars;

// ─── http ────────────────────────────────────────────────────────────────────

/** A failed Host request carrying the contract's error code. */
class RequestFailure extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RequestFailure';
    this.code = code;
  }
}

/**
 * Build a browser-relative route URL with an encoded query string.
 * @param {string} route - value from ROUTES.
 * @param {object} [params] - query entries; null/undefined are skipped.
 * @returns {string} URL without a leading slash (the connection base is /api/).
 */
function apiUrl(route, params) {
  if (params === undefined || params === null) return route;
  const parts = [];
  Object.keys(params).forEach(function (key) {
    const value = params[key];
    if (value === undefined || value === null) return;
    parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  });
  return parts.length === 0 ? route : route + '?' + parts.join('&');
}

/**
 * GET/POST a JSON route and unwrap the `{ok, ...}` envelope.
 *
 * Never throws synchronously; a network failure, an error envelope or a
 * non-JSON body all become a rejected promise with a user-facing message.
 *
 * @param {string} url - browser-relative URL.
 * @param {{method?: string, body?: object, signal?: AbortSignal}} [options] - request options.
 * @returns {Promise<object>} the payload (always with `ok === true`).
 */
async function requestJson(url, options) {
  const settings = options === undefined || options === null ? {} : options;
  const init = {
    method: typeof settings.method === 'string' ? settings.method : 'GET',
    headers: { accept: 'application/json' },
  };
  if (settings.signal !== undefined && settings.signal !== null) init.signal = settings.signal;
  if (settings.body !== undefined && settings.body !== null) {
    init.method = 'POST';
    init.headers['content-type'] = 'application/json';
    try {
      init.body = JSON.stringify(settings.body);
    } catch (cause) {
      throw new RequestFailure('bad-body', 'request body is not serialisable');
    }
  }
  let response;
  try {
    response = await fetch(url, init);
  } catch (cause) {
    if (cause !== null && cause !== undefined && cause.name === 'AbortError') throw cause;
    const reason = cause !== null && cause !== undefined && typeof cause.message === 'string' ? cause.message : 'network error';
    throw new RequestFailure('network', reason);
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch (cause) {
    if (cause !== null && cause !== undefined && cause.name === 'AbortError') throw cause;
    payload = null;
  }
  if (payload !== null && payload !== undefined && payload.ok === false) {
    const error = payload.error !== null && payload.error !== undefined && typeof payload.error === 'object' ? payload.error : null;
    const code = error !== null && typeof error.code === 'string' ? error.code : 'request-failed';
    const message = error !== null && typeof error.message === 'string' ? error.message : 'request failed';
    throw new RequestFailure(code, message);
  }
  if (!response.ok || payload === null || payload === undefined || payload.ok !== true) {
    const error = payload !== null && payload !== undefined && payload.error !== null && payload.error !== undefined ? payload.error : null;
    const message = error !== null && typeof error.message === 'string' ? error.message : 'HTTP ' + String(response.status);
    throw new RequestFailure('http-' + String(response.status), message);
  }
  return payload;
}

/**
 * @param {unknown} cause - thrown value.
 * @returns {string} a message safe to render inline.
 */
function errorText(cause) {
  if (cause === null || cause === undefined) return 'unknown error';
  if (typeof cause === 'string') return cause;
  if (cause instanceof Error && typeof cause.message === 'string' && cause.message.length > 0) return cause.message;
  return String(cause);
}

/**
 * Fire-and-forget boot telemetry: one line in the Host's status.jsonl. This is
 * the verification channel the Host half exposes; it must never throw, never
 * block a render and never surface a failure.
 *
 * @param {string} stage - marker name (`apply`, `panel`, `tab`, …).
 * @param {unknown} [detail] - optional payload.
 */
function ping(stage, detail) {
  try {
    if (typeof fetch !== 'function') return;
    const body = JSON.stringify({ stage: stage, detail: detail === undefined ? null : detail });
    const request = fetch(ROUTES.ping, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body,
    });
    if (request !== null && request !== undefined && typeof request.catch === 'function') {
      request.catch(function () {});
    }
  } catch (error) {
    /* never let telemetry break the panel */
  }
}

S.Routes = ROUTES;
S.apiUrl = apiUrl;
S.requestJson = requestJson;
/** Alias kept for the contract's example helper name. */
S.fetchJson = requestJson;
S.errorText = errorText;
S.ping = ping;
S.RequestFailure = RequestFailure;

/**
 * The session the app is currently viewing, read from the workspace UI's own
 * persisted selection store (`dsh.sessions.current` -> `{ sessionId }`).
 * Defensive: storage may be unavailable, empty, or hold an older shape.
 *
 * @returns {string|null} active session id, or null when unknown.
 */
function getCurrentSessionId() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_CURRENT_SESSION);
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const parsed = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0) return parsed.sessionId;
  } catch (error) {
    /* fall through: the caller falls back to the live/first rule */
  }
  return null;
}

/**
 * The workspace path that owns the currently viewed session, resolved from the
 * Client workspace store the slot hands us (`{ items: [{ path, sessionIds }] }`).
 *
 * @param {unknown} snapshot - Client workspace list snapshot.
 * @param {string|null} sessionId - active session id.
 * @returns {string|null} workspace path, or null.
 */
function preferredWorkspaceRoot(snapshot, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  if (snapshot === null || typeof snapshot !== 'object') return null;
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item === null || typeof item !== 'object') continue;
    const sessionIds = Array.isArray(item.sessionIds) ? item.sessionIds : [];
    if (sessionIds.indexOf(sessionId) !== -1 && typeof item.path === 'string' && item.path.length > 0) return item.path;
  }
  return null;
}

S.getCurrentSessionId = getCurrentSessionId;
S.preferredWorkspaceRoot = preferredWorkspaceRoot;
S.STORAGE_CURRENT_SESSION = STORAGE_CURRENT_SESSION;
S.formatBytes = formatBytes;
S.formatDateTime = formatDateTime;
S.formatCount = formatCount;
S.clamp = clampNumber;
S.MAX_EDITABLE_BYTES = MAX_EDITABLE_BYTES;
S.MAX_DIFF_LINES = MAX_DIFF_LINES;
S.MAX_SYNTAX_SEGMENTS = MAX_SYNTAX_SEGMENTS;
S.EDITOR_LINE_HEIGHT = EDITOR_LINE_HEIGHT;
S.EDITOR_PADDING_TOP = EDITOR_PADDING_TOP;

// ─── theme colours ───────────────────────────────────────────────────────────
//
// Only DSH alias tokens, always with a fallback so a token rename degrades to a
// readable colour instead of a transparent panel.

const alias = function (name, fallback) {
  return 'var(--dsw-alias-' + name + ', ' + fallback + ')';
};

const C = {
  base: alias('bg-base', '#16171b'),
  layer1: alias('bg-layer-1', '#1d1e23'),
  layer2: alias('bg-layer-2', '#26272e'),
  /** Raised neutral surface (cards, chips, segmented tracks) in both themes. */
  platform: alias('bg-module-platform', '#26272e'),
  border1: alias('border-l1', '#2c2d35'),
  border2: alias('border-l2', '#3a3b45'),
  text: alias('label-primary', '#e9e9ee'),
  textSecondary: alias('label-secondary', '#a9aab5'),
  textTertiary: alias('label-tertiary', '#777885'),
  caption: alias('label-caption', '#8d8e9a'),
  /** Contrast fill: black in the light theme, white in the dark theme. */
  brand: alias('brand-primary', '#e9e9ee'),
  /** Blue accent used for links, active marks, folder icons and hunk headers. */
  accent: alias('link', '#4176e6'),
  hover: alias('interactive-bg-hover', 'rgba(127, 127, 127, 0.12)'),
  activeBg: alias('interactive-bg-active', 'rgba(127, 127, 127, 0.18)'),
  inverted: alias('label-primary-inverted', '#ffffff'),
  error: alias('state-error-primary', '#e5534b'),
  success: alias('state-success-primary', '#3fb950'),
  warn: alias('state-warn-primary', '#d29922'),
  /** Readable warning text (the primary warn colour is a dot/fill colour). */
  warnLabel: alias('state-warn-label', '#dd8629'),
  /** Diff text colours, designed for readable +/- text on both themes. */
  diffAdd: alias('file-diff-added-marker', '#01a241'),
  diffDel: alias('file-diff-deleted-marker', '#ba2723'),
  diffAddBg: alias('code-diff-added', 'rgba(34, 197, 94, 0.08)'),
  diffDelBg: alias('code-diff-deleted', 'rgba(239, 68, 68, 0.08)'),
};

const FONT_UI = 'var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif)';
const FONT_MONO = 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace)';

S.C = C;
S.FONT_UI = FONT_UI;
S.FONT_MONO = FONT_MONO;

// ─── syntax colours ─────────────────────────────────────────────────────────
//
// Token colours for the syntax-highlighting overlay in the Files viewer. Every
// value is a chain of custom properties: an explicit VSCode palette override
// (`--ide-tok-*`, set by the theme tables below) wins, then DSH's own Shiki
// token colour (`--shiki-token-*`, which follows body[data-ds-dark-theme]),
// then a light-theme hex fallback. `auto` sets no `--ide-tok-*` at all, so the
// code keeps following the host app's light/dark theme automatically.

const SYN = {
  keyword: 'var(--ide-tok-keyword, var(--shiki-token-keyword, #d6336c))',
  string: 'var(--ide-tok-string, var(--shiki-token-string, #0a3069))',
  comment: 'var(--ide-tok-comment, var(--shiki-token-comment, #6e7781))',
  number: 'var(--ide-tok-number, var(--shiki-token-constant, #0550ae))',
  constant: 'var(--ide-tok-constant, var(--shiki-token-constant, #0550ae))',
  function: 'var(--ide-tok-function, var(--shiki-token-function, #8250df))',
  type: 'var(--ide-tok-type, var(--shiki-token-parameter, #953800))',
  variable: 'var(--ide-tok-variable, var(--dsw-alias-label-primary, #1f2328))',
  operator: 'var(--ide-tok-operator, var(--shiki-token-punctuation, #6e7781))',
  punctuation: 'var(--ide-tok-punctuation, var(--shiki-token-punctuation, #6e7781))',
  tag: 'var(--ide-tok-tag, var(--shiki-token-keyword, #116329))',
  attr: 'var(--ide-tok-attr, var(--shiki-token-function, #0550ae))',
  property: 'var(--ide-tok-property, var(--shiki-token-function, #0550ae))',
  regexp: 'var(--ide-tok-regexp, var(--shiki-token-string-expression, #0a3069))',
  meta: 'var(--ide-tok-meta, var(--shiki-token-comment, #6e7781))',
  plain: 'inherit',
};

S.SYN = SYN;

// ─── shared UI primitives ────────────────────────────────────────────────────

const ST_CORE = {
  toolButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    height: 30,
    padding: 0,
    // Borderless by design, the way the VS Code activity bar works: a tool
    // button is only its glyph. Hover/active paint the background, keyboard
    // focus paints a ring with box-shadow. Never a border/outline: React's
    // style diff plus the CSS transition would leave a stale dark edge behind
    // on the previously active tab (see the contract's state-styling rule).
    // `boxSizing` keeps the hit target exactly 30x30 without a border.
    border: 'none',
    boxSizing: 'border-box',
    borderRadius: 7,
    background: 'transparent',
    color: C.textSecondary,
    cursor: 'pointer',
    outline: 'none',
    flex: '0 0 auto',
    transition: 'background 120ms ease, color 120ms ease',
  },
  toolButtonHover: {
    background: C.hover,
    color: C.text,
  },
  toolButtonActive: {
    // Selection is a rounded background fill only: no border, no inset ring.
    background: C.activeBg,
    color: C.text,
  },
  toolButtonFocus: {
    // Keyboard focus ring only — never an outline or a border.
    boxShadow: '0 0 0 2px var(--dsw-focus-ring-color, ' + C.accent + ')',
  },
  toolButtonDisabled: {
    opacity: 0.45,
    cursor: 'default',
  },
  primaryButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 28,
    padding: '0 12px',
    border: '1px solid transparent',
    borderRadius: 7,
    background: C.brand,
    color: C.inverted,
    fontFamily: FONT_UI,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    outline: 'none',
    flex: '0 0 auto',
    transition: 'opacity 120ms ease',
  },
  primaryButtonHover: {
    opacity: 0.86,
  },
  primaryButtonDisabled: {
    opacity: 0.45,
    cursor: 'default',
  },
  ghostButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 26,
    padding: '0 10px',
    border: '1px solid ' + C.border1,
    borderRadius: 6,
    background: C.platform,
    color: C.textSecondary,
    fontFamily: FONT_UI,
    fontSize: 12,
    cursor: 'pointer',
    outline: 'none',
    flex: '0 0 auto',
    transition: 'background 120ms ease, color 120ms ease',
  },
  ghostButtonHover: {
    background: C.layer2,
    color: C.text,
  },
  split: {
    display: 'flex',
    flex: '1 1 auto',
    minHeight: 0,
    minWidth: 0,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  splitDragging: {
    userSelect: 'none',
    cursor: 'col-resize',
  },
  splitLeft: {
    flex: '0 0 auto',
    minWidth: 0,
    minHeight: 0,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  splitHandle: {
    flex: '0 0 auto',
    width: 6,
    marginLeft: -3,
    marginRight: -3,
    zIndex: 2,
    position: 'relative',
    cursor: 'col-resize',
    background: 'transparent',
    border: 'none',
    padding: 0,
  },
  splitHandleHover: {
    background: C.accent,
    opacity: 0.3,
  },
  splitHandleGrip: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 1,
    height: 26,
    marginTop: -13,
    marginLeft: -0.5,
    background: C.border2,
    borderRadius: 1,
  },
  splitGripActive: {
    background: C.accent,
  },
  splitRight: {
    flex: '1 1 auto',
    minWidth: 0,
    minHeight: 0,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderLeft: '1px solid ' + C.border2,
  },
  dragOverlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 40,
    cursor: 'col-resize',
    background: 'transparent',
  },
  empty: {
    display: 'flex',
    flex: '1 1 auto',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '32px 24px',
    textAlign: 'center',
    minHeight: 0,
    color: C.textSecondary,
  },
  emptyIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 52,
    height: 52,
    borderRadius: 14,
    border: '1px solid ' + C.border1,
    background: C.platform,
    color: C.textTertiary,
  },
  emptyTitle: {
    fontSize: 13.5,
    fontWeight: 600,
    color: C.text,
    margin: 0,
  },
  emptyBody: {
    fontSize: 12,
    lineHeight: '18px',
    color: C.textSecondary,
    maxWidth: 380,
    margin: 0,
  },
  errorBox: {
    display: 'flex',
    flex: '1 1 auto',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: '28px 24px',
    textAlign: 'center',
    minHeight: 0,
  },
  errorIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    borderRadius: 12,
    border: '1px solid ' + C.border1,
    background: C.platform,
    color: C.error,
  },
  errorTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: C.text,
    margin: 0,
  },
  errorBody: {
    fontSize: 12,
    lineHeight: '18px',
    color: C.textSecondary,
    maxWidth: 440,
    margin: 0,
    wordBreak: 'break-word',
  },
  loading: {
    display: 'flex',
    flex: '1 1 auto',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    padding: '28px 24px',
    minHeight: 60,
    color: C.textTertiary,
    fontSize: 12,
  },
  loadingText: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  notice: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '8px 12px 0',
    padding: '6px 10px',
    borderRadius: 6,
    border: '1px solid ' + C.border1,
    background: C.platform,
    fontFamily: FONT_UI,
    fontSize: 12,
    lineHeight: '17px',
    color: C.textSecondary,
    flex: '0 0 auto',
  },
  noticeText: {
    flex: '1 1 auto',
    minWidth: 0,
    wordBreak: 'break-word',
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    height: 19,
    padding: '0 7px',
    borderRadius: 999,
    border: '1px solid ' + C.border1,
    background: C.platform,
    color: C.textSecondary,
    fontFamily: FONT_UI,
    fontSize: 10.5,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    flex: '0 0 auto',
  },
  chipBrand: {
    borderColor: C.accent,
    color: C.accent,
    background: 'transparent',
  },
  chipSuccess: {
    borderColor: C.diffAdd,
    color: C.diffAdd,
    background: 'transparent',
  },
  chipWarn: {
    borderColor: C.warnLabel,
    color: C.warnLabel,
    background: 'transparent',
  },
  chipError: {
    borderColor: C.error,
    color: C.error,
    background: 'transparent',
  },
  mono: {
    fontFamily: FONT_MONO,
  },
};

/**
 * Icon/square button with hover + active + disabled states (inline styles only).
 * `data-*` and ARIA props pass through so the smoke test can locate tabs.
 */
function ToolButton(props) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  const active = props.active === true;
  const disabled = props.disabled === true;
  const style = Object.assign(
    {},
    ST_CORE.toolButton,
    active ? ST_CORE.toolButtonActive : null,
    disabled ? ST_CORE.toolButtonDisabled : null,
    hover && !active && !disabled ? ST_CORE.toolButtonHover : null,
    focused && !active && !disabled ? ST_CORE.toolButtonFocus : null,
    props.style !== null && props.style !== undefined ? props.style : null,
  );
  const buttonProps = {};
  Object.keys(props).forEach(function (key) {
    if (['title', 'ariaLabel', 'active', 'disabled', 'onClick', 'children', 'style', 'tabIndex'].indexOf(key) !== -1) return;
    buttonProps[key] = props[key];
  });
  buttonProps.type = 'button';
  buttonProps.disabled = disabled;
  if (typeof props.title === 'string') buttonProps.title = props.title;
  if (typeof props.ariaLabel === 'string') buttonProps['aria-label'] = props.ariaLabel;
  else if (typeof props.title === 'string') buttonProps['aria-label'] = props.title;
  buttonProps.tabIndex = props.tabIndex === undefined ? 0 : props.tabIndex;
  buttonProps.style = style;
  if (!disabled && typeof props.onClick === 'function') buttonProps.onClick = props.onClick;
  buttonProps.onMouseEnter = function () { setHover(true); };
  buttonProps.onMouseLeave = function () { setHover(false); };
  // Only a keyboard-visible focus paints the ring: a pointer click may focus
  // the button in this runtime, and a persistent blue frame around a toolbar
  // glyph reads as a stray border.
  buttonProps.onFocus = function (event) {
    let visible = true;
    try {
      visible = event !== null && event !== undefined && event.target !== null && event.target !== undefined && typeof event.target.matches === 'function'
        ? event.target.matches(':focus-visible')
        : true;
    } catch (error) {
      visible = true;
    }
    setFocused(visible);
  };
  buttonProps.onBlur = function () { setFocused(false); };
  return h('button', buttonProps, props.children);
}

/** Filled primary button (search / save). */
function PrimaryButton(props) {
  const [hover, setHover] = useState(false);
  const disabled = props.disabled === true;
  const style = Object.assign(
    {},
    ST_CORE.primaryButton,
    disabled ? ST_CORE.primaryButtonDisabled : null,
    hover && !disabled ? ST_CORE.primaryButtonHover : null,
    props.style !== null && props.style !== undefined ? props.style : null,
  );
  return h(
    'button',
    {
      type: 'button',
      title: props.title,
      'aria-label': props.ariaLabel || props.title,
      disabled: disabled,
      onClick: disabled ? undefined : props.onClick,
      onMouseEnter: function () { setHover(true); },
      onMouseLeave: function () { setHover(false); },
      style: style,
    },
    props.children,
  );
}

/** Outlined neutral button (retry, dismiss). */
function GhostButton(props) {
  const [hover, setHover] = useState(false);
  const buttonProps = {};
  Object.keys(props).forEach(function (key) {
    if (['title', 'ariaLabel', 'onClick', 'children', 'style'].indexOf(key) !== -1) return;
    buttonProps[key] = props[key];
  });
  buttonProps.type = 'button';
  if (typeof props.title === 'string') buttonProps.title = props.title;
  buttonProps['aria-label'] = typeof props.ariaLabel === 'string' ? props.ariaLabel : props.title;
  buttonProps.onClick = props.onClick;
  buttonProps.onMouseEnter = function () { setHover(true); };
  buttonProps.onMouseLeave = function () { setHover(false); };
  buttonProps.style = Object.assign({}, ST_CORE.ghostButton, hover ? ST_CORE.ghostButtonHover : null, props.style || null);
  return h('button', buttonProps, props.children);
}

/** Small rounded chip. */
function Chip(props) {
  const tone = props.tone;
  const toneStyle =
    tone === 'brand' ? ST_CORE.chipBrand : tone === 'success' ? ST_CORE.chipSuccess : tone === 'warn' ? ST_CORE.chipWarn : tone === 'error' ? ST_CORE.chipError : null;
  return h(
    'span',
    { style: Object.assign({}, ST_CORE.chip, toneStyle), title: props.title },
    props.icon ? h(props.icon, { size: 11 }) : null,
    props.children,
  );
}

/** Centered spinner + optional label. */
function LoadingIndicator(props) {
  return h(
    'div',
    { style: ST_CORE.loading, role: 'status' },
    h(SpinnerIcon, { size: 15 }),
    h(
      'span',
      { style: ST_CORE.loadingText },
      h('span', null, typeof props.label === 'string' ? props.label : S.translate('action.loading')),
      typeof props.hint === 'string' ? h('span', { style: { fontSize: 11, color: C.textTertiary } }, props.hint) : null,
    ),
  );
}

/** Inline error card with a retry button. */
function InlineError(props) {
  const t = typeof props.t === 'function' ? props.t : function (key) { return key; };
  return h(
    'div',
    { style: ST_CORE.errorBox, role: 'alert' },
    h('div', { style: ST_CORE.errorIcon }, h(AlertIcon, { size: 22 })),
    h('p', { style: ST_CORE.errorTitle }, typeof props.title === 'string' ? props.title : t('common.unknown')),
    typeof props.message === 'string' && props.message.length > 0 ? h('p', { style: ST_CORE.errorBody }, props.message) : null,
    typeof props.onRetry === 'function'
      ? h(GhostButton, { title: t('action.retry'), onClick: props.onRetry }, h(RefreshIcon, { size: 13 }), t('action.retry'))
      : null,
  );
}

/** Full-pane empty state: icon, title, body and an optional action. */
function EmptyState(props) {
  const t = typeof props.t === 'function' ? props.t : function (key) { return key; };
  const Icon = typeof props.icon === 'function' ? props.icon : PanelIcon;
  return h(
    'div',
    { style: ST_CORE.empty },
    h('div', { style: ST_CORE.emptyIcon }, h(Icon, { size: 26 })),
    h('p', { style: ST_CORE.emptyTitle }, props.title),
    typeof props.body === 'string' && props.body.length > 0 ? h('p', { style: ST_CORE.emptyBody }, props.body) : null,
    typeof props.onAction === 'function'
      ? h(GhostButton, { title: typeof props.actionLabel === 'string' ? props.actionLabel : t('action.retry'), onClick: props.onAction }, h(RefreshIcon, { size: 13 }), typeof props.actionLabel === 'string' ? props.actionLabel : t('action.retry'))
      : null,
  );
}

/** One-line notice bar (success / error / info). */
function NoticeBar(props) {
  const kind = props.kind;
  const tone = kind === 'success' ? C.diffAdd : kind === 'error' ? C.error : C.textSecondary;
  return h(
    'div',
    { style: Object.assign({}, ST_CORE.notice, { borderLeft: '2px solid ' + tone, color: kind === 'info' ? C.textSecondary : tone }), role: kind === 'error' ? 'alert' : 'status' },
    h('span', { style: ST_CORE.noticeText }, props.text),
    typeof props.onDismiss === 'function'
      ? h(ToolButton, { title: (typeof props.t === 'function' ? props.t('action.dismiss') : 'Dismiss'), onClick: props.onDismiss, style: { width: 20, height: 20, borderRadius: 5 } }, h(CloseIcon, { size: 11 }))
      : null,
  );
}

/**
 * Resizable two-pane split used by the Files tree and the Git change list.
 * Left width is persisted per `storageKey`; the handle supports pointer drag and
 * double-click reset. Renders both children as-is.
 */
function SplitPane(props) {
  const min = Number.isFinite(props.minWidth) ? props.minWidth : SPLIT_MIN;
  const max = Number.isFinite(props.maxWidth) ? props.maxWidth : SPLIT_MAX;
  const initial = clampNumber(Number.isFinite(props.initialWidth) ? props.initialWidth : 300, min, max);
  const storageKey = typeof props.storageKey === 'string' ? props.storageKey : null;
  const [width, setWidth] = useState(function () {
    const stored = readStoredNumber(storageKey);
    return stored === null ? initial : clampNumber(stored, min, max);
  });
  const [dragging, setDragging] = useState(false);
  const [hoverHandle, setHoverHandle] = useState(false);
  const startRef = useRef(null);
  const latestRef = useRef(width);
  latestRef.current = width;

  useEffect(function () {
    if (dragging) return undefined;
    writeStoredNumber(storageKey, latestRef.current);
    return undefined;
  }, [dragging, width, storageKey]);

  const onPointerDown = useCallback(function (event) {
    try {
      event.preventDefault();
    } catch (error) {
      /* synthetic */
    }
    if (typeof event.clientX !== 'number') return;
    startRef.current = { x: event.clientX, width: latestRef.current };
    setDragging(true);
  }, []);

  // Window-level listeners keep the drag alive outside the 6px handle without
  // relying on pointer capture support.
  useEffect(function () {
    if (!dragging) return undefined;
    const onMove = function (event) {
      const start = startRef.current;
      if (start === null || typeof event.clientX !== 'number') return;
      setWidth(clampNumber(start.width + event.clientX - start.x, min, max));
    };
    const onEnd = function () {
      startRef.current = null;
      setDragging(false);
    };
    try {
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onEnd);
      window.addEventListener('pointercancel', onEnd);
    } catch (error) {
      return undefined;
    }
    return function () {
      try {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
      } catch (error) {
        /* no DOM */
      }
    };
  }, [dragging, min, max]);

  const onDoubleClick = useCallback(function () {
    setWidth(initial);
  }, [initial]);

  const handleStyle = Object.assign({}, ST_CORE.splitHandle, hoverHandle || dragging ? ST_CORE.splitHandleHover : null);
  const gripStyle = Object.assign({}, ST_CORE.splitHandleGrip, dragging ? ST_CORE.splitGripActive : null);

  return h(
    'div',
    { style: Object.assign({}, ST_CORE.split, dragging ? ST_CORE.splitDragging : null) },
    h('div', { style: Object.assign({}, ST_CORE.splitLeft, { width: width, maxWidth: max, minWidth: min }) }, props.left),
    h(
      'div',
      {
        style: handleStyle,
        role: 'separator',
        'aria-orientation': 'vertical',
        'aria-label': typeof props.handleLabel === 'string' ? props.handleLabel : 'resize',
        title: typeof props.handleLabel === 'string' ? props.handleLabel : undefined,
        onPointerDown: onPointerDown,
        onDoubleClick: onDoubleClick,
        onMouseEnter: function () { setHoverHandle(true); },
        onMouseLeave: function () { setHoverHandle(false); },
      },
      h('div', { style: gripStyle }),
    ),
    h('div', { style: ST_CORE.splitRight }, props.right),
    dragging ? h('div', { style: ST_CORE.dragOverlay, 'aria-hidden': true }) : null,
  );
}

/** @param {string} text - line text. @returns {string} clamped to 400 chars. */
function clampLineText(text) {
  if (typeof text !== 'string') return '';
  return text.length > 400 ? text.slice(0, 400) : text;
}

/**
 * Split a search-hit line into plain / highlighted segments.
 * The Host reports 1-based UTF-16 `column` and match `length`; the segments are
 * rendered as text + `<mark>text</mark>` so nothing is injected as HTML.
 *
 * @param {string} text - the line text.
 * @param {number} column - 1-based column.
 * @param {number} length - match length in UTF-16 code units.
 * @returns {Array<{text: string, hit: boolean}>} ordered segments.
 */
function splitMatch(text, column, length) {
  const line = clampLineText(text);
  const offset = Number.isFinite(column) ? Math.floor(column) - 1 : -1;
  const size = Number.isFinite(length) ? Math.max(0, Math.floor(length)) : 0;
  if (size === 0 || offset < 0 || offset >= line.length) return [{ text: line, hit: false }];
  const end = Math.min(line.length, offset + size);
  const segments = [];
  if (offset > 0) segments.push({ text: line.slice(0, offset), hit: false });
  segments.push({ text: line.slice(offset, end), hit: true });
  if (end < line.length) segments.push({ text: line.slice(end), hit: false });
  return segments;
}

S.ToolButton = ToolButton;
S.PrimaryButton = PrimaryButton;
S.GhostButton = GhostButton;
S.Chip = Chip;
S.LoadingIndicator = LoadingIndicator;
S.InlineError = InlineError;
S.EmptyState = EmptyState;
S.NoticeBar = NoticeBar;
S.SplitPane = SplitPane;
S.splitMatch = splitMatch;
S.clampLineText = clampLineText;
S.ST_CORE = ST_CORE;
