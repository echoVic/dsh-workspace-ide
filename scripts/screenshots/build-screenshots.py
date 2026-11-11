#!/usr/bin/env python3
"""Render the README screenshots for dsh-workspace-ide with MOCK data.

The panel is a browser module that talks to the DSH Host over fetch routes. This
script mounts the *real* built client half (`lib/client.js`) against a stubbed
fetch layer and synthetic demo data (workspace `aurora-dashboard`, fake files,
fake git branch/commits/diffs), then screenshots it with headless Chrome. No DSH
session, real workspace or personal data is involved.

Requirements: Google Chrome (headless) and Pillow. React 18 UMD builds are
downloaded once from unpkg into /tmp.

    python3 scripts/screenshots/build-screenshots.py
"""

import base64
import difflib
import io
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CLIENT = (ROOT / 'lib' / 'client.js').read_text()
DOCS_DIR = ROOT / 'docs'
OUT = Path('/tmp/dsh-ide-shots')
OUT.mkdir(parents=True, exist_ok=True)
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
REACT_URL = 'https://unpkg.com/react@18.3.1/umd/react.production.min.js'
REACT_DOM_URL = 'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js'

WINDOW_W = 1200
WINDOW_H = 840


def fetch_umd(url: str, name: str) -> str:
    target = Path(tempfile.gettempdir()) / name
    if not target.exists() or target.stat().st_size < 1000:
        subprocess.run(['curl', '-s', '--max-time', '30', '-o', str(target), url], check=True)
    return target.read_text()


# ─── mock workspace data ────────────────────────────────────────────────────
AURORA = '/Users/demo/aurora-dashboard'
DESIGN = '/Users/demo/design-system'
DOCS = AURORA + '/docs'

APP_TSX = """import { useMemo, useState } from 'react';
import { createTheme, type ThemeTokens } from './theme';
import { Header } from './components/Header';
import { Chart } from './components/Chart';
import { fetchMetrics, type Metric } from './api';
import './styles.css';

/**
 * Aurora dashboard shell: theme switching plus a live metrics panel.
 * All numbers below are mock data so the demo runs without a backend.
 */
export default function App() {
  const [mode, setMode] = useState<ThemeTokens['mode']>('midtone');
  const [range, setRange] = useState<number>(14);

  const theme = useMemo(() => createTheme(mode), [mode]);
  const metrics: Metric[] = fetchMetrics(range);

  return (
    <main className={`app app--${mode}`} style={{ ...theme, minHeight: '100vh' }}>
      <Header
        title="Aurora"
        subtitle={`Product analytics · last ${range} days`}
        onModeChange={setMode}
      />
      <section className="grid">
        {metrics.map((metric) => (
          <Chart key={metric.id} metric={metric} tokens={theme} range={range} />
        ))}
      </section>
    </main>
  );
}
"""

THEME_OLD = """/**
 * Semantic design tokens for the Aurora dashboard.
 * Every component reads colours from here, never from raw hex.
 */

export type ThemeMode = 'light' | 'dark';

const BASE = {
  radius: 12,
  font: '"Inter", system-ui, sans-serif',
} as const;

export const MODES: readonly ThemeMode[] = ['light', 'dark'];

export function createTheme(mode: ThemeMode) {
  const dark = mode === 'dark';
  return {
    mode,
    ...BASE,
    bg: dark ? '#0f1115' : '#ffffff',
    surface: dark ? '#161a22' : '#f6f8fb',
    text: dark ? '#e9edf5' : '#1b2432',
    accent: dark ? '#5b8cff' : '#2f6bff',
    grid: dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
  } as const;
}
"""

THEME_TS = """/**
 * Semantic design tokens for the Aurora dashboard.
 * Every component reads colours from here, never from raw hex.
 */

export type ThemeMode = 'light' | 'midtone' | 'dark';

const BASE = {
  radius: 12,
  font: '"Inter", system-ui, sans-serif',
} as const;

export const MODES: readonly ThemeMode[] = ['light', 'midtone', 'dark'];

/** Contrast-safe surface ramp shared by the three modes. */
const SURFACES: Record<ThemeMode, { bg: string; surface: string; text: string }> = {
  light: { bg: '#ffffff', surface: '#f6f8fb', text: '#1b2432' },
  midtone: { bg: '#eef2f9', surface: '#ffffff', text: '#26303d' },
  dark: { bg: '#0f1115', surface: '#161a22', text: '#e9edf5' },
};

export function createTheme(mode: ThemeMode) {
  const surface = SURFACES[mode];
  const dark = mode === 'dark';
  return {
    mode,
    ...BASE,
    ...surface,
    accent: dark ? '#5b8cff' : '#2f6bff',
    grid: dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
  } as const;
}

export type ThemeTokens = ReturnType<typeof createTheme>;
"""

