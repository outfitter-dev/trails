# Warden Guidance For Trails Skills

<!-- GENERATED: run `bun run warden:skills:sync`; check with `bun run warden:skills:check`. -->

This file is generated from the live `@ontrails/warden` rule manifest. Repo-tracked skills, agents, and plugin prompts should reference this file instead of copying rule prose by hand.

- Guide input command: `bun apps/trails/bin/trails.ts warden guide --agent-json`
- Rule count: 57

## Agent Instructions

- Treat Warden rules as enforceable Trails doctrine when working in this repository.
- Prefer the rule guidance summary and ordered steps over diagnostic prose when deciding how to remediate a finding.
- When guidance is absent, use the invariant, concern, tier, and scope as classification metadata rather than inventing a rule-specific fix.
- Treat `docs/tenets.md`, `docs/lexicon.md`, and `AGENTS.md` as higher-authority orientation when prose conflicts with generated rule summaries.
- Do not manually duplicate the rule index into skill prompts. Refresh this file when Warden metadata changes.

## Rule Index

### Composition

- `context-no-surface-types` (error, source/source-static, external): Trail logic stays surface-agnostic.
- `cross-declarations` (error, source/source-static, external): Declared crosses stay aligned with ctx.cross() usage.
- `dead-internal-trail` (warn, project/project-static, external): Internal trails should be reachable through declared crosses.
- `intent-propagation` (warn, project/project-static, external): Composite trail intent cannot be safer than crossed trails.
- `missing-visibility` (warn, project/project-static, external): Composition-only trails declare internal visibility.
- `no-destructured-cross` (warn, source/source-static, external): Trail blazes compose through ctx.cross() directly instead of destructuring cross from the context.
- `no-direct-implementation-call` (warn, source/source-static, external): Application code composes trails through ctx.cross().
- `resolved-import-boundary` (error, project/project-static, external): Cross-package imports resolve through public export maps.
- `version-pinned-cross` (warn, source/source-static, external): Version-pinned ctx.cross() calls stay visible migration debt.
- `webhook-route-collision` (error, topo/topo-aware, external): Webhook routes do not collide with each other or direct HTTP trail routes.

### General

- `circular-refs` (warn, project/project-static, external): Contour reference graphs must be acyclic.
- `contour-exists` (error, project/project-static, external): Declared contour references resolve to known contours.
- `example-valid` (error, source/source-static, external): Trail examples remain valid against their authored schema. Guidance: Keep trail examples synchronized with their authored schemas.
- `incomplete-accessor-for-standard-op` (error, topo/topo-aware, external): Standard CRUD operations expose the expected accessor shape.
- `incomplete-crud` (warn, project/project-static, external): Versioned CRUD entities expose complete operation coverage.
- `layer-field-name-drift` (error, source/source-static, external): Layer input field reserved names are shared across surface projections.
- `no-legacy-layer-imports` (error, source/source-static, external): Legacy layer exports removed across TRL-475/TRL-476 (authLayer, autoIterateLayer, dateShortcutsLayer) do not reappear in committed source.
- `owner-projection-parity` (error, source/source-static, internal): Framework projections stay aligned with owner exports.
- `prefer-schema-inference` (warn, all/source-static, advisory): Trail schemas should be inferred unless overrides add meaning. Guidance: Let schemas remain the owner for field metadata unless an override adds new information.
- `public-internal-deep-imports` (error, project/project-static, internal): Cross-package imports stay on package-owned public exports.
- `public-union-output-discriminants` (error, topo/topo-aware, external): Public output object unions expose branch discriminants.
- `reference-exists` (error, project/project-static, external): Reference declarations resolve to known contours.
- `unreachable-detour-shadowing` (error, source/source-static, external): Specific detours are not shadowed by earlier broader detours.
- `valid-describe-refs` (warn, all/project-static, advisory): Describe references point at known Trails concepts.
- `warden-export-symmetry` (error, source/source-static, repo-local): The Warden package exports trail wrappers, not raw rules.
- `warden-rules-use-ast` (error, source/source-static, repo-local): Warden source rules use AST helpers instead of ad hoc parsing.

