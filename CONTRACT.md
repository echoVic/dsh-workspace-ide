# dsh-workspace-ide — implementation contract

A DeepSeek Harness (DSH) client plugin: a VS Code-like **workspace IDE panel** in the
central `main` area, opened from a left-rail icon, with three mandatory surfaces:

1. **Files** — workspace file tree + editable code viewer (open/read/edit/save).
2. **Search** — full-text workspace search (regex, case, whole-word), results grouped
   by file, click a hit to open the file at that line.
3. **Git** — branch/status, staged/unstaged/untracked changes with unified diffs,
   recent commit history with per-commit diffs.

Everything is **plain JavaScript, no build toolchain, no new npm dependencies**.
The whole app runs inside the DSH desktop/web profile; the Host half runs in the
Electron main (Node) process, the Client half runs in the browser renderer.

Reference material already in this workspace (read if unsure):

- `DSH插件开发指南.md` — verified DSH plugin/bundle guide. Key sections: A1 (package.json
  `dsh` fields), A4/A5 (client module + host↔client channels), B6/B7/B8 (slot API),
  C9–C11 (host services/routes), D13–D15 (install/dev), E16 (templates), G (quick ref).
- `dsh-usage-stats/` — a real, working, locally installed DSH plugin. Copy its patterns:
  `lib/client.js` head/tail for the module face, slot registration, locale, fetch, styles;
  `lib/index.js` for `apply` + `connection.fetch.register`.
- `~/.dsh/profiles/desktop/cordis.patch.yml` / `package.json` — the live profile.
- Extracted DSH sources: `.dsh-source/dsh/node_modules/@deepseek-ai/` (read-only reference,
  e.g. `dsh-client-ui-sidebar-files`, `dsh-client-ui-schedule`, `dsh-client-ui-plugin-manager`).

## Hard rules

- Never run `plugin_manager`, never edit `~/.dsh/**`, never restart/kill the DSH app.
- Do not add runtime dependencies: the shipped client still requires only `react`, and the
  Host still uses Node built-ins only. TypeScript/`@types/*` are **devDependencies only**
  (`npm ci` + `npm run typecheck`); they never change `lib/` or the published package.
- Type checking stays green: `npm run typecheck` (tsc `--checkJs`, no emit) must exit 0
  before a PR is done. Do not silence errors with `@ts-ignore`; fix the JSDoc type.
- Only touch the files in **your** write scope (see Team task). Do not touch the other
  teammate's files, `package.json`, `cordis.patch.yml`, `icon.svg`, `CONTRACT.md`, `README.md`.
- Host half: plain ESM (`"type": "module"`), Node ≥ 22 built-ins only, **no `@deepseek-ai/*`
  imports** (they do not resolve from a linked package outside the profile). Relative
  imports inside `lib/` are fine (`import { … } from './host/x.js'`).
- Client half: single built file `lib/client.js`, plain JS, **no bundler**. Authoring
  happens in `src/client/` — plain `.js` fragments and TypeScript `.ts`/`.tsx` fragments
  (compiled by `tsc`, no bundler) — concatenated by `scripts/build-client.mjs`. The only
  allowed `require()` is `react`. TypeScript fragments stay script-style: no
  `import`/`export`, shared globals (`h`, `S`, hooks, core constants) come from the factory
  scope; JSX compiles through the `h` alias when a `.tsx` source is added.
- All visible text goes through a tiny built-in i18n dictionary (zh + en); never hardcode
  Chinese/English strings in JSX. Prefer the Client locale service when present, fall back
  to the built-in dictionary (`navigator.language`).
- All colors/spacing/fonts use DSH theme tokens: `var(--dsw-alias-bg-base)`,
  `var(--dsw-alias-bg-layer-1|2)`, `var(--dsw-alias-border-l1|l2)`,
  `var(--dsw-alias-label-primary|secondary|tertiary)`, `var(--dsw-alias-brand-primary)`,
  `var(--dsw-alias-state-error-primary|success-primary|warn-primary)`,
  `var(--dsw-alias-interactive-bg-hover)`. Provide a sane fallback inside `var()`.
  The panel must work on both dark and light themes.
- The panel must never blank the slot: wrap the whole page in an error boundary.

## Package layout (Lead-owned files marked)

```
dsh-workspace-ide/
  package.json            # Lead
  cordis.patch.yml        # Lead
  icon.svg                # Lead
  CONTRACT.md             # Lead
  README.md               # Lead
  lib/index.js            # host teammate
  lib/host/*.js           # host teammate
  test/host/*.test.mjs    # host teammate
  src/client/*.js         # client teammate
  scripts/build-client.mjs# client teammate
  lib/client.js           # client teammate (built artifact, committed)
  test/smoke/client-smoke.mjs # client teammate
```

Host plugin identity: package `dsh-workspace-ide`, row name `dsh-workspace-ide`,
client module id `dsh-workspace-ide`, sidebar panel id and main key both `workspace-ide`.

## Host half

`lib/index.js`:

```js
import { registerRoutes } from './host/routes.js';

export function apply(ctx) { registerRoutes(ctx); }
export const inject = ['connection'];
export const name = 'workspace-ide';
```

