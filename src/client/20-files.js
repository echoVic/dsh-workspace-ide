/**
 * dsh-workspace-ide — client half, the Files surface.
 *
 * Left: a lazily-loaded workspace tree (directories expand on demand, the root
 * starts expanded) with a draggable splitter. Right: a code viewer with a line
 * gutter, an editable textarea, Ctrl/Cmd+S save, Esc discard, read-only mode
 * for very large / truncated files and a binary notice. A search hit reaches
 * this view through `openRequest` and lands with the requested line selected.
 */

/**
 * The textarea API normalizes CRLF to LF, so the editor always works on LF and
 * the save path restores the file's original line ending. Without this a
 * Windows-checked-out file would be silently rewritten with LF endings merely
 * because it was opened and saved.
 */
function normalizeEol(text) {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n') : '';
}

/** @param {string} text - LF text. @param {string} eol - original line ending. @returns {string} text in that ending. */
function applyEol(text, eol) {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

/** @param {string} text - raw file content. @returns {string} the detected line ending. */
function detectEol(text) {
  return typeof text === 'string' && text.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
}

/**
 * @typedef {Object} TreeEntry
 * @property {string} name
 * @property {string} path
 * @property {string} type
 * @property {number} [size]
 * @property {number} [mtimeMs]
 * @property {boolean} [hidden]
 */
/**
 * @typedef {{width: number, height: number}} ImageDimensions
 */
/**
 * @typedef {Object} FileState
 * @property {string} status
 * @property {any} data
 * @property {string} [eol]
 * @property {any} error
 */
/**
 * @typedef {Object} OpenRequest
 * @property {string} [path]
 * @property {number} [line]
 * @property {number} [token]
 */

const ST_FILES = {
  mdToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    padding: 2,
    borderRadius: 6,
    background: C.platform,
    flex: '0 0 auto',
  },
  mdToggleButton: {
    border: 'none',
    background: 'transparent',
    color: C.textSecondary,
    fontFamily: S.FONT_UI,
    fontSize: 11.5,
    lineHeight: '20px',
    padding: '0 9px',
    borderRadius: 4,
    cursor: 'pointer',
  },
  mdToggleActive: {
    background: C.layer2,
    color: C.text,
  },
  imageScroll: {
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    background: C.base,
    backgroundImage:
      'repeating-conic-gradient(' + C.layer1 + ' 0% 25%, ' + C.base + ' 0% 50%)',
    backgroundSize: '20px 20px',
  },
  image: {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    background: C.base,
  },
  treePane: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
    background: C.base,
  },
  treeHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 30,
    flex: '0 0 auto',
    padding: '0 6px 0 12px',
    color: C.textTertiary,
    boxSizing: 'border-box',
  },
  treeHeaderTitle: {
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: '0.07em',
    color: C.textTertiary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 190,
  },
  treeBody: {
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'auto',
    padding: '2px 0 14px',
  },
  treeStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '7px 12px',
    color: C.textTertiary,
    fontSize: 11.5,
  },
  treeError: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px 6px 12px',
    color: C.error,
    fontSize: 11.5,
    lineHeight: '16px',
  },
  treeEmpty: {
    padding: '5px 12px 5px 30px',
    color: C.textTertiary,
    fontSize: 11.5,
    fontStyle: 'italic',
  },
  treeTruncated: {
    padding: '6px 12px',
    color: C.warnLabel,
    fontSize: 11,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    height: 24,
    paddingRight: 8,
    cursor: 'pointer',
    color: C.text,
    fontSize: 12.5,
    whiteSpace: 'nowrap',
    boxSizing: 'border-box',
    borderRadius: 4,
    margin: '0 6px',
    userSelect: 'none',
  },
  rowHover: {
    background: C.hover,
  },
  rowActive: {
    background: C.activeBg,
    color: C.text,
  },
  chevron: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 12,
    height: 12,
    flex: '0 0 auto',
    color: C.textTertiary,
  },
  rowIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 14,
    flex: '0 0 auto',
    color: C.textTertiary,
  },
  rowIconDir: {
    color: C.accent,
  },
  rowName: {
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  rowNameHidden: {
    color: C.textTertiary,
  },
  viewer: {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    height: '100%',
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
    background: C.base,
  },
  viewerHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    height: 38,
    flex: '0 0 auto',
    padding: '0 12px',
    boxSizing: 'border-box',
    borderBottom: '1px solid ' + C.border2,
    background: C.base,
    minWidth: 0,
  },
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    minWidth: 0,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    fontFamily: FONT_UI,
    fontSize: 12.5,
  },
  crumb: {
    color: C.textTertiary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  crumbLast: {
    color: C.text,
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  crumbSep: {
    color: C.textTertiary,
    opacity: 0.6,
    padding: '0 1px',
  },
  dirtyBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    color: C.warnLabel,
    fontSize: 11,
    fontWeight: 500,
    flex: '0 0 auto',
  },
  meta: {
    color: C.textTertiary,
    fontSize: 11,
    whiteSpace: 'nowrap',
    flex: '0 0 auto',
  },
  editorWrap: {
    display: 'flex',
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
    background: C.base,
  },
  gutterWrap: {
    flex: '0 0 auto',
    width: 58,
    overflow: 'hidden',
    position: 'relative',
    background: C.base,
    borderRight: '1px solid ' + C.border2,
    boxSizing: 'border-box',
  },
  gutter: {
    margin: 0,
    padding: EDITOR_PADDING_TOP + 'px 9px 24px 0',
    fontFamily: FONT_MONO,
    fontSize: 11.5,
    lineHeight: EDITOR_LINE_HEIGHT + 'px',
    color: C.textTertiary,
    textAlign: 'right',
    userSelect: 'none',
    whiteSpace: 'pre',
    boxSizing: 'border-box',
  },
  textarea: {
    flex: '1 1 auto',
    minWidth: 0,
    height: '100%',
    margin: 0,
    padding: EDITOR_PADDING_TOP + 'px 16px 24px 12px',
    border: 'none',
    outline: 'none',
    resize: 'none',
    background: 'transparent',
    color: C.text,
    fontFamily: FONT_MONO,
    fontSize: 12.5,
    lineHeight: EDITOR_LINE_HEIGHT + 'px',
    tabSize: 2,
    whiteSpace: 'pre',
    fontVariantLigatures: 'none',
    fontKerning: 'none',
    overflow: 'auto',
    boxSizing: 'border-box',
    caretColor: C.accent,
    // Sits above the syntax layer so pointer events, selection and the caret
    // all behave exactly as a normal textarea.
    position: 'relative',
    zIndex: 1,
  },
  // The textarea that has a syntax layer behind it: the text is painted by the
  // layer, so the textarea's own glyphs go transparent while the caret and the
  // (semi-transparent) selection stay visible.
  textareaHighlighting: {
    color: 'transparent',
    caretColor: C.text,
  },
  // The right-hand column of the editor: the syntax layer (absolute, clipped,
  // pointer-transparent) and the textarea share this box, which is what makes
  // the character grid line up.
  codeRegion: {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    minWidth: 0,
    height: '100%',
    position: 'relative',
    overflow: 'hidden',
    background: C.base,
  },
  syntaxLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: 0,
  },
  // Identical metrics to `textarea` below (font, size, line-height, padding,
  // tab-size, `white-space: pre`): the pre is scrolled with a transform that
  // mirrors the textarea's scrollTop/scrollLeft.
  syntaxCode: {
    margin: 0,
    padding: EDITOR_PADDING_TOP + 'px 16px 24px 12px',
    fontFamily: FONT_MONO,
    fontSize: 12.5,
    lineHeight: EDITOR_LINE_HEIGHT + 'px',
    color: C.text,
    whiteSpace: 'pre',
    tabSize: 2,
    // No ligatures or kerning on either glyph pass: the <pre> must keep the
    // exact character grid of the textarea or the colours drift from the text.
    fontVariantLigatures: 'none',
    fontKerning: 'none',
    boxSizing: 'border-box',
    willChange: 'transform',
  },
  readOnlyScroll: {
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'auto',
    background: C.base,
  },
  readOnlyInner: {
    display: 'flex',
    alignItems: 'flex-start',
    minWidth: 'max-content',
  },
  readOnlyGutter: {
    margin: 0,
    padding: EDITOR_PADDING_TOP + 'px 9px 24px 0',
    width: 58,
    flex: '0 0 auto',
    position: 'sticky',
    left: 0,
    zIndex: 1,
    fontFamily: FONT_MONO,
    fontSize: 11.5,
    lineHeight: EDITOR_LINE_HEIGHT + 'px',
    color: C.textTertiary,
    textAlign: 'right',
    userSelect: 'none',
    whiteSpace: 'pre',
    background: C.base,
    borderRight: '1px solid ' + C.border1,
    boxSizing: 'border-box',
  },
  readOnlyCode: {
    margin: 0,
    padding: EDITOR_PADDING_TOP + 'px 16px 24px 12px',
    fontFamily: FONT_MONO,
    fontSize: 12.5,
    lineHeight: EDITOR_LINE_HEIGHT + 'px',
    color: C.text,
    whiteSpace: 'pre',
    tabSize: 2,
    boxSizing: 'border-box',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    height: 24,
    flex: '0 0 auto',
    padding: '0 12px',
    boxSizing: 'border-box',
    borderTop: '1px solid ' + C.border2,
    background: C.base,
    color: C.textTertiary,
    fontSize: 11,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  statusHint: {
    color: C.warnLabel,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
};

/**
 * @param {string} text - file text.
 * @returns {number} number of lines (1 for an empty file, 0 only for null).
 */
function countLines(text) {
  if (typeof text !== 'string') return 0;
  if (text.length === 0) return 1;
  let lines = 1;
  let index = text.indexOf('\n');
  while (index !== -1) {
    lines = lines + 1;
    index = text.indexOf('\n', index + 1);
  }
  return lines;
}

/**
 * @param {number} count - line count.
 * @returns {string} newline-separated right-aligned line numbers (one <pre>).
 */
function lineNumbersText(count) {
  const total = Math.max(1, Number.isFinite(count) ? Math.floor(count) : 1);
  const rows = [];
  for (let line = 1; line <= total; line = line + 1) rows.push(String(line));
  return rows.join('\n');
}

/**
 * True when the highlighter only produced plain text segments (the `text`
 * language, an unknown language or an oversized source). The viewer then skips
 * the syntax layer entirely and paints the raw value, which keeps huge files
 * cheap.
 *
 * @param {Array<Array<Array<string>>>} lines - highlightLines output.
 * @returns {boolean} true when nothing needs a coloured span.
 */
function isPlainHighlight(lines) {
  if (!Array.isArray(lines)) return true;
  for (let index = 0; index < lines.length; index = index + 1) {
    const segments = lines[index];
    if (!Array.isArray(segments) || segments.length === 0) continue;
    if (segments.length > 1) return false;
    if (segments[0][0] !== 'plain') return false;
  }
  return true;
}

/**
 * Turn highlightLines output into plain React children: text nodes for `plain`
 * segments and one `<span style="color: var(--ide-tok-*)">` per coloured segment.
 * Nothing is ever interpreted as HTML, and the concatenation of the children is
 * byte-for-byte the source text.
 *
 * @param {Array<Array<Array<string>>>} lines - highlightLines output.
 * @returns {Array} React children for a `<pre>`.
 */
function renderSyntaxChildren(lines) {
  const children = [];
  if (!Array.isArray(lines)) return children;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex = lineIndex + 1) {
    if (lineIndex > 0) children.push('\n');
    const segments = lines[lineIndex];
    if (!Array.isArray(segments)) continue;
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex = segmentIndex + 1) {
      const segment = segments[segmentIndex];
      if (!Array.isArray(segment) || typeof segment[1] !== 'string' || segment[1].length === 0) continue;
      if (segment[0] === 'plain') {
        children.push(segment[1]);
        continue;
      }
      children.push(
        h(
          'span',
          { key: 'syntax:' + String(lineIndex) + ':' + String(segmentIndex), style: { color: S.highlightColor(segment[0]) } },
          segment[1],
        ),
      );
    }
  }
  return children;
}

