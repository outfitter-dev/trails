/**
 * Revision history trails — reads over the immutable revision log.
 *
 * `revision.diff` is a computed read: a naive line diff between two seqs,
 * kept deliberately simple.
 */

import { NotFoundError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { db } from '../resources/db.js';
import type { StashConnection } from '../resources/db.js';
import type { Revision, StashFile } from '../store.js';
import {
  loadVisibleSnippet,
  revisionDetailSchema,
  revisionSummarySchema,
  snippetNotFound,
  toRevisionDetail,
  toRevisionSummary,
  viewerId,
} from './shared.js';

const orderedRevisions = async (
  conn: StashConnection,
  snippetId: string
): Promise<Revision[]> => {
  const revisions = await conn.revisions.list({ snippetId });
  return revisions.toSorted((a, b) => a.seq - b.seq);
};

const revisionNotFound = (snippetId: string, seq: number): NotFoundError =>
  new NotFoundError(`Snippet "${snippetId}" has no revision ${String(seq)}`);

// ---------------------------------------------------------------------------
// revision.list
// ---------------------------------------------------------------------------

export const list = trail('revision.list', {
  blaze: async (input, ctx) => {
    const conn = db.from(ctx);
    const snippet = await loadVisibleSnippet(
      conn,
      input.snippetId,
      viewerId(ctx)
    );
    if (snippet === null) {
      return Result.err(snippetNotFound(input.snippetId));
    }
    const revisions = await orderedRevisions(conn, input.snippetId);
    return Result.ok({
      revisions: revisions.map(toRevisionSummary),
      total: revisions.length,
    });
  },
  description: 'List a snippet’s revisions in seq order',
  examples: [
    {
      description: 'List the revision history for a snippet',
      expected: {
        revisions: [
          {
            createdAt: '2026-01-01T00:00:00.000Z',
            fileNames: ['greet.ts'],
            message: 'initial revision',
            seq: 1,
          },
        ],
        total: 1,
      },
      input: { snippetId: 'snip_hello' },
      name: 'List revisions',
    },
    {
      description: 'Unknown snippet ids return NotFoundError',
      error: 'NotFoundError',
      input: { snippetId: 'snip_missing' },
      name: 'List revisions of a missing snippet',
    },
  ],
  input: z.object({
    snippetId: z.string().describe('Snippet id'),
  }),
  intent: 'read',
  output: z.object({
    revisions: z.array(revisionSummarySchema),
    total: z.number().int(),
  }),
  resources: [db],
});

// ---------------------------------------------------------------------------
// revision.get
// ---------------------------------------------------------------------------

export const get = trail('revision.get', {
  blaze: async (input, ctx) => {
    const conn = db.from(ctx);
    const snippet = await loadVisibleSnippet(
      conn,
      input.snippetId,
      viewerId(ctx)
    );
    if (snippet === null) {
      return Result.err(snippetNotFound(input.snippetId));
    }
    const revisions = await orderedRevisions(conn, input.snippetId);
    const revision = revisions.find((row) => row.seq === input.seq);
    if (revision === undefined) {
      return Result.err(revisionNotFound(input.snippetId, input.seq));
    }
    return Result.ok(toRevisionDetail(revision));
  },
  description: 'Read one revision of a snippet, including full file contents',
  examples: [
    {
      description: 'Read revision 1 of a snippet',
      expected: {
        createdAt: '2026-01-01T00:00:00.000Z',
        files: [
          {
            content: `export const greet = (name: string): string => \`Hello, \${name}!\`;\n`,
            encoding: 'utf8',
            language: 'typescript',
            name: 'greet.ts',
          },
        ],
        message: 'initial revision',
        seq: 1,
        snippetId: 'snip_hello',
      },
      input: { seq: 1, snippetId: 'snip_hello' },
      name: 'Get a revision',
    },
    {
      description: 'Unknown seqs return NotFoundError',
      error: 'NotFoundError',
      input: { seq: 99, snippetId: 'snip_hello' },
      name: 'Get a missing revision',
    },
  ],
  input: z.object({
    seq: z.coerce.number().int().min(1).describe('Revision sequence number'),
    snippetId: z.string().describe('Snippet id'),
  }),
  intent: 'read',
  output: revisionDetailSchema,
  resources: [db],
});

// ---------------------------------------------------------------------------
// revision.diff
// ---------------------------------------------------------------------------

const fileDiffSchema = z.object({
  addedLines: z.array(z.string()),
  name: z.string(),
  removedLines: z.array(z.string()),
  status: z.enum(['added', 'removed', 'modified', 'unchanged']),
});

const textLines = (file: StashFile | undefined): string[] => {
  if (file === undefined || file.encoding === 'base64') {
    return [];
  }
  return file.content.split('\n');
};

const diffStatus = (
  before: StashFile | undefined,
  after: StashFile | undefined,
  changedLines: number
): 'added' | 'removed' | 'modified' | 'unchanged' => {
  if (before === undefined) {
    return 'added';
  }
  if (after === undefined) {
    return 'removed';
  }
  return changedLines === 0 ? 'unchanged' : 'modified';
};

const diffFile = (
  name: string,
  before: StashFile | undefined,
  after: StashFile | undefined
) => {
  const beforeLines = textLines(before);
  const afterLines = textLines(after);
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  const addedLines = afterLines.filter((line) => !beforeSet.has(line));
  const removedLines = beforeLines.filter((line) => !afterSet.has(line));
  return {
    addedLines,
    name,
    removedLines,
    status: diffStatus(before, after, addedLines.length + removedLines.length),
  };
};

export const diff = trail('revision.diff', {
  blaze: async (input, ctx) => {
    const conn = db.from(ctx);
    const snippet = await loadVisibleSnippet(
      conn,
      input.snippetId,
      viewerId(ctx)
    );
    if (snippet === null) {
      return Result.err(snippetNotFound(input.snippetId));
    }
    const revisions = await orderedRevisions(conn, input.snippetId);
    const fromRevision = revisions.find((row) => row.seq === input.from);
    if (fromRevision === undefined) {
      return Result.err(revisionNotFound(input.snippetId, input.from));
    }
    const toRevision = revisions.find((row) => row.seq === input.to);
    if (toRevision === undefined) {
      return Result.err(revisionNotFound(input.snippetId, input.to));
    }
    const names = [
      ...new Set([
        ...fromRevision.files.map((file) => file.name),
        ...toRevision.files.map((file) => file.name),
      ]),
    ].toSorted();
    const files = names.map((name) =>
      diffFile(
        name,
        fromRevision.files.find((file) => file.name === name),
        toRevision.files.find((file) => file.name === name)
      )
    );
    return Result.ok({ files, from: input.from, to: input.to });
  },
  description: 'Naive line diff between two revisions of a snippet',
  examples: [
    {
      description: 'Diff a revision against itself',
      expected: {
        files: [
          {
            addedLines: [],
            name: 'greet.ts',
            removedLines: [],
            status: 'unchanged',
          },
        ],
        from: 1,
        to: 1,
      },
      input: { from: 1, snippetId: 'snip_hello', to: 1 },
      name: 'Diff identical revisions',
    },
    {
      description: 'Unknown seqs return NotFoundError',
      error: 'NotFoundError',
      input: { from: 1, snippetId: 'snip_hello', to: 99 },
      name: 'Diff a missing revision',
    },
  ],
  input: z.object({
    from: z.coerce.number().int().min(1).describe('Base revision seq'),
    snippetId: z.string().describe('Snippet id'),
    to: z.coerce.number().int().min(1).describe('Target revision seq'),
  }),
  intent: 'read',
  output: z.object({
    files: z.array(fileDiffSchema),
    from: z.number().int(),
    to: z.number().int(),
  }),
  resources: [db],
});