### Lifecycle

- `deprecation-without-guidance` (error, topo/topo-aware, external): Deprecated trail version entries carry successor, migration, or note guidance.
- `draft-file-marking` (error, source/source-static, external): Draft-authored state is visibly marked in filenames.
- `draft-visible-debt` (warn, source/source-static, external): Draft-authored IDs remain visible debt.
- `fork-without-preserved-blaze` (error, source/source-static, external): Fork version entries preserve their historical blaze.
- `marker-schema-unsupported` (error, source/source-static, external): Versioned schemas stay inside the supported marker projection subset.
- `pending-force` (warn, topo/topo-aware, external): Forced topo break audit events do not remain pending indefinitely.
- `scheduled-destroy-intent` (warn, topo/topo-aware, external): Schedule-activated destroy trails make unattended destructive work visible for review.
- `unmaterialized-activation-source` (warn, topo/topo-aware, external): Activation sources have an available runtime materializer before runtime delivery is assumed.
- `version-gap` (error, topo/topo-aware, external): Trail version coverage remains contiguous through the current version.
- `version-without-examples` (warn, topo/topo-aware, external): Live historical version entries include examples.

### Permits

- `no-dev-permit-in-source` (error, source/source-static, external): The `--dev-permit` CLI flag string never appears in committed source.
- `permit-governance` (warn, topo/topo-aware, external): Destroy trails declare explicit permit requirements. Guidance: Make destructive trail authorization visible on the trail contract.

### Resources

- `missing-reconcile` (warn, project/project-static, external): Versioned CRUD store tables provide reconcile coverage.
- `resource-declarations` (error, source/source-static, external): Resource usage is declared on the trail contract. Guidance: Keep infrastructure dependencies declared on the trail contract.
- `resource-exists` (error, project/project-static, external): Declared resources resolve to known resource definitions. Guidance: Make declared resources resolve to authored resource definitions.
- `resource-id-grammar` (error, source/source-static, external): Resource identifiers stay out of the scope separator grammar.
- `static-resource-accessor-preference` (warn, all/source-static, advisory): Trail logic should prefer static resource helpers over dynamic accessors. Guidance: Use statically scoped resource helpers when the resource definition is already available.

### Results

- `error-mapping-completeness` (error, source/source-static, extension): Registered surface error mappers cover every error category.
- `implementation-returns-result` (error, source/source-static, external): Blazes return Result values.
- `no-native-error-result` (error, source/source-static, external): Result error boundaries carry specific TrailsError subclasses.
- `no-sync-result-assumption` (error, source/source-static, external): Result accessors are not used before async results are awaited.
- `no-throw-in-detour-recover` (error, source/source-static, external): Detour recovery returns Result instead of throwing.
- `no-throw-in-implementation` (error, source/source-static, external): Blazes return Result.err() instead of throwing. Guidance: Convert thrown failures in blazes into explicit Result.err() outcomes.
- `public-output-schema` (error, topo/topo-aware, external): Public MCP/HTTP surface trails declare output schemas. Guidance: Make public surface result contracts explicit before MCP/HTTP projection.
- `valid-detour-contract` (error, topo/topo-aware, external): Runtime detour contracts use error constructors and recover functions.

### Signals

- `activation-orphan` (warn, topo/topo-aware, external): Signal activation consumers reference sources with producer declarations.
- `fires-declarations` (error, source/source-static, external): Declared fires stay aligned with signal firing usage.
- `on-references-exist` (error, project/project-static, external): Trail on: declarations resolve to known signals.
- `orphaned-signal` (warn, project/project-static, external): Derived store signals are consumed by matching trail on: consumers.
- `read-intent-fires` (warn, source/source-static, external): Read trails should not declare signal fires side effects.
- `signal-graph-coaching` (warn, topo/topo-aware, external): Typed signal contracts either declare a producer or participate in reactive consumption.
