# Local Review: Route Vocabulary

Score: 5/5

Scope: `TRL-733` and `TRL-734` route-vocabulary correctness.

## Summary

The review found the route-vocabulary branches doctrinally correct and scoped.
`TRL-733` changes the loose CLI comment to describe a trail becoming a command,
and `TRL-734` removes non-HTTP route wording while preserving legitimate HTTP
route terminology, Warden `webhook-route-collision`, and explicit teaching
mentions where `route` is named as wrong for composition or trail/blaze naming.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: none.

The reviewer noted the `apps/trails/src/trails/create.ts` export rename from
`createRoute` to `createTrail` and did not classify it as a finding because the
app imports the module namespace, `topo()` registers module values, and direct
test imports were updated.

Prompt To Fix With AI: No prompt needed.

Unable to verify: the reviewer did not independently rerun `bun run check`; the
route-specific searches and diffs were verified directly.
