/**
 * Snippet CRUD trails.
 *
 * Updates never mutate revision history: `snippet.update` inserts a new
 * `revisions` row with the next `seq` and leaves every earlier revision
 * untouched. Secret snippets answer `NotFoundError` — never a permission
 * error — to any caller but their owner, on every surface.
 */

import { InternalError, PermissionError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { db } from '../resources/db.js';
import type { StashConnection } from '../resources/db.js';
import { snippetCreated, snippetUpdated } from '../signals/snippet-signals.js';
import { fileSchema, visibilitySchema } from '../store.js';
import type { SnippetRow } from '../store.js';
import {
  latestRevisionFor,
  loadVisibleSnippet,
  nextRevisionSeq,
  requireSubject,
  revisionDetailSchema,
  snippetDetailSchema,
  snippetNotFound,
  snippetSummarySchema,
  starCountFor,
  toRevisionDetail,
  toRevisionSummary,
  toSnippetSummary,
  viewerId,
} from './shared.js';

/**
 * Load a snippet for an owner mutation. Missing ids and other owners'
 * secret snippets read as not-found; non-owner writes to a public snippet
 * are a plain permission failure.
 */
const loadOwnedSnippet = async (
  conn: StashConnection,
  id: string,
  owner: string
): Promise<Result<SnippetRow, Error>> => {
  const snippet = await conn.snippets.get(id);
  if (snippet === null) {
    return Result.err(snippetNotFound(id));
  }
  if (snippet.ownerId !== owner) {
    return snippet.visibility === 'secret'
      ? Result.err(snippetNotFound(id))
      : Result.err(
          new PermissionError(`Snippet "${id}" belongs to another user`)
        );
  }
  return Result.ok(snippet);
};

const buildDetail = async (conn: StashConnection, snippet: SnippetRow) => {
  const [starCount, latest] = await Promise.all([
    starCountFor(conn, snippet.id),
    latestRevisionFor(conn, snippet.id),
  ]);
  if (latest === null) {
    return null;
  }
  return {
    ...toSnippetSummary(snippet, starCount),
    latestRevision: toRevisionSummary(latest),
  };
};

const noRevisions = (id: string): InternalError =>
  new InternalError(`Snippet "${id}" has no revisions`);

// ---------------------------------------------------------------------------
// snippet.create
// ---------------------------------------------------------------------------

export const create = trail('snippet.create', {
  composeInput: z.object({
    forkOf: z
      .string()
      .optional()
      .describe('Composition-only lineage pointer set by snippet.fork'),
  }),
  description: 'Create a snippet with its first revision',
  examples: [
    {
      description: 'Create a public snippet with one file',
      input: {
        description: 'A tiny JSON config example',
        files: [
          {
            content: '{ "retries": 3 }\n',
            language: 'json',
            name: 'config.json',
          },
        ],
        message: 'initial revision',
        visibility: 'public',
      },
      name: 'Create a snippet',
    },
  ],
  fires: [snippetCreated],
  implementation: async (input, ctx) => {
    const subject = requireSubject(ctx);
    if (subject.isErr()) {
      return subject;
    }
    const conn = db.from(ctx);
    const snippet = await conn.snippets.insert({
      description: input.description,
      forkOf: input.forkOf ?? null,
      ownerId: subject.value,
      visibility: input.visibility,
    });
    await conn.revisions.insert({
      files: input.files,
      message: input.message ?? null,
      seq: 1,
      snippetId: snippet.id,
    });
    await ctx.fire?.(snippetCreated, {
      ownerId: snippet.ownerId,
      snippetId: snippet.id,
      visibility: snippet.visibility,
    });
    const detail = await buildDetail(conn, snippet);
    if (detail === null) {
      return Result.err(noRevisions(snippet.id));
    }
    return Result.ok(detail);
  },
  input: z.object({
    description: z.string().min(1).describe('What this snippet is about'),
    files: z
      .array(fileSchema)
      .min(1)
      .describe('Files for revision 1 (at least one)'),
    message: z
      .string()
      .optional()
      .describe('Optional revision message for revision 1'),
    visibility: visibilitySchema.default('public'),
  }),
  intent: 'write',
  output: snippetDetailSchema,
  permit: { scopes: ['snippet:write'] },
  resources: [db],
});

// ---------------------------------------------------------------------------
// snippet.get
// ---------------------------------------------------------------------------

export const get = trail('snippet.get', {
  description:
    'Show a snippet with its latest revision; secret snippets are owner-only',
  examples: [
    {
      description: 'Read a public snippet by id',
      expected: {
        createdAt: '2026-01-01T00:00:00.000Z',
        description: 'Greet the trail crew from TypeScript',
        forkOf: null,
        id: 'snip_hello',
        latestRevision: {
          createdAt: '2026-01-01T00:00:00.000Z',
          fileNames: ['greet.ts'],
          message: 'initial revision',
          seq: 1,
        },
        ownerId: 'usr_alice',
        starCount: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        version: 1,
        visibility: 'public',
      },
      input: { id: 'snip_hello' },
      name: 'Get a public snippet',
    },
    {
      description: 'Unknown ids return NotFoundError',
      error: 'NotFoundError',
      input: { id: 'snip_missing' },
      name: 'Get a missing snippet',
    },
  ],
  implementation: async (input, ctx) => {
    const conn = db.from(ctx);
    const snippet = await loadVisibleSnippet(conn, input.id, viewerId(ctx));
    if (snippet === null) {
      return Result.err(snippetNotFound(input.id));
    }
    const detail = await buildDetail(conn, snippet);
    if (detail === null) {
      return Result.err(noRevisions(input.id));
    }
    return Result.ok(detail);
  },
  input: z.object({
    id: z.string().describe('Snippet id'),
  }),
  intent: 'read',
  output: snippetDetailSchema,
  resources: [db],
});

// ---------------------------------------------------------------------------
// snippet.list
// ---------------------------------------------------------------------------

export const list = trail('snippet.list', {
  description:
    'List snippets with owner and visibility filters; secret snippets appear only for their owner',
  examples: [
    {
      description: 'List every snippet visible to the caller',
      input: { limit: 20, offset: 0 },
      name: 'List snippets',
    },
    {
      description: 'Filter by owner',
      input: { limit: 20, offset: 0, owner: 'usr_alice' },
      name: 'List snippets by owner',
    },
  ],
  implementation: async (input, ctx) => {
    const conn = db.from(ctx);
    const viewer = viewerId(ctx);
    const filters = {
      ...(input.owner === undefined ? {} : { ownerId: input.owner }),
      ...(input.visibility === undefined
        ? {}
        : { visibility: input.visibility }),
    };
    const rows = await conn.snippets.list(
      Object.keys(filters).length === 0 ? undefined : filters
    );
    const visible = rows.filter(
      (row) => row.visibility === 'public' || row.ownerId === viewer
    );
    const page = visible.slice(input.offset, input.offset + input.limit);
    const snippets = await Promise.all(
      page.map(async (row) =>
        toSnippetSummary(row, await starCountFor(conn, row.id))
      )
    );
    return Result.ok({ snippets, total: visible.length });
  },
  input: z.object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Page size'),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Pagination offset'),
    owner: z.string().optional().describe('Filter by owner user id'),
    visibility: visibilitySchema
      .optional()
      .describe('Filter by visibility (secret only matches your own)'),
  }),
  intent: 'read',
  output: z.object({
    snippets: z.array(snippetSummarySchema),
    total: z.number().int(),
  }),
  resources: [db],
});

