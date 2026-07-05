# packlist

Gear & trip checklists — the "show me a normal app" Trails showcase. Three entities, a schema-derived store, factory CRUD, derived signals, and an honest schema-versioning walkthrough.

## What this showcases

| Capability | Where it appears |
| --- | --- |
| Schema-derived store, three versioned tables | [`src/store.ts`](src/store.ts) — `gear`, `pack`, `trip` with fixtures and generated ids |
| SQLite resource + zero-config mock | [`src/resources/db.ts`](src/resources/db.ts) — file-backed at runtime, in-memory for `testAll` |
| CRUD factory | [`src/trails/pack.ts`](src/trails/pack.ts), [`src/trails/trip.ts`](src/trails/trip.ts) — five trails per table, derived from the table definition |
| Hand-authored trails that tighten the contract | [`src/trails/gear.ts`](src/trails/gear.ts) — duplicate-name conflict, error-path examples |
| **Trail versioning (the hero)** | [`src/trails/gear.ts`](src/trails/gear.ts) — `gear.create` v1 (`weightOz`) → v2 (`weightGrams`) with a preserved fork blaze |
| Store-derived signals | `db:gear.updated` and friends — emitted by the store resource, no hand-rolled plumbing |
| Authored signal + reactive consumer | [`src/signals.ts`](src/signals.ts), [`src/trails/weight.ts`](src/trails/weight.ts) — `gear.update` fires `pack.weight-stale`, `pack.recalculate` consumes it |
| Compose | [`src/trails/weight.ts`](src/trails/weight.ts) (`pack.weight` → `gear.read`), [`src/trails/trip.ts`](src/trails/trip.ts) (`trip.checklist` → `pack.read` + `gear.list`) |
| Reconcile per versioned table | [`src/trails/reconcile.ts`](src/trails/reconcile.ts) |
| Examples-as-tests | every hand-authored trail carries success and error examples; [`__tests__/contract.test.ts`](__tests__/contract.test.ts) is one line of `testAll` |
| Error taxonomy | NotFound / Validation / Conflict — one class, three surface mappings (table below) |
| Surfaces | [`bin/packlist.ts`](bin/packlist.ts) (CLI), [`src/http.ts`](src/http.ts) (HTTP), [`src/mcp.ts`](src/mcp.ts) (MCP) |

## Quickstart

From a fresh checkout of the repo:

```bash
bun install
cd examples/packlist

bun bin/packlist.ts seed demo
bun bin/packlist.ts gear ls
bun bin/packlist.ts gear add --name "Rain Shell" --category wear --weight-grams 310
bun bin/packlist.ts pack add-gear --pack-id pack-weekend --gear-id gear-bearcan --quantity 1
bun bin/packlist.ts pack weight --pack-id pack-weekend
bun bin/packlist.ts gear update --id gear-stove --weight-grams 250
bun bin/packlist.ts trip checklist --id trip-lostcoast
```

Every command, flag, alias (`gear ls`, `gear get`, `gear add`), and exit code above is derived from the trail contracts — there is no hand-rolled argument parsing in this app.

The `gear update` step is the reactive loop firing in plain sight. Because the stove rides in Weekend Loop, the weight change fires `pack.weight-stale`, and the `pack.recalculate` consumer recomputes the pack before the command returns:

```text
[packlist] info pack "Weekend Loop" recalculated: 2990 g (Canister Stove: 220 g → 250 g) {"packId":"pack-weekend"}
```

The final command prints the trip checklist — pack items joined with current gear weights:

```json
{
  "packName": "Weekend Loop",
  "rows": [
    { "category": "shelter", "name": "Tent", "packed": false, "quantity": 1, "weightGrams": 1800 },
    { "category": "cook", "name": "Canister Stove", "packed": false, "quantity": 1, "weightGrams": 250 },
    { "category": "carry", "name": "Bear Canister", "packed": false, "quantity": 1, "weightGrams": 940 }
  ],
  "totalWeightGrams": 2990,
  "tripId": "trip-lostcoast",
  "tripName": "Lost Coast"
}
```

### The same data over HTTP

Routes, verbs, and error statuses derive from the same contracts. In a second terminal (the first one keeps the server):

```bash
bun run http
```

```bash
curl -s 'http://localhost:3210/trip/checklist?id=trip-lostcoast'
```

The response is the same checklist the CLI printed, served from the same SQLite file.

### The MCP surface cost zero lines