API_TS = """import type { ThemeMode } from './theme';

export interface Metric {
  id: string;
  label: string;
  value: number;
  delta: number;
  series: number[];
}

const SERIES: Metric[] = [
  { id: 'mrr', label: 'MRR', value: 48200, delta: 0.082, series: [31, 34, 33, 38, 41, 44, 48] },
  { id: 'dau', label: 'Daily active users', value: 12840, delta: 0.021, series: [9, 10, 11, 11, 12, 12, 12.8] },
  { id: 'churn', label: 'Churn', value: 0.011, delta: -0.004, series: [2.1, 2, 1.9, 1.7, 1.5, 1.3, 1.1] },
];

/** Deterministic mock metrics; `range` only trims the plotted series. */
export function fetchMetrics(range: number): Metric[] {
  return SERIES.map((metric) => ({
    ...metric,
    series: metric.series.slice(-Math.max(2, Math.min(range, metric.series.length))),
  }));
}

export function formatDelta(delta: number, mode: ThemeMode): string {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${(delta * 100).toFixed(1)}% · ${mode}`;
}
"""

HEADER_TSX = """import type { ThemeMode } from '../theme';

interface HeaderProps {
  title: string;
  subtitle: string;
  onModeChange: (mode: ThemeMode) => void;
}

/** App header with the three-mode theme switch. */
export function Header({ title, subtitle, onModeChange }: HeaderProps) {
  return (
    <header className="header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="header__modes">
        {(['light', 'midtone', 'dark'] as ThemeMode[]).map((mode) => (
          <button key={mode} type="button" onClick={() => onModeChange(mode)}>
            {mode}
          </button>
        ))}
      </div>
    </header>
  );
}
"""

CHART_TSX = """import type { Metric } from '../api';
import type { ThemeTokens } from '../theme';
import { formatDelta } from '../api';

interface ChartProps {
  metric: Metric;
  tokens: ThemeTokens;
  range: number;
}

/** One sparkline card. The SVG path is derived from the mock series. */
export function Chart({ metric, tokens, range }: ChartProps) {
  const max = Math.max(...metric.series);
  const points = metric.series
    .map((value, index) => `${(index / (metric.series.length - 1)) * 100},${40 - (value / max) * 36}`)
    .join(' ');

  return (
    <article className="card" style={{ background: tokens.surface, borderColor: tokens.grid }}>
      <h2>{metric.label}</h2>
      <strong>{metric.value.toLocaleString()}</strong>
      <span>{formatDelta(metric.delta, tokens.mode)}</span>
      <svg viewBox="0 0 100 40" role="img" aria-label={`${metric.label}, last ${range} days`}>
        <polyline points={points} fill="none" stroke={tokens.accent} strokeWidth="2" />
      </svg>
    </article>
  );
}
"""

SEARCHBOX_TSX = """import { useState } from 'react';

interface SearchBoxProps {
  placeholder: string;
  onSearch: (query: string) => void;
}

/** Debounced search field used by the metrics explorer. */
export function SearchBox({ placeholder, onSearch }: SearchBoxProps) {
  const [query, setQuery] = useState('');

  return (
    <label className="search">
      <span className="search__icon" aria-hidden="true">⌕</span>
      <input
        value={query}
        placeholder={placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          onSearch(event.target.value);
        }}
      />
    </label>
  );
}
"""

PACKAGE_JSON = """{
  "name": "aurora-dashboard",
  "version": "0.4.0",
  "private": true,
  "type": "module",
  "description": "Product analytics dashboard with a three-mode design token system",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "lint": "eslint src --max-warnings 0"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vitest": "^2.1.4"
  }
}
"""

README_MD = """# Aurora

A product analytics dashboard for the design team. Three token modes
(`light`, `midtone`, `dark`) share one semantic palette.

> **Tip** — the dashboard runs fully on mock metrics, so `pnpm dev` works
> offline and without a backend.

## Getting started

```bash
pnpm install
pnpm dev
```

The app runs on mock metrics until `VITE_API_URL` is configured.

## Theming

Colours are **never** written inline. Components consume `ThemeTokens` from
[`src/theme.ts`](src/theme.ts), which derives every value from `SURFACES`:

| token | light | dark |
| --- | --- | --- |
| `bg` | `#ffffff` | `#0f1115` |
| `accent` | `#2f6bff` | `#5b8cff` |

```ts
const tokens = createTheme('midtone');
<Chart tokens={tokens} metric={metric} range={14} />;
```

- `createTheme(mode)` returns the full token object
- `useMemo` keeps the object stable per mode
- Charts read `tokens.grid` for the baseline

## Design notes

1. Start from the surface ramp, then layer accents on top.
2. Check contrast for every token pair before merging.
   - Use the snapshot tests in `tests/theme.test.ts`
   - Dark mode is the stricter baseline

See [docs/theming.md](docs/theming.md) ~~(draft)~~ for the full token contract.
"""

