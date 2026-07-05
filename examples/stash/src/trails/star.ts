/**
 * Star trails — idempotent toggles for any authenticated user.
 *
 * Starring goes through the same visibility choke point as reads: another
 * user's secret snippet is unstarrable because it is unseeable.
 */

import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { db } from '../resources/db.js';
import {
  loadVisibleSnippet,
  requireSubject,
  snippetNotFound,
  starCountFor,
} from './shared.js';

const starOutputSchema = z.object({
  snippetId: z.string(),
  starCount: z.number().int(),
  starred: z.boolean(),
});

const starInputSchema = z.object({
  id: z.string().describe('Snippet id'),
});

// ---------------------------------------------------------------------------
// snippet.star
// ---------------------------------------------------------------------------

export const star = trail('snippet.star', {
  blaze: async (input, ctx) => {
    const subject = requireSubject(ctx);
    if (subject.isErr()) {
      return subject;
    }
    const conn = db.from(ctx);
    const snippet = await loadVisibleSnippet(conn, input.id, subject.value);
    if (snippet === null) {
      return Result.err(snippetNotFound(input.id));
    }
    const existing = await conn.stars.list({
      snippetId: input.id,
      userId: subject.value,
    });
    if (existing.length === 0) {
      await conn.stars.insert({ snippetId: input.id, userId: subject.value });
    }
    return Result.ok({
      snippetId: input.id,
      starCount: await starCountFor(conn, input.id),
      starred: true,
    });
  },
  description: 'Star a snippet (idempotent)',
  examples: [
    {
      description: 'Star a public snippet',
      expected: { snippetId: 'snip_hello', starCount: 2, starred: true },
      input: { id: 'snip_hello' },
      name: 'Star a snippet',
    },
    {
      description: 'Unknown ids return NotFoundError',
      error: 'NotFoundError',
      input: { id: 'snip_missing' },
      name: 'Star a missing snippet',
    },
  ],
  idempotent: true,
  input: starInputSchema,
  intent: 'write',
  output: starOutputSchema,
  permit: { scopes: ['snippet:interact'] },
  resources: [db],
});

// ---------------------------------------------------------------------------
// snippet.unstar
// ---------------------------------------------------------------------------

export const unstar = trail('snippet.unstar', {
  blaze: async (input, ctx) => {
    const subject = requireSubject(ctx);
    if (subject.isErr()) {
      return subject;
    }
    const conn = db.from(ctx);
    const snippet = await loadVisibleSnippet(conn, input.id, subject.value);
    if (snippet === null) {
      return Result.err(snippetNotFound(input.id));
    }
    const existing = await conn.stars.list({
      snippetId: input.id,
      userId: subject.value,
    });
    for (const row of existing) {
      await conn.stars.remove(row.id);
    }
    return Result.ok({
      snippetId: input.id,
      starCount: await starCountFor(conn, input.id),
      starred: false,
    });
  },
  description: 'Remove your star from a snippet (idempotent)',
  examples: [
    {
      description: 'Unstar a snippet you have not starred is a no-op',
      expected: { snippetId: 'snip_hello', starCount: 1, starred: false },
      input: { id: 'snip_hello' },
      name: 'Unstar a snippet',
    },
  ],
  idempotent: true,
  input: starInputSchema,
  intent: 'write',
  output: starOutputSchema,
  permit: { scopes: ['snippet:interact'] },
  resources: [db],
});
