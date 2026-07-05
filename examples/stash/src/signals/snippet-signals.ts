/**
 * Snippet domain signals.
 *
 * `snippet.create` and `snippet.fork` fire `snippet.created`;
 * `snippet.update` and `snippet.delete` fire `snippet.updated`. The
 * `search.index` consumer trail lists both in its `on:` array, closing the
 * reactive indexing loop.
 */

import { signal } from '@ontrails/core';
import { z } from 'zod';

export const snippetCreated = signal('snippet.created', {
  description: 'Fired when a snippet is created, including forks',
  from: ['snippet.create'],
  payload: z.object({
    ownerId: z.string(),
    snippetId: z.string(),
    visibility: z.enum(['public', 'secret']),
  }),
});

export const snippetUpdated = signal('snippet.updated', {
  description: 'Fired when a snippet gains a revision or is deleted',
  from: ['snippet.update', 'snippet.delete'],
  payload: z.object({
    action: z.enum(['updated', 'deleted']),
    snippetId: z.string(),
  }),
});