// ---------------------------------------------------------------------------
// snippet.update
// ---------------------------------------------------------------------------

export const update = trail('snippet.update', {
  description:
    'Add a new revision to a snippet; earlier revisions are never mutated',
  examples: [
    {
      description: 'Publish a second revision of a snippet',
      input: {
        files: [
          {
            content: `export const greet = (name: string): string => \`Hello again, \${name}!\`;\n`,
            language: 'typescript',
            name: 'greet.ts',
          },
        ],
        id: 'snip_hello',
        message: 'friendlier greeting',
      },
      name: 'Update a snippet',
    },
    {
      description: 'Unknown ids return NotFoundError',
      error: 'NotFoundError',
      input: {
        files: [{ content: 'x\n', name: 'x.txt' }],
        id: 'snip_missing',
      },
      name: 'Update a missing snippet',
    },
  ],
  fires: [snippetUpdated],
  implementation: async (input, ctx) => {
    const subject = requireSubject(ctx);
    if (subject.isErr()) {
      return subject;
    }
    const conn = db.from(ctx);
    const owned = await loadOwnedSnippet(conn, input.id, subject.value);
    if (owned.isErr()) {
      return owned;
    }
    const seq = await nextRevisionSeq(conn, input.id);
    const revision = await conn.revisions.insert({
      files: input.files,
      message: input.message ?? null,
      seq,
      snippetId: input.id,
    });
    // Touch the snippet row so `updatedAt` and the concurrency `version`
    // advance; revision rows themselves are insert-only.
    await conn.snippets.update(input.id, {
      description: owned.value.description,
    });
    await ctx.fire?.(snippetUpdated, {
      action: 'updated',
      snippetId: input.id,
    });
    return Result.ok(toRevisionDetail(revision));
  },
  input: z.object({
    files: z
      .array(fileSchema)
      .min(1)
      .describe('Full file set for the new revision'),
    id: z.string().describe('Snippet id'),
    message: z.string().optional().describe('Optional revision message'),
  }),
  intent: 'write',
  output: revisionDetailSchema,
  permit: { scopes: ['snippet:write'] },
  resources: [db],
});

