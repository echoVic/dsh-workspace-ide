/**
 * `GET /api/dsh-workspace-ide.workspaces` — the workspace picker projection.
 *
 * Source of truth is the optional `workspaceRegistry` service. Each registry
 * entity is flattened to the contracted shape, plus:
 *
 * - `live`: true when any of the workspace's sessions is currently in the live
 *   `sessions` store;
 * - `git`: true when `<path>/.git` exists (a directory or a linked-worktree
 *   file). A missing or unreadable marker is `false`, never thrown.
 *
 * Both services are looked up defensively; missing services degrade to an empty
 * list / `false` instead of failing the route.
 *
 * @module dsh-workspace-ide/host/workspaces
 */

import { lstat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';

import { okResponse } from './respond.js';
import { optionalService } from './paths.js';

/**
 * Collect the ids of every live session, defensively.
 * @param {HostContext} ctx - Host plugin context.
 * @returns the set of live session ids (empty when the service is absent/broken).
 */
function liveSessionIds(ctx) {
  const ids = new Set();
  const sessions = optionalService(ctx, 'sessions');
  if (sessions === undefined || sessions === null || typeof sessions.list !== 'function') return ids;
  let listed;
  try {
    listed = sessions.list();
  } catch {
    return ids;
  }
  if (!Array.isArray(listed)) return ids;
  for (const session of listed) {
    if (session === null || typeof session !== 'object') continue;
    const id = typeof session.id === 'string'
      ? session.id
      : (session.header !== null && session.header !== undefined && typeof session.header.id === 'string' ? session.header.id : undefined);
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

/**
 * Whether the workspace directory carries a `.git` marker (directory or
 * linked-worktree file). Statistics failures are a plain `false`.
 * @param workspacePath - absolute workspace directory.
 * @returns true when `<path>/.git` exists.
 */
async function hasGitMarker(workspacePath) {
  if (typeof workspacePath !== 'string' || workspacePath === '' || !isAbsolute(workspacePath)) return false;
  try {
    await lstat(join(workspacePath, '.git'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Flatten one registry workspace entity into the route payload.
 * @param workspace - registry entity.
 * @param liveIds - set of live session ids.
 * @returns the projection, or null for a malformed entity.
 */
async function projectWorkspace(workspace, liveIds) {
  if (workspace === null || typeof workspace !== 'object') return null;
  const workspacePath = typeof workspace.path === 'string' ? workspace.path : '';
  const id = workspace.id !== undefined && workspace.id !== null ? String(workspace.id) : workspacePath;
  const title = typeof workspace.title === 'string' && workspace.title.length > 0
    ? workspace.title
    : (workspacePath === '' ? '' : basename(workspacePath));
  const sessionIds = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [];
  const live = sessionIds.some((sessionId) => liveIds.has(String(sessionId)));
  return {
    id,
    path: workspacePath,
    title,
    sessionCount: sessionIds.length,
    live,
    git: await hasGitMarker(workspacePath),
  };
}

/**
 * Handle the workspaces route.
 * @param {HostContext} ctx - Host plugin context.
 * @returns the HTTP response.
 */
export async function handleWorkspaces(ctx) {
  const registry = optionalService(ctx, 'workspaceRegistry');
  let workspaces = [];
  if (registry !== undefined && registry !== null && typeof registry.list === 'function') {
    let listed;
    try {
      listed = registry.list();
    } catch {
      listed = [];
    }
    if (Array.isArray(listed)) {
      const liveIds = liveSessionIds(ctx);
      const projected = await Promise.all(listed.map((workspace) => projectWorkspace(workspace, liveIds)));
      workspaces = projected.filter((workspace) => workspace !== null);
    }
  }
  return okResponse({ workspaces });
}
