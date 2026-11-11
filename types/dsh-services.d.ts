/**
 * Minimal, local contracts for the DSH Host services this plugin reads.
 *
 * A linked plugin outside the profile cannot import `@deepseek-ai/*` types
 * (that is also forbidden by CONTRACT.md), so the shapes we depend on are
 * declared here. They are a subset: the plugin only ever calls `ctx.get()`
 * defensively and treats every service as optional.
 */

/** A validated workspace root: requested + canonical path. */
type WorkspaceRoot = { requestedRoot: string, realRoot: string };

/** A service exposing the two list-like shapes the plugin reads. */
interface HostListService {
  list(): Array<Record<string, any>> | null | undefined;
}

/** One Fetch route descriptor registered on `connection.fetch`. */
interface HostFetchRoute {
  path: string;
  methods: string[];
  requestBody?: string;
  fetch(request: Request): Response | Promise<Response>;
}

/** The connection service subset used to register routes. */
interface HostConnection {
  fetch?: { register?(route: HostFetchRoute): unknown };
}

/** Logger subset (all methods are optional). */
interface HostLogger {
  info?(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

/** The Cordis plugin context subset the Host half touches. Every member is
 * optional: the plugin degrades gracefully and tests construct partial contexts. */
interface HostContext {
  get?(name: string): any;
  effect?(callback: () => (() => void) | void, label?: string): unknown;
  connection?: HostConnection | null;
  logger?: HostLogger | null;
}

/** One entry in the plugin route table. */
interface RouteDefinition {
  name: string;
  path: string;
  methods: ReadonlyArray<string>;
  handler: Function;
}