// ---------------------------------------------------------------------------
// snippet.delete
// ---------------------------------------------------------------------------

export const remove = trail('snippet.delete', {
  description:
    'Delete a snippet and cascade its revisions, stars, and index entries',
  examples: [
    {
      description: 'Delete a snippet you own',
      expected: { deleted: true, id: 'snip_scratch' },
      input: { id: 'snip_scratch' },
      name: 'Delete a snippet',
    },
    {
      description: 'Unknown ids return NotFoundError',
      error: 'NotFoundError',
      input: { id: 'snip_missing' },
      name: 'Delete a missing snippet',
    },
  ],
  fires: [snippetUpdated],
  implementation: async (input, ctx) => {
    const subject = requireSubject(ctx);
    if (subject.isErr()) {
      return subject;
    }
    const conn = db.from(ctx);
    const owned = await loadOwnedSnippet(conn, input.id, subject.value);
    if (owned.isErr()) {
      return owned;
    }
    const [revisions, stars, entries] = await Promise.all([
      conn.revisions.list({ snippetId: input.id }),
      conn.stars.list({ snippetId: input.id }),
      conn.searchEntries.list({ snippetId: input.id }),
    ]);
    for (const revision of revisions) {
      await conn.revisions.remove(revision.id);
    }
    for (const star of stars) {
      await conn.stars.remove(star.id);
    }
    for (const entry of entries) {
      await conn.searchEntries.remove(entry.id);
    }
    await conn.snippets.remove(input.id);
    await ctx.fire?.(snippetUpdated, {
      action: 'deleted',
      snippetId: input.id,
    });
    return Result.ok({ deleted: true, id: input.id });
  },
  input: z.object({
    id: z.string().describe('Snippet id'),
  }),
  intent: 'destroy',
  output: z.object({
    deleted: z.boolean(),
    id: z.string(),
  }),
  permit: { scopes: ['snippet:write'] },
  resources: [db],
});
