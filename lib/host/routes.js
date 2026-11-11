/**
 * Route table + registration for the workspace-ide Host half.
 *
 * All eight routes are exact Fetch routes registered on the `connection`
 * service inside `ctx.effect(...)`, so they are disposed with the plugin fiber
 * and ride the browser authentication fence. Each handler is wrapped in a guard
 * that converts failures into contracted JSON responses; a handler can never
 * throw into the connection service.
 *
 * @module dsh-workspace-ide/host/routes
 */

import { handleFile, handleSave } from './file.js';
import { handleImage } from './image.js';
import { handleGit } from './git.js';
import { describeError, errorResponse, failResponse, HttpError } from './respond.js';
import { handleSearch } from './search.js';
import { handlePing } from './status.js';
import { handleList } from './tree.js';
import { handleWorkspaces } from './workspaces.js';

/** Every route path starts with this prefix. */
export const ROUTE_PREFIX = '/api/dsh-workspace-ide.';

/**
 * The contracted route table. Handler signatures are uniform `(ctx, request)`
 * even when a route ignores the request.
 */
export const ROUTE_DEFINITIONS = Object.freeze([
  Object.freeze({ name: 'workspaces', path: `${ROUTE_PREFIX}workspaces`, methods: Object.freeze(['GET']), handler: (ctx) => handleWorkspaces(ctx) }),
  Object.freeze({ name: 'list', path: `${ROUTE_PREFIX}list`, methods: Object.freeze(['GET']), handler: handleList }),
  Object.freeze({ name: 'file', path: `${ROUTE_PREFIX}file`, methods: Object.freeze(['GET']), handler: handleFile }),
  Object.freeze({ name: 'image', path: `${ROUTE_PREFIX}image`, methods: Object.freeze(['GET']), handler: handleImage }),
  Object.freeze({ name: 'search', path: `${ROUTE_PREFIX}search`, methods: Object.freeze(['GET']), handler: handleSearch }),
  Object.freeze({ name: 'git', path: `${ROUTE_PREFIX}git`, methods: Object.freeze(['GET']), handler: handleGit }),
  Object.freeze({ name: 'save', path: `${ROUTE_PREFIX}save`, methods: Object.freeze(['POST']), handler: handleSave }),
  Object.freeze({ name: 'ping', path: `${ROUTE_PREFIX}ping`, methods: Object.freeze(['POST']), handler: handlePing }),
]);

/**
 * Log a diagnostics line without ever letting diagnostics throw.
 * @param {HostContext} ctx - Host plugin context.
 * @param path - route path.
 * @param error - thrown value.
 */
function logFailure(ctx, path, error) {
  try {
    const logger = ctx !== null && typeof ctx === 'object' ? ctx.logger : undefined;
    if (logger !== null && logger !== undefined && typeof logger.warn === 'function') {
      logger.warn(`[dsh-workspace-ide] ${path} failed: ${describeError(error)}`);
    }
  } catch {
    // Diagnostics must never affect a request.
  }
}

/**
 * Wrap one definition into the exact route descriptor `connection.fetch.register` expects.
 * @param {HostContext} ctx - Host plugin context.
 * @param definition - table row.
 * @returns the Fetch route descriptor.
 */
function createRoute(ctx, definition) {
  return Object.freeze({
    name: definition.name,
    path: definition.path,
    methods: [...definition.methods],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        const response = await definition.handler(ctx, request);
        if (response instanceof Response) return response;
        return failResponse(500, 'internal', `${definition.name} handler produced no response`);
      } catch (error) {
        if (!(error instanceof HttpError)) logFailure(ctx, definition.path, error);
        return errorResponse(error);
      }
    },
  });
}

/**
 * Build every route descriptor for one plugin activation.
 * @param {HostContext} ctx - Host plugin context.
 * @returns the route descriptors.
 */
export function createRoutes(ctx) {
  return ROUTE_DEFINITIONS.map((definition) => createRoute(ctx, definition));
}

/**
 * Register every route on the `connection` Fetch service, inside `ctx.effect`.
 * A composition without that service simply registers nothing; registration
 * errors are logged instead of aborting activation.
 *
 * @param {HostContext} ctx - Host plugin context.
 */
export function registerRoutes(ctx) {
  if (ctx === null || typeof ctx !== 'object') return;
  const connection = ctx.connection;
  const fetchService = connection !== null && typeof connection === 'object' ? connection.fetch : undefined;
  const registerRoute = fetchService !== null && fetchService !== undefined ? fetchService.register : undefined;
  if (typeof registerRoute !== 'function') return;
  const effectCallback = ctx.effect;
  const effect = typeof effectCallback === 'function' ? (callback, label) => effectCallback(callback, label) : null;
  for (const route of createRoutes(ctx)) {
    const register = () => registerRoute({
      path: route.path,
      methods: [...route.methods],
      requestBody: route.requestBody,
      fetch: route.fetch,
    });
    try {
      if (effect !== null) effect(register, `dsh-workspace-ide: ${route.path}`);
      else register();
    } catch (error) {
      logFailure(ctx, route.path, error);
    }
  }
}
