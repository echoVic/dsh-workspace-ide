/**
 * dsh-workspace-ide — client half, the Search surface.
 *
 * A full-text workspace search backed by the Host route: query field with case /
 * regex / whole-word toggles and an include filter, results grouped by file,
 * `<mark>` around the exact match (column + length from the Host, sliced in JS —
 * nothing is injected as HTML) and a click that jumps to the line through
 * `onOpenFile`.
 */

const ST_SEARCH = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    height: '100%',
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
    background: C.base,
  },
  bar: {
    display: 'flex',
    flexDirection: 'column',
    gap: 7,
    flex: '0 0 auto',
    padding: '10px 12px',
    borderBottom: '1px solid ' + C.border2,
    background: C.base,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  input: {
    flex: '1 1 auto',
    minWidth: 0,
    height: 30,
    padding: '0 10px',
    boxSizing: 'border-box',
    border: '1px solid ' + C.border1,
    borderRadius: 7,
    background: C.layer1,
    color: C.text,
    fontFamily: FONT_UI,
    fontSize: 12.5,
    outline: 'none',
  },
  inputFocus: {
    boxShadow: '0 0 0 2px var(--dsw-focus-ring-color, ' + C.accent + ')',
  },
  inputSmall: {
    height: 26,
    fontSize: 12,
  },
  toggle: {
    width: 'auto',
    minWidth: 28,
    padding: '0 6px',
    fontFamily: FONT_MONO,
    fontSize: 11.5,
    fontWeight: 600,
  },
  toggleActive: {
    color: C.accent,
  },
  summary: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: '0 0 auto',
    height: 28,
    padding: '0 12px',
    boxSizing: 'border-box',
    borderBottom: '1px solid ' + C.border2,
    color: C.textTertiary,
    fontSize: 11.5,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  summaryText: {
    flex: '0 0 auto',
    fontWeight: 500,
    color: C.textSecondary,
  },
  truncated: {
    color: C.warnLabel,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  results: {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'auto',
    paddingBottom: 16,
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    height: 28,
    padding: '0 12px',
    position: 'sticky',
    top: 0,
    zIndex: 1,
    background: C.platform,
    borderTop: '1px solid ' + C.border1,
    borderBottom: '1px solid ' + C.border1,
    cursor: 'pointer',
    color: C.text,
    fontSize: 12,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  fileRowHover: {
    background: C.layer2,
  },
  filePath: {
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontFamily: FONT_MONO,
    fontSize: 11.5,
  },
  fileDir: {
    color: C.textTertiary,
  },
  fileCount: {
    flex: '0 0 auto',
    color: C.textTertiary,
    fontSize: 10.5,
    fontFamily: FONT_UI,
    border: '1px solid ' + C.border1,
    borderRadius: 999,
    padding: '0 6px',
    lineHeight: '15px',
  },
  hit: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 0,
    padding: '1px 12px 1px 0',
    cursor: 'pointer',
    minWidth: 0,
    color: C.textSecondary,
  },
  hitHover: {
    background: C.hover,
  },
  hitLine: {
    flex: '0 0 auto',
    width: 48,
    paddingRight: 10,
    boxSizing: 'border-box',
    textAlign: 'right',
    fontFamily: FONT_MONO,
    fontSize: 11,
    lineHeight: '18px',
    color: C.textTertiary,
    userSelect: 'none',
  },
  hitText: {
    flex: '1 1 auto',
    minWidth: 0,
    fontFamily: FONT_MONO,
    fontSize: 12,
    lineHeight: '18px',
    whiteSpace: 'pre',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: C.textSecondary,
  },
  mark: {
    background: C.accent,
    color: C.inverted,
    borderRadius: 2,
    padding: '0 1px',
    fontWeight: 600,
  },
};

/** Focus-ring text input used by the search bar. */
function SearchField(props) {
  const [focused, setFocused] = useState(false);
  return h('input', {
    type: 'text',
    ref: props.inputRef,
    value: props.value,
    placeholder: props.placeholder,
    'aria-label': props.ariaLabel,
    spellCheck: false,
    autoCapitalize: 'off',
    autoCorrect: 'off',
    autoComplete: 'off',
    style: Object.assign({}, ST_SEARCH.input, props.small ? ST_SEARCH.inputSmall : null, focused ? ST_SEARCH.inputFocus : null, props.style || null),
    onChange: props.onChange,
    onKeyDown: props.onKeyDown,
    onFocus: function () { setFocused(true); },
    onBlur: function () { setFocused(false); },
  });
}

/** One result line: line number gutter + text with the matched span in `<mark>`. */
function SearchHitRow(props) {
  const [hover, setHover] = useState(false);
  const segments = S.splitMatch(props.text, props.column, props.length);
  return h(
    'div',
    {
      style: Object.assign({}, ST_SEARCH.hit, hover ? ST_SEARCH.hitHover : null),
      title: props.text,
      'data-line': props.line,
      onClick: function () {
        if (typeof props.onOpen === 'function') props.onOpen(props.path, props.line);
      },
      onMouseEnter: function () { setHover(true); },
      onMouseLeave: function () { setHover(false); },
    },
    h('span', { style: ST_SEARCH.hitLine }, String(props.line)),
    h(
      'span',
      { style: ST_SEARCH.hitText },
      segments.map(function (segment, index) {
        return segment.hit
          ? h('mark', { key: 'seg-' + String(index), style: ST_SEARCH.mark }, segment.text)
          : h('span', { key: 'seg-' + String(index) }, segment.text);
      }),
    ),
  );
}

/** One file group: header row + hit rows. */
function SearchFileGroup(props) {
  const [hover, setHover] = useState(false);
  const file = props.file;
  const matches = Array.isArray(file.matches) ? file.matches : [];
  const path = typeof file.path === 'string' ? file.path : '';
  const slash = path.lastIndexOf('/');
  const dir = slash === -1 ? '' : path.slice(0, slash + 1);
  const name = slash === -1 ? path : path.slice(slash + 1);
  const firstLine = matches.length > 0 && Number.isFinite(matches[0].line) ? matches[0].line : 1;
  return h(
    'div',
    { 'data-file': path },
    h(
      'div',
      {
        style: Object.assign({}, ST_SEARCH.fileRow, hover ? ST_SEARCH.fileRowHover : null),
        title: S.tt(props.t, 'search.open', { path: path }),
        onClick: function () {
          if (typeof props.onOpen === 'function') props.onOpen(path, firstLine);
        },
        onMouseEnter: function () { setHover(true); },
        onMouseLeave: function () { setHover(false); },
      },
      h(S.Icons.File, { size: 13 }),
      h(
        'span',
        { style: ST_SEARCH.filePath },
        dir.length > 0 ? h('span', { style: ST_SEARCH.fileDir }, dir) : null,
        h('span', null, name),
      ),
      h('span', { style: ST_SEARCH.fileCount }, S.tt(props.t, 'search.matches', { count: matches.length })),
    ),
    matches.map(function (match) {
      return h(SearchHitRow, {
        key: 'hit:' + path + ':' + String(match.line) + ':' + String(match.column),
        t: props.t,
        path: path,
        line: match.line,
        column: match.column,
        length: match.length,
        text: match.text,
        onOpen: props.onOpen,
      });
    }),
  );
}

/** Results body: summary + grouped file blocks (pure). */
function SearchResults(props) {
  const t = props.t;
  const data = props.data !== null && props.data !== undefined ? props.data : {};
  const files = Array.isArray(data.files) ? data.files : [];
  const totalMatches = Number.isFinite(data.totalMatches) ? data.totalMatches : 0;
  const elapsed = Number.isFinite(data.elapsedMs) ? Math.round(data.elapsedMs) : 0;
  return h(
    'div',
    { style: ST_SEARCH.results },
    h(
      'div',
      { style: ST_SEARCH.summary, role: 'status' },
      h('span', { style: ST_SEARCH.summaryText }, t('search.summary', { files: files.length, matches: totalMatches, ms: elapsed })),
      h('span', { style: { flex: '1 1 auto' } }),
      data.truncated === true ? h('span', { style: ST_SEARCH.truncated }, t('search.truncated')) : null,
    ),
    files.length === 0
      ? h(S.EmptyState, { t: t, icon: S.Icons.Search, title: t('search.empty', { query: props.query }), body: t('search.empty.body') })
      : files.map(function (file) {
          return h(SearchFileGroup, {
            key: 'file:' + file.path,
            t: t,
            file: file,
            onOpen: props.onOpenFile,
          });
        }),
  );
}

/**
 * The Search tab.
 * @param {{t: Function, root: string, onOpenFile: Function, reloadToken?: number}} props - slot props.
 */
function SearchView(props) {
  const fallbackT = S.useT();
  const t = props !== null && props !== undefined && typeof props.t === 'function' ? props.t : fallbackT;
  const root = props.root;

  const [query, setQuery] = useState('');
  const [include, setInclude] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [whole, setWhole] = useState(false);
  const [result, setResult] = useState({ status: 'idle', data: null, error: null });
  const [lastQuery, setLastQuery] = useState('');

  const requestRef = useRef(0);
  const abortRef = useRef(/** @type {AbortController|null} */ (null));
  const queryRef = useRef(/** @type {HTMLInputElement|null} */ (null));

  // Focusing the query field when the view opens makes the tab instantly usable.
  useEffect(function () {
    const input = queryRef.current;
    if (input !== null && input !== undefined && typeof input.focus === 'function') {
      try {
        input.focus();
      } catch (error) {
        /* focus is optional */
      }
    }
    return undefined;
  }, []);

  const runSearch = useCallback(function () {
    const term = typeof query === 'string' ? query.trim() : '';
    if (term.length === 0) {
      setResult({ status: 'idle', data: null, error: null });
      setLastQuery('');
      return;
    }
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
    setLastQuery(term);
    setResult({ status: 'loading', data: null, error: null });
    const params = {
      root: root,
      q: term,
      regex: regex ? '1' : '0',
      case: caseSensitive ? '1' : '0',
      whole: whole ? '1' : '0',
    };
    const includeText = typeof include === 'string' ? include.trim() : '';
    if (includeText.length > 0) params.include = includeText;
    S.requestJson(S.apiUrl(ROUTES.search, params), { signal: controller === null ? undefined : controller.signal })
      .then(function (payload) {
        if (requestRef.current !== requestId) return;
        setResult({ status: 'loaded', data: payload, error: null });
      })
      .catch(function (cause) {
        if (cause !== null && cause !== undefined && cause.name === 'AbortError') return;
        if (requestRef.current !== requestId) return;
        setResult({ status: 'error', data: null, error: cause });
      });
  }, [query, include, caseSensitive, regex, whole, root]);

  useEffect(function () {
    return function () {
      if (abortRef.current !== null && abortRef.current !== undefined) {
        try {
          abortRef.current.abort();
        } catch (error) {
          /* already settled */
        }
      }
    };
  }, []);

  useEffect(function () {
    setResult({ status: 'idle', data: null, error: null });
    setLastQuery('');
    return undefined;
  }, [root]);

  const onQueryChange = useCallback(function (event) {
    const target = event !== null && event !== undefined ? event.target : null;
    setQuery(target !== null && target !== undefined && typeof target.value === 'string' ? target.value : '');
  }, []);

  const onIncludeChange = useCallback(function (event) {
    const target = event !== null && event !== undefined ? event.target : null;
    setInclude(target !== null && target !== undefined && typeof target.value === 'string' ? target.value : '');
  }, []);

  const onKeyDown = useCallback(function (event) {
    if (event === null || event === undefined) return;
    if (event.key !== 'Enter') return;
    event.preventDefault();
    runSearch();
  }, [runSearch]);

  const onOpenHit = useCallback(function (path, line) {
    if (typeof props.onOpenFile === 'function') props.onOpenFile(path, line);
  }, [props.onOpenFile]);

  const runButton = h(
    S.PrimaryButton,
    { title: t('search.run'), ariaLabel: t('search.run'), onClick: runSearch, disabled: result.status === 'loading' },
    h(S.Icons.Search, { size: 14 }),
    t('search.run'),
  );

  const toggleCase = h(
    S.ToolButton,
    {
      title: t('search.case'),
      ariaLabel: t('search.case'),
      active: caseSensitive,
      'aria-pressed': caseSensitive ? 'true' : 'false',
      style: Object.assign({}, ST_SEARCH.toggle, caseSensitive ? ST_SEARCH.toggleActive : null),
      onClick: function () { setCaseSensitive(function (value) { return !value; }); },
    },
    'Aa',
  );
  const toggleRegex = h(
    S.ToolButton,
    {
      title: t('search.regex'),
      ariaLabel: t('search.regex'),
      active: regex,
      'aria-pressed': regex ? 'true' : 'false',
      style: Object.assign({}, ST_SEARCH.toggle, regex ? ST_SEARCH.toggleActive : null),
      onClick: function () { setRegex(function (value) { return !value; }); },
    },
    '.*',
  );
  const toggleWhole = h(
    S.ToolButton,
    {
      title: t('search.whole'),
      ariaLabel: t('search.whole'),
      active: whole,
      'aria-pressed': whole ? 'true' : 'false',
      style: Object.assign({}, ST_SEARCH.toggle, whole ? ST_SEARCH.toggleActive : null),
      onClick: function () { setWhole(function (value) { return !value; }); },
    },
    'ab|',
  );

  /** @type {any} */
  let body = null;
  if (result.status === 'loading') {
    body = h(S.LoadingIndicator, { t: t, label: t('search.running') });
  } else if (result.status === 'error') {
    body = h(S.InlineError, { t: t, title: t('search.error.title'), message: S.errorText(result.error), onRetry: runSearch });
  } else if (result.status === 'loaded') {
    body = h(SearchResults, { t: t, data: result.data, query: lastQuery, onOpenFile: onOpenHit });
  } else {
    body = h(S.EmptyState, { t: t, icon: S.Icons.Search, title: t('search.idle.title'), body: t('search.idle.body') });
  }

  return h(
    'div',
    { style: ST_SEARCH.root },
    h(
      'div',
      { style: ST_SEARCH.bar },
      h(
        'div',
        { style: ST_SEARCH.row },
        h(SearchField, {
          value: query,
          inputRef: queryRef,
          placeholder: t('search.placeholder'),
          ariaLabel: t('search.placeholder'),
          onChange: onQueryChange,
          onKeyDown: onKeyDown,
        }),
        toggleCase,
        toggleRegex,
        toggleWhole,
        runButton,
      ),
      h(
        'div',
        { style: ST_SEARCH.row },
        h(SearchField, {
          value: include,
          small: true,
          placeholder: t('search.includePlaceholder'),
          ariaLabel: t('search.include'),
          onChange: onIncludeChange,
          onKeyDown: onKeyDown,
        }),
      ),
    ),
    body,
  );
}

S.SearchView = SearchView;
S.SearchResults = SearchResults;
S.SearchFileGroup = SearchFileGroup;
S.SearchHitRow = SearchHitRow;
S.SearchField = SearchField;
S.ST_SEARCH = ST_SEARCH;
