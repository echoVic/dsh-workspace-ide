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
    fontSize: 13,
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
    height: 27,
    maxWidth: 320,
    minWidth: 120,
    padding: '0 8px',
    boxSizing: 'border-box',
    border: '1px solid ' + C.border1,
    borderRadius: 6,
    background: C.platform,
    color: C.text,
    fontFamily: FONT_UI,
    fontSize: 12,
    cursor: 'pointer',
    overflow: 'hidden',
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
  pickerCaret: {
    display: 'inline-flex',
    alignItems: 'center',
    color: C.textTertiary,
    flex: '0 0 auto',
  },
  // The native select covers the whole control invisibly: it keeps the OS
  // dropdown (and keyboard semantics) while the visible box uses theme tokens.
  pickerSelect: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    margin: 0,
    padding: 0,
    border: 'none',
    opacity: 0,
    appearance: 'none',
    WebkitAppearance: 'none',
    background: 'transparent',
    fontFamily: FONT_UI,
    fontSize: 12,
    cursor: 'pointer',
  },
  workspaceHint: {
    fontSize: 11,
    color: C.textTertiary,
    padding: '0 2px',
    maxWidth: 300,
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
    fontSize: 10.5,
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
    height: 30,
    padding: '0 8px',
    boxSizing: 'border-box',
    border: 'none',
    borderRadius: 6,
    background: 'transparent',
    color: C.textSecondary,
    fontFamily: FONT_UI,
    fontSize: 12,
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
    fontSize: 13,
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
    fontSize: 13.5,
    fontWeight: 600,
  },
  boundaryBody: {
    margin: 0,
    maxWidth: 460,
    fontSize: 12,
    lineHeight: '18px',
    color: C.textSecondary,
    wordBreak: 'break-word',
  },
  boundaryHint: {
    margin: 0,
    maxWidth: 460,
    fontSize: 11.5,
    color: C.textTertiary,
  },
};

