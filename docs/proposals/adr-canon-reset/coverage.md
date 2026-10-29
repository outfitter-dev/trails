# Source-to-canon disposition ledger

Baseline: `3cb861758b897562c7e32d9ad01a6d6f217d780d`. 56 numbered records; 21 dated drafts. All cutoff drafts receive historical snapshots independently of their active disposition. No files have moved.

Links for ADRs 0012, 0022, 0029, and 0030 point to the source inventory, which preserves their exact historical filenames without teaching retired package vocabulary in active prose.

Homes refer to [outline.md](outline.md). Draft recommendations do not change current status. Historical-only records contribute lineage, not independent law. Draft dispositions use the TRL-995 vocabulary; multiple dispositions split implemented substance from residual future work.

## Numbered records

| Source | Status | Proposed homes | Surviving substance and limits |
| --- | --- | --- | --- |
| [0000](../../../docs/adr/0000-core-premise.md) | accepted | N02 | Core invariants; reconcile incoming deployment scope and replace stale terms/artifact paths. |
| [0001](../../../docs/adr/0001-naming-conventions.md) | accepted | N03 | Structural grammar, accessor verbs, paths and scope distinctions; current lexicon owns current words. |
| [0002](../../../docs/adr/0002-built-in-result-type.md) | accepted | N05 | Shared Result construction/serialization; current owner taxonomy replaces duplicated tables. |
| [0003](../../../docs/adr/0003-unified-trail-primitive.md) | accepted | N04 | One trail replaces hike; typed objects plus dynamic string escape hatch replace string-only prose. |
| [0004](../../../docs/adr/0004-intent-as-first-class-property.md) | accepted | N04 | Read/write/destroy and orthogonal idempotency; surface mappings derive from owner facts. |
| [0005](../../../docs/adr/0005-framework-agnostic-http-route-model.md) | accepted | N17 | Framework-neutral HTTP routes survive; old package examples become history. |
| [0006](../../../docs/adr/0006-shared-execution-pipeline.md) | accepted | N06 | One execution pipeline survives; use current layers/permits/resources/recovery, not obsolete stage order. |
| [0007](../../../docs/adr/0007-governance-as-trails.md) | accepted | N19 | Rules are trails, source analysis uses AST, diagnostics are structured data. |
| [0008](../../../docs/adr/0008-deterministic-trailhead-derivation.md) | accepted | N17 | Pure deterministic surface derivation; reconcile current overlays/accommodations. |
| [0009](../../../docs/adr/0009-first-class-resources.md) | accepted | N07 | Declared resource lifecycle, typed access, eager resolution, mocks and governance survive. |
| [0010](../../../docs/adr/0010-native-infrastructure.md) | partially-superseded | N07, N08, N09, N16, N18 | Partial supersession: inspectable infrastructure/bootstrap survive. Retire mandatory trifecta, old state paths and package splits; incoming auth remains explicit. |
| [0011](../../../docs/adr/0011-schema-driven-config.md) | accepted | N08, N16 | Deployment config and provenance survive; static `workspace.apps` identity is specialized by ADR-0054. Resource config schemas compose into typed context; config.ref lazy trail defaults survive. |
| [0012](evidence/inventory.json) | accepted | N09 | Authored policy, resolved permits, extraction/enforcement separation survive. Incoming OAuth/CLI changes must reconcile bearer-only scope. |
| [0013](../../../docs/adr/0013-tracing.md) | partially-superseded | N18 | Partial supersession: recording, sampling and lineage survive under current core/observability ownership. |
| [0014](../../../docs/adr/0014-core-database-primitive.md) | accepted | N16 | Shared SQLite, restricted writes and subsystem ownership survive; repo-local placement does not. Owner-only shared-SQLite writes and read-only consumer access remain explicit. |
| [0015](../../../docs/adr/0015-topo-store.md) | accepted | N14, N16 | Queryable graph, snapshots/pins and read-only analysis survive; current artifact authority follows ADR-0054. |
| [0016](../../../docs/adr/0016-schema-derived-persistence.md) | accepted | N11 | Schema-first store becomes resource when bound; backend-neutral protocol replaces SQL assumptions. |
| [0017](../../../docs/adr/0017-serialized-topo-graph.md) | partially-superseded | N14, N16 | Partial supersession: inspectable committed graph survives; old manifest/content pair and layout do not. |
| [0018](../../../docs/adr/0018-signal-driven-governance.md) | accepted | N12, N19 | Ordinary trails/signals for governance survive. Named framework signal/lock-export examples are absent; dev-intelligence aspirations require explicit disposition. |
| [0019](../../../docs/adr/0019-hierarchical-command-trees-from-trail-ids.md) | accepted | N17 | Full dotted command paths, executable parents, explicit overrides and graph visibility survive. |
| [0020](../../../docs/adr/0020-flags-for-fields-structured-input-on-the-cli.md) | accepted | N17 | Truthful flags/positionals, structured input channels and one validation boundary survive. |
| [0021](../../../docs/adr/0021-draft-state-stays-out-of-the-resolved-graph.md) | accepted | N20 | Draft markers, contamination/exclusion, visible debt and promotion survive independently of ADR prose status. |
| [0022](evidence/inventory.json) | accepted | N11, N13 | Store binding and SQLite/Drizzle example survive; with-drizzle name historical, backend procedure stays in fieldguide. |
| [0023](../../../docs/adr/0023-simplifying-the-trails-lexicon.md) | accepted | N03 | Brand-versus-plain heuristic survives; historical term census does not. |
| [0024](../../../docs/adr/0024-typed-trail-composition.md) | accepted | N04 | Typed and dynamic composition, composition-only input and merged validation survive. |
| [0025](../../../docs/adr/0025-composition-testing.md) | accepted | N23 | Examples, assertion strengths, subset semantics, scenarios/references and real-pipeline testing survive. |
| [0026](../../../docs/adr/0026-error-taxonomy-as-transport-independent-behavior-contract.md) | accepted | N05 | Taxonomy behavior and complete mappings survive; keep current class/code tables owner-derived. |
| [0027](../../../docs/adr/0027-visibility-and-filtering.md) | accepted | N17 | Public/internal visibility, selectors, intent/profiles/permits and subtractive exposure survive under current overlay rules. |
| [0028](../../../docs/adr/0028-concurrent-crossing.md) | accepted | N04, N06 | Ordered all-branch results, bounded concurrency and independent branch resource scopes survive. |
| [0029](evidence/inventory.json) | accepted | N13 | Native/third-party binding boundaries and dependency direction survive; with-* packaging historical. |
| [0030](evidence/inventory.json) | accepted | N10 | Domain identity/schema/examples survive as entity; the former domain-object name is historical. Preserve typed .id() references/branded identity, structural reference edges and operational trail/entity relationships. |
| [0031](../../../docs/adr/0031-backend-agnostic-store-schemas.md) | accepted | N11 | Backend-neutral schema, binding realization, versions and change signals survive. |
| [0032](../../../docs/adr/0032-derivetrail-and-trail-factories.md) | accepted | N10 | Factories produce ordinary trails; deriveTrail is lower-level, domain packages own families. |
| [0033](../../../docs/adr/0033-detour-execution-for-recovery.md) | accepted | N05, N06 | Typed ordered bounded detours, retryability overrides and exhaustion survive; narrow reconcile exception remains. |
| [0034](../../../docs/adr/0034-store-accessor-contract-refinement-lessons-from-two-backends.md) | accepted | N11 | Portable equality, accessor tiers, identity/generated fields, versions and correctness-only pagination survive. |
| [0035](../../../docs/adr/0035-surface-apis-render-the-graph.md) | accepted | N17 | Derive/create/surface responsibility ladder survives; update examples to current exports. |
| [0036](../../../docs/adr/0036-warden-rules-ship-only-as-trails.md) | accepted | N19 | Public rule trails and registry; raw rule objects stay private. |
| [0037](../../../docs/adr/0037-owner-first-authority.md) | accepted | N13, N19 | One typed owner and rule-local policy boundary survive; merge ownership law with ADR-0051. |
| [0038](../../../docs/adr/0038-typed-signal-emission.md) | accepted | N12 | Typed signals, producer/consumer edges and observable consumer failures survive. |
| [0039](../../../docs/adr/0039-reactive-trail-activation.md) | accepted | N12 | Activation is ordinary invocation; source declaration and runtime materialization remain distinct. Guards filter without transforming input; payload validation and context/trace provenance remain intrinsic. |
| [0040](../../../docs/adr/0040-resource-scoped-store-signal-identity.md) | accepted | N11, N12 | Resource-scoped derived signal identity and late binding survive; ambiguous binding fails closed. |
| [0041](../../../docs/adr/0041-unified-observability.md) | accepted | N18 | Current observability owner split survives; removed compatibility package is history. |
| [0042](../../../docs/adr/0042-core-topography-boundary-doctrine.md) | accepted | N14 | Core in-memory versus Topography durable facts; runtime artifact independence remains law. |
| [0043](../../../docs/adr/0043-layer-evolution.md) | accepted | N06 | Fixed framework stages, declared layer inputs and implementation isolation survive. |
| [0044](../../../docs/adr/0044-trail-versioning.md) | superseded | Historical lineage: N21 | Explicitly superseded by ADR-0048; no independent normative clauses, only versioning lineage. |
| [0045](../../../docs/adr/0045-v1-resolved-graph-error-scope.md) | accepted | N05, N14 | Authored/derived/inferred/observed distinction; no exhaustive runtime-error claims. |
| [0046](../../../docs/adr/0046-lock-v3-artifact-family.md) | superseded | Historical lineage: N14, N16 | Explicitly superseded by ADR-0054; preserve durable-graph/migration rationale through successor, not old container/layout. |
| [0047](../../../docs/adr/0047-stable-release-line-discipline.md) | accepted | N24 | Lockstep family and 0.x compatibility survive; one-time source reset is historical. Preserve latest/explicit-prerelease policy, visible retirement, cold scaffold gate, publish-role split and evidenced partial-publish recovery. |
| [0048](../../../docs/adr/0048-trail-versioning-v3.md) | accepted | N21 | Sole current versioning model: explicit historical schemas, revisions/forks, lifecycle, markers and negotiation. |
| [0049](../../../docs/adr/0049-composition-is-compose-not-cross.md) | accepted | N03, N04 | Current compose vocabulary survives; migration story historical. |
| [0050](../../../docs/adr/0050-surface-accommodations-preserve-trail-identity.md) | accepted | N17 | Identity/fork test survives through current scalar/list overlay carrier. |
| [0051](../../../docs/adr/0051-package-ownership-follows-natural-altitude.md) | accepted | N13 | One natural reusable owner; consumers compose rather than reimplement. |
| [0052](../../../docs/adr/0052-overlays-one-extension-mechanism.md) | accepted | N15, N17 | One extension/provenance/hash/preservation mechanism; app-authored binding authority and shared collection survive. |
| [0053](../../../docs/adr/0053-regrade-moves-governed-contract-change.md) | accepted | N19, N22 | Owner facts, reviewable plans, conservative apply, compact immutable receipts and durable governance survive. |
| [0054](../../../docs/adr/0054-project-substrate-names-its-truth.md) | accepted | N08, N16 | App-owned locks, static identity, partitioned views, machine-local observations and proven freshness survive. Preserve shared operator selection/context, root/app/config/module precedence, command cardinality and provenance, plus project/working-tree/collection-root distinctions. |
| [0055](../../../docs/adr/0055-mcp-stateless-core-on-sdk-v2.md) | accepted | N25 | Accepted target-state must survive; implementation gaps do not downgrade status or prove delivery. |