That is the demo point: [`src/mcp.ts`](src/mcp.ts) is only the `surface(graph)` call — every tool name, JSON Schema, and annotation is derived. Register it with any MCP client, for example:

```bash
claude mcp add packlist -- bun /path/to/trails/examples/packlist/src/mcp.ts
```

Then call the `packlist_trip_checklist` tool with `{ "id": "trip-lostcoast" }` to get the same checklist a third way.

## The versioning walkthrough

Nobody demos schema versioning honestly, so here it is with real history. `gear.create` v1 shipped with `weightOz`. The v2 contract moved to `weightGrams`. Both live on the same trail in [`src/trails/gear.ts`](src/trails/gear.ts) — and the v1 world is real committed history on this branch, not a retrofit.

**Here's v1** — preserved as a fork entry with its own blaze, so the old contract still runs exactly as it used to (ounces in, ounces out, converted to grams at the store boundary):

```ts
version: 2,
versions: {
  1: {
    blaze: async (rawInput, ctx) => {
      // accepts weightOz, stores grams, reports weightOz back
    },
    input: gearCreateV1Input,          // { name, category, weightOz, notes? }
    output: gearEntityV1Schema,        // { ..., weightOz }
    examples: [ /* v1 success + conflict examples — still tested */ ],
    status: {
      state: 'deprecated',
      successor: 2,
      migration: [
        'Send weightGrams instead of weightOz (1 oz = 28.3495 g).',
        'Read weights back in grams; v2 responses no longer include weightOz.',
      ],
      note: 'v1 stays callable through version negotiation while integrations move to grams.',
    },
  },
},
```

**Here's the v2 migration in action.** The current contract takes grams; the deprecated version is still callable by number:

```bash
bun bin/packlist.ts gear create --trail-version 1 \
  --input-json '{"name":"Ultralight Tarp","category":"shelter","weightOz":16}'
```

```json
{
  "category": "shelter",
  "id": "…",
  "name": "Ultralight Tarp",
  "version": 1,
  "weightOz": 16
}
```

The row lands in the store in grams (`453.592`); the v1 caller keeps seeing ounces.

**Here's what the warden says.** Four rules govern this history, and the app passes all of them:

- `version-gap` (error) — coverage must be contiguous from v1 through the current version. Skip a number and the build fails.
- `fork-without-preserved-blaze` (error) — a historical entry must either preserve its blaze (fork) or declare a `transpose` (revision). Deleting the v1 blaze without one fails.
- `deprecation-without-guidance` (error) — drop the `successor`/`migration`/`note` guidance from the deprecated entry and warden reports: `Trail "gear.create@1" is deprecated without successor, migration, or note guidance.`
- `version-without-examples` (warn) — live historical versions keep their examples, and `testAll` executes them (they run here as `gear.create@1` targets).

Versioned contracts also stay inside the marker-safe schema subset (`marker-schema-unsupported`): plain objects, primitives, enums, optionals — which is why the gear schemas look deliberately boring.

## Errors: one class, three mappings

The blaze returns `Result.err(new NotFoundError(...))` once; every surface derives its own representation:

| Error | CLI exit code | HTTP status | MCP |
| --- | --- | --- | --- |
| `NotFoundError` (missing id) | 2 | 404 | error result, `category: not_found` |
| `ValidationError` (e.g. `--quantity 0`) | 1 | 400 | error result, `category: validation` |
| `AlreadyExistsError` (duplicate gear name) | 3 | 409 | error result, `category: conflict` |

Try it: `bun bin/packlist.ts gear get --id nope; echo $?` prints `2`.

## Tests and governance

```bash
bun test          # testAll(graph) + the signals-loop test, against the mocked db
bun run warden    # 0 errors; scoped to this app's topo and sources
```

The committed [`trails.lock`](trails.lock) is the compiled story of the app. Wayfinder answers questions from it without loading source:

```bash
bun ../../apps/trails/bin/trails.ts wayfind pattern "gear.*" --root-dir .
```

Regenerate the lock after contract changes:

```bash
bun ../../apps/trails/bin/trails.ts compile --root-dir . \
  --permit '{"id":"packlist-build","scopes":["topo:write"]}'
```

## Notes

- Write and destroy trails declare a `packlist:write` permit; each surface entry point injects a local operator permit, so there is no auth UX here (the `junction` showcase owns the real permits story).
- The runtime database is a local `packlist.sqlite` file (override with `PACKLIST_DB`); tests and examples run against the in-memory mock and never touch it.
- `totalWeightGrams` is never stored — `pack.weight` derives it from current gear weights on every call.
