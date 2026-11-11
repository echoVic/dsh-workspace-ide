/**
 * dsh-workspace-ide — client half, the Git surface.
 *
 * Reads the Host's git routes: status (branch, ahead/behind, staged / unstaged /
 * untracked / conflicted changes), history (recent commits) and unified diffs
 * (working tree, index or one commit). Changes are grouped and rendered with a
 * colour-coded status letter; a click loads the diff on the right. The diff
 * parser tracks old/new line numbers so the viewer reads like an editor gutter.
 */

const ST_GIT = {
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
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: '0 0 auto',
    height: 42,
    padding: '0 12px',
    boxSizing: 'border-box',
    borderBottom: '1px solid ' + C.border2,
    background: C.base,
    minWidth: 0,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  branchGlyph: {
    display: 'inline-flex',
    alignItems: 'center',
    color: C.accent,
    flex: '0 0 auto',
  },
  branchText: {
    fontFamily: FONT_MONO,
    fontSize: 11.5,
    color: C.text,
    maxWidth: 220,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    flex: '0 0 auto',
    padding: '1px 7px',
    border: '1px solid ' + C.border1,
    borderRadius: 999,
    background: C.platform,
    lineHeight: '17px',
  },
  meta: {
    fontSize: 11,
    color: C.textTertiary,
    flex: '0 0 auto',
  },
  ahead: {
    color: C.diffAdd,
    fontSize: 11,
    flex: '0 0 auto',
  },
  behind: {
    color: C.warnLabel,
    fontSize: 11,
    flex: '0 0 auto',
  },
  spacer: {
    flex: '1 1 auto',
    minWidth: 6,
  },
  summaryClean: {
    fontSize: 11.5,
    color: C.diffAdd,
    flex: '0 0 auto',
  },
  summaryDirty: {
    fontSize: 11.5,
    color: C.warnLabel,
    flex: '0 0 auto',
  },
  segmented: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: 2,
    borderRadius: 7,
    border: '1px solid ' + C.border1,
    background: C.platform,
    flex: '0 0 auto',
  },
  segment: {
    height: 22,
    padding: '0 10px',
    border: 'none',
    borderRadius: 5,
    background: 'transparent',
    color: C.textSecondary,
    fontFamily: FONT_UI,
    fontSize: 11.5,
    cursor: 'pointer',
    outline: 'none',
    transition: 'background 120ms ease, color 120ms ease',
  },
  segmentHover: {
    color: C.text,
  },
  segmentActive: {
    background: C.activeBg,
    color: C.text,
    fontWeight: 600,
  },
  body: {
    display: 'flex',
    flex: '1 1 auto',
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
  },
  listPane: {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    height: '100%',
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
    background: C.base,
  },
  listScroll: {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'auto',
    paddingBottom: 16,
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '10px 12px 4px',
    fontSize: 10.5,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: C.textTertiary,
    whiteSpace: 'nowrap',
  },
  groupCount: {
    fontWeight: 400,
    color: C.textTertiary,
    opacity: 0.8,
  },
  changeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    height: 26,
    padding: '0 12px',
    cursor: 'pointer',
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: C.text,
    userSelect: 'none',
    boxSizing: 'border-box',
  },
  changeRowHover: {
    background: C.hover,
  },
  changeRowActive: {
    background: C.activeBg,
  },
  letter: {
    flex: '0 0 auto',
    width: 13,
    textAlign: 'center',
    fontFamily: FONT_MONO,
    fontSize: 11,
    fontWeight: 700,
  },
  changePath: {
    flex: '1 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    fontFamily: FONT_MONO,
    fontSize: 11.5,
  },
  changeDir: {
    color: C.textTertiary,
  },
  changeFrom: {
    flex: '0 0 auto',
    color: C.textTertiary,
    fontSize: 10.5,
  },
  historyRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '6px 12px',
    cursor: 'pointer',
    borderBottom: '1px solid ' + C.border2,
    boxSizing: 'border-box',
  },
  historyRowHover: {
    background: C.hover,
  },
  historyRowActive: {
    background: C.activeBg,
  },
  historySubject: {
    fontSize: 12,
    color: C.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  historyMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 10.5,
    color: C.textTertiary,
    overflow: 'hidden',
    whiteSpace: 'nowrap',
  },
  hash: {
    fontFamily: FONT_MONO,
    color: C.accent,
    fontSize: 10.5,
    flex: '0 0 auto',
  },
  refBadge: {
    fontFamily: FONT_UI,
    color: C.textSecondary,
    border: '1px solid ' + C.border1,
    borderRadius: 999,
    padding: '0 5px',
    fontSize: 9.5,
    lineHeight: '14px',
    flex: '0 0 auto',
  },
  diffPane: {
    display: 'flex',
    flexDirection: 'column',
    flex: '1 1 auto',
    height: '100%',
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
    background: C.base,
  },
  diffHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: '0 0 auto',
    height: 38,
    padding: '0 12px',
    boxSizing: 'border-box',
    borderBottom: '1px solid ' + C.border2,
    minWidth: 0,
    overflow: 'hidden',
  },
  diffTitle: {
    flex: '0 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: FONT_MONO,
    fontSize: 11.5,
    color: C.text,
  },
  diffScroll: {
    flex: '1 1 auto',
    minHeight: 0,
    overflow: 'auto',
  },
  diffPre: {
    margin: 0,
    padding: '6px 0 20px',
    fontFamily: FONT_MONO,
    fontSize: 12,
    lineHeight: '18px',
    color: C.textSecondary,
  },
  diffRow: {
    display: 'flex',
    whiteSpace: 'pre',
    minWidth: 'max-content',
  },
  diffNo: {
    flex: '0 0 auto',
    width: 42,
    paddingRight: 8,
    boxSizing: 'border-box',
    textAlign: 'right',
    color: C.textTertiary,
    opacity: 0.72,
    fontSize: 10.5,
    userSelect: 'none',
  },
  diffText: {
    flex: '1 1 auto',
    paddingLeft: 8,
    paddingRight: 18,
  },
  diffHunkRow: {
    background: C.platform,
  },
  diffAddRow: {
    background: C.diffAddBg,
  },
  diffDelRow: {
    background: C.diffDelBg,
  },
  diffAdd: {
    color: C.diffAdd,
  },
  diffDel: {
    color: C.diffDel,
  },
  diffHunk: {
    color: C.accent,
    fontWeight: 600,
  },
  diffMeta: {
    color: C.textTertiary,
  },
  diffContext: {
    color: C.textSecondary,
  },
  diffEmpty: {
    display: 'flex',
    flex: '1 1 auto',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px 16px',
    color: C.textTertiary,
    fontSize: 12,
  },
  notRepoWrap: {
    display: 'flex',
    flex: '1 1 auto',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 0,
    overflow: 'auto',
    padding: '28px 24px',
    background: C.base,
  },
  notRepoCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    maxWidth: 560,
    textAlign: 'center',
  },
  notRepoIcon: {
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
  notRepoTitle: {
    margin: 0,
    fontSize: 13.5,
    fontWeight: 600,
    color: C.text,
  },
  notRepoBody: {
    margin: 0,
    fontSize: 12,
    lineHeight: '18px',
    color: C.textSecondary,
    maxWidth: 440,
    wordBreak: 'break-word',
  },
  notRepoSuggest: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    marginTop: 6,
    paddingTop: 12,
    borderTop: '1px solid ' + C.border1,
  },
  notRepoSuggestLabel: {
    margin: 0,
    fontSize: 11,
    color: C.textTertiary,
  },
  notRepoActions: {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  notRepoHint: {
    margin: 0,
    fontSize: 11.5,
    lineHeight: '17px',
    color: C.textTertiary,
    maxWidth: 440,
  },
};

