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
function normalizeEol(text: any) {
  return typeof text === 'string' ? text.replace(/\r\n/g, '\n') : '';
}

/** @param {string} text - LF text. @param {string} eol - original line ending. @returns {string} text in that ending. */
function applyEol(text: string, eol: string): string {
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
}

/** @param {string} text - raw file content. @returns {string} the detected line ending. */
function detectEol(text: string): string {
  return typeof text === 'string' && text.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
}

/** Persisted soft-wrap preference. */
const STORAGE_WRAP = 'dsh-workspace-ide:editor-wrap';
/** Persisted editor zoom (percent). */
const STORAGE_ZOOM = 'dsh-workspace-ide:editor-zoom';

/** Read the persisted soft-wrap flag (default off). */
function readWrapPref(): boolean {
  try {
    return typeof S.readStoredNumber === 'function' && S.readStoredNumber(STORAGE_WRAP) === 1;
  } catch (error) {
    return false;
  }
}

/** Read the persisted editor zoom (1 = 100%). */
function readZoomPref(): number {
  try {
    const stored = typeof S.readStoredNumber === 'function' ? S.readStoredNumber(STORAGE_ZOOM) : null;
    if (typeof stored === 'number' && Number.isFinite(stored)) return Math.min(2, Math.max(0.5, stored / 100));
  } catch (error) {
    /* preference is optional */
  }
  return 1;
}

/** Persisted per-file bookmarks (path -> sorted line numbers). */
const STORAGE_BOOKMARKS = 'dsh-workspace-ide:bookmarks';

/** Read persisted bookmarks, dropping malformed entries. */
function readBookmarks(): Record<string, number[]> {
  try {
    const raw = typeof S.readStorage === 'function' ? S.readStorage(STORAGE_BOOKMARKS) : null;
    if (typeof raw !== 'string' || raw.length === 0) return {};
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, number[]> = {};
    Object.keys(parsed).forEach(function (filePath: string) {
      const lines = parsed[filePath];
      if (!Array.isArray(lines)) return;
      const clean = lines
        .filter(function (value: any) { return Number.isFinite(value); })
        .map(function (value: number) { return Math.floor(value); })
        .sort(function (left: number, right: number) { return left - right; });
      if (clean.length > 0) result[filePath] = clean;
    });
    return result;
  } catch (error) {
    return {};
  }
}

/** Persist bookmarks, ignoring storage failures. */
function writeBookmarks(map: Record<string, number[]>) {
  try {
    if (typeof S.writeStorage === 'function') S.writeStorage(STORAGE_BOOKMARKS, JSON.stringify(map));
  } catch (error) {
    /* preference persistence is optional */
  }
}

/** One tree row. */
interface TreeEntry {
  name: string;
  path: string;
  type: string;
  size?: number;
  mtimeMs?: number;
  hidden?: boolean;
}

/** Pixel size measured from a loaded image. */
type ImageDimensions = { width: number; height: number };

/** Loaded file payload state. */
interface FileState {
  status: string;
  data: any;
  eol?: string;
  error: any;
}

/** Request to open a file (optionally at a line). */
interface OpenRequest {
  path?: string;
  line?: number;
  token?: number;
}

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
  // Soft-wrap only changes glyph wrapping: the syntax layer and the textarea
  // share it, and the gutter is hidden because numbered rows would no longer
  // line up with visual (wrapped) rows.
  textareaWrap: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  },
  syntaxCodeWrap: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  },
  readOnlyInnerWrap: {
    display: 'block',
    minWidth: 0,
  },
  readOnlyCodeWrap: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  },
  // Clickable breadcrumb segment (JetBrains-style path navigation).
  crumbButton: {
    border: 'none',
    background: 'transparent',
    padding: 0,
    margin: 0,
    fontFamily: FONT_UI,
    fontSize: 12.5,
    color: C.textTertiary,
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // Slim go-to-line bar above the editor (⌘G).
  gotoBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 32,
    flex: '0 0 auto',
    padding: '0 12px',
    boxSizing: 'border-box',
    borderBottom: '1px solid ' + C.border2,
    background: C.platform,
  },
  gotoLabel: {
    color: C.textTertiary,
    fontSize: 11.5,
    fontFamily: FONT_UI,
    whiteSpace: 'nowrap',
  },
  gotoInput: {
    width: 96,
    padding: '3px 7px',
    borderRadius: 4,
    border: '1px solid ' + C.border1,
    background: C.base,
    color: C.text,
    fontFamily: FONT_MONO,
    fontSize: 12,
    outline: 'none',
  },
  gotoHint: {
    color: C.textTertiary,
    fontSize: 11,
    fontFamily: FONT_UI,
    whiteSpace: 'nowrap',
  },
  statusButton: {
    border: 'none',
    background: 'transparent',
    padding: 0,
    margin: 0,
    color: C.textTertiary,
    fontFamily: FONT_UI,
    fontSize: 11,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  // In-file find / replace bar (⌘F / ⌘H), stacked rows: find, optional replace.
  findBar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    flex: '0 0 auto',
    padding: '6px 12px',
    boxSizing: 'border-box',
    borderBottom: '1px solid ' + C.border2,
    background: C.platform,
  },
  findRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  findInput: {
    width: 240,
    padding: '3px 7px',
    borderRadius: 4,
    border: '1px solid ' + C.border1,
    background: C.base,
    color: C.text,
    fontFamily: FONT_MONO,
    fontSize: 12,
    outline: 'none',
  },
  findToggle: {
    border: '1px solid ' + C.border1,
    background: 'transparent',
    color: C.textTertiary,
    fontFamily: FONT_MONO,
    fontSize: 11,
    lineHeight: '18px',
    padding: '0 5px',
    borderRadius: 4,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  findToggleActive: {
    background: C.activeBg,
    color: C.text,
    borderColor: C.border2,
  },
  findCount: {
    color: C.textTertiary,
    fontFamily: FONT_MONO,
    fontSize: 11,
    whiteSpace: 'nowrap',
  },
  findError: {
    color: C.error,
    fontFamily: FONT_UI,
    fontSize: 11,
    whiteSpace: 'nowrap',
  },
  // All-match highlight layer: same character grid as the textarea, text
  // transparent, only the match spans paint a background. The current match
  // uses the accent fill; the rest use the neutral active surface.
  findLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: 0,
  },
  findCode: {
    position: 'absolute',
    top: 0,
    left: 0,
    margin: 0,
    padding: EDITOR_PADDING_TOP + 'px 16px 24px 12px',
    fontFamily: FONT_MONO,
    fontSize: 12.5,
    lineHeight: EDITOR_LINE_HEIGHT + 'px',
    color: 'transparent',
    whiteSpace: 'pre',
    tabSize: 2,
    fontVariantLigatures: 'none',
    fontKerning: 'none',
    boxSizing: 'border-box',
    willChange: 'transform',
  },
  findMark: {
    background: C.activeBg,
    borderRadius: 2,
  },
  findMarkCurrent: {
    background: C.accent,
    borderRadius: 2,
  },
  // Current-line highlight + indent guides sit behind the syntax text. The
  // layer itself is pointer-transparent; positions are viewport-relative and
  // recomputed from the textarea scrollTop.
  guideLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: 0,
  },
  guideLine: {
    position: 'absolute',
    width: 1,
    background: C.border1,
    opacity: 0.55,
  },
  currentLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    background: C.hover,
  },
  findHint: {
    color: C.textTertiary,
    fontFamily: FONT_UI,
    fontSize: 11,
    whiteSpace: 'nowrap',
  },
  // Cmd/Ctrl+P quick-open palette: centered panel over a transparent scrim.
  quickLayer: {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 60,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: '9%',
    background: 'transparent',
  },
  quickPanel: {
    display: 'flex',
    flexDirection: 'column',
    width: 580,
    maxWidth: '92%',
    maxHeight: '62vh',
    overflow: 'hidden',
    borderRadius: 8,
    border: '1px solid ' + C.border2,
    background: C.layer2,
  },
  quickInputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 14px',
    borderBottom: '1px solid ' + C.border1,
    flex: '0 0 auto',
  },
  quickInput: {
    flex: '1 1 auto',
    minWidth: 0,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: C.text,
    fontFamily: FONT_UI,
    fontSize: 13.5,
  },
  quickList: {
    overflow: 'auto',
    minHeight: 0,
    padding: '4px 0',
  },
  quickRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '5px 14px',
    cursor: 'pointer',
    fontFamily: FONT_UI,
    fontSize: 12.5,
  },
  quickRowActive: {
    background: C.activeBg,
  },
  quickPathDir: {
    color: C.textTertiary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  quickPathFile: {
    color: C.text,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  quickEmpty: {
    padding: '14px',
    color: C.textTertiary,
    fontFamily: FONT_UI,
    fontSize: 12,
  },
  quickHint: {
    flex: '0 0 auto',
    padding: '6px 14px',
    borderTop: '1px solid ' + C.border1,
    color: C.textTertiary,
    fontFamily: FONT_UI,
    fontSize: 11,
    whiteSpace: 'nowrap',
  },
  quickBadge: {
    color: C.textTertiary,
    fontFamily: FONT_UI,
    fontSize: 11,
    whiteSpace: 'nowrap',
  },
  symbolKind: {
    minWidth: 62,
    color: C.textTertiary,
    fontFamily: FONT_UI,
    fontSize: 10.5,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    flex: '0 0 auto',
  },
  currentSymbol: {
    display: 'inline-flex',
    alignItems: 'center',
    maxWidth: 220,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: C.textSecondary,
    fontFamily: FONT_UI,
    fontSize: 12,
    flex: '0 1 auto',
  },
  symbolLine: {
    color: C.textTertiary,
    fontFamily: FONT_MONO,
    fontSize: 11,
    whiteSpace: 'nowrap',
    flex: '0 0 auto',
  },
  bookmarkLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    pointerEvents: 'none',
  },
  bookmarkMark: {
    position: 'absolute',
    left: 4,
    width: 3,
    borderRadius: 2,
    background: C.accent,
  },
  gitMarker: {
    position: 'absolute',
    left: 0,
    width: 3,
  },
  quickIndexIcon: {
    display: 'inline-flex',
    color: C.textTertiary,
    flex: '0 0 auto',
  },
  // JetBrains-style editor tab strip: one tab per open file, dirty dot and a
  // per-tab close button; the active tab carries an accent top border.
  tabBar: {
    display: 'flex',
    alignItems: 'stretch',
    flex: '0 0 auto',
    height: 32,
    minWidth: 0,
    overflowX: 'auto',
    overflowY: 'hidden',
    background: C.base,
    borderBottom: '1px solid ' + C.border2,
    boxSizing: 'border-box',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flex: '0 0 auto',
    maxWidth: 220,
    minWidth: 0,
    height: 32,
    padding: '0 6px 0 12px',
    borderRight: '1px solid ' + C.border1,
    borderTop: '2px solid transparent',
    boxSizing: 'border-box',
    color: C.textSecondary,
    fontFamily: FONT_UI,
    fontSize: 12,
    cursor: 'pointer',
    userSelect: 'none',
  },
  tabActive: {
    background: C.layer1,
    color: C.text,
    borderTopColor: C.accent,
  },
  tabFileIcon: {
    display: 'inline-flex',
    color: C.textTertiary,
    flex: '0 0 auto',
  },
  tabLabel: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tabClose: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    padding: 0,
    border: 'none',
    borderRadius: 4,
    background: 'transparent',
    color: C.textTertiary,
    cursor: 'pointer',
    flex: '0 0 auto',
  },
  tabDirty: {
    color: C.warnLabel,
    display: 'inline-flex',
    flex: '0 0 auto',
  },
  closeConfirmBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: '0 0 auto',
    padding: '6px 12px',
    background: C.platform,
    borderBottom: '1px solid ' + C.border1,
    color: C.warnLabel,
    fontFamily: FONT_UI,
    fontSize: 12,
  },
};

/**
 * @param {string} text - file text.
 * @returns {number} number of lines (1 for an empty file, 0 only for null).
 */
function countLines(text: string): number {
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

/** One in-file find hit: half-open `[start, end)` character range. */
interface FindRange {
  start: number;
  end: number;
}

/** Find options mirrored by the find bar toggles. */
interface FindOptions {
  caseSensitive?: boolean;
  whole?: boolean;
  regex?: boolean;
}

/** Cap the match list so a pathological query cannot stall the render. */
const FIND_MATCH_LIMIT = 5000;

/** Escape a literal query so it is a valid RegExp source. */
function escapeFindQuery(query: string): string {
  return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find all query hits in `text` (JetBrains-style: literal or regex, optional
 * case sensitivity and whole-word matching). Invalid regexes answer `[]`.
 * @param text - haystack.
 * @param query - needle / regex source.
 * @param options - find toggles.
 * @returns match ranges in document order (capped at FIND_MATCH_LIMIT).
 */
function findTextMatches(text: string, query: string, options?: FindOptions): FindRange[] {
  if (typeof text !== 'string' || typeof query !== 'string' || query.length === 0) return [];
  const opts: FindOptions = options !== null && typeof options === 'object' ? options : {};
  let source = opts.regex === true ? query : escapeFindQuery(query);
  if (opts.whole === true) source = '(?<![\\w])(?:' + source + ')(?![\\w])';
  let pattern: RegExp;
  try {
    pattern = new RegExp(source, opts.caseSensitive === true ? 'g' : 'gi');
  } catch (error) {
    return [];
  }
  const matches: FindRange[] = [];
  for (;;) {
    const found = pattern.exec(text);
    if (found === null) break;
    if (found[0].length === 0) {
      pattern.lastIndex = pattern.lastIndex + 1;
      if (pattern.lastIndex > text.length) break;
      continue;
    }
    matches.push({ start: found.index, end: found.index + found[0].length });
    if (matches.length >= FIND_MATCH_LIMIT) break;
  }
  return matches;
}

/**
 * Group document-order matches by line for the highlight layer.
 * @param text - current editor text.
 * @param matches - matches from findTextMatches.
 * @returns per-line ranges with their original match index.
 */
function groupFindMatches(text: string, matches: FindRange[]): Array<Array<{ start: number, end: number, index: number }>> {
  const groups: Array<Array<{ start: number, end: number, index: number }>> = [];
  if (typeof text !== 'string' || !Array.isArray(matches) || matches.length === 0) return groups;
  const lineStarts = [0];
  for (let index = 0; index < text.length; index = index + 1) {
    if (text.charCodeAt(index) === 10) lineStarts.push(index + 1);
  }
  let line = 0;
  for (let index = 0; index < matches.length; index = index + 1) {
    const match = matches[index];
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= match.start) line = line + 1;
    const start = match.start - lineStarts[line];
    const end = Math.min(match.end - lineStarts[line], text.length - lineStarts[line]);
    if (groups[line] === undefined) groups[line] = [];
    groups[line].push({ start: start, end: end, index: index });
  }
  return groups;
}

/**
 * Build the highlight-layer children: plain text runs are transparent, match
 * runs paint a background, and the current match uses the accent fill.
 * @param text - current editor text.
 * @param matches - document-order matches.
 * @param current - index of the current match.
 * @returns React children for one absolute <pre>.
 */
function renderFindHighlights(text: string, matches: FindRange[], current: number): any[] {
  const groups = groupFindMatches(text, matches);
  const lines = text.split('\n');
  const children: any[] = [];
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex = lineIndex + 1) {
    const line = lines[lineIndex];
    const ranges = groups[lineIndex] === undefined ? [] : groups[lineIndex];
    let cursor = 0;
    for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex = rangeIndex + 1) {
      const range = ranges[rangeIndex];
      if (range.start > cursor) children.push(line.slice(cursor, range.start));
      children.push(
        h(
          'span',
          {
            key: 'find-' + String(lineIndex) + '-' + String(range.index),
            style: range.index === current ? ST_FILES.findMarkCurrent : ST_FILES.findMark,
          },
          line.slice(range.start, range.end),
        ),
      );
      cursor = range.end;
    }
    if (cursor < line.length) children.push(line.slice(cursor));
    if (lineIndex < lines.length - 1) children.push('\n');
  }
  return children;
}

S.findTextMatches = findTextMatches;
S.groupFindMatches = groupFindMatches;

/**
 * Score one path for the quick-open palette (JetBrains-style fuzzy match).
 * The query is matched as a case-insensitive subsequence; contiguous runs,
 * word boundaries and basename hits score extra. `-1` means no match.
 * @param query - typed query (may be empty).
 * @param filePath - candidate path.
 * @returns a score >= 0, or -1 when the query does not match.
 */
