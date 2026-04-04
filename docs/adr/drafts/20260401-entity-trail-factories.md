---
slug: entity-trail-factories
title: Entity Trail Factories
status: draft
created: 2026-04-01
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
depends_on: [16, declarative-search, 3, 4]
---

# ADR: Entity Trail Factories

## Context

The Schema-Derived Persistence draft establishes the store package with typed accessors for CRUD operations. The Declarative Search draft adds searchability. But the developer still writes trail definitions with schemas, examples, intent, and implementations for each operation. For a CRUD entity, this is mechanical: the create trail's input is the entity schema minus generated fields, the show trail does a primary key lookup and returns `NotFoundError` on null, the list trail applies filters and pagination.

The Stash dogfood app had 19 trails. Of those, roughly 14 followed predictable patterns: 5 basic CRUD operations on gists, plus toggle (star/unstar), clone (fork), comments, revisions, scoped views, and search. Only 3-4 trails had truly custom logic that couldn't be derived.

Beyond CRUD, several patterns recur across nearly every data-backed application:

- **Toggle**: star/unstar, like/unlike, follow/unfollow, pin/unpin, bookmark/unbookmark
- **Clone**: fork a gist, duplicate a template, copy a project
- **Revisions**: version history, edit log, audit trail
- **Comments**: threaded comments on any entity
- **Scoped views**: "my gists", "my starred items" filtered by the current user
- **Search**: full-text and semantic search (covered in the Declarative Search draft)

Each of these patterns produces standard trails with predictable schemas, intents, error handling, and implementations. They are trail factories, not new primitives. The topo doesn't know or care whether a trail was hand-authored or produced by a pattern. No second-class citizens.

## Decision

### Part 1: `mark()` -- CRUD trail factory

`mark()` produces up to six trail definitions from a store table:

```typescript
import { entity } from '@ontrails/store';
import { db } from '../store';

export const { create, show, list, update, remove } = mark('gist', db.gists, {
  create: {
    examples: [
      { name: 'Create public gist', input: { owner: 'matt', description: 'Utils' } },
    ],
  },
  show: {
    examples: [
      { name: 'Show by ID', input: { id: 'seed-1' } },
      { name: 'Not found', input: { id: 'nope' }, error: 'NotFoundError' },
    ],
  },
  list: {
    filterBy: ['owner', 'isPublic'],
    paginate: true,
    examples: [
      { name: 'List by owner', input: { owner: 'matt' } },
    ],
  },
  update: {
    examples: [
      { name: 'Update description', input: { id: 'seed-1', description: 'Updated' } },
    ],
  },
  remove: {
    examples: [
      { name: 'Delete gist', input: { id: 'seed-1' } },
    ],
  },
});
```

What `mark()` derives for each operation:

| Operation | Trail ID | Input schema | Output schema | Intent | Error mapping |
|---|---|---|---|---|---|
| `create` | `gist.create` | Entity minus generated fields | Full entity | `write` | Unique constraint to `AlreadyExistsError` |
| `show` | `gist.show` | `{ id: string }` (primary key) | Full entity | `read` | Null to `NotFoundError` |
| `list` | `gist.list` | Filter fields (optional) + pagination | Paginated entity array | `read` | -- |
| `update` | `gist.update` | `{ id }` + partial entity (minus generated) | Full entity | `write` | Null to `NotFoundError` |
| `remove` | `gist.remove` | `{ id: string }` | `{ deleted: boolean }` | `destroy` | Null to `NotFoundError` |

The developer authors only: which operations to include, filter fields for list, and examples. Everything else (schemas, intents, implementations, error handling) is derived from the store table definition.

**Selective operations.** Not every entity needs all five. Destructure only what you need:

```typescript
// Read-only entity: no create, update, or remove
export const { show, list } = mark('metric', db.metrics, { ... });
```

Operations not destructured are never created. No dead code.

**Upsert.** Upsert is an idempotent create. Rather than a separate operation, it's a flag on `create`:

```typescript
create: {
  upsertOn: ['owner', 'slug'],  // uniqueness constraint for ON CONFLICT
  examples: [/* ... */],
},
```

This produces a `gist.create` trail with `idempotent: true`. The implementation uses `INSERT ... ON CONFLICT UPDATE`. The `idempotent` marker already exists on trails and already affects trailhead behavior (MCP annotations, retry semantics). Now it also affects the store operation. Compound effect.

