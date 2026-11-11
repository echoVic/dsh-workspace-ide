/**
 * Unit tests for the shared HTTP behavior helpers: response envelopes, status
 * codes, query flag/int parsing and JSON body buffering.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CODE,
  HttpError,
  STATUS,
  badRequest,
  describeError,
  errorResponse,
  failResponse,
  jsonResponse,
  notFound,
  okResponse,
  outsideWorkspace,
  queryFlag,
  queryInt,
  readJsonBody,
} from '../../lib/host/respond.js';

/**
 * Build URLSearchParams from a plain object.
 * @param values - query values.
 * @returns the parameters.
 */
function paramsOf(values) {
  return new URLSearchParams(values);
}

describe('respond envelopes', () => {
  it('wraps ok payloads with the success envelope and no-store header', async () => {
    const response = okResponse({ value: 1 });
    assert.equal(response.status, STATUS.ok);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.deepEqual(await response.json(), { ok: true, value: 1 });
  });

  it('renders failure envelopes with the contracted error shape', async () => {
    const response = failResponse(STATUS.badRequest, CODE.badRequest, 'nope');
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { ok: false, error: { code: 'bad-request', message: 'nope' } });
  });

  it('maps known HttpErrors onto their status and code', async () => {
    assert.deepEqual((await errorResponse(badRequest('a')).json()).error, { code: 'bad-request', message: 'a' });
    assert.equal(errorResponse(badRequest('a')).status, 400);
    assert.equal(errorResponse(notFound('b')).status, 404);
    assert.equal(errorResponse(outsideWorkspace('c')).status, 403);
    const missing = await errorResponse(outsideWorkspace('c')).json();
    assert.equal(missing.error.code, 'outside-workspace');
  });

  it('turns unexpected throwables into 500 internal responses', async () => {
    const response = errorResponse(new Error('boom'));
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { ok: false, error: { code: 'internal', message: 'boom' } });
    assert.equal(errorResponse('string failure').status, 500);
    assert.equal(errorResponse(null).status, 500);
  });

  it('describes arbitrary thrown values', () => {
    assert.equal(describeError(new Error('x')), 'x');
    assert.equal(describeError({ code: 'EACCES' }), 'EACCES');
    assert.equal(describeError('plain'), 'plain');
    assert.equal(describeError(undefined).length > 0, true);
  });

  it('jsonResponse carries the given status', () => {
    assert.equal(jsonResponse(418, { ok: false }).status, 418);
    const custom = new HttpError(404, 'not-found', 'x');
    assert.equal(custom.name, 'HttpError');
    assert.equal(custom.status, 404);
  });
});

describe('query parsing', () => {
  it('parses 1/0 and true/false flags', () => {
    assert.equal(queryFlag(paramsOf({ x: '1' }), 'x', false), true);
    assert.equal(queryFlag(paramsOf({ x: 'true' }), 'x', false), true);
    assert.equal(queryFlag(paramsOf({ x: '0' }), 'x', true), false);
    assert.equal(queryFlag(paramsOf({ x: 'false' }), 'x', true), false);
    assert.equal(queryFlag(paramsOf({}), 'x', true), true);
    assert.equal(queryFlag(paramsOf({ x: 'maybe' }), 'x', true), true);
  });

  it('parses and clamps integers', () => {
    assert.equal(queryInt(paramsOf({ n: '7' }), 'n', 3), 7);
    assert.equal(queryInt(paramsOf({ n: '0' }), 'n', 3, { min: 1 }), 1);
    assert.equal(queryInt(paramsOf({ n: '999' }), 'n', 3, { max: 100 }), 100);
    assert.equal(queryInt(paramsOf({ n: 'abc' }), 'n', 3), 3);
    assert.equal(queryInt(paramsOf({}), 'n', 4), 4);
  });
});

describe('readJsonBody', () => {
  /**
   * Build a POST request with the given raw body.
   * @param body - raw body text.
   * @returns the request.
   */
  function withBody(body) {
    return new Request('http://localhost/api/test', { method: 'POST', body });
  }

  it('buffers a JSON object', async () => {
    const parsed = await readJsonBody(withBody('{"a":1}'), 1024);
    assert.deepEqual(parsed, { a: 1 });
  });

  it('rejects non-JSON bodies with bad-request', async () => {
    await assert.rejects(readJsonBody(withBody('not json'), 1024), (error) => {
      const failure = /** @type {any} */ (error);
      assert.equal(failure.status, 400);
      assert.equal(failure.code, 'bad-request');
      return true;
    });
  });

  it('rejects non-object JSON bodies', async () => {
    for (const body of ['[1,2]', '"text"', 'null', '42']) {
      await assert.rejects(readJsonBody(withBody(body), 1024), (error) => /** @type {any} */ (error).code === 'bad-request');
    }
  });

  it('rejects bodies above the byte cap', async () => {
    await assert.rejects(readJsonBody(withBody('{"a":"xxxxxxxxxx"}'), 5), (error) => {
      const failure = /** @type {any} */ (error);
      assert.equal(failure.code, 'bad-request');
      assert.match(failure.message, /byte limit/);
      return true;
    });
  });
});