/**
 * Classify one raw unified-diff line.
 * @param {string} line - raw line (no trailing newline).
 * @returns {'meta'|'hunk'|'add'|'del'|'ctx'|'empty'} kind.
 */
function classifyDiffLine(line) {
  const text = typeof line === 'string' ? line : '';
  if (text.length === 0) return 'empty';
  if (text.indexOf('@@') === 0) return 'hunk';
  if (text.indexOf('diff --git ') === 0) return 'meta';
  if (text.indexOf('index ') === 0) return 'meta';
  if (text.indexOf('--- ') === 0) return 'meta';
  if (text.indexOf('+++ ') === 0) return 'meta';
  if (text.indexOf('new file mode') === 0) return 'meta';
  if (text.indexOf('deleted file mode') === 0) return 'meta';
  if (text.indexOf('old mode') === 0) return 'meta';
  if (text.indexOf('new mode') === 0) return 'meta';
  if (text.indexOf('similarity index') === 0) return 'meta';
  if (text.indexOf('rename from') === 0) return 'meta';
  if (text.indexOf('rename to') === 0) return 'meta';
  if (text.indexOf('copy from') === 0) return 'meta';
  if (text.indexOf('copy to') === 0) return 'meta';
  if (text.indexOf('Binary files') === 0) return 'meta';
  if (text.charAt(0) === '\\') return 'meta';
  if (text.charAt(0) === '+') return 'add';
  if (text.charAt(0) === '-') return 'del';
  return 'ctx';
}