**Search.** When the underlying store table has a `search` declaration (see the Declarative Search draft), `mark()` auto-generates a search trail alongside the CRUD trails:

```typescript
export const { create, show, list, update, remove, search } = mark('gist', db.gists, {
  // search trail is auto-generated because db.gists has search: { fts: true }
  search: {
    examples: [
      { name: 'Search gists', input: { query: 'typescript' } },
    ],
  },
  // ...other operations
});
```

### Part 2: `toggle()` -- binary relationship pattern

Star/unstar, like/unlike, follow/unfollow, pin/unpin, bookmark/unbookmark, archive/unarchive.

```typescript
import { toggle } from '@ontrails/store';

export const { star, unstar, starred } = toggle('gist.star', {
  store: db.stars,
  subject: 'userId',
  target: 'gistId',
  denormalize: {
    table: db.gists,
    field: 'starCount',
  },
  examples: {
    on:   [{ name: 'Star a gist', input: { userId: 'alice', gistId: 'seed-1' } }],
    off:  [{ name: 'Unstar', input: { userId: 'alice', gistId: 'seed-1' } }],
    list: [{ name: 'List starred', input: { userId: 'alice' } }],
  },
});
```

Produces three trails:

| Trail | ID | Intent | Behavior |
|---|---|---|---|
| `star` | `gist.star` | `write`, idempotent | Insert if not exists. Update denormalized count. |
| `unstar` | `gist.star.undo` | `write`, idempotent | Delete if exists. Update denormalized count. |
| `starred` | `gist.star.list` | `read` | List target entities where relationship exists. Paginated. |

Both `star` and `unstar` are idempotent. Starring twice doesn't error. Unstarring something you haven't starred doesn't error. The denormalized count is maintained atomically.

The `denormalize` option is optional. Many toggle patterns don't need a count (e.g., pin/unpin, archive/unarchive). Omit it and the pattern produces trails without count maintenance.

### Part 3: `revisions()` -- append-only history pattern

Version history on gists, edit history on documents, audit log on entities.

```typescript
import { revisions } from '@ontrails/store';

export const { list: listRevisions, show: showRevision } = revisions('gist.revision', {
  parent: db.gists,
  store: db.revisions,
  snapshot: ['description', 'isPublic'],  // which fields to capture (or 'all')
  examples: {
    list: [{ name: 'List revisions', input: { gistId: 'seed-1' } }],
    show: [{ name: 'Show revision', input: { id: 'rev-seed-1' } }],
  },
});
```

Produces two trails and a mutation hook:

| Trail | ID | Intent | Behavior |
|---|---|---|---|
| `listRevisions` | `gist.revision.list` | `read` | List revisions for a parent entity. Paginated, newest first. |
| `showRevision` | `gist.revision.show` | `read` | Show a specific revision by ID. |
| (hook) | -- | -- | Before update on parent, snapshot current state into revisions table. |

If the parent entity's CRUD is derived via `mark()`, the snapshot hook wires in automatically. If the parent's update trail is hand-authored, the pattern provides a composable `snapshotRevision(conn, parentId)` function the developer calls explicitly.

### Part 4: `comments()` -- threaded comments pattern

Comments on a gist, notes on a ticket, replies to a post.

```typescript
import { comments } from '@ontrails/store';

export const { add, list, remove } = comments('gist.comment', {
  store: db.comments,
  parent: 'gistId',
  author: 'userId',
  body: 'content',
  examples: {
    add:    [{ name: 'Add comment', input: { gistId: 'seed-1', userId: 'alice', content: 'Nice!' } }],
    list:   [{ name: 'List comments', input: { gistId: 'seed-1' } }],
    remove: [{ name: 'Delete comment', input: { id: 'comment-seed-1' } }],
  },
});
```

Produces three trails:

| Trail | ID | Intent |
|---|---|---|
| `add` | `gist.comment.add` | `write` |
| `list` | `gist.comment.list` | `read` (paginated, newest first) |
| `remove` | `gist.comment.remove` | `destroy` |

The field mapping (`parent`, `author`, `body`) tells the pattern which columns in the comment schema serve which role. The pattern derives the schemas, intent, and implementation from this mapping.

### Part 5: `scoped()` -- filtered view pattern

"My gists", "my starred items", user-specific filtered views.