/**
 * @param {string} text - file text.
 * @param {number} index - UTF-16 offset.
 * @returns {{line: number, column: number}} 1-based caret location.
 */
function caretFromIndex(text, index) {
  const value = typeof text === 'string' ? text : '';
  const position = Number.isFinite(index) ? clampNumber(Math.floor(index), 0, value.length) : 0;
  let line = 1;
  let lineStart = 0;
  for (let cursor = 0; cursor < position; cursor = cursor + 1) {
    if (value.charCodeAt(cursor) === 10) {
      line = line + 1;
      lineStart = cursor + 1;
    }
  }
  return { line: line, column: position - lineStart + 1 };
}

/** @param {TreeEntry} entry - list entry. @returns {boolean} keep it in the tree. */
function keepTreeEntry(entry) {
  if (entry === null || entry === undefined) return false;
  if (typeof entry.name !== 'string' || typeof entry.path !== 'string') return false;
  if (entry.name === '.git' || entry.name === '.DS_Store') return false;
  return true;
}

/** One clickable row in the workspace tree (pure). */
function FileTreeRow(props) {
  const [hover, setHover] = useState(false);
  const entry = props.entry;
  const isDir = entry.type === 'dir';
  const expanded = props.expanded === true;
  const active = props.active === true;
  const depth = Number.isFinite(props.depth) ? props.depth : 0;
  const style = Object.assign(
    {},
    ST_FILES.row,
    { paddingLeft: 8 + depth * 13 },
    active ? ST_FILES.rowActive : hover ? ST_FILES.rowHover : null,
  );
  return h(
    'div',
    {
      role: 'treeitem',
      'data-path': entry.path,
      'data-type': isDir ? 'dir' : 'file',
      'aria-expanded': isDir ? (expanded ? 'true' : 'false') : undefined,
      'aria-selected': active ? 'true' : 'false',
      title: entry.path,
      style: style,
      onClick: function () {
        if (isDir) {
          if (typeof props.onToggle === 'function') props.onToggle(entry);
        } else if (typeof props.onOpen === 'function') {
          // Opening from the tree does not jump to a line; only search hits and
          // cross-view navigations pass one.
          props.onOpen(entry.path);
        }
      },
      onMouseEnter: function () { setHover(true); },
      onMouseLeave: function () { setHover(false); },
    },
    h(
      'span',
      { style: ST_FILES.chevron, 'aria-hidden': true },
      isDir
        ? h('span', { style: { display: 'inline-flex', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease' } }, h(S.Icons.Chevron, { size: 10 }))
        : null,
    ),
    h('span', { style: Object.assign({}, ST_FILES.rowIcon, isDir ? ST_FILES.rowIconDir : null) }, h(isDir ? S.Icons.Folder : S.Icons.File, { size: 13 })),
    h('span', { style: Object.assign({}, ST_FILES.rowName, entry.hidden ? ST_FILES.rowNameHidden : null) }, entry.name),
  );
}

/** Recursive tree rows for one directory (pure; children only when expanded). */
function TreeDirRows(props) {
  const t = props.t;
  const node = props.tree[props.dirPath];
  if (node === undefined || node === null) return null;
  if (node.status === 'error') {
    return h(
      'div',
      { style: ST_FILES.treeError },
      h('span', { style: { flex: '1 1 auto', minWidth: 0 } }, t('files.tree.error', { message: S.errorText(node.error) })),
      h(
        S.ToolButton,
        {
          title: t('action.retry'),
          ariaLabel: t('action.retry'),
          style: { width: 22, height: 22 },
          onClick: function () {
            if (typeof props.onReloadDir === 'function') props.onReloadDir(props.dirPath);
          },
        },
        h(S.Icons.Refresh, { size: 12 }),
      ),
    );
  }
  if (node.status === 'loading') {
    return h('div', { style: ST_FILES.treeStatus }, h(S.Icons.Spinner, { size: 12 }), h('span', null, t('files.tree.loading')));
  }
  const entries = Array.isArray(node.entries) ? node.entries : [];
  if (entries.length === 0) return h('div', { style: ST_FILES.treeEmpty }, t('files.tree.empty'));
  const rows = [];
  entries.forEach(function (entry) {
    rows.push(
      h(FileTreeRow, {
        key: 'row:' + entry.path,
        entry: entry,
        depth: props.depth,
        expanded: props.expanded[entry.path] === true,
        active: props.selected === entry.path,
        onToggle: props.onToggle,
        onOpen: props.onOpen,
      }),
    );
    if (entry.type === 'dir' && props.expanded[entry.path] === true) {
      rows.push(
        h(TreeDirRows, {
          key: 'children:' + entry.path,
          t: t,
          tree: props.tree,
          expanded: props.expanded,
          selected: props.selected,
          onToggle: props.onToggle,
          onOpen: props.onOpen,
          onReloadDir: props.onReloadDir,
          dirPath: entry.path,
          depth: props.depth + 1,
        }),
      );
    }
  });
  return rows;
}

/**
 * Raster image pane: breadcrumb header, a centred preview over a checkerboard
 * surface, and a status bar with the natural dimensions once the image loads.
 * @param {{t: Function, path: string, src: string, mime: string, size: number, mtimeMs: number|null, dimensions: ImageDimensions|null, onDimensions: Function}} props - viewer props.
 */
function ImageViewer(props) {
  const t = props.t;
  const segments = typeof props.path === 'string' && props.path.length > 0 ? props.path.split('/') : [];
  const dimensions = props.dimensions !== null && props.dimensions !== undefined ? props.dimensions : null;
  const size = Number.isFinite(props.size) ? props.size : 0;
  const onImageLoad = function (event) {
    const target = event !== null && event !== undefined ? event.target : null;
    if (target === null || target === undefined) return;
    if (typeof props.onDimensions !== 'function') return;
    if (!Number.isFinite(target.naturalWidth) || !Number.isFinite(target.naturalHeight)) return;
    props.onDimensions({ width: target.naturalWidth, height: target.naturalHeight });
  };
  return h(
    'div',
    { style: ST_FILES.viewer },
    h(
      'div',
      { style: ST_FILES.viewerHeader },
      h(
        'div',
        { style: ST_FILES.breadcrumb, title: props.path },
        segments.map(function (segment, index) {
          return h(
            'span',
            { key: 'crumb-' + String(index), style: { display: 'inline-flex', alignItems: 'center', minWidth: 0 } },
            index === 0 ? null : h('span', { style: ST_FILES.crumbSep }, '›'),
            h('span', { style: index === segments.length - 1 ? ST_FILES.crumbLast : ST_FILES.crumb }, segment),
          );
        }),
      ),
      h('span', { style: { flex: '1 1 auto' } }),
      h(S.Chip, { title: typeof props.mime === 'string' ? props.mime : '' }, t('files.image.badge')),
      h('span', { style: ST_FILES.meta }, S.formatBytes(size)),
      props.mtimeMs ? h('span', { style: ST_FILES.meta }, t('files.modifiedAt', { time: S.formatDateTime(props.mtimeMs) })) : null,
    ),
    h(
      'div',
      { style: ST_FILES.imageScroll },
      props.src ? h('img', { src: props.src, alt: props.path, style: ST_FILES.image, 'data-image-preview': '1', onLoad: onImageLoad }) : null,
    ),
    h(
      'div',
      { style: ST_FILES.statusBar },
      h('span', null, t('files.image.preview')),
      h('span', { style: { flex: '1 1 auto' } }),
      dimensions !== null ? h('span', null, t('files.image.dimensions', { width: String(dimensions.width), height: String(dimensions.height) })) : null,
      h('span', null, S.formatBytes(size)),
    ),
  );
}

/** The code viewer pane: header, gutter + textarea (or read-only pre), status bar. */
function FileViewer(props) {
  const t = props.t;
  const readOnly = props.readOnly === true;
  const dirty = props.dirty === true;
  const isMarkdown = props.language === 'markdown';
  const markdownMode = props.markdownMode === 'preview' ? 'preview' : 'source';
  const previewMode = isMarkdown && markdownMode === 'preview';
  const isSvg = props.isSvg === true;
  const svgMode = props.svgMode === 'source' ? 'source' : 'image';
  const svgImageMode = isSvg && svgMode === 'image';
  const dimensions = props.dimensions !== null && props.dimensions !== undefined ? props.dimensions : null;
  const onImageLoad = function (event) {
    const target = event !== null && event !== undefined ? event.target : null;
    if (target === null || target === undefined) return;
    if (typeof props.onDimensions !== 'function') return;
    if (!Number.isFinite(target.naturalWidth) || !Number.isFinite(target.naturalHeight)) return;
    props.onDimensions({ width: target.naturalWidth, height: target.naturalHeight });
  };
  const saving = props.saving === true;
  const segments = typeof props.path === 'string' && props.path.length > 0 ? props.path.split('/') : [];
  const numbersText = useMemo(
    function () { return lineNumbersText(props.lineCount); },
    [props.lineCount],
  );

  // Syntax highlighting is computed from the draft + the Host language chip and
  // cached per text version. The engine degrades to plain lines for `text`,
  // unknown languages and sources over 300 KB, so a huge file never pays for it.
  // A second guard caps the number of rendered segments: the engine can return
  // tens of thousands of tokens for a dense minified bundle, and those would
  // turn into tens of thousands of spans.
  const highlight = useMemo(
    function () {
      let lines = [];
      try {
        lines = typeof S.highlightLines === 'function' ? S.highlightLines(props.value, props.language) : [];
      } catch (error) {
        lines = [];
      }
      let plain = isPlainHighlight(lines);
      const cap = S.MAX_SYNTAX_SEGMENTS;
      if (plain === false && Number.isFinite(cap)) {
        let segments = 0;
        for (let index = 0; index < lines.length; index = index + 1) {
          segments = segments + lines[index].length;
          if (segments > cap) break;
        }
        if (segments > cap) plain = true;
      }
      return { lines: lines, plain: plain };
    },
    [props.value, props.language],
  );

  const syntaxChildren = useMemo(
    function () { return highlight.plain ? null : renderSyntaxChildren(highlight.lines); },
    [highlight],
  );

  const textareaRef = props.textareaRef !== null && props.textareaRef !== undefined ? props.textareaRef : null;
  const syntaxRef = useRef(null);

  // The overlay has no scroll of its own: it follows the textarea's scroll
  // offsets with a transform, so the coloured glyphs stay on the same pixels as
  // the (transparent) textarea text and its caret.
  const syncSyntaxScroll = useCallback(
    function () {
      const layer = syntaxRef.current;
      const textarea = textareaRef !== null ? textareaRef.current : null;
      if (layer === null || layer === undefined || textarea === null || textarea === undefined) return;
      const left = Number.isFinite(textarea.scrollLeft) ? textarea.scrollLeft : 0;
      const top = Number.isFinite(textarea.scrollTop) ? textarea.scrollTop : 0;
      layer.style.transform = 'translate(' + String(-left) + 'px, ' + String(-top) + 'px)';
    },
    [textareaRef],
  );

  // A line jump (search hit, file switch) sets textarea.scrollTop directly; the
  // resulting native scroll event re-syncs the overlay, and this effect covers
  // the first paint for a freshly opened file so the layer starts at zero.
  useEffect(function () {
    syncSyntaxScroll();
    return undefined;
  }, [props.path, syncSyntaxScroll]);

  function handleEditorScroll(event) {
    syncSyntaxScroll();
    if (typeof props.onScroll === 'function') props.onScroll(event);
  }

  const syntaxActive = readOnly === false && highlight.plain === false;

  return h(
    'div',
    { style: ST_FILES.viewer },
    h(
      'div',
      { style: ST_FILES.viewerHeader },
      h(
        'div',
        { style: ST_FILES.breadcrumb, title: props.path },
        segments.map(function (segment, index) {
          return h(
            'span',
            { key: 'crumb-' + String(index), style: { display: 'inline-flex', alignItems: 'center', minWidth: 0 } },
            index === 0 ? null : h('span', { style: ST_FILES.crumbSep }, '›'),
            h('span', { style: index === segments.length - 1 ? ST_FILES.crumbLast : ST_FILES.crumb }, segment),
          );
        }),
      ),
      h('span', { style: { flex: '1 1 auto' } }),
      dirty ? h('span', { style: ST_FILES.dirtyBadge }, h(S.Icons.Dot, { size: 9 }), t('files.modified')) : null,
      readOnly ? h(S.Chip, { tone: 'warn', icon: S.Icons.Lock, title: t('files.saveUnavailable') }, t('files.readonly')) : null,
      isMarkdown
        ? h(
            'div',
            { style: ST_FILES.mdToggle, role: 'tablist', 'aria-label': t('files.md.mode') },
            ['source', 'preview'].map(function (mode) {
              const active = markdownMode === mode;
              return h(
                'button',
                {
                  key: mode,
                  type: 'button',
                  role: 'tab',
                  'data-md-mode': mode,
                  'aria-selected': active ? 'true' : 'false',
                  style: Object.assign({}, ST_FILES.mdToggleButton, active ? ST_FILES.mdToggleActive : null),
                  onClick: function () {
                    if (typeof props.onMarkdownMode === 'function') props.onMarkdownMode(mode);
                  },
                },
                t(mode === 'source' ? 'files.md.source' : 'files.md.preview'),
              );
            }),
          )
        : null,
      isSvg
        ? h(
            'div',
            { style: ST_FILES.mdToggle, role: 'tablist', 'aria-label': t('files.svg.mode') },
            ['image', 'source'].map(function (mode) {
              const active = svgMode === mode;
              return h(
                'button',
                {
                  key: mode,
                  type: 'button',
                  role: 'tab',
                  'data-svg-mode': mode,
                  'aria-selected': active ? 'true' : 'false',
                  style: Object.assign({}, ST_FILES.mdToggleButton, active ? ST_FILES.mdToggleActive : null),
                  onClick: function () {
                    if (typeof props.onSvgMode === 'function') props.onSvgMode(mode);
                  },
                },
                t(mode === 'image' ? 'files.svg.preview' : 'files.svg.source'),
              );
            }),
          )
        : null,
      props.language ? h(S.Chip, { title: t('files.language', { language: props.language }) }, props.language) : null,
      h('span', { style: ST_FILES.meta }, S.formatBytes(props.size)),
      props.mtimeMs ? h('span', { style: ST_FILES.meta }, t('files.modifiedAt', { time: S.formatDateTime(props.mtimeMs) })) : null,
      readOnly
        ? null
        : h(
            S.PrimaryButton,
            {
              title: t('files.saveShortcut'),
              ariaLabel: t('action.save'),
              disabled: !dirty || saving,
              onClick: props.onSave,
            },
            h(S.Icons.Save, { size: 13 }),
            saving ? t('action.saving') : t('action.save'),
          ),
    ),
    props.notice !== null && props.notice !== undefined
      ? h(S.NoticeBar, { t: t, kind: props.notice.kind, text: props.notice.text, onDismiss: props.onDismissNotice })
      : null,
    props.truncated
      ? h(S.NoticeBar, { t: t, kind: 'info', text: t('files.readonly.truncated') })
      : null,
    props.tooBig
      ? h(S.NoticeBar, { t: t, kind: 'info', text: t('files.readonly.big', { limit: '400 KB' }) })
      : null,
    svgImageMode
      ? h(
          'div',
          { style: ST_FILES.imageScroll, tabIndex: 0, onKeyDown: props.onKeyDown, 'data-svg-preview': '1' },
          props.svgDataUrl
            ? h('img', { src: props.svgDataUrl, alt: props.path, style: ST_FILES.image, 'data-svg-image': '1', onLoad: onImageLoad })
            : null,
        )
      : previewMode
      ? h(
          'div',
          {
            style: S.MD_STYLE.scroll,
            tabIndex: 0,
            'data-md-preview': '1',
            onKeyDown: props.onKeyDown,
          },
          h(
            'div',
            { style: S.MD_STYLE.inner },
            typeof S.renderMarkdown === 'function' ? S.renderMarkdown(props.value) : null,
          ),
        )
      : readOnly
      ? h(
          'div',
          { style: ST_FILES.readOnlyScroll },
          h(
            'div',
            { style: ST_FILES.readOnlyInner },
            h('pre', { style: ST_FILES.readOnlyGutter, 'aria-hidden': true }, numbersText),
            h(
              'pre',
              {
                style: ST_FILES.readOnlyCode,
                'data-ide-highlight': syntaxChildren === null ? 'plain' : 'syntax',
              },
              syntaxChildren === null ? props.value : syntaxChildren,
            ),
          ),
        )
      : h(
          'div',
          { style: ST_FILES.editorWrap },
          h(
            'div',
            { ref: props.gutterRef, style: ST_FILES.gutterWrap, 'aria-hidden': true },
            h('pre', { style: ST_FILES.gutter }, numbersText),
          ),
          h(
            'div',
            { style: ST_FILES.codeRegion },
            syntaxActive
              ? h(
                  'div',
                  {
                    style: ST_FILES.syntaxLayer,
                    'aria-hidden': true,
                    'data-ide-highlight': 'layer',
                  },
                  h('pre', { ref: syntaxRef, style: ST_FILES.syntaxCode }, syntaxChildren),
                )
              : null,
            h('textarea', {
              ref: props.textareaRef,
              value: props.value,
              style: syntaxActive ? Object.assign({}, ST_FILES.textarea, ST_FILES.textareaHighlighting) : ST_FILES.textarea,
              spellCheck: false,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              autoComplete: 'off',
              wrap: 'off',
              'aria-label': props.path,
              onChange: props.onChange,
              onKeyDown: props.onKeyDown,
              onScroll: handleEditorScroll,
              onSelect: props.onSelect,
              onClick: props.onSelect,
              onKeyUp: props.onSelect,
            }),
          ),
        ),
    h(
      'div',
      { style: ST_FILES.statusBar },
      svgImageMode
        ? h('span', null, t('files.svg.preview'))
        : previewMode
        ? h('span', null, t('files.md.preview'))
        : h('span', null, t('files.caret', { line: props.caret.line, column: props.caret.column })),
      h('span', { style: { flex: '1 1 auto' } }),
      svgImageMode && dimensions !== null
        ? h('span', null, t('files.image.dimensions', { width: String(dimensions.width), height: String(dimensions.height) }))
        : null,
      dirty ? h('span', { style: ST_FILES.statusHint }, t('files.dirtyHint')) : null,
      isMarkdown ? h('span', { title: t('files.md.toggleHint') }, t('files.md.shortcut')) : null,
      isSvg ? h('span', { title: t('files.svg.toggleHint') }, t('files.svg.shortcut')) : null,
      readOnly || svgImageMode ? null : h('span', { title: t('files.commentHint') }, t('files.commentShortcut')),
      h('span', null, t('files.lines', { count: S.formatCount(props.lineCount) })),
      h('span', null, t('files.encoding')),
      readOnly ? h('span', null, t('files.readonly')) : null,
    ),
  );
}

/**
 * The Files tab: tree on the left, viewer on the right.
 * @param {{t: Function, root: string, openRequest?: OpenRequest|null, reloadToken?: number, onOpenFile?: Function}} props - slot props.
 */
function FilesView(props) {
  const fallbackT = S.useT();
  const t = props !== null && props !== undefined && typeof props.t === 'function' ? props.t : fallbackT;
  const root = props.root;

  const [tree, setTree] = useState({});
  const [expanded, setExpanded] = useState({ '': true });
  const [selected, setSelected] = useState(null);
  const [file, setFile] = useState(/** @type {FileState} */ ({ status: 'idle', data: null, error: null }));
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [caret, setCaret] = useState({ line: 1, column: 1 });
  const [pendingLine, setPendingLine] = useState(null);
  const [markdownMode, setMarkdownMode] = useState('source');
  const [svgMode, setSvgMode] = useState('image');
  const [image, setImage] = useState({ status: 'idle', data: null, error: null });
  const [dimensions, setDimensions] = useState(null);

  const textareaRef = useRef(null);
  const gutterRef = useRef(null);
  const fileRequestRef = useRef(0);
  const genRef = useRef(0);
  const noticeTimerRef = useRef(null);

  // Success / info notices fade after a moment; error notices stay until the
  // next action so a failed save is never missed.
  const showNotice = useCallback(function (next) {
    setNotice(next);
    if (noticeTimerRef.current !== null && noticeTimerRef.current !== undefined) {
      try {
        clearTimeout(noticeTimerRef.current);
      } catch (error) {
        /* no timer */
      }
      noticeTimerRef.current = null;
    }
    if (next !== null && next !== undefined && next.kind !== 'error') {
      try {
        noticeTimerRef.current = setTimeout(function () {
          noticeTimerRef.current = null;
          setNotice(null);
        }, 2600);
      } catch (error) {
        /* no timer */
      }
    }
  }, []);

  useEffect(function () {
    return function () {
      if (noticeTimerRef.current !== null && noticeTimerRef.current !== undefined) {
        try {
          clearTimeout(noticeTimerRef.current);
        } catch (error) {
          /* no timer */
        }
      }
    };
  }, []);

  const loadDir = useCallback(/** @param {string} dirPath - directory path relative to the root. @param {number} [generation] - tree generation for stale-response rejection. */ function (dirPath, generation) {
    const gen = generation === undefined ? genRef.current : generation;
    setTree(function (previous) {
      const next = Object.assign({}, previous);
      next[dirPath] = { status: 'loading', entries: [], error: null, truncated: false };
      return next;
    });
    S.requestJson(S.apiUrl(ROUTES.list, { root: root, path: dirPath }))
      .then(function (payload) {
        if (genRef.current !== gen) return;
        const entries = Array.isArray(payload.entries) ? payload.entries.filter(keepTreeEntry) : [];
        setTree(function (previous) {
          const next = Object.assign({}, previous);
          next[dirPath] = { status: 'loaded', entries: entries, error: null, truncated: payload.truncated === true };
          return next;
        });
      })
      .catch(function (cause) {
        if (genRef.current !== gen) return;
        if (cause !== null && cause !== undefined && cause.name === 'AbortError') return;
        setTree(function (previous) {
          const next = Object.assign({}, previous);
          next[dirPath] = { status: 'error', entries: [], error: cause, truncated: false };
          return next;
        });
      });
  }, [root]);

  useEffect(function () {
    genRef.current = genRef.current + 1;
    const gen = genRef.current;
    setTree({});
    setExpanded({ '': true });
    setSelected(null);
    setFile({ status: 'idle', data: null, error: null });
    setDraft('');
    setSaving(false);
    setNotice(null);
    setPendingLine(null);
    setMarkdownMode('source');
    setCaret({ line: 1, column: 1 });
    loadDir('', gen);
    return function () {
      genRef.current = genRef.current + 1;
    };
  }, [root, loadDir]);

  const toggleDir = useCallback(function (entry) {
    if (entry === null || entry === undefined || entry.type !== 'dir' || typeof entry.path !== 'string') return;
    const path = entry.path;
    const open = expanded[path] === true;
    setExpanded(function (previous) {
      const next = Object.assign({}, previous);
      if (open) delete next[path];
      else next[path] = true;
      return next;
    });
    if (!open) {
      const node = tree[path];
      if (node === undefined || node === null || node.status === 'error') loadDir(path);
    }
  }, [expanded, tree, loadDir]);

  const openFile = useCallback(function (path, line) {
    if (typeof path !== 'string' || path.length === 0) return;
    const requestId = fileRequestRef.current + 1;
    fileRequestRef.current = requestId;
    const gen = genRef.current;
    setSelected(path);
    setFile({ status: 'loading', data: null, error: null });
    setDraft('');
    setSaving(false);
    showNotice(null);
    setPendingLine(null);
    setMarkdownMode('source');
    setSvgMode('image');
    setDimensions(null);
    setImage({ status: 'idle', data: null, error: null });
    setCaret({ line: 1, column: 1 });
    const imageMime = typeof S.imageMimeForPath === 'function' ? S.imageMimeForPath(path) : null;
    if (imageMime !== null && imageMime !== 'image/svg+xml') {
      setFile({ status: 'idle', data: null, error: null });
      setImage({ status: 'loading', data: null, error: null });
      S.requestJson(S.apiUrl(ROUTES.image, { root: root, path: path }))
        .then(function (payload) {
          if (fileRequestRef.current !== requestId || genRef.current !== gen) return;
          setImage({ status: 'loaded', data: payload, error: null });
        })
        .catch(function (cause) {
          if (fileRequestRef.current !== requestId || genRef.current !== gen) return;
          if (cause !== null && cause !== undefined && cause.name === 'AbortError') return;
          setImage({ status: 'error', data: null, error: cause });
        });
      return;
    }
    S.requestJson(S.apiUrl(ROUTES.file, { root: root, path: path }))
      .then(function (payload) {
        if (fileRequestRef.current !== requestId || genRef.current !== gen) return;
        const content = typeof payload.content === 'string' ? payload.content : '';
        setFile({ status: 'loaded', data: payload, eol: detectEol(content), error: null });
        setDraft(normalizeEol(content));
        const target = Number.isFinite(line) && line > 0 ? Math.floor(line) : null;
        if (target !== null) setPendingLine(target);
      })
      .catch(function (cause) {
        if (fileRequestRef.current !== requestId || genRef.current !== gen) return;
        if (cause !== null && cause !== undefined && cause.name === 'AbortError') return;
        setFile({ status: 'error', data: null, error: cause });
      });
  }, [root, showNotice]);

  const data = file.status === 'loaded' && file.data !== null && file.data !== undefined ? file.data : null;
  const original = data !== null && typeof data.content === 'string' ? normalizeEol(data.content) : '';
  const eol = file !== null && file !== undefined && file.eol === '\r\n' ? '\r\n' : '\n';
  const dirty = data !== null && draft !== original;
  const binary = data !== null && data.binary === true;
  const truncated = data !== null && data.truncated === true;
  const size = data !== null && Number.isFinite(data.size) ? data.size : 0;
  const tooBig = data !== null && size > MAX_EDITABLE_BYTES;
  const readOnly = binary || truncated || tooBig;
  const language = data !== null && typeof data.language === 'string' ? data.language : null;
  const mtimeMs = data !== null && Number.isFinite(data.mtimeMs) ? data.mtimeMs : null;
  const lineCount = data !== null ? countLines(draft) : 0;
  const imageData = image !== null && image !== undefined && image.status === 'loaded' ? image.data : null;
  const imageSrc = imageData !== null && typeof S.buildImageDataUrl === 'function' ? S.buildImageDataUrl(imageData.mime, imageData.base64) : null;
  const isSvg = selected !== null && typeof S.imageMimeForPath === 'function' && S.imageMimeForPath(selected) === 'image/svg+xml';
  const svgDataUrl = useMemo(
    function () {
      return isSvg && typeof S.buildSvgDataUrl === 'function' ? S.buildSvgDataUrl(draft) : null;
    },
    [draft, isSvg],
  );

  const save = useCallback(function () {
    if (selected === null || file.status !== 'loaded' || saving === true) return;
    const snapshot = file.data;
    if (snapshot === null || snapshot === undefined) return;
    const blocked = snapshot.binary === true || snapshot.truncated === true || (Number.isFinite(snapshot.size) && snapshot.size > MAX_EDITABLE_BYTES);
    if (blocked) return;
    const saved = normalizeEol(typeof snapshot.content === 'string' ? snapshot.content : '');
    if (draft === saved) return;
    const contentToSave = applyEol(draft, eol);
    setSaving(true);
    setNotice(null);
    S.requestJson(ROUTES.save, { method: 'POST', body: { root: root, path: selected, content: contentToSave } })
      .then(function (payload) {
        setFile(function (previous) {
          if (previous === null || previous === undefined || previous.status !== 'loaded') return previous;
          const nextData = Object.assign({}, previous.data, {
            content: contentToSave,
            size: Number.isFinite(payload.size) ? payload.size : previous.data.size,
            mtimeMs: Number.isFinite(payload.mtimeMs) ? payload.mtimeMs : previous.data.mtimeMs,
          });
          return { status: 'loaded', data: nextData, error: null };
        });
        setSaving(false);
        showNotice({ kind: 'success', text: t('files.saved') });
      })
      .catch(function (cause) {
        setSaving(false);
        showNotice({ kind: 'error', text: t('files.saveError', { message: S.errorText(cause) }) });
      });
  }, [selected, file, saving, draft, root, eol, t, showNotice]);

  const reloadSelected = useCallback(function () {
    if (selected === null) return;
    openFile(selected, null);
  }, [selected, openFile]);

  const discard = useCallback(function () {
    if (selected === null) return;
    openFile(selected, null);
    showNotice({ kind: 'info', text: t('files.discard') });
  }, [selected, openFile, t, showNotice]);

  const syncCaret = useCallback(function (event) {
    const target = event !== null && event !== undefined ? event.target : null;
    if (target === null || target === undefined) return;
    setCaret(caretFromIndex(typeof target.value === 'string' ? target.value : draft, target.selectionStart));
  }, [draft]);

  const onEditorScroll = useCallback(function (event) {
    const target = event !== null && event !== undefined ? event.target : null;
    const gutter = gutterRef.current;
    if (target !== null && target !== undefined && gutter !== null && gutter !== undefined) {
      gutter.scrollTop = target.scrollTop;
    }
  }, []);

  function applyLineJump(targetLine) {
    const textarea = textareaRef.current;
    if (textarea === null || textarea === undefined) return;
    const value = typeof textarea.value === 'string' ? textarea.value : draft;
    const total = Math.max(1, countLines(value));
    const line = clampNumber(Math.floor(targetLine), 1, total);
    let start = 0;
    for (let index = 1; index < line; index = index + 1) {
      const next = value.indexOf('\n', start);
      if (next === -1) {
        start = value.length;
        break;
      }
      start = next + 1;
    }
    let end = value.indexOf('\n', start);
    if (end === -1) end = value.length;
    try {
      textarea.focus();
      textarea.setSelectionRange(start, end);
    } catch (error) {
      /* selection is a nicety */
    }
    const top = Math.max(0, (line - 1) * EDITOR_LINE_HEIGHT + EDITOR_PADDING_TOP - 4 * EDITOR_LINE_HEIGHT);
    try {
      textarea.scrollTop = top;
    } catch (error) {
      /* scroll is a nicety */
    }
    const gutter = gutterRef.current;
    if (gutter !== null && gutter !== undefined) {
      try {
        gutter.scrollTop = textarea.scrollTop;
      } catch (error) {
        /* ignore */
      }
    }
    setCaret({ line: line, column: 1 });
  }

  useEffect(function () {
    if (pendingLine === null || file.status !== 'loaded') return undefined;
    applyLineJump(pendingLine);
    setPendingLine(null);
    return undefined;
  }, [pendingLine, file.status]);

  const openToken =
    props.openRequest !== null && props.openRequest !== undefined && Number.isFinite(props.openRequest.token)
      ? props.openRequest.token
      : 0;

  useEffect(function () {
    const request = props.openRequest;
    if (request === null || request === undefined || typeof request.path !== 'string' || request.path.length === 0) return undefined;
    const targetLine = Number.isFinite(request.line) ? Math.floor(request.line) : 1;
    if (selected === request.path && file.status === 'loaded') {
      setPendingLine(targetLine);
      return undefined;
    }
    openFile(request.path, targetLine);
    return undefined;
  }, [openToken]);

  const onChange = useCallback(function (event) {
    const target = event !== null && event !== undefined ? event.target : null;
    const value = target !== null && target !== undefined && typeof target.value === 'string' ? target.value : '';
    setDraft(value);
    if (target !== null && target !== undefined) setCaret(caretFromIndex(value, target.selectionStart));
  }, []);

  // Cmd/Ctrl+/ toggles line comments (VSCode's shortcut). The pure engine lives
  // in 07-highlight.js next to the per-language comment syntax table.
  const toggleComments = useCallback(function () {
    const textarea = textareaRef.current;
    if (textarea === null || textarea === undefined) return false;
    if (file.status !== 'loaded' || readOnly === true) return false;
    if (typeof S.toggleLineComments !== 'function') return false;
    const value = typeof textarea.value === 'string' ? textarea.value : draft;
    const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : 0;
    const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
    const result = S.toggleLineComments(value, start, end, language);
    if (result === null || result === undefined || result.changed !== true || typeof result.text !== 'string') return false;
    setDraft(result.text);
    setCaret(caretFromIndex(result.text, result.selectionStart));
    try {
      setTimeout(function () {
        const current = textareaRef.current;
        if (current === null || current === undefined) return;
        try {
          current.focus();
          current.setSelectionRange(result.selectionStart, result.selectionEnd);
        } catch (error) {
          /* editor unmounted */
        }
      }, 0);
    } catch (error) {
      /* no timer available */
    }
    return true;
  }, [draft, file.status, language, readOnly]);

  const onKeyDown = useCallback(function (event) {
    if (event === null || event === undefined) return;
    const key = event.key;
    const meta = event.metaKey === true || event.ctrlKey === true;
    if (meta && (key === '/' || (key === '?' && event.shiftKey === true))) {
      if (toggleComments()) {
        event.preventDefault();
        return;
      }
    }
    if (meta && event.shiftKey === true && (key === 'v' || key === 'V') && (language === 'markdown' || isSvg)) {
      event.preventDefault();
      if (language === 'markdown') setMarkdownMode(function (previous) { return previous === 'preview' ? 'source' : 'preview'; });
      else setSvgMode(function (previous) { return previous === 'image' ? 'source' : 'image'; });
      return;
    }
    if (meta && (key === 's' || key === 'S')) {
      event.preventDefault();
      save();
      return;
    }
    if (key === 'Escape') {
      if (dirty) {
        event.preventDefault();
        discard();
      }
      return;
    }
    if (key === 'Tab' && event.shiftKey !== true) {
      const textarea = textareaRef.current;
      if (textarea === null || textarea === undefined) return;
      event.preventDefault();
      const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : draft.length;
      const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
      const value = typeof textarea.value === 'string' ? textarea.value : draft;
      const nextValue = value.slice(0, start) + '  ' + value.slice(end);
      setDraft(nextValue);
      setCaret(caretFromIndex(nextValue, start + 2));
      try {
        setTimeout(function () {
          try {
            textarea.setSelectionRange(start + 2, start + 2);
          } catch (error) {
            /* ignore */
          }
        }, 0);
      } catch (error) {
        /* no timer */
      }
    }
  }, [dirty, draft, save, discard]);

  const dismissNotice = useCallback(function () {
    showNotice(null);
  }, [showNotice]);

  function refreshTree() {
    genRef.current = genRef.current + 1;
    const gen = genRef.current;
    setTree({});
    setExpanded({ '': true });
    loadDir('', gen);
  }

  const rootNode = tree[''];
  const treeTruncated = rootNode !== null && rootNode !== undefined && rootNode.truncated === true;

  const treePane = h(
    'div',
    { style: ST_FILES.treePane },
    h(
      'div',
      { style: ST_FILES.treeHeader },
      h('span', { style: ST_FILES.treeHeaderTitle, title: root }, String(S.baseName(root) || root).toUpperCase()),
      h('span', { style: { flex: '1 1 auto' } }),
      rootNode !== null && rootNode !== undefined && rootNode.status === 'loading' ? h(S.Icons.Spinner, { size: 12 }) : null,
      h(
        S.ToolButton,
        { title: t('action.refresh'), ariaLabel: t('action.refresh'), style: { width: 22, height: 22 }, onClick: refreshTree },
        h(S.Icons.Refresh, { size: 12 }),
      ),
    ),
    h(
      'div',
      { style: ST_FILES.treeBody, role: 'tree', 'aria-label': t('files.tree.label') },
      h(TreeDirRows, {
        t: t,
        tree: tree,
        expanded: expanded,
        selected: selected,
        onToggle: toggleDir,
        onOpen: openFile,
        onReloadDir: loadDir,
        dirPath: '',
        depth: 0,
      }),
      treeTruncated ? h('div', { style: ST_FILES.treeTruncated }, t('files.tree.truncated')) : null,
    ),
  );

  let viewer = null;
  if (image.status === 'loading') {
    viewer = h(S.LoadingIndicator, { t: t, label: t('files.loading') });
  } else if (image.status === 'error') {
    viewer = h(S.InlineError, {
      t: t,
      title: t('files.image.error.title'),
      message: S.errorText(image.error),
      onRetry: reloadSelected,
    });
  } else if (imageData !== null && imageSrc !== null) {
    viewer = h(S.ImageViewer, {
      t: t,
      path: selected,
      src: imageSrc,
      mime: imageData.mime,
      size: imageData.size,
      mtimeMs: imageData.mtimeMs,
      dimensions: dimensions,
      onDimensions: setDimensions,
    });
  } else if (selected === null) {
    viewer = h(S.EmptyState, {
      t: t,
      icon: S.Icons.Files,
      title: t('files.open.title'),
      body: t('files.open.body'),
    });
  } else if (file.status === 'loading') {
    viewer = h(S.LoadingIndicator, { t: t, label: t('files.loading') });
  } else if (file.status === 'error') {
    viewer = h(S.InlineError, {
      t: t,
      title: t('files.error.title'),
      message: S.errorText(file.error),
      onRetry: reloadSelected,
    });
  } else if (file.status === 'loaded' && binary) {
    viewer = h(S.EmptyState, {
      t: t,
      icon: S.Icons.File,
      title: t('files.binary.title'),
      body: t('files.binary.body'),
    });
  } else if (file.status === 'loaded') {
    viewer = h(FileViewer, {
      t: t,
      path: selected,
      value: draft,
      lineCount: lineCount,
      language: language,
      size: size,
      mtimeMs: mtimeMs,
      dirty: dirty,
      saving: saving,
      readOnly: readOnly,
      tooBig: tooBig,
      truncated: truncated,
      notice: notice,
      caret: caret,
      markdownMode: markdownMode,
      onMarkdownMode: setMarkdownMode,
      isSvg: isSvg,
      svgMode: svgMode,
      onSvgMode: setSvgMode,
      svgDataUrl: svgDataUrl,
      dimensions: dimensions,
      onDimensions: setDimensions,
      textareaRef: textareaRef,
      gutterRef: gutterRef,
      onChange: onChange,
      onKeyDown: onKeyDown,
      onScroll: onEditorScroll,
      onSelect: syncCaret,
      onSave: save,
      onDismissNotice: dismissNotice,
    });
  } else {
    viewer = h(S.EmptyState, { t: t, icon: S.Icons.Files, title: t('files.open.title'), body: t('files.open.body') });
  }

  return h(S.SplitPane, {
    left: treePane,
    right: viewer,
    storageKey: 'dsh-workspace-ide:files-tree-width',
    initialWidth: 300,
    minWidth: SPLIT_MIN,
    maxWidth: SPLIT_MAX,
    handleLabel: t('files.tree.label'),
  });
}

S.FilesView = FilesView;
S.FileViewer = FileViewer;
S.ImageViewer = ImageViewer;
S.FileTreeRow = FileTreeRow;
S.TreeDirRows = TreeDirRows;
S.countLines = countLines;
S.lineNumbersText = lineNumbersText;
S.caretFromIndex = caretFromIndex;
S.keepTreeEntry = keepTreeEntry;
S.ST_FILES = ST_FILES;
