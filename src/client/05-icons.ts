/**
 * Icon set — Lucide (https://lucide.dev, ISC; some glyphs derive from Feather,
 * MIT). The SVG node data below is vendored at authoring time from
 * lucide-static v0.460.0 instead of being required at runtime, so the client
 * bundle stays one plain-JS module whose only dependency is `react`. License
 * texts: THIRD_PARTY_NOTICES.md and licenses/lucide-LICENSE.txt.
 *
 * Every icon renders through one shared factory: 24x24 viewBox, round caps,
 * `currentColor` stroke, so the toolbar, tree and badges share a single visual
 * language and follow the DSH theme tokens that set the surrounding colour.
 */

/** Props every generated icon component accepts. */
interface IconProps {
  size?: number;
  active?: boolean;
}

/** Rendering overrides for one generated icon. */
interface IconOptions {
  strokeWidth?: number;
  fill?: boolean;
  stroke?: string;
  defaultSize?: number;
}

/** Lucide SVG node pairs (`[tagName, attributes]`). */
type LucideArc = [string, Record<string, any>];

/** React component produced by {@link makeIcon}. */
type IconComponent = import('react').FunctionComponent<IconProps>;

const LUCIDE_ICONS: Record<string, LucideArc[]> = Object.freeze({
  'files': [
    ['path', { 'd': "M20 7h-3a2 2 0 0 1-2-2V2" }],
    ['path', { 'd': "M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z" }],
    ['path', { 'd': "M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8" }],
  ],
  'text-search': [
    ['path', { 'd': "M21 6H3" }],
    ['path', { 'd': "M10 12H3" }],
    ['path', { 'd': "M10 18H3" }],
    ['circle', { 'cx': 17, 'cy': 15, 'r': 3 }],
    ['path', { 'd': "m21 19-1.9-1.9" }],
  ],
  'git-branch': [
    ['line', { 'x1': 6, 'x2': 6, 'y1': 3, 'y2': 15 }],
    ['circle', { 'cx': 18, 'cy': 6, 'r': 3 }],
    ['circle', { 'cx': 6, 'cy': 18, 'r': 3 }],
    ['path', { 'd': "M18 9a9 9 0 0 1-9 9" }],
  ],
  'folder': [
    ['path', { 'd': "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" }],
  ],
  'file': [
    ['path', { 'd': "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }],
    ['path', { 'd': "M14 2v4a2 2 0 0 0 2 2h4" }],
  ],
  'chevron-right': [
    ['path', { 'd': "m9 18 6-6-6-6" }],
  ],
  'refresh-cw': [
    ['path', { 'd': "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }],
    ['path', { 'd': "M21 3v5h-5" }],
    ['path', { 'd': "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }],
    ['path', { 'd': "M8 16H3v5" }],
  ],
  'save': [
    ['path', { 'd': "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" }],
    ['path', { 'd': "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" }],
    ['path', { 'd': "M7 3v4a1 1 0 0 0 1 1h7" }],
  ],
  'x': [
    ['path', { 'd': "M18 6 6 18" }],
    ['path', { 'd': "m6 6 12 12" }],
  ],
  'triangle-alert': [
    ['path', { 'd': "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" }],
    ['path', { 'd': "M12 9v4" }],
    ['path', { 'd': "M12 17h.01" }],
  ],
  'lock': [
    ['rect', { 'width': 18, 'height': 11, 'x': 3, 'y': 11, 'rx': 2, 'ry': 2 }],
    ['path', { 'd': "M7 11V7a5 5 0 0 1 10 0v4" }],
  ],
  'circle': [
    ['circle', { 'cx': 12, 'cy': 12, 'r': 10 }],
  ],
  'loader-circle': [
    ['path', { 'd': "M21 12a9 9 0 1 1-6.219-8.56" }],
  ],
  'folder-tree': [
    ['path', { 'd': "M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" }],
    ['path', { 'd': "M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" }],
    ['path', { 'd': "M3 5a2 2 0 0 0 2 2h3" }],
    ['path', { 'd': "M3 3v13a2 2 0 0 0 2 2h3" }],
  ],
  // Added for the colour-theme picker (same lucide-static v0.460.0 source).
  'palette': [
    ['circle', { 'cx': 13.5, 'cy': 6.5, 'r': 0.5, 'fill': 'currentColor' }],
    ['circle', { 'cx': 17.5, 'cy': 10.5, 'r': 0.5, 'fill': 'currentColor' }],
    ['circle', { 'cx': 8.5, 'cy': 7.5, 'r': 0.5, 'fill': 'currentColor' }],
    ['circle', { 'cx': 6.5, 'cy': 12.5, 'r': 0.5, 'fill': 'currentColor' }],
    ['path', { 'd': "M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" }],
  ],
  'check': [
    ['path', { 'd': "M20 6 9 17l-5-5" }],
  ],
  'wrap-text': [
    ['path', { 'd': "M3 6h18" }],
    ['path', { 'd': "M3 12h15a3 3 0 1 1 0 6h-4" }],
    ['path', { 'd': "m16 16-2 2 2 2" }],
    ['path', { 'd': "M3 18h7" }],
  ],
  'list': [
    ['line', { 'x1': 8, 'x2': 21, 'y1': 6, 'y2': 6 }],
    ['line', { 'x1': 8, 'x2': 21, 'y1': 12, 'y2': 12 }],
    ['line', { 'x1': 8, 'x2': 21, 'y1': 18, 'y2': 18 }],
    ['line', { 'x1': 3, 'x2': 3.01, 'y1': 6, 'y2': 6 }],
    ['line', { 'x1': 3, 'x2': 3.01, 'y1': 12, 'y2': 12 }],
    ['line', { 'x1': 3, 'x2': 3.01, 'y1': 18, 'y2': 18 }],
  ],
  'hash': [
    ['line', { 'x1': 4, 'x2': 20, 'y1': 9, 'y2': 9 }],
    ['line', { 'x1': 4, 'x2': 20, 'y1': 15, 'y2': 15 }],
    ['line', { 'x1': 10, 'x2': 8, 'y1': 3, 'y2': 21 }],
    ['line', { 'x1': 16, 'x2': 14, 'y1': 3, 'y2': 21 }],
  ],
});

/** Rendered pixel size from owner props, falling back when absent. */
function iconSize(props: IconProps | null | undefined, fallback?: number): number {
  const size = typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0 ? fallback : 16;
  if (props !== null && props !== undefined && Number.isFinite(props.size) && props.size! > 0) return props.size!;
  return size;
}

/** Whether the owner marked the icon as active (selected tab). */
function iconActive(props: IconProps | null | undefined): boolean {
  return props !== null && props !== undefined && props.active === true;
}

/** Lucide's default stroke width on the 24px grid. */
const ICON_STROKE = 2;
/** Slightly heavier stroke for the selected toolbar tab. */
const ICON_STROKE_ACTIVE = 2.25;

/** Render one vendored Lucide icon. */
function renderLucide(name: string, props: IconProps | null | undefined, options?: IconOptions): any {
  const conf: IconOptions = options !== null && typeof options === 'object' ? options : {};
  const nodes = LUCIDE_ICONS[name];
  const size = iconSize(props, conf.defaultSize);
  const active = iconActive(props);
  const filled = conf.fill === true;
  const stroked = conf.stroke !== 'none';
  const strokeWidth = Number.isFinite(conf.strokeWidth)
    ? conf.strokeWidth
    : (active ? ICON_STROKE_ACTIVE : ICON_STROKE);
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: filled ? 'currentColor' : 'none',
      stroke: stroked ? 'currentColor' : 'none',
      strokeWidth: stroked ? strokeWidth : 0,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
      style: { display: 'block', flex: '0 0 auto' },
    },
    (nodes !== undefined && nodes !== null ? nodes : []).map(function (node: LucideArc, index: number) {
      const tag = String(node[0]);
      const attrs = node[1];
      return h(tag, Object.assign({ key: tag + '-' + String(index) }, attrs));
    }),
  );
}

/** Build one icon component from the registry. */
function makeIcon(name: string, options?: IconOptions): IconComponent {
  return function LucideIcon(props: IconProps) {
    return renderLucide(name, props, options);
  };
}

/** Sidebar rail icon: a workspace tree. */
const PanelIcon = makeIcon('folder-tree');

/** Files tab: stacked pages. */
const FilesIcon = makeIcon('files');

/** Search tab: text lines with a magnifier. */
const SearchIcon = makeIcon('text-search');

/** Git tab: the branch glyph. */
const GitIcon = makeIcon('git-branch');

/** Folder glyph for the tree. */
const FolderIcon = makeIcon('folder');

/** File glyph for the tree and result headers. */
const FileIcon = makeIcon('file');

/** Chevron for expanding tree rows (rotated by the caller when open). */
const ChevronIcon = makeIcon('chevron-right');

/** Refresh / re-read glyph. */
const RefreshIcon = makeIcon('refresh-cw');

/** Save glyph. */
const SaveIcon = makeIcon('save');

/** Dismiss glyph. */
const CloseIcon = makeIcon('x');

/** Error / alert glyph. */
const AlertIcon = makeIcon('triangle-alert');

/** Lock chip glyph for read-only files. */
const LockIcon = makeIcon('lock');

/** Small filled dot used for dirty / status markers. */
const DotIcon = makeIcon('circle', { fill: true, stroke: 'none', defaultSize: 9 });

/** Colour-theme picker trigger: a painter's palette. */
const PaletteIcon = makeIcon('palette');

/** Applied-theme marker in the theme popover. */
const CheckIcon = makeIcon('check');

/** Soft-wrap toggle in the editor toolbar. */
const WrapIcon = makeIcon('wrap-text');

/** Go-to-line action in the editor toolbar. */
const GoToLineIcon = makeIcon('hash');

/** Go-to-symbol action in the editor toolbar. */
const SymbolIcon = makeIcon('list');

/** Indeterminate spinner (SMIL, so no stylesheet is needed). */
function SpinnerIcon(props: IconProps): any {
  const size = iconSize(props, 14);
  const nodes = LUCIDE_ICONS['loader-circle'];
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2.2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: false,
      style: { display: 'block', flex: '0 0 auto' },
    },
    h(
      'g',
      null,
      (nodes !== undefined && nodes !== null ? nodes : []).map(function (node: LucideArc, index: number) {
        const tag = String(node[0]);
        const attrs = node[1];
        return h(tag, Object.assign({ key: 'arc-' + String(index) }, attrs));
      }),
      h('animateTransform', {
        key: 'spin',
        attributeName: 'transform',
        attributeType: 'XML',
        type: 'rotate',
        from: '0 12 12',
        to: '360 12 12',
        dur: '0.9s',
        repeatCount: 'indefinite',
      }),
    ),
  );
}

S.Icons = {
  PanelIcon: PanelIcon,
  Files: FilesIcon,
  Search: SearchIcon,
  Git: GitIcon,
  Folder: FolderIcon,
  File: FileIcon,
  Chevron: ChevronIcon,
  Refresh: RefreshIcon,
  Save: SaveIcon,
  Close: CloseIcon,
  Alert: AlertIcon,
  Lock: LockIcon,
  Dot: DotIcon,
  Palette: PaletteIcon,
  Check: CheckIcon,
  Wrap: WrapIcon,
  GoToLine: GoToLineIcon,
  Symbol: SymbolIcon,
  Spinner: SpinnerIcon,
};
