# Local Review Lane 1: Scaffold Shape

Score: 5/5

## Scope

- TRL-796 exact generated `@ontrails/*` pins.
- TRL-798 `.trails/scaffold.json` provenance shape.
- Generated scaffold behavior in `apps/trails/src/trails/create-scaffold.ts`
  and `apps/trails/src/__tests__/create.test.ts`.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: registry-backed smoke cannot run `bun test` to completion until the next
  beta publication exposes `@ontrails/testing/established`; local source and
  generated package shape are correct.

## Evidence

- `bun test apps/trails/src/__tests__/create.test.ts` passed 17 tests / 349
  assertions on the stack tip.
- Fresh temp scaffold emitted exact `1.0.0-beta.18` pins for every generated
  `@ontrails/*` dependency/devDependency.
- Fresh temp scaffold emitted `.trails/scaffold.json` with
  `schemaVersion: 1`, `scaffoldVersion: 1.0.0-beta.18`,
  `template: hello`, and an ISO `generatedAt`.
- `bun install` and `bun run typecheck` passed in the temp scaffold.

## Prompt To Fix

No P0/P1/P2 fix prompt needed.