/**
 * Parse a unified diff into rows carrying the old/new line numbers from the
 * hunk headers (so the renderer can show an editor-style two-column gutter).
 *
 * @param {string} diff - raw diff text.
 * @returns {Array<{kind: string, oldNo: number|null, newNo: number|null, text: string}>} rows.
 */
function parseDiffLines(diff) {
  const text = typeof diff === 'string' ? diff : '';
  if (text.length === 0) return [];
  const lines = text.split('\n');
  const rows = [];
  // Unified-diff hunk bodies are line-counted, not prefix-guessed: a deletion
  // whose content starts with "-- " renders as "--- …", which must stay a
  // deletion (e.g. SQL / Haskell / Lua comments) and must not be mistaken for a
  // `--- a/file` header. The hunk header's counts tell us exactly how many
  // lines still belong to the hunk, so headers after it classify normally.
  let oldRemaining = 0;
  let newRemaining = 0;
  let oldNo = 0;
  let newNo = 0;
  let insideHunk = false;
  lines.forEach(function (raw) {
    if (insideHunk) {
      if (raw.length === 0) {
        rows.push({ kind: 'empty', oldNo: null, newNo: null, text: '' });
        return;
      }
      const prefix = raw.charAt(0);
      if (prefix === '\\') {
        rows.push({ kind: 'meta', oldNo: null, newNo: null, text: raw });
        return;
      }
      if (prefix === ' ' || prefix === '+' || prefix === '-') {
        const kind = prefix === '+' ? 'add' : prefix === '-' ? 'del' : 'ctx';
        rows.push({ kind: kind, oldNo: kind === 'add' ? null : oldNo, newNo: kind === 'del' ? null : newNo, text: raw });
        if (kind !== 'add') {
          oldNo = oldNo + 1;
          oldRemaining = oldRemaining - 1;
        }
        if (kind !== 'del') {
          newNo = newNo + 1;
          newRemaining = newRemaining - 1;
        }
        if (oldRemaining <= 0 && newRemaining <= 0) insideHunk = false;
        return;
      }
      // Not hunk content (truncated diff or an unexpected marker): fall through
      // and classify the line as a top-level diff line.
      insideHunk = false;
    }
    if (raw.length === 0) {
      rows.push({ kind: 'empty', oldNo: null, newNo: null, text: '' });
      return;
    }
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (match !== null) {
      oldNo = Number(match[1]);
      newNo = Number(match[3]);
      oldRemaining = match[2] === undefined ? 1 : Number(match[2]);
      newRemaining = match[4] === undefined ? 1 : Number(match[4]);
      insideHunk = true;
      rows.push({ kind: 'hunk', oldNo: null, newNo: null, text: raw });
      return;
    }
    const kind = classifyDiffLine(raw);
    rows.push({ kind: kind, oldNo: null, newNo: null, text: raw });
  });
  while (rows.length > 0 && rows[rows.length - 1].kind === 'empty') rows.pop();
  return rows;
}

/** @param {string} kind - diff line kind. @returns {object} text colour style. */
function diffTextStyle(kind) {
  if (kind === 'add') return ST_GIT.diffAdd;
  if (kind === 'del') return ST_GIT.diffDel;
  if (kind === 'hunk') return ST_GIT.diffHunk;
  if (kind === 'meta') return ST_GIT.diffMeta;
  return ST_GIT.diffContext;
}

/**
 * Colour-coded unified diff viewer.
 * @param {{t: Function, diff: string, truncated?: boolean}} props - diff text + translator.
 */
function DiffView(props) {
  const t = typeof props.t === 'function' ? props.t : S.translate;
  const parsed = useMemo(function () {
    return parseDiffLines(props.diff);
  }, [props.diff]);
  const capped = parsed.length > MAX_DIFF_LINES;
  const rows = capped ? parsed.slice(0, MAX_DIFF_LINES) : parsed;
  if (rows.length === 0) {
    return h('div', { style: ST_GIT.diffEmpty }, t('git.diff.empty'));
  }
  return h(
    'div',
    { style: ST_GIT.diffScroll },
    props.truncated === true || capped
      ? h(S.NoticeBar, {
          t: t,
          kind: 'info',
          text: capped ? t('git.diff.capped') : t('git.diff.truncated', { lines: MAX_DIFF_LINES }),
        })
      : null,
    h(
      'div',
      { style: ST_GIT.diffPre, role: 'table', 'aria-label': t('git.diff.title') },
      rows.map(function (row, index) {
        return h(
          'div',
          {
            key: 'diff-' + String(index),
            style: Object.assign(
              {},
              ST_GIT.diffRow,
              row.kind === 'hunk' ? ST_GIT.diffHunkRow : row.kind === 'add' ? ST_GIT.diffAddRow : row.kind === 'del' ? ST_GIT.diffDelRow : null,
            ),
            'data-kind': row.kind,
          },
          h('span', { style: ST_GIT.diffNo }, row.oldNo === null ? '' : String(row.oldNo)),
          h('span', { style: ST_GIT.diffNo }, row.newNo === null ? '' : String(row.newNo)),
          h('span', { style: Object.assign({}, ST_GIT.diffText, diffTextStyle(row.kind)) }, row.text.length > 0 ? row.text : ' '),
        );
      }),
    ),
  );
}