function quickOpenScore(query: string, filePath: string): number {
  if (typeof filePath !== 'string' || filePath.length === 0) return -1;
  if (typeof query !== 'string' || query.length === 0) return 0;
  const needle = query.toLowerCase();
  const haystack = filePath.toLowerCase();
  const slash = haystack.lastIndexOf('/');
  const baseStart = slash + 1;
  let score = 0;
  let cursor = 0;
  let previous = -2;
  for (let index = 0; index < needle.length; index = index + 1) {
    const found = haystack.indexOf(needle.charAt(index), cursor);
    if (found === -1) return -1;
    if (found === previous + 1) score += 3;
    else score += 1;
    if (found === 0 || haystack.charAt(found - 1) === '/' || haystack.charAt(found - 1) === '-' || haystack.charAt(found - 1) === '_' || haystack.charAt(found - 1) === '.') score += 2;
    if (found >= baseStart) score += 1;
    previous = found;
    cursor = found + 1;
  }
  // A contiguous basename hit beats scattered path matches by a wide margin.
  if (haystack.slice(baseStart).indexOf(needle) !== -1) score += 20;
  // Prefer shorter paths when scores tie.
  return score - filePath.length * 0.001;
}

/**
 * Rank candidate paths for the quick-open palette.
 * @param query - typed query.
 * @param files - indexed workspace paths.
 * @param limit - maximum results to return.
 * @returns ranked `{path, score}` rows, best first.
 */
function rankQuickOpen(query: string, files: string[], limit?: number): Array<{ path: string, score: number }> {
  const list = Array.isArray(files) ? files : [];
  const max = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  const ranked: Array<{ path: string, score: number }> = [];
  for (let index = 0; index < list.length; index = index + 1) {
    const filePath = list[index];
    const score = quickOpenScore(query, filePath);
    if (score < 0) continue;
    ranked.push({ path: filePath, score: score });
  }
  ranked.sort(function (left, right) {
    if (right.score !== left.score) return right.score - left.score;
    return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
  });
  return ranked.slice(0, max);
}

S.quickOpenScore = quickOpenScore;
S.rankQuickOpen = rankQuickOpen;

/**
 * Quick-open rows for an empty query: recently opened files first (most recent
 * first), then the remaining index in order — JetBrains' "Recent Files" feel.
 * @param recent - open history paths, oldest first.
 * @param files - full workspace index.
 * @param limit - maximum rows.
 * @returns ordered path list.
 */
function orderQuickFiles(recent: string[], files: string[], limit?: number): string[] {
  const list = Array.isArray(files) ? files : [];
  const max = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  const known = new Set(list);
  const seen = new Set<string>();
  const ordered: string[] = [];
  const history = Array.isArray(recent) ? recent : [];
  for (let index = history.length - 1; index >= 0; index = index - 1) {
    const path = history[index];
    if (typeof path !== 'string' || path.length === 0 || seen.has(path) || !known.has(path)) continue;
    seen.add(path);
    ordered.push(path);
    if (ordered.length >= max) return ordered;
  }
  for (let index = 0; index < list.length; index = index + 1) {
    const path = list[index];
    if (seen.has(path)) continue;
    seen.add(path);
    ordered.push(path);
    if (ordered.length >= max) break;
  }
  return ordered;
}

S.orderQuickFiles = orderQuickFiles;

/**
 * Quick-open palette rows for one query. Empty queries are recent-first; typed
 * queries use fuzzy ranking. Always returns `{path, score}` objects so the
 * palette renderer has one shape.
 * @param query - typed query.
 * @param files - workspace index.
 * @param recent - open history (oldest first).
 * @param limit - maximum rows.
 * @returns rows, best first.
 */
function quickOpenRows(query: string, files: string[], recent: string[], limit?: number): Array<{ path: string, score: number }> {
  const max = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 50;
  if (typeof query !== 'string' || query.trim().length === 0) {
    return orderQuickFiles(recent, files, max).map(function (filePath: string) {
      return { path: filePath, score: 0 };
    });
  }
  return rankQuickOpen(query, files, max);
}

S.quickOpenRows = quickOpenRows;

/** One navigable symbol in the current file. */
interface FileSymbol {
  name: string;
  line: number;
  kind: string;
  indent: number;
}

/**
 * Extract navigable symbols (functions/classes/types/constants/methods,
 * markdown headings, JSON keys) for Go-to-Symbol. Regex-based on purpose: it
 * must stay dependency-free and cheap on large files.
 * @param text - current editor text.
 * @param language - Host language chip.
 * @returns symbols in document order (capped at 400).
 */
function extractSymbols(text: any, language: any): FileSymbol[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const lang = typeof language === 'string' ? language.toLowerCase() : '';
  const markdown = lang === 'markdown' || lang === 'md';
  const jsonLike = lang === 'json' || lang === 'jsonc' || lang === 'json5';
  const lines = text.split('\n');
  const symbols: FileSymbol[] = [];
  for (let index = 0; index < lines.length; index = index + 1) {
    if (symbols.length >= 400) break;
    const raw = lines[index];
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const indentMatch = /^[ \t]*/.exec(raw);
    const indent = indentMatch === null ? 0 : indentMatch[0].replace(/\t/g, '  ').length;
    let match: RegExpExecArray | null;
    if (markdown) {
      match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(trimmed);
      if (match !== null) symbols.push({ name: match[2].trim(), line: index + 1, kind: 'heading', indent: 0 });
      continue;
    }
    if (jsonLike) {
      match = /^"([^"]+)"\s*:/.exec(trimmed);
      if (match !== null) symbols.push({ name: match[1], line: index + 1, kind: 'key', indent: indent });
      continue;
    }
    match = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
    if (match !== null) { symbols.push({ name: match[1], line: index + 1, kind: 'function', indent: indent }); continue; }
    match = /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
    if (match !== null) { symbols.push({ name: match[1], line: index + 1, kind: 'class', indent: indent }); continue; }
    match = /^(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/.exec(trimmed);
    if (match !== null) { symbols.push({ name: match[1], line: index + 1, kind: 'type', indent: indent }); continue; }
    match = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/.exec(trimmed);
    if (match !== null) { symbols.push({ name: match[1], line: index + 1, kind: 'constant', indent: indent }); continue; }
    if (indent > 0) {
      match = /^(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/.exec(trimmed);
      if (match !== null) symbols.push({ name: match[1], line: index + 1, kind: 'method', indent: indent });
    }
  }
  return symbols;
}

S.extractSymbols = extractSymbols;

/** Deepest symbol whose declaration is at or above `line` (breadcrumb scope). */
function symbolAtLine(symbols: any, line: any): any {
  if (!Array.isArray(symbols) || !Number.isFinite(line)) return null;
  let best: any = null;
  for (let index = 0; index < symbols.length; index = index + 1) {
    const symbol = symbols[index];
    if (symbol === null || symbol === undefined || !Number.isFinite(symbol.line)) continue;
    if (symbol.line > line) continue;
    if (best === null || symbol.line > best.line) best = symbol;
  }
  return best;
}

/** Line of the next/previous symbol relative to `line`, or null at the edge. */
function nextSymbolLine(symbols: any, line: any, direction: any): number | null {
  if (!Array.isArray(symbols) || !Number.isFinite(line)) return null;
  let best: number | null = null;
  for (let index = 0; index < symbols.length; index = index + 1) {
    const symbol = symbols[index];
    if (symbol === null || symbol === undefined || !Number.isFinite(symbol.line)) continue;
    if (direction < 0) {
      if (symbol.line < line && (best === null || symbol.line > best)) best = symbol.line;
    } else if (symbol.line > line && (best === null || symbol.line < best)) {
      best = symbol.line;
    }
  }
  return best;
}

S.symbolAtLine = symbolAtLine;
S.nextSymbolLine = nextSymbolLine;

/** Bracket pairs the editor understands for matching / auto-pairing. */
const BRACKET_PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const BRACKET_CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const QUOTE_CHARS = new Set(['"', "'", '`']);

/** One matched bracket pair (absolute indices into the text). */
interface BracketPair {
  open: number;
  close: number;
}

/**
 * Find the bracket pair adjacent to the caret (JetBrains-style matching).
 * Checks the character right before and right after the caret; nested pairs of
 * the same kind are balanced. Returns null when no bracket touches the caret.
 * @param text - editor text.
 * @param index - caret offset.
 * @returns the matched pair, or null.
 */
function bracketMatch(text: string, index: number): BracketPair | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  const caret = Number.isFinite(index) ? Math.max(0, Math.min(text.length, Math.floor(index))) : 0;
  const candidates = [caret - 1, caret];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const position = candidates[candidateIndex];
    if (position < 0 || position >= text.length) continue;
    const char = text.charAt(position);
    const openerClose = BRACKET_PAIRS[char];
    if (openerClose !== undefined) {
      let depth = 0;
      for (let cursor = position + 1; cursor < text.length; cursor = cursor + 1) {
        const current = text.charAt(cursor);
        if (current === char) depth = depth + 1;
        else if (current === openerClose) {
          if (depth === 0) return { open: position, close: cursor };
          depth = depth - 1;
        }
      }
      continue;
    }
    const closerOpen = BRACKET_CLOSERS[char];
    if (closerOpen !== undefined) {
      let depth = 0;
      for (let cursor = position - 1; cursor >= 0; cursor = cursor - 1) {
        const current = text.charAt(cursor);
        if (current === char) depth = depth + 1;
        else if (current === closerOpen) {
          if (depth === 0) return { open: cursor, close: position };
          depth = depth - 1;
        }
      }
    }
  }
  return null;
}

/**
 * Auto-pair / over-type edit for one typed character (JetBrains behaviour).
 * @param text - current text.
 * @param start - selection start.
 * @param end - selection end.
 * @param char - typed single character.
 * @returns the edit (or null when the character is not paired/over-typed).
 */
function autoPairEdit(text: string, start: number, end: number, char: string): any {
  if (typeof text !== 'string' || typeof char !== 'string' || char.length !== 1) return null;
  const from = Number.isFinite(start) ? Math.max(0, Math.min(text.length, Math.floor(start))) : 0;
  const to = Number.isFinite(end) ? Math.max(from, Math.min(text.length, Math.floor(end))) : from;
  const selection = text.slice(from, to);
  const closing = BRACKET_PAIRS[char];
  const isQuote = QUOTE_CHARS.has(char);
  if (closing === undefined && isQuote === false) {
    // Over-type a closing bracket when the same character is already ahead.
    if (BRACKET_CLOSERS[char] !== undefined && text.charAt(from) === char) {
      return { text: text, selectionStart: from + 1, selectionEnd: from + 1, skip: true };
    }
    return null;
  }
  if (selection.length > 0) {
    const pair = isQuote ? char : closing;
    const next = text.slice(0, from) + char + selection + pair + text.slice(to);
    return { text: next, selectionStart: from + 1, selectionEnd: from + 1 + selection.length, skip: false };
  }
  if (text.charAt(from) === char) {
    return { text: text, selectionStart: from + 1, selectionEnd: from + 1, skip: true };
  }
  // No pairing inside words (typing `'` as an apostrophe, or directly before
  // an identifier) — that is how a plain-text editor feels.
  const previousChar = from > 0 ? text.charAt(from - 1) : '';
  const nextChar = text.charAt(from);
  if (/[A-Za-z0-9_$]/.test(previousChar) && (isQuote || char === '{')) return null;
  if (/[A-Za-z0-9_$]/.test(nextChar)) return null;
  const pair = isQuote ? char : closing;
  const next = text.slice(0, from) + char + pair + text.slice(from);
  return { text: next, selectionStart: from + 1, selectionEnd: from + 1, skip: false };
}

/**
 * Smart-indent edit for Enter: keep the current line's indentation and add one
 * level after an opening bracket/paren (JetBrains behaviour).
 * @param text - current text.
 * @param start - selection start.
 * @param end - selection end.
 * @returns the edit, or null when the text does not need custom handling.
 */
