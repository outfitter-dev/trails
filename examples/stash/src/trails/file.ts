/**
 * file.raw — real bytes off the contract.
 *
 * The trail returns a `BlobRef` (name, mimeType, size, bytes) with the
 * content type derived from the file extension. Because the output schema is
 * `blobRefSchema`, the derived HTTP route (`GET /file/raw`) streams the bytes
 * with that content-type header — byte serving is a projection of the
 * contract, not app wiring. Visibility applies here exactly as everywhere
 * else: a secret snippet's files read as not-found to anyone but the owner.
 */

import {
  NotFoundError,
  Result,
  blobRefSchema,
  createBlobRef,
  trail,
} from '@ontrails/core';
import { z } from 'zod';

import { db } from '../resources/db.js';
import type { StashFile } from '../store.js';
import { loadVisibleSnippet, snippetNotFound, viewerId } from './shared.js';

const CONTENT_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  png: 'image/png',
  ts: 'application/typescript; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

/** Content type for a file name, by extension; unknown maps to octet-stream. */
export const contentTypeFor = (name: string): string => {
  const extension = name.toLowerCase().split('.').at(-1) ?? '';
  return CONTENT_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream';
};

const fileBytes = (file: StashFile): Uint8Array => {
  if (file.encoding === 'base64') {
    return Uint8Array.from(
      atob(file.content),
      (char) => char.codePointAt(0) ?? 0
    );
  }
  return new TextEncoder().encode(file.content);
};

export const raw = trail('file.raw', {
  description:
    'Serve one file of one revision as raw bytes with a content type derived from its extension',
  examples: [
    {
      description: 'Fetch the raw bytes of a seeded file',
      input: { name: 'greet.ts', seq: 1, snippetId: 'snip_hello' },
      name: 'Raw file bytes',
    },
    {
      description: 'Unknown file names return NotFoundError',
      error: 'NotFoundError',
      input: { name: 'nope.ts', seq: 1, snippetId: 'snip_hello' },
      name: 'Raw missing file',
    },
  ],
  implementation: async (input, ctx) => {
    const conn = db.from(ctx);
    const snippet = await loadVisibleSnippet(
      conn,
      input.snippetId,
      viewerId(ctx)
    );
    if (snippet === null) {
      return Result.err(snippetNotFound(input.snippetId));
    }
    const revisions = await conn.revisions.list({
      snippetId: input.snippetId,
    });
    const revision = revisions.find((row) => row.seq === input.seq);
    if (revision === undefined) {
      return Result.err(
        new NotFoundError(
          `Snippet "${input.snippetId}" has no revision ${String(input.seq)}`
        )
      );
    }
    const file = revision.files.find((entry) => entry.name === input.name);
    if (file === undefined) {
      return Result.err(
        new NotFoundError(
          `File "${input.name}" not found in revision ${String(input.seq)} of snippet "${input.snippetId}"`
        )
      );
    }
    const bytes = fileBytes(file);
    return Result.ok(
      createBlobRef({
        data: bytes,
        mimeType: contentTypeFor(file.name),
        name: file.name,
        size: bytes.length,
      })
    );
  },
  input: z.object({
    name: z.string().describe('File name within the revision'),
    seq: z.coerce.number().int().min(1).describe('Revision sequence number'),
    snippetId: z.string().describe('Snippet id'),
  }),
  intent: 'read',
  output: blobRefSchema,
  resources: [db],
});
