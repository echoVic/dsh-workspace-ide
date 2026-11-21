/**
 * dsh-workspace-ide — client half, the shell.
 *
 * The shell fills the central `main` slot. It owns the toolbar (the three-icon
 * strip that is the centrepiece of the panel, the workspace picker and the
 * refresh action), the workspace-root selection (persisted in localStorage,
 * preferring a workspace with a live session) and the error boundary that keeps
 * a render failure from blanking the slot.
 *
 * The three views below are pure consumers of `{ t, root, onOpenFile,
 * reloadToken }`; `onOpenFile(path, line)` switches back to Files with an
 * `openRequest` the Files view turns into a scroll-and-select.
 */

const ST_SHELL = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    flex: '1 1 auto',
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
    background: C.base,
    color: C.text,
    fontFamily: FONT_UI,
    fontSize: uiPx(13),
    lineHeight: 1.4,
    position: 'relative',
    boxSizing: 'border-box',
    // The DSH mac desktop frame publishes the chrome bands it reserves from the
    // window edge. A main-panel surface that reaches the top-left corner must
    // pad by them, or its first row sits under the traffic lights / drag strip
    // (clicks get swallowed by the window drag region). Both variables are
    // absent outside the desktop frame, so the fallback keeps web/headless flat.
    paddingTop: 'var(--dsh-frame-top-clearance, 0px)',
    paddingInlineStart: 'var(--dsh-frame-leading-clearance, 0px)',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    height: 46,
    flex: '0 0 auto',
    padding: '0 10px',
    boxSizing: 'border-box',
    borderBottom: '1px solid ' + C.border1,
    background: C.base,
  },
  tabStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
  },
  spacer: {
    flex: '1 1 auto',
    minWidth: 12,
  },
  picker: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: uiPx(27),
    maxWidth: 320,
    minWidth: 120,
    padding: '0 8px',
    boxSizing: 'border-box',
    border: '1px solid ' + C.border1,
    borderRadius: 6,
    background: C.platform,
    color: C.text,
    fontFamily: FONT_UI,
    fontSize: uiPx(12),
    cursor: 'pointer',
    outline: 'none',
    overflow: 'hidden',
    transition: 'background 120ms ease, border-color 120ms ease',
  },
  pickerHover: {
    background: C.hover,
    borderColor: C.border2,
  },
  pickerOpen: {
    background: C.activeBg,
    borderColor: C.border2,
  },
  pickerFocused: {
    boxShadow: '0 0 0 2px var(--dsw-focus-ring-color, ' + C.accent + ')',
  },
  pickerDisabled: {
    opacity: 0.6,
    cursor: 'default',
  },
  pickerIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    color: C.accent,
    flex: '0 0 auto',
  },
  pickerLabel: {
    flex: '0 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  pickerLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    background: C.diffAdd,
    flex: '0 0 auto',
  },
  pickerCaret: {
    display: 'inline-flex',
    alignItems: 'center',
    color: C.textTertiary,
    flex: '0 0 auto',
    transition: 'transform 140ms ease',
  },
  // ── custom workspace-picker popover ──
  wsMenu: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    zIndex: 60,
    display: 'flex',
    flexDirection: 'column',
    width: 340,
    maxWidth: 'min(380px, 85vw)',
    boxSizing: 'border-box',
    border: '1px solid ' + C.border2,
    borderRadius: 10,
    background: C.platform,
    color: C.text,
    overflow: 'hidden',
    boxShadow: '0 12px 32px color-mix(in srgb, ' + C.text + ' 22%, transparent)',
  },
  wsSearchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '8px 10px',
    borderBottom: '1px solid ' + C.border1,
    background: C.base,
    flex: '0 0 auto',
  },
  wsSearchIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    color: C.textTertiary,
    flex: '0 0 auto',
  },
  wsSearchInput: {
    flex: '1 1 auto',
    minWidth: 0,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: C.text,
    fontFamily: FONT_UI,
    fontSize: uiPx(12),
    lineHeight: 1.4,
    padding: 0,
  },
  wsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: 5,
    maxHeight: 'min(360px, 55vh)',
    overflowY: 'auto',
    overflowX: 'hidden',
    minHeight: 0,
  },
  wsGroupLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 8px 3px',
    fontSize: uiPx(10.5),
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: C.textTertiary,
    userSelect: 'none',
  },
  wsGroupCount: {
    fontWeight: 400,
    opacity: 0.78,
  },
  wsOption: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: '6px 8px',
    boxSizing: 'border-box',
    border: 'none',
    borderRadius: 7,
    background: 'transparent',
    color: C.text,
    fontFamily: FONT_UI,
    textAlign: 'left',
    cursor: 'pointer',
    outline: 'none',
    transition: 'background 100ms ease',
  },
  wsOptionHot: {
    background: C.hover,
  },
  wsOptionActive: {
    background: C.activeBg,
  },
  wsOptionLeading: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16,
    flex: '0 0 auto',
    color: C.textTertiary,
  },
  wsOptionBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flex: '1 1 auto',
    minWidth: 0,
  },
  wsOptionTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  wsOptionTitle: {
    flex: '0 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: uiPx(12.5),
    fontWeight: 500,
    lineHeight: 1.3,
    color: C.text,
  },
  wsOptionTitleSelected: {
    fontWeight: 600,
  },
  wsOptionPath: {
    fontFamily: FONT_MONO,
    fontSize: uiPx(10.5),
    lineHeight: 1.3,
    color: C.textTertiary,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  wsMeta: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    flex: '0 0 auto',
    marginLeft: 'auto',
  },
  wsLiveBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '0 5px',
    height: uiPx(16),
    borderRadius: 999,
    border: '1px solid ' + C.border1,
    background: C.base,
    color: C.diffAdd,
    fontSize: uiPx(10),
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  wsGitIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    color: C.textTertiary,
    opacity: 0.8,
  },
  wsEmpty: {
    padding: '18px 12px',
    textAlign: 'center',
    color: C.textTertiary,
    fontSize: uiPx(12),
  },
  wsFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '5px 10px',
    borderTop: '1px solid ' + C.border1,
    background: C.base,
    color: C.textTertiary,
    fontSize: uiPx(10.5),
    whiteSpace: 'nowrap',
  },
  workspaceHint: {
    fontSize: uiPx(11),
    color: C.textTertiary,
    padding: '0 2px',
    maxWidth: 300,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // ── font-size picker (toolbar button + popover) ──
  fontMenu: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    zIndex: 60,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    width: 268,
    padding: '8px 10px 10px',
    boxSizing: 'border-box',
    border: '1px solid ' + C.border2,
    borderRadius: 9,
    background: C.platform,
    color: C.text,
    boxShadow: '0 12px 30px color-mix(in srgb, ' + C.text + ' 20%, transparent)',
  },
  fontSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  fontSectionRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  fontLabel: {
    fontSize: uiPx(12),
    fontWeight: 500,
    color: C.text,
    whiteSpace: 'nowrap',
  },
  fontStepper: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    flex: '0 0 auto',
  },
  fontStepButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    padding: 0,
    border: '1px solid ' + C.border1,
    borderRadius: 5,
    background: C.base,
    color: C.text,
    cursor: 'pointer',
    outline: 'none',
    flex: '0 0 auto',
  },
  fontStepButtonDisabled: {
    opacity: 0.4,
    cursor: 'default',
  },
  fontInput: {
    width: 48,
    height: 24,
    padding: '0 4px',
    boxSizing: 'border-box',
    border: '1px solid ' + C.border1,
    borderRadius: 5,
    background: C.base,
    color: C.text,
    fontFamily: FONT_MONO,
    fontSize: uiPx(12),
    textAlign: 'center',
    outline: 'none',
  },
  fontUnit: {
    fontSize: uiPx(11),
    color: C.textTertiary,
    fontFamily: FONT_MONO,
  },
  fontPresets: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  fontPreset: {
    flex: '1 1 0',
    height: 22,
    padding: '0 4px',
    border: '1px solid ' + C.border1,
    borderRadius: 5,
    background: 'transparent',
    color: C.textSecondary,
    fontFamily: FONT_MONO,
    fontSize: uiPx(11),
    cursor: 'pointer',
    outline: 'none',
  },
  fontPresetActive: {
    background: C.activeBg,
    borderColor: C.accent,
    color: C.text,
    fontWeight: 600,
  },
  fontFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 8,
    borderTop: '1px solid ' + C.border1,
  },
  fontHint: {
    fontSize: uiPx(10.5),
    color: C.textTertiary,
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // ── colour-theme picker (toolbar button + custom popover) ──
  themeWrap: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    flex: '0 0 auto',
  },
  themeMenu: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    right: 0,
    zIndex: 60,
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    width: 240,
    padding: 6,
    boxSizing: 'border-box',
    border: '1px solid ' + C.border2,
    borderRadius: 9,
    background: C.platform,
    color: C.text,
    // A token-derived shadow: box shadows must not introduce literal colours.
    boxShadow: '0 12px 30px color-mix(in srgb, ' + C.text + ' 20%, transparent)',
  },
  themeMenuHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 24,
    flex: '0 0 auto',
    padding: '0 2px 0 8px',
  },
  themeMenuTitle: {
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: C.textTertiary,
    fontSize: uiPx(10.5),
    fontWeight: 600,
    letterSpacing: '0.06em',
  },
  themeMenuList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    flex: '1 1 auto',
    minHeight: 0,
  },
  themeOption: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    height: uiPx(30),
    padding: '0 8px',
    boxSizing: 'border-box',
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: C.textSecondary,
    fontFamily: FONT_UI,
    fontSize: uiPx(12),
    textAlign: 'left',
    cursor: 'pointer',
    outline: 'none',
    transition: 'background 120ms ease, color 120ms ease',
  },
  themeOptionHot: {
    background: C.hover,
    color: C.text,
  },
  themeOptionActive: {
    background: C.activeBg,
    color: C.text,
  },
  themeSwatches: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    flex: '0 0 auto',
  },
  themeSwatch: {
    display: 'inline-block',
    width: 9,
    height: 9,
    borderRadius: 999,
    border: '1px solid ' + C.border2,
    boxSizing: 'border-box',
    flex: '0 0 auto',
  },
  themeOptionLabel: {
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  themeCheck: {
    display: 'inline-flex',
    alignItems: 'center',
    flex: '0 0 auto',
    color: C.accent,
  },
  body: {
    display: 'flex',
    flex: '1 1 auto',
    minHeight: 0,
    minWidth: 0,
    position: 'relative',
    overflow: 'hidden',
  },
  boundaryCard: {
    display: 'flex',
    flex: '1 1 auto',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: '100%',
    padding: 24,
    boxSizing: 'border-box',
    textAlign: 'center',
    background: C.base,
    color: C.text,
    fontFamily: FONT_UI,
    fontSize: uiPx(13),
  },
  boundaryWrap: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
  },
  boundaryIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 46,
    height: 46,
    borderRadius: 13,
    border: '1px solid ' + C.border1,
    background: C.layer1,
    color: C.error,
  },
  boundaryTitle: {
    margin: 0,
    fontSize: uiPx(13.5),
    fontWeight: 600,
  },
  boundaryBody: {
    margin: 0,
    maxWidth: 460,
    fontSize: uiPx(12),
    lineHeight: 1.5,
    color: C.textSecondary,
    wordBreak: 'break-word',
  },
  boundaryHint: {
    margin: 0,
    maxWidth: 460,
    fontSize: uiPx(11.5),
    color: C.textTertiary,
  },
};