/** @param {string} letter - porcelain status letter. @returns {object} colour style. */
function statusLetterStyle(letter) {
  if (letter === 'M') return { color: C.warnLabel };
  if (letter === 'A') return { color: C.diffAdd };
  if (letter === 'D') return { color: C.diffDel };
  if (letter === 'R' || letter === 'C') return { color: C.accent };
  if (letter === 'U') return { color: C.error };
  return { color: C.textTertiary };
}

/** One change row (letter + path). Pure. */
function GitChangeRow(props) {
  const [hover, setHover] = useState(false);
  const change = props.change;
  const path = typeof change.path === 'string' ? change.path : '';
  const slash = path.lastIndexOf('/');
  const dir = slash === -1 ? '' : path.slice(0, slash + 1);
  const name = slash === -1 ? path : path.slice(slash + 1);
  return h(
    'div',
    {
      style: Object.assign({}, ST_GIT.changeRow, props.active ? ST_GIT.changeRowActive : hover ? ST_GIT.changeRowHover : null),
      title: change.from ? S.tt(props.t, 'git.renamedFrom', { path: change.from }) : path,
      'data-path': path,
      onClick: function () {
        if (typeof props.onSelect === 'function') props.onSelect(change);
      },
      onMouseEnter: function () { setHover(true); },
      onMouseLeave: function () { setHover(false); },
    },
    h('span', { style: Object.assign({}, ST_GIT.letter, statusLetterStyle(change.letter)) }, change.letter),
    h(
      'span',
      { style: ST_GIT.changePath },
      dir.length > 0 ? h('span', { style: ST_GIT.changeDir }, dir) : null,
      h('span', null, name),
    ),
    change.from ? h('span', { style: ST_GIT.changeFrom }, '‹ ' + change.from) : null,
  );
}

/** One group of changes (staged / unstaged / untracked / conflicted). */
function GitChangeGroup(props) {
  const changes = props.changes;
  if (!Array.isArray(changes) || changes.length === 0) return null;
  return h(
    'div',
    { 'data-group': props.groupId },
    h(
      'div',
      { style: ST_GIT.groupHeader },
      h('span', null, props.label),
      h('span', { style: ST_GIT.groupCount }, String(changes.length)),
    ),
    changes.map(function (change) {
      return h(GitChangeRow, {
        key: 'change:' + change.staged + ':' + change.path,
        t: props.t,
        change: change,
        active: props.activePath === change.path && props.activeStaged === change.staged,
        onSelect: props.onSelect,
      });
    }),
  );
}

/** One commit row. */
function GitCommitRow(props) {
  const [hover, setHover] = useState(false);
  const commit = props.commit;
  return h(
    'div',
    {
      style: Object.assign({}, ST_GIT.historyRow, props.active ? ST_GIT.historyRowActive : hover ? ST_GIT.historyRowHover : null),
      title: commit.subject,
      'data-hash': commit.hash,
      onClick: function () {
        if (typeof props.onSelect === 'function') props.onSelect(commit);
      },
      onMouseEnter: function () { setHover(true); },
      onMouseLeave: function () { setHover(false); },
    },
    h('span', { style: ST_GIT.historySubject }, typeof commit.subject === 'string' && commit.subject.length > 0 ? commit.subject : '—'),
    h(
      'span',
      { style: ST_GIT.historyMeta },
      h('span', { style: ST_GIT.hash }, typeof commit.short === 'string' ? commit.short : String(commit.hash).slice(0, 7)),
      Array.isArray(commit.refs) && commit.refs.length > 0
        ? commit.refs.map(function (ref, index) {
            return h('span', { key: 'ref-' + String(index), style: ST_GIT.refBadge }, ref);
          })
        : null,
      h('span', null, typeof commit.author === 'string' ? commit.author : ''),
      h('span', null, S.formatDateTime(commit.date)),
    ),
  );
}