```typescript
import { scoped } from '@ontrails/store';
import { list } from './gist';  // the entity-derived list trail

export const myGists = scoped('user.gists', {
  from: list,
  scopeBy: 'owner',
  examples: [
    { name: 'My gists', input: {} },
  ],
});
```

Produces one trail:

| Trail | ID | Intent | Behavior |
|---|---|---|---|
| `myGists` | `user.gists` | `read` | Same as `gist.list` but `owner` filter is auto-populated from `ctx.permit.sub`. The `owner` field is removed from the public input schema. |

The scoped pattern derives from an existing list trail. It removes the scope field from the input (the user doesn't provide it; it comes from auth context) and injects the value from `ctx.permit`. This cleanly separates public input from auth-derived context without polluting schemas.

### Part 6: Composition of patterns

Patterns compose with each other and with hand-authored trails:

```typescript
// CRUD from mark()
export const { create, show, list, update, remove } = mark('gist', db.gists, { ... });

// Toggle from toggle() -- references same store
export const { star, unstar, starred } = toggle('gist.star', { store: db.stars, ... });

// Revisions from revisions() -- hooks into entity's update
export const { list: listRevisions, show: showRevision } = revisions('gist.revision', {
  parent: db.gists, ...
});

// Hand-authored -- for logic too complex to derive
export const fork = trail('gist.fork', {
  crosses: ['gist.show', 'gist.create'],
  ...
});

// All go into the same topo
export const app = topo('stash', gist, gistStar, gistRevision, gistFork, ...);
```

Every pattern produces standard trails. They appear in `survey`, are tested by `testAll`, trailhead on CLI/MCP/HTTP, and are governed by the warden. No second-class citizens.

### Part 7: Opting out

When a derived trail isn't right, the developer replaces it:

```typescript
// Derive most CRUD operations
export const { show, list, remove } = mark('gist', db.gists, { ... });

// Hand-author create because it has custom business logic
export const create = trail('gist.create', {
  input: gistCreateSchema,
  output: gistSchema,
  intent: 'write',
  blaze: async (input, ctx) => {
    // Custom logic: validate files, check quotas, etc.
    ...
  },
});

// Hand-author update because it needs to trigger notifications
export const update = trail('gist.update', { ... });
```

Derived and hand-authored trails coexist in the same topo. The developer uses the pattern where it fits and opts out where it doesn't. Override what's wrong.

## Consequences

### Positive

- **~80% of trail definitions become configuration.** CRUD, toggle, revisions, comments, scoped views, and search are all derivable. The developer authors examples and configuration, not implementations.
- **Patterns compound with the full framework.** Testing, trailheads, governance, error taxonomy all work unchanged on pattern-derived trails.
- **No second-class citizens.** Derived trails are indistinguishable from hand-authored trails in the topo. Everything downstream works the same.
- **Opt-out is granular.** Replace any single operation with a hand-authored trail. The pattern handles the rest.

### Tradeoffs

- **Pattern API trailhead.** Seven pattern functions (`entity`, `toggle`, `revisions`, `comments`, `scoped`, plus search from the Declarative Search draft) is a non-trivial API to learn. Mitigated by progressive disclosure: most apps only need `mark()`.
- **Implicit behavior.** Derived implementations are not visible in the source code. A developer debugging a `gist.create` failure needs to understand the pattern's behavior. Mitigated by: clear documentation, `survey` introspection, and the fact that the implementations are simple CRUD operations.
- **Pattern-specific configuration.** Each pattern has its own configuration shape. This is inherent complexity, not accidental: toggle needs `subject`/`target`, revisions needs `parent`/`snapshot`, comments needs `author`/`body`.

### What this does NOT decide

- Whether patterns ship in v1 or v1.x (likely `mark()` in v1, others in v1.x)
- Whether custom pattern authors can publish their own patterns (possible future)
- Relationship cardinality beyond 1:N (many-to-many patterns are future work)
- Whether the warden adds pattern-specific governance rules

## References

- ADR: Schema-Derived Persistence (draft) -- the store model that patterns build on
- ADR: Declarative Search (draft) -- search as a derived trail from store declarations
- [ADR-0003: Unified Trail Primitive](../0003-unified-trail-primitive.md) -- patterns produce standard trails
- [ADR-0004: Intent as a First-Class Property](../0004-intent-as-first-class-property.md) -- intents are derived per operation
- [ADR-0000: Core Premise](../0000-core-premise.md) -- author what's new, derive what's known