## Dated drafts

| Source | Substance homes | Disposition | Rationale and residual work |
| --- | --- | --- | --- |
| [20260331-direct-invocation.md](../../../docs/adr/drafts/20260331-direct-invocation.md) | N06, N17 | absorb-active-canon, replace-with-thinner-draft | Fold verified full-pipeline invocation; retain only unresolved operator ergonomics. Old option/vocabulary inventory historical. |
| [20260331-external-trailheads-as-trails.md](../../../docs/adr/drafts/20260331-external-trailheads-as-trails.md) | Future/policy only | keep-active-future-draft | Rewrite rig/external integration factories around ordinary trails; current API and need remain unratified. |
| [20260331-pack-resources.md](../../../docs/adr/drafts/20260331-pack-resources.md) | Future/policy only | keep-active-future-draft | TRL-995 retains this as a future draft depending on rewritten pack boundaries. Refresh resource vocabulary; do not silently consolidate away the candidate. |
| [20260331-packs-namespace-boundaries.md](../../../docs/adr/drafts/20260331-packs-namespace-boundaries.md) | Future/policy only | keep-active-future-draft | TRL-995 keeps pack as an intentional working brand/primitive candidate. Rewrite the first future pack-boundary draft; acceptance still needs the few-primitives test. |
| [20260331-websocket-trailhead.md](../../../docs/adr/drafts/20260331-websocket-trailhead.md) | Future/policy only | keep-active-future-draft | TRL-1166 replaces custom envelope/process-local replay with RPC direction; durable subscription owner controls replay. |
| [20260401-declarative-search.md](../../../docs/adr/drafts/20260401-declarative-search.md) | Future/policy only | keep-active-future-draft | Keep search proposal; refresh store/role/adapter boundaries underTRL1552 before ratification. |
| [20260406-documentation-freshness.md](../../../docs/adr/drafts/20260406-documentation-freshness.md) | Future/policy only | keep-active-future-draft | TRL-995 reframes this as documentation-as-a-service/docs-governance exploration, not just freshness SLAs. Routine policy may live in contributor guidance; preserve the framework-facing future idea. |
| [20260406-documentation-structure.md](../../../docs/adr/drafts/20260406-documentation-structure.md) | Future/policy only | needs-decision | Preserve enough for a docs-structure baseline ADR or issue per TRL-995. Whether it belongs in active product canon remains an explicit owner decision; routine policy belongs in contributing guidance. |
| [20260409-resource-bundles.md](../../../docs/adr/drafts/20260409-resource-bundles.md) | N07 | replace-with-thinner-draft | Keep a future grouped resource defaults/overrides stub per TRL-995. Factory-not-primitive insight may feed N07; do not overcommit to historical mechanics. |
| [20260503-wayfinding.md](../../../docs/adr/drafts/20260503-wayfinding.md) | N14 | absorb-active-canon | Current Wayfinder ownership/query model feeds N14; speculative residue stays explicit, old draft not automatically ratified. |
| [20260524-scaffold-forward-compatibility.md](../../../docs/adr/drafts/20260524-scaffold-forward-compatibility.md) | N16, N24 | absorb-active-canon, replace-with-thinner-draft | Carry verified pin/provenance/lifecycle principles after cutoff check; public upgrade tooling remains future. |
| [20260528-adapter-authoring-as-a-paved-path.md](../../../docs/adr/drafts/20260528-adapter-authoring-as-a-paved-path.md) | N13, N23 | absorb-active-canon, keep-active-future-draft | Owner-export/conformance principles feed canon; unfinished catalog/scaffolding remains future; no runtime adapter primitive. |
| [20260530-fixes-are-warden-diagnostic-metadata.md](../../../docs/adr/drafts/20260530-fixes-are-warden-diagnostic-metadata.md) | N19, N22 | absorb-active-canon | Current Warden fix metadata and Regrade consumption verified;0053 owns evolved lifecycle. |
| [20260603-one-schema-trail-input.md](../../../docs/adr/drafts/20260603-one-schema-trail-input.md) | N04 | absorb-active-canon | TRL-884 Done plus 851a2a3cb/current source support schema-owned caller/materialized typing; preserve type-cost/schema restrictions. |
| [20260603-surface-trailheads-shape-dense-topos.md](../../../docs/adr/drafts/20260603-surface-trailheads-shape-dense-topos.md) | N17 | absorb-active-canon | Preserve identity/visibility; retire standalone grouped carrier in favor of ADR-0052 overlays. |
| [20260608-release-provenance-as-lifecycle-derivation.md](../../../docs/adr/drafts/20260608-release-provenance-as-lifecycle-derivation.md) | N24 | absorb-active-canon | Facts/rules/intent/output distinction survives; current stack policy replaces Graphite-specific mechanics. |
| [20260612-library-surface-and-compiler.md](../../../docs/adr/drafts/20260612-library-surface-and-compiler.md) | N17 | absorb-active-canon, replace-with-thinner-draft | Runtime library surface and shared compiler plan exist; future binary/compiled aspirations remain separate. |
| [20260612-verdicts-run-on-stable-ground.md](../../../docs/adr/drafts/20260612-verdicts-run-on-stable-ground.md) | N05, N19 | absorb-active-canon, replace-with-thinner-draft | shift error and repo tree guard exist; public warden guard command remains future. |
| [20260613-cli-command-routes.md](../../../docs/adr/drafts/20260613-cli-command-routes.md) | N17 | absorb-active-canon | Same-contract route normalization survives; current overlay carrier replaces parallel alias exports. |
| [20260829-wayfinder-mcp-graph-as-resources.md](../../../docs/adr/drafts/20260829-wayfinder-mcp-graph-as-resources.md) | N14, N25 | keep-active-future-draft | Shared query ownership feeds canon; MCP URI/resource rendering remains incoming unless cutoff source proves it. |
| [20261028-merge-friendly-lock-v6.md](../../../docs/adr/drafts/20261028-merge-friendly-lock-v6.md) | Future/policy only | keep-active-future-draft | TRL-1424 Done for drafting only; retain lossless saved-library, overlay/force retention and migration checks; no v6 delivery claim. |

## Limits

This ledger proves file-level coverage, not exhaustive clause-level equivalence. The actual rewrite must compare every normative clause against its immutable cutoff and resolve the obligations named in outline.md. A file with a destination is not by itself proof that all its rules survived.