/**
 * Normalise the Host's porcelain rows into the four display groups.
 * @param {Array<object>} files - `{path, index, worktree, status, from}` rows.
 * @returns {{staged: Array, unstaged: Array, untracked: Array, conflicted: Array}} groups.
 */
function groupChanges(files) {
  const groups = { staged: [], unstaged: [], untracked: [], conflicted: [] };
  const list = Array.isArray(files) ? files : [];
  list.forEach(function (file) {
    if (file === null || file === undefined || typeof file.path !== 'string' || file.path.length === 0) return;
    const code = typeof file.status === 'string' && file.status.length >= 2 ? file.status : String(file.index === undefined ? ' ' : file.index) + String(file.worktree === undefined ? ' ' : file.worktree);
    const index = code.charAt(0);
    const worktree = code.charAt(1);
    const base = { path: file.path, from: typeof file.from === 'string' ? file.from : null, code: code };
    const conflicted =
      index === 'U' || worktree === 'U' || (index === 'A' && worktree === 'A') || (index === 'D' && worktree === 'D');
    if (conflicted) {
      groups.conflicted.push(Object.assign({}, base, { letter: 'U', staged: false }));
      return;
    }
    if (index === '?' || worktree === '?') {
      groups.untracked.push(Object.assign({}, base, { letter: '?', staged: false }));
      return;
    }
    if (index !== ' ') groups.staged.push(Object.assign({}, base, { letter: index, staged: true }));
    if (worktree !== ' ') groups.unstaged.push(Object.assign({}, base, { letter: worktree, staged: false }));
  });
  return groups;
}

/** Left list for the Changes view. */
function GitChangesList(props) {
  const t = props.t;
  const groups = props.groups;
  const total = groups.staged.length + groups.unstaged.length + groups.untracked.length + groups.conflicted.length;
  if (total === 0) {
    return h(S.EmptyState, { t: t, icon: S.Icons.Git, title: t('git.changes.empty'), body: t('git.changes.empty.body') });
  }
  const active = props.selection !== null && props.selection !== undefined && props.selection.kind === 'change' ? props.selection.change : null;
  return h(
    'div',
    { style: ST_GIT.listScroll },
    h(GitChangeGroup, { t: t, groupId: 'conflicted', label: t('git.group.conflicted'), changes: groups.conflicted, selection: props.selection, activePath: active === null ? null : active.path, activeStaged: active === null ? null : active.staged, onSelect: props.onSelect }),
    h(GitChangeGroup, { t: t, groupId: 'staged', label: t('git.group.staged'), changes: groups.staged, selection: props.selection, activePath: active === null ? null : active.path, activeStaged: active === null ? null : active.staged, onSelect: props.onSelect }),
    h(GitChangeGroup, { t: t, groupId: 'unstaged', label: t('git.group.unstaged'), changes: groups.unstaged, selection: props.selection, activePath: active === null ? null : active.path, activeStaged: active === null ? null : active.staged, onSelect: props.onSelect }),
    h(GitChangeGroup, { t: t, groupId: 'untracked', label: t('git.group.untracked'), changes: groups.untracked, selection: props.selection, activePath: active === null ? null : active.path, activeStaged: active === null ? null : active.staged, onSelect: props.onSelect }),
  );
}

/** Left list for the History view. */
function GitHistoryList(props) {
  const t = props.t;
  const commits = Array.isArray(props.commits) ? props.commits : [];
  if (commits.length === 0) {
    return h(S.EmptyState, { t: t, icon: S.Icons.Git, title: t('git.history.empty'), body: t('git.history.empty.body') });
  }
  const activeHash = props.selection !== null && props.selection !== undefined && props.selection.kind === 'commit' ? props.selection.commit.hash : null;
  return h(
    'div',
    { style: ST_GIT.listScroll },
    h('div', { style: ST_GIT.groupHeader }, h('span', null, t('git.history')), h('span', { style: ST_GIT.groupCount }, t('git.history.count', { count: commits.length }))),
    commits.map(function (commit) {
      return h(GitCommitRow, { key: 'commit:' + commit.hash, t: t, commit: commit, active: commit.hash === activeHash, onSelect: props.onSelect });
    }),
  );
}

