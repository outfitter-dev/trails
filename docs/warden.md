# Warden

Warden is Trails' correctness surface. It catches code-level framework drift, reports stale topo lock state, and exposes built-in rules as trails so governance stays inspectable and composable.

Structural graph checks that can be answered from the resolved topo belong in `validateTopo()` from `@ontrails/core`. Warden owns checks that need source inspection, project context, topo-aware analysis, or drift reporting.

Use [Rule Design](./rule-design.md) when authoring or auditing rules. It defines
the survival tests, owner-data expectations, and family-collapse criteria for
durable rules.

## Rule Homes

Use Warden for durable Trails correctness:

- trail, blaze, `Result`, detour, resource, topo, or surface doctrine
- checks that compare declarations to actual usage, such as `crosses` or `resources`
- checks that need project-wide context or the resolved topo
- checks that should be available through the public Trails CLI or programmatic Warden API
- checks whose rule shape should itself remain a Trails trail

Use the private `@ontrails/oxlint-plugin` package for repo-local hygiene:

- temporary cleanup checks used during hardening
- house-style preferences for this repository, not Trails consumers
- file-local checks that are useful through Ultracite/Oxlint editor feedback
- checks that do not need topology, derivation, runtime invocation, or cross-trail comparison

The private plugin is a convenience for this repo. It is not a consumer-facing dependency, and it should not become the place where framework doctrine quietly accumulates.

## Warden Tiers

Warden rules can operate at several levels:

- **Source-static** rules inspect one file at a time.
- **Project-static** rules inspect source with package or project context.
- **Topo-aware** rules inspect the resolved topo.
- **Drift** checks compare generated artifacts with current source truth.
- **Advisory** checks point at incomplete or risky framework usage without necessarily failing the build.

The tier affects execution shape, not ownership. A source-static check can still be Warden-owned when it enforces public Trails semantics.

## Authoring Durable Rules

Durable Warden rules should explain the doctrine they enforce. When adding one:

1. Name the Trails concept the rule protects.
2. Decide the narrowest tier that can answer the question.
3. Keep framework knowledge in owner modules when possible instead of duplicating string lists inside the rule.
4. Wrap built-in rules as trails, in line with [ADR-0036](./adr/0036-warden-rules-ship-only-as-trails.md).
5. Add TSDoc to exported helpers, rule types, and public rule factories when the contract is not obvious from the type.
6. Add examples or focused tests that show both the accepted shape and the diagnostic shape.

Rule-owned deny lists are still allowed when they are intentionally policy, not duplicated framework data. For example, a curated set of forbidden surface type names can remain local to a rule until another independent consumer needs the same list.

## Repo-Local Oxlint Plugin

The repo-local plugin lives in `packages/oxlint-plugin`, builds to `dist`, and is loaded by the root `oxlint.config.ts`. The root format scripts build it before Ultracite loads the config.

Current local rules are intentionally low-blast:

- `no-console-in-packages` keeps package code quiet, with logging as the explicit owner.
- `no-process-exit-in-packages` keeps hard exits out of packages except the CLI.
- `no-process-env-in-packages` keeps environment access close to config, CLI, core, and logging boundaries.
- `no-deep-relative-import` discourages fragile upward imports.
- `no-nested-barrel` starts permissive with `maxDepth: 2`.
- `prefer-bun-api` nudges agents toward Bun-native APIs where the mapping is clear.
- `snapshot-location` keeps snapshots near the tests that own them.
- `test-file-naming` keeps test discovery predictable.

If a local rule starts enforcing Trails semantics rather than repository hygiene, promote the idea to Warden or write a follow-up issue explaining why it should stay local.

## Deferred Tightening

Progressive hygiene belongs in separate issues with baselines and deletion triggers. Current follow-ups:

- `TRL-550` evaluates progressive `max-file-lines` enforcement.
- `TRL-551` audits whether nested barrels can tighten from `maxDepth: 2` to `maxDepth: 1`.
- `TRL-552` evaluates additional `prefer-bun-api` mappings.

These stay out of the initial rule branch because each one needs evidence before it becomes policy.
