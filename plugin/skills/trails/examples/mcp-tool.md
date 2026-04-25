Convert a hand-wired MCP tool to a trail with derived annotations.

## Before

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const server = new McpServer({ name: 'docs', version: '1.0.0' });

server.tool(
  'search_docs',
  'Search documentation by query',
  {
    query: { type: 'string', description: 'Search query' },
    limit: { type: 'number', description: 'Max results' },
    section: {
      type: 'string',
      enum: ['api', 'guides', 'changelog'],
      description: 'Section to search',
    },
  },
  async ({ query, limit, section }) => {
    try {
      const results = await searchIndex(query, { limit: limit ?? 10, section });
      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Search failed: ${err.message}` }],
        isError: true,
      };
    }
  }
);
```

## After

```typescript
// trails/docs.ts
import { z } from 'zod';
import { trail, Result, InternalError } from '@ontrails/core';

const SearchResult = z.object({
  title: z.string(),
  path: z.string(),
  snippet: z.string(),
});

export const search = trail('docs.search', {
  input: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().default(10).describe('Max results'),
    section: z.enum(['api', 'guides', 'changelog']).describe('Section to search'),
  }),
  output: z.array(SearchResult),
  intent: 'read',
  idempotent: true,
  description: 'Search documentation by query',
  examples: [
    { name: 'api search', input: { query: 'authentication', section: 'api' } },
    { name: 'limited results', input: { query: 'deploy', section: 'guides', limit: 3 } },
  ],
  blaze: async (input) => {
    try {
      const results = await searchIndex(input.query, {
        limit: input.limit,
        section: input.section,
      });
      return Result.ok(results);
    } catch (error) {
      return Result.err(new InternalError('Search failed', { cause: error as Error }));
    }
  },
});
```

One line to expose as MCP tools:

```typescript
// mcp.ts
import { topo } from '@ontrails/core';
import { surface } from '@ontrails/mcp';
import * as docs from './trails/docs.js';

const graph = topo('docs', docs);
await surface(graph);
// Tool name: docs_docs_search
// Annotations derived from trail:
//   readOnlyHint: true    (intent: 'read')
//   idempotentHint: true  (idempotent: true)
//   title: "Search documentation by query"
// Input schema derived from Zod — no manual JSON Schema
```