/** Header of the right-hand diff pane. */
function GitDiffHeader(props) {
  const t = props.t;
  const selection = props.selection;
  if (selection === null || selection === undefined) return null;
  if (selection.kind === 'commit') {
    const commit = selection.commit;
    return h(
      'div',
      { style: ST_GIT.diffHeader },
      h(S.Chip, { tone: 'brand' }, typeof commit.short === 'string' ? commit.short : String(commit.hash).slice(0, 7)),
      h('span', { style: ST_GIT.diffTitle, title: commit.subject }, typeof commit.subject === 'string' ? commit.subject : ''),
      h('span', { style: { flex: '1 1 auto' } }),
      h('span', { style: ST_GIT.meta }, t('git.commit.meta', { author: typeof commit.author === 'string' ? commit.author : '', date: S.formatDateTime(commit.date) })),
    );
  }
  const change = selection.change;
  return h(
    'div',
    { style: ST_GIT.diffHeader },
    h('span', { style: ST_GIT.diffTitle, title: change.path }, change.path),
    change.staged ? h(S.Chip, { tone: 'success' }, t('git.diff.staged')) : null,
    change.letter === '?' ? h(S.Chip, { tone: 'warn' }, t('git.diff.untracked')) : null,
    h('span', { style: { flex: '1 1 auto' } }),
    h('span', { style: Object.assign({}, ST_GIT.letter, statusLetterStyle(change.letter)) }, change.letter),
  );
}

/**
 * `repo:false` state: it names the current workspace, offers a retry and lists up
 * to five other known workspaces that are git repositories as one-click switches
 * (the default workspace often is not a repository, so the surface must not read
 * like a broken feature).
 */
function GitNotRepoState(props) {
  const t = typeof props.t === 'function' ? props.t : S.translate;
  const root = typeof props.root === 'string' ? props.root : '';
  const list = Array.isArray(props.workspaces) ? props.workspaces : [];
  const current = list.find(function (entry) {
    return entry !== null && entry !== undefined && entry.path === root;
  });
  const title =
    current !== undefined && current !== null && typeof current.title === 'string' && current.title.length > 0
      ? current.title
      : S.baseName(root) || root;
  const candidates = list
    .filter(function (entry) {
      return entry !== null && entry !== undefined && typeof entry.path === 'string' && entry.path.length > 0 && entry.path !== root && entry.git === true;
    })
    .slice(0, 5);
  return h(
    'div',
    { style: ST_GIT.notRepoWrap },
    h(
      'div',
      { style: ST_GIT.notRepoCard },
      h('div', { style: ST_GIT.notRepoIcon }, h(S.Icons.Git, { size: 24 })),
      h('p', { style: ST_GIT.notRepoTitle }, t('git.notRepo.title')),
      h('p', { style: ST_GIT.notRepoBody }, t('git.notRepo.current', { title: title })),
      h(
        S.GhostButton,
        { title: t('action.retry'), onClick: props.onRetry },
        h(S.Icons.Refresh, { size: 13 }),
        t('action.retry'),
      ),
      candidates.length > 0
        ? h(
            'div',
            { style: ST_GIT.notRepoSuggest },
            h('p', { style: ST_GIT.notRepoSuggestLabel }, t('git.notRepo.others')),
            h(
              'div',
              { style: ST_GIT.notRepoActions },
              candidates.map(function (entry) {
                return h(
                  S.GhostButton,
                  {
                    key: 'workspace:' + entry.path,
                    title: entry.path,
                    ariaLabel: entry.title + ' — ' + entry.path,
                    'data-workspace': entry.path,
                    onClick: function () {
                      if (typeof props.onSelectWorkspace === 'function') props.onSelectWorkspace(entry.path);
                    },
                  },
                  h(S.Icons.Git, { size: 12 }),
                  typeof entry.title === 'string' && entry.title.length > 0 ? entry.title : S.baseName(entry.path),
                );
              }),
            ),
          )
        : h('p', { style: ST_GIT.notRepoHint }, t('git.notRepo.body')),
    ),
  );
}

/** The right-hand diff pane. */
function GitDiffPane(props) {
  const t = props.t;
  const selection = props.selection;
  const diff = props.diff;
  let body = null;
  if (selection === null || selection === undefined) {
    body = h(S.EmptyState, {
      t: t,
      icon: S.Icons.Git,
      title: props.view === 'history' ? t('git.diff.selectCommit') : t('git.diff.select'),
    });
  } else if (diff.status === 'loading') {
    body = h(S.LoadingIndicator, { t: t, label: t('git.diff.loading') });
  } else if (diff.status === 'error') {
    body = h(S.InlineError, {
      t: t,
      title: t('git.diff.error.title'),
      message: S.errorText(diff.error),
      onRetry: props.onRetry,
    });
  } else if (diff.status === 'loaded') {
    body = h(DiffView, { t: t, diff: diff.payload !== null && diff.payload !== undefined ? diff.payload.diff : '', truncated: diff.payload !== null && diff.payload !== undefined && diff.payload.truncated === true });
  }
  return h(
    'div',
    { style: ST_GIT.diffPane },
    h(GitDiffHeader, { t: t, selection: selection }),
    body,
  );
}

