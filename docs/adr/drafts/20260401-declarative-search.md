---
slug: declarative-search
title: Declarative Search
status: draft
created: 2026-04-01
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
depends_on: [schema-derived-persistence, 9]
---

# ADR: Declarative Search

## Context

The Stash dogfood included a `gist.search` trail backed by SQLite FTS5. The agent had to manually create the FTS5 virtual table, write trigger-based index sync (later replaced with manual calls), wire up the FTS5 MATCH query, and format results with relevance scores. Approximately 80 lines of mechanical SQL and store code that repeated information the framework already had: which fields are text, which entities should be searchable, and what the result shape looks like.

Search is not a niche feature. Nearly every data-centric application needs content search. It appears in three escalating forms:

1. **Full-text search (FTS).** Keyword matching with ranking. SQLite FTS5, Postgres `tsvector`. Zero infrastructure beyond the database. Covers 80% of use cases.
2. **Vector search.** Semantic similarity via embeddings. Requires an embedding model and a vector index. Useful when keyword matching fails ("my Raspberry Pi setup" should match "deploying on ARM hardware").
3. **Hybrid search.** Combines FTS and vector results via Reciprocal Rank Fusion (RRF) or similar. Best of both worlds, but requires both FTS and vector infrastructure.

The key insight: search is not a separate system. It's a **query mode on entities**. The same gist that `gist.show` returns by primary key, `gist.list` returns by attribute filter, and `gist.search` returns by content matching. The entity is the constant. The access pattern varies.

Trails can treat searchability as a declared property of the entity schema, the same way `intent` is a declared property of the trail. The framework derives the indexing infrastructure, the query API, the maintenance hooks, and optionally the search trail itself. The developer authors what's searchable and how to embed it. Everything else follows.

### What Trails uniquely enables

Most search implementations require the developer to maintain three things in sync: the entity schema, the search index schema, and the query code. Changes to the entity (adding a field, renaming a column) require corresponding changes to the search index and query.