/** @param {string} path - absolute path. @returns {string} last path segment. */
function baseName(path: string): string {
  if (typeof path !== 'string' || path.length === 0) return '';
  const trimmed = path.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

/**
 * Read the persisted root selection. This plugin stores `{ root, sessionId }`
 * JSON so an explicit pick can be scoped to the session it was made in; the
 * plain-string form written by early builds is still accepted.
 *
 * @returns {{root: string, sessionId: string|null}|null} selection.
 */
function readRootSelection() {
  const raw = readStorage(STORAGE_ROOT);
  if (typeof raw !== 'string' || raw.length === 0) return null;
  if (raw.charAt(0) === '{') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object' && typeof parsed.root === 'string' && parsed.root.length > 0) {
        return { root: parsed.root, sessionId: typeof parsed.sessionId === 'string' && parsed.sessionId.length > 0 ? parsed.sessionId : null };
      }
    } catch (error) {
      /* corrupt JSON: fall through to the default picks */
    }
    return null;
  }
  return { root: raw, sessionId: null };
}

/**
 * Persist an explicit root pick, tagged with the session that made it.
 * @param {string} root - workspace path.
 * @param {string|null} sessionId - session currently viewed.
 */
function writeRootSelection(root: string, sessionId: string|null) {
  if (typeof root !== 'string' || root.length === 0) return;
  writeStorage(STORAGE_ROOT, JSON.stringify({ root: root, sessionId: typeof sessionId === 'string' ? sessionId : null }));
}

/**
 * Choose the workspace root shown by default.
 *
 * Order: the current root when still listed → an explicit pick already made in
 * this session → the workspace owning the session the app is viewing → any
 * persisted root → a workspace with a live session → the first workspace.
 *
 * @param {Array<{path: string, live?: boolean}>} list - workspace list.
 * @param {string|null} current - root currently displayed.
 * @param {string|null} sessionPreferred - workspace owning the viewed session.
 * @returns {string|null} selected root path.
 */
function pickRoot(list: any, current: string|null, sessionPreferred: string|null): string|null {
  if (!Array.isArray(list) || list.length === 0) return null;
  const has = function (path: any) {
    if (typeof path !== 'string' || path.length === 0) return false;
    return list.some(function (entry) {
      return entry !== null && entry !== undefined && entry.path === path;
    });
  };
  if (has(current)) return current;
  const stored = readRootSelection();
  const sessionId = S.getCurrentSessionId();
  if (stored !== null && stored.sessionId !== null && stored.sessionId === sessionId && has(stored.root)) return stored.root;
  if (has(sessionPreferred)) return sessionPreferred;
  if (stored !== null && has(stored.root)) return stored.root;
  const live = list.find(function (entry) {
    return entry !== null && entry !== undefined && entry.live === true;
  });
  if (live) return live.path;
  return list[0].path;
}

/** Normalise the Host's workspace payload into the shape the picker renders. */
function normalizeWorkspaces(payload: any) {
  const raw = payload !== null && payload !== undefined && Array.isArray(payload.workspaces) ? payload.workspaces : [];
  const list: any[] = [];
  raw.forEach(function (entry: any) {
    if (entry === null || entry === undefined || typeof entry.path !== 'string' || entry.path.length === 0) return;
    list.push({
      id: typeof entry.id === 'string' ? entry.id : entry.path,
      path: entry.path,
      title: typeof entry.title === 'string' && entry.title.length > 0 ? entry.title : baseName(entry.path),
      sessionCount: Number.isFinite(entry.sessionCount) ? entry.sessionCount : 0,
      live: entry.live === true,
      git: entry.git === true,
    });
  });
  return list;
}

/**
 * Display name of a theme: `auto` goes through the dictionary, the six VSCode
 * palettes keep their proper names in both languages.
 *
 * @param {Function|undefined} translator - current `t`.
 * @param {{id: string, label: string|null}} entry - theme entry.
 * @returns {string} the name to render.
 */
function themeName(translator: Function|any, entry: any): string {
  if (entry === null || entry === undefined) return '';
  if (entry.id === 'auto') return translateOrKey(translator, 'theme.auto');
  return typeof entry.label === 'string' && entry.label.length > 0 ? entry.label : String(entry.id);
}

/**
 * The two preview dots of a theme row: its `bg-base` and `link` colours — both
 * palette tokens, so even the preview is theme-token driven. `auto` previews
 * the live DSH tokens instead of an override table.
 *
 * @param {{palette: object|null}|null|undefined} entry - theme entry.
 * @returns {{base: string, link: string}} CSS colour values.
 */
