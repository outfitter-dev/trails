# stash

Self-hosted GitHub-Gists-style snippet service — the showcase suite's deliberate kitchen sink. One authored contract per trail; MCP, HTTP, and CLI are renderings of it.

## What this showcases

| Capability | Where it appears |
| --- | --- |
| Trailheads | [src/app.ts](src/app.ts) authors the `snippets`, `history`, `search`, and `account` group bindings as a `surfaceOverlay({ mcp })` entry in `trailsOverlays` — the lock-visible default. [src/mcp-options.ts](src/mcp-options.ts) keeps the call-site map as the richer-metadata override-in-context; member trail identity is preserved per ADR-0050 ([`__tests__/trailheads.test.ts`](__tests__/trailheads.test.ts)) |
| Permits | [src/resources/auth.ts](src/resources/auth.ts) resolves bearer tokens against the `tokens` table on every surface; owner checks live in the blazes ([src/trails/snippet.ts](src/trails/snippet.ts)) |
| Secret snippets without existence leaks | [src/trails/shared.ts](src/trails/shared.ts) — one visibility choke point; proven per surface in [`__tests__/permit-parity.test.ts`](__tests__/permit-parity.test.ts) |
| Domain revisions | [src/store.ts](src/store.ts) + [src/trails/revision.ts](src/trails/revision.ts) — immutable revision rows; immutability proven in [`__tests__/revisions.test.ts`](__tests__/revisions.test.ts) |
| Compose | [src/trails/fork.ts](src/trails/fork.ts) — `snippet.fork` composes `snippet.get`, `revision.get`, and `snippet.create`, carrying lineage through the composition-only `composeInput` field |
| Signals | [src/signals/snippet-signals.ts](src/signals/snippet-signals.ts) fire → [src/trails/search.ts](src/trails/search.ts) `search.index` consumes with `on:` ([`__tests__/search-loop.test.ts`](__tests__/search-loop.test.ts)) |
| Raw content over HTTP | [src/trails/file.ts](src/trails/file.ts) returns a `BlobRef`, and the framework-derived `GET /file/raw` route streams the bytes with extension-derived content types — no hand-mounted route ([`__tests__/raw.test.ts`](__tests__/raw.test.ts)) |
| Multi-entity graph | snippets → revisions, stars, forks, tokens, users, search entries — walk it with `trails wayfind` over the committed [trails.lock](trails.lock) |
| Store + reconcile | [src/resources/db.ts](src/resources/db.ts) schema-derived SQLite store; the versioned `snippets` table takes a factory `reconcile` trail ([src/trails/reconcile.ts](src/trails/reconcile.ts)) |

Twenty trails, two resources, twenty signals, all mocked-db testable with one `testAllEstablished(graph)` line plus focused tests for the correctness spine.

## The agent story (MCP first)

Agents are the primary user here: "save this snippet," "find my sqlite snippets," "fork and modify." The MCP surface exposes the hot-path tools directly and groups the rest behind four trailheads, so a dense topo reads as a short tool list. The groupings are authored once as module overlay bindings in `app.ts` (so they land in `trails.lock` and any surface or reader can see them), while the call-site map in `mcp-options.ts` overrides the same members at runtime with richer descriptions.