function smartIndentEdit(text: string, start: number, end: number): any {
  if (typeof text !== 'string') return null;
  const from = Number.isFinite(start) ? Math.max(0, Math.min(text.length, Math.floor(start))) : 0;
  const to = Number.isFinite(end) ? Math.max(from, Math.min(text.length, Math.floor(end))) : from;
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  const before = text.slice(lineStart, from);
  const indentMatch = /^[ \t]*/.exec(before);
  const indent = indentMatch === null ? '' : indentMatch[0];
  const extra = /[{[(]\s*$/.test(before) ? '  ' : '';
  const insert = '\n' + indent + extra;
  const next = text.slice(0, from) + insert + text.slice(to);
  return { text: next, selectionStart: from + insert.length, selectionEnd: from + insert.length };
}

S.bracketMatch = bracketMatch;
S.autoPairEdit = autoPairEdit;
S.smartIndentEdit = smartIndentEdit;

/** Clamp one offset into a text buffer. */
function clampEditOffset(text: string, value: any): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(text.length, Math.floor(value))) : 0;
}

/** Line range covering a selection (`lineEnd` excludes the trailing newline). */
function selectionLineRange(text: string, start: number, end: number): any {
  const from = clampEditOffset(text, start);
  const to = Math.max(from, clampEditOffset(text, end));
  const lineStart = text.lastIndexOf('\n', from - 1) + 1;
  let lineEnd = text.indexOf('\n', to);
  if (lineEnd === -1) lineEnd = text.length;
  return { from: from, to: to, lineStart: lineStart, lineEnd: lineEnd };
}

/**
 * Duplicate the current line (or selected lines), JetBrains Ctrl+D.
 * @param text - current text.
 * @param start - selection start.
 * @param end - selection end.
 * @returns the edit, or null for a non-string buffer.
 */
function duplicateLines(text: any, start: number, end: number): any {
  if (typeof text !== 'string') return null;
  const range = selectionLineRange(text, start, end);
  const block = text.slice(range.lineStart, range.lineEnd);
  const next = text.slice(0, range.lineEnd) + '\n' + block + text.slice(range.lineEnd);
  return { text: next, selectionStart: range.from, selectionEnd: range.to };
}

/**
 * Move the current line (or selected lines) one line up/down, JetBrains
 * Alt+Shift+Up/Down. Returns null at the buffer edge.
 * @param text - current text.
 * @param start - selection start.
 * @param end - selection end.
 * @param direction - -1 moves up, 1 moves down.
 * @returns the edit, or null when the move is impossible.
 */
function moveLines(text: any, start: number, end: number, direction: number): any {
  if (typeof text !== 'string') return null;
  const range = selectionLineRange(text, start, end);
  const block = text.slice(range.lineStart, range.lineEnd);
  if (direction < 0) {
    if (range.lineStart === 0) return null;
    const previousStart = text.lastIndexOf('\n', range.lineStart - 2) + 1;
    const previousLine = text.slice(previousStart, range.lineStart - 1);
    const next = text.slice(0, previousStart) + block + '\n' + previousLine + text.slice(range.lineEnd);
    const delta = -(range.lineStart - previousStart);
    return { text: next, selectionStart: range.from + delta, selectionEnd: range.to + delta };
  }
  if (range.lineEnd >= text.length) return null;
  const nextNewline = text.indexOf('\n', range.lineEnd + 1);
  const nextLineEnd = nextNewline === -1 ? text.length : nextNewline;
  const nextLine = text.slice(range.lineEnd + 1, nextLineEnd);
  const next = text.slice(0, range.lineStart) + nextLine + '\n' + block + text.slice(nextLineEnd);
  const delta = nextLine.length + 1;
  return { text: next, selectionStart: range.from + delta, selectionEnd: range.to + delta };
}

S.duplicateLines = duplicateLines;
S.moveLines = moveLines;

/**
 * Toggle the case of the selected text (JetBrains Ctrl+Shift+U): if the
 * selection contains uppercase it folds to lowercase, otherwise it folds to
 * uppercase. No selection is a no-op.
 * @param text - current text.
 * @param start - selection start.
 * @param end - selection end.
 * @returns the edit, or null when nothing is selected.
 */
function toggleCaseEdit(text: any, start: number, end: number): any {
  if (typeof text !== 'string') return null;
  const from = clampEditOffset(text, start);
  const to = Math.max(from, clampEditOffset(text, end));
  if (to === from) return null;
  const selection = text.slice(from, to);
  const next = /[A-Z]/.test(selection) ? selection.toLowerCase() : selection.toUpperCase();
  return { text: text.slice(0, from) + next + text.slice(to), selectionStart: from, selectionEnd: to };
}

/**
 * Join the current line with the next one (JetBrains Ctrl+Shift+J): trailing
 * spaces of the first line and leading spaces of the next are collapsed into a
 * single space. The last line is a no-op.
 * @param text - current text.
 * @param start - selection start.
 * @param end - selection end.
 * @returns the edit, or null at the buffer edge.
 */
function joinLinesEdit(text: any, start: number, end: number): any {
  if (typeof text !== 'string') return null;
  const range = selectionLineRange(text, start, end);
  if (range.lineEnd >= text.length) return null;
  const nextNewline = text.indexOf('\n', range.lineEnd + 1);
  const nextLineEnd = nextNewline === -1 ? text.length : nextNewline;
  const first = text.slice(range.lineStart, range.lineEnd).replace(/[ \t]+$/, '');
  const second = text.slice(range.lineEnd + 1, nextLineEnd).replace(/^[ \t]+/, '');
  const joined = first + (first.length > 0 && second.length > 0 ? ' ' : '') + second;
  const next = text.slice(0, range.lineStart) + joined + text.slice(nextLineEnd);
  const caret = range.lineStart + (first.length > 0 ? first.length : joined.length);
  return { text: next, selectionStart: caret, selectionEnd: caret };
}

S.toggleCaseEdit = toggleCaseEdit;
S.joinLinesEdit = joinLinesEdit;

/**
 * Indent / outdent every line touched by the selection (Tab / Shift+Tab).
 * @param text - current text.
 * @param start - selection start.
 * @param end - selection end.
 * @param dedent - true removes up to two leading spaces/tabs per line.
 * @returns the edit, or null when nothing changes.
 */
function indentLines(text: any, start: number, end: number, dedent: boolean): any {
  if (typeof text !== 'string') return null;
  const range = selectionLineRange(text, start, end);
  const block = text.slice(range.lineStart, range.lineEnd);
  const lines = block.split('\n');
  const shifts: number[] = [];
  const nextLines = lines.map(function (lineText: string) {
    if (dedent === true) {
      const match = /^[ \t]{1,2}/.exec(lineText);
      const removed = match === null ? 0 : match[0].length;
      shifts.push(-removed);
      return lineText.slice(removed);
    }
    const added = lineText.length > 0 ? 2 : 0;
    shifts.push(added);
    return added === 0 ? lineText : '  ' + lineText;
  });
  const nextBlock = nextLines.join('\n');
  if (nextBlock === block) return null;
  const next = text.slice(0, range.lineStart) + nextBlock + text.slice(range.lineEnd);
  const firstShift = shifts.length > 0 ? shifts[0] : 0;
  const lastShift = shifts.length > 0 ? shifts[shifts.length - 1] : 0;
  return {
    text: next,
    selectionStart: Math.max(range.lineStart, range.from + firstShift),
    selectionEnd: Math.max(range.lineStart, range.to + lastShift),
  };
}

S.indentLines = indentLines;

/**
 * Parse a unified git diff into gutter decorations: `line -> added|deleted|modified`.
 * Added lines come from `+` rows, deletions are pinned to the new-file line at
 * which they occur, and a hunk that both removes and adds rows marks the added
 * rows as `modified` (JetBrains green/red/blue gutter).
 * @param diff - unified diff text from the Host `git` route.
 * @returns line-number keyed decoration map.
 */
function parseGitGutter(diff: any): Record<number, string> {
  const markers: Record<number, string> = {};
  if (typeof diff !== 'string' || diff.length === 0) return markers;
  const lines = diff.split('\n');
  for (let index = 0; index < lines.length; index = index + 1) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(lines[index]);
    if (header === null) continue;
    let newLine = Number(header[1]);
    if (!Number.isFinite(newLine) || newLine < 1) newLine = 1;
    let hadDeletion = false;
    let hadAddition = false;
    for (let cursor = index + 1; cursor < lines.length; cursor = cursor + 1) {
      const line = lines[cursor];
      if (/^@@ /.test(line) || line.indexOf('diff --git ') === 0) {
        index = cursor - 1;
        break;
      }
      if (line.length === 0) continue;
      const first = line.charAt(0);
      if (first === '+') {
        if (line.indexOf('+++ ') !== 0) {
          markers[newLine] = hadDeletion ? 'modified' : 'added';
          hadAddition = true;
          newLine = newLine + 1;
        }
      } else if (first === '-') {
        if (line.indexOf('--- ') !== 0) {
          hadDeletion = true;
          if (markers[newLine] === undefined) markers[newLine] = 'deleted';
        }
      } else if (first === ' ') {
        newLine = newLine + 1;
      }
    }
    if (hadAddition === false && hadDeletion === true) {
      // A pure deletion is shown on the line that now follows it.
      const target = Math.max(1, newLine);
      if (markers[target] === undefined) markers[target] = 'deleted';
    }
  }
  return markers;
}

S.parseGitGutter = parseGitGutter;

/** Sorted bookmark line numbers for one file after toggling `line`. */
function toggleBookmarkLine(lines: any, line: any): number[] {
  const list: number[] = Array.isArray(lines)
    ? lines.filter(function (value: any) { return Number.isFinite(value); }).map(function (value: number) { return Math.floor(value); })
    : [];
  const target = Number.isFinite(line) ? Math.floor(line) : -1;
  if (target < 1) return list;
  const index = list.indexOf(target);
  if (index >= 0) list.splice(index, 1);
  else list.push(target);
  list.sort(function (left, right) { return left - right; });
  return list;
}

/** Flatten the per-file bookmark map into `{path, line}` rows for the palette. */
function flattenBookmarks(map: any): Array<{ path: string, line: number }> {
  if (map === null || typeof map !== 'object') return [];
  const rows: Array<{ path: string, line: number }> = [];
  Object.keys(map).forEach(function (filePath: string) {
    const lines = map[filePath];
    if (!Array.isArray(lines)) return;
    lines.forEach(function (line: any) {
      if (Number.isFinite(line)) rows.push({ path: filePath, line: Math.floor(line) });
    });
  });
  rows.sort(function (left, right) {
    if (left.path !== right.path) return left.path < right.path ? -1 : 1;
    return left.line - right.line;
  });
  return rows;
}

S.toggleBookmarkLine = toggleBookmarkLine;
S.flattenBookmarks = flattenBookmarks;

/**
 * Build JetBrains-style breadcrumb nodes for one path. Intermediate segments
 * are buttons that reveal their directory in the tree; the last one is the file.
 * @param segments - path segments, root-first.
 * @param onBreadcrumb - reveal callback for directory prefixes (null when inert).
 * @param revealHint - tooltip for clickable segments.
 * @returns React nodes for the breadcrumb row.
 */
function breadcrumbNodes(segments: string[], onBreadcrumb: Function | null, revealHint: string): any[] {
  return segments.map(function (segment: string, index: number) {
    const prefix = segments.slice(0, index + 1).join('/');
    const last = index === segments.length - 1;
    const clickable = last === false && typeof onBreadcrumb === 'function';
    const content = clickable
      ? h(
          'button',
          {
            type: 'button',
            key: 'crumb-' + String(index),
            style: ST_FILES.crumbButton,
            title: revealHint,
            'aria-label': revealHint + ': ' + prefix,
            onClick: function () {
              if (typeof onBreadcrumb === 'function') onBreadcrumb(prefix);
            },
          },
          segment,
        )
      : h('span', { key: 'crumb-' + String(index), style: last ? ST_FILES.crumbLast : ST_FILES.crumb }, segment);
    return h(
      'span',
      { key: 'seg-' + String(index), style: { display: 'inline-flex', alignItems: 'center', minWidth: 0 } },
      index === 0 ? null : h('span', { key: 'sep-' + String(index), style: ST_FILES.crumbSep }, '›'),
      content,
    );
  });
}

/**
 * @param {number} count - line count.
 * @returns {string} newline-separated right-aligned line numbers (one <pre>).
 */
