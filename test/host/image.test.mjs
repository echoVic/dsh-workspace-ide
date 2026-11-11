/**
 * Image route tests: magic-byte MIME detection, base64 payloads, SVG
 * acceptance, size limits and path safety.
 */

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  MAX_IMAGE_BYTES,
  inferImageMime,
  readWorkspaceImage,
  sniffImageMime,
} from '../../lib/host/image.js';
import { call, encode, makeApp, temporaryDirectory } from './support.mjs';

/** 1×1 transparent PNG. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/** 1×1 transparent GIF. */
const GIF_BYTES = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="#39f"/></svg>';

/**
 * Read one image through the route.
 * @param app - routes.
 * @param root - workspace root.
 * @param path - relative file path.
 * @returns decoded response.
 */
async function getImage(app, root, path) {
  return call(app, 'image', `?root=${encode(root)}&path=${encode(path)}`);
}

describe('inferImageMime', () => {
  it('maps image extensions case-insensitively', () => {
    assert.equal(inferImageMime('a.png'), 'image/png');
    assert.equal(inferImageMime('a.PNG'), 'image/png');
    assert.equal(inferImageMime('a.jpg'), 'image/jpeg');
    assert.equal(inferImageMime('a.jpeg'), 'image/jpeg');
    assert.equal(inferImageMime('a.gif'), 'image/gif');
    assert.equal(inferImageMime('a.webp'), 'image/webp');
    assert.equal(inferImageMime('a.bmp'), 'image/bmp');
    assert.equal(inferImageMime('a.ico'), 'image/x-icon');
    assert.equal(inferImageMime('a.avif'), 'image/avif');
    assert.equal(inferImageMime('a.svg'), 'image/svg+xml');
  });

  it('returns null for non-image and dotless names', () => {
    for (const name of ['a.txt', 'a.js', 'a.md', 'Makefile', '', 'a.']) {
      assert.equal(inferImageMime(name), null);
    }
  });
});

describe('sniffImageMime', () => {
  it('detects binary formats by signature', () => {
    assert.equal(sniffImageMime(PNG_BYTES, 'image/png'), 'image/png');
    assert.equal(sniffImageMime(GIF_BYTES, 'image/gif'), 'image/gif');
    assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), 'image/jpeg'), 'image/jpeg');
    assert.equal(
      sniffImageMime(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'), 'image/webp'),
      'image/webp',
    );
    assert.equal(sniffImageMime(Buffer.from('BM\x00\x00\x00\x00', 'latin1'), 'image/bmp'), 'image/bmp');
    assert.equal(sniffImageMime(Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01]), 'image/x-icon'), 'image/x-icon');
    assert.equal(
      sniffImageMime(Buffer.from('\x00\x00\x00\x18ftypavif', 'latin1'), 'image/avif'),
      'image/avif',
    );
  });

  it('accepts SVG text only when the extension says SVG', () => {
    assert.equal(sniffImageMime(Buffer.from(SVG_TEXT, 'utf8'), 'image/svg+xml'), 'image/svg+xml');
    assert.equal(sniffImageMime(Buffer.from(SVG_TEXT, 'utf8'), null), null);
    assert.equal(sniffImageMime(Buffer.from('hello world', 'utf8'), 'image/svg+xml'), null);
  });

  it('rejects renamed non-images and unknown bytes', () => {
    assert.equal(sniffImageMime(Buffer.from('plain text pretending to be png'), 'image/png'), null);
    assert.equal(sniffImageMime(Buffer.alloc(0), 'image/png'), null);
  });
});

describe('GET image', () => {
  it('returns a base64 PNG payload with its verified MIME type', async (t) => {
    const directory = temporaryDirectory(t);
    writeFileSync(join(directory, 'logo.png'), PNG_BYTES);
    const { status, body } = await getImage(makeApp(), directory, 'logo.png');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.mime, 'image/png');
    assert.equal(body.size, PNG_BYTES.length);
    assert.equal(body.path, 'logo.png');
    assert.equal(Buffer.from(body.base64, 'base64').equals(PNG_BYTES), true);
  });

  it('serves SVGs with the SVG MIME type', async (t) => {
    const directory = temporaryDirectory(t);
    writeFileSync(join(directory, 'logo.svg'), SVG_TEXT);
    const { status, body } = await getImage(makeApp(), directory, 'logo.svg');
    assert.equal(status, 200);
    assert.equal(body.mime, 'image/svg+xml');
    assert.equal(Buffer.from(body.base64, 'base64').toString('utf8'), SVG_TEXT);
  });

  it('rejects text files and renamed non-images with 415', async (t) => {
    const directory = temporaryDirectory(t);
    writeFileSync(join(directory, 'notes.txt'), 'not an image');
    writeFileSync(join(directory, 'fake.png'), 'not an image either');
    const text = await getImage(makeApp(), directory, 'notes.txt');
    assert.equal(text.status, 415);
    assert.equal(text.body.error.code, 'unsupported-image');
    const renamed = await getImage(makeApp(), directory, 'fake.png');
    assert.equal(renamed.status, 415);
    assert.equal(renamed.body.error.code, 'unsupported-image');
  });

  it('refuses images above the byte limit with 413', async (t) => {
    const directory = temporaryDirectory(t);
    const oversized = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    PNG_BYTES.copy(oversized, 0);
    writeFileSync(join(directory, 'huge.png'), oversized);
    const { status, body } = await getImage(makeApp(), directory, 'huge.png');
    assert.equal(status, 413);
    assert.equal(body.error.code, 'too-large');
  });

  it('rejects traversal, absolute paths, directories and missing files', async (t) => {
    const directory = temporaryDirectory(t);
    mkdirSync(join(directory, 'folder'));
    const app = makeApp();
    const traversal = await call(app, 'image', `?root=${encode(directory)}&path=${encode('../escape.png')}`);
    assert.equal(traversal.status, 403);
    const absolute = await call(app, 'image', `?root=${encode(directory)}&path=${encode('/etc/passwd')}`);
    assert.equal(absolute.status, 403);
    const folder = await getImage(app, directory, 'folder');
    assert.equal(folder.status, 400);
    const missing = await getImage(app, directory, 'missing.png');
    assert.equal(missing.status, 404);
  });

  it('readWorkspaceImage resolves the workspace root and reads the file', async (t) => {
    const directory = temporaryDirectory(t);
    writeFileSync(join(directory, 'pixel.gif'), GIF_BYTES);
    const body = await readWorkspaceImage({ requestedRoot: directory, realRoot: directory }, 'pixel.gif');
    const payload = await body.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.mime, 'image/gif');
    assert.equal(Buffer.from(payload.base64, 'base64').length, GIF_BYTES.length);
  });
});
