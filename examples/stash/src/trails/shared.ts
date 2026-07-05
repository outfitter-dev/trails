/**
 * Shared projections and the visibility choke point for snippet trails.
 *
 * Every read of a snippet goes through {@link loadVisibleSnippet}: a secret
 * snippet read by anyone but its owner behaves exactly like a snippet that
 * does not exist. Trails answer with the same `NotFoundError` (same message
 * shape) in both cases, so no surface can leak that a secret id is taken —
 * this is the deliberate NotFound-not-Forbidden choice the README documents.
 */

import { NotFoundError, PermitError, Result } from '@ontrails/core';
import type { TrailContext } from '@ontrails/core';
import { z } from 'zod';

import type { StashConnection } from '../resources/db.js';
import { fileSchema } from '../store.js';
import type { Revision, SnippetRow } from '../store.js';

// ---------------------------------------------------------------------------
// Output schemas
// ---------------------------------------------------------------------------

export const snippetSummarySchema = z.object({
  createdAt: z.string(),
  description: z.string(),
  forkOf: z.string().nullable(),
  id: z.string(),
  ownerId: z.string(),
  starCount: z.number().int(),
  updatedAt: z.string(),
  version: z.number().int(),
  visibility: z.enum(['public', 'secret']),
});

export const revisionSummarySchema = z.object({
  createdAt: z.string(),
  fileNames: z.array(z.string()),
  message: z.string().nullable(),
  seq: z.number().int(),
});

export const revisionDetailSchema = z.object({
  createdAt: z.string(),
  files: z.array(fileSchema),
  message: z.string().nullable(),
  seq: z.number().int(),
  snippetId: z.string(),
});

export const snippetDetailSchema = snippetSummarySchema.extend({
  latestRevision: revisionSummarySchema,
});

export type SnippetSummary = z.output<typeof snippetSummarySchema>;

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/** The permit subject id for the current caller, if authenticated. */
export const viewerId = (ctx: TrailContext): string | undefined =>
  ctx.permit?.id;

/**
 * The permit subject for a mutation. Enforcement rejects unauthenticated
 * callers before the blaze runs; this narrows the type and keeps a truthful
 * error if a caller ever reaches the blaze without one.
 */
export const requireSubject = (ctx: TrailContext): Result<string, Error> => {
  const subject = viewerId(ctx);
  return subject === undefined
    ? Result.err(new PermitError('An authenticated permit is required'))
    : Result.ok(subject);
};

/**
 * One error shape for "missing" and "hidden" so responses are
 * indistinguishable across every surface.
 */
export const snippetNotFound = (id: string): NotFoundError =>
  new NotFoundError(`Snippet "${id}" not found`);

/** Whether a snippet row is visible to the given viewer. */
export const isVisibleTo = (
  snippet: SnippetRow,
  viewer: string | undefined
): boolean => snippet.visibility === 'public' || snippet.ownerId === viewer;

/**
 * Load a snippet the viewer is allowed to see.
 *
 * Returns `null` both when the id does not exist and when it names a secret
 * snippet owned by someone else.
 */
export const loadVisibleSnippet = async (
  conn: StashConnection,
  id: string,
  viewer: string | undefined
): Promise<SnippetRow | null> => {
  const snippet = await conn.snippets.get(id);
  if (snippet === null || !isVisibleTo(snippet, viewer)) {
    return null;
  }
  return snippet;
};

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

export const starCountFor = async (
  conn: StashConnection,
  snippetId: string
): Promise<number> => {
  const stars = await conn.stars.list({ snippetId });
  return stars.length;
};

export const latestRevisionFor = async (
  conn: StashConnection,
  snippetId: string
): Promise<Revision | null> => {
  const revisions = await conn.revisions.list({ snippetId });
  const latest = revisions.toSorted((a, b) => a.seq - b.seq).at(-1);
  return latest ?? null;
};

export const nextRevisionSeq = async (
  conn: StashConnection,
  snippetId: string
): Promise<number> => {
  const latest = await latestRevisionFor(conn, snippetId);
  return latest === null ? 1 : latest.seq + 1;
};

export const toSnippetSummary = (
  snippet: SnippetRow,
  starCount: number
): SnippetSummary => ({
  createdAt: snippet.createdAt,
  description: snippet.description,
  forkOf: snippet.forkOf,
  id: snippet.id,
  ownerId: snippet.ownerId,
  starCount,
  updatedAt: snippet.updatedAt,
  version: snippet.version,
  visibility: snippet.visibility,
});

export const toRevisionSummary = (revision: Revision) => ({
  createdAt: revision.createdAt,
  fileNames: revision.files.map((file) => file.name),
  message: revision.message,
  seq: revision.seq,
});

export const toRevisionDetail = (revision: Revision) => ({
  createdAt: revision.createdAt,
  files: revision.files.map((file) => ({ ...file })),
  message: revision.message,
  seq: revision.seq,
  snippetId: revision.snippetId,
});