/** Segmented Changes / History switch. */
function GitSwitch(props) {
  const [hover, setHover] = useState(null);
  const options = [
    { id: 'changes', label: props.t('git.changes') },
    { id: 'history', label: props.t('git.history') },
  ];
  return h(
    'div',
    { style: ST_GIT.segmented, role: 'tablist' },
    options.map(function (option) {
      const active = props.value === option.id;
      return h(
        'button',
        {
          key: option.id,
          type: 'button',
          role: 'tab',
          'aria-selected': active ? 'true' : 'false',
          'data-git-tab': option.id,
          style: Object.assign({}, ST_GIT.segment, active ? ST_GIT.segmentActive : hover === option.id ? ST_GIT.segmentHover : null),
          onClick: function () { props.onChange(option.id); },
          onMouseEnter: function () { setHover(option.id); },
          onMouseLeave: function () { setHover(null); },
        },
        option.label,
      );
    }),
  );
}

/** Header: branch + ahead/behind + summary + view switch + refresh. */
function GitHeader(props) {
  const t = props.t;
  const status = props.status;
  const repo = status !== null && status !== undefined && status.repo === true;
  const clean = repo && status.clean === true;
  const ahead = repo && Number.isFinite(status.ahead) ? status.ahead : 0;
  const behind = repo && Number.isFinite(status.behind) ? status.behind : 0;
  const total = Number.isFinite(props.totalChanges) ? props.totalChanges : 0;
  return h(
    'div',
    { style: ST_GIT.header },
    h('span', { style: ST_GIT.branchGlyph }, h(S.Icons.Git, { size: 15 })),
    repo
      ? h('span', { style: ST_GIT.branchText, title: t('git.branch', { branch: typeof status.branch === 'string' && status.branch.length > 0 ? status.branch : '—' }) }, typeof status.branch === 'string' && status.branch.length > 0 ? status.branch : '—')
      : h('span', { style: ST_GIT.meta }, t('tabs.git')),
    ahead > 0 ? h('span', { style: ST_GIT.ahead, title: t('git.aheadHint', { count: ahead }) }, '↑' + String(ahead)) : null,
    behind > 0 ? h('span', { style: ST_GIT.behind, title: t('git.behindHint', { count: behind }) }, '↓' + String(behind)) : null,
    repo && typeof status.upstream === 'string' && status.upstream.length > 0
      ? h('span', { style: ST_GIT.meta, title: t('git.upstream', { branch: status.upstream }) }, status.upstream)
      : null,
    h('span', { style: ST_GIT.spacer }),
    repo
      ? h('span', { style: clean ? ST_GIT.summaryClean : ST_GIT.summaryDirty }, clean ? t('git.clean') : t('git.counts', { count: total }))
      : null,
    repo
      ? h(GitSwitch, { t: t, value: props.view, onChange: props.onChangeView })
      : null,
    h(S.ToolButton, { title: t('git.refresh'), ariaLabel: t('git.refresh'), onClick: props.onRefresh }, h(S.Icons.Refresh, { size: 16 })),
  );
}

/**
 * The Git tab.
 * @param {{t: Function, root: string, reloadToken?: number, onOpenFile?: Function}} props - slot props.
 */