`registerRoutes(ctx)` registers routes with `ctx.connection.fetch.register({ path, methods,
requestBody, fetch })` inside `ctx.effect(...)` so they are disposed with the plugin fiber.
Every handler takes a WHATWG `Request` and returns a `Response`. Services are looked up
defensively (`ctx.get('…')`) — a missing service must degrade, never throw at apply time.
`ctx.logger` may be used for diagnostics; never let a request handler throw.

### Common HTTP behavior

- JSON out: `{"ok":true, ...}` or `{"ok":false,"error":{"code":"…","message":"…"}}`.
- Status: 200 ok; 400 bad request (`code: "bad-request"`); 404 missing
  (`code: "not-found"`); 403 escape (`code: "outside-workspace"`); 500 internal.
- Header `cache-control: no-store` on every response.
- Query flags are `1`/`0` (also accept `true`/`false`).
- `root`: absolute path of a workspace directory. Validate it exists and is a directory.
  When `ctx.get('workspaceRegistry')` is available, only allow roots that match one of
  `workspaceRegistry.list().map((w) => w.path)` (realpath-normalized). Otherwise allow any
  existing absolute directory.
- `path`: POSIX relative path inside `root`. Reject absolute paths, `..` escapes, NUL bytes.
  Resolve with `path.resolve`/`fs.realpath` and verify the real path is inside the real
  root; symlinks pointing outside are rejected with `outside-workspace`. Never follow a
  symlink to read outside the workspace.
- All filesystem access is read-only except `save` and `ping` (see below).

### Routes (all under `/api/`)

1. `GET /api/dsh-workspace-ide.workspaces`
   → `{"ok":true,"workspaces":[{"id","path","title","sessionCount","live","git"}]}`.
   Source: `ctx.get('workspaceRegistry')?.list()`; map id/path/title/sessionIds.length.
   `live` is true when any of the workspace's `sessionIds` currently appears in
   `ctx.get('sessions')?.list()?.map((s) => s.id)` (the live-session registry); when the
   sessions service is absent, `live` is false. `git` is true when `<path>/.git` exists
   (a directory or a worktree file); an unreadable/missing marker is false, never thrown.
   Missing registry → empty array. Sorted by registry order.

2. `GET /api/dsh-workspace-ide.list?root=&path=`
   → `{"ok":true,"root","path","entries":[{"name","path","type":"dir"|"file"|"symlink"|"other",
   "size","mtimeMs","hidden"}],"truncated"}`.
   `path` is the POSIX path relative to `root` ("" for the root itself). Each entry's `path`
   is the child's POSIX relative path. Sort: directories first, then case-insensitive name.
   `hidden` = name starts with ".". Cap 4000 entries, set `truncated`. `lstat` decides
   type/size/mtime, except that a symlink whose real target stays inside the workspace is
   reported as the target type (`dir` / `file`) so the tree can open it; outside-pointing,
   broken and racing symlinks stay `type:"symlink"`. A symlinked directory can be listed
   through its path normally.

3. `GET /api/dsh-workspace-ide.files?root=&limit=`
   → `{"ok":true,"root","files":[path…],"truncated"}`.
   Recursive index of regular files for the client's quick-open palette; POSIX relative
   paths, sorted, `.git` skipped, cap 8000 entries by default (`limit` clamped to
   100–20000). Unreadable directories are skipped, never fatal. Same root safety as above.

4. `GET /api/dsh-workspace-ide.file?root=&path=`
   → `{"ok":true,"root","path","absolutePath","size","mtimeMs","binary","truncated",
   "content","language"}`.
   Read at most 2 MiB (`truncated` when bigger). Binary detection: NUL byte in the bytes
   read → `binary:true`, `content:null`. `content` is UTF-8 text. `language` is inferred
   from the extension (small map: js/mjs/cjs/ts/tsx/jsx, json, md, css, html, py, go, rs,
   java, c/cpp/h, sh, yml/yaml, txt, …; default `text`).
   Directories → `bad-request`. Missing file → `not-found`.

5. `GET /api/dsh-workspace-ide.image?root=&path=`
   → `{"ok":true,"root","path","absolutePath","size","mtimeMs","mime","base64"}`.
   Raster/SVG image bytes for the viewer, base64-encoded (JSON envelope keeps the route
   uniform). Cap 8 MiB — larger files answer 413 `too-large` instead of a truncated image.
   The MIME type is verified from the leading bytes (PNG/JPEG/GIF/WebP/BMP/ICO/AVIF magic
   numbers; SVG text only when the extension is `.svg` and the payload starts with `<svg`
   or an XML prolog). A file whose bytes do not match any supported image answers 415
   `unsupported-image`. Same path safety and directory/missing behaviour as `file`.