function themeSwatches(entry: any) {
  const palette = entry !== null && entry !== undefined && entry.palette !== null && entry.palette !== undefined ? entry.palette : null;
  if (palette === null) return { base: C.base, link: C.accent };
  return {
    base: typeof palette['--dsw-alias-bg-base'] === 'string' ? palette['--dsw-alias-bg-base'] : C.base,
    link: typeof palette['--dsw-alias-link'] === 'string' ? palette['--dsw-alias-link'] : C.accent,
  };
}

/**
 * Colour-theme picker: one borderless toolbar button plus a custom popover (no
 * native `<select>`), so each row can show its two preview colours, the current
 * check mark and proper `listbox` semantics.
 *
 * Interaction contract: click / Enter / Space toggles; pointer-down outside or
 * Escape closes; ArrowUp/ArrowDown/Home/End move through the options; choosing
 * an option applies + persists it through `onSelectTheme` and returns focus to
 * the trigger.
 */
function ThemePicker(props: any) {
  const t = typeof props.t === 'function' ? props.t : S.translate;
  const activeTheme = typeof props.theme === 'string' ? props.theme : 'auto';
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState<any>(null);
  const wrapRef = useRef<any>(null);
  const optionRefs = useRef<any[]>([]);
  optionRefs.current = [];

  /** Focus the trigger button again (the wrapper's first button is the trigger). */
  const focusTrigger = useCallback(function () {
    const wrapper = wrapRef.current;
    if (wrapper === null || wrapper === undefined || typeof wrapper.querySelector !== 'function') return;
    const trigger = wrapper.querySelector('button');
    if (trigger !== null && trigger !== undefined && typeof trigger.focus === 'function') trigger.focus();
  }, []);

  const closeMenu = useCallback(function (refocus: any) {
    setOpen(false);
    setHot(null);
    if (refocus === true) focusTrigger();
  }, [focusTrigger]);

  // While open: close on outside pointer-down and on Escape (document-level so
  // the panel keeps working even when focus sits on a non-focusable child).
  useEffect(function () {
    if (!open) return undefined;
    const onPointerDown = function (event: any) {
      const wrapper = wrapRef.current;
      const target = event !== null && event !== undefined ? event.target : null;
      if (wrapper !== null && wrapper !== undefined && typeof wrapper.contains === 'function' && target !== null && target !== undefined && wrapper.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = function (event: any) {
      if (event === null || event === undefined || event.key !== 'Escape') return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      closeMenu(true);
    };
    try {
      if (typeof document === 'undefined' || document === null || typeof document.addEventListener !== 'function') return undefined;
      document.addEventListener('mousedown', onPointerDown, true);
      document.addEventListener('keydown', onKeyDown, true);
    } catch (error) {
      return undefined;
    }
    return function () {
      try {
        document.removeEventListener('mousedown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
      } catch (error) {
        /* no DOM */
      }
    };
  }, [open, closeMenu]);

  // On open, put focus on the current option so the popover is usable from the
  // keyboard immediately after Enter/ArrowDown on the trigger.
  useEffect(function () {
    if (!open) return undefined;
    let index = 0;
    for (let cursor = 0; cursor < S.THEMES.length; cursor += 1) {
      if (S.THEMES[cursor].id === activeTheme) {
        index = cursor;
        break;
      }
    }
    const node = optionRefs.current[index];
    if (node !== null && node !== undefined && typeof node.focus === 'function') node.focus();
    return undefined;
  }, [open, activeTheme]);

  /** Move focus between option buttons: relative delta or 'first'/'last'. */
  function focusOption(position: any) {
    const nodes = optionRefs.current;
    if (!Array.isArray(nodes) || nodes.length === 0) return;
    const current = typeof document !== 'undefined' && document !== null ? document.activeElement : null;
    let index = -1;
    for (let cursor = 0; cursor < nodes.length; cursor += 1) {
      if (nodes[cursor] !== null && nodes[cursor] !== undefined && nodes[cursor] === current) {
        index = cursor;
        break;
      }
    }
    let next;
    if (position === 'first') next = 0;
    else if (position === 'last') next = nodes.length - 1;
    else if (index === -1) next = 0;
    else next = (index + position + nodes.length) % nodes.length;
    const node = nodes[next];
    if (node !== null && node !== undefined && typeof node.focus === 'function') node.focus();
  }

  const onMenuKeyDown = function (event: any) {
    if (event === null || event === undefined) return;
    const key = event.key;
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (key === 'Home') focusOption('first');
    else if (key === 'End') focusOption('last');
    else focusOption(key === 'ArrowDown' ? 1 : -1);
  };

  // Refocus the trigger only for keyboard-driven closes: a pointer selection
  // must not leave a focus ring around the palette glyph.
  const chooseTheme = function (id: any, event: any) {
    if (typeof props.onSelectTheme === 'function') props.onSelectTheme(id);
    const keyboard = event !== null && event !== undefined && event.detail === 0;
    closeMenu(keyboard);
  };

  const rows = S.THEMES.map(function (entry: any, index: any) {
    const selected = entry.id === activeTheme;
    const swatches = themeSwatches(entry);
    return h(
      'button',
      {
        key: entry.id,
        type: 'button',
        role: 'option',
        'aria-selected': selected ? 'true' : 'false',
        'data-theme': entry.id,
        title: themeName(t, entry),
        style: Object.assign(
          {},
          ST_SHELL.themeOption,
          selected ? ST_SHELL.themeOptionActive : null,
          hot === entry.id && !selected ? ST_SHELL.themeOptionHot : null,
        ),
        ref: function (node) {
          optionRefs.current[index] = /** @type {HTMLElement|null} */ (node);
        },
        onMouseEnter: function () { setHot(entry.id); },
        onMouseLeave: function () { setHot(null); },
        onFocus: function () { setHot(entry.id); },
        onBlur: function () { setHot(null); },
        onClick: function (event) { chooseTheme(entry.id, event); },
      },
      h(
        'span',
        { style: ST_SHELL.themeSwatches, 'aria-hidden': true },
        h('span', { style: Object.assign({}, ST_SHELL.themeSwatch, { background: swatches.base }) }),
        h('span', { style: Object.assign({}, ST_SHELL.themeSwatch, { background: swatches.link }) }),
      ),
      h('span', { style: ST_SHELL.themeOptionLabel }, themeName(t, entry)),
      selected ? h('span', { style: ST_SHELL.themeCheck, 'aria-hidden': true }, h(S.Icons.Check, { size: 13 })) : null,
    );
  });

  return h(
    'div',
    { style: ST_SHELL.themeWrap, ref: wrapRef, 'data-theme-picker': '1' },
    h(
      S.ToolButton,
      {
        title: t('theme.label'),
        ariaLabel: t('theme.label'),
        active: open,
        'aria-haspopup': 'listbox',
        'aria-expanded': open ? 'true' : 'false',
        'data-theme-button': '1',
        onClick: function () {
          setOpen(function (value) {
            return value !== true;
          });
        },
        onKeyDown: function (event) {
          if (event === null || event === undefined) return;
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          if (typeof event.preventDefault === 'function') event.preventDefault();
          setOpen(true);
        },
      },
      h(S.Icons.Palette, { size: 16, active: open }),
    ),
    open
      ? h(
          'div',
          { style: ST_SHELL.themeMenu },
          h(
            'div',
            { style: ST_SHELL.themeMenuHead },
            h('span', { style: ST_SHELL.themeMenuTitle }, t('theme.title')),
            h(
              S.ToolButton,
              {
                title: t('theme.close'),
                ariaLabel: t('theme.close'),
                style: { width: 20, height: 20, borderRadius: 5 },
                onClick: function (event) { closeMenu(event !== null && event !== undefined && event.detail === 0); },
              },
              h(S.Icons.Close, { size: 11 }),
            ),
          ),
          h(
            'div',
            { style: ST_SHELL.themeMenuList, role: 'listbox', 'aria-label': t('theme.title'), onKeyDown: onMenuKeyDown },
            rows,
          ),
        )
      : null,
  );
}

/**
 * Font-size picker: one borderless toolbar button plus a themed popover that
 * adjusts the interface font size (`--ide-ui-scale`) and the code editor base
 * font size independently, with stepper buttons, direct numeric input, quick
 * presets and a one-click reset to defaults.
 */
function FontSizePicker(props: any) {
  const t = typeof props.t === 'function' ? props.t : S.translate;
  const uiFontSize = S.normalizeUiFontSize(props.uiFontSize);
  const editorFontSize = S.normalizeEditorFontSize(props.editorFontSize);
  const [open, setOpen] = useState(props.initialOpen === true);
  const [uiDraft, setUiDraft] = useState(String(uiFontSize));
  const [editorDraft, setEditorDraft] = useState(String(editorFontSize));
  const wrapRef = useRef<any>(null);

  useEffect(function () {
    setUiDraft(String(uiFontSize));
  }, [uiFontSize]);

  useEffect(function () {
    setEditorDraft(String(editorFontSize));
  }, [editorFontSize]);

  const focusTrigger = useCallback(function () {
    const wrapper = wrapRef.current;
    if (wrapper === null || wrapper === undefined || typeof wrapper.querySelector !== 'function') return;
    const trigger = wrapper.querySelector('button');
    if (trigger !== null && trigger !== undefined && typeof trigger.focus === 'function') trigger.focus();
  }, []);

  const closeMenu = useCallback(function (refocus: any) {
    setOpen(false);
    if (refocus === true) focusTrigger();
  }, [focusTrigger]);

  useEffect(function () {
    if (!open) return undefined;
    const onPointerDown = function (event: any) {
      const wrapper = wrapRef.current;
      const target = event !== null && event !== undefined ? event.target : null;
      if (wrapper !== null && wrapper !== undefined && typeof wrapper.contains === 'function' && target !== null && target !== undefined && wrapper.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = function (event: any) {
      if (event === null || event === undefined || event.key !== 'Escape') return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      closeMenu(true);
    };
    try {
      if (typeof document === 'undefined' || document === null || typeof document.addEventListener !== 'function') return undefined;
      document.addEventListener('mousedown', onPointerDown, true);
      document.addEventListener('keydown', onKeyDown, true);
    } catch (error) {
      return undefined;
    }
    return function () {
      try {
        document.removeEventListener('mousedown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
      } catch (error) {
        /* no DOM */
      }
    };
  }, [open, closeMenu]);

  const applyUi = function (next: number) {
    const clamped = S.normalizeUiFontSize(next);
    setUiDraft(String(clamped));
    if (typeof props.onSelectUiFontSize === 'function') props.onSelectUiFontSize(clamped);
  };

  const applyEditor = function (next: number) {
    const clamped = S.normalizeEditorFontSize(next);
    setEditorDraft(String(clamped));
    if (typeof props.onSelectEditorFontSize === 'function') props.onSelectEditorFontSize(clamped);
  };

  const onUiInputChange = function (event: any) {
    const raw = event !== null && event !== undefined && event.target !== null && event.target !== undefined ? String(event.target.value) : '';
    setUiDraft(raw);
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= S.UI_FONT_SIZE_MIN && parsed <= S.UI_FONT_SIZE_MAX) {
      if (typeof props.onSelectUiFontSize === 'function') props.onSelectUiFontSize(parsed);
    }
  };

  const commitUiDraft = function () {
    const parsed = Number.parseInt(uiDraft.trim(), 10);
    if (!Number.isFinite(parsed)) {
      setUiDraft(String(uiFontSize));
      return;
    }
    applyUi(parsed);
  };

  const onEditorInputChange = function (event: any) {
    const raw = event !== null && event !== undefined && event.target !== null && event.target !== undefined ? String(event.target.value) : '';
    setEditorDraft(raw);
    const parsed = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(parsed) && parsed >= S.EDITOR_FONT_SIZE_MIN && parsed <= S.EDITOR_FONT_SIZE_MAX) {
      if (typeof props.onSelectEditorFontSize === 'function') props.onSelectEditorFontSize(parsed);
    }
  };

  const commitEditorDraft = function () {
    const parsed = Number.parseInt(editorDraft.trim(), 10);
    if (!Number.isFinite(parsed)) {
      setEditorDraft(String(editorFontSize));
      return;
    }
    applyEditor(parsed);
  };

  const isDefault = uiFontSize === S.UI_FONT_SIZE_DEFAULT && editorFontSize === S.EDITOR_FONT_SIZE_DEFAULT;

  return h(
    'div',
    { style: ST_SHELL.themeWrap, ref: wrapRef, 'data-font-size-picker': '1' },
    h(
      S.ToolButton,
      {
        title: t('fontSize.label'),
        ariaLabel: t('fontSize.label'),
        active: open,
        'aria-haspopup': 'dialog',
        'aria-expanded': open ? 'true' : 'false',
        'data-font-size-button': '1',
        onClick: function () {
          setOpen(function (value) {
            return value !== true;
          });
        },
      },
      h(S.Icons.FontSize, { size: 16, active: open }),
    ),
    open
      ? h(
          'div',
          { style: ST_SHELL.fontMenu, role: 'dialog', 'aria-label': t('fontSize.title'), 'data-font-size-popover': '1' },
          h(
            'div',
            { style: ST_SHELL.themeMenuHead },
            h('span', { style: ST_SHELL.themeMenuTitle }, t('fontSize.title')),
            h(
              S.ToolButton,
              {
                title: t('fontSize.close'),
                ariaLabel: t('fontSize.close'),
                style: { width: 20, height: 20, borderRadius: 5 },
                onClick: function (event) { closeMenu(event !== null && event !== undefined && event.detail === 0); },
              },
              h(S.Icons.Close, { size: 11 }),
            ),
          ),
          h(
            'div',
            { style: ST_SHELL.fontSection },
            h(
              'div',
              { style: ST_SHELL.fontSectionRow },
              h('span', { style: ST_SHELL.fontLabel }, t('fontSize.ui')),
              h(
                'div',
                { style: ST_SHELL.fontStepper },
                h(
                  'button',
                  {
                    type: 'button',
                    title: t('fontSize.decrease'),
                    'aria-label': t('fontSize.ui') + ' — ' + t('fontSize.decrease'),
                    disabled: uiFontSize <= S.UI_FONT_SIZE_MIN,
                    'data-font-ui-dec': '1',
                    style: Object.assign({}, ST_SHELL.fontStepButton, uiFontSize <= S.UI_FONT_SIZE_MIN ? ST_SHELL.fontStepButtonDisabled : null),
                    onClick: function () { applyUi(uiFontSize - 1); },
                  },
                  h(S.Icons.Minus, { size: 12 }),
                ),
                h('input', {
                  type: 'number',
                  min: S.UI_FONT_SIZE_MIN,
                  max: S.UI_FONT_SIZE_MAX,
                  step: 1,
                  value: uiDraft,
                  'aria-label': t('fontSize.ui'),
                  'data-font-ui-input': '1',
                  style: ST_SHELL.fontInput,
                  onChange: onUiInputChange,
                  onBlur: commitUiDraft,
                  onKeyDown: function (event: any) {
                    if (event !== null && event !== undefined && event.key === 'Enter') commitUiDraft();
                  },
                }),
                h('span', { style: ST_SHELL.fontUnit }, 'px'),
                h(
                  'button',
                  {
                    type: 'button',
                    title: t('fontSize.increase'),
                    'aria-label': t('fontSize.ui') + ' — ' + t('fontSize.increase'),
                    disabled: uiFontSize >= S.UI_FONT_SIZE_MAX,
                    'data-font-ui-inc': '1',
                    style: Object.assign({}, ST_SHELL.fontStepButton, uiFontSize >= S.UI_FONT_SIZE_MAX ? ST_SHELL.fontStepButtonDisabled : null),
                    onClick: function () { applyUi(uiFontSize + 1); },
                  },
                  h(S.Icons.Plus, { size: 12 }),
                ),
              ),
            ),
            h(
              'div',
              { style: ST_SHELL.fontPresets },
              S.FONT_SIZE_PRESETS.map(function (size: number) {
                const active = uiFontSize === size;
                return h(
                  'button',
                  {
                    key: 'ui-' + String(size),
                    type: 'button',
                    'aria-pressed': active ? 'true' : 'false',
                    'data-font-ui-preset': String(size),
                    style: Object.assign({}, ST_SHELL.fontPreset, active ? ST_SHELL.fontPresetActive : null),
                    onClick: function () { applyUi(size); },
                  },
                  String(size),
                );
              }),
            ),
          ),
          h(
            'div',
            { style: ST_SHELL.fontSection },
            h(
              'div',
              { style: ST_SHELL.fontSectionRow },
              h('span', { style: ST_SHELL.fontLabel }, t('fontSize.editor')),
              h(
                'div',
                { style: ST_SHELL.fontStepper },
                h(
                  'button',
                  {
                    type: 'button',
                    title: t('fontSize.decrease'),
                    'aria-label': t('fontSize.editor') + ' — ' + t('fontSize.decrease'),
                    disabled: editorFontSize <= S.EDITOR_FONT_SIZE_MIN,
                    'data-font-editor-dec': '1',
                    style: Object.assign({}, ST_SHELL.fontStepButton, editorFontSize <= S.EDITOR_FONT_SIZE_MIN ? ST_SHELL.fontStepButtonDisabled : null),
                    onClick: function () { applyEditor(editorFontSize - 1); },
                  },
                  h(S.Icons.Minus, { size: 12 }),
                ),
                h('input', {
                  type: 'number',
                  min: S.EDITOR_FONT_SIZE_MIN,
                  max: S.EDITOR_FONT_SIZE_MAX,
                  step: 1,
                  value: editorDraft,
                  'aria-label': t('fontSize.editor'),
                  'data-font-editor-input': '1',
                  style: ST_SHELL.fontInput,
                  onChange: onEditorInputChange,
                  onBlur: commitEditorDraft,
                  onKeyDown: function (event: any) {
                    if (event !== null && event !== undefined && event.key === 'Enter') commitEditorDraft();
                  },
                }),
                h('span', { style: ST_SHELL.fontUnit }, 'px'),
                h(
                  'button',
                  {
                    type: 'button',
                    title: t('fontSize.increase'),
                    'aria-label': t('fontSize.editor') + ' — ' + t('fontSize.increase'),
                    disabled: editorFontSize >= S.EDITOR_FONT_SIZE_MAX,
                    'data-font-editor-inc': '1',
                    style: Object.assign({}, ST_SHELL.fontStepButton, editorFontSize >= S.EDITOR_FONT_SIZE_MAX ? ST_SHELL.fontStepButtonDisabled : null),
                    onClick: function () { applyEditor(editorFontSize + 1); },
                  },
                  h(S.Icons.Plus, { size: 12 }),
                ),
              ),
            ),
            h(
              'div',
              { style: ST_SHELL.fontPresets },
              S.FONT_SIZE_PRESETS.map(function (size: number) {
                const active = editorFontSize === size;
                return h(
                  'button',
                  {
                    key: 'editor-' + String(size),
                    type: 'button',
                    'aria-pressed': active ? 'true' : 'false',
                    'data-font-editor-preset': String(size),
                    style: Object.assign({}, ST_SHELL.fontPreset, active ? ST_SHELL.fontPresetActive : null),
                    onClick: function () { applyEditor(size); },
                  },
                  String(size),
                );
              }),
            ),
          ),
          h(
            'div',
            { style: ST_SHELL.fontFooter },
            h('span', { style: ST_SHELL.fontHint }, t('fontSize.hint')),
            h(
              S.GhostButton,
              {
                title: t('fontSize.reset'),
                ariaLabel: t('fontSize.reset'),
                'data-font-size-reset': '1',
                disabled: isDefault && props.canResetEditorZoom !== true,
                style: {
                  height: uiPx(24),
                  padding: '0 8px',
                  fontSize: uiPx(11),
                  opacity: isDefault && props.canResetEditorZoom !== true ? 0.5 : 1,
                },
                onClick: function () {
                  if (typeof props.onResetFontSizes === 'function') props.onResetFontSizes();
                },
              },
              h(S.Icons.Reset, { size: 11 }),
              t('fontSize.reset'),
            ),
          ),
        )
      : null,
  );
}

/**
 * Shorten a user home-directory prefix (`/Users/<name>`, `/home/<name>`,
 * `C:\Users\<name>`) to `~` so workspace paths stay compact and scannable in
 * the workspace picker while keeping the full absolute path in tooltips.
 */
function shortenWorkspacePath(fullPath: string): string {
  if (typeof fullPath !== 'string' || fullPath.length === 0) return '';
  const macOrLinux = /^\/(?:Users|home)\/[^/]+(?=\/|$)/.exec(fullPath);
  if (macOrLinux !== null) return '~' + fullPath.slice(macOrLinux[0].length);
  const windows = /^[A-Za-z]:[\\/]Users[\\/][^\\/]+(?=[\\/]|$)/i.exec(fullPath);
  if (windows !== null) {
    const rest = fullPath.slice(windows[0].length).replace(/\\/g, '/');
    return '~' + rest;
  }
  return fullPath;
}

/**
 * Order workspaces for the picker: live-session workspaces first (preserving
 * registry order within each group) so active projects sit right at the top.
 */
function sortWorkspacesForPicker(workspaces: any[]): any[] {
  if (!Array.isArray(workspaces)) return [];
  const live: any[] = [];
  const rest: any[] = [];
  workspaces.forEach(function (entry: any) {
    if (entry === null || entry === undefined || typeof entry.path !== 'string') return;
    if (entry.live === true) live.push(entry);
    else rest.push(entry);
  });
  return live.concat(rest);
}

/** Case-insensitive subsequence check for quick workspace filtering. */
function isSubsequence(needle: string, haystack: string): boolean {
  let cursor = 0;
  for (let index = 0; index < needle.length; index += 1) {
    const found = haystack.indexOf(needle.charAt(index), cursor);
    if (found === -1) return false;
    cursor = found + 1;
  }
  return true;
}

/**
 * Filter and rank workspaces by query against title and full/shortened path.
 * Empty query returns the ordered full list (`live` first).
 */
function filterWorkspaces(workspaces: any[], rawQuery: string): any[] {
  const ordered = sortWorkspacesForPicker(workspaces);
  const query = typeof rawQuery === 'string' ? rawQuery.trim().toLowerCase() : '';
  if (query.length === 0) return ordered;
  const scored: Array<{ entry: any, score: number, index: number }> = [];
  ordered.forEach(function (entry: any, index: number) {
    const title = String(entry.title || '').toLowerCase();
    const full = String(entry.path || '').toLowerCase();
    const short = shortenWorkspacePath(entry.path).toLowerCase();
    let score = -1;
    if (title === query) score = 100;
    else if (title.indexOf(query) === 0) score = 80;
    else if (title.indexOf(query) !== -1) score = 60;
    else if (isSubsequence(query, title)) score = 45;
    else if (short.indexOf(query) !== -1 || full.indexOf(query) !== -1) score = 30;
    if (score >= 0) {
      if (entry.live === true) score = score + 5;
      scored.push({ entry: entry, score: score, index: index });
    }
  });
  scored.sort(function (left, right) {
    if (right.score !== left.score) return right.score - left.score;
    return left.index - right.index;
  });
  return scored.map(function (item) { return item.entry; });
}

/**
 * Custom themed workspace picker: compact toolbar trigger + searchable popover
 * showing active workspaces first, shortened paths, live/git badges, check mark
 * and full keyboard navigation (ArrowUp/ArrowDown/Home/End/Enter/Escape).
 */
function WorkspacePicker(props: any) {
  const t = typeof props.t === 'function' ? props.t : S.translate;
  const workspaces = Array.isArray(props.workspaces) ? props.workspaces : [];
  const root = typeof props.root === 'string' ? props.root : '';
  const busy = props.disabled === true;

  const [open, setOpen] = useState(props.initialOpen === true);
  const [hoverTrigger, setHoverTrigger] = useState(false);
  const [focusTriggerState, setFocusTriggerState] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const wrapRef = useRef<any>(null);
  const triggerRef = useRef<any>(null);
  const searchRef = useRef<any>(null);
  const itemRefs = useRef<any[]>([]);
  itemRefs.current = [];

  const current = useMemo(function () {
    return workspaces.find(function (entry: any) { return entry !== null && entry !== undefined && entry.path === root; });
  }, [workspaces, root]);

  const filtered = useMemo(function () {
    return filterWorkspaces(workspaces, query);
  }, [workspaces, query]);

  const trimmedQuery = query.trim();
  const hasLive = trimmedQuery.length === 0 && filtered.some(function (entry: any) { return entry.live === true; });
  const hasOther = trimmedQuery.length === 0 && filtered.some(function (entry: any) { return entry.live !== true; });
  const showSections = hasLive && hasOther;

  const closeMenu = useCallback(function (refocus: boolean) {
    setOpen(false);
    setQuery('');
    if (refocus === true) {
      const btn = triggerRef.current;
      if (btn !== null && btn !== undefined && typeof btn.focus === 'function') btn.focus();
    }
  }, []);

  useEffect(function () {
    if (!open) return undefined;
    const onPointerDown = function (event: any) {
      const wrapper = wrapRef.current;
      const target = event !== null && event !== undefined ? event.target : null;
      if (wrapper !== null && wrapper !== undefined && typeof wrapper.contains === 'function' && target !== null && target !== undefined && wrapper.contains(target)) return;
      setOpen(false);
      setQuery('');
    };
    const onKeyDown = function (event: any) {
      if (event === null || event === undefined || event.key !== 'Escape') return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      closeMenu(true);
    };
    try {
      if (typeof document === 'undefined' || document === null || typeof document.addEventListener !== 'function') return undefined;
      document.addEventListener('mousedown', onPointerDown, true);
      document.addEventListener('keydown', onKeyDown, true);
    } catch (error) {
      return undefined;
    }
    return function () {
      try {
        document.removeEventListener('mousedown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
      } catch (error) {
        /* no DOM */
      }
    };
  }, [open, closeMenu]);

  useEffect(function () {
    if (!open) return undefined;
    let initial = 0;
    for (let index = 0; index < filtered.length; index += 1) {
      if (filtered[index].path === root) {
        initial = index;
        break;
      }
    }
    setActiveIndex(initial);
    const input = searchRef.current;
    if (input !== null && input !== undefined && typeof input.focus === 'function') {
      try {
        input.focus();
      } catch (error) {
        /* focus is optional */
      }
    }
    return undefined;
  }, [open, root]);

  useEffect(function () {
    setActiveIndex(0);
  }, [trimmedQuery]);

  const choose = useCallback(function (path: string, keyboard: boolean) {
    if (typeof props.onSelectRoot === 'function') props.onSelectRoot(path);
    closeMenu(keyboard);
  }, [props.onSelectRoot, closeMenu]);

  const moveActive = useCallback(function (delta: number | 'first' | 'last') {
    if (filtered.length === 0) return;
    setActiveIndex(function (prev: number) {
      let next: number;
      if (delta === 'first') next = 0;
      else if (delta === 'last') next = filtered.length - 1;
      else next = (prev + delta + filtered.length) % filtered.length;
      const node = itemRefs.current[next];
      if (node !== null && node !== undefined && typeof node.scrollIntoView === 'function') {
        try {
          node.scrollIntoView({ block: 'nearest' });
        } catch (error) {
          /* scroll is optional */
        }
      }
      return next;
    });
  }, [filtered.length]);

  const onSearchKeyDown = useCallback(function (event: any) {
    if (event === null || event === undefined) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      moveActive('first');
    } else if (event.key === 'End') {
      event.preventDefault();
      moveActive('last');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = filtered[activeIndex];
      if (target !== undefined && target !== null) choose(target.path, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (query.length > 0) setQuery('');
      else closeMenu(true);
    }
  }, [moveActive, filtered, activeIndex, choose, query, closeMenu]);

  const renderOption = function (entry: any, index: number) {
    const selected = entry.path === root;
    const hot = index === activeIndex;
    const shortPath = shortenWorkspacePath(entry.path);
    return h(
      'button',
      {
        key: entry.path,
        type: 'button',
        role: 'option',
        'aria-selected': selected ? 'true' : 'false',
        'data-workspace-option': entry.path,
        title: entry.path,
        ref: function (node: any) { itemRefs.current[index] = node; },
        style: Object.assign(
          {},
          ST_SHELL.wsOption,
          selected ? ST_SHELL.wsOptionActive : hot ? ST_SHELL.wsOptionHot : null,
        ),
        onMouseEnter: function () { setActiveIndex(index); },
        onClick: function (event: any) {
          choose(entry.path, event !== null && event !== undefined && event.detail === 0);
        },
      },
      h(
        'span',
        { style: Object.assign({}, ST_SHELL.wsOptionLeading, selected ? { color: C.accent } : null), 'aria-hidden': true },
        h(S.Icons.Folder, { size: 14 }),
      ),
      h(
        'span',
        { style: ST_SHELL.wsOptionBody },
        h(
          'span',
          { style: ST_SHELL.wsOptionTop },
          h(
            'span',
            { style: Object.assign({}, ST_SHELL.wsOptionTitle, selected ? ST_SHELL.wsOptionTitleSelected : null) },
            entry.title,
          ),
          h(
            'span',
            { style: ST_SHELL.wsMeta },
            entry.git === true
              ? h('span', { style: ST_SHELL.wsGitIcon, title: 'Git', 'aria-hidden': true }, h(S.Icons.Git, { size: 11 }))
              : null,
            entry.live === true
              ? h(
                  'span',
                  { style: ST_SHELL.wsLiveBadge },
                  h('span', { style: ST_SHELL.pickerLiveDot, 'aria-hidden': true }),
                  t('root.badge.live'),
                )
              : null,
          ),
        ),
        h('span', { style: ST_SHELL.wsOptionPath }, shortPath),
      ),
      selected
        ? h('span', { style: ST_SHELL.themeCheck, 'aria-hidden': true }, h(S.Icons.Check, { size: 13 }))
        : null,
    );
  };

  let listContent: any = null;
  if (filtered.length === 0) {
    listContent = h('div', { style: ST_SHELL.wsEmpty }, t('root.noMatches'));
  } else if (showSections) {
    const liveEntries: Array<{ entry: any, index: number }> = [];
    const otherEntries: Array<{ entry: any, index: number }> = [];
    filtered.forEach(function (entry: any, index: number) {
      if (entry.live === true) liveEntries.push({ entry: entry, index: index });
      else otherEntries.push({ entry: entry, index: index });
    });
    listContent = [
      h(
        'div',
        { key: 'grp-live', style: ST_SHELL.wsGroupLabel },
        h('span', { style: ST_SHELL.pickerLiveDot, 'aria-hidden': true }),
        h('span', null, t('root.group.live')),
        h('span', { style: ST_SHELL.wsGroupCount }, String(liveEntries.length)),
      ),
      liveEntries.map(function (item) { return renderOption(item.entry, item.index); }),
      h(
        'div',
        { key: 'grp-other', style: ST_SHELL.wsGroupLabel },
        h('span', null, t('root.group.other')),
        h('span', { style: ST_SHELL.wsGroupCount }, String(otherEntries.length)),
      ),
      otherEntries.map(function (item) { return renderOption(item.entry, item.index); }),
    ];
  } else {
    listContent = filtered.map(function (entry: any, index: number) { return renderOption(entry, index); });
  }

  return h(
    'div',
    { style: ST_SHELL.themeWrap, ref: wrapRef, 'data-workspace-picker': '1' },
    h(
      'button',
      {
        type: 'button',
        ref: triggerRef,
        disabled: busy,
        title: current !== undefined && current !== null ? current.path : t('root.pick'),
        'aria-label': t('root.select.title'),
        'aria-haspopup': 'listbox',
        'aria-expanded': open ? 'true' : 'false',
        'data-workspace-button': '1',
        style: Object.assign(
          {},
          ST_SHELL.picker,
          busy ? ST_SHELL.pickerDisabled : null,
          open ? ST_SHELL.pickerOpen : hoverTrigger && !busy ? ST_SHELL.pickerHover : null,
          focusTriggerState && !busy ? ST_SHELL.pickerFocused : null,
        ),
        onMouseEnter: function () { setHoverTrigger(true); },
        onMouseLeave: function () { setHoverTrigger(false); },
        onFocus: function (event: any) {
          let visible = true;
          try {
            visible = event !== null && event !== undefined && event.target !== null && event.target !== undefined && typeof event.target.matches === 'function'
              ? event.target.matches(':focus-visible')
              : true;
          } catch (error) {
            visible = true;
          }
          setFocusTriggerState(visible);
        },
        onBlur: function () { setFocusTriggerState(false); },
        onClick: function () {
          if (busy) return;
          setOpen(function (value) { return value !== true; });
        },
        onKeyDown: function (event: any) {
          if (busy || event === null || event === undefined) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        },
      },
      h('span', { style: ST_SHELL.pickerIcon, 'aria-hidden': true }, h(S.Icons.Folder, { size: 13 })),
      h('span', { style: ST_SHELL.pickerLabel }, current === undefined || current === null ? t('root.pick') : current.title),
      current !== undefined && current !== null && current.live === true
        ? h('span', { style: ST_SHELL.pickerLiveDot, title: t('root.badge.live'), 'aria-hidden': true })
        : null,
      h(
        'span',
        {
          style: Object.assign({}, ST_SHELL.pickerCaret, { transform: open ? 'rotate(-90deg)' : 'rotate(90deg)' }),
          'aria-hidden': true,
        },
        h(S.Icons.Chevron, { size: 10 }),
      ),
    ),
    open
      ? h(
          'div',
          { style: ST_SHELL.wsMenu, 'data-workspace-popover': '1' },
          h(
            'div',
            { style: ST_SHELL.wsSearchRow },
            h('span', { style: ST_SHELL.wsSearchIcon, 'aria-hidden': true }, h(S.Icons.Search, { size: 13 })),
            h('input', {
              type: 'text',
              ref: searchRef,
              value: query,
              placeholder: t('root.searchPlaceholder'),
              'aria-label': t('root.searchLabel'),
              'data-workspace-search': '1',
              spellCheck: false,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              autoComplete: 'off',
              style: ST_SHELL.wsSearchInput,
              onChange: function (event: any) {
                const value = event !== null && event !== undefined && event.target !== null && event.target !== undefined ? String(event.target.value) : '';
                setQuery(value);
              },
              onKeyDown: onSearchKeyDown,
            }),
            query.length > 0
              ? h(
                  S.ToolButton,
                  {
                    title: t('root.clearSearch'),
                    ariaLabel: t('root.clearSearch'),
                    style: { width: 18, height: 18, borderRadius: 4 },
                    onClick: function () {
                      setQuery('');
                      const input = searchRef.current;
                      if (input !== null && input !== undefined && typeof input.focus === 'function') input.focus();
                    },
                  },
                  h(S.Icons.Close, { size: 11 }),
                )
              : null,
          ),
          h(
            'div',
            { style: ST_SHELL.wsList, role: 'listbox', 'aria-label': t('root.select.title') },
            listContent,
          ),
          h(
            'div',
            { style: ST_SHELL.wsFooter },
            h('span', null, t('root.count', { count: filtered.length })),
            h('span', null, t('root.hint')),
          ),
        )
      : null,
  );
}

/**
 * Toolbar: three view icons on the left, the workspace picker and refresh on
 * the right, plus the font-size and colour-theme pickers at the far right.
 * Icons only (no labels) with aria-label + title, exactly like the reference rail.
 */
function ShellToolbar(props: any) {
  const t = props.t;
  const workspaces = Array.isArray(props.workspaces) ? props.workspaces : [];
  const tab = props.tab;
  const busy = props.loading === true;

  const tabs = S.TABS.map(function (entry: any) {
    const Icon = S.Icons[entry.icon];
    const active = tab === entry.id;
    return h(
      S.ToolButton,
      {
        key: entry.id,
        title: t('tabs.' + entry.id),
        ariaLabel: t('tabs.' + entry.id),
        active: active,
        'data-tab': entry.id,
        role: 'tab',
        'aria-selected': active ? 'true' : 'false',
        onClick: function () {
          if (typeof props.onSelectTab === 'function') props.onSelectTab(entry.id);
        },
      },
      h(Icon, { size: 17, active: active }),
    );
  });

  return h(
    'div',
    { style: ST_SHELL.toolbar },
    h('div', { style: ST_SHELL.tabStrip, role: 'tablist', 'aria-label': t('tabs.label') }, tabs),
    h('div', { style: ST_SHELL.spacer }),
    workspaces.length > 0
      ? h(WorkspacePicker, {
          t: t,
          workspaces: workspaces,
          root: props.root,
          disabled: busy,
          onSelectRoot: props.onSelectRoot,
        })
      : h('span', { style: ST_SHELL.workspaceHint }, busy ? t('root.loading') : t('root.pick')),
    h(
      S.ToolButton,
      {
        title: t('action.refresh'),
        ariaLabel: t('action.refresh'),
        disabled: busy,
        onClick: function () {
          if (typeof props.onRefresh === 'function') props.onRefresh();
        },
      },
      h(S.Icons.Refresh, { size: 16 }),
    ),
    h(FontSizePicker, {
      t: t,
      uiFontSize: props.uiFontSize,
      editorFontSize: props.editorFontSize,
      onSelectUiFontSize: typeof props.onSelectUiFontSize === 'function' ? props.onSelectUiFontSize : null,
      onSelectEditorFontSize: typeof props.onSelectEditorFontSize === 'function' ? props.onSelectEditorFontSize : null,
      onResetFontSizes: typeof props.onResetFontSizes === 'function' ? props.onResetFontSizes : null,
    }),
    h(ThemePicker, {
      t: t,
      theme: typeof props.theme === 'string' ? props.theme : 'auto',
      onSelectTheme: typeof props.onSelectTheme === 'function' ? props.onSelectTheme : null,
    }),
  );
}

/**
 * The panel itself.
 * @param {{t?: Function, preferredRoot?: string|null}} props - slot props: the locale
 *   translator when present plus the workspace owning the session the app views (if reported).
 */
function Shell(props: any) {
  const fallbackT = S.useT();
  const t = props !== null && props !== undefined && typeof props.t === 'function' ? props.t : fallbackT;

  const [tab, setTab] = useState('files');
  const [theme, setTheme] = useState(function () {
    // Persisted colour theme; `auto` (no overrides) is the default.
    return S.readTheme();
  });
  const [uiFontSize, setUiFontSize] = useState(function () {
    return S.readUiFontSize();
  });
  const [editorFontSize, setEditorFontSize] = useState(function () {
    return S.readEditorFontSize();
  });
  const [fontResetToken, setFontResetToken] = useState(0);
  const [workspaces, setWorkspaces] = useState<any[]>([]);
  const [root, setRoot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [rootError, setRootError] = useState<any>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [openRequest, setOpenRequest] = useState<any>(null);

  const abortRef = useRef<any>(null);
  const requestRef = useRef(0);
  const openTokenRef = useRef(0);
  const workspacesRef = useRef<any[]>([]);
  const preferredRootRef = useRef<any>(null);
  preferredRootRef.current = typeof props.preferredRoot === 'string' && props.preferredRoot.length > 0 ? props.preferredRoot : null;

  const loadWorkspaces = useCallback(function () {
    if (abortRef.current !== null && abortRef.current !== undefined) {
      try {
        abortRef.current.abort();
      } catch (error) {
        /* already settled */
      }
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    abortRef.current = controller;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setRootError(null);
    S.requestJson(ROUTES.workspaces, { signal: controller === null ? undefined : controller.signal })
      .then(function (payload: any) {
        if (requestRef.current !== requestId) return;
        const list = normalizeWorkspaces(payload);
        workspacesRef.current = list;
        setWorkspaces(list);
        setRoot(function (current: any) {
          return pickRoot(list, current, preferredRootRef.current);
        });
        setLoading(false);
      })
      .catch(function (cause: any) {
        if (cause !== null && cause !== undefined && cause.name === 'AbortError') return;
        if (requestRef.current !== requestId) return;
        setRootError(cause);
        setLoading(false);
      });
    return function () {
      if (controller !== null && controller !== undefined) {
        try {
          controller.abort();
        } catch (error) {
          /* already settled */
        }
      }
    };
  }, []);

  useEffect(function () {
    const dispose = loadWorkspaces();
    return dispose;
  }, [loadWorkspaces]);

  const preferredRootValue = typeof props.preferredRoot === 'string' ? props.preferredRoot : '';
  useEffect(function () {
    if (preferredRootValue.length === 0) return undefined;
    const list = workspacesRef.current;
    if (!Array.isArray(list) || !list.some(function (entry) { return entry !== null && entry !== undefined && entry.path === preferredRootValue; })) return undefined;
    setRoot(function (current: any) {
      if (current === preferredRootValue) return current;
      const stored = readRootSelection();
      const sessionId = S.getCurrentSessionId();
      if (stored !== null && stored.sessionId !== null && stored.sessionId === sessionId) return current;
      return preferredRootValue;
    });
    return undefined;
  }, [preferredRootValue]);

  useEffect(function () {
    S.ping('panel');
    return undefined;
  }, []);

  useEffect(function () {
    S.ping('tab', tab);
    return undefined;
  }, [tab]);

  const selectRoot = useCallback(function (next: any) {
    if (typeof next !== 'string' || next.length === 0) return;
    setRoot(next);
    writeRootSelection(next, S.getCurrentSessionId());
    setOpenRequest(null);
  }, []);

  const selectTab = useCallback(function (next: any) {
    if (next !== 'files' && next !== 'search' && next !== 'git') return;
    setTab(next);
  }, []);

  const refresh = useCallback(function () {
    setReloadToken(function (value) { return value + 1; });
    loadWorkspaces();
  }, [loadWorkspaces]);

  const selectTheme = useCallback(function (next: any) {
    // Persist first, then re-render the panel root with the override table.
    const stored = S.writeTheme(next);
    setTheme(stored);
    S.ping('theme', stored);
  }, []);

  const selectUiFontSize = useCallback(function (next: any) {
    const stored = S.writeUiFontSize(next);
    setUiFontSize(stored);
  }, []);

  const selectEditorFontSize = useCallback(function (next: any) {
    const stored = S.writeEditorFontSize(next);
    setEditorFontSize(stored);
  }, []);

  const resetFontSizes = useCallback(function () {
    const defaultUi = S.writeUiFontSize(S.UI_FONT_SIZE_DEFAULT);
    const defaultEditor = S.writeEditorFontSize(S.EDITOR_FONT_SIZE_DEFAULT);
    setUiFontSize(defaultUi);
    setEditorFontSize(defaultEditor);
    setFontResetToken(function (value) { return value + 1; });
  }, []);

  const openFile = useCallback(function (path: any, line: any) {
    openTokenRef.current = openTokenRef.current + 1;
    setTab('files');
    setOpenRequest({
      path: path,
      line: Number.isFinite(line) && line > 0 ? Math.floor(line) : 1,
      token: openTokenRef.current,
    });
  }, []);

  /** @type {any} */
  let body: any = null;
  if (root === null) {
    if (rootError !== null) {
      body = h(S.InlineError, {
        t: t,
        title: t('root.error.title'),
        message: S.errorText(rootError),
        onRetry: function () { loadWorkspaces(); },
      });
    } else if (loading) {
      body = h(S.LoadingIndicator, { t: t, label: t('root.loading') });
    } else {
      body = h(S.EmptyState, {
        t: t,
        icon: S.Icons.PanelIcon,
        title: t('root.empty.title'),
        body: t('root.empty.body'),
        actionLabel: t('action.retry'),
        onAction: function () { loadWorkspaces(); },
      });
    }
  } else if (tab === 'search') {
    body = h(S.SearchView, { key: 'search:' + String(reloadToken), t: t, root: root, onOpenFile: openFile, reloadToken: reloadToken });
  } else if (tab === 'git') {
    body = h(S.GitView, {
      key: 'git:' + String(reloadToken),
      t: t,
      root: root,
      onOpenFile: openFile,
      reloadToken: reloadToken,
      workspaces: workspaces,
      onSelectWorkspace: selectRoot,
    });
  } else {
    body = h(S.FilesView, {
      key: 'files:' + String(reloadToken),
      t: t,
      root: root,
      onOpenFile: openFile,
      reloadToken: reloadToken,
      openRequest: openRequest,
      editorFontSize: editorFontSize,
      fontResetToken: fontResetToken,
    });
  }

  // The selected colour theme and interface font scale are pure CSS custom
  // properties on the root: the whole subtree's `var(--dsw-alias-*)` and
  // `var(--ide-ui-scale)` references update immediately.
  const themeStyle = S.themeVars(theme);
  const fontStyle = S.uiFontVars(uiFontSize);

  return h(
    'div',
    {
      style: Object.assign({}, ST_SHELL.root, themeStyle, fontStyle),
      'data-ide-theme': theme,
      'data-ide-ui-font-size': String(uiFontSize),
      'data-ide-editor-font-size': String(editorFontSize),
    },
    h(ShellToolbar, {
      t: t,
      tab: tab,
      root: root,
      workspaces: workspaces,
      loading: loading,
      theme: theme,
      uiFontSize: uiFontSize,
      editorFontSize: editorFontSize,
      onSelectTab: selectTab,
      onSelectRoot: selectRoot,
      onRefresh: refresh,
      onSelectTheme: selectTheme,
      onSelectUiFontSize: selectUiFontSize,
      onSelectEditorFontSize: selectEditorFontSize,
      onResetFontSizes: resetFontSizes,
    }),
    rootError !== null && root !== null
      ? h(S.NoticeBar, { t: t, kind: 'error', text: t('common.request', { message: S.errorText(rootError) }) })
      : null,
    h('div', { style: ST_SHELL.body }, body),
  );
}

/**
 * Catches any render failure of the panel so the slot never blanks; the retry
 * button remounts the children under a fresh key.
 */
class PanelBoundary extends React.Component<any, any> {
  constructor(props: any) {
    super(props);
    this.state = { error: null, attempt: 0 };
    this.retry = this.retry.bind(this);
  }

  static getDerivedStateFromError(error: any) {
    return { error: error };
  }

  retry() {
    this.setState(function (state: any) {
      return { error: null, attempt: (state !== null && state !== undefined && Number.isFinite(state.attempt) ? state.attempt : 0) + 1 };
    });
  }

  render() {
    const t = this.props !== null && this.props !== undefined && typeof this.props.t === 'function' ? this.props.t : S.translate;
    const error = this.state !== null && this.state !== undefined ? this.state.error : null;
    const attempt = this.state !== null && this.state !== undefined && Number.isFinite(this.state.attempt) ? this.state.attempt : 0;
    if (error !== null && error !== undefined) {
      return h(
        'div',
        { style: ST_SHELL.boundaryCard, role: 'alert' },
        h('div', { style: ST_SHELL.boundaryIcon }, h(S.Icons.Alert, { size: 23 })),
        h('p', { style: ST_SHELL.boundaryTitle }, t('crash.title')),
        h('p', { style: ST_SHELL.boundaryBody }, t('crash', { message: S.errorText(error) })),
        h('p', { style: ST_SHELL.boundaryHint }, t('crash.body')),
        h(
          S.GhostButton,
          { title: t('action.retry'), onClick: this.retry },
          h(S.Icons.Refresh, { size: 13 }),
          t('action.retry'),
        ),
      );
    }
    return h('div', { key: 'workspace-ide-attempt-' + String(attempt), style: ST_SHELL.boundaryWrap }, this.props.children);
  }
}

S.Shell = Shell;
S.ShellToolbar = ShellToolbar;
S.WorkspacePicker = WorkspacePicker;
S.ThemePicker = ThemePicker;
S.FontSizePicker = FontSizePicker;
S.shortenWorkspacePath = shortenWorkspacePath;
S.sortWorkspacesForPicker = sortWorkspacesForPicker;
S.filterWorkspaces = filterWorkspaces;
S.themeName = themeName;
S.themeSwatches = themeSwatches;
S.PanelBoundary = PanelBoundary;
S.pickRoot = pickRoot;
S.normalizeWorkspaces = normalizeWorkspaces;
S.baseName = baseName;
S.ST_SHELL = ST_SHELL;
