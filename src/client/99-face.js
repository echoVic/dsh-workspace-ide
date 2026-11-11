/**
 * dsh-workspace-ide — client half, module face.
 *
 * The browser runtime boots this file, which registers one factory with the
 * module loader; the returned plugin object is installed into the Client
 * cordis context. `inject: ['slots']` parks the plugin until the slot service
 * exists; the optional `locale` service is read defensively, so the panel still
 * renders with its built-in dictionary when that seat is absent.
 *
 * Two registrations bind the halves together, and their id/key are the same
 * string (`workspace-ide`), which is what makes clicking the rail icon switch
 * the central `main` slot to this panel.
 */

S.face = {
  inject: ['slots'],
  apply: function apply(ctx) {
    const fallbackT = function (key, params) {
      return translateText(localePref(), key, params);
    };
    let t = fallbackT;
    let localeOption = {};

    try {
      const locale = ctx !== null && ctx !== undefined && typeof ctx.get === 'function' ? ctx.get('locale') : null;
      if (locale !== null && locale !== undefined && typeof locale.register === 'function') {
        const dispose = locale.register(NS, S.I18N);
        if (typeof ctx.effect === 'function') {
          ctx.effect(function () { return dispose; }, 'dsh-workspace-ide: dictionaries');
        }
        if (typeof locale.bind === 'function') {
          const bound = locale.bind(NS);
          if (typeof bound === 'function') t = bound;
        }
        localeOption = { locale: NS };
      }
    } catch (error) {
      /* the locale service is optional: keep the built-in dictionary */
    }

    S.ping('apply');

    ctx.slots.inject('sidebar.panellist', function () {
      return ctx.slots.register(
        Object.assign(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 15,
            label: function () { return t('panel'); },
          },
          localeOption,
        ),
        S.Icons.PanelIcon,
      );
    });

    /**
     * Panel body when the slot exposes the Client workspace store: resolve the
     * workspace that owns the session the app is currently viewing, so opening
     * the panel lands on the user's own workspace instead of registry order.
     */
    function PanelWithWorkspaces(props) {
      const snapshot = props.useWorkspaces(function (value) { return value; });
      const sessionId = S.getCurrentSessionId();
      const preferredRoot = S.preferredWorkspaceRoot(snapshot, sessionId);
      const translator = typeof props.t === 'function' ? props.t : t;
      return h(S.PanelBoundary, { t: translator }, h(S.Shell, { t: translator, preferredRoot: preferredRoot }));
    }

    /** Panel body fallback: no workspace hook in the slot kit. */
    function PanelPlain(props) {
      const translator = typeof props.t === 'function' ? props.t : t;
      return h(S.PanelBoundary, { t: translator }, h(S.Shell, { t: translator }));
    }

    ctx.slots.inject('main', function () {
      return ctx.slots.register(
        Object.assign({ name: 'main', key: PANEL_ID }, localeOption),
        function WorkspaceIdePanel(props) {
          const translator = props !== null && props !== undefined && typeof props.t === 'function' ? props.t : t;
          const bound = props !== null && props !== undefined && typeof props.useWorkspaces === 'function'
            ? h(PanelWithWorkspaces, { t: translator, useWorkspaces: props.useWorkspaces })
            : h(PanelPlain, { t: translator });
          return h(S.PanelBoundary, { t: translator }, bound);
        },
      );
    });
  },

  /**
   * Smoke-test seam only: exposes the pieces the plain-Node test renders
   * directly (with a fake React). Not part of the runtime contract.
   * @returns {object} internal components/helpers.
   */
  __test: function __test() {
    return {
      Shell: S.Shell,
      ShellToolbar: S.ShellToolbar,
      PanelBoundary: S.PanelBoundary,
      Icons: S.Icons,
      TABS: S.TABS,
      I18N: S.I18N,
      C: S.C,
      SYN: S.SYN,
      FONT_UI: S.FONT_UI,
      FONT_MONO: S.FONT_MONO,
      themeVars: S.themeVars,
      HIGHLIGHT_LANGUAGES: S.HIGHLIGHT_LANGUAGES,
      HIGHLIGHT_KINDS: S.HIGHLIGHT_KINDS,
      MAX_HIGHLIGHT_CHARS: S.MAX_HIGHLIGHT_CHARS,
      normalizeHighlightLanguage: S.normalizeHighlightLanguage,
      highlightLines: S.highlightLines,
      highlightColor: S.highlightColor,
      toggleLineComments: S.toggleLineComments,
      commentTokens: S.commentTokens,
      COMMENT_LANGUAGES: S.COMMENT_LANGUAGES,
      ST: { core: S.ST_CORE, shell: S.ST_SHELL, files: S.ST_FILES, search: S.ST_SEARCH, git: S.ST_GIT },
      ToolButton: S.ToolButton,
      PrimaryButton: S.PrimaryButton,
      GhostButton: S.GhostButton,
      Chip: S.Chip,
      LoadingIndicator: S.LoadingIndicator,
      SearchField: S.SearchField,
      SearchFileGroup: S.SearchFileGroup,
      SearchHitRow: S.SearchHitRow,
      GitHeader: S.GitHeader,
      GitDiffPane: S.GitDiffPane,
      GitSwitch: S.GitSwitch,
      GitChangeGroup: S.GitChangeGroup,
      GitChangeRow: S.GitChangeRow,
      GitCommitRow: S.GitCommitRow,
      FilesView: S.FilesView,
      FileViewer: S.FileViewer,
      FileTreeRow: S.FileTreeRow,
      SearchView: S.SearchView,
      SearchResults: S.SearchResults,
      GitView: S.GitView,
      GitNotRepoState: S.GitNotRepoState,
      GitChangesList: S.GitChangesList,
      GitHistoryList: S.GitHistoryList,
      DiffView: S.DiffView,
      SplitPane: S.SplitPane,
      EmptyState: S.EmptyState,
      InlineError: S.InlineError,
      NoticeBar: S.NoticeBar,
      parseDiffLines: S.parseDiffLines,
      classifyDiffLine: S.classifyDiffLine,
      groupChanges: S.groupChanges,
      splitMatch: S.splitMatch,
      normalizeWorkspaces: S.normalizeWorkspaces,
      pickRoot: S.pickRoot,
      getCurrentSessionId: S.getCurrentSessionId,
      preferredWorkspaceRoot: S.preferredWorkspaceRoot,
      formatBytes: S.formatBytes,
      countLines: S.countLines,
      lineNumbersText: S.lineNumbersText,
      caretFromIndex: S.caretFromIndex,
      Routes: S.Routes,
    };
  },
};
