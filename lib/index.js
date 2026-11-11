/**
 * dsh-workspace-ide — Host half.
 *
 * Registers the seven `/api/dsh-workspace-ide.*` exact Fetch routes (workspaces,
 * list, file, search, git, save, ping) on the `connection` service. Every route
 * is owned by the plugin fiber and answers JSON with `cache-control: no-store`;
 * no handler ever throws.
 *
 * The browser half lives in `lib/client.js`; the implementation contract is
 * `CONTRACT.md`.
 *
 * @module dsh-workspace-ide
 */

import { registerRoutes } from './host/routes.js';

/**
 * Host plugin body: register the workspace-ide Fetch routes.
 * A composition without the connection service degrades to a no-op instead of
 * failing activation.
 *
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  try {
    registerRoutes(ctx);
  } catch {
    // A missing service must degrade, never throw at apply time.
  }
}

/** Services this plugin waits for before `apply` runs. */
export const inject = ['connection'];

/** Stable plugin name (also the client module id and panel id). */
export const name = 'workspace-ide';
