/**
 * `POST /api/dsh-workspace-ide.ping` — the verification channel the client
 * bundle uses to prove it really executed inside the browser.
 *
 * Each ping appends one JSON line to
 * `${DSH_HOME ?? ~/.dsh}/workspace-ide/status.jsonl`. The route always answers
 * `{"ok":true}`; every filesystem/parse failure is swallowed, because a
 * verification probe must never surface as a panel error.
 *
 * @module dsh-workspace-ide/host/status
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { okResponse } from './respond.js';

/** Directory under DSH_HOME that keeps the ping log. */
const STATUS_DIRECTORY = 'workspace-ide';
/** File name of the ping log. */
const STATUS_FILE = 'status.jsonl';
/** Longest `stage` string accepted into the log. */
const MAX_STAGE_LENGTH = 200;
/** Longest serialized `detail` accepted into the log. */
const MAX_DETAIL_LENGTH = 4000;
/** Largest ping body read; anything above is ignored instead of parsed. */
const MAX_PING_BODY_BYTES = 64 * 1024;

/**
 * Resolve the DSH home directory the status log lives under.
 * @param env - environment variables (defaults to `process.env`).
 * @returns the home directory.
 */
export function statusHome(env = process.env) {
  const configured = env !== null && typeof env === 'object' ? env.DSH_HOME : undefined;
  return typeof configured === 'string' && configured.length > 0 ? configured : join(homedir(), '.dsh');
}

/**
 * Resolve the absolute status log path.
 * @param env - environment variables (defaults to `process.env`).
 * @returns the absolute log path.
 */
export function statusFilePath(env = process.env) {
  return join(statusHome(env), STATUS_DIRECTORY, STATUS_FILE);
}

/**
 * Append one ping record as a JSON line (mkdir -p first).
 * @param record - the record to append.
 * @param env - environment variables (defaults to `process.env`).
 * @returns nothing; resolves once the line is durably queued.
 */
export async function appendStatusRecord(record, env = process.env) {
  const file = statusFilePath(env);
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
}

/**
 * Keep a ping detail JSON-friendly and bounded without ever throwing.
 * @param detail - raw detail from the request body.
 * @returns the sanitized detail.
 */
function sanitizeDetail(detail) {
  if (detail === undefined) return null;
  try {
    const serialized = JSON.stringify(detail);
    if (serialized === undefined) return null;
    if (serialized.length > MAX_DETAIL_LENGTH) return serialized.slice(0, MAX_DETAIL_LENGTH);
    return detail;
  } catch {
    return null;
  }
}

/**
 * Handle the ping route. Always `{"ok":true}`.
 * @param ctx - Host plugin context (unused; kept for a uniform handler signature).
 * @param request - incoming POST request.
 * @returns the HTTP response.
 */
export async function handlePing(ctx, request) {
  let body = {};
  try {
    const declared = Number(request.headers !== null && request.headers !== undefined && typeof request.headers.get === 'function' ? request.headers.get('content-length') : NaN);
    const oversized = Number.isFinite(declared) && declared > MAX_PING_BODY_BYTES;
    const text = oversized ? '' : await request.text();
    if (text.length <= MAX_PING_BODY_BYTES && text.trim() !== '') {
      const parsed = JSON.parse(text);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
    }
  } catch {
    body = {};
  }
  const stage = typeof body.stage === 'string' ? body.stage.slice(0, MAX_STAGE_LENGTH) : '';
  const record = {
    at: new Date().toISOString(),
    stage,
    detail: sanitizeDetail(body.detail),
    pid: process.pid,
  };
  try {
    await appendStatusRecord(record);
  } catch {
    // The verification channel never fails the client.
  }
  return okResponse();
}