function lineNumbersText(count: number): string {
  const total = Math.max(1, Number.isFinite(count) ? Math.floor(count) : 1);
  const rows: any[] = [];
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
function isPlainHighlight(lines: Array<Array<Array<string>>>): boolean {
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
function renderSyntaxChildren(lines: Array<Array<Array<string>>>): any[] {
  const children: any[] = [];
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
function caretFromIndex(text: string, index: number): any {
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
function keepTreeEntry(entry: TreeEntry): boolean {
  if (entry === null || entry === undefined) return false;
  if (typeof entry.name !== 'string' || typeof entry.path !== 'string') return false;
  if (entry.name === '.git' || entry.name === '.DS_Store') return false;
  return true;
}

/** One clickable row in the workspace tree (pure). */
function FileTreeRow(props: any) {
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
function TreeDirRows(props: any) {
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
  const rows: any[] = [];
  entries.forEach(function (entry: any) {
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
function ImageViewer(props: any) {
  const t = props.t;
  const segments = typeof props.path === 'string' && props.path.length > 0 ? props.path.split('/') : [];
  const dimensions = props.dimensions !== null && props.dimensions !== undefined ? props.dimensions : null;
  const size = Number.isFinite(props.size) ? props.size : 0;
  const onImageLoad = function (event: any) {
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
      typeof props.onNavigateBack === 'function'
        ? h(
            S.ToolButton,
            {
              title: t('action.back'),
              ariaLabel: t('action.back'),
              disabled: props.canGoBack !== true,
              style: { width: 22, height: 22 },
              onClick: props.onNavigateBack,
            },
            h('span', { style: { display: 'inline-flex', transform: 'rotate(-90deg)' } }, h(S.Icons.Chevron, { size: 13 })),
          )
        : null,
      typeof props.onNavigateForward === 'function'
        ? h(
            S.ToolButton,
            {
              title: t('action.forward'),
              ariaLabel: t('action.forward'),
              disabled: props.canGoForward !== true,
              style: { width: 22, height: 22 },
              onClick: props.onNavigateForward,
            },
            h('span', { style: { display: 'inline-flex', transform: 'rotate(90deg)' } }, h(S.Icons.Chevron, { size: 13 })),
          )
        : null,
      h(
        'div',
        { style: ST_FILES.breadcrumb, title: props.path },
        breadcrumbNodes(
          segments,
          typeof props.onBreadcrumb === 'function' ? props.onBreadcrumb : null,
          t('files.revealHint'),
        ),
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

/**
 * Editor tab strip: one entry per open file, with dirty dot and close button.
 * @param props - `{t, tabs: [{path, dirty, active}], onSelect, onClose, label}`.
 */
function TabStrip(props: any) {
  const t = props.t;
  const tabs = Array.isArray(props.tabs) ? props.tabs : [];
  if (tabs.length === 0) return null;
  return h(
    'div',
    { style: ST_FILES.tabBar, role: 'tablist', 'aria-label': typeof props.label === 'string' ? props.label : 'tabs' },
    tabs.map(function (tab: any, index: number) {
      const path = tab !== null && tab !== undefined && typeof tab.path === 'string' ? tab.path : '';
      const label = typeof S.baseName === 'function' ? S.baseName(path) : path;
      const active = tab !== null && tab !== undefined && tab.active === true;
      return h(
        'div',
        {
          key: 'tab-' + String(index) + '-' + path,
          role: 'tab',
          'aria-selected': active ? 'true' : 'false',
          title: path,
          style: Object.assign({}, ST_FILES.tab, active ? ST_FILES.tabActive : null),
          onMouseDown: function (event: any) {
            if (event !== null && event !== undefined) {
              if (typeof event.preventDefault === 'function') event.preventDefault();
              if (event.button === 1 && typeof props.onClose === 'function') {
                props.onClose(path);
                return;
              }
            }
            if (typeof props.onSelect === 'function') props.onSelect(path);
          },
        },
        h('span', { style: ST_FILES.tabFileIcon }, h(S.Icons.File, { size: 12 })),
        h('span', { style: ST_FILES.tabLabel }, label.length > 0 ? label : path),
        tab !== null && tab !== undefined && tab.dirty === true
          ? h('span', { style: ST_FILES.tabDirty, title: t('files.modified') }, h(S.Icons.Dot, { size: 8 }))
          : null,
        h(
          'button',
          {
            type: 'button',
            title: t('files.tab.close'),
            'aria-label': t('files.tab.close'),
            style: ST_FILES.tabClose,
            onMouseDown: function (event: any) {
              if (event !== null && event !== undefined) {
                if (typeof event.preventDefault === 'function') event.preventDefault();
                if (typeof event.stopPropagation === 'function') event.stopPropagation();
              }
              if (typeof props.onClose === 'function') props.onClose(path);
            },
          },
          h(S.Icons.Close, { size: 10 }),
        ),
      );
    }),
  );
}

/** The code viewer pane: header, gutter + textarea (or read-only pre), status bar. */
function FileViewer(props: any) {
  const t = props.t;
  const readOnly = props.readOnly === true;
  const wrap = props.wrap === true;
  const gotoOpen = props.gotoOpen === true;
  const gotoValue = typeof props.gotoValue === 'string' ? props.gotoValue : '';
  const selection = Number.isFinite(props.selection) && props.selection > 0 ? Math.floor(props.selection) : 0;
  const eolLabel = props.eol === '\r\n' ? 'CRLF' : 'LF';
  const gotoInputRef = useRef<any>(null);
  const findInputRef = useRef<any>(null);
  const findRef = useRef<any>(null);
  const findOpen = props.findOpen === true;
  const findReplace = props.findReplace === true;
  const findQuery = typeof props.findQuery === 'string' ? props.findQuery : '';
  const findReplacement = typeof props.findReplacement === 'string' ? props.findReplacement : '';
  const findMatches: FindRange[] = Array.isArray(props.findMatches) ? props.findMatches : [];
  const findCurrent = Number.isFinite(props.findCurrent) ? Math.max(0, Math.floor(props.findCurrent)) : 0;
  const findInvalidRegex = props.findInvalidRegex === true;
  const bookmarkLines: number[] = Array.isArray(props.bookmarkLines) ? props.bookmarkLines : [];
  const gitMarkers: Array<{ line: number, kind: string }> = Array.isArray(props.gitMarkers) ? props.gitMarkers : [];
  const currentSymbol: any = props.currentSymbol !== null && props.currentSymbol !== undefined ? props.currentSymbol : null;
  const zoom = Number.isFinite(props.zoom) ? Math.min(2, Math.max(0.5, Number(props.zoom))) : 1;
  const zoomFont = Math.round(12.5 * zoom * 10) / 10;
  const zoomGutterFont = Math.round(11.5 * zoom * 10) / 10;
  const zoomLine = Math.round(EDITOR_LINE_HEIGHT * zoom * 100) / 100;
  const zoomPadTop = Math.round(EDITOR_PADDING_TOP * zoom * 100) / 100;
  const zoomPadBottom = Math.round(24 * zoom * 100) / 100;
  const zoomGutterWidth = Math.round(58 * zoom);
  const editorTextStyle = Object.assign({}, ST_FILES.textarea, wrap === true ? ST_FILES.textareaWrap : null, {
    fontSize: zoomFont + 'px',
    lineHeight: zoomLine + 'px',
    padding: zoomPadTop + 'px 16px ' + zoomPadBottom + 'px 12px',
  });
  const editorSyntaxStyle = Object.assign({}, ST_FILES.syntaxCode, wrap === true ? ST_FILES.syntaxCodeWrap : null, {
    fontSize: zoomFont + 'px',
    lineHeight: zoomLine + 'px',
    padding: zoomPadTop + 'px 16px ' + zoomPadBottom + 'px 12px',
  });
  const editorFindStyle = Object.assign({}, ST_FILES.findCode, wrap === true ? ST_FILES.syntaxCodeWrap : null, {
    fontSize: zoomFont + 'px',
    lineHeight: zoomLine + 'px',
    padding: zoomPadTop + 'px 16px ' + zoomPadBottom + 'px 12px',
  });
  const editorGutterStyle = Object.assign({}, ST_FILES.gutter, {
    fontSize: zoomGutterFont + 'px',
    lineHeight: zoomLine + 'px',
    padding: zoomPadTop + 'px 9px ' + zoomPadBottom + 'px 0',
  });
  const editorGutterWrapStyle = Object.assign({}, ST_FILES.gutterWrap, { width: zoomGutterWidth });
  const editorReadOnlyGutterStyle = Object.assign({}, ST_FILES.readOnlyGutter, {
    width: zoomGutterWidth,
    fontSize: zoomGutterFont + 'px',
    lineHeight: zoomLine + 'px',
    padding: zoomPadTop + 'px 9px ' + zoomPadBottom + 'px 0',
  });
  const editorReadOnlyCodeStyle = Object.assign({}, ST_FILES.readOnlyCode, wrap === true ? ST_FILES.readOnlyCodeWrap : null, {
    fontSize: zoomFont + 'px',
    lineHeight: zoomLine + 'px',
    padding: zoomPadTop + 'px 16px ' + zoomPadBottom + 'px 12px',
  });
  const findCase = props.findCase === true;
  const findWhole = props.findWhole === true;
  const findRegex = props.findRegex === true;
  const bracketRanges: Array<{ start: number, end: number }> = Array.isArray(props.bracketRanges) ? props.bracketRanges : [];
  const bracketRef = useRef<any>(null);
  const [editorScrollTop, setEditorScrollTop] = useState(0);

  const findHighlight = useMemo(
    function () {
      if (findOpen === false || findMatches.length === 0 || readOnly === true) return null;
      return renderFindHighlights(props.value, findMatches, findCurrent);
    },
    [findOpen, props.value, findMatches, findCurrent, readOnly],
  );

  const bracketHighlight = useMemo(
    function () {
      if (findOpen === true || readOnly === true || bracketRanges.length === 0) return null;
      return renderFindHighlights(props.value, bracketRanges, 0);
    },
    [findOpen, props.value, bracketRanges, readOnly],
  );

  // Current line + indent guides for the visible window (JetBrains shows the
  // guides only where a line is actually indented). Hidden in wrap mode and
  // for non-editable bodies, where visual lines no longer match logical lines.
  const guideChildren = useMemo(
    function () {
      if (wrap === true || readOnly === true) return null;
      if (props.language === 'markdown' && props.markdownMode === 'preview') return null;
      if (props.isSvg === true && props.svgMode !== 'source') return null;
      const lines = String(props.value === null || props.value === undefined ? '' : props.value).split('\n');
      const children: any[] = [];
      const caretLine = props.caret !== null && props.caret !== undefined && Number.isFinite(props.caret.line) ? Math.floor(props.caret.line) : 0;
      if (caretLine > 0 && caretLine <= lines.length) {
        children.push(h('div', {
          key: 'current-line',
          style: Object.assign({}, ST_FILES.currentLine, {
            top: zoomPadTop + (caretLine - 1) * zoomLine + 'px',
            height: zoomLine + 'px',
          }),
        }));
      }
      const firstVisible = Math.max(1, Math.floor((editorScrollTop - zoomPadTop) / zoomLine) + 1);
      const lastVisible = Math.min(lines.length, firstVisible + 80);
      for (let lineNumber = firstVisible; lineNumber <= lastVisible; lineNumber = lineNumber + 1) {
        const text = lines[lineNumber - 1];
        const indentMatch = /^[ \t]*/.exec(text);
        const indentChars = indentMatch === null ? 0 : indentMatch[0].replace(/\t/g, '  ').length;
        const levels = Math.min(10, Math.floor(indentChars / 2));
        for (let level = 1; level <= levels; level = level + 1) {
          children.push(h('div', {
            key: 'guide-' + String(lineNumber) + '-' + String(level),
            style: Object.assign({}, ST_FILES.guideLine, {
              top: zoomPadTop + (lineNumber - 1) * zoomLine + 'px',
              left: Math.round(12 * zoom) + level * Math.round(15 * zoom) + 'px',
              height: zoomLine + 'px',
            }),
          }));
        }
      }
      return children;
    },
    [props.value, props.caret, editorScrollTop, wrap, readOnly, zoom, zoomLine, zoomPadTop],
  );

  useEffect(function () {
    if (findOpen === false) return undefined;
    const input = findInputRef.current;
    if (input === null || input === undefined || typeof input.focus !== 'function') return undefined;
    try {
      input.focus();
      input.select();
    } catch (error) {
      /* focus is a nicety */
    }
    return undefined;
  }, [findOpen]);

  useEffect(function () {
    if (gotoOpen === false) return undefined;
    const input = gotoInputRef.current;
    if (input === null || input === undefined || typeof input.focus !== 'function') return undefined;
    try {
      input.focus();
      input.select();
    } catch (error) {
      /* focus is a nicety */
    }
    return undefined;
  }, [gotoOpen]);
  const dirty = props.dirty === true;
  const isMarkdown = props.language === 'markdown';
  const markdownMode = props.markdownMode === 'preview' ? 'preview' : 'source';
  const previewMode = isMarkdown && markdownMode === 'preview';
  const isSvg = props.isSvg === true;
  const svgMode = props.svgMode === 'source' ? 'source' : 'image';
  const svgImageMode = isSvg && svgMode === 'image';
  const dimensions = props.dimensions !== null && props.dimensions !== undefined ? props.dimensions : null;
  const onImageLoad = function (event: any) {
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
      let lines: any[] = [];
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
  const syntaxRef = useRef<any>(null);

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
      const transform = 'translate(' + String(-left) + 'px, ' + String(-top) + 'px)';
      layer.style.transform = transform;
      const highlights = findRef.current;
      if (highlights !== null && highlights !== undefined) highlights.style.transform = transform;
      const brackets = bracketRef.current;
      if (brackets !== null && brackets !== undefined) brackets.style.transform = transform;
    },
    [textareaRef],
  );

  // A line jump (search hit, file switch) sets textarea.scrollTop directly; the
  // resulting native scroll event re-syncs the overlay, and this effect covers
  // the first paint for a freshly opened file so the layer starts at zero.
  useEffect(function () {
    syncSyntaxScroll();
    return undefined;
  }, [props.path, syncSyntaxScroll, findHighlight, bracketRanges]);

  function handleEditorScroll(event: any) {
    syncSyntaxScroll();
    const target = event !== null && event !== undefined ? event.target : null;
    if (target !== null && target !== undefined && Number.isFinite(target.scrollTop)) setEditorScrollTop(Math.max(0, Math.floor(target.scrollTop)));
    if (typeof props.onScroll === 'function') props.onScroll(event);
  }

  const syntaxActive = readOnly === false && highlight.plain === false;

  return h(
    'div',
    { style: ST_FILES.viewer },
    h(
      'div',
      { style: ST_FILES.viewerHeader },
      typeof props.onNavigateBack === 'function'
        ? h(
            S.ToolButton,
            {
              title: t('action.back'),
              ariaLabel: t('action.back'),
              disabled: props.canGoBack !== true,
              style: { width: 22, height: 22 },
              onClick: props.onNavigateBack,
            },
            h('span', { style: { display: 'inline-flex', transform: 'rotate(-90deg)' } }, h(S.Icons.Chevron, { size: 13 })),
          )
        : null,
      typeof props.onNavigateForward === 'function'
        ? h(
            S.ToolButton,
            {
              title: t('action.forward'),
              ariaLabel: t('action.forward'),
              disabled: props.canGoForward !== true,
              style: { width: 22, height: 22 },
              onClick: props.onNavigateForward,
            },
            h('span', { style: { display: 'inline-flex', transform: 'rotate(90deg)' } }, h(S.Icons.Chevron, { size: 13 })),
          )
        : null,
      h(
        'div',
        { style: ST_FILES.breadcrumb, title: props.path },
        breadcrumbNodes(
          segments,
          typeof props.onBreadcrumb === 'function' ? props.onBreadcrumb : null,
          t('files.revealHint'),
        ),
      ),
      currentSymbol !== null && typeof currentSymbol.name === 'string' && currentSymbol.name.length > 0
        ? h(
            'span',
            { style: ST_FILES.currentSymbol, title: t('symbols.kind.' + String(currentSymbol.kind)) },
            '› ',
            currentSymbol.name,
          )
        : null,
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
      typeof props.onReload === 'function'
        ? h(
            S.ToolButton,
            { title: t('action.reload'), ariaLabel: t('action.reload'), style: { width: 24, height: 24 }, onClick: props.onReload },
            h(S.Icons.Refresh, { size: 13 }),
          )
        : null,
      typeof props.onToggleWrap === 'function'
        ? h(
            S.ToolButton,
            {
              title: t('files.wrapHint'),
              ariaLabel: t('action.wrap'),
              active: wrap,
              style: { width: 24, height: 24 },
              onClick: props.onToggleWrap,
            },
            h(S.Icons.Wrap, { size: 13 }),
          )
        : null,
      typeof props.onGotoOpen === 'function'
        ? h(
            S.ToolButton,
            {
              title: t('files.gotoHint'),
              ariaLabel: t('action.gotoLine'),
              active: gotoOpen,
              style: { width: 24, height: 24 },
              onClick: props.onGotoOpen,
            },
            h(S.Icons.GoToLine, { size: 13 }),
          )
        : null,
      typeof props.onFindOpen === 'function'
        ? h(
            S.ToolButton,
            {
              title: t('find.label'),
              ariaLabel: t('find.label'),
              active: findOpen,
              style: { width: 24, height: 24 },
              onClick: props.onFindOpen,
            },
            h(S.Icons.Search, { size: 13 }),
          )
        : null,
      typeof props.onSymbolsOpen === 'function'
        ? h(
            S.ToolButton,
            {
              title: t('symbols.label'),
              ariaLabel: t('symbols.label'),
              active: props.symbolsOpen === true,
              style: { width: 24, height: 24 },
              onClick: props.onSymbolsOpen,
            },
            h(S.Icons.Symbol, { size: 13 }),
          )
        : null,
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
    gotoOpen
      ? h(
          'div',
          { style: ST_FILES.gotoBar, role: 'search', 'aria-label': t('action.gotoLine') },
          h('span', { style: ST_FILES.gotoLabel }, t('action.gotoLine')),
          h('input', {
            ref: gotoInputRef,
            type: 'text',
            inputMode: 'numeric',
            value: gotoValue,
            placeholder: t('files.gotoPlaceholder'),
            'aria-label': t('files.gotoPlaceholder'),
            style: ST_FILES.gotoInput,
            onChange: function (event: any) {
              if (typeof props.onGotoChange === 'function') props.onGotoChange(event);
            },
            onKeyDown: function (event: any) {
              if (event === null || event === undefined) return;
              if (event.key === 'Enter') {
                event.preventDefault();
                if (typeof props.onGotoSubmit === 'function') props.onGotoSubmit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                if (typeof props.onGotoClose === 'function') props.onGotoClose();
              }
            },
          }),
          h(
            S.PrimaryButton,
            { title: t('files.gotoSubmit'), ariaLabel: t('files.gotoSubmit'), onClick: props.onGotoSubmit },
            t('files.gotoSubmit'),
          ),
          h(
            S.ToolButton,
            { title: t('action.dismiss'), ariaLabel: t('action.dismiss'), style: { width: 24, height: 24 }, onClick: props.onGotoClose },
            h(S.Icons.Close, { size: 12 }),
          ),
        )
      : null,
    findOpen
      ? h(
          'div',
          { style: ST_FILES.findBar, role: 'search', 'aria-label': t('find.label') },
          h(
            'div',
            { style: ST_FILES.findRow },
            h('input', {
              ref: findInputRef,
              type: 'text',
              value: findQuery,
              placeholder: t('find.placeholder'),
              'aria-label': t('find.placeholder'),
              style: ST_FILES.findInput,
              onChange: function (event: any) {
                if (typeof props.onFindChange === 'function') props.onFindChange(event);
              },
              onKeyDown: function (event: any) {
                if (event === null || event === undefined) return;
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const handler = event.shiftKey === true ? props.onFindPrev : props.onFindNext;
                  if (typeof handler === 'function') handler();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  if (typeof props.onFindClose === 'function') props.onFindClose();
                }
              },
            }),
            h(
              'span',
              { style: findInvalidRegex ? ST_FILES.findError : ST_FILES.findCount },
              findQuery.length === 0
                ? ''
                : findInvalidRegex
                  ? t('find.invalidRegex')
                  : findMatches.length === 0
                    ? t('find.noMatches')
                    : t('find.count', { current: String(findCurrent + 1), total: String(findMatches.length) }),
            ),
            h(
              S.ToolButton,
              { title: t('find.prev'), ariaLabel: t('find.prev'), style: { width: 24, height: 24 }, onClick: props.onFindPrev },
              h('span', { style: { fontSize: 11 } }, '↑'),
            ),
            h(
              S.ToolButton,
              { title: t('find.next'), ariaLabel: t('find.next'), style: { width: 24, height: 24 }, onClick: props.onFindNext },
              h('span', { style: { fontSize: 11 } }, '↓'),
            ),
            h(
              'button',
              {
                type: 'button',
                title: t('find.case'),
                'aria-label': t('find.case'),
                'aria-pressed': findCase ? 'true' : 'false',
                'data-find-toggle': 'case',
                style: Object.assign({}, ST_FILES.findToggle, findCase ? ST_FILES.findToggleActive : null),
                onClick: function () { if (typeof props.onFindOption === 'function') props.onFindOption('case'); },
              },
              'Aa',
            ),
            h(
              'button',
              {
                type: 'button',
                title: t('find.whole'),
                'aria-label': t('find.whole'),
                'aria-pressed': findWhole ? 'true' : 'false',
                'data-find-toggle': 'whole',
                style: Object.assign({}, ST_FILES.findToggle, findWhole ? ST_FILES.findToggleActive : null),
                onClick: function () { if (typeof props.onFindOption === 'function') props.onFindOption('whole'); },
              },
              'ab',
            ),
            h(
              'button',
              {
                type: 'button',
                title: t('find.regex'),
                'aria-label': t('find.regex'),
                'aria-pressed': findRegex ? 'true' : 'false',
                'data-find-toggle': 'regex',
                style: Object.assign({}, ST_FILES.findToggle, findRegex ? ST_FILES.findToggleActive : null),
                onClick: function () { if (typeof props.onFindOption === 'function') props.onFindOption('regex'); },
              },
              '.*',
            ),
            h('span', { style: { flex: '1 1 auto' } }),
            typeof props.onFindReplaceOpen === 'function'
              ? h(
                  S.ToolButton,
                  { title: t('find.toggleReplace'), ariaLabel: t('find.toggleReplace'), active: findReplace, style: { width: 24, height: 24 }, onClick: props.onFindReplaceOpen },
                  h('span', { style: { fontSize: 11 } }, '⇄'),
                )
              : null,
            h(
              S.ToolButton,
              { title: t('find.close'), ariaLabel: t('find.close'), style: { width: 24, height: 24 }, onClick: props.onFindClose },
              h(S.Icons.Close, { size: 12 }),
            ),
          ),
          findReplace
            ? h(
                'div',
                { style: ST_FILES.findRow },
                h('input', {
                  type: 'text',
                  value: findReplacement,
                  placeholder: t('find.replacePlaceholder'),
                  'aria-label': t('find.replacePlaceholder'),
                  style: ST_FILES.findInput,
                  onChange: function (event: any) {
                    if (typeof props.onFindReplacementChange === 'function') props.onFindReplacementChange(event);
                  },
                  onKeyDown: function (event: any) {
                    if (event === null || event === undefined) return;
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      if (typeof props.onFindReplaceOne === 'function') props.onFindReplaceOne();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      if (typeof props.onFindClose === 'function') props.onFindClose();
                    }
                  },
                }),
                h(
                  S.GhostButton,
                  { title: t('find.replace'), ariaLabel: t('find.replace'), onClick: props.onFindReplaceOne },
                  t('find.replace'),
                ),
                h(
                  S.GhostButton,
                  { title: t('find.replaceAll'), ariaLabel: t('find.replaceAll'), onClick: props.onFindReplaceAll },
                  t('find.replaceAll'),
                ),
                h('span', { style: { flex: '1 1 auto' } }),
                h('span', { style: ST_FILES.findHint }, t('find.replaceHint')),
              )
            : null,
        )
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
            { style: wrap ? ST_FILES.readOnlyInnerWrap : ST_FILES.readOnlyInner },
            wrap ? null : h('pre', { style: editorReadOnlyGutterStyle, 'aria-hidden': true }, numbersText),
            h(
              'pre',
              {
                style: editorReadOnlyCodeStyle,
                'data-ide-highlight': syntaxChildren === null ? 'plain' : 'syntax',
              },
              syntaxChildren === null ? props.value : syntaxChildren,
            ),
          ),
        )
      : h(
          'div',
          { style: ST_FILES.editorWrap },
          wrap
            ? null
            : h(
                'div',
                { ref: props.gutterRef, style: editorGutterWrapStyle, 'aria-hidden': true },
                h('pre', { style: editorGutterStyle }, numbersText),
                gitMarkers.length > 0
                  ? h(
                      'div',
                      { style: ST_FILES.bookmarkLayer, 'data-editor-git-markers': '1' },
                      gitMarkers.map(function (marker: any) {
                        const top = zoomPadTop + (marker.line - 1) * zoomLine - editorScrollTop;
                        if (top < -zoomLine || top > 20000) return null;
                        const color = marker.kind === 'added' ? C.diffAdd : marker.kind === 'deleted' ? C.diffDel : C.accent;
                        return h('div', {
                          key: 'git-marker-' + String(marker.line),
                          style: Object.assign({}, ST_FILES.gitMarker, {
                            top: top + 'px',
                            height: Math.max(2, Math.round(zoomLine) - 2) + 'px',
                            background: color,
                          }),
                        });
                      }),
                    )
                  : null,
                bookmarkLines.length > 0
                  ? h(
                      'div',
                      { style: ST_FILES.bookmarkLayer, 'data-editor-bookmarks': '1' },
                      bookmarkLines.map(function (line: number) {
                        const top = zoomPadTop + (line - 1) * zoomLine - editorScrollTop;
                        if (top < -zoomLine || top > 20000) return null;
                        return h('div', {
                          key: 'bookmark-' + String(line),
                          style: Object.assign({}, ST_FILES.bookmarkMark, {
                            top: top + 'px',
                            height: Math.max(2, Math.round(zoomLine) - 4) + 'px',
                          }),
                        });
                      }),
                    )
                  : null,
              ),
          h(
            'div',
            { style: ST_FILES.codeRegion },
            guideChildren !== null && guideChildren.length > 0
              ? h('div', { style: ST_FILES.guideLayer, 'aria-hidden': true, 'data-editor-guides': '1' }, guideChildren)
              : null,
            syntaxActive
              ? h(
                  'div',
                  {
                    style: ST_FILES.syntaxLayer,
                    'aria-hidden': true,
                    'data-ide-highlight': 'layer',
                  },
                  h(
                    'pre',
                    { ref: syntaxRef, style: editorSyntaxStyle },
                    syntaxChildren,
                  ),
                )
              : null,
            bracketHighlight !== null && syntaxActive
              ? h(
                  'div',
                  { style: ST_FILES.findLayer, 'aria-hidden': true, 'data-bracket-highlight': '1' },
                  h(
                    'pre',
                    {
                      ref: bracketRef,
                      style: editorFindStyle,
                    },
                    bracketHighlight,
                  ),
                )
              : null,
            findHighlight !== null && syntaxActive
              ? h(
                  'div',
                  { style: ST_FILES.findLayer, 'aria-hidden': true, 'data-find-highlight': '1' },
                  h(
                    'pre',
                    {
                      ref: findRef,
                      style: editorFindStyle,
                    },
                    findHighlight,
                  ),
                )
              : null,
            h('textarea', {
              ref: props.textareaRef,
              value: props.value,
              style: syntaxActive ? Object.assign({}, editorTextStyle, ST_FILES.textareaHighlighting) : editorTextStyle,
              spellCheck: false,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              autoComplete: 'off',
              wrap: wrap ? 'soft' : 'off',
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
      svgImageMode === false && previewMode === false && selection > 0
        ? h('span', null, t('files.selection', { count: S.formatCount(selection) }))
        : null,
      h('span', { style: { flex: '1 1 auto' } }),
      svgImageMode && dimensions !== null
        ? h('span', null, t('files.image.dimensions', { width: String(dimensions.width), height: String(dimensions.height) }))
        : null,
      dirty ? h('span', { style: ST_FILES.statusHint }, t('files.dirtyHint')) : null,
      isMarkdown ? h('span', { title: t('files.md.toggleHint') }, t('files.md.shortcut')) : null,
      isSvg ? h('span', { title: t('files.svg.toggleHint') }, t('files.svg.shortcut')) : null,
      readOnly || svgImageMode ? null : h('span', { title: t('files.commentHint') }, t('files.commentShortcut')),
      props.language ? h('span', null, props.language) : null,
      h('span', null, t('files.eol', { eol: eolLabel })),
      h('span', null, t('files.lines', { count: S.formatCount(props.lineCount) })),
      h('span', null, t('files.encoding')),
      bookmarkLines.length > 0 && typeof props.onBookmarksOpen === 'function'
        ? h(
            'button',
            {
              type: 'button',
              title: t('bookmarks.label'),
              'data-bookmark-count': String(bookmarkLines.length),
              style: ST_FILES.statusButton,
              onClick: props.onBookmarksOpen,
            },
            t('bookmarks.count', { count: S.formatCount(bookmarkLines.length) }),
          )
        : null,
      h(
        'button',
        {
          type: 'button',
          title: t('files.zoomHint'),
          'data-editor-zoom': String(Math.round(zoom * 100)),
          style: ST_FILES.statusButton,
          onClick: function () { if (typeof props.onZoomReset === 'function') props.onZoomReset(); },
        },
        Math.round(zoom * 100) + '%',
      ),
      typeof props.onToggleWrap === 'function'
        ? h(
            'button',
            {
              type: 'button',
              title: t('files.wrapHint'),
              'aria-pressed': wrap ? 'true' : 'false',
              'data-soft-wrap': wrap ? '1' : '0',
              style: ST_FILES.statusButton,
              onClick: props.onToggleWrap,
            },
            t(wrap ? 'files.wrapOn' : 'files.wrapOff'),
          )
        : null,
      readOnly ? h('span', null, t('files.readonly')) : null,
    ),
  );
}

/**
 * The Files tab: tree on the left, viewer on the right.
 * @param {{t: Function, root: string, openRequest?: OpenRequest|null, reloadToken?: number, onOpenFile?: Function}} props - slot props.
 */
function FilesView(props: any) {
  const fallbackT = S.useT();
  const t = props !== null && props !== undefined && typeof props.t === 'function' ? props.t : fallbackT;
  const root = props.root;

  const [tree, setTree] = useState<Record<string, any>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ '': true });
  const [selected, setSelected] = useState<any>(null);
  const [file, setFile] = useState<any>({ status: 'idle', data: null, error: null });
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<any>(null);
  const [caret, setCaret] = useState({ line: 1, column: 1 });
  const [caretIndex, setCaretIndex] = useState(0);
  const [pendingLine, setPendingLine] = useState<any>(null);
  const [markdownMode, setMarkdownMode] = useState('source');
  const [svgMode, setSvgMode] = useState('image');
  const [image, setImage] = useState<any>({ status: 'idle', data: null, error: null });
  const [dimensions, setDimensions] = useState<any>(null);
  const [wrap, setWrap] = useState<boolean>(readWrapPref());
  const [zoom, setZoom] = useState<number>(readZoomPref());
  const [gotoOpen, setGotoOpen] = useState(false);
  const [gotoValue, setGotoValue] = useState('');
  const [selection, setSelection] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [findReplace, setFindReplace] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findReplacement, setFindReplacement] = useState('');
  const [findCase, setFindCase] = useState(false);
  const [findWhole, setFindWhole] = useState(false);
  const [findRegex, setFindRegex] = useState(false);
  const [findCurrent, setFindCurrent] = useState(0);
  const [history, setHistory] = useState<Array<{ path: string, line: number }>>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const [quickFiles, setQuickFiles] = useState<string[] | null>(null);
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState<any>(null);
  const [quickTruncated, setQuickTruncated] = useState(false);
  const [quickIndex, setQuickIndex] = useState(0);
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [symbolQuery, setSymbolQuery] = useState('');
  const [symbolIndex, setSymbolIndex] = useState(0);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentQuery, setRecentQuery] = useState('');
  const [recentIndex, setRecentIndex] = useState(0);
  const [bookmarks, setBookmarks] = useState<Record<string, number[]>>(readBookmarks);
  const [gitGutter, setGitGutter] = useState<Record<number, string>>({});
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [bookmarksQuery, setBookmarksQuery] = useState('');
  const [bookmarksIndex, setBookmarksIndex] = useState(0);
  const [tabs, setTabs] = useState<string[]>([]);
  const [closingTab, setClosingTab] = useState<string | null>(null);

  const textareaRef = useRef<any>(null);
  const gutterRef = useRef<any>(null);
  const fileRequestRef = useRef(0);
  const genRef = useRef(0);
  const noticeTimerRef = useRef<any>(null);
  const historyIndexRef = useRef(-1);
  const quickInputRef = useRef<any>(null);
  const quickFilesRef = useRef<string[] | null>(null);
  const tabStateRef = useRef<Record<string, any>>({});
  const closedTabsRef = useRef<Array<{ path: string, snapshot: any }>>([]);
  const gitGutterRef = useRef(0);

  // Success / info notices fade after a moment; error notices stay until the
  // next action so a failed save is never missed.
  const showNotice = useCallback(function (next: any) {
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

  const loadDir = useCallback(/** @param {string} dirPath - directory path relative to the root. @param {number} [generation] - tree generation for stale-response rejection. */ function (dirPath: any, generation?: any) {
    const gen = generation === undefined ? genRef.current : generation;
    setTree(function (previous) {
      const next = Object.assign({}, previous);
      next[dirPath] = { status: 'loading', entries: [], error: null, truncated: false };
      return next;
    });
    S.requestJson(S.apiUrl(ROUTES.list, { root: root, path: dirPath }))
      .then(function (payload: any) {
        if (genRef.current !== gen) return;
        const entries = Array.isArray(payload.entries) ? payload.entries.filter(keepTreeEntry) : [];
        setTree(function (previous) {
          const next = Object.assign({}, previous);
          next[dirPath] = { status: 'loaded', entries: entries, error: null, truncated: payload.truncated === true };
          return next;
        });
      })
      .catch(function (cause: any) {
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
    setTabs([]);
    tabStateRef.current = {};
    setClosingTab(null);
    quickFilesRef.current = null;
    setQuickFiles(null);
    setQuickOpen(false);
    setQuickTruncated(false);
    loadDir('', gen);
    return function () {
      genRef.current = genRef.current + 1;
    };
  }, [root, loadDir]);

  const toggleDir = useCallback(function (entry: any) {
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

  const loadFile = useCallback(function (path: any, line: any) {
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
        .then(function (payload: any) {
          if (fileRequestRef.current !== requestId || genRef.current !== gen) return;
          setImage({ status: 'loaded', data: payload, error: null });
        })
        .catch(function (cause: any) {
          if (fileRequestRef.current !== requestId || genRef.current !== gen) return;
          if (cause !== null && cause !== undefined && cause.name === 'AbortError') return;
          setImage({ status: 'error', data: null, error: cause });
        });
      return;
    }
    S.requestJson(S.apiUrl(ROUTES.file, { root: root, path: path }))
      .then(function (payload: any) {
        if (fileRequestRef.current !== requestId || genRef.current !== gen) return;
        const content = typeof payload.content === 'string' ? payload.content : '';
        setFile({ status: 'loaded', data: payload, eol: detectEol(content), error: null });
        setDraft(normalizeEol(content));
        const target = Number.isFinite(line) && line > 0 ? Math.floor(line) : null;
        if (target !== null) setPendingLine(target);
      })
      .catch(function (cause: any) {
        if (fileRequestRef.current !== requestId || genRef.current !== gen) return;
        if (cause !== null && cause !== undefined && cause.name === 'AbortError') return;
        setFile({ status: 'error', data: null, error: cause });
      });
  }, [root, showNotice]);

  /** Store the active tab's live editor state so switching tabs loses nothing. */
  function snapshotActiveTab() {
    if (selected === null) return;
    tabStateRef.current[selected] = {
      file: file,
      draft: draft,
      caret: caret,
      markdownMode: markdownMode,
      svgMode: svgMode,
      image: image,
      dimensions: dimensions,
    };
  }

  /** Restore a previously stored tab snapshot; false when the tab never loaded. */
  function restoreTabSnapshot(path: string, line: any): boolean {
    const snapshot = tabStateRef.current[path];
    if (snapshot === null || snapshot === undefined) return false;
    setSelected(path);
    setFile(snapshot.file);
    setDraft(snapshot.draft);
    setCaret(snapshot.caret);
    setMarkdownMode(snapshot.markdownMode);
    setSvgMode(snapshot.svgMode);
    setImage(snapshot.image);
    setDimensions(snapshot.dimensions);
    setSaving(false);
    showNotice(null);
    setPendingLine(Number.isFinite(line) && line > 0 ? Math.floor(line) : null);
    return true;
  }

  const openPath = useCallback(function (path: any, line: any, options?: any) {
    if (typeof path !== 'string' || path.length === 0) return;
    const opts = options !== null && typeof options === 'object' ? options : {};
    const skipHistory = opts.skipHistory === true;
    const force = opts.reload === true;
    if (skipHistory === false) {
      const entry = { path: path, line: Number.isFinite(line) && line > 0 ? Math.floor(line) : 1 };
      setHistory(function (previous: Array<{ path: string, line: number }>) {
        const base = previous.slice(0, historyIndexRef.current + 1);
        const last = base[base.length - 1];
        if (last !== undefined && last !== null && last.path === entry.path && last.line === entry.line) return previous;
        const next = base.concat([entry]);
        historyIndexRef.current = next.length - 1;
        setHistoryIndex(historyIndexRef.current);
        return next;
      });
    }
    if (force === true) {
      loadFile(path, line);
      return;
    }
    if (path === selected) {
      if (Number.isFinite(line) && line > 0) setPendingLine(Math.floor(line));
      return;
    }
    snapshotActiveTab();
    setTabs(function (previous: string[]) { return previous.indexOf(path) === -1 ? previous.concat([path]) : previous; });
    if (restoreTabSnapshot(path, line)) return;
    loadFile(path, line);
  }, [selected, file, draft, caret, markdownMode, svgMode, image, dimensions, loadFile, showNotice]);

  /** Whether one tab currently holds unsaved edits (active uses live state). */
  function tabDirty(path: string): boolean {
    if (path === selected) {
      const liveData = file !== null && file !== undefined ? file.data : null;
      if (liveData === null || liveData === undefined || typeof liveData.content !== 'string') return false;
      return draft !== normalizeEol(liveData.content);
    }
    const snapshot = tabStateRef.current[path];
    if (snapshot === null || snapshot === undefined) return false;
    const data = snapshot.file !== null && snapshot.file !== undefined ? snapshot.file.data : null;
    if (data === null || data === undefined || typeof data.content !== 'string') return false;
    return snapshot.draft !== normalizeEol(data.content);
  }

  const closeTab = useCallback(function (path: any) {
    if (typeof path !== 'string' || path.length === 0) return;
    if (tabDirty(path) === true && closingTab !== path) {
      setClosingTab(path);
      return;
    }
    const closedSnapshot = tabStateRef.current[path] !== undefined
      ? tabStateRef.current[path]
      : (path === selected ? { file: file, draft: draft, caret: caret, markdownMode: markdownMode, svgMode: svgMode, image: image, dimensions: dimensions } : null);
    closedTabsRef.current.push({ path: path, snapshot: closedSnapshot });
    if (closedTabsRef.current.length > 20) closedTabsRef.current.shift();
    const remaining = tabs.filter(function (item: string) { return item !== path; });
    delete tabStateRef.current[path];
    setTabs(remaining);
    setClosingTab(null);
    if (path !== selected) return;
    if (remaining.length === 0) {
      setSelected(null);
      setFile({ status: 'idle', data: null, error: null });
      setDraft('');
      setCaret({ line: 1, column: 1 });
      setImage({ status: 'idle', data: null, error: null });
      setDimensions(null);
      setPendingLine(null);
      setMarkdownMode('source');
      setSvgMode('image');
      return;
    }
    const index = tabs.indexOf(path);
    const nextPath = remaining[Math.min(index < 0 ? 0 : index, remaining.length - 1)];
    if (restoreTabSnapshot(nextPath, null) === false) loadFile(nextPath, null);
  }, [tabs, selected, closingTab, loadFile]);

  const navigateHistory = useCallback(function (delta: any) {
    const target = historyIndex + (delta < 0 ? -1 : 1);
    if (target < 0 || target >= history.length) return;
    const entry = history[target];
    if (entry === null || entry === undefined) return;
    historyIndexRef.current = target;
    setHistoryIndex(target);
    openPath(entry.path, entry.line, { skipHistory: true });
  }, [history, historyIndex, openPath]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < history.length - 1;

  const closeQuick = useCallback(function () {
    setQuickOpen(false);
  }, []);

  const openQuick = useCallback(function () {
    setQuickOpen(true);
    setQuickQuery('');
    setQuickIndex(0);
    if (quickFilesRef.current !== null) return;
    setQuickLoading(true);
    setQuickError(null);
    S.requestJson(S.apiUrl(ROUTES.files, { root: root }))
      .then(function (payload: any) {
        const files = Array.isArray(payload.files) ? payload.files : [];
        quickFilesRef.current = files;
        setQuickFiles(files);
        setQuickTruncated(payload.truncated === true);
        setQuickLoading(false);
      })
      .catch(function (cause: any) {
        if (cause !== null && cause !== undefined && cause.name === 'AbortError') return;
        setQuickError(cause);
        setQuickFiles([]);
        setQuickLoading(false);
      });
  }, [root]);

  const changeQuickQuery = useCallback(function (event: any) {
    const target = event !== null && event !== undefined ? event.target : null;
    setQuickQuery(target !== null && target !== undefined && typeof target.value === 'string' ? target.value : '');
    setQuickIndex(0);
  }, []);

  const recentPaths = useMemo(
    function () {
      return history.map(function (entry: { path: string }) { return entry.path; });
    },
    [history],
  );

  const quickResults = useMemo(
    function () {
      if (quickOpen === false || quickFiles === null) return [];
      return typeof S.quickOpenRows === 'function'
        ? S.quickOpenRows(quickQuery, quickFiles, recentPaths, 50)
        : (typeof S.rankQuickOpen === 'function' ? S.rankQuickOpen(quickQuery, quickFiles, 50) : []);
    },
    [quickOpen, quickQuery, quickFiles, recentPaths],
  );

  const symbolItems = useMemo(
    function () {
      if (symbolsOpen === false || file.status !== 'loaded') return [];
      const data = file !== null && file !== undefined ? file.data : null;
      const lang = data !== null && data !== undefined && typeof data.language === 'string' ? data.language : '';
      return typeof S.extractSymbols === 'function' ? S.extractSymbols(draft, lang) : [];
    },
    [symbolsOpen, draft, file.status],
  );

  const symbolResults = useMemo(
    function () {
      if (symbolsOpen === false) return [];
      const query = symbolQuery.trim();
      if (query.length === 0) return symbolItems.slice(0, 200);
      return symbolItems
        .map(function (symbol: any) {
          return { symbol: symbol, score: typeof S.quickOpenScore === 'function' ? S.quickOpenScore(query, symbol.name) : -1 };
        })
        .filter(function (row: any) { return row.score >= 0; })
        .sort(function (left: any, right: any) { return right.score === left.score ? left.symbol.line - right.symbol.line : right.score - left.score; })
        .map(function (row: any) { return row.symbol; })
        .slice(0, 200);
    },
    [symbolsOpen, symbolQuery, symbolItems],
  );

  const closeSymbols = useCallback(function () {
    setSymbolsOpen(false);
  }, []);

  const openSymbols = useCallback(function () {
    setSymbolsOpen(true);
    setSymbolQuery('');
    setSymbolIndex(0);
  }, []);

  const changeSymbolQuery = useCallback(function (event: any) {
    const target = event !== null && event !== undefined ? event.target : null;
    setSymbolQuery(target !== null && target !== undefined && typeof target.value === 'string' ? target.value : '');
    setSymbolIndex(0);
  }, []);

  const moveSymbol = useCallback(function (delta: any) {
    if (symbolResults.length === 0) return;
    setSymbolIndex(function (previous: number) {
      return (previous + delta + symbolResults.length) % symbolResults.length;
    });
  }, [symbolResults]);

  const jumpToSymbol = useCallback(function (symbol: any) {
    if (symbol === null || symbol === undefined || !Number.isFinite(symbol.line)) return;
    setSymbolsOpen(false);
    applyLineJump(symbol.line);
  }, []);

  const recentResults = useMemo(
    function () {
      if (recentOpen === false) return [];
      const newestFirst = history.slice().reverse();
      const query = recentQuery.trim();
      if (query.length === 0) return newestFirst.slice(0, 50);
      return newestFirst
        .map(function (entry: any) {
          const score = typeof S.quickOpenScore === 'function' ? S.quickOpenScore(query, entry.path) : -1;
          return { entry: entry, score: score };
        })
        .filter(function (row: any) { return row.score >= 0; })
        .sort(function (left: any, right: any) { return right.score - left.score; })
        .map(function (row: any) { return row.entry; })
        .slice(0, 50);
    },
    [recentOpen, recentQuery, history],
  );

  const closeRecent = useCallback(function () {
    setRecentOpen(false);
  }, []);

  const openRecent = useCallback(function () {
    setRecentOpen(true);
    setRecentQuery('');
    setRecentIndex(0);
  }, []);

  const changeRecentQuery = useCallback(function (event: any) {
    const target = event !== null && event !== undefined ? event.target : null;
    setRecentQuery(target !== null && target !== undefined && typeof target.value === 'string' ? target.value : '');
    setRecentIndex(0);
  }, []);

  const moveRecent = useCallback(function (delta: any) {
    if (recentResults.length === 0) return;
    setRecentIndex(function (previous: number) {
      return (previous + delta + recentResults.length) % recentResults.length;
    });
  }, [recentResults]);

  const jumpRecent = useCallback(function (entry: any) {
    if (entry === null || entry === undefined || typeof entry.path !== 'string') return;
    setRecentOpen(false);
    if (entry.path === selected) {
      applyLineJump(Number.isFinite(entry.line) ? entry.line : 1);
      return;
    }
    openPath(entry.path, Number.isFinite(entry.line) ? entry.line : 1);
  }, [selected, openPath]);

  const toggleBookmark = useCallback(function () {
    if (selected === null || file.status !== 'loaded') return;
    const line = caret.line;
    setBookmarks(function (previous: Record<string, number[]>) {
      const next = Object.assign({}, previous);
      const lines = typeof S.toggleBookmarkLine === 'function' ? S.toggleBookmarkLine(previous[selected], line) : [];
      if (lines.length === 0) delete next[selected];
      else next[selected] = lines;
      writeBookmarks(next);
      return next;
    });
  }, [selected, file.status, caret]);

  const bookmarkResults = useMemo(
    function () {
      if (bookmarksOpen === false) return [];
      const entries = typeof S.flattenBookmarks === 'function' ? S.flattenBookmarks(bookmarks) : [];
      const query = bookmarksQuery.trim();
      if (query.length === 0) return entries;
      return entries
        .map(function (entry: any) {
          const score = typeof S.quickOpenScore === 'function' ? S.quickOpenScore(query, entry.path) : -1;
          return { entry: entry, score: score };
        })
        .filter(function (row: any) { return row.score >= 0; })
        .sort(function (left: any, right: any) { return right.score - left.score; })
        .map(function (row: any) { return row.entry; })
        .slice(0, 200);
    },
    [bookmarksOpen, bookmarksQuery, bookmarks],
  );

  const closeBookmarks = useCallback(function () {
    setBookmarksOpen(false);
  }, []);

  const openBookmarks = useCallback(function () {
    setBookmarksOpen(true);
    setBookmarksQuery('');
    setBookmarksIndex(0);
  }, []);

  const changeBookmarksQuery = useCallback(function (event: any) {
    const target = event !== null && event !== undefined ? event.target : null;
    setBookmarksQuery(target !== null && target !== undefined && typeof target.value === 'string' ? target.value : '');
    setBookmarksIndex(0);
  }, []);

  const moveBookmark = useCallback(function (delta: any) {
    if (bookmarkResults.length === 0) return;
    setBookmarksIndex(function (previous: number) {
      return (previous + delta + bookmarkResults.length) % bookmarkResults.length;
    });
  }, [bookmarkResults]);

  const jumpBookmark = useCallback(function (entry: any) {
    if (entry === null || entry === undefined || typeof entry.path !== 'string') return;
    setBookmarksOpen(false);
    if (entry.path === selected) {
      applyLineJump(Number.isFinite(entry.line) ? entry.line : 1);
      return;
    }
    openPath(entry.path, Number.isFinite(entry.line) ? entry.line : 1);
  }, [selected, openPath]);

  const reopenClosedTab = useCallback(function () {
    const entry = closedTabsRef.current.pop();
    if (entry === null || entry === undefined) return;
    snapshotActiveTab();
    if (entry.snapshot !== null && entry.snapshot !== undefined) tabStateRef.current[entry.path] = entry.snapshot;
    setTabs(function (previous: string[]) { return previous.indexOf(entry.path) === -1 ? previous.concat([entry.path]) : previous; });
    if (entry.snapshot !== null && entry.snapshot !== undefined) {
      restoreTabSnapshot(entry.path, null);
      return;
    }
    loadFile(entry.path, null);
  }, [selected, file, draft, caret, markdownMode, svgMode, image, dimensions, loadFile]);

  const openQuickPath = useCallback(function (filePath: any) {
    if (typeof filePath !== 'string' || filePath.length === 0) return;
    setQuickOpen(false);
    openPath(filePath, 1);
  }, [openPath]);

  const moveQuick = useCallback(function (delta: any) {
    if (quickResults.length === 0) return;
    setQuickIndex(function (previous: number) {
      const next = (previous + delta + quickResults.length) % quickResults.length;
      return next;
    });
  }, [quickResults]);

  useEffect(function () {
    if (quickOpen === false) return undefined;
    const input = quickInputRef.current;
    if (input === null || input === undefined || typeof input.focus !== 'function') return undefined;
    try {
      input.focus();
    } catch (error) {
      /* focus is a nicety */
    }
    return undefined;
  }, [quickOpen]);

  useEffect(function () {
    if (quickOpen === false || quickResults.length === 0) return undefined;
    if (quickIndex >= quickResults.length) setQuickIndex(quickResults.length - 1);
    return undefined;
  }, [quickOpen, quickResults, quickIndex]);

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

  const gitMtime = file !== null && file !== undefined && file.data !== null && file.data !== undefined && Number.isFinite(file.data.mtimeMs)
    ? file.data.mtimeMs
    : null;

  // Git change decorations: one diff read per opened file (and after saves,
  // which update mtimeMs). Non-repo roots / errors clear the gutter silently.
  useEffect(function () {
    if (selected === null || file.status !== 'loaded') {
      setGitGutter({});
      return undefined;
    }
    const requestId = gitGutterRef.current + 1;
    gitGutterRef.current = requestId;
    S.requestJson(S.apiUrl(ROUTES.git, { root: root, kind: 'diff', path: selected }))
      .then(function (payload: any) {
        if (gitGutterRef.current !== requestId) return;
        if (payload === null || payload === undefined || payload.repo === false || typeof payload.diff !== 'string') {
          setGitGutter({});
          return;
        }
        setGitGutter(typeof S.parseGitGutter === 'function' ? S.parseGitGutter(payload.diff) : {});
      })
      .catch(function (cause: any) {
        if (gitGutterRef.current !== requestId) return;
        setGitGutter({});
      });
    return function () {
      gitGutterRef.current = gitGutterRef.current + 1;
    };
  }, [selected, file.status, root, gitMtime]);

  const fileSymbols = useMemo(
    function () {
      if (file.status !== 'loaded') return [];
      const data = file !== null && file !== undefined ? file.data : null;
      const lang = data !== null && data !== undefined && typeof data.language === 'string' ? data.language : '';
      return typeof S.extractSymbols === 'function' ? S.extractSymbols(draft, lang) : [];
    },
    [draft, file.status],
  );

  const currentSymbol = useMemo(
    function () {
      if (file.status !== 'loaded') return null;
      return typeof S.symbolAtLine === 'function' ? S.symbolAtLine(fileSymbols, caret.line) : null;
    },
    [fileSymbols, caret.line, file.status],
  );

  const navigateSymbol = useCallback(function (direction: any) {
    const target = typeof S.nextSymbolLine === 'function' ? S.nextSymbolLine(fileSymbols, caret.line, direction) : null;
    if (target !== null && target !== undefined) applyLineJump(target);
  }, [fileSymbols, caret.line]);

  const gitMarkers = useMemo(
    function () {
      return Object.keys(gitGutter).map(function (key) {
        return { line: Number(key), kind: gitGutter[Number(key)] };
      });
    },
    [gitGutter],
  );

  const bracketRanges = useMemo(
    function () {
      if (file.status !== 'loaded' || readOnly === true) return [];
      const pair = typeof S.bracketMatch === 'function' ? S.bracketMatch(draft, caretIndex) : null;
      if (pair === null || pair === undefined) return [];
      return [
        { start: pair.open, end: pair.open + 1 },
        { start: pair.close, end: pair.close + 1 },
      ];
    },
    [draft, caretIndex, file.status, readOnly],
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
      .then(function (payload: any) {
        setFile(function (previous: any) {
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
      .catch(function (cause: any) {
        setSaving(false);
        showNotice({ kind: 'error', text: t('files.saveError', { message: S.errorText(cause) }) });
      });
  }, [selected, file, saving, draft, root, eol, t, showNotice]);

  const toggleWrap = useCallback(function () {
    setWrap(function (previous: boolean) {
      const next = previous !== true;
      try {
        if (typeof S.writeStoredNumber === 'function') S.writeStoredNumber(STORAGE_WRAP, next ? 1 : 0);
      } catch (error) {
        /* preference persistence is optional */
      }
      return next;
    });
  }, []);

  const changeZoom = useCallback(function (delta: any) {
    setZoom(function (previous: number) {
      const next = Math.min(2, Math.max(0.5, Math.round((previous + delta) * 10) / 10));
      try {
        if (typeof S.writeStoredNumber === 'function') S.writeStoredNumber(STORAGE_ZOOM, Math.round(next * 100));
      } catch (error) {
        /* preference persistence is optional */
      }
      return next;
    });
  }, []);

  const resetZoom = useCallback(function () {
    setZoom(1);
    try {
      if (typeof S.writeStoredNumber === 'function') S.writeStoredNumber(STORAGE_ZOOM, 100);
    } catch (error) {
      /* preference persistence is optional */
    }
  }, []);

  const reloadSelected = useCallback(function () {
    if (selected === null) return;
    openPath(selected, null, { reload: true });
  }, [selected, openPath]);

  const discard = useCallback(function () {
    if (selected === null) return;
    openPath(selected, null, { reload: true });
    showNotice({ kind: 'info', text: t('files.discard') });
  }, [selected, openPath, t, showNotice]);

  const syncCaret = useCallback(function (event: any) {
    const target = event !== null && event !== undefined ? event.target : null;
    if (target === null || target === undefined) return;
    setCaret(caretFromIndex(typeof target.value === 'string' ? target.value : draft, target.selectionStart));
    const start = Number.isFinite(target.selectionStart) ? target.selectionStart : 0;
    setCaretIndex(start);
    const end = Number.isFinite(target.selectionEnd) ? target.selectionEnd : start;
    setSelection(end > start ? end - start : 0);
  }, [draft]);

  const onEditorScroll = useCallback(function (event: any) {
    const target = event !== null && event !== undefined ? event.target : null;
    const gutter = gutterRef.current;
    if (target !== null && target !== undefined && gutter !== null && gutter !== undefined) {
      gutter.scrollTop = target.scrollTop;
    }
  }, []);

  const editorLineHeight = EDITOR_LINE_HEIGHT * zoom;
  const editorPadTop = EDITOR_PADDING_TOP * zoom;

  function applyLineJump(targetLine: any) {
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
    const top = Math.max(0, (line - 1) * editorLineHeight + editorPadTop - 4 * editorLineHeight);
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
    setCaretIndex(start);
  }

  /** Apply one `{text, selectionStart, selectionEnd}` edit and restore focus/selection. */
  function applyEditorResult(result: any) {
    if (result === null || result === undefined || typeof result.text !== 'string') return;
    const start = Number.isFinite(result.selectionStart) ? Math.max(0, Math.floor(result.selectionStart)) : 0;
    const end = Number.isFinite(result.selectionEnd) ? Math.max(start, Math.floor(result.selectionEnd)) : start;
    setDraft(result.text);
    setCaret(caretFromIndex(result.text, start));
    setCaretIndex(start);
    try {
      setTimeout(function () {
        const current = textareaRef.current;
        if (current === null || current === undefined) return;
        try {
          current.focus();
          current.setSelectionRange(start, end);
        } catch (error) {
          /* selection is a nicety */
        }
      }, 0);
    } catch (error) {
      /* no timer */
    }
  }

  useEffect(function () {
    if (pendingLine === null || file.status !== 'loaded') return undefined;
    applyLineJump(pendingLine);
    setPendingLine(null);
    return undefined;
  }, [pendingLine, file.status]);

  const openGoto = useCallback(function () {
    setGotoOpen(true);
    setGotoValue('');
  }, []);

  const closeGoto = useCallback(function () {
    setGotoOpen(false);
  }, []);

  const changeGoto = useCallback(function (event: any) {
    const target = event !== null && event !== undefined ? event.target : null;
    setGotoValue(target !== null && target !== undefined && typeof target.value === 'string' ? target.value : '');
  }, []);

  const submitGoto = useCallback(function () {
    const line = Number.parseInt(String(gotoValue).trim(), 10);
    if (!Number.isFinite(line) || line < 1 || line > Math.max(1, lineCount)) {
      showNotice({ kind: 'info', text: t('files.gotoInvalid') });
      return;
    }
    setGotoOpen(false);
    applyLineJump(line);
  }, [gotoValue, lineCount, showNotice, t]);

  const findMatches = useMemo(
    function () {
      if (findOpen === false || findQuery.length === 0) return [];
      return typeof S.findTextMatches === 'function'
        ? S.findTextMatches(draft, findQuery, { caseSensitive: findCase, whole: findWhole, regex: findRegex })
        : [];
    },
    [findOpen, findQuery, findCase, findWhole, findRegex, draft],
  );

  const findRegexInvalid = useMemo(
    function () {
      if (findOpen === false || findRegex === false || findQuery.length === 0) return false;
      try {
        new RegExp(findQuery);
        return false;
      } catch (error) {
        return true;
      }
    },
    [findOpen, findRegex, findQuery],
  );

  /** Select one match in the textarea without taking focus away from the bar. */
  function selectFindMatch(match: any) {
    const textarea = textareaRef.current;
    if (textarea === null || textarea === undefined || match === null || match === undefined) return;
    try {
      textarea.setSelectionRange(match.start, match.end);
    } catch (error) {
      /* selection is a nicety */
    }
    const value = typeof textarea.value === 'string' ? textarea.value : draft;
    let line = 1;
    for (let index = 0; index < match.start && index < value.length; index = index + 1) {
      if (value.charCodeAt(index) === 10) line = line + 1;
    }
    const top = Math.max(0, (line - 1) * editorLineHeight - 4 * editorLineHeight);
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
  }

  const openFind = useCallback(function (withReplace: any) {
    setFindOpen(true);
    if (withReplace === true) setFindReplace(true);
    setFindQuery(function (previous: string) {
      if (previous.length > 0) return previous;
      const textarea = textareaRef.current;
      if (textarea === null || textarea === undefined) return previous;
      const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : 0;
      const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
      const value = typeof textarea.value === 'string' ? textarea.value : draft;
      if (end > start && end - start <= 200) return value.slice(start, end);
      let left = start;
      while (left > 0 && /[A-Za-z0-9_$]/.test(value.charAt(left - 1))) left = left - 1;
      let right = start;
      while (right < value.length && /[A-Za-z0-9_$]/.test(value.charAt(right))) right = right + 1;
      if (right > left && right - left <= 100) return value.slice(left, right);
      return previous;
    });
  }, [draft]);

  const closeFind = useCallback(function () {
    setFindOpen(false);
    setFindReplace(false);
  }, []);

  const changeFind = useCallback(function (event: any) {
    const target = event !== null && event !== undefined ? event.target : null;
    setFindQuery(target !== null && target !== undefined && typeof target.value === 'string' ? target.value : '');
    setFindCurrent(0);
  }, []);

  const changeReplacement = useCallback(function (event: any) {
    const target = event !== null && event !== undefined ? event.target : null;
    setFindReplacement(target !== null && target !== undefined && typeof target.value === 'string' ? target.value : '');
  }, []);

  const toggleFindOption = useCallback(function (name: any) {
    if (name === 'case') setFindCase(function (previous: boolean) { return previous !== true; });
    else if (name === 'whole') setFindWhole(function (previous: boolean) { return previous !== true; });
    else if (name === 'regex') setFindRegex(function (previous: boolean) { return previous !== true; });
    setFindCurrent(0);
  }, []);

  const nextFind = useCallback(function (direction: any) {
    if (findMatches.length === 0) return;
    const step = direction === -1 ? -1 : 1;
    setFindCurrent(function (previous: number) {
      const next = (previous + step + findMatches.length) % findMatches.length;
      selectFindMatch(findMatches[next]);
      return next;
    });
  }, [findMatches, draft]);

  const replaceCurrent = useCallback(function () {
    if (findOpen === false || findMatches.length === 0 || readOnly === true) return;
    const match = findMatches[Math.min(findCurrent, findMatches.length - 1)];
    if (match === null || match === undefined) return;
    setDraft(draft.slice(0, match.start) + findReplacement + draft.slice(match.end));
    showNotice({ kind: 'success', text: t('find.replaced') });
  }, [findOpen, findMatches, findCurrent, draft, findReplacement, readOnly, showNotice, t]);

  const replaceAll = useCallback(function () {
    if (findOpen === false || findMatches.length === 0 || readOnly === true) return;
    let next = draft;
    for (let index = findMatches.length - 1; index >= 0; index = index - 1) {
      const match = findMatches[index];
      next = next.slice(0, match.start) + findReplacement + next.slice(match.end);
    }
    setDraft(next);
    showNotice({ kind: 'success', text: t('find.replacedAll', { count: S.formatCount(findMatches.length) }) });
  }, [findOpen, findMatches, draft, findReplacement, readOnly, showNotice, t]);

  useEffect(function () {
    if (findOpen === false || findMatches.length === 0) return undefined;
    const index = findCurrent >= findMatches.length ? findMatches.length - 1 : findCurrent;
    selectFindMatch(findMatches[index]);
    return undefined;
  }, [findOpen, findCurrent, findMatches]);

  const openToken =
    props.openRequest !== null && props.openRequest !== undefined && Number.isFinite(props.openRequest.token)
      ? props.openRequest.token
      : 0;

  useEffect(function () {
    const request = props.openRequest;
    if (request === null || request === undefined || typeof request.path !== 'string' || request.path.length === 0) return undefined;
    const targetLine = typeof request.line === 'number' && Number.isFinite(request.line) ? Math.floor(request.line) : 1;
    if (selected === request.path && file.status === 'loaded') {
      setPendingLine(targetLine);
      return undefined;
    }
    openPath(request.path, targetLine);
    return undefined;
  }, [openToken]);

  const onChange = useCallback(function (event: any) {
    const target = event !== null && event !== undefined ? event.target : null;
    const value = target !== null && target !== undefined && typeof target.value === 'string' ? target.value : '';
    setDraft(value);
    if (target !== null && target !== undefined) setCaret(caretFromIndex(value, target.selectionStart));
    const start = target !== null && target !== undefined && Number.isFinite(target.selectionStart) ? target.selectionStart : 0;
    setCaretIndex(start);
    const end = target !== null && target !== undefined && Number.isFinite(target.selectionEnd) ? target.selectionEnd : start;
    setSelection(end > start ? end - start : 0);
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
  }, [draft, file.status, language, readOnly, gotoOpen, openGoto, closeGoto, toggleWrap, findOpen, openFind, closeFind, quickOpen, openQuick, closeQuick, navigateHistory, closeTab, selected, symbolsOpen, openSymbols, closeSymbols, symbolResults, moveSymbol, jumpToSymbol, findOpen, nextFind, changeZoom, resetZoom, recentOpen, openRecent, closeRecent, bookmarksOpen, openBookmarks, closeBookmarks, toggleBookmark, reopenClosedTab, navigateSymbol]);

  const onKeyDown = useCallback(function (event: any) {
    if (event === null || event === undefined) return;
    const key = event.key;
    const meta = event.metaKey === true || event.ctrlKey === true;
    if (meta && (key === 'w' || key === 'W')) {
      event.preventDefault();
      if (selected !== null) closeTab(selected);
      return;
    }
    if (event.altKey === true && meta === false && event.shiftKey !== true && (key === 'ArrowUp' || key === 'ArrowDown')) {
      event.preventDefault();
      navigateSymbol(key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (key === 'F11') {
      event.preventDefault();
      if (event.shiftKey === true) openBookmarks();
      else toggleBookmark();
      return;
    }
    if (meta && event.shiftKey === true && (key === 'e' || key === 'E')) {
      event.preventDefault();
      openRecent();
      return;
    }
    if (meta && event.shiftKey === true && (key === 'o' || key === 'O')) {
      event.preventDefault();
      openSymbols();
      return;
    }
    if (meta && (key === 'p' || key === 'P')) {
      event.preventDefault();
      openQuick();
      return;
    }
    if (meta && event.altKey === true && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault();
      navigateHistory(key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (key === 'Escape' && bookmarksOpen === true) {
      event.preventDefault();
      closeBookmarks();
      return;
    }
    if (key === 'Escape' && recentOpen === true) {
      event.preventDefault();
      closeRecent();
      return;
    }
    if (key === 'Escape' && symbolsOpen === true) {
      event.preventDefault();
      closeSymbols();
      return;
    }
    if (key === 'Escape' && quickOpen === true) {
      event.preventDefault();
      closeQuick();
      return;
    }
    if (meta && (key === 'f' || key === 'F')) {
      event.preventDefault();
      openFind(false);
      return;
    }
    if (meta && (key === 'h' || key === 'H')) {
      event.preventDefault();
      openFind(true);
      return;
    }
    if (key === 'Escape' && findOpen === true) {
      event.preventDefault();
      closeFind();
      return;
    }
    if (meta && (key === '=' || key === '+' || key === ')')) {
      event.preventDefault();
      changeZoom(0.1);
      return;
    }
    if (meta && key === '-') {
      event.preventDefault();
      changeZoom(-0.1);
      return;
    }
    if (meta && key === '0') {
      event.preventDefault();
      resetZoom();
      return;
    }
    if (meta && (key === 'g' || key === 'G')) {
      event.preventDefault();
      openGoto();
      return;
    }
    if (event.altKey === true && (key === 'z' || key === 'Z')) {
      event.preventDefault();
      toggleWrap();
      return;
    }
    if (key === 'Escape' && gotoOpen === true) {
      event.preventDefault();
      closeGoto();
      return;
    }
    if (findOpen === true && key === 'F3') {
      event.preventDefault();
      nextFind(event.shiftKey === true ? -1 : 1);
      return;
    }
    if (readOnly === false && file.status === 'loaded') {
      const editArea = textareaRef.current;
      if (editArea !== null && editArea !== undefined) {
        const editValue = typeof editArea.value === 'string' ? editArea.value : draft;
        const editStart = Number.isFinite(editArea.selectionStart) ? editArea.selectionStart : 0;
        const editEnd = Number.isFinite(editArea.selectionEnd) ? editArea.selectionEnd : editStart;
        if (meta && (key === 'd' || key === 'D')) {
          event.preventDefault();
          const result = typeof S.duplicateLines === 'function' ? S.duplicateLines(editValue, editStart, editEnd) : null;
          if (result !== null && result !== undefined) {
            setDraft(result.text);
            setCaret(caretFromIndex(result.text, result.selectionStart));
            setCaretIndex(result.selectionStart);
            try {
              setTimeout(function () {
                const current = textareaRef.current;
                if (current === null || current === undefined) return;
                try {
                  current.focus();
                  current.setSelectionRange(result.selectionStart, result.selectionEnd);
                } catch (error) {
                  /* selection is a nicety */
                }
              }, 0);
            } catch (error) {
              /* no timer */
            }
          }
          return;
        }
        if (meta && event.shiftKey === true && (key === 't' || key === 'T')) {
      event.preventDefault();
      reopenClosedTab();
      return;
    }
    if (meta && event.shiftKey === true && (key === 'u' || key === 'U')) {
          event.preventDefault();
          applyEditorResult(typeof S.toggleCaseEdit === 'function' ? S.toggleCaseEdit(editValue, editStart, editEnd) : null);
          return;
        }
        if (meta && event.shiftKey === true && (key === 'j' || key === 'J')) {
          event.preventDefault();
          applyEditorResult(typeof S.joinLinesEdit === 'function' ? S.joinLinesEdit(editValue, editStart, editEnd) : null);
          return;
        }
        if (event.altKey === true && event.shiftKey === true && (key === 'ArrowUp' || key === 'ArrowDown')) {
          event.preventDefault();
          const result = typeof S.moveLines === 'function'
            ? S.moveLines(editValue, editStart, editEnd, key === 'ArrowUp' ? -1 : 1)
            : null;
          if (result !== null && result !== undefined) {
            setDraft(result.text);
            setCaret(caretFromIndex(result.text, result.selectionStart));
            setCaretIndex(result.selectionStart);
            try {
              setTimeout(function () {
                const current = textareaRef.current;
                if (current === null || current === undefined) return;
                try {
                  current.focus();
                  current.setSelectionRange(result.selectionStart, result.selectionEnd);
                } catch (error) {
                  /* selection is a nicety */
                }
              }, 0);
            } catch (error) {
              /* no timer */
            }
          }
          return;
        }
      }
    }
    if (readOnly === false && file.status === 'loaded' && meta === false && event.altKey !== true) {
      const textarea = textareaRef.current;
      if (textarea !== null && textarea !== undefined) {
        const value = typeof textarea.value === 'string' ? textarea.value : draft;
        const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : 0;
        const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
        if (key === 'Enter' && event.shiftKey !== true) {
          const result = typeof S.smartIndentEdit === 'function' ? S.smartIndentEdit(value, start, end) : null;
          if (result !== null && result !== undefined) {
            event.preventDefault();
            setDraft(result.text);
            setCaret(caretFromIndex(result.text, result.selectionStart));
            setCaretIndex(result.selectionStart);
            try {
              setTimeout(function () {
                const current = textareaRef.current;
                if (current === null || current === undefined) return;
                try {
                  current.focus();
                  current.setSelectionRange(result.selectionStart, result.selectionEnd);
                } catch (error) {
                  /* selection is a nicety */
                }
              }, 0);
            } catch (error) {
              /* no timer */
            }
            return;
          }
        }
        if (typeof key === 'string' && key.length === 1) {
          const result = typeof S.autoPairEdit === 'function' ? S.autoPairEdit(value, start, end, key) : null;
          if (result !== null && result !== undefined) {
            event.preventDefault();
            if (result.skip === true) {
              try {
                textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
              } catch (error) {
                /* selection is a nicety */
              }
              setCaret(caretFromIndex(value, result.selectionStart));
              setCaretIndex(result.selectionStart);
              return;
            }
            setDraft(result.text);
            setCaret(caretFromIndex(result.text, result.selectionStart));
            setCaretIndex(result.selectionStart);
            try {
              setTimeout(function () {
                const current = textareaRef.current;
                if (current === null || current === undefined) return;
                try {
                  current.focus();
                  current.setSelectionRange(result.selectionStart, result.selectionEnd);
                } catch (error) {
                  /* selection is a nicety */
                }
              }, 0);
            } catch (error) {
              /* no timer */
            }
            return;
          }
        }
      }
    }
    if (key === 'Tab' && event.shiftKey === true) {
      const textarea = textareaRef.current;
      if (textarea !== null && textarea !== undefined) {
        event.preventDefault();
        const value = typeof textarea.value === 'string' ? textarea.value : draft;
        const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : 0;
        const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
        applyEditorResult(typeof S.indentLines === 'function' ? S.indentLines(value, start, end, true) : null);
        return;
      }
    }
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
      const value = typeof textarea.value === 'string' ? textarea.value : draft;
      const start = Number.isFinite(textarea.selectionStart) ? textarea.selectionStart : value.length;
      const end = Number.isFinite(textarea.selectionEnd) ? textarea.selectionEnd : start;
      if (end > start) {
        applyEditorResult(typeof S.indentLines === 'function' ? S.indentLines(value, start, end, false) : null);
        return;
      }
      const nextValue = value.slice(0, start) + '  ' + value.slice(end);
      applyEditorResult({ text: nextValue, selectionStart: start + 2, selectionEnd: start + 2 });
      return;
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
        { title: t('quickOpen.label'), ariaLabel: t('quickOpen.label'), style: { width: 22, height: 22 }, onClick: openQuick },
        h(S.Icons.Search, { size: 12 }),
      ),
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
        onOpen: openPath,
        onReloadDir: loadDir,
        dirPath: '',
        depth: 0,
      }),
      treeTruncated ? h('div', { style: ST_FILES.treeTruncated }, t('files.tree.truncated')) : null,
    ),
  );

  const revealPath = useCallback(function (prefix: any) {
    if (typeof prefix !== 'string' || prefix.length === 0) return;
    const parts = prefix.split('/').filter(function (part: string) { return part.length > 0; });
    if (parts.length === 0) return;
    const expandedNext: Record<string, boolean> = {};
    for (let index = 1; index <= parts.length; index = index + 1) {
      expandedNext[parts.slice(0, index).join('/')] = true;
    }
    setExpanded(function (previous: Record<string, boolean>) { return Object.assign({}, previous, expandedNext); });
    for (let index = 1; index <= parts.length; index = index + 1) {
      const partPath = parts.slice(0, index).join('/');
      if (tree[partPath] === undefined || tree[partPath] === null) loadDir(partPath);
    }
  }, [tree, loadDir]);

  /** @type {any} */
  let viewer: any = null;
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
      onBreadcrumb: revealPath,
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
      wrap: wrap,
      onToggleWrap: toggleWrap,
      zoom: zoom,
      onZoomReset: resetZoom,
      bookmarkLines: selected === null ? [] : (bookmarks[selected] === undefined ? [] : bookmarks[selected]),
      gitMarkers: gitMarkers,
      currentSymbol: currentSymbol,
      onBookmarksOpen: openBookmarks,
      gotoOpen: gotoOpen,
      gotoValue: gotoValue,
      onGotoOpen: openGoto,
      onGotoChange: changeGoto,
      onGotoSubmit: submitGoto,
      onGotoClose: closeGoto,
      onFindOpen: function () { openFind(false); },
      onSymbolsOpen: openSymbols,
      symbolsOpen: symbolsOpen,
      selection: selection,
      eol: eol,
      onReload: reloadSelected,
      onBreadcrumb: revealPath,
      canGoBack: canGoBack,
      canGoForward: canGoForward,
      onNavigateBack: function () { navigateHistory(-1); },
      onNavigateForward: function () { navigateHistory(1); },
      findOpen: findOpen,
      findReplace: findReplace,
      findQuery: findQuery,
      findReplacement: findReplacement,
      findMatches: findMatches,
      findCurrent: findCurrent,
      findCase: findCase,
      findWhole: findWhole,
      findRegex: findRegex,
      findInvalidRegex: findRegexInvalid,
      onFindChange: changeFind,
      onFindReplacementChange: changeReplacement,
      onFindOption: toggleFindOption,
      onFindNext: function () { nextFind(1); },
      onFindPrev: function () { nextFind(-1); },
      onFindClose: closeFind,
      onFindReplaceOpen: function () { setFindReplace(function (previous: boolean) { return previous !== true; }); },
      onFindReplaceOne: replaceCurrent,
      onFindReplaceAll: replaceAll,
      bracketRanges: bracketRanges,
    });
  } else {
    viewer = h(S.EmptyState, { t: t, icon: S.Icons.Files, title: t('files.open.title'), body: t('files.open.body') });
  }

  const bookmarksPanel = bookmarksOpen
    ? h(
        'div',
        { style: ST_FILES.quickLayer, onMouseDown: function () { closeBookmarks(); } },
        h(
          'div',
          {
            style: ST_FILES.quickPanel,
            onMouseDown: function (event: any) {
              if (event !== null && event !== undefined && typeof event.stopPropagation === 'function') event.stopPropagation();
            },
          },
          h(
            'div',
            { style: ST_FILES.quickInputRow },
            h('span', { style: ST_FILES.quickIndexIcon }, h(S.Icons.Dot, { size: 10 })),
            h('input', {
              type: 'text',
              value: bookmarksQuery,
              placeholder: t('bookmarks.label'),
              'aria-label': t('bookmarks.label'),
              style: ST_FILES.quickInput,
              autoFocus: true,
              onChange: changeBookmarksQuery,
              onKeyDown: function (event: any) {
                if (event === null || event === undefined) return;
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveBookmark(1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveBookmark(-1);
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const entry = bookmarkResults[bookmarksIndex];
                  if (entry !== null && entry !== undefined) jumpBookmark(entry);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  closeBookmarks();
                }
              },
            }),
            h('span', { style: ST_FILES.quickBadge }, t('bookmarks.toggleHint')),
          ),
          h(
            'div',
            { style: ST_FILES.quickList, role: 'listbox', 'aria-label': t('bookmarks.label') },
            bookmarkResults.length === 0
              ? h('div', { style: ST_FILES.quickEmpty }, t('bookmarks.empty'))
              : bookmarkResults.map(function (entry: any, index: number) {
                  const slash = entry.path.lastIndexOf('/');
                  const directory = slash >= 0 ? entry.path.slice(0, slash + 1) : '';
                  const basename = slash >= 0 ? entry.path.slice(slash + 1) : entry.path;
                  return h(
                    'div',
                    {
                      key: 'bookmark-row-' + entry.path + '-' + String(entry.line),
                      role: 'option',
                      'aria-selected': index === bookmarksIndex ? 'true' : 'false',
                      style: Object.assign({}, ST_FILES.quickRow, index === bookmarksIndex ? ST_FILES.quickRowActive : null),
                      title: entry.path + ':' + String(entry.line),
                      onMouseDown: function (event: any) {
                        if (event !== null && event !== undefined && typeof event.preventDefault === 'function') event.preventDefault();
                        jumpBookmark(entry);
                      },
                    },
                    directory.length > 0 ? h('span', { style: ST_FILES.quickPathDir }, directory) : null,
                    h('span', { style: ST_FILES.quickPathFile }, basename),
                    h('span', { style: { flex: '1 1 auto' } }),
                    h('span', { style: ST_FILES.symbolLine }, ':' + String(entry.line)),
                  );
                }),
          ),
          h('div', { style: ST_FILES.quickHint }, t('bookmarks.hint')),
        ),
      )
    : null;

  const recentPanel = recentOpen
    ? h(
        'div',
        { style: ST_FILES.quickLayer, onMouseDown: function () { closeRecent(); } },
        h(
          'div',
          {
            style: ST_FILES.quickPanel,
            onMouseDown: function (event: any) {
              if (event !== null && event !== undefined && typeof event.stopPropagation === 'function') event.stopPropagation();
            },
          },
          h(
            'div',
            { style: ST_FILES.quickInputRow },
            h('span', { style: ST_FILES.quickIndexIcon }, h(S.Icons.Search, { size: 14 })),
            h('input', {
              type: 'text',
              value: recentQuery,
              placeholder: t('recentLocations.label'),
              'aria-label': t('recentLocations.label'),
              style: ST_FILES.quickInput,
              autoFocus: true,
              onChange: changeRecentQuery,
              onKeyDown: function (event: any) {
                if (event === null || event === undefined) return;
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveRecent(1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveRecent(-1);
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const entry = recentResults[recentIndex];
                  if (entry !== null && entry !== undefined) jumpRecent(entry);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  closeRecent();
                }
              },
            }),
            h('span', { style: ST_FILES.quickBadge }, t('recentLocations.label')),
          ),
          h(
            'div',
            { style: ST_FILES.quickList, role: 'listbox', 'aria-label': t('recentLocations.label') },
            recentResults.length === 0
              ? h('div', { style: ST_FILES.quickEmpty }, t('recentLocations.empty'))
              : recentResults.map(function (entry: any, index: number) {
                  const slash = entry.path.lastIndexOf('/');
                  const directory = slash >= 0 ? entry.path.slice(0, slash + 1) : '';
                  const basename = slash >= 0 ? entry.path.slice(slash + 1) : entry.path;
                  return h(
                    'div',
                    {
                      key: 'recent-' + String(index) + '-' + entry.path,
                      role: 'option',
                      'aria-selected': index === recentIndex ? 'true' : 'false',
                      style: Object.assign({}, ST_FILES.quickRow, index === recentIndex ? ST_FILES.quickRowActive : null),
                      title: entry.path + ':' + String(entry.line),
                      onMouseDown: function (event: any) {
                        if (event !== null && event !== undefined && typeof event.preventDefault === 'function') event.preventDefault();
                        jumpRecent(entry);
                      },
                    },
                    directory.length > 0 ? h('span', { style: ST_FILES.quickPathDir }, directory) : null,
                    h('span', { style: ST_FILES.quickPathFile }, basename),
                    h('span', { style: { flex: '1 1 auto' } }),
                    h('span', { style: ST_FILES.symbolLine }, ':' + String(entry.line)),
                  );
                }),
          ),
          h('div', { style: ST_FILES.quickHint }, t('recentLocations.hint')),
        ),
      )
    : null;

  const symbolPanel = symbolsOpen
    ? h(
        'div',
        { style: ST_FILES.quickLayer, onMouseDown: function () { closeSymbols(); } },
        h(
          'div',
          {
            style: ST_FILES.quickPanel,
            onMouseDown: function (event: any) {
              if (event !== null && event !== undefined && typeof event.stopPropagation === 'function') event.stopPropagation();
            },
          },
          h(
            'div',
            { style: ST_FILES.quickInputRow },
            h('span', { style: ST_FILES.quickIndexIcon }, h(S.Icons.Symbol, { size: 14 })),
            h('input', {
              type: 'text',
              value: symbolQuery,
              placeholder: t('symbols.placeholder'),
              'aria-label': t('symbols.label'),
              style: ST_FILES.quickInput,
              autoFocus: true,
              onChange: changeSymbolQuery,
              onKeyDown: function (event: any) {
                if (event === null || event === undefined) return;
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveSymbol(1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveSymbol(-1);
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const symbol = symbolResults[symbolIndex];
                  if (symbol !== null && symbol !== undefined) jumpToSymbol(symbol);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  closeSymbols();
                }
              },
            }),
            h('span', { style: ST_FILES.quickBadge }, t('symbols.label')),
          ),
          h(
            'div',
            { style: ST_FILES.quickList, role: 'listbox', 'aria-label': t('symbols.label') },
            symbolResults.length === 0
              ? h('div', { style: ST_FILES.quickEmpty }, t('symbols.noResults'))
              : symbolResults.map(function (symbol: any, index: number) {
                  return h(
                    'div',
                    {
                      key: 'symbol-' + String(symbol.line) + '-' + symbol.name,
                      role: 'option',
                      'aria-selected': index === symbolIndex ? 'true' : 'false',
                      style: Object.assign({}, ST_FILES.quickRow, index === symbolIndex ? ST_FILES.quickRowActive : null),
                      title: symbol.name,
                      onMouseDown: function (event: any) {
                        if (event !== null && event !== undefined && typeof event.preventDefault === 'function') event.preventDefault();
                        jumpToSymbol(symbol);
                      },
                    },
                    h('span', { style: ST_FILES.symbolKind }, t('symbols.kind.' + symbol.kind)),
                    h('span', { style: ST_FILES.quickPathFile }, symbol.name),
                    h('span', { style: { flex: '1 1 auto' } }),
                    h('span', { style: ST_FILES.symbolLine }, ':' + String(symbol.line)),
                  );
                }),
          ),
          h('div', { style: ST_FILES.quickHint }, t('symbols.hint')),
        ),
      )
    : null;

  const quickPanel = quickOpen
    ? h(
        'div',
        { style: ST_FILES.quickLayer, onMouseDown: function () { closeQuick(); } },
        h(
          'div',
          {
            style: ST_FILES.quickPanel,
            onMouseDown: function (event: any) {
              if (event !== null && event !== undefined && typeof event.stopPropagation === 'function') event.stopPropagation();
            },
          },
          h(
            'div',
            { style: ST_FILES.quickInputRow },
            h('span', { style: ST_FILES.quickIndexIcon }, h(S.Icons.Search, { size: 14 })),
            h('input', {
              ref: quickInputRef,
              type: 'text',
              value: quickQuery,
              placeholder: t('quickOpen.placeholder'),
              'aria-label': t('quickOpen.label'),
              style: ST_FILES.quickInput,
              onChange: changeQuickQuery,
              onKeyDown: function (event: any) {
                if (event === null || event === undefined) return;
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  moveQuick(1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  moveQuick(-1);
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const row = quickResults[quickIndex];
                  if (row !== null && row !== undefined) openQuickPath(row.path);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  closeQuick();
                }
              },
            }),
            quickQuery.trim().length === 0 && quickResults.length > 0
              ? h('span', { style: ST_FILES.quickBadge }, t('quickOpen.recent'))
              : quickTruncated
                ? h('span', { style: ST_FILES.quickBadge }, t('quickOpen.truncated'))
                : null,
          ),
          h(
            'div',
            { style: ST_FILES.quickList, role: 'listbox', 'aria-label': t('quickOpen.label') },
            quickLoading
              ? h('div', { style: ST_FILES.quickEmpty }, t('quickOpen.loading'))
              : quickError !== null && quickError !== undefined
                ? h('div', { style: ST_FILES.quickEmpty }, S.errorText(quickError))
                : quickResults.length === 0
                  ? h('div', { style: ST_FILES.quickEmpty }, t('quickOpen.noResults'))
                  : quickResults.map(function (row: any, index: number) {
                      const slash = row.path.lastIndexOf('/');
                      const directory = slash >= 0 ? row.path.slice(0, slash + 1) : '';
                      const basename = slash >= 0 ? row.path.slice(slash + 1) : row.path;
                      return h(
                        'div',
                        {
                          key: row.path,
                          role: 'option',
                          'aria-selected': index === quickIndex ? 'true' : 'false',
                          style: Object.assign({}, ST_FILES.quickRow, index === quickIndex ? ST_FILES.quickRowActive : null),
                          title: row.path,
                          onMouseDown: function (event: any) {
                            if (event !== null && event !== undefined && typeof event.preventDefault === 'function') event.preventDefault();
                            openQuickPath(row.path);
                          },
                        },
                        directory.length > 0 ? h('span', { style: ST_FILES.quickPathDir }, directory) : null,
                        h('span', { style: ST_FILES.quickPathFile }, basename),
                      );
                    }),
          ),
          h('div', { style: ST_FILES.quickHint }, t('quickOpen.hint')),
        ),
      )
    : null;

  const tabItems = tabs.map(function (path: string) {
    return { path: path, active: path === selected, dirty: tabDirty(path) };
  });
  const closeConfirm = closingTab !== null
    ? h(
        'div',
        { style: ST_FILES.closeConfirmBar, role: 'alert' },
        h(
          'span',
          { style: { flex: '1 1 auto' } },
          t('files.tab.unsaved', { name: String(S.baseName(closingTab) || closingTab) }),
        ),
        h(
          S.GhostButton,
          { title: t('files.tab.cancelClose'), ariaLabel: t('files.tab.cancelClose'), onClick: function () { setClosingTab(null); } },
          t('files.tab.cancelClose'),
        ),
        h(
          S.GhostButton,
          {
            title: t('files.tab.confirmClose'),
            ariaLabel: t('files.tab.confirmClose'),
            onClick: function () {
              const path = closingTab;
              setClosingTab(null);
              closeTab(path);
            },
          },
          t('files.tab.confirmClose'),
        ),
      )
    : null;
  const rightPane = h(
    'div',
    { style: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: 0, minHeight: 0, height: '100%' } },
    h(S.TabStrip, {
      t: t,
      tabs: tabItems,
      label: t('tabs.files'),
      onSelect: function (path: any) {
        if (path !== selected) openPath(path, null);
      },
      onClose: closeTab,
    }),
    closeConfirm,
    viewer,
  );

  return h(
    'div',
    { style: { display: 'flex', position: 'relative', height: '100%', minHeight: 0, width: '100%' } },
    h(S.SplitPane, {
      left: treePane,
      right: rightPane,
      storageKey: 'dsh-workspace-ide:files-tree-width',
      initialWidth: 300,
      minWidth: SPLIT_MIN,
      maxWidth: SPLIT_MAX,
      handleLabel: t('files.tree.label'),
    }),
    bookmarksPanel,
    recentPanel,
    symbolPanel,
    quickPanel,
  );
}

S.FilesView = FilesView;
S.FileViewer = FileViewer;
S.TabStrip = TabStrip;
S.ImageViewer = ImageViewer;
S.FileTreeRow = FileTreeRow;
S.TreeDirRows = TreeDirRows;
S.countLines = countLines;
S.lineNumbersText = lineNumbersText;
S.caretFromIndex = caretFromIndex;
S.keepTreeEntry = keepTreeEntry;
S.ST_FILES = ST_FILES;