function GitView(props) {
  const fallbackT = S.useT();
  const t = props !== null && props !== undefined && typeof props.t === 'function' ? props.t : fallbackT;
  const root = props.root;

  const [status, setStatus] = useState(null);
  const [log, setLog] = useState(null);
  const [load, setLoad] = useState({ status: 'loading', error: null });
  const [view, setView] = useState('changes');
  const [selection, setSelection] = useState(null);
  const [diff, setDiff] = useState({ status: 'idle', payload: null, error: null });
  const [version, setVersion] = useState(0);

  const diffRequestRef = useRef(0);
  const lastDiffRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(function () {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    abortRef.current = controller;
    const signal = controller === null ? undefined : controller.signal;
    let cancelled = false;
    setLoad({ status: 'loading', error: null });
    setStatus(null);
    setLog(null);
    setSelection(null);
    setDiff({ status: 'idle', payload: null, error: null });
    Promise.all([
      S.requestJson(S.apiUrl(ROUTES.git, { root: root, kind: 'status' }), { signal: signal }),
      S.requestJson(S.apiUrl(ROUTES.git, { root: root, kind: 'log', limit: 30 }), { signal: signal }),
    ])
      .then(function (results) {
        if (cancelled) return;
        setStatus(results[0]);
        setLog(results[1]);
        setLoad({ status: 'loaded', error: null });
      })
      .catch(function (cause) {
        if (cancelled) return;
        if (cause !== null && cause !== undefined && cause.name === 'AbortError') return;
        setLoad({ status: 'error', error: cause });
      });
    return function () {
      cancelled = true;
      if (controller !== null && controller !== undefined) {
        try {
          controller.abort();
        } catch (error) {
          /* already settled */
        }
      }
    };
  }, [root, props.reloadToken, version]);

  const loadDiff = useCallback(function (params, nextSelection) {
    const requestId = diffRequestRef.current + 1;
    diffRequestRef.current = requestId;
    lastDiffRef.current = { params: params, selection: nextSelection };
    setSelection(nextSelection);
    setDiff({ status: 'loading', payload: null, error: null });
    S.requestJson(S.apiUrl(ROUTES.git, Object.assign({ root: root, kind: 'diff' }, params)))
      .then(function (payload) {
        if (diffRequestRef.current !== requestId) return;
        setDiff({ status: 'loaded', payload: payload, error: null });
      })
      .catch(function (cause) {
        if (diffRequestRef.current !== requestId) return;
        if (cause !== null && cause !== undefined && cause.name === 'AbortError') return;
        setDiff({ status: 'error', payload: null, error: cause });
      });
  }, [root]);

  const retryDiff = useCallback(function () {
    const last = lastDiffRef.current;
    if (last === null || last === undefined) return;
    loadDiff(last.params, last.selection);
  }, [loadDiff]);

  const selectChange = useCallback(function (change) {
    const params = { path: change.path };
    if (change.staged === true) params.staged = '1';
    loadDiff(params, { kind: 'change', change: change });
  }, [loadDiff]);

  const selectCommit = useCallback(function (commit) {
    loadDiff({ commit: commit.hash }, { kind: 'commit', commit: commit });
  }, [loadDiff]);

  const refresh = useCallback(function () {
    setVersion(function (value) { return value + 1; });
  }, []);

  const groups = useMemo(function () {
    return groupChanges(status !== null && status !== undefined && Array.isArray(status.files) ? status.files : []);
  }, [status]);

  const totalChanges = groups.staged.length + groups.unstaged.length + groups.untracked.length + groups.conflicted.length;
  const repo = status !== null && status !== undefined && status.repo === true;
  const commits = log !== null && log !== undefined && Array.isArray(log.commits) ? log.commits : [];

  let content = null;
  if (load.status === 'loading') {
    content = h(S.LoadingIndicator, { t: t, label: t('git.loading') });
  } else if (load.status === 'error') {
    content = h(S.InlineError, { t: t, title: t('git.error.title'), message: S.errorText(load.error), onRetry: refresh });
  } else if (!repo) {
    content = h(GitNotRepoState, {
      t: t,
      root: root,
      workspaces: props.workspaces,
      onSelectWorkspace: props.onSelectWorkspace,
      onRetry: refresh,
    });
  } else {
    const left =
      view === 'history'
        ? h(GitHistoryList, { t: t, commits: commits, selection: selection, onSelect: selectCommit })
        : h(GitChangesList, { t: t, groups: groups, selection: selection, onSelect: selectChange });
    content = h(S.SplitPane, {
      left: h('div', { style: ST_GIT.listPane }, left),
      right: h(GitDiffPane, { t: t, view: view, selection: selection, diff: diff, onRetry: retryDiff }),
      storageKey: 'dsh-workspace-ide:git-list-width',
      initialWidth: 320,
      minWidth: SPLIT_MIN,
      maxWidth: SPLIT_MAX,
      handleLabel: t('git.changes'),
    });
  }

  return h(
    'div',
    { style: ST_GIT.root },
    h(GitHeader, {
      t: t,
      status: status,
      view: view,
      totalChanges: totalChanges,
      onChangeView: function (next) { if (next === 'changes' || next === 'history') setView(next); },
      onRefresh: refresh,
    }),
    h('div', { style: ST_GIT.body }, content),
  );
}

S.GitView = GitView;
S.GitNotRepoState = GitNotRepoState;
S.GitHeader = GitHeader;
S.GitChangesList = GitChangesList;
S.GitHistoryList = GitHistoryList;
S.GitChangeGroup = GitChangeGroup;
S.GitChangeRow = GitChangeRow;
S.GitCommitRow = GitCommitRow;
S.GitDiffPane = GitDiffPane;
S.GitSwitch = GitSwitch;
S.DiffView = DiffView;
S.parseDiffLines = parseDiffLines;
S.classifyDiffLine = classifyDiffLine;
S.groupChanges = groupChanges;
S.ST_GIT = ST_GIT;