6. `GET /api/dsh-workspace-ide.search?root=&q=&regex=0|1&case=0|1&whole=0|1&include=&exclude=&maxFiles=&maxMatches=&maxFileBytes=`
   → `{"ok":true,"root","query",{options},"files":[{"path","matches":[{"line","column",
   "length","text"}]}],"totalMatches","scannedFiles","scannedBytes","truncated","elapsedMs"}`.
   - `q` required, non-empty; `regex` compiles `q` as a RegExp (invalid regex → bad-request).
   - `case:0` (default) = case-insensitive; `whole:1` = whole word.
   - Default excluded dirs/names: `.git`, `node_modules`, `.DS_Store`, `.dsh`, `.tmp`.
     `exclude`/`include` are comma-separated simple globs (`*.ts`, `src/**`) or path
     substrings; implement a small, well-tested matcher.
   - Skip binary files and files larger than `maxFileBytes` (default 1 MiB).
   - Defaults: maxFiles 400, maxMatches 500, per-file match cap 40. Set `truncated` when a
     cap stops the scan. Never take longer than ~15 s: check a deadline between files.
   - `line`/`column` are 1-based; `column` counts UTF-16 code units; `length` is the match
     length; `text` is the line trimmed to ≤ 400 chars (trailing `\r`/`\n` removed).
   - Results ordered by path, then line. Never throw on unreadable files (skip them).

7. `GET /api/dsh-workspace-ide.git?root=&kind=&…`
   - `kind=status` → `{"ok":true,"repo":true,"root","branch","upstream","ahead","behind",
     "clean","files":[{"path","index","worktree","status"}],"counts":{"staged","unstaged",
     "untracked","conflicted"}}`. Use `git status --porcelain=v1 -z --branch
     --untracked-files=all` and parse; `status` is the 2-char code (`"M "`, `" M"`,
     `"??"`, `"UU"`…). Deleted-with-rename rows: report the new path and
     `status: "R"`; original path in `from` when recoverable.
   - `kind=diff&path=&staged=0|1&commit=&context=3` → `{"ok":true,"repo":true,"path",
     "staged","commit","diff","truncated"}`. Raw unified diff text:
     working tree `git diff -U<context> --no-color -- <path>`; staged
     `git diff --cached …`; untracked file → `git diff --no-index --no-color /dev/null
     <abs>` (exit code 1 is normal, keep stdout); `commit` set → `git show --no-color
     --stat --patch <commit> [-- <path>]`. Cap output at 400 KB (`truncated`).
   - `kind=log&limit=30` → `{"ok":true,"repo":true,"commits":[{"hash","short","author",
     "date","subject","refs"}]}` using a NUL-separated `--format` (max 100 commits).
   - `kind=branches` → `{"ok":true,"repo":true,"current","branches":[{"name","current",
     "remote"}]}`.
   - Not a git repo (or root not a working tree) → HTTP 200 `{"ok":true,"repo":false}`.
   - Git commands: `child_process.execFile('git', args, { cwd, maxBuffer: 32 MiB,
     timeout: 15000, env: { ...process.env, LC_ALL: 'C' } })`. Git failures become
     `{"ok":false,"error":{"code":"git-failed","message":…}}` or `repo:false` for
     "not a git repository"; never crash the Host.

8. `POST /api/dsh-workspace-ide.save` — body JSON `{"root","path","content"}` (≤ 4 MiB).
   Overwrite an existing regular text file only (do not create new files/dirs). Same path
   safety as above. → `{"ok":true,"path","size","mtimeMs"}`. Missing file → `not-found`.
   Use a temp file + rename in the same directory for atomicity.

9. `POST /api/dsh-workspace-ide.ping` — body JSON `{"stage","detail"}` (bodies above
   64 KiB are ignored rather than parsed; `stage`/`detail` are truncated).
   Append `{"at":ISO,"stage","detail","pid"}` as one line to
   `${process.env.DSH_HOME ?? join(homedir(), '.dsh')}/workspace-ide/status.jsonl`
   (create the dir). Always `{"ok":true}`; swallow every error. This is the verification
   channel the Lead uses to confirm the client bundle really executed in the browser.

### Host tests (mandatory)

`test/host/*.test.mjs`, `node --test test/host/`, no third-party deps. Cover at minimum:

- path safety: `..` escape, absolute `path`, symlink escape, NUL rejection;
- list: sort order, hidden flags, truncation, missing dir, root-as-file;
- file: binary detection, truncation, language map, missing file;
- search: literal + regex + case + whole-word, include/exclude, binary/large skip, caps,
  line/column correctness on multi-line fixtures;
- git: real temp repo created with `execFileSync('git', …)` in `os.tmpdir()`
  (`git init`, config user, commits, a modified/stagged/untracked file) — status/diff/log/
  branches assertions; non-repo root → `repo:false`;
- save: overwrite, missing file, escaped path, size cap.
  Test pure functions directly (export them from `lib/host/*.js`); do not boot the app.

## Client half

### Build

`scripts/build-client.mjs` compiles TypeScript fragments with `tsc`
(`tsconfig.client-build.json` → `build/client-parts/`) and concatenates, in filename order:
`src/client/00-core.ts`, `05-icons.ts`, `07-highlight.ts`, `08-markdown.ts`, `10-shell.ts`,
`20-files.ts`, `30-search.ts`, `40-git.ts`, `99-face.ts` into `lib/client.js`:

```js
/* generated by scripts/build-client.mjs — do not edit */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-ide',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useMemo, useRef, useState } = React;
    const S = {};
    /* …concatenated src files… */
    return S.face;
  },
});
```

Constraints for `src/client/*.js`:

- No `import`/`export`, no top-level `return`; everything is inside the factory closure.
- Attach helpers/components to the shared `S` object (`S.Icons`, `S.Shell`, `S.FilesView`,
  `S.SearchView`, `S.GitView`, `S.DiffView`, `S.useT`, `S.fetchJson`, `S.I18N`…).
  Files are concatenated in the order above, so `00-core.ts` must define everything the
  others use at call time (function declarations and `S.x = …` assignments).
- `--check` mode: `node scripts/build-client.mjs --check` must exit non-zero if
  `lib/client.js` is stale (recompute and compare, do not write).
- Keep `lib/client.js` committed in the repo (the Host serves it directly).

### Icons (`05-icons.ts`)

The icon set is the open-source **Lucide** set (https://lucide.dev, ISC; the
Feather-derived glyphs carry the Feather MIT license). The SVG node data is vendored at
authoring time — no runtime icon package, no network — and every glyph renders through one
factory (24px viewBox, round caps, `currentColor` stroke, `{size, active}` props,
`strokeWidth` 2 / 2.25 when active). License attribution ships in
`THIRD_PARTY_NOTICES.md` and `licenses/lucide-LICENSE.txt`.

**State styling rule**: toolbar icon buttons are borderless. Active / hover states are
painted with `background` only; the keyboard focus ring is a `box-shadow`, and it is shown
only when `:focus-visible` matches (a pointer click must not leave a frame around the glyph).
Never toggle `border-color` for a state transition: React's style diff together with the CSS
transition leaves a stale dark border behind on the previously active tab.

### Colour themes (`THEME_PALETTES` in `00-core.ts`)

The panel ships VS Code's mainstream palettes and switches between them without touching
the DSH app theme:

- `THEME_PALETTES` maps `themeId → { '--dsw-alias-*': value }` for six palettes
  (`dark-plus`, `light-plus`, `one-dark-pro`, `dracula`, `github-dark`,
  `solarized-light`). Every override key is the full DSH alias name so the colour audit can
  see which token it overrides; a theme may add scrollbar aliases for dark palettes.
- `S.THEMES` lists `auto` (the default: no overrides, inherits the live DSH theme) plus the
  six palettes. `S.readTheme()` / `S.writeTheme(id)` persist the choice under
  `localStorage['dsh-workspace-ide:theme']` (unknown ids fall back to `auto`);
  `S.themeVars(id)` returns the override object (`{}` for auto).
- `S.Shell` applies `Object.assign({}, ST_SHELL.root, S.themeVars(theme))` to the panel root
  and exposes `data-ide-theme={theme}`; the toolbar's palette button opens a themed
  popover (listbox with `role=option`, swatches, current check, outside-click/Escape close,
  arrow/Home/End/Enter/Space keyboard support).
- `C` (the token map) is not duplicated: the override table changes the CSS custom
  properties the existing `var(--dsw-alias-*)` references already read.

The theme picker glyphs are Lucide `palette` / `check`, vendored like every other icon in
`05-icons.ts` (TypeScript pilot for the client build pipeline).

### Syntax highlighting (`07-highlight.ts`)

JSX/TSX currently reuse the JavaScript/TypeScript tokenizer (`LANGUAGE_CONFIGS.jsx` and
`.tsx` alias the same config objects) so those files get full token colours instead of the
plain fallback; the dedicated markup scanner is still used for HTML/XML/Vue/Svelte tag
level.

`S.highlightLines(code, language)` returns one entry per source line; each entry is an array
of `[kind, text]` segments (`kind` ∈ keyword, string, comment, number, constant, function,
type, variable, operator, punctuation, tag, attr, property, regexp, meta, plain). The
**segment invariant** is a hard contract: concatenating a line's segments must reproduce
that source line exactly (including empty lines) — the editable overlay aligns the coloured
layer with the textarea character by character.

- Comment syntax for the editor shortcut lives here too: `S.COMMENT_LANGUAGES`,
  `S.commentTokens(language)` and the pure `S.toggleLineComments(text, start, end,
  language)` (line tokens for most languages, block wrapping for CSS/HTML/Markdown).
- Coverage: `S.HIGHLIGHT_LANGUAGES` maps the Host's `file` route language ids plus common
  aliases to a language (JS/TS/JSX/TSX, JSON, Markdown, CSS, HTML/XML, Python, Go, Rust,
  Java, Kotlin, Swift, C/C++, C#, Ruby, PHP, Shell, PowerShell, YAML, TOML, INI, SQL,
  GraphQL, Vue/Svelte tag level, `text`). Markdown fenced code re-highlights its info
  language. Unknown/`text` languages and sources > 300 KB fall back to plain segments
  without regex scanning.
- The tokenizer is a plain-JS state machine (comments `// # --`, `/* */`, `<!-- -->`,
  Python triple quotes, template strings, escapes, hex/bin/oct/float numbers, keyword/
  type/constant/identifier sets, JSON/CSS/YAML/TOML/INI properties, HTML tags/attrs/
  entities, Markdown headings/fences/inline code/emphasis/links/lists/quotes). It emits
  **data only** — never HTML strings — so the existing "no innerHTML" audit keeps holding.