A real tool-call transcript, captured against the seeded app (`stash_snippet_create` with alice's bearer token, then `stash_search_query` — no reindex step in between; the `snippet.created` signal drove `search.index` reactively):

```text
→ tools/call stash_snippet_create
{
  "description": "Bun SQLite quickstart",
  "files": [
    {
      "content": "import { Database } from \"bun:sqlite\";\nconst db = new Database(\":memory:\");\n",
      "language": "typescript",
      "name": "db.ts"
    }
  ],
  "visibility": "public"
}
← structuredContent
{
  "createdAt": "2026-07-04T23:31:54.454Z",
  "description": "Bun SQLite quickstart",
  "forkOf": null,
  "id": "019f2f79-6bd6-7000-b03f-3bfb3274c020",
  "ownerId": "usr_alice",
  "starCount": 0,
  "updatedAt": "2026-07-04T23:31:54.454Z",
  "version": 1,
  "visibility": "public",
  "latestRevision": {
    "createdAt": "2026-07-04T23:31:54.455Z",
    "fileNames": ["db.ts"],
    "message": null,
    "seq": 1
  }
}

→ tools/call stash_search_query
{ "query": "sqlite" }
← structuredContent
{
  "query": "sqlite",
  "results": [
    {
      "id": "019f2f79-6bd6-7000-b03f-3bfb3274c020",
      "description": "Bun SQLite quickstart",
      "ownerId": "usr_alice",
      "starCount": 0,
      "version": 1,
      "visibility": "public",
      "forkOf": null,
      "createdAt": "2026-07-04T23:31:54.454Z",
      "updatedAt": "2026-07-04T23:31:54.454Z"
    }
  ],
  "total": 1
}
```

To point an MCP client at stash, register the stdio server:

```json
{
  "mcpServers": {
    "stash": {
      "command": "bun",
      "args": ["run", "src/mcp.ts"],
      "cwd": "examples/stash"
    }
  }
}
```

## Quickstart

From the repo root, on a fresh checkout:

```bash
cd examples/stash
bun test
```

The CLI runs against a freshly seeded in-memory database per invocation (set `STASH_DB_PATH=./stash.db` to persist between runs):

```bash
bun run bin/stash.ts snippet list
bun run bin/stash.ts snippet get --id snip_hello
bun run bin/stash.ts search query --query greet
bun run bin/stash.ts snippet star --id snip_hello --token stash_bob_dev_token
bun run bin/stash.ts snippet get --id snip_secret --token stash_alice_dev_token
```

Start the HTTP surface (JSON API plus raw byte serving):

```bash
bun run src/http.ts
```

Then, in another terminal:

```bash
curl -s 'http://localhost:4280/snippet/get?id=snip_hello'
curl -s 'http://localhost:4280/file/raw?snippetId=snip_hello&seq=1&name=greet.ts'
curl -s -X POST 'http://localhost:4280/snippet/create' \
  -H 'Authorization: Bearer stash_alice_dev_token' \
  -H 'Content-Type: application/json' \
  -d '{"description":"curl-made snippet","files":[{"name":"hi.txt","content":"hello\n"}]}'
```

Seeded identities: `alice` (token `stash_alice_dev_token`, all scopes) and `bob` (token `stash_bob_dev_token`, `snippet:write` + `snippet:interact`). Seeded snippets: `snip_hello` (public), `snip_secret` (alice's, secret), `snip_scratch` (public).

## Domain revisions are not trail versions

Stash carries three distinct version-shaped concepts, on purpose:

- **Domain revisions** are *data*. Every `snippet.update` inserts a new `revisions` row with the next `seq` and never mutates an earlier one — history is immutable by construction, and `revision.get`/`revision.diff` are ordinary reads over it. This is the app's business domain, authored in the store schema.
- **Trail versioning** is *contract evolution*: how a trail's own input/output contract changes over time (version entries, deprecation guidance, migration notes). None of stash's trails have needed a v2 yet, so the topo carries no version entries — which is itself the point: revising your data model daily does not touch your trail contracts.
- The store's `version` column on `snippets` is a third thing: framework-managed optimistic concurrency for the versioned table, which is what lets the factory-built `snippets.reconcile` maintenance trail retry conflicting upserts.

If you find yourself encoding data history into trail versions (or contract changes into data rows), this example is the counter-pattern.

## Secret snippets return NotFound, not Forbidden

A secret snippet read by anyone but its owner behaves exactly like a snippet that does not exist — same error class, same message shape — on MCP, HTTP, and CLI alike. A `403` would confirm the id is taken; `404` leaks nothing. Non-owner *writes* to a *public* snippet fail with `PermissionError`, because public existence is not a secret. Every read path funnels through one helper (`loadVisibleSnippet`) so the rule cannot drift per trail, and [`__tests__/permit-parity.test.ts`](__tests__/permit-parity.test.ts) proves it per surface with real bearer tokens.

Search cannot leak either: `search.index` only indexes public snippets, so a secret snippet's terms are never in the index to begin with.

## The mega app

The other showcase apps stay small and forkable. Stash is the one that keeps growing: every future framework capability gets dogfooded here first, on top of a domain that is already dense enough (multi-entity graph, permits, signals, composition, raw bytes) to exercise it honestly.

Deferred beyond this version, deliberately: web UI, syntax highlighting, markdown rendering, comments, orgs/teams, OAuth, embeds, and import-from-gist.
