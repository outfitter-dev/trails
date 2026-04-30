# Draft State

Draft state is Trails' controlled sketching mode. Model future trails, signals, and resources before every dependency exists — without weakening the established graph that powers surfaces, lockfiles, and CI.

## Concept

Top-down authoring is how Trails reads best and how agents naturally work. But eager validation fights that flow: a trail wants to declare `crosses: ['_draft.gist.fork']` before `gist.fork` exists. Draft state lets you reference IDs that don't yet exist, depend on incomplete trails, and iterate freely — within the authored graph only.

The framework exposes two views:

- **Authored graph** — may contain draft state, used for governance and sketching
- **Established graph** — must not contain draft state, used for lockfiles, surfaces, and runtime export

## The `_draft.` marker

Any authored ID may be marked as draft by prefixing it with `_draft.`:

```typescript
'_draft.gist.fork'       // draft trail
'_draft.auth.ready'      // draft signal
'_draft.cache.redis'     // draft resource
```

The marker applies everywhere an authored ID appears: trail declarations, resource declarations, `crosses` references, and signal `from` entries.

## File marking

Draft-bearing files must be visibly marked on disk.

**Files whose primary purpose is draft state — use the `_draft.` prefix:**

```text
_draft.topo.ts
_draft.signals.ts
```

**Otherwise-normal files that contain some draft state — use `.draft.` trailing segment:**

```text
signals.draft.ts
gist.trails.draft.ts
```

Warden's `draft-file-marking` rule enforces this: files with draft IDs must be marked. Unmarked files with draft IDs produce an error.

## Contamination

Draft state has one fundamental rule: **draft contaminates downstream dependencies**.

```text
gist.show              → established
_draft.gist.fork       → draft
gist.export crosses _draft.gist.fork → draft-contaminated
```

The rules:

- Established nodes may depend only on established nodes
- Draft nodes may depend on established or draft nodes
- If an established node depends on a draft node, it becomes **draft-contaminated**
- Contamination propagates transitively

One draft dependency can turn surprising amounts of downstream work into draft state until promoted.

## What draft must never reach

These outputs reject draft state at runtime via `validateEstablishedTopo()`:

- **Surface projection** — no draft trails in current shipped surfaces
- **Lockfile export** — no draft nodes in `.trails/trails.lock`
- **OpenAPI generation** — the HTTP OpenAPI projection excludes draft trails
- **Topo exports** — standard topo accessors exclude draft declarations

## The promotion workflow

`trails draft promote` converts a draft ID to established, rewrites all references, and verifies the result.

### How it works

1. Validates that `fromId` starts with `_draft.` and `toId` does not
2. Scans all TypeScript files (excluding node_modules, dist, .git)
3. Rewrites every string literal matching `fromId` → `toId`
4. Renames draft-marked files if they no longer contain draft IDs
5. Updates relative imports that reference renamed files
6. Loads the topo fresh and runs `deriveDraftReport()` to verify

### Example

```bash
trails draft promote \
  --from-id _draft.entity.prepare \
  --to-id entity.prepare \
  --rename-files true
```

Before:

```typescript
// src/_draft.prepare.ts
export const prepare = trail('_draft.entity.prepare', { ... });

// src/export.ts
export const exportTrail = trail('entity.export', {
  crosses: ['_draft.entity.prepare'],
  ...
});
```

After:

```typescript
// src/prepare.ts (renamed)
export const prepare = trail('entity.prepare', { ... });

// src/export.ts (references updated)
export const exportTrail = trail('entity.export', {
  crosses: ['entity.prepare'],
  ...
});
```

### When promotion partially succeeds

If `promotedEstablished` is false, either the promoted ID still has draft contamination (other draft dependencies need promotion first) or no topo entrypoint could be loaded for verification. Check the `message` field for the specific cause, and use `remainingDraftIds` to decide what to promote next.

## Warden rules

### `draft-file-marking` (error / warning)

Files containing draft IDs must be marked with `_draft.` prefix or `.draft.` segment (error). Conversely, if a draft-marked file no longer contains any draft IDs after promotion, warden warns that the stale marker should be removed.

### `draft-visible-debt` (warning)

Warns when draft IDs remain in source. Intentionally a warning — the hard rejection happens at runtime via `validateEstablishedTopo()`. The warning keeps debt visible during code review.

## Practical patterns

### Starting a draft trail

1. Create a draft-marked file: `src/_draft.sketch.ts`
2. Declare draft IDs: `trail('_draft.auth.login', { ... })`
3. Add to your topo (draft state is allowed in the authored graph)
4. Reference from established trails if needed (they become contaminated until promotion)

### Promoting bottom-up

When multiple draft IDs form a dependency chain, promote the deepest first:

1. Run `deriveDraftReport(topo)` to see the full contamination graph
2. Start with draft IDs that have no draft dependencies
3. Promote each, verify, then move up the chain

### Cleaning up

If a draft trail is no longer needed:

1. Remove the declaration from your topo
2. Delete the draft-marked file
3. Remove references (crosses, from, detours) to the draft ID
4. Run warden to ensure no orphaned references remain

## Reference

- `isDraftId(id)` — returns true if the ID starts with `_draft.`
- `deriveDraftReport(topo)` — returns declared draft IDs, contaminated IDs, dependency graph, and findings
- `validateEstablishedTopo(topo)` — hard layer that rejects draft contamination
- [ADR-0021](adr/0021-draft-state-stays-out-of-the-resolved-graph.md) — the decision and rationale