STYLES_CSS = """/* Aurora tokens are injected at runtime; this file keeps layout only. */
:root {
  --theme-accent: #5b8cff;
  --theme-radius: 12px;
  --theme-grid: rgba(15, 23, 42, 0.08);
}

.app {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 32px;
  font-family: 'Inter', system-ui, sans-serif;
}

.grid {
  display: grid;
  gap: 16px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.card {
  border: 1px solid var(--theme-grid);
  border-radius: var(--theme-radius);
  padding: 16px 20px;
}

.card strong {
  display: block;
  font-size: 28px;
  font-variant-numeric: tabular-nums;
}

@media (max-width: 720px) {
  .app {
    padding: 16px;
  }
}
"""

TSCONFIG = """{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
"""

THEMING_MD = """# Token contract

Every component consumes the object returned by `createTheme(mode)`.

## Rules

1. No raw hex values outside `src/theme.ts`.
2. Charts read `grid` for baselines and `accent` for the primary series.
3. New modes must extend `SURFACES`, not branch inside components.

```ts
const tokens = createTheme('midtone');
<Chart tokens={tokens} metric={metric} range={14} />
```
"""

CHANGELOG_MD = """# Changelog

## Unreleased

- Add the `midtone` token mode for the marketing shell
- Chart cards now read `tokens.grid` for baselines
- Document the token contract in `docs/theming.md`

## 0.4.0

- Semantic palette replaces the ad-hoc CSS variables
- Header theme switch (light / dark)
"""

TEST_TS = """import { describe, expect, it } from 'vitest';
import { createTheme, MODES } from './theme';

describe('theme tokens', () => {
  it('exposes all three modes', () => {
    expect(MODES).toEqual(['light', 'midtone', 'dark']);
  });

  it('returns a stable surface per mode', () => {
    expect(createTheme('dark').text).toBe('#e9edf5');
    expect(createTheme('light').text).toBe('#1b2432');
  });
});
"""

GITIGNORE = """node_modules/
dist/
.env
.DS_Store
coverage/
"""

LOGO_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="100%" stop-color="#1e3a8a" />
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#60a5fa" />
      <stop offset="100%" stop-color="#a78bfa" />
    </linearGradient>
  </defs>
  <rect width="320" height="320" rx="56" fill="url(#bg)" />
  <circle cx="160" cy="160" r="86" fill="none" stroke="url(#accent)" stroke-width="10" opacity="0.85" />
  <path d="M110 206 L152 140 L186 178 L218 112" fill="none" stroke="#e2e8f0" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="218" cy="112" r="13" fill="#60a5fa" />
