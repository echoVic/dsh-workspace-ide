# Changelog

All notable changes to `dsh-workspace-ide` are documented here. Releases are
annotated Git tags; every entry ships the prebuilt Host + client halves, so
installing needs no build step and no runtime dependency beyond DSH and React.

## 1.8.7 — 2026-11-12

### Changed
- README: removed the hardcoded current version (the npm badge is authoritative)
  and fixed the pinned release-tarball example. Artifact unchanged.

## 1.8.6 — 2026-11-12

### Fixed
- Quick Open with an empty query crashed the renderer: recent-first results were
  bare path strings while the palette rows expect `{path, score}` objects. Added
  `S.quickOpenRows` to normalize both query modes and fixed the README
  `screenshot-quick-open.png` blank image. Smoke test covers both row shapes.

## 1.8.5 — 2026-11-12

### Changed
- README screenshots regenerated from the current client build: the bracket
  matching shot now shows the current-symbol breadcrumb (`src › app.tsx › theme`),
  and the find/theme/git-empty shots were re-rendered. Artifact unchanged.

## 1.8.4 — 2026-11-12

### Changed
- README: npm package badge and install section (npm package name/spec,
  GitHub/tarball alternatives, local-checkout dev flow), release/provenance
  workflow section. Artifact unchanged.

## 1.8.3 — 2026-11-12

### Changed
- Release workflow now runs a direct `npm publish` via trusted publishing
  (GitHub OIDC) instead of staging, so a `v*` tag publishes without a manual
  approval step. This requires the npm trusted-publisher permission
  "Allow npm publish" for workflow `publish.yml`.

## 1.8.2 — 2026-11-12

### Added
- GitHub Actions workflow `.github/workflows/publish.yml`: pushing a `v*` tag
  now stages the matching package version on npm via trusted publishing (OIDC)
  and `npm stage publish`; a maintainer approves the staged version on
  npmjs.com as the human 2FA step. No npm token is stored in the repository.

## 1.8.1 — 2026-11-12

### Changed
- Documentation refresh (CHANGELOG, README corrections).

## 1.8.0 — 2026-11-11

### Added
- Current-symbol breadcrumb in the editor header (deepest enclosing declaration
  above the caret) and `Alt+Up/Down` navigation between symbols.
- `S.symbolAtLine` / `S.nextSymbolLine` helpers.

## 1.7.0 — 2026-11-11

### Added
- Git change marks in the editor gutter: green added, red deleted, blue
  modified, parsed from the Host diff route and refreshed after saves.
- `S.parseGitGutter` helper.

## 1.6.0 — 2026-11-11

### Added
- `Tab` / `Shift+Tab` indent and outdent every line touched by the selection
  (`S.indentLines`).
- `Ctrl/Cmd+Shift+T` reopens the last closed tab with its unsaved draft.
- Find seeds its query from the word under the caret when there is no
  selection.

## 1.5.0 — 2026-11-11

### Added
- Line bookmarks: `F11` toggles the caret line, `Shift+F11` opens a filterable
  bookmark palette; bookmarks persist per file, render as gutter marks and as a
  `书签 N` status-bar button.
- `S.toggleBookmarkLine` / `S.flattenBookmarks` helpers.

## 1.4.0 — 2026-11-11

### Added
- Recent Locations palette (`Ctrl/Cmd+Shift+E`) over the navigation history.
- Toggle Case (`Ctrl/Cmd+Shift+U`) and Join Lines (`Ctrl/Cmd+Shift+J`).

## 1.3.0 — 2026-11-11

### Added
- Duplicate Line (`Ctrl/Cmd+D`) and Move Line (`Alt+Shift+Up/Down`).
- `S.duplicateLines` / `S.moveLines` helpers.

## 1.2.0 — 2026-11-11

### Added
- Editor zoom (`Ctrl/Cmd+=` / `Ctrl/Cmd+-`, `Ctrl/Cmd+0` resets, 50–200%,
  persisted). Font, line height, padding, gutter, guides and highlight layers
  scale together; the status bar reports the current zoom.

## 1.1.0 / 1.1.1 — 2026-11-11

### Added
- Go to Symbol (`Ctrl/Cmd+Shift+O`) with regex-based symbol extraction for code,
  Markdown headings and JSON keys.
- Invalid-regex error label in the find bar, F3 / Shift+F3 match navigation and
  middle-click tab close.

## 1.0.x — 2026-11-11

### Added
- **1.0.0**: first stable JetBrains-style editor — clickable breadcrumbs,
  soft-wrap, go-to-line, in-file find & replace with all-match highlighting,
  Quick Open, navigation history, multi-tab editing with per-tab drafts and
  unsaved-change guards, bracket matching, auto-pair, smart indent,
  current-line highlight, indent guides and a rich status bar. JSX/TSX now use
  the JS/TS tokenizer instead of the plain fallback; README gained reproducible
  editor screenshots.
- **1.0.1**: empty-query Quick Open lists recently opened files first and tabs
  show a file glyph.
- **1.0.2**: marketplace metadata refresh (description, keywords,
  `screenshots.json`).

## 0.8.0 – 0.12.0 — 2026-11-11

JetBrains-fidelity phases on top of the TypeScript migration:

- **0.8.0**: editor chrome — reload/soft-wrap/go-to-line toolbar, clickable
  breadcrumbs, status bar (caret, selection, language, EOL, encoding).
- **0.9.0**: in-file find & replace with counter, previous/next,
  case/whole-word/regex toggles, Replace / Replace All and an all-match
  highlight layer.
- **0.10.0**: Quick Open over a Host file index and back/forward navigation
  history (new ninth Host route `files`).
- **0.11.0**: multi-tab editing with per-tab drafts/carets and an
  unsaved-change guard.
- **0.12.0**: bracket matching, auto-pair, smart indent, Shift+Tab outdent,
  current line and indent guides.

## 0.5.0 – 0.7.0 — 2026-11-11

TypeScript migration of the browser half without a bundler:

- **0.5.0**: `tsc`-compiled TS fragments concatenated with the JS ones; icons
  migrated as the pilot.
- **0.6.0**: highlighter, Markdown renderer and search moved to TypeScript.
- **0.7.0**: the whole client half on TypeScript; the scoped type gates collapsed
  into one client gate with `noImplicitAny` for every client source.

## 0.4.0 – 0.4.2 — 2026-11-11

Staged strict typing: repo-wide `strict` (except `noImplicitAny`), then the Host
half under `noImplicitAny`, then the client core/icons.

## 0.3.x — 2026-11-11

Development-only TypeScript checker (`allowJs` + `checkJs` + `noEmit`, no
runtime dependency) and incremented `strictNullChecks` coverage from the Host
half to the whole client half.

## 0.3.0 — 2026-11-11

### Added
- Raster image preview (magic-number verified, 8 MiB cap) and SVG image/source
  toggle.
- Screenshot harness rendering the real client bundle against mock data.

## 0.2.0 — 2026-11-11

### Added
- Markdown preview with source toggle, rendered as React elements (never HTML
  strings) and highlighted by the shared tokenizer.

## 0.1.x — 2026-11-11

### Added
- Initial panel: lazy workspace file tree, syntax-highlighted editable code
  viewer with save, workspace-wide search, git status/changes/history with
  coloured diffs, seven colour themes (six VS Code palettes plus follow-DSH),
  comment toggle and the Make-your-own-VSCode screenshots.
- Host: eight authenticated fetch routes (later nine) with workspace-root and
  symlink-escape guards; `ping` diagnostics channel.
