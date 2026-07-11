/**
 * snippet.fork — composition with lineage.
 *
 * Forking composes `snippet.get` (visibility applies: another user's secret
 * snippet reads as not-found, so it is unforkable without leaking existence),
 * `revision.get` (full files of the latest revision), and `snippet.create`
 * with the composition-only `forkOf` field carrying lineage. The public
 * create contract never exposes `forkOf`; only composition can set it.
 */

import { InternalError, Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { snippetDetailSchema } from './shared.js';
import type { revisionDetailSchema } from './shared.js';

type SnippetDetail = z.output<typeof snippetDetailSchema>;
type RevisionDetail = z.output<typeof revisionDetailSchema>;

export const fork = trail('snippet.fork', {
  composes: ['snippet.get', 'revision.get', 'snippet.create'],
  description:
    'Fork a snippet you can see into your own account, preserving lineage',
  examples: [
    {
      description: 'Fork a public snippet',
      input: { id: 'snip_hello' },
      name: 'Fork a snippet',
    },
    {
      description:
        'Unknown ids — and other users’ secret snippets — return NotFoundError',
      error: 'NotFoundError',
      input: { id: 'snip_missing' },
      name: 'Fork a missing snippet',
    },
  ],
  implementation: async (input, ctx) => {
    if (!ctx.compose) {
      return Result.err(new InternalError('Trail requires a compose function'));
    }
    const source = await ctx.compose<SnippetDetail>('snippet.get', {
      id: input.id,
    });
    if (source.isErr()) {
      return source;
    }
    const revision = await ctx.compose<RevisionDetail>('revision.get', {
      seq: source.value.latestRevision.seq,
      snippetId: input.id,
    });
    if (revision.isErr()) {
      return revision;
    }
    return await ctx.compose<SnippetDetail>('snippet.create', {
      description: source.value.description,
      files: revision.value.files,
      forkOf: input.id,
      message: `forked from ${input.id}`,
      visibility: source.value.visibility,
    });
  },
  input: z.object({
    id: z.string().describe('Snippet id to fork'),
  }),
  intent: 'write',
  output: snippetDetailSchema,
  permit: { scopes: ['snippet:write'] },
});
