/**
 * Raw byte serving through the derived HTTP route.
 *
 * `file.raw` declares a `blobRefSchema` output, so the framework-derived
 * `GET /file/raw` route streams the bytes with the extension-derived content
 * type — six-plus common types including one binary, plus the same
 * visibility rules as every other read. No hand-mounted route exists.
 */

import { describe, expect, test } from 'bun:test';

import { run } from '@ontrails/core';

import { graph } from '../src/app.js';
import { createMockDb, db } from '../src/resources/db.js';
import { createStashApp } from '../src/server.js';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const rawUrl = (snippetId: string, seq: number, name: string): string =>
  `/file/raw?snippetId=${encodeURIComponent(snippetId)}&seq=${String(seq)}&name=${encodeURIComponent(name)}`;

const RAW_FILES = [
  { content: 'export const n = 1;\n', name: 'mod.ts' },
  { content: 'module.exports = 1;\n', name: 'mod.js' },
  { content: '{ "ok": true }\n', name: 'data.json' },
  { content: '# Notes\n', name: 'notes.md' },
  { content: 'plain text\n', name: 'notes.txt' },
  { content: PNG_BASE64, encoding: 'base64', name: 'pixel.png' },
  { content: PNG_BASE64, encoding: 'base64', name: 'blob.bin' },
];

const EXPECTED_TYPES: readonly (readonly [string, string])[] = [
  ['mod.ts', 'application/typescript; charset=utf-8'],
  ['mod.js', 'text/javascript; charset=utf-8'],
  ['data.json', 'application/json; charset=utf-8'],
  ['notes.md', 'text/markdown; charset=utf-8'],
  ['notes.txt', 'text/plain; charset=utf-8'],
  ['pixel.png', 'image/png'],
  ['blob.bin', 'application/octet-stream'],
];

describe('GET /file/raw', () => {
  test('serves six-plus content types including binary, byte-exact', async () => {
    const conn = createMockDb();
    const app = createStashApp(conn);

    const created = await run(
      graph,
      'snippet.create',
      {
        description: 'content-type fixture snippet',
        files: RAW_FILES,
        visibility: 'public',
      },
      {
        ctx: {
          extensions: { [db.id]: conn },
          permit: { id: 'usr_alice', scopes: ['snippet:write'] },
        },
      }
    );
    expect(created.isOk()).toBe(true);
    const { id } = created.isOk()
      ? (created.value as { id: string })
      : { id: '' };

    for (const [name, contentType] of EXPECTED_TYPES) {
      const response = await app.request(rawUrl(id, 1, name));
      expect(`${name}:${response.status}`).toBe(`${name}:200`);
      expect(`${name}:${response.headers.get('content-type') ?? ''}`).toBe(
        `${name}:${contentType}`
      );
    }

    // Binary round-trip: served bytes equal the decoded base64 source.
    const png = await app.request(rawUrl(id, 1, 'pixel.png'));
    const served = new Uint8Array(await png.arrayBuffer());
    const source = Uint8Array.from(atob(PNG_BASE64), (char) =>
      char.codePointAt(0)
    );
    expect(served).toEqual(source);

    // Text round-trip.
    const text = await app.request(rawUrl(id, 1, 'notes.txt'));
    expect(await text.text()).toBe('plain text\n');
  });

  test('secret snippet files honor the non-leak rule over raw HTTP', async () => {
    const conn = createMockDb();
    const app = createStashApp(conn);

    const anonymous = await app.request(
      rawUrl('snip_secret', 1, 'checklist.md')
    );
    expect(anonymous.status).toBe(404);

    const asBob = await app.request(rawUrl('snip_secret', 1, 'checklist.md'), {
      headers: { authorization: 'Bearer stash_bob_dev_token' },
    });
    expect(asBob.status).toBe(404);

    const asOwner = await app.request(
      rawUrl('snip_secret', 1, 'checklist.md'),
      {
        headers: { authorization: 'Bearer stash_alice_dev_token' },
      }
    );
    expect(asOwner.status).toBe(200);
    expect(asOwner.headers.get('content-type')).toBe(
      'text/markdown; charset=utf-8'
    );

    const missingFile = await app.request(
      rawUrl('snip_hello', 1, 'absent.txt')
    );
    expect(missingFile.status).toBe(404);

    const missingRevision = await app.request(
      rawUrl('snip_hello', 9, 'greet.ts')
    );
    expect(missingRevision.status).toBe(404);
  });
});
