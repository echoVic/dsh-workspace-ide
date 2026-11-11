/**
 * Shared helpers for the workspace-ide Host tests.
 *
 * Not a test file itself: it only builds fake Host contexts and calls the
 * registered Fetch routes directly, so no DSH app boots and nothing outside
 * `os.tmpdir()` is touched.
 *
 * @module dsh-workspace-ide/test/host/support
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRoutes } from '../../lib/host/routes.js';

/** Base URL every fake route request uses (path only matters to URL parsing). */
const BASE_URL = 'http://localhost';

/**
 * Build every route against a fake Host context.
 * @param services - service map returned by `ctx.get(name)`.
 * @returns the route descriptors.
 */
export function makeApp(services = {}) {
  return createRoutes({
    get(name) {
      return services[name];
    },
  });
}

/**
 * Call one route and decode its JSON body.
 * @param app - routes from {@link makeApp}.
 * @param name - route name.
 * @param query - query string including the leading `?` (or "").
 * @param init - fetch init (for POST bodies).
 * @returns `{ response, status, body }`.
 */
export async function call(app, name, query = '', init = undefined) {
  const route = app.find((entry) => entry.name === name);
  if (route === undefined) throw new Error(`no such route: ${name}`);
  const response = await route.fetch(new Request(`${BASE_URL}/api/dsh-workspace-ide.${name}${query}`, init));
  const body = await response.json();
  return { response, status: response.status, body };
}

/**
 * Call a POST route with a JSON body.
 * @param app - routes from {@link makeApp}.
 * @param name - route name.
 * @param payload - JSON-serializable body.
 * @returns `{ response, status, body }`.
 */
export async function postJson(app, name, payload) {
  return call(app, name, '', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * Create a canonical temporary directory that is removed after the test.
 * @param t - node:test TestContext.
 * @param prefix - directory name prefix.
 * @returns the canonical absolute directory path.
 */
export function temporaryDirectory(t, prefix = 'wsi-test-') {
  const directory = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** URL-encode a query value. */
export const encode = encodeURIComponent;
