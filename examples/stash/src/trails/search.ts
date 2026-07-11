/**
 * Signal-driven search.
 *
 * `search.index` is the reactive consumer: it lists `snippet.created` and
 * `snippet.updated` in its `on:` array, so every create, fork, update, and
 * delete re-derives that snippet's rows in the `searchEntries` table. Secret
 * snippets are never indexed — search cannot leak what reads cannot see.
 * `search.reindex` is the admin-permit full rebuild over the same tokenizer.
 */

import { Result, trail } from '@ontrails/core';
import { z } from 'zod';

import { db } from '../resources/db.js';
import type { StashConnection } from '../resources/db.js';
import { deriveSearchTerms, tokenizeQuery } from '../search/terms.js';
import { snippetCreated, snippetUpdated } from '../signals/snippet-signals.js';
import {
  isVisibleTo,
  latestRevisionFor,
  snippetSummarySchema,
  starCountFor,
  toSnippetSummary,
  viewerId,
} from './shared.js';

const indexSnippet = async (
  conn: StashConnection,
  snippetId: string
): Promise<{ indexed: boolean; terms: number }> => {
  const stale = await conn.searchEntries.list({ snippetId });
  for (const row of stale) {
    await conn.searchEntries.remove(row.id);
  }
  const snippet = await conn.snippets.get(snippetId);
  if (snippet === null || snippet.visibility !== 'public') {
    return { indexed: false, terms: 0 };
  }
  const latest = await latestRevisionFor(conn, snippetId);
  const terms = deriveSearchTerms(snippet.description, latest?.files ?? []);
  for (const term of terms) {
    await conn.searchEntries.insert({ snippetId, term });
  }
  return { indexed: true, terms: terms.length };
};

// ---------------------------------------------------------------------------
// search.index
// ---------------------------------------------------------------------------

export const index = trail('search.index', {
  description:
    'Re-derive the search index rows for one snippet; deletes and secret snippets deindex',
  examples: [
    {
      description: 'Reindex a seeded public snippet',
      input: { snippetId: 'snip_hello' },
      name: 'Index a snippet',
    },
  ],
  implementation: async (input, ctx) => {
    const conn = db.from(ctx);
    const outcome = await indexSnippet(conn, input.snippetId);
    return Result.ok({ snippetId: input.snippetId, ...outcome });
  },
  input: z.object({
    snippetId: z.string().describe('Snippet id to (re)index'),
  }),
  intent: 'write',
  on: [snippetCreated, snippetUpdated],
  output: z.object({
    indexed: z.boolean(),
    snippetId: z.string(),
    terms: z.number().int(),
  }),
  permit: { scopes: [] },
  resources: [db],
  visibility: 'internal',
});

// ---------------------------------------------------------------------------
// search.query
// ---------------------------------------------------------------------------

export const query = trail('search.query', {
  description: 'Search public snippets by keyword over the derived index',
  examples: [
    {
      description: 'Find a snippet by a word in its description',
      expected: {
        query: 'greet',
        results: [
          {
            createdAt: '2026-01-01T00:00:00.000Z',
            description: 'Greet the trail crew from TypeScript',
            forkOf: null,
            id: 'snip_hello',
            ownerId: 'usr_alice',
            starCount: 1,
            updatedAt: '2026-01-01T00:00:00.000Z',
            version: 1,
            visibility: 'public',
          },
        ],
        total: 1,
      },
      input: { limit: 10, query: 'greet' },
      name: 'Search finds a match',
    },
    {
      description: 'Queries with no matches return an empty result set',
      expected: { query: 'zebra', results: [], total: 0 },
      input: { limit: 10, query: 'zebra' },
      name: 'Search finds nothing',
    },
  ],
  implementation: async (input, ctx) => {
    const conn = db.from(ctx);
    const tokens = tokenizeQuery(input.query);
    if (tokens.length === 0) {
      return Result.ok({ query: input.query, results: [], total: 0 });
    }
    let matched: Set<string> | null = null;
    for (const token of tokens) {
      const rows = await conn.searchEntries.list({ term: token });
      const ids = new Set(rows.map((row) => row.snippetId));
      if (matched === null) {
        matched = ids;
        continue;
      }
      const previous: readonly string[] = [...matched];
      matched = new Set(previous.filter((id) => ids.has(id)));
    }
    const viewer = viewerId(ctx);
    const orderedIds = [...(matched ?? new Set<string>())].toSorted();
    const summaries = [];
    for (const id of orderedIds) {
      const snippet = await conn.snippets.get(id);
      if (snippet === null || !isVisibleTo(snippet, viewer)) {
        continue;
      }
      summaries.push(toSnippetSummary(snippet, await starCountFor(conn, id)));
    }
    return Result.ok({
      query: input.query,
      results: summaries.slice(0, input.limit),
      total: summaries.length,
    });
  },
  input: z.object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe('Maximum results'),
    query: z.string().min(1).describe('Search terms (AND across words)'),
  }),
  intent: 'read',
  output: z.object({
    query: z.string(),
    results: z.array(snippetSummarySchema),
    total: z.number().int(),
  }),
  resources: [db],
});

// ---------------------------------------------------------------------------
// search.reindex
// ---------------------------------------------------------------------------

export const reindex = trail('search.reindex', {
  description:
    'Rebuild the entire search index from scratch; requires the search:admin scope',
  examples: [
    {
      description: 'Full rebuild over every public snippet',
      input: {},
      name: 'Reindex everything',
    },
  ],
  implementation: async (_input, ctx) => {
    const conn = db.from(ctx);
    const stale = await conn.searchEntries.list();
    for (const row of stale) {
      await conn.searchEntries.remove(row.id);
    }
    const snippets = await conn.snippets.list();
    let indexed = 0;
    let terms = 0;
    for (const snippet of snippets) {
      const outcome = await indexSnippet(conn, snippet.id);
      if (outcome.indexed) {
        indexed += 1;
        terms += outcome.terms;
      }
    }
    return Result.ok({ snippets: indexed, terms });
  },
  input: z.object({}),
  intent: 'write',
  output: z.object({
    snippets: z.number().int(),
    terms: z.number().int(),
  }),
  permit: { scopes: ['search:admin'] },
  resources: [db],
});