- Colours are CSS variables: `SYN[kind] = 'var(--ide-tok-<kind>, var(--shiki-token-<…>,
  <light fallback>))'`. `auto` sets no overrides, so it inherits the DSH theme's own
  `--shiki-token-*` light/dark values; the six VSCode palettes append their own
  `'--ide-tok-*'` overrides to `THEME_PALETTES` (the colour audit allows those named lines).
### Markdown preview (`08-markdown.ts`)

- `S.parseMarkdown(source)` returns block nodes (ATX/setext headings, fenced code,
  blockquotes, ordered/unordered lists with nesting and task boxes, GFM tables, rules,
  paragraphs); `S.parseMarkdownInline(text)` returns inline nodes (text, code, strong, em,
  del, link, image, autolink). Sources over 300 KB render as a single paragraph.
- `S.renderMarkdown(source)` renders those nodes to **React elements only**, so the artifact
  keeps its no-HTML-sink property. Code fences reuse `S.highlightLines` + `S.highlightColor`;
  all colours come from the shared `--dsw-alias-*` tokens via `C` (no raw colour values).
- URLs pass through a scheme allow-list: `javascript:`/`vbscript:`/`data:`/`file:` render as
  plain text; http(s), mailto, anchors and relative workspace paths are kept; external links
  get `target="_blank" rel="noreferrer noopener"`.
- Files integration (`20-files.ts`): Markdown files show a 源码 / 预览 segmented control in
  the viewer header. `markdownMode` lives in `FilesView`, resets to `source` when another
  file opens, and `Cmd/Ctrl+Shift+V` toggles it. The preview always renders the current
  draft (dirty state included) and read-only/oversized Markdown keeps the toggle.
- Smoke coverage: block/inline parser shapes, table/quote/list rendering, highlighted
  fences, unsafe URLs, and the source/preview toggle.

- Editor integration (`20-files.ts` `FileViewer`): the editable path keeps the textarea as
  the input surface but renders its text transparent (`caretColor` = text colour) over an
  absolutely-positioned highlight layer with identical font, size, line height, padding and
  tab size; the layer follows `translate(-scrollLeft, -scrollTop)` on the textarea's scroll
  event, next to the existing gutter sync. Read-only/truncated previews render the coloured
  layer in a `<pre>` behind the gutter. Highlighting is memoised on (text, language) and
  capped at 50 000 rendered segments per editor value so a minified single-line file cannot
  explode the element tree.

### Module face (`99-face.ts`)

```js
S.face = {
  inject: ['slots'],
  apply(ctx) {
    const locale = ctx.get?.('locale');           // optional service
    if (locale) { /* ctx.effect(() => locale.register(NS, S.I18N)); t = locale.bind(NS) */ }
    S.ping('apply');
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist', id: 'workspace-ide', order: 15,
      label: () => t('panel'),
      ...(locale ? { locale: NS } : {}),
    }, S.Icons.PanelIcon));
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main', key: 'workspace-ide',
      ...(locale ? { locale: NS } : {}),
    }, (props) => h(S.PanelBoundary, { t: (props && props.t) || t },
        h(S.Shell, { t: (props && props.t) || t }))));
  },
};
```

`S.ping(stage, detail)` = fire-and-forget `fetch('api/dsh-workspace-ide.ping',
{method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({stage,
detail})}).catch(() => {})`. Never let it throw or block rendering.
`S.TABS = [{ id:'files', icon:'Files' }, { id:'search', icon:'Search' },
{ id:'git', icon:'Git' }]`.

### Shell (`10-shell.ts`)

`S.Shell({ t, preferredRoot })` — fills the `main` slot (root style: `height:100%`,
flex column, `background: var(--dsw-alias-bg-base)`,
`color: var(--dsw-alias-label-primary)`, `fontSize: 13`, `overflow:hidden`,
`minHeight:0`, `boxSizing:border-box`) **plus the DSH desktop frame chrome insets**:

- `paddingTop: var(--dsh-frame-top-clearance, 0px)` — on macOS desktop this is the 48px
  window top strip; without it the toolbar lands inside the window drag band and its
  buttons cannot be clicked.
- `paddingInlineStart: var(--dsh-frame-leading-clearance, 0px)` — published only while
  the sidebar is collapsed on macOS; it keeps the toolbar out from under the traffic
  lights / `shell.leading` seat.