Trails already eliminates this class of sync problem for surfaces (CLI flags, MCP tools, HTTP routes all stay in sync because they're derived from the trail contract). The same derivation model applied to search means the search index stays in sync with the entity schema automatically. Add a text field to the Zod schema and declare it searchable; the FTS index updates to include it.

## Decision

### 1. Search is a declaration on the store entity

The `search` property on a store entity definition declares what's searchable and how:

```typescript
export const db = store({
  gists: {
    schema: gistSchema,
    primaryKey: 'id',
    generated: ['id', 'createdAt', 'updatedAt'],
    indexes: ['owner', 'createdAt'],
    search: {
      fields: {
        description: { weight: 1.0 },
        'files.content': { weight: 0.5 },
        'files.filename': { weight: 0.8 },
      },
      fts: true,
    },
  },
});
```

A shorthand is available for simple cases:

```typescript
gists: {
  schema: gistSchema,
  // ...
  search: ['description'],  // equivalent to { fields: { description: { weight: 1.0 } }, fts: true }
}
```

The `search` declaration is the authored information. The framework derives the FTS index, the sync hooks, and the query method.

### 2. Progressive search modes

Three modes, each building on the previous:

**FTS (zero-config default):**

```typescript
search: {
  fields: { description: { weight: 1.0 } },
  fts: true,
}
```

The store adapter creates the appropriate full-text index:

- SQLite: FTS5 virtual table with content sync triggers
- Postgres: `tsvector` column with GIN index and trigger-based updates

FTS requires no external infrastructure. It works with `bun:sqlite` out of the box.

**Vector (opt-in, requires embedding service):**

```typescript
search: {
  fields: { description: { weight: 1.0 } },
  vector: {
    embed: embeddingService,
    dimensions: 1536,
  },
}
```

The embedding service is a standard Trails service (ADR-009):

```typescript
export const embeddingService = service('embedder', {
  create: () => ({
    embed: async (text: string): Promise<number[]> => {
      // OpenAI, local model, or any embedding provider
    },
    dimensions: 1536,
  }),
  mock: () => ({
    embed: async (text: string) =>
      Array(384).fill(0).map((_, i) => Math.sin(i + text.length)),
    dimensions: 384,
  }),
});
```

The mock embedding service means `testAll` works without calling an embedding API. The embed-on-write hooks use the service from context, so production uses the real embedder and tests use the mock.

The store adapter creates the vector index:

- SQLite: `sqlite-vec` virtual table
- Postgres: `pgvector` column with appropriate index

**Hybrid (opt-in, requires both FTS and vector):**

```typescript
search: {
  fields: { description: { weight: 1.0 } },
  fts: true,
  vector: { embed: embeddingService, dimensions: 1536 },
  hybrid: {
    ftsWeight: 0.4,
    vectorWeight: 0.6,
    k: 60,            // RRF constant (default: 60)
  },
}
```

When both `fts` and `vector` are declared, hybrid mode becomes available. The adapter implements Reciprocal Rank Fusion to combine results from both indexes.

### 3. Typed accessor: `conn.table.search()`

When search is declared on a store entity, the typed accessor gains a `search` method:

```typescript
const conn = db.from(ctx);

// FTS search
const results = await conn.gists.search('typescript helpers', {
  limit: 20,
  offset: 0,
});
// Returns: { items: SearchResult<Gist>[], total: number, hasMore: boolean }

// Vector search (when configured)
const similar = await conn.gists.search('typescript helpers', {
  mode: 'vector',
  limit: 10,
});

// Hybrid search (when both FTS and vector configured)
const hybrid = await conn.gists.search('typescript helpers', {
  mode: 'hybrid',
  limit: 20,
});
```

The `SearchResult<T>` type extends the entity type with search-specific fields:

```typescript
type SearchResult<T> = T & {
  _search: {
    score: number;                     // relevance score (normalized 0-1)
    highlights?: Record<string, string>; // field name -> snippet with match markers
    matchedFields?: string[];           // which declared search fields matched
  };
};
```

Search metadata lives under a `_search` namespace to avoid colliding with entity fields. The `highlights` field contains FTS5 snippet extracts (or equivalent) with match positions marked. Available only for FTS and hybrid modes.

### 4. Automatic index maintenance

The store adapter maintains search indexes automatically as CRUD operations occur:

| Operation | FTS behavior | Vector behavior |
| --- | --- | --- |
| `insert` | Add to FTS index | Compute embedding, add to vector index |
| `update` | Update FTS index entry | Recompute embedding, update vector index |
| `remove` | Remove from FTS index | Remove from vector index |

For FTS, this uses database-native mechanisms (FTS5 content tables with triggers for SQLite, trigger-based `tsvector` updates for Postgres).

For vector embeddings, the embed-on-write hook calls the embedding service asynchronously within the same transaction. If embedding fails, the insert/update still succeeds but the vector index entry is not created. A future `warden` rule could detect entities with missing embeddings.

Cross-table search fields (e.g., `'files.content'` declared on `gists`) require the adapter to join child records when building the FTS/vector content. The adapter handles this via content triggers or materialized search documents, depending on the database dialect.

### 5. `entity()` auto-generates a search trail

When search is declared on a store entity and the developer uses `entity()` (see the Entity Trail Factories draft), a search trail is automatically included:

```typescript
export const { create, show, list, update, remove, search } = entity('gist', db.gists, {
  // CRUD config...
  search: {
    examples: [
      { name: 'Search gists', input: { query: 'typescript' } },
      { name: 'Empty results', input: { query: 'xyznonexistent' } },
    ],
  },
});
```

The derived search trail:

- ID: `{namespace}.search`
- Input: `{ query: string, mode?: 'fts' | 'vector' | 'hybrid' }` merged with `paginationFields()`. The `mode` enum only includes modes that are actually configured.
- Output: `paginatedOutput(entitySchema.extend({ _search: searchMetaSchema }))`
- Intent: `read`
- Implementation: `conn.table.search(input.query, options)` wrapped in `Result.ok()`

If the developer doesn't want the auto-generated search trail, they omit `search` from the `entity()` config and hand-author a search trail instead:

```typescript
// Only generate CRUD, not search
export const { create, show, list, update, remove } = entity('gist', db.gists, { ... });

// Hand-authored search with custom logic
export const search = trail('gist.search', {
  input: z.object({ query: z.string(), language: z.string().optional() }),
  output: paginatedOutput(gistSchema),
  intent: 'read',
  run: async (input, ctx) => {
    const conn = db.from(ctx);
    // Custom: filter by language before FTS, or do multi-table search
    const results = await conn.gists.search(input.query, { ... });
    return Result.ok(results);
  },
});
```

### 6. FTS query passthrough

Trails does not invent a query language. The `query` string is passed through to the underlying search engine:

- SQLite FTS5: supports `AND`, `OR`, `NOT`, column filters (`description:typescript`), prefix queries (`type*`), phrase queries (`"exact phrase"`)
- Postgres `to_tsquery`: supports `&`, `|`, `!`, prefix matching, phrase matching

The framework does not parse, transform, or validate the query string. Developers who want structured query building can do so in hand-authored trails. The framework handles the common case: pass a string, get ranked results.

For safety, the adapter sanitizes inputs to prevent SQL injection. The query string is always parameterized, never interpolated.

### 7. Cross-entity search (future)

A future extension: searching across multiple entities in one query:

```typescript
const results = await conn.search('typescript helpers', {
  tables: ['gists', 'files'],
  limit: 20,
});
// Returns: { items: (SearchResult<Gist> | SearchResult<File>)[], total: number }
```

This is explicitly deferred. The initial implementation focuses on single-entity search. Cross-entity search requires careful thought about result ranking across different schemas and is better informed by real usage patterns.

## Consequences

### Positive

- **Search is zero-code for the common case.** Declare `search: ['description']` on a store entity; get FTS indexing, sync hooks, a typed `search()` accessor, and optionally a derived search trail. The Stash dogfood's ~80 lines of FTS code become a single-line declaration.
- **The testing story extends to search.** Mock embedding services mean vector search tests run without API calls. `testAll` covers search trail examples. Search is not a testing gap.
- **Search compounds with everything.** Surfaces derive search commands and tools. Survey reports searchable entities. Warden can verify that searchable fields have `.describe()`. Guide documents search capabilities. Every existing feature gets smarter.
- **Progressive complexity matches progressive need.** Start with `fts: true` (zero infrastructure). Add `vector` when you need semantic search (one service). Add `hybrid` when you want both (one config option). The declaration grows with the requirement.
- **Index maintenance is invisible.** Developers never write FTS sync triggers or embedding-on-write hooks. The store adapter handles it as part of the CRUD operations. Insert a gist; the search index updates.

### Tradeoffs

- **FTS5 and pgvector are database extensions.** FTS5 is built into SQLite, so it's truly zero-config. But `sqlite-vec` for vector search and `pgvector` for Postgres vector search are extensions that must be installed separately. The framework can detect their absence and provide clear error messages, but it can't install them.
- **Embedding quality is outside Trails' control.** The framework calls the embedding service; it doesn't evaluate the quality of embeddings. Poor embedding models produce poor vector search results. Trails can document best practices but can't prevent bad choices.
- **Cross-table search fields add complexity.** Declaring `'files.content'` as a search field on `gists` requires the adapter to join across tables when building search content. This is mechanically straightforward but increases the surface area of the sync logic.
- **Hybrid search tuning is domain-specific.** The RRF weights and k constant affect result quality. Trails provides sensible defaults, but optimal values depend on the dataset and use case. There's no universal "correct" configuration.

### What this does NOT decide

- **Embedding model recommendations.** Trails does not ship or recommend a specific embedding model. The service pattern lets developers bring any provider (OpenAI, local models, etc.).
- **Query suggestion or autocomplete.** These are application-level features that build on search, not search primitives.
- **Real-time search / streaming results.** The search accessor returns a paginated result set. Streaming or live-updating results are a future concern.
- **Topo-level search.** Searching across trail descriptions and examples for agent discovery is a compelling future direction but is architecturally distinct from entity search. It would use the same search primitives but operates on the topo graph, not on stored entities.
- **Relevance analytics.** Tracking which queries return good results, which return empty, and how users interact with search results is an observability concern (related to Crumbs, ADR-0013) rather than a search concern.

## References

- ADR: Schema-Derived Persistence (draft) -- the store abstraction that search extends
- ADR: Drizzle Store Adapter (draft) -- the adapter that implements FTS5 and vector indexing
- ADR: Entity Trail Factories (draft) -- the `entity()` factory that auto-generates search trails
- [ADR-0009: Services](../0009-first-class-services.md) -- the service pattern for embedding providers
- [Architecture](../../architecture.md) -- information categories, right-side hexagonal adapters
- Alex Garcia's hybrid search guide: <https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/>
