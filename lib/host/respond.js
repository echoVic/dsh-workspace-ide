/**
 * Common HTTP behavior for the workspace-ide Host routes.
 *
 * Every route answers with JSON: `{"ok":true, ...}` or
 * `{"ok":false,"error":{"code":"...","message":"..."}}`, always carrying
 * `cache-control: no-store`. Known failures travel as {@link HttpError}s; the
 * route guard in `routes.js` turns those into their contracted status codes and
 * anything unexpected into a 500 `internal` response, so a handler can never
 * throw into the connection service.
 *
 * Node built-ins only; this package must stay import-free apart from relative
 * modules (no `@deepseek-ai/*` specifier resolves for a linked plugin).
 *
 * @module dsh-workspace-ide/host/respond
 */

/** Headers every route response carries. */
const JSON_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
});

/** Status codes this package uses. */
export const STATUS = Object.freeze({
  ok: 200,
  badRequest: 400,
  outsideWorkspace: 403,
  notFound: 404,
  payloadTooLarge: 413,
  unsupportedMedia: 415,
  internal: 500,
});

/** JSON error codes this package uses. */
export const CODE = Object.freeze({
  badRequest: 'bad-request',
  notFound: 'not-found',
  outsideWorkspace: 'outside-workspace',
  internal: 'internal',
  gitFailed: 'git-failed',
  tooLarge: 'too-large',
  unsupportedImage: 'unsupported-image',
});

/** A failure carrying the HTTP status and JSON error code a route should answer with. */
export class HttpError extends Error {
  /**
   * @param {number} status - HTTP status code.
   * @param {string} code - stable JSON error code.
   * @param {string} message - human readable detail.
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Build a 400 `bad-request` failure.
 * @param {string} message - human readable detail.
 * @returns the throwable failure.
 */
export function badRequest(message) {
  return new HttpError(STATUS.badRequest, CODE.badRequest, message);
}

/**
 * Build a 404 `not-found` failure.
 * @param {string} message - human readable detail.
 * @returns the throwable failure.
 */
export function notFound(message) {
  return new HttpError(STATUS.notFound, CODE.notFound, message);
}

/**
 * Build a 403 `outside-workspace` failure.
 * @param {string} message - human readable detail.
 * @returns the throwable failure.
 */
export function outsideWorkspace(message) {
  return new HttpError(STATUS.outsideWorkspace, CODE.outsideWorkspace, message);
}

/**
 * A readable one-line message from an arbitrary thrown value.
 * @param {unknown} error - thrown value.
 * @returns one line, never empty.
 */
export function describeError(error) {
  const failure = /** @type {any} */ (error);
  if (failure !== null && failure !== undefined && typeof failure === 'object') {
    if (typeof failure.message === 'string' && failure.message.length > 0) return failure.message;
    if (typeof failure.code === 'string' && failure.code.length > 0) return failure.code;
  }
  try {
    const text = String(error);
    return text.length > 0 ? text : 'unknown error';
  } catch {
    return 'unknown error';
  }
}

/**
 * Serialize one JSON body with the mandatory no-store header.
 * @param {number} status - HTTP status code.
 * @param {unknown} body - JSON-serializable body.
 * @returns the HTTP response.
 */
export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Build the contracted success envelope.
 * @param fields - additional payload fields.
 * @returns the HTTP response.
 */
export function okResponse(fields = {}) {
  return jsonResponse(STATUS.ok, { ok: true, ...fields });
}

/**
 * Build an explicit `{"ok":false,"error":{...}}` response at a chosen status.
 * Used for `git-failed`, which the contract carries as a 200 JSON envelope.
 * @param {number} status - HTTP status code.
 * @param {string} code - stable JSON error code.
 * @param {string} message - human readable detail.
 * @returns the HTTP response.
 */
export function failResponse(status, code, message) {
  return jsonResponse(status, { ok: false, error: { code, message } });
}

/**
 * Convert a thrown value into its contracted JSON error response.
 * @param {unknown} error - thrown value; anything not an HttpError becomes 500 internal.
 * @returns the HTTP response.
 */
export function errorResponse(error) {
  const failure = error instanceof HttpError
    ? error
    : new HttpError(STATUS.internal, CODE.internal, describeError(error));
  return failResponse(failure.status, failure.code, failure.message);
}

/**
 * Read a boolean query flag (`1`/`0`, also `true`/`false`).
 * @param {URLSearchParams} params - request query parameters.
 * @param {string} name - parameter name.
 * @param {any} fallback - value used when the parameter is absent or unrecognized.
 * @returns the parsed flag.
 */
export function queryFlag(params, name, fallback = false) {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const value = raw.trim().toLowerCase();
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return fallback;
}

/**
 * Read an integer query parameter, clamped into bounds; invalid input keeps the
 * fallback so a malformed tuning knob never fails a read-only request.
 * @param {URLSearchParams} params - request query parameters.
 * @param {string} name - parameter name.
 * @param {any} fallback - value used when absent or unparsable.
 * @param {{min?: number, max?: number}} bounds - optional `{ min, max }` clamp.
 * @returns the parsed integer.
 */
export function queryInt(params, name, fallback, bounds = {}) {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  const min = typeof bounds.min === 'number' ? bounds.min : Number.NEGATIVE_INFINITY;
  const max = typeof bounds.max === 'number' ? bounds.max : Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Buffer a JSON object request body with a byte cap.
 * @param {Request} request - incoming WHATWG request.
 * @param {number} maxBytes - maximum buffered body size in bytes.
 * @returns {Promise<any>} the parsed JSON object.
 */
export async function readJsonBody(request, maxBytes) {
  let text;
  try {
    text = await request.text();
  } catch (error) {
    throw badRequest(`request body could not be read: ${describeError(error)}`);
  }
  if (Number.isFinite(maxBytes) && maxBytes > 0 && Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw badRequest(`request body exceeds the ${maxBytes} byte limit`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest('request body must be valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw badRequest('request body must be a JSON object');
  }
  return parsed;
}