/** @param {string} path - absolute path. @returns {string} last path segment. */
function baseName(path) {
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
function writeRootSelection(root, sessionId) {
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
function pickRoot(list, current, sessionPreferred) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const has = function (path) {
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
function normalizeWorkspaces(payload) {
  const raw = payload !== null && payload !== undefined && Array.isArray(payload.workspaces) ? payload.workspaces : [];
  const list = [];
  raw.forEach(function (entry) {
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
function themeName(translator, entry) {
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
function themeSwatches(entry) {
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
function ThemePicker(props) {
  const t = typeof props.t === 'function' ? props.t : S.translate;
  const activeTheme = typeof props.theme === 'string' ? props.theme : 'auto';
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(/** @type {string|null} */ (null));
  const wrapRef = useRef(/** @type {HTMLElement|null} */ (null));
  const optionRefs = useRef(/** @type {Array<HTMLElement|null>} */ ([]));
  optionRefs.current = [];

  /** Focus the trigger button again (the wrapper's first button is the trigger). */
  const focusTrigger = useCallback(function () {
    const wrapper = wrapRef.current;
    if (wrapper === null || wrapper === undefined || typeof wrapper.querySelector !== 'function') return;
    const trigger = wrapper.querySelector('button');
    if (trigger !== null && trigger !== undefined && typeof trigger.focus === 'function') trigger.focus();
  }, []);

  const closeMenu = useCallback(function (refocus) {
    setOpen(false);
    setHot(null);
    if (refocus === true) focusTrigger();
  }, [focusTrigger]);

  // While open: close on outside pointer-down and on Escape (document-level so
  // the panel keeps working even when focus sits on a non-focusable child).
  useEffect(function () {
    if (!open) return undefined;
    const onPointerDown = function (event) {
      const wrapper = wrapRef.current;
      const target = event !== null && event !== undefined ? event.target : null;
      if (wrapper !== null && wrapper !== undefined && typeof wrapper.contains === 'function' && target !== null && target !== undefined && wrapper.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = function (event) {
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
  function focusOption(position) {
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

  const onMenuKeyDown = function (event) {
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
  const chooseTheme = function (id, event) {
    if (typeof props.onSelectTheme === 'function') props.onSelectTheme(id);
    const keyboard = event !== null && event !== undefined && event.detail === 0;
    closeMenu(keyboard);
  };

  const rows = S.THEMES.map(function (entry, index) {
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
 * Toolbar: three view icons on the left, the workspace picker and refresh on
 * the right, plus the colour-theme picker at the far right. Icons only (no
 * labels) with aria-label + title, exactly like the reference rail.
 */
function ShellToolbar(props) {
  const t = props.t;
  const workspaces = Array.isArray(props.workspaces) ? props.workspaces : [];
  const tab = props.tab;
  const busy = props.loading === true;
  const [pickerFocused, setPickerFocused] = useState(false);

  const tabs = S.TABS.map(function (entry) {
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

  const current = workspaces.find(function (entry) {
    return entry.path === props.root;
  });

  return h(
    'div',
    { style: ST_SHELL.toolbar },
    h('div', { style: ST_SHELL.tabStrip, role: 'tablist', 'aria-label': t('tabs.label') }, tabs),
    h('div', { style: ST_SHELL.spacer }),
    workspaces.length > 0
      ? h(
          'div',
          {
            style: Object.assign(
              {},
              ST_SHELL.picker,
              busy ? ST_SHELL.pickerDisabled : null,
              pickerFocused ? ST_SHELL.pickerFocused : null,
            ),
            title: typeof props.root === 'string' ? props.root : t('root.pick'),
          },
          h('span', { style: ST_SHELL.pickerIcon }, h(S.Icons.Folder, { size: 13 })),
          h('span', { style: ST_SHELL.pickerLabel }, current === undefined ? t('root.pick') : current.title),
          h(
            'span',
            { style: Object.assign({}, ST_SHELL.pickerCaret, { transform: 'rotate(90deg)' }) },
            h(S.Icons.Chevron, { size: 10 }),
          ),
          h(
            'select',
            /** @type {any} */ ({
              style: ST_SHELL.pickerSelect,
              title: typeof props.root === 'string' ? props.root : t('root.pick'),
              'aria-label': t('root.select.title'),
              value: typeof props.root === 'string' ? props.root : '',
              disabled: busy,
              onFocus: function () { setPickerFocused(true); },
              onBlur: function () { setPickerFocused(false); },
              onChange: function (event) {
                const value = event !== null && event !== undefined && event.target !== null && event.target !== undefined ? event.target.value : '';
                if (typeof props.onSelectRoot === 'function') props.onSelectRoot(value);
              },
            }),
            workspaces.map(function (entry) {
              return h(
                'option',
                { key: entry.path, value: entry.path, title: entry.path },
                entry.title + '  —  ' + entry.path + (entry.live ? '  ●' : ''),
              );
            }),
          ),
        )
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
function Shell(props) {
  const fallbackT = S.useT();
  const t = props !== null && props !== undefined && typeof props.t === 'function' ? props.t : fallbackT;

  const [tab, setTab] = useState('files');
  const [theme, setTheme] = useState(function () {
    // Persisted colour theme; `auto` (no overrides) is the default.
    return S.readTheme();
  });
  const [workspaces, setWorkspaces] = useState(/** @type {Array<any>} */ ([]));
  const [root, setRoot] = useState(/** @type {string|null} */ (null));
  const [loading, setLoading] = useState(true);
  const [rootError, setRootError] = useState(/** @type {any} */ (null));
  const [reloadToken, setReloadToken] = useState(0);
  const [openRequest, setOpenRequest] = useState(/** @type {{path?: string, line?: number, token?: number}|null} */ (null));

  const abortRef = useRef(/** @type {AbortController|null} */ (null));
  const requestRef = useRef(0);
  const openTokenRef = useRef(0);
  const workspacesRef = useRef(/** @type {Array<any>} */ ([]));
  const preferredRootRef = useRef(/** @type {string|null} */ (null));
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
      .then(function (payload) {
        if (requestRef.current !== requestId) return;
        const list = normalizeWorkspaces(payload);
        workspacesRef.current = list;
        setWorkspaces(list);
        setRoot(function (current) {
          return pickRoot(list, current, preferredRootRef.current);
        });
        setLoading(false);
      })
      .catch(function (cause) {
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
    setRoot(function (current) {
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

  const selectRoot = useCallback(function (next) {
    if (typeof next !== 'string' || next.length === 0) return;
    setRoot(next);
    writeRootSelection(next, S.getCurrentSessionId());
    setOpenRequest(null);
  }, []);

  const selectTab = useCallback(function (next) {
    if (next !== 'files' && next !== 'search' && next !== 'git') return;
    setTab(next);
  }, []);

  const refresh = useCallback(function () {
    setReloadToken(function (value) { return value + 1; });
    loadWorkspaces();
  }, [loadWorkspaces]);

  const selectTheme = useCallback(function (next) {
    // Persist first, then re-render the panel root with the override table.
    const stored = S.writeTheme(next);
    setTheme(stored);
    S.ping('theme', stored);
  }, []);

  const openFile = useCallback(function (path, line) {
    openTokenRef.current = openTokenRef.current + 1;
    setTab('files');
    setOpenRequest({
      path: path,
      line: Number.isFinite(line) && line > 0 ? Math.floor(line) : 1,
      token: openTokenRef.current,
    });
  }, []);

  /** @type {any} */
  let body = null;
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
    });
  }

  // The selected colour theme is pure CSS custom properties on the root: the
  // whole subtree's `var(--dsw-alias-*)` references resolve to the theme, and
  // `auto` contributes an empty table so the panel follows DSH itself.
  const themeStyle = S.themeVars(theme);

  return h(
    'div',
    {
      style: Object.assign({}, ST_SHELL.root, themeStyle),
      'data-ide-theme': theme,
    },
    h(ShellToolbar, {
      t: t,
      tab: tab,
      root: root,
      workspaces: workspaces,
      loading: loading,
      theme: theme,
      onSelectTab: selectTab,
      onSelectRoot: selectRoot,
      onRefresh: refresh,
      onSelectTheme: selectTheme,
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
class PanelBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, attempt: 0 };
    this.retry = this.retry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error: error };
  }

  retry() {
    this.setState(function (state) {
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
S.ThemePicker = ThemePicker;
S.themeName = themeName;
S.themeSwatches = themeSwatches;
S.PanelBoundary = PanelBoundary;
S.pickRoot = pickRoot;
S.normalizeWorkspaces = normalizeWorkspaces;
S.baseName = baseName;
S.ST_SHELL = ST_SHELL;