Both variables are absent outside the desktop frame, so web/headless documents stay flat.
(This is the exact contract `dsh-client-ui-layout` documents for main panels that reach
the top-left corner — see that package's README.)

- State: `tab` (`files` default), `workspaces`, `root`, `rootError`.
- On mount: `GET api/dsh-workspace-ide.workspaces`; choose the root to display in this
  order:
  1. the currently displayed root, when still listed (refresh keeps the view);
  2. an explicit pick already made **in this session** — persisted as
     `localStorage['dsh-workspace-ide:root'] = {"root": path, "sessionId": …}`;
  3. the workspace that owns the session the app is currently viewing: the active
     session id is read from the workspace UI's persisted `dsh.sessions.current` store,
     and the workspace is resolved through the slot kit's `useWorkspaces` hook
     (`items[].sessionIds`); the panel body is a small wrapper component that renders
     `S.Shell` with `preferredRoot` (a HOOK-free fallback renders without it when the
     slot kit does not provide the hook);
  4. any persisted root;
  5. the first entry with `live === true`;
  6. the first entry.
  Explicit picks are persisted with the current session id, so switching sessions follows
  the new session's workspace while a user's manual pick survives re-opens in that session.
  Empty list → render an empty state with a retry button.
- Toolbar (44–48px, bottom border `--dsw-alias-border-l1`):
  - left: three icon buttons (Files / Search / Git) — the screenshot look: icons only,
    28–32px square, rounded, active = `background: var(--dsw-alias-interactive-bg-hover)`
    or layer token, `aria-label` + `title` from t(). **This three-icon strip is the
    centrepiece; match the reference screenshot (file-copy icon, list+search icon,
    git-branch icon).**
  - right: workspace `<select>` (title + path, native select styled with tokens),
    refresh button (reloads workspaces and re-mounts the active view via a `reloadToken`).
- Body: `S.FilesView` and `S.SearchView` get `{ t, root, onOpenFile, reloadToken }`;
  `S.GitView` gets `{ t, root, reloadToken, workspaces, onSelectWorkspace }`.
  `onOpenFile(path, line)` → `setTab('files')` and store `{ path, line, token }` in
  `openRequest` passed to FilesView. `onSelectWorkspace(root)` updates the selected
  workspace (persisted like the dropdown).
- `useEffect` on mount → `S.ping('panel')`; on tab change → `S.ping('tab', tab)`.
- `S.PanelBoundary` — class component with `getDerivedStateFromError`; renders a compact
  error card with the message and a "retry" button that re-mounts children by key.

### Files (`20-files.ts`)

`S.FilesView({ t, root, openRequest, reloadToken })` — horizontal split:
- Tree pane: width 300px default, draggable handle (pointer events, 180–560px), own scroll,
  `borderRight: 1px solid var(--dsw-alias-border-l1)`.
  - Lazy-load directory children via `api/dsh-workspace-ide.list?root=&path=`.
  - The workspace root starts expanded (show its entries immediately).
  - Filter out `.git` and `.DS_Store` entries client-side.
  - Row: indent by depth; chevron for dirs; folder/file icons (inline SVG); name;
    hover background. Click dir → toggle; click file → open.
  - Loading/empty/error states inline; refresh when `reloadToken` changes.
- Viewer pane: fills the rest.
  - Header: JetBrains-style breadcrumb of the opened file path; directory segments are
    buttons that reveal (expand + load) their prefix in the tree, the file segment is the
    bold leaf. Then the language chip, size, modified time, editor-toolbar actions
    (Reload, Soft-Wrap, Go-to-Line), and for dirty files a Save button + "已修改" marker.
  - Body: line numbers gutter + editable `<textarea>` (monospace 12.5px/20px, tabSize 2,
    spellCheck false, whiteSpace pre, horizontal scroll, synced vertical scroll with the
    gutter). Files > 400 KB open read-only (pre, no textarea). Binary → notice.
  - Soft-wrap (`Alt+Z`, toolbar button or status-bar toggle): the textarea gets
    `wrap=soft`, the syntax overlay switches to `pre-wrap` with the same metrics, and the
    numbered gutter is hidden because wrapped rows can no longer line up with numbers.
    The preference is persisted in localStorage (`dsh-workspace-ide:editor-wrap`).
  - Go-to-line (`Cmd/Ctrl+G`, toolbar button): a slim bar above the editor takes a line
    number, Enter jumps (selects the line, scrolls it into view), Escape closes it.
  - Find / Replace (`Cmd/Ctrl+F` / `Cmd/Ctrl+H` or the toolbar button): a two-row bar
    with a query field, match counter (`n/m`), previous/next, case / whole-word / regex
    toggles, and a replacement row (`Replace`, `Replace All`). `S.findTextMatches` is the
    pure engine (literal or regex; lookbehind-based whole-word; capped at 5000 hits);
    `S.groupFindMatches` maps hits to line-relative ranges. An absolute highlight layer
    paints every match behind the transparent textarea (accent fill for the current hit),
    follows the same scroll transform in both wrap modes, and the current match is
    selected/scrolled without stealing focus from the bar. Empty query / invalid regex
    answer no matches instead of throwing.
  - Status bar: caret line/column, selection size, language, EOL (`LF`/`CRLF`), line count,
    encoding, a clickable soft-wrap state and the read-only lock.
  - Multi-tab editor: every opened file becomes a tab above the viewer (file glyph,
    basename, dirty dot, per-tab close). Switching stores the live `{file, draft, caret,
    markdownMode, svgMode, image, dimensions}` snapshot in memory and restores it
    without a network round-trip, so unsaved drafts and carets survive tab switches.
    Closing a dirty tab first shows an inline confirmation bar (Close Anyway /
    Cancel); the workspace root change resets the tab set.
  - Go to Symbol (`Cmd/Ctrl+Shift+O`, or the list button in the editor toolbar): a
    centered palette fed by `S.extractSymbols` (regex-based functions/classes/types/
    constants/methods, Markdown headings, JSON keys) over the current draft; Up/Down +
    Enter jumps to the line, Esc or a click outside closes.
  - Quick open (`Cmd/Ctrl+P`, or the search button in the tree header): a centered palette
    fetches `api/dsh-workspace-ide.files` once per session, then ranks paths locally with
    `S.quickOpenScore` / `S.rankQuickOpen` (case-insensitive subsequence, boundary and
    basename bonuses); with an empty query it shows recently opened files first via
    `S.orderQuickFiles` (JetBrains "Recent Files"). Up/Down selects, Enter opens, Esc or a click outside closes; a
    truncated index is labelled in the bar.
  - Navigation history: every explicit open pushes `{path, line}` onto a stack; the editor
    header gets back/forward buttons and `Cmd/Ctrl+Alt+←/→` walks the stack (history
    navigation itself does not push).
  - Markdown/HTML just shown as text (this is a code viewer).
  - Editing feel (JetBrains-style): typing an opening bracket / quote inserts its
    pair (`S.autoPairEdit`), a closing bracket over-types an existing one instead of
    duplicating it, selections are wrapped by the pair, Enter keeps the current
    indentation and adds one level after `{`/`[`/`(` (`S.smartIndentEdit`), and
    Shift+Tab outdents the selected lines. The bracket pair touching the caret is
    highlighted through a transparent overlay (`S.bracketMatch`); the current line
    and indent guides render behind the text in the same character grid (guides are
    hidden in soft-wrap/read-only/preview modes where visual lines no longer match).
  - Keyboard: Ctrl/Cmd+S saves; Ctrl/Cmd+Shift+O opens Go to Symbol; Ctrl/Cmd+W closes
    the active tab; Ctrl/Cmd+P opens
    Quick Open; Ctrl/Cmd+Alt+Left/Right walk
    the navigation history; Ctrl/Cmd+G opens Go-to-Line; Ctrl/Cmd+F opens Find;
    Ctrl/Cmd+H opens Find with the replace row; Alt+Z toggles soft-wrap; in the find bar
    Enter/Shift+Enter walk matches and Escape closes it; Escape otherwise closes
    Go-to-Line or cancels dirty state (reload from disk);
    Cmd/Ctrl+Shift+V toggles the Markdown preview (Markdown files) or the image/source
    view (SVG files); Cmd/Ctrl+/ toggles comments via
    `S.toggleLineComments(text, start, end, language)`.
  - Images: raster paths (`S.imageMimeForPath` → png/jpg/jpeg/gif/webp/bmp/ico/avif) are
    fetched through `api/dsh-workspace-ide.image`, converted to a `data:` URL and rendered
    by `S.ImageViewer` (breadcrumb header, checkerboard canvas surface, natural dimensions
    in the status bar). SVG is fetched as text like any other file and previewed from the
    current draft via a data URL; its header gets a `图片 / 源码` segmented control and the
    usual editor (and save path) stays available in source mode.
    Line comments use each language's token (`//`, `#`, `--`, `;`), block-only languages
    (CSS/HTML/XML/Markdown/Vue/Svelte) wrap and unwrap `/* */` / `<!-- -->`. The pure
    function returns `{text, selectionStart, selectionEnd, changed}`; the editor applies
    the text and restores the returned selection. Blank lines are untouched, indentation
    is preserved and a second press reverts the first.
  - Save via `POST api/dsh-workspace-ide.save`; show success/error notice inline.
  - The editor works on LF internally (the textarea API normalizes CRLF); the loaded file's
    original line ending is remembered and re-applied on save, so opening and saving a CRLF
    file never rewrites its line endings. The dirty flag compares normalized text.
  - `openRequest` (`{path, line, token}`) opens the file, scrolls the textarea so `line`
    is visible, and selects that line's text.
- Empty state: icon + "从左侧选择一个文件" / select hint.

### Search (`30-search.ts`)

`S.SearchView({ t, root, onOpenFile })`.
- Search bar: text input (placeholder "在工作区中搜索", Enter runs), toggles Aa (case),
  `.*` (regex), `ab|` (whole word), optional include filter input, search button.
- Query `GET api/dsh-workspace-ide.search?...`; debounce 250ms only for explicit runs is
  unnecessary — run on Enter / button; cancel in-flight request with AbortController.
- Summary line: `N 个文件 · M 个结果 · Xms`, truncated warning when set.
- Results: per file a header row (file icon + path + match count, click to open file) and
  match rows: line number (muted) + line text with the matched substring wrapped in
  `<mark>` using `column`/`length` (JS slice, UTF-16). Clicking a row calls
  `onOpenFile(path, line)`.
- Loading/empty/no-results/error states.

### Git (`40-git.ts`)

`S.GitView({ t, root, reloadToken })`.
- On root/reload: `git?kind=status` + `git?kind=log` in parallel; loading + error states;
  `repo:false` → not-a-repo empty state. That empty state names the current workspace as
  not a git repository, offers a retry button, and — using the `workspaces` prop — lists up
  to a handful of other workspaces with `git === true` as one-click switch buttons
  (`onSelectWorkspace(ws.path)`); when there is none, it shows the generic hint only.
- Header: branch chip (`branch`), ahead/behind, dirty summary; segmented switch
  `更改` / `历史`.
- Changes: grouped sections 已暂存 / 未暂存 / 未跟踪 / 冲突; row shows status code letter
  (M/A/D/R/U) + path. Click → fetch diff:
  - staged group: `kind=diff&staged=1&path=…`
  - unstaged/untracked: `kind=diff&path=…`
  - show in a right-hand diff pane (same split layout as Files: list left, diff right).
- History: commit rows (short hash, subject, author, date); click →
  `kind=diff&commit=<hash>`; diff pane header shows commit subject/hash/author/date.
- `S.DiffView({ diff, t })`: parse unified diff text into lines **with a hunk-aware
  state machine** (the hunk header's old/new counts decide membership, so a deletion whose
  content starts with `-- ` renders as `--- …` and stays a deletion, and additions starting
  with `++ ` stay additions, without resetting the hunk's line numbering); style headers
  (`diff --git`, `index`, `---`, `+++`, `new file`, `deleted file`) muted;
  hunk headers `@@ … @@` in accent (`--dsw-alias-brand-primary`); `+` green
  (`--dsw-alias-state-success-primary`), `-` red (`--dsw-alias-state-error-primary`),
  context default; render in a monospace `<pre>` with horizontal scroll; cap 4000 lines
  with a truncated notice; show "无差异" when empty.
- Refresh button refetches status+log and clears selection.

### i18n

`S.I18N = { zh: {…}, en: {…} }` — keys used by a `S.useT()` hook that picks
`document.documentElement.lang || navigator.language`, zh when it starts with `zh`,
otherwise en; `t('key', { count: 3 })` replaces `{count}`. Every visible string (labels,
placeholders, empty states, errors, buttons, notices) must be in the dictionary.

### Type checking (`tsconfig.json` + `types/`)

- Plain JavaScript stays the source of truth; TypeScript is a **dev-only checker**
  (`allowJs + checkJs + noEmit`). No bundler, no emitted JS, no runtime dependency.
- Three gates, all must exit 0 in CI after `npm ci`:
  1. `npm run typecheck` — `strict: true` over `lib/`, `src/client/`, `scripts/` and `test/`;
  2. `npm run typecheck:host` — `lib/` additionally under `noImplicitAny`
     (`tsconfig.host.json`);
  3. `npm run typecheck:client` — **all** client sources (TypeScript, script-style
     fragments) under `noImplicitAny` (`tsconfig.client.json`).
- The client half is fully migrated to TypeScript; authoring fragments may still be plain
  `.js` during experiments (the build pipeline compiles `.ts`/`.tsx` with `tsc`). The test
  suites are the remaining `noImplicitAny` stage (311 diagnostics); add a scoped test
  config when they are typed.
- `types/client-globals.d.ts` declares the factory-scope globals that
  `scripts/build-client.mjs` injects (`React`, `h` typed as `React.createElement`, the five
  hooks, the shared `S` namespace) so `src/client/*.js` is checked as one scope.
- `types/dsh-services.d.ts` declares the optional DSH Host context subset (`get`, `effect`,
  `connection.fetch`, `logger`) as local ambient interfaces — never `@deepseek-ai/*`
  imports — plus the `WorkspaceRoot` and `RouteDefinition` shapes. All context members are
  optional because the Host half degrades gracefully and tests pass partial contexts.

### Verification (`test/smoke/client-smoke.mjs`)

Runs on plain Node, no third-party deps, exits 0/1:

- Fake `globalThis.window = { __ModuleLoader__: { load(def) { captured = def } } }`;
  load `lib/client.js` with `node:vm` (`vm.runInThisContext`, filename set).
- Fake `require('react')` with the used surface: `createElement` returning plain objects,
  `Component` class with `getDerivedStateFromError` support, `useState` returning
  `[typeof init === 'function' ? init() : init, () => {}]`, `useRef`, `useEffect`,
  `useCallback` (identity), `useMemo` (compute).
- Assert the module face: `inject` includes `'slots'`; `apply` with a fake `ctx`
  (`slots.inject(name, cb)`, `slots.register`, `effect`, `get` → undefined, `locale`
  absent) registers exactly two slots: `sidebar.panellist` with `id === 'workspace-ide'`
  and `main` with `key === 'workspace-ide'`, both with a component function; call the
  icon component with `{ size: 18, active: true }` and assert it returns a non-null tree
  whose svg has the requested size.
- Call the `main` component with `{ t: (k) => k }`; assert it renders without throwing and
  that traversing the returned tree finds all three tab labels/icons registered
  (aria-label or data-tab markers).
- Static checks: `lib/client.js` contains no `import`/`export` statements and no
  `@deepseek-ai/` `require` other than none; `node --check lib/client.js` passes
  (run it as a child process too, so a broken artifact fails the test).

## Definition of done

- `npm ci && npm run typecheck` passes (dev-only strict type checker, no emit) and
  `node scripts/build-client.mjs && node --check lib/client.js && node --test test/host/ &&
  node test/smoke/client-smoke.mjs` all pass (the smoke suite also asserts the
  highlighter's segment invariant, language fallbacks and theme token variables).
- All three surfaces implemented; every fetch error path renders a message instead of
  throwing; the whole panel works with zero data (empty workspace, non-git folder).
- Report back: what was implemented, files written, commands run + results, deviations
  from this contract and why.