</svg>
"""
HERO_PNG = None


def make_hero_png():
    """Generate a small mock dashboard PNG for the image-preview screenshot."""
    from PIL import Image, ImageDraw

    width, height = 720, 420
    image = Image.new('RGB', (width, height), (15, 23, 42))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / height
        draw.line([(0, y), (width, y)], fill=(int(15 + 20 * t), int(23 + 44 * t), int(42 + 70 * t)))
    for x in range(0, width, 40):
        draw.line([(x, 0), (x, height)], fill=(30, 45, 75))
    for y in range(0, height, 40):
        draw.line([(0, y), (width, y)], fill=(30, 45, 75))
    values = [0.36, 0.52, 0.44, 0.7, 0.58, 0.8, 0.92]
    bar_width, gap, left = 54, 26, 70
    points = []
    for index, value in enumerate(values):
        x = left + index * (bar_width + gap)
        bar_height = int(250 * value)
        draw.rounded_rectangle([x, height - 72 - bar_height, x + bar_width, height - 72], radius=10, fill=(59, 130, 246))
        points.append((x + bar_width // 2, height - 72 - bar_height - 22))
    draw.line(points, fill=(167, 139, 250), width=4, joint='curve')
    for point in points:
        draw.ellipse([point[0] - 6, point[1] - 6, point[0] + 6, point[1] + 6], fill=(226, 232, 240))
    draw.rounded_rectangle([24, 20, 320, 66], radius=10, fill=(30, 41, 59))
    draw.text((40, 36), 'Aurora - weekly metrics', fill=(226, 232, 240))
    buffer = io.BytesIO()
    image.save(buffer, 'PNG')
    return buffer.getvalue()


HERO_PNG = make_hero_png()

FILES = {
    'src/app.tsx': {'content': APP_TSX, 'language': 'tsx'},
    'src/theme.ts': {'content': THEME_TS, 'language': 'typescript'},
    'src/api.ts': {'content': API_TS, 'language': 'typescript'},
    'src/components/Header.tsx': {'content': HEADER_TSX, 'language': 'tsx'},
    'src/components/Chart.tsx': {'content': CHART_TSX, 'language': 'tsx'},
    'src/components/SearchBox.tsx': {'content': SEARCHBOX_TSX, 'language': 'tsx'},
    'package.json': {'content': PACKAGE_JSON, 'language': 'json'},
    'README.md': {'content': README_MD, 'language': 'markdown'},
    'styles.css': {'content': STYLES_CSS, 'language': 'css'},
    'tsconfig.json': {'content': TSCONFIG, 'language': 'json'},
    'docs/theming.md': {'content': THEMING_MD, 'language': 'markdown'},
    'docs/changelog.md': {'content': CHANGELOG_MD, 'language': 'markdown'},
    'tests/theme.test.ts': {'content': TEST_TS, 'language': 'typescript'},
    '.gitignore': {'content': GITIGNORE, 'language': 'text'},
    'public/logo.svg': {'content': LOGO_SVG, 'language': 'xml'},
}

MTIME = 1762401000000


def entry(name, path, kind, size):
    return {
        'name': name,
        'path': path,
        'type': kind,
        'size': size,
        'mtimeMs': MTIME,
        'hidden': name.startswith('.'),
    }


def file_size(path):
    return len(FILES[path]['content'].encode('utf-8'))


ENTRIES = {
    '': [
        entry('docs', 'docs', 'dir', 0),
        entry('public', 'public', 'dir', 0),
        entry('src', 'src', 'dir', 0),
        entry('tests', 'tests', 'dir', 0),
        entry('.gitignore', '.gitignore', 'file', file_size('.gitignore')),
        entry('package.json', 'package.json', 'file', file_size('package.json')),
        entry('README.md', 'README.md', 'file', file_size('README.md')),
        entry('styles.css', 'styles.css', 'file', file_size('styles.css')),
        entry('tsconfig.json', 'tsconfig.json', 'file', file_size('tsconfig.json')),
    ],
    'docs': [
        entry('changelog.md', 'docs/changelog.md', 'file', file_size('docs/changelog.md')),
        entry('theming.md', 'docs/theming.md', 'file', file_size('docs/theming.md')),
    ],
    'public': [
        entry('hero.png', 'public/hero.png', 'file', len(HERO_PNG)),
        entry('logo.svg', 'public/logo.svg', 'file', file_size('public/logo.svg')),
    ],
    'src': [
        entry('components', 'src/components', 'dir', 0),
        entry('api.ts', 'src/api.ts', 'file', file_size('src/api.ts')),
        entry('app.tsx', 'src/app.tsx', 'file', file_size('src/app.tsx')),
        entry('theme.ts', 'src/theme.ts', 'file', file_size('src/theme.ts')),
    ],
    'src/components': [
        entry('Chart.tsx', 'src/components/Chart.tsx', 'file', file_size('src/components/Chart.tsx')),
        entry('Header.tsx', 'src/components/Header.tsx', 'file', file_size('src/components/Header.tsx')),
        entry('SearchBox.tsx', 'src/components/SearchBox.tsx', 'file', file_size('src/components/SearchBox.tsx')),
    ],
    'tests': [entry('theme.test.ts', 'tests/theme.test.ts', 'file', file_size('tests/theme.test.ts'))],
}


def search_results():
    def match(path, line, text, needle='theme'):
        lower = text.lower()
        column = lower.index(needle) + 1 if needle in lower else 1
        return {'line': line, 'column': column, 'length': len(needle), 'text': text}

    files = [
        {'path': 'src/theme.ts', 'matches': [
            match('', 1, '/** Theme tokens for the Aurora dashboard. Every component reads them. */'),
            match('', 12, "export const MODES: readonly ThemeMode[] = ['light', 'midtone', 'dark'];"),
            match('', 23, ' * The theme contract every component consumes.'),
        ]},
        {'path': 'src/app.tsx', 'matches': [
            match('', 2, "import { createTheme, type ThemeTokens } from './theme';"),
            match('', 13, '  const theme = useMemo(() => createTheme(mode), [mode]);'),
        ]},
        {'path': 'src/components/Chart.tsx', 'matches': [
            match('', 4, "import type { ThemeTokens } from '../theme';"),
        ]},
        {'path': 'styles.css', 'matches': [
            match('', 2, '  --theme-accent: #5b8cff;'),
        ]},
        {'path': 'docs/theming.md', 'matches': [
            match('', 3, 'Every component consumes the object returned by `createTheme(mode)`.'),
            match('', 13, '3. New theme modes must extend `SURFACES`, not branch inside components.'),
        ]},
        {'path': 'README.md', 'matches': [
            match('', 16, 'Colours are **never** written inline. Components consume `ThemeTokens` from'),
        ]},
    ]
    total = sum(len(f['matches']) for f in files)
    return {
        'ok': True,
        'root': AURORA,
        'query': 'theme',
        'options': {'regex': False, 'caseSensitive': False, 'whole': False},
        'files': files,
        'totalMatches': total,
        'scannedFiles': 214,
        'scannedBytes': 486213,
        'truncated': False,
        'elapsedMs': 38,
    }


def make_diff():
    old = THEME_OLD.splitlines(keepends=True)
    new = THEME_TS.splitlines(keepends=True)
    body = ''.join(difflib.unified_diff(old, new, fromfile='a/src/theme.ts', tofile='b/src/theme.ts', n=3, lineterm='\n'))
    header = 'diff --git a/src/theme.ts b/src/theme.ts\nindex 8a1c2f3..4d9e0b1 100644\n'
    return header + body


COMMIT_DIFF = make_diff()

COMMITS = [
    ('9f3c1a7', 'feat(theme): add semantic token palette', 'Ada Lovelace', '2026-11-10T18:42:00+08:00',
     ['HEAD -> feature/aurora-theme', 'origin/feature/aurora-theme']),
    ('4b8e2d0', 'fix(theme): align chart grid with token contract', 'Ada Lovelace', '2026-11-10T17:05:00+08:00', []),
    ('c2d7f41', 'docs(theme): document the token contract', 'Grace Hopper', '2026-11-10T15:20:00+08:00', []),
    ('7a5e9b3', 'refactor(api): cache the mock metric series', 'Grace Hopper', '2026-11-09T20:11:00+08:00', []),
    ('e0f6c28', 'test(theme): snapshot the three token modes', 'Alan Turing', '2026-11-09T16:48:00+08:00', []),
    ('1d9a4b6', 'chore(release): v0.4.0', 'Ada Lovelace', '2026-11-08T14:02:00+08:00', ['tag: v0.4.0']),
    ('58c2e70', 'feat(chart): stacked area baseline', 'Grace Hopper', '2026-11-08T11:37:00+08:00', []),
    ('ab3d1f9', 'chore: scaffold the aurora dashboard', 'Ada Lovelace', '2026-11-07T10:15:00+08:00', []),
]


def git_payload(kind):
    if kind == 'status':
        return {
            'ok': True, 'repo': True, 'root': AURORA,
            'branch': 'feature/aurora-theme',
            'upstream': 'origin/feature/aurora-theme',
            'ahead': 3, 'behind': 0, 'clean': False,
            'files': [
                {'path': 'src/theme.ts', 'index': 'M', 'worktree': ' ', 'status': 'M '},
                {'path': 'src/components/Chart.tsx', 'index': ' ', 'worktree': 'M', 'status': ' M'},
                {'path': 'src/app.tsx', 'index': ' ', 'worktree': 'M', 'status': ' M'},
                {'path': 'docs/theming.md', 'index': ' ', 'worktree': '?', 'status': '??'},
            ],
            'counts': {'staged': 1, 'unstaged': 2, 'untracked': 1, 'conflicted': 0},
        }
    if kind == 'log':
        return {'ok': True, 'repo': True, 'commits': [
            {'hash': h, 'short': h[:7], 'author': author, 'date': date, 'subject': subject, 'refs': refs}
            for h, subject, author, date, refs in COMMITS
        ]}
    if kind == 'diff':
        return {'ok': True, 'repo': True, 'path': 'src/theme.ts', 'staged': False,
                'commit': COMMITS[0][0], 'diff': COMMIT_DIFF, 'truncated': False}
    if kind == 'branches':
        return {'ok': True, 'repo': True, 'current': 'feature/aurora-theme', 'branches': [
            {'name': 'feature/aurora-theme', 'current': True, 'remote': False},
            {'name': 'main', 'current': False, 'remote': False},
        ]}
    return {'ok': True, 'repo': True}


def mock_data(git_empty: bool):
    workspaces = [
        {'id': 'ws-aurora', 'path': AURORA, 'title': 'aurora-dashboard', 'sessionCount': 4,
         'live': not git_empty, 'git': True},
        {'id': 'ws-design', 'path': DESIGN, 'title': 'design-system', 'sessionCount': 2,
         'live': False, 'git': True},
        {'id': 'ws-docs', 'path': AURORA + '/docs-site', 'title': 'docs-site', 'sessionCount': 1,
         'live': False, 'git': False},
    ]
    if git_empty:
        workspaces.insert(0, {'id': 'ws-docs', 'path': AURORA + '/docs-site', 'title': 'docs-site',
                              'sessionCount': 1, 'live': True, 'git': False})
        workspaces = workspaces[:3]
    return {
        'workspaces': workspaces,
        'entries': ENTRIES,
        'files': {path: {'content': meta['content'], 'language': meta['language'], 'size': file_size(path)}
                  for path, meta in FILES.items()},
        'search': search_results(),
        'images': {
            'public/hero.png': {
                'mime': 'image/png',
                'size': len(HERO_PNG),
                'base64': base64.b64encode(HERO_PNG).decode('ascii'),
            },
        },
        'git': {k: git_payload(k) for k in ('status', 'log', 'diff', 'branches')},
        'gitEmpty': git_empty,
    }


# ─── HTML template ─────────────────────────────────────────────────────────
HTML = r'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-workspace-ide screenshot</title>
<style>
  html, body { margin: 0; height: 100%; }
  body {
    background: radial-gradient(120% 140% at 20% 0%, #f2f5fb 0%, #e7ecf4 55%, #dfe6f0 100%);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  #stage { padding: 20px; box-sizing: border-box; }
  #window {
    width: __W__px; height: __H__px; box-sizing: border-box;
    display: flex; flex-direction: column; overflow: hidden;
    border-radius: 12px; border: 1px solid rgba(15, 23, 42, 0.10);
    background: #ffffff; box-shadow: 0 24px 64px rgba(15, 23, 42, 0.20);
  }
  #titlebar {
    height: 36px; flex: none; display: flex; align-items: center; gap: 8px;
    padding: 0 14px; background: #f7f8fa; border-bottom: 1px solid #e7eaf0;
  }
  .dot { width: 11px; height: 11px; border-radius: 50%; flex: none; }
  .dot-r { background: #ff5f57; } .dot-y { background: #febc2e; } .dot-g { background: #28c840; }
  #title { margin-left: 8px; font-size: 12px; color: #667085; white-space: nowrap; }
  #host { position: relative; flex: 1 1 auto; min-height: 0; background: #ffffff; }
  body[data-chrome="dark"] { background: radial-gradient(120% 140% at 20% 0%, #1b2130 0%, #121722 60%, #0b0f17 100%); }
  body[data-chrome="dark"] #window { border-color: rgba(255, 255, 255, 0.08); background: #1e1e1e; box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55); }
  body[data-chrome="dark"] #titlebar { background: #252526; border-bottom-color: #333338; }
  body[data-chrome="dark"] #host { background: #1e1e1e; }
  body[data-chrome="dark"] #title { color: #9aa4b2; }
</style>
</head>
<body>
<div id="stage">
  <div id="window">
    <div id="titlebar">
      <span class="dot dot-r"></span><span class="dot dot-y"></span><span class="dot dot-g"></span>
      <span id="title">aurora-dashboard — Workspace IDE · demo data (mock)</span>
    </div>
    <div id="host"></div>
  </div>
</div>
<script>__REACT__</script>
<script>__REACT_DOM__</script>
<script>window.__ModuleLoader__ = { load: function (definition) { window.__IDE_DEF__ = definition; } };</script>
<script>__CLIENT__</script>
<script>__DRIVER__</script>
</body>
</html>
'''

DRIVER = r'''
(function () {
  var params = new URLSearchParams(location.search);
  var SHOT = params.get('shot') || 'files';
  var MOCK = __MOCK__;
  var THEME_BY_SHOT = {
    files: 'light-plus', search: 'light-plus', git: 'one-dark-pro',
    'theme-dark': 'one-dark-pro', 'theme-light': 'light-plus', themes: 'light-plus', 'git-empty': 'light-plus', markdown: 'light-plus', image: 'light-plus', svg: 'light-plus'
  };
  var DARK_CHROME = ['git', 'theme-dark'];
  if (DARK_CHROME.indexOf(SHOT) !== -1) document.body.setAttribute('data-chrome', 'dark');

  var store = {};
  store['dsh-workspace-ide:theme'] = THEME_BY_SHOT[SHOT] || 'light-plus';
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
      setItem: function (key, value) { store[key] = String(value); },
      removeItem: function (key) { delete store[key]; }
    }
  });

  var React = window.React;
  var ReactDOM = window.ReactDOM;
  var S = window.__IDE_DEF__.factory(function (name) {
    if (name === 'react') return React;
    throw new Error('unexpected require: ' + name);
  });
  var seam = S.__test();
  var Shell = seam.Shell;
  var I18N = seam.I18N;
  function translate(key, values) {
    var text = I18N.zh[key];
    if (typeof text !== 'string') text = (I18N.en && I18N.en[key]) || key;
    if (values) Object.keys(values).forEach(function (name) {
      text = text.split('{' + name + '}').join(String(values[name]));
    });
    return text;
  }
  var t = function (key, values) { return translate(key, values); };

  function ok(body) {
    return Promise.resolve({
      ok: true, status: 200,
      json: function () { return Promise.resolve(body); },
      text: function () { return Promise.resolve(JSON.stringify(body)); }
    });
  }
  function mockFile(path) {
    var meta = MOCK.files[path];
    if (!meta) return { ok: false, error: { code: 'not-found', message: 'no mock file ' + path } };
    return {
      ok: true, root: MOCK.workspaces[0].path, path: path,
      absolutePath: MOCK.workspaces[0].path + '/' + path,
      size: meta.size, mtimeMs: 1762401000000, binary: false, truncated: false,
      content: meta.content, language: meta.language
    };
  }
  function mockImage(path) {
    var image = MOCK.images[path];
    if (!image) return { ok: false, error: { code: 'unsupported-image', message: 'no mock image ' + path } };
    return {
      ok: true, root: MOCK.workspaces[0].path, path: path,
      absolutePath: MOCK.workspaces[0].path + '/' + path,
      size: image.size, mtimeMs: 1762401000000, mime: image.mime, base64: image.base64
    };
  }
  function mockGit(query) {
    if (MOCK.gitEmpty) return { ok: true, repo: false };
    var kind = query.get('kind') || 'status';
    return MOCK.git[kind] || { ok: true, repo: true };
  }
  window.fetch = function (input) {
    var raw = typeof input === 'string' ? input : (input && input.url) || '';
    var url = new URL(raw, 'http://mock.local');
    var name = url.pathname.split('.').pop();
    var query = url.searchParams;
    switch (name) {
      case 'workspaces': return ok({ ok: true, workspaces: MOCK.workspaces });
      case 'list': return ok({
        ok: true, root: query.get('root'), path: query.get('path') || '',
        entries: MOCK.entries[query.get('path') || ''] || [], truncated: false
      });
      case 'file': return ok(mockFile(query.get('path') || ''));
      case 'image': return ok(mockImage(query.get('path') || ''));
      case 'search': return ok(MOCK.search);
      case 'git': return ok(mockGit(query));
      case 'save': return ok({ ok: true, path: query.get('path') || '', size: 1, mtimeMs: 1762401000000 });
      case 'ping': return ok({ ok: true });
      default: return ok({ ok: true });
    }
  };

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }
  function waitFor(fn, timeout) {
    var limit = timeout || 6000;
    var start = Date.now();
    return new Promise(function (resolve, reject) {
      (function poll() {
        var value;
        try { value = fn(); } catch (error) { value = null; }
        if (value) return resolve(value);
        if (Date.now() - start > limit) return reject(new Error('timeout waiting for UI'));
        setTimeout(poll, 30);
      })();
    });
  }
  function q(selector) { return document.querySelector(selector); }
  function click(element) {
    if (!element) throw new Error('missing element to click');
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return sleep(90);
  }
  function clickTab(id) {
    return waitFor(function () { return q('[data-tab="' + id + '"]'); }).then(click);
  }
  function openFile(path) {
    var parts = path.split('/');
    var chain = Promise.resolve();
    parts.slice(0, -1).forEach(function (_, index) {
      var dir = parts.slice(0, index + 1).join('/');
      chain = chain.then(function () {
        return waitFor(function () { return q('[data-path="' + dir + '"][data-type="dir"]'); });
      }).then(function (row) {
        if (row.getAttribute('aria-expanded') !== 'true') return click(row);
        return null;
      }).then(function () { return sleep(140); });
    });
    return chain.then(function () {
      return waitFor(function () { return q('[data-path="' + path + '"]'); });
    }).then(click).then(function () {
      return waitFor(function () { return q('[data-ide-highlight]') || q('textarea'); });
    }).then(function () { return sleep(350); });
  }
  function runSearch(query) {
    return clickTab('search').then(function () {
      return waitFor(function () {
        var inputs = document.querySelectorAll('input');
        return inputs.length > 0 ? inputs[0] : null;
      });
    }).then(function (input) {
      var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, query);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return sleep(160);
    }).then(function () {
      var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
      var button = buttons.filter(function (item) { return (item.textContent || '').trim() === '搜索'; })[0];
      if (!button) throw new Error('search button not found');
      return click(button);
    }).then(function () {
      return waitFor(function () { return q('mark'); }, 8000);
    }).then(function () { return sleep(320); });
  }
  function openGitHistory() {
    return clickTab('git').then(function () {
      return waitFor(function () { return q('[data-git-tab="history"]'); });
    }).then(function () { return click(q('[data-git-tab="history"]')); })
      .then(function () { return waitFor(function () { return q('[data-hash]'); }); })
      .then(function () { return click(q('[data-hash]')); })
      .then(function () { return waitFor(function () { return q('[data-kind]'); }); })
      .then(function () { return sleep(360); });
  }
  function openThemePicker() {
    return waitFor(function () { return q('[data-theme-button]'); })
      .then(click)
      .then(function () { return waitFor(function () { return q('[role="listbox"]'); }); })
      .then(function () { return sleep(320); });
  }
  function openGitEmpty() {
    return clickTab('git').then(function () {
      return waitFor(function () { return document.body.textContent.indexOf('这不是 Git 仓库') !== -1; });
    }).then(function () { return sleep(360); });
  }

  var host = document.getElementById('host');
  var root = ReactDOM.createRoot(host);
  root.render(React.createElement(Shell, { t: t }));

  var tasks = {
    files: function () { return openFile('src/app.tsx'); },
    search: function () { return runSearch('theme'); },
    git: function () { return openGitHistory(); },
    'theme-dark': function () { return openFile('src/theme.ts'); },
    'theme-light': function () { return openFile('src/components/Chart.tsx'); },
    themes: function () { return openFile('src/app.tsx').then(openThemePicker); },
    markdown: function () {
      return openFile('README.md')
        .then(function () { return waitFor(function () { return q('[data-md-mode="preview"]'); }); })
        .then(function () { return click(q('[data-md-mode="preview"]')); })
        .then(function () { return waitFor(function () { return q('[data-md-preview]'); }); })
        .then(function () { return sleep(400); });
    },
    image: function () {
      return openFile('public/hero.png')
        .then(function () { return waitFor(function () { return q('[data-image-preview]'); }); })
        .then(function () { return sleep(400); });
    },
    svg: function () {
      return openFile('public/logo.svg')
        .then(function () { return waitFor(function () { return q('[data-svg-image]'); }); })
        .then(function () { return sleep(400); });
    },
    'git-empty': function () { return openGitEmpty(); }
  };

  waitFor(function () { return q('[data-tab="files"]'); }, 9000)
    .then(function () { return sleep(420); })
    .then(tasks[SHOT] || tasks.files)
    .then(function () { document.title = 'READY'; })
    .catch(function (error) {
      document.title = 'ERROR: ' + (error && error.message);
      if (window.console) console.error(error);
    });
})();
'''

SHOTS = [
    ('files', 'screenshot-files.png'),
    ('search', 'screenshot-search.png'),
    ('git', 'screenshot-git.png'),
    ('theme-dark', 'screenshot-theme-dark.png'),
    ('theme-light', 'screenshot-theme-light.png'),
    ('themes', 'screenshot-themes.png'),
    ('markdown', 'screenshot-markdown.png'),
    ('image', 'screenshot-image.png'),
    ('svg', 'screenshot-svg.png'),
    ('git-empty', 'screenshot-git-empty.png'),
]


def build_html(react, react_dom, shot: str) -> str:
    html = HTML
    html = html.replace('__W__', str(WINDOW_W)).replace('__H__', str(WINDOW_H))
    html = html.replace('__REACT__', react)
    html = html.replace('__REACT_DOM__', react_dom)
    html = html.replace('__CLIENT__', CLIENT)
    driver = DRIVER.replace('__MOCK__', json.dumps(mock_data(git_empty=(shot == 'git-empty')), ensure_ascii=False))
    html = html.replace('__DRIVER__', driver)
    return html


def run_chrome(html_path: Path, png_path: Path):
    cmd = [
        CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
        '--no-first-run', '--no-default-browser-check', '--disable-extensions',
        '--force-device-scale-factor=2',
        '--window-size=1240,880',
        '--virtual-time-budget=12000',
        '--screenshot=' + str(png_path),
        html_path.as_uri() + '?shot=files',  # replaced per call
    ]
    cmd[-2] = '--screenshot=' + str(png_path)
    subprocess.run(cmd, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)


def main():
    react = fetch_umd(REACT_URL, 'react.prod.js')
    react_dom = fetch_umd(REACT_DOM_URL, 'react-dom.prod.js')
    DOCS_DIR.mkdir(exist_ok=True)
    for shot, filename in SHOTS:
        html_path = OUT / (shot + '.html')
        html_path.write_text(build_html(react, react_dom, shot))
        raw = OUT / (shot + '.raw.png')
        cmd = [
            CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
            '--no-first-run', '--no-default-browser-check', '--disable-extensions',
            '--force-device-scale-factor=2', '--window-size=1240,880',
            '--virtual-time-budget=12000', '--screenshot=' + str(raw),
            html_path.as_uri() + '?shot=' + shot,
        ]
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
        if not raw.exists() or raw.stat().st_size < 5000:
            raise SystemExit('screenshot failed for ' + shot)
        image = Image.open(raw)
        if shot == 'files':
            toolbar = image.crop((40, 112, 40 + WINDOW_W * 2, 112 + 46 * 2))
            toolbar.resize((1800, int(toolbar.height * 1800 / toolbar.width)), Image.LANCZOS).save(
                DOCS_DIR / 'screenshot-toolbar.png')
        width = 1800
        resized = image.resize((width, int(image.height * width / image.width)), Image.LANCZOS)
        resized.save(DOCS_DIR / filename)
        print('wrote', DOCS_DIR / filename, resized.size)


if __name__ == '__main__':
    sys.exit(main())
