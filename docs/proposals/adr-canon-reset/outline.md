# A new Trails ADR canon

Research proposal, 2026-10-29. Baseline: `3cb861758b897562c7e32d9ad01a6d6f217d780d`. This is a proposed outline for review, not an ADR reset or a ratification of new decisions. The actual reset cutoff remains unset.

## Recommendation

Replace the accumulated numbered corpus with **25 focused records: one reset record and 24 architectural decisions**. Retain a separate future-draft layer. Each new decision should state the surviving rule once, explain the pressure that produced it, and name its consequences. Earlier approaches belong in historical context, not in competing normative sections.

This reduces 56 numbered records without turning the result into a few oversized documents. Composition absorbs its sequential and concurrent forms. Persistence absorbs the lessons from both database and file bindings. Observability absorbs its former package splits. Surface rendering absorbs route derivation, filtering, grouping, aliases, and library rendering. Those consolidations remove historical seams; distinct decisions such as permits, configuration, versioning, and release compatibility retain their own homes.

The proposed reading order tells how the framework acquired responsibilities: a contract becomes runnable, gains infrastructure and domain structure, becomes a queryable graph, reaches several surfaces, and then acquires governance and a controlled evolution path. It is a conceptual progression, not a claim that the decisions happened in this numerical order. The [historical record](history.md) preserves the actual sequence.

The baseline contains **56 numbered ADRs and 21 dated drafts**. Every file has a disposition in [coverage.md](coverage.md), backed by [inventory.json](evidence/inventory.json). Several drafts describe implemented behavior; one accepted decision explicitly describes a target that has not been proved delivered. Decision status and implementation status are separate axes throughout this proposal.

## What the existing reset work already settles

[TRL-983](https://linear.app/outfitter/issue/TRL-983) is Done for agreed reset mechanics. [TRL-994](https://linear.app/outfitter/issue/TRL-994) is Done for a prior planning packet. Neither status means the source reset happened. The older packet's 55-numbered/20-draft census was pinned to `34d7f6e14`; it is not today's denominator. This baseline adds accepted ADR-0055 and the lock-v6 draft.

Keep the settled mechanics:

- Active numbering restarts at `0001` under `docs/adr/`; dated active drafts remain under `docs/adr/drafts/`.
- Historical numbered records use `docs/adr/historical/X(n+1)-original-slug.md`, minimum three digits, preserved gaps, and no overwrite. All cutoff drafts receive separate historical snapshots regardless of their active disposition.
- Historical records remain readable and non-normative. New active ADRs do not cite individual historical ADRs; the reset ADR may link the archive as a whole. The lineage tables in this research packet are migration evidence, not text to paste into new normative ADRs.
- Tooling can land ahead of the reset. Archiving, the reset record, the complete surviving canon, and required active-reference repairs must form one coherent cutover. A reset-only state that loses governing substance must not merge.
- The integration owner captures the full immediate-parent cutoff in a bounded writer window. A changed parent requires refreshed provenance and coverage. This proposal does not choose that cutoff.

The October 28 packets referenced by TRL-994 were unavailable on the research host. Their contents and review results have not been independently reproduced. This proposal uses the live issue records and current source; it does not claim to recover the missing packet.

## How to read the proposed set

`N01` through `N25` are planning identifiers. The filenames below are proposed reset filenames, not files created by this work. A **decision** states what belongs in the new ADR. **Boundary** states what another owner should decide. **Evolution** identifies the useful historical narrative. **Evidence and readiness** distinguish surviving accepted law, implemented draft material recommended for ratification, and accepted targets with remaining work.

The core premise gives the invariants; the focused ADRs own their precise rules. Avoid reproducing method inventories, Warden manifests, package maps, protocol tables, or error-code tables in several ADRs. Those faster-changing facts should come from their current owners and fieldguides.

## The proposed records

### N01 — A clean canon preserves its history

Proposed file: `0001-a-clean-canon-preserves-its-history.md`.

**Decision:** Restart active numbering while retaining an immutable, explicitly historical account of earlier decisions. The new corpus is a coherent statement of current accepted architecture, including accepted target-state obligations. Archival transforms are recorded; history cannot silently become active law through indexes, dependency maps, or links.

**Boundary:** This owns the reset's interpretation and verification bar, not architectural substance or release authorization. A canon reset does not imply a new npm major version. **Evolution:** Explain why accumulated supersessions, amended vocabulary, and implementation-era records now obscure the governing model. **Evidence and readiness:** [TRL-983](https://linear.app/outfitter/issue/TRL-983) and [TRL-985](https://linear.app/outfitter/issue/TRL-985). The latter's older “reset-only at this stage” wording must be read under the later atomic-cutover ruling. Depends on: none.

**Consequences to cover:** Fresh readers get one coherent law, at the cost of an atomic migration and explicit preservation of old links and provenance.

### N02 — The trail is the product

Proposed file: `0002-the-trail-is-the-product.md`.

**Decision:** A trail is the capability contract. Define once, render everywhere: one authored contract supplies execution, surfaces, examples, governance, and inspection. State the tenets' one schema, one Result, one error taxonomy, one write/many reads, queryability, and resolved-graph promises without restating every mechanism. Preserve the six information categories—authored, derived, enforced, inferred, observed, overridden—and the derive/declare/override posture. Explain that completed capabilities must also be teachable, governable, migratable, and releasable.

**Boundary:** Leave schema typing to N04, execution to N06, graph persistence to N14, and surface behavior to N17. Do not repeat ADR-0000's old blanket deployment exclusion without reconciling the incoming deploy decision. **Evolution:** Start with surface divergence as the motivating failure, then explain why the unit of product became a contract rather than an interface. **Evidence and readiness:** [tenets](../../../docs/tenets.md), old 0000, [TRL-987](https://linear.app/outfitter/issue/TRL-987). Surviving accepted premise. Depends on: N01.

**Consequences to cover:** One contract feeds many readers, but new capabilities must supply derivation and distribution evidence instead of leaving each surface to improvise.

### N03 — Names reveal the contract

Proposed file: `0003-names-reveal-the-contract.md`.

**Decision:** Use plain names where they describe the full concept; reserve branded names for distinctions ordinary words would lose. Name authored behavior `implementation`, composition `compose`, graph assembly `topo`, domain identity `entity`, presentation `render`, and contract-owned fact production `derive`. Preserve structural verb grammar, accessor distinctions, path-field conventions, and the difference between scope, selector, and filter.

**Boundary:** This defines vocabulary and grammar, not surface accommodation semantics or package ownership. `trailhead` is a grouped rendered entry; its earlier meaning as a surface belongs only in history. **Evolution:** Trace the movement from metaphor-heavy names through repeated vocabulary migrations to precise ordinary language. **Evidence and readiness:** old 0001/0023/0049, [lexicon](../../../docs/lexicon.md), [language styleguide](../../../docs/contributing/language-styleguide.md), [TRL-988](https://linear.app/outfitter/issue/TRL-988). Use current overlay-era meanings, not the issue's older carrier assumptions. Depends on: N02.

**Consequences to cover:** Guessable vocabulary reduces interpretation cost; renames still require governed migrations and must not be justified by taste alone.

### N04 — Composition preserves the trail contract

Proposed file: `0004-composition-preserves-the-trail-contract.md`.

**Decision:** A composite capability is still a trail. Its schema, intent, idempotency, examples, and declared composition edges remain inspectable. Prefer typed trail-object composition; retain string IDs as the explicit dynamic, untyped escape hatch. Composition-only input is an authored tightening, not a second public input contract. Sequential and concurrent composition use the same verb; batches preserve order, await every branch, and leave partial-failure policy to the caller.

**Boundary:** N06 owns execution and branch scope; N12 owns reactive activation; N21 owns historical contract versions. Do not revive the separate `hike` primitive or string-only composition as law. **Evolution:** Explain the unification of simple and composed work, followed by typed object references and bounded concurrent calls. **Evidence and readiness:** old 0003/0004/0024/0028/0049; current `packages/core/src/types.ts:88`, `trail.ts:97`, `execute.ts:700`; [TRL-884](https://linear.app/outfitter/issue/TRL-884) and commit `851a2a3cb` support folding the one-schema draft into this record. Keep its validation/defaulting and type-cost constraints; do not infer that its draft status changed automatically. Depends on: N02, N03.

**Consequences to cover:** Declared edges support typing and inspection, while dynamic string references deliberately give up compile-time precision and concurrent callers own partial-failure policy.

### N05 — Failure is a portable contract

Proposed file: `0005-failure-is-a-portable-contract.md`.

**Decision:** Trail outcomes use the shared Result type. Typed error categories carry behavior, including retryability and structured context, and each surface renders those categories deterministically. New surface mappings must be complete. Separate expected domain failures, framework failures, and invalidated observations; a workspace shift voids a verdict, including a pass.

**Boundary:** N06 owns recovery mechanics. Infrastructure accessors may reject with typed errors at their existing boundary; consuming trails convert failures into Result outcomes. Do not generalize “implementations never throw” into a false claim that every infrastructure method returns Result. Exact codes and class inventories belong to the error owner, not duplicated tables. **Evolution:** Explain why exception conventions and per-surface mappings became a shared taxonomy, later extended by the `shift` category. **Evidence and readiness:** old 0002/0026; `packages/core/src/errors.ts:183`, `:351`, `:415`; current KV/Blob/Queue README contracts. Depends on: N04.

**Consequences to cover:** Portable failure handling makes surface mappings predictable, but taxonomy additions create an explicit completeness obligation for every renderer.

### N06 — Every invocation uses the same execution pipeline

Proposed file: `0006-every-invocation-uses-the-same-pipeline.md`.

**Decision:** Surfaces and composition enter one runtime envelope. Framework-owned concerns remain fixed stages; authored layers wrap work within that envelope and declare their own inputs without leaking them into implementation input. Detours are typed, ordered, bounded recovery paths for a trail, inside the appropriate layer scope. Resource scopes and tracing lineage remain correct across nested and concurrent execution.

**Boundary:** N05 owns error meaning, N07 resource lifecycle, N09 permission policy, and N18 trace records. Avoid freezing an obsolete numbered stage list from an early ADR. Preserve the documented narrow store-reconcile recovery exception until detours can express it; do not generalize that carve-out. **Evolution:** Start with duplicated CLI/MCP/HTTP execution, then the shared kernel, intrinsic concerns, and the distinction between layers and detours. **Evidence and readiness:** old 0006/0033/0043; `f69a47832`; current `packages/core/src/execute.ts` and the root agent guidance. Depends on: N04, N05.

**Consequences to cover:** One envelope prevents execution drift; it limits arbitrary stage replacement and makes exceptions visible rather than silently surface-specific.

### N07 — Infrastructure is declared as resources

Proposed file: `0007-infrastructure-is-declared-as-resources.md`.

**Decision:** A resource declares infrastructure identity, config, creation, lifecycle, typed access, and test substitution. Trails declare what they use and resolve it through context, preferably the static resource accessor. Infrastructure roles are ordinary resources, not new core primitive families. Production creation fails clearly when a required binding is absent.

**Boundary:** N08 owns configuration resolution; N11 owns schema-derived persistence; N13 owns package placement. An infrastructure capability need not manufacture a resource, layer, and trail family merely to satisfy the old “trifecta.” **Evolution:** Trace service/provision terminology into first-class resources and, recently, provider-neutral KV/Blob/Queue roles. **Evidence and readiness:** old 0009 and surviving 0010; commit `2c17f6dc7`; current role-package READMEs. Role declarations are live-source facts here; lock capture, provider rebinding, deployment portability, and registry publication are separate work. Depends on: N04, N05.

**Consequences to cover:** Declarations and mocks make dependencies inspectable and replaceable, with some lifecycle/configuration authoring overhead and explicit production binding requirements.

### N08 — Configuration has a schema and a lifecycle

Proposed file: `0008-configuration-has-a-schema-and-a-lifecycle.md`.

**Decision:** Derive configuration contracts from their owners, support explicit expert configuration, and preserve source/provenance through base, profile, local, and environment resolution. Deployment configuration is bootstrap input, not data authored on `topo()`. Resource-owned config schemas compose into typed resource context; config fields may supply lazy trail-input defaults through the existing `config.ref` contract. Separate resolved deployment values from source-static `workspace.apps` identity.

**Boundary:** N16 exclusively owns `workspace.apps` identity and its static proof. Local overrides and profiles cannot silently change that identity. Keep concrete format precedence and helper signatures in current config reference. **Evolution:** Schema-driven deployment config grew a separate static `workspace.apps` section once multi-app workspaces exposed competing discovery authorities. **Evidence and readiness:** old 0011 as specialized by 0054; current `packages/config` and `trails.config.*` conventions. Depends on: N07.

**Consequences to cover:** Schema-owned configuration improves validation and provenance; static `workspace.apps` identity intentionally forbids environment-dependent app discovery.

### N09 — Authority is checked at the trail boundary

Proposed file: `0009-authority-is-checked-at-the-trail-boundary.md`.

**Decision:** Permission requirements are authored policy. Separate credential extraction and verification from the resolved permit and surface-agnostic enforcement. Public access is explicit; composition rechecks the called trail's authority. Discovery and error challenges must not imply privileges a caller does not hold.

**Boundary:** N17 owns presentation, N25 MCP session/protocol posture, and N13 provider package placement. Reconcile the bearer-only historical scope with the incoming OAuth resource-server and CLI credential decisions before final prose. Trails verifying credentials and a CLI acting as an OAuth client must not be confused with Trails becoming an authorization server. **Evolution:** Provider-neutral permits grow into issuer-qualified credentials and delegated actors while preserving one enforcement owner. **Evidence and readiness:** old 0012; incoming [TRL-1429](https://linear.app/outfitter/issue/TRL-1429), [TRL-1496](https://linear.app/outfitter/issue/TRL-1496), [TRL-1432](https://linear.app/outfitter/issue/TRL-1432). Their issue direction is explicit, but their repository ADRs are not in this baseline. They are cutoff reconciliation work, not claims of delivered behavior. Depends on: N04, N05, N07.

**Consequences to cover:** Rechecking authority supports safe composition and discovery, with repeated verification work and no implicit privilege inherited from a connection.

### N10 — Domain structure derives ordinary trails

Proposed file: `0010-domain-structure-derives-ordinary-trails.md`.

**Decision:** An entity names a domain object with schema, identity, examples, and typed references. Preserve structural entity-reference edges (including `.id()`-based references and branded identity) separately from the operational trail/entity relationships derived into the graph. Factories derive ordinary trail contracts from such declarations and domain patterns; they do not create a parallel execution, testing, or governance system. `deriveTrail` is the lower-level deterministic aid, while domain packages own coherent trail families.

**Boundary:** Entities do not imply persistence. N11 owns store binding and accessors; N04 owns general trail contracts. Do not recreate the retired domain-object primitive or invent a generic plugin/factory ontology. **Evolution:** The framework acquired domain nouns and CRUD derivation, then adopted the ordinary name `entity`. **Evidence and readiness:** old 0030/0032, commit `de3eccec0`, current entity cutover `67120754d`. Depends on: N04.

**Consequences to cover:** Domain declarations multiply into consistent capability families, but factories must leave meaningful exceptions visible instead of hiding custom behavior behind generated conventions.

### N11 — Persistence binds a schema to a backend

Proposed file: `0011-persistence-binds-a-schema-to-a-backend.md`.

**Decision:** A store declaration owns the schema-first model. A binding produces a resource and realizes the portable accessor protocol on its backend. Preserve portable filters, identity-generation ownership, version semantics, change signals, fixtures, and explicit backend escape hatches. Pagination guarantees correctness; it does not promise equal backend performance.

**Boundary:** N07 owns generic resources and role APIs; N12 owns signal identity and delivery; N13 owns adapter packaging. Drizzle and jsonfile are evidence for the contract, not separate canonical architectures. **Evolution:** SQL-first derivation became a backend-neutral model when the second backend exposed assumptions about generated fields, versions, and accessors. **Evidence and readiness:** old 0016/0022/0031/0034, `bdc8fa5de`, current store/binding contracts. Retain SQLite/Drizzle-specific choices in the relevant fieldguide. Depends on: N07, N10.

**Consequences to cover:** A portable accessor protocol permits multiple backends, while native capabilities and performance differences require explicit escape hatches and conformance evidence.

### N12 — Signals activate ordinary trails

Proposed file: `0012-signals-activate-ordinary-trails.md`.

**Decision:** A signal owns its payload contract; trails declare production and activation edges through `fires` and `on`. Activation is another invocation path into ordinary trails. Sources such as schedules, queues, and webhooks contribute source facts and materializers rather than new trail kinds. Guards suppress activation without transforming input; the original payload still satisfies the receiving trail schema, and activation provenance travels through context and traces. Bound store signal identity is resource-scoped and derived at binding; ambiguous unresolved handles fail closed.

**Boundary:** This owns in-process activation and provenance, not an unproved durable replay guarantee. Durable subscriptions need a distinct decision if ratified. N06 owns execution; N11 owns transaction/backend semantics. **Evolution:** Framework event sketches became typed signal contracts and generalized activation. Named examples such as `topo.saved` and `framework.lock.export` are not current wiring; the operator now compiles explicitly. Preserve unimplemented dev-intelligence aspirations as questions, not implied runtime promises. **Evidence and readiness:** old 0018/0038/0039/0040; `packages/core/src/fire.ts:930`, `topo.ts:348`, `apps/trails/src/trails/compile.ts:25`. Depends on: N04, N06, N07.

**Consequences to cover:** Reactive work reuses normal trail contracts; consumer failure isolation does not supply transaction atomicity or durable replay by itself.

### N13 — Reusable facts have one natural owner

Proposed file: `0013-reusable-facts-have-one-natural-owner.md`.

**Decision:** A reusable capability lives in the lowest package where it is coherent. Consumers compose typed owner exports instead of rediscovering facts or copying implementations. Keep third-party adapters outside portable contract owners; native bindings may remain appropriate subpaths. Vocabulary follows the package that acts on it.

**Boundary:** This owns dependency and authority boundaries, not a permanent table of today's package names. Respect evidence-based exceptions, including the pending auth-provider packaging reconciliation; do not impose “SDK dependency required” over explicitly named approved targets. **Evolution:** Extracted third-party bindings, owner-first governance, and package consolidation revealed the same rule at several levels. **Evidence and readiness:** old 0029/0037/0051, current adapter authoring draft and package source; incoming [TRL-1432](https://linear.app/outfitter/issue/TRL-1432). Depends on: N02, N03.

**Consequences to cover:** One reusable owner reduces drift; moving ownership can create package/route migration work, and smallest package count is not the optimization target.

### N14 — The resolved graph records what is known

Proposed file: `0014-the-resolved-graph-records-what-is-known.md`.

**Decision:** Core resolves and executes the in-memory graph. Topography owns durable derivation, serialization, hashing, diffing, and cross-process comparison. Wayfinder queries these owner facts through trails. Distinguish authored, derived, inferred, and observed information: a lock is not proof of every possible runtime failure. Runtime execution does not acquire a dependency on reading saved graph artifacts.

**Boundary:** N15 owns generic extensions; N16 owns app/workspace placement and observation evidence. Do not resurrect a separate manifest/content pair or a merged workspace runtime topo. Future proposals about deploy facts loading at runtime require explicit reconciliation with this boundary. **Evolution:** The graph moved from introspection and SQL-derived views to durable, queryable contract evidence with explicit knowledge limits. **Evidence and readiness:** old 0017/0042/0045; surviving principles from 0046; Wayfinding draft plus current operator queries. Saved locks are available in this worktree, but Wayfinder reports unknown freshness and absent topo stores; no runtime freshness claim follows. Depends on: N04, N05, N12, N13.

**Consequences to cover:** Durable facts make cross-process inspection possible, at the cost of serialization/versioning work and an honest limit on what saved data can prove.

### N15 — Overlays are the graph's extension mechanism

Proposed file: `0015-overlays-are-the-graphs-extension-mechanism.md`.

**Decision:** Extend durable graph facts through one registered, namespaced overlay mechanism, with deterministic content, provenance, preservation, and generic hash/drift coverage. App-authored surface bindings may influence rendering; adapter-derived informational facts must not acquire authority to rebind it. Compile and fresh derivation use the same collection path.

**Boundary:** N17 owns scalar/list binding meaning and accommodation behavior. An overlay does not wrap execution; a layer does. Namespace owners decide their schema without adding core mechanisms for each new kind. **Evolution:** Per-feature alias/trailhead lifts created asymmetric drift; overlays consolidated the carrier while preserving identity protections. **Evidence and readiness:** old 0052, `df01802a5`; current `surfaceOverlay`/`trailsOverlays` conventions. Unknown namespaces must remain preserved. Input mappings remain a future field family, not shipped capability. Depends on: N14.

**Consequences to cover:** One extension channel avoids bespoke drift code, but generic preservation, schema validation and provenance enforcement become mandatory infrastructure.

### N16 — Each app owns its committed graph

Proposed file: `0016-each-app-owns-its-committed-graph.md`.

**Decision:** Static workspace declarations identify lock-owning apps. Each app owns a root `trails.lock`; workspace views preserve app partitions and derive one canonical content view without becoming a second authority. Committed truth, static identity, deployment config, and machine-local observation state have separate lifecycles. Freshness requires evidence beyond a matching graph hash. Distinguish durable project identity, a working tree, and the invocation's collection root. The operator composes one shared project context and app-selection contract from config, Source, and Topography owner facts: `--root-dir` bounds discovery, `--app` selects within that boundary, CWD/explicit config determine the remaining scope, and `--module` never changes lock ownership. Preserve explicit selection provenance, command cardinality, completeness and freshness behavior, and fail-closed collection/workspace boundaries; selecting an app does not erase shared project source.

**Boundary:** N08 owns deployment resolution, N14 persistence semantics, and N15 extension integrity. Shared topo-store snapshots/pins and SQLite subsystem ownership survive as optional tooling infrastructure, not runtime dependencies. Preserve owner-only writes to shared framework SQLite state and read-only governed access for consumers. No coequal aggregate workspace lock is introduced. **Evolution:** Repo-local databases and manifest/content artifacts gave way to app-owned locks, per-user state, and explicit workspace ownership. **Evidence and readiness:** old 0014/0015/0054 and surviving 0010/0017/0046 principles; commits `f8403c4e3`, `167968721`, `be3db8a23`. Current lock envelope version is 5; TopoGraph and manifest schema constants are 4. The lock-v6 draft remains future representation work. Depends on: N08, N14, N15.

**Consequences to cover:** App-local truth makes independent ownership legible; explicit workspace declarations and freshness evidence add ceremony that prevents accidental competing authority.

### N17 — Surfaces preserve capability identity

Proposed file: `0017-surfaces-preserve-capability-identity.md`.

**Decision:** Surfaces render derived graph facts. Derivation is deterministic, local runtime materialization is explicit, and opening an outside boundary belongs to the surface. Names, routes, groups, exposure, and supported input presentation may change shape without changing the selected trail's contract. Scalar bindings converge on one trail; list bindings gather trails while preserving member identity, including a singleton group. Visibility, intent, profiles, and permits constrain exposure.

**Boundary:** A changed intent, permit, output, error contract, lifecycle, or side effect is a distinct/composing trail, not a cosmetic accommodation. Define **shape** as the rendered entries, names, order, grouping, exposure, and reach; define **reshape** as a visible provenance-bearing adjustment to that derived shape, never added behavior. Define a **trailhead** as one grouped callable entry that preserves selected member identity. N15 owns the overlay carrier; N09 owns authority. Include truthful CLI flags versus structured input, full command paths, framework-neutral HTTP routes, and the library's shared rendering plan. Keep exact protocol/flag tables in surface reference. **Evolution:** One-off surface derivation grew consistent APIs, explicit exposure controls, grouped entries, and finally a shared provenance-bearing carrier. **Evidence and readiness:** old 0005/0008/0019/0020/0027/0035/0050; implemented CLI/library drafts; [TRL-989](https://linear.app/outfitter/issue/TRL-989). The library runtime and compiler exist; this is not all future work. General input reshape is still not proven implemented. Depends on: N04, N05, N09, N14, N15.

**Consequences to cover:** Equivalent surfaces reduce duplicate implementations; truthful shaping can require a new trail when a convenient interface actually changes behavior.

### N18 — Observation follows execution without owning it

Proposed file: `0018-observation-follows-execution-without-owning-it.md`.

**Decision:** Core owns intrinsic trace records, propagation, execution lineage, and the sink seam. The observability owner supplies sinks, composition, rendering, optional developer state, and outward adapters. Observation stays inert until enabled; storage and presentation do not become execution's owner. Preserve sampling and failure isolation requirements.

**Boundary:** N14 owns contract facts; observed execution is not proof of exhaustive contract behavior. Package migration history is not an API compatibility promise. **Evolution:** A tracing resource/package and production observability grew into one coherent ownership split, with developer state and OTel housed explicitly rather than through a compatibility package. **Evidence and readiness:** surviving 0013 and amended 0041; commits `113aed62d`, `0938e7bad`, `50e27796d`. Depends on: N06, N12, N13.

**Consequences to cover:** Observation stays decoupled from runtime ownership, but useful retention and export require explicit sinks and cannot be inferred from an inert default.

### N19 — Governance uses the same contracts it checks

Proposed file: `0019-governance-uses-the-contracts-it-checks.md`.

**Decision:** Governance rules are trails with examples and structured diagnostics. Structural source analysis uses the parser/AST and typed owner facts. A rule owns its detection and fix facts; a consumer does not guess them again. Distinguish safe deterministic edits, review-required findings, and detection without edits. Verdicts must identify their observation ground and fail when that ground shifts.

**Boundary:** N22 owns governed multi-step migration; Warden's safe local fix executor remains distinct. The `shift` error and repo tree guard exist, while a generalized public `warden guard` command remains draft. Do not turn obsolete framework event examples into requirements for every rule. **Evolution:** Regex checks and parallel raw-rule APIs converged on ordinary trails and owner-derived facts; later fixes became structured data. **Evidence and readiness:** old 0007/0018/0036/0037; fixes and stable-ground drafts; `packages/warden/src/rules/types.ts:106`, `fix.ts:62`, `scripts/tree-guard.ts:203`. Depends on: N04, N13, N14.

**Consequences to cover:** Governance shares the framework contract, while parser integration, precise fix metadata and stable observation ground require sustained owner maintenance.

### N20 — Draft contracts stay outside established truth

Proposed file: `0020-draft-contracts-stay-outside-established-truth.md`.

**Decision:** Draft-authored state is allowed in source, visibly marked, and excluded from established graph outputs. Preserve the reserved `_draft.` identity, file markers, contamination rules, visible governance debt, and a first-class promotion path.

**Boundary:** This is source-contract lifecycle, not the status of prose ADR drafts and not historical trail versions. N21 owns version compatibility. **Evolution:** Exploratory authoring needed room to exist without accidentally entering public surfaces or committed locks. **Evidence and readiness:** old 0021 and current draft/governance rules. Keep this small and separate rather than hiding its exclusion contract in release prose. Depends on: N14, N19.

**Consequences to cover:** Exploration remains possible without contaminating established outputs; promotion and visible debt are deliberate costs rather than hidden automatic publication.

### N21 — Trail versions preserve historical contracts

Proposed file: `0021-trail-versions-preserve-historical-contracts.md`.

**Decision:** Version the trail contract independently of npm package versions. Keep the current contract at the top level; historical entries carry explicit schemas, lifecycle, and preserved behavior through revisions or forks. A revision transposes materialized values; a fork retains its own implementation. Resolution, markers, examples, deprecation guidance, and surface negotiation derive from that model.

**Boundary:** N20 owns draft state; N24 owns package semver. Preserve the v3 decision's exact revision/fork and lifecycle requirements, not the superseded 0044 model. **Evolution:** The earlier version design was replaced when preservation and migration needed explicit executable history rather than an ambiguous compatibility story. **Evidence and readiness:** old 0048, `bea0ea736`, subsequent runtime/version commits. 0044 is historical-only; it does not become a second new ADR. Depends on: N04, N05, N14, N17.

**Consequences to cover:** Historical clients retain executable contracts, at the cost of preserving old schemas, behavior, examples and explicit lifecycle transitions.

### N22 — Governed change leaves verifiable receipts

Proposed file: `0022-governed-change-leaves-verifiable-receipts.md`.

**Decision:** Contracts and Warden own migration facts. Regrade turns those facts into reviewable plans, bounded application, and compact immutable receipts with recoverable evidence. Prepared inputs, protected paths, source closure, and post-apply checks determine whether a run is valid. A completed vocabulary move leaves durable governance instead of a permanent one-off migration engine.

**Boundary:** N19 owns detection and fix metadata. N21 owns version behavior. Do not equate a receipt with proof when its referenced source or checks are missing. Keep run mechanics and current command grammar in Regrade's fieldguide. **Evolution:** Large vocabulary changes exposed the limits of blind replacement, then of huge embedded histories; verified plans and compact receipts became the reusable contract. **Evidence and readiness:** old 0053; `c89bd4d5f`, `97ccb5c16`, `9a8b6e4af`, and existing governed history. Depends on: N14, N19, N20, N21.

**Consequences to cover:** Migrations gain reproducible evidence and conservative application, at the cost of rejecting unprovable edits and maintaining receipt/reference integrity.

### N23 — Examples and scenarios exercise the real contract

Proposed file: `0023-examples-and-scenarios-exercise-the-real-contract.md`.

**Decision:** Authored examples describe one trail and feed test/guidance consumers. Scenarios describe composed behavior. Preserve exact, subset, and success-only expectations, structured references, normal-pipeline execution, resource mocks, and tests across live historical versions. Bindings prove conformance to their owner's contract.

**Boundary:** Tests provide evidence, not an alternate schema or runtime. Keep matcher algorithms and harness APIs in testing reference. Missing mocks or a passing memory binding do not prove production-provider conformance. **Evolution:** Contract examples grew into composition scenarios and reusable adapter suites instead of a parallel testing DSL per surface. **Evidence and readiness:** old 0025, current testing package, version tests and resource role conformance suites. Depends on: N04, N06, N07, N11, N12, N17, N21.

**Consequences to cover:** Examples and scenarios serve several readers, but their quality still matters and passing local mocks cannot certify an external provider.

### N24 — Releases derive from owned compatibility facts

Proposed file: `0024-releases-derive-from-owned-compatibility-facts.md`.

**Decision:** The public framework package family versions in lockstep. Keep package semver separate from trail versioning and distinguish source preparation from publication. Release facts, configured policy, authored intent, and derived output have distinct owners. Under the current 0.x policy, patches preserve compatibility and minors may carry documented breaks; a future 1.0 requires an explicit owner decision. Stable publication uses `latest`; prereleases use an explicit channel and fail without a usable tag. Package retirement is visible and migratable, scaffold-affecting releases require a cold outside-monorepo consumer smoke, and partial publication stops for an evidenced resume set rather than a blind rerun. Preserve the distinct responsibilities: Changesets computes versions/changelogs, Bun packs and validates, and npm performs the authenticated publication through the approved flow.

**Boundary:** Exact registry state, currently active tags, installation pins, and release commands belong in current runbooks; the stable/prerelease channel policy above remains normative. Preserve truthful branch-local changesets or an explicit no-release reason, public-set coherence and pre/post publication evidence. The one-time unpublished-1.0-to-0.2 source transition is history, not a standing downgrade permission. Scaffold pins/provenance may be carried forward where implemented; public upgrade tooling remains separate. **Evolution:** Beta-era source versions, consumer pinning, and release evidence matured into explicit stable-line and publication discipline. **Evidence and readiness:** old 0047, implemented portions of the release-provenance/scaffold drafts, [0.2.0 release](https://github.com/outfitter-dev/trails/releases/tag/v0.2.0), [0.2.4 release](https://github.com/outfitter-dev/trails/releases/tag/v0.2.4). Depends on: N13, N14, N21, N22.

**Consequences to cover:** Lockstep versions keep the family coherent, while small package changes can advance the whole family and publication remains a separately evidenced event.

### N25 — MCP uses explicit request authority and application state

Proposed file: `0025-mcp-uses-explicit-request-authority-and-state.md`.

**Decision:** Preserve the accepted MCP stateless-core/SDK-v2 target: authorization comes from each request, application state has explicit handles, portable handlers use the Web Fetch boundary, and protocol compatibility does not invent session affinity. Keep the accepted dual-era compatibility and migration obligations as written in the source decision.

**Boundary:** N09 owns permits, N17 general surface identity, and N18 observation. Skills, elicitation, durable subscriptions, and RPC are distinct incoming capabilities, not proof supplied by an SDK upgrade. Protocol-version tables and host conformance results belong in maintained MCP reference. **Evolution:** MCP's initial session-oriented integration now has an accepted direction for stateless operation and explicit application protocols. **Evidence and readiness:** old 0055, accepted at `e67d90f5c`. Its text explicitly separates acceptance from implementation. Carry it into the new canon as **accepted target-state with implementation checks**, never silently downgrade it to draft or advertise it as shipped. Depends on: N09, N17, N18.

**Consequences to cover:** Per-request authority and portable hosting reduce session assumptions; the SDK/package break and dual-era limitations require explicit migration and host-conformance work.

## Incoming decisions that can change the final set

The 25-record recommendation is complete for the pinned numbered corpus; it is not a claim that the public-launch cutoff will contain only those decisions. These active workstreams need a fresh source and status check at cutoff. A Linear issue saying “an accepted ADR…” may describe its required outcome rather than its present state.

| Workstream | Proposed home | Cutoff treatment |
| --- | --- | --- |
| OAuth resource server and CLI credentials — [TRL-1429](https://linear.app/outfitter/issue/TRL-1429), [TRL-1496](https://linear.app/outfitter/issue/TRL-1496) | N09 owns authority; a separate CLI-credential ADR is justified if the resource/storage/grant lifecycle overwhelms N09 | Fold accepted amendments into the first published N09. Do not publish bearer-only law followed immediately by its replacement. Separate app login from operating an authorization server. |
| Provider auth packaging — [TRL-1432](https://linear.app/outfitter/issue/TRL-1432) | N13 | Preserve named Better Auth/Clerk exceptions and collection subpaths from the reconciled issue. Do not create a second generic package-placement rule. |
| Deploy derives from the topo — [TRL-1438](https://linear.app/outfitter/issue/TRL-1438) | A focused deployment ADR, plus N02/N07/N13/N15 boundary amendments | Distinct consequential decision: derive and orchestrate provider-native deployment, without owning provider plan/apply/state. Reconcile namespace/hash wording with the lock-v6 proposal and old runtime-artifact prohibition. Current role packages do not prove deploy completion. |
| Durable subscriptions — [TRL-1497](https://linear.app/outfitter/issue/TRL-1497) | A focused durable-delivery ADR building on N09/N11/N12 | Do not hide its outbox, grant intervals, delivery-sequence checkpoints, replay gaps, and crash-window semantics inside ordinary signal activation. At-least-once is not exactly-once. |
| RPC over WebSocket — [TRL-1166](https://linear.app/outfitter/issue/TRL-1166) | A focused RPC rendering ADR | Replace the old custom-envelope/one-process replay draft; keep shared core errors, provider-neutral RPC ownership, host boundaries, per-delivery permits, and subscription-owner checkpoints. |
| Served skills — [TRL-1338](https://linear.app/outfitter/issue/TRL-1338) | A focused guidance-rendering ADR | Its candidate remains draft in the captured issue. Preserve `skill://` versus `trails://`, source/digest authority, fallback, and per-read permits. Do not infer host support from installed SDK version. |
| Merge-friendly lock v6 — [TRL-1424](https://linear.app/outfitter/issue/TRL-1424) | Future artifact draft; eventually amend N14–N16 coherently | Done means draft-source merged, not ratified v6. Keep lossless saved-library derivation, unknown-overlay preservation, tombstones/forces, and migration prerequisites. |

This is an incoming watch list, not an exhaustive inventory of every remote branch. The research did not inspect private Claude artifacts linked by issues or enumerate all unmerged source candidates. Live issue descriptions are evidence of direction; they do not substitute for accepted source at the actual cutoff.

## Keep the draft layer purposeful

[coverage.md](coverage.md) assigns all 21 drafts. Retain cohesive future work such as declarative search, RPC/WebSocket evolution, graph-as-MCP-resources, external integration factories, and lock v6. Follow [TRL-995](https://linear.app/outfitter/issue/TRL-995) for the future horizon: keep a rewritten pack-boundary draft and a dependent pack-resources draft, retain `pack` and `rig` as intentional candidate names, and keep resource bundles as a thinner defaults/overrides stub. Reframe documentation freshness as documentation-as-a-service/docs-governance exploration; preserve a docs-structure baseline draft or issue with an explicit decision about whether it belongs in the active canon. This proposal recommends keeping routine documentation policy in contributor guidance, but does not erase those framework-facing future ideas or treat their disposition as settled.

Implemented substance can feed a proposed new ADR without pretending its old draft was ratified. The one-schema, Wayfinder, library, CLI-route, fix-metadata, and release-provenance drafts require this distinction. Stable-ground has a shipped error/guard principle and an unshipped public-command proposal. Every split disposition preserves a historical snapshot and explicitly identifies the residual future work.

## How the new canon avoids day-one supersession

Use one rule owner per subject. References compose those owners; they do not restate them with slightly different conditions. [canon.json](canon.json) records the proposed dependency DAG; [coverage.json](coverage.json) maps all source records to their homes.

Resolve these known conflict families before authoring final prose:

| Conflict family | Single rule to carry forward |
| --- | --- |
| `hike` versus `trail`; string-only versus typed composition | N04: one trail primitive, typed object path plus explicit dynamic escape hatch |
| Retired composition, authored-behavior, domain-object, and surface names (see the evidence ledger) | N03: current vocabulary; old words only in clearly historical rationale |
| Manifest/content pair, repo-local database, root app locks | N16: app-owned root lock and machine-local state; preserve durable-graph/snapshot principles without old paths |
| ADR-0044 and ADR-0048 versioning | N21: the evolved v3 contract, with 0044 historical-only |
| Dedicated alias/group fields versus overlays | N15 owns carrier/provenance; N17 owns rendering behavior and member identity |
| Runtime layers versus fixed framework concerns versus detours | N06 distinguishes envelope, authored wrapping, and typed recovery |
| Separate tracing and observe ownership | N18 preserves intrinsic core contracts and the current observability owner split |
| Store persistence versus KV/Blob/Queue roles | N11 owns schema-derived persistence; N07 owns ordinary infrastructure roles; neither replaces the other |
| Published stable release versus source version | N24 labels preparation, publication, and future launch independently |
| Accepted target versus delivered implementation | Carry accepted law; record implementation gaps separately, especially N25 |

The coherence review must cover every pair of proposed records for overlapping normative ownership, then check dependency cycles and all old-to-new dispositions. A zero-supersession launch is a property of the **whole frozen cutover**, not a permanent guarantee that future decisions will never change.

## Suggested authoring and cutover sequence

1. Review this content outline and its disposition ledger. Settle only the remaining content boundaries, not previously agreed archival mechanics.
2. Finish archive-aware tooling and safe relative-link moves under [TRL-984](https://linear.app/outfitter/issue/TRL-984) and [TRL-1222](https://linear.app/outfitter/issue/TRL-1222). Those rails may land independently while supporting the existing corpus.
3. Capture the actual cutoff and refresh numbered/draft/incoming inventories, amendments, and source hashes. Recover the earlier packets if available, but do not reuse their old denominator.
4. Author the complete new canon and draft dispositions against that cutoff. Preserve current accepted target-state obligations even when implementation is incomplete. Record any genuine new decision for owner review rather than hiding it in consolidation.
5. Assemble the archive, all surviving new doctrine, active index/maps, and required docs/lexicon/agent-guidance repairs as one coherent integration unit. Use the current worktree's GitHub-native stack policy, not stale Graphite wording from historical issues.
6. Run coverage, source-preservation, link/map, vocabulary, and tooling checks, then [TRL-991](https://linear.app/outfitter/issue/TRL-991), [TRL-992](https://linear.app/outfitter/issue/TRL-992), and the distinct fresh-reader gate [TRL-993](https://linear.app/outfitter/issue/TRL-993). The fresh reader must be able to explain current law without opening historical ADRs.

Publishing this proposal does not move ADRs, regenerate maps, execute the reset, or authorize a release.

## Decisions still needed

- **Final content count:** accept the 25-record base, or combine only where the same reversal would change both subjects. Permits, persistence, observability, and package release policy should remain distinct.
- **Incoming cutoff:** decide which presently active architectural work lands before the reset. Deployment, durable delivery, RPC, and guidance serving can legitimately add focused records; force-fitting them into the base count would obscure ownership.
- **Historical narrative depth:** use a short “How this evolved” section in each new ADR, with the detailed evidence ledger outside normative text. The settled archive-link restriction remains intact.
- **Unsettled substance:** clarify old ADR-0018 dev-intelligence aspirations, full future adapter-authoring/scaffold automation, public stable-ground commands, and the incoming deploy/runtime-artifact boundary. Do not silently delete accepted requirements merely because they lack implementation; distinguish superseded examples from a still-binding obligation.

## Verification and practical limits

The research uses immutable local Git history, current source, GitHub release records, and captured Linear issue records. [history.md](history.md) identifies pivotal evidence; [verification.md](verification.md) records coverage and review checks. Saved graph artifacts were consulted first; source/history reads were required because ADR evolution is not derived by Wayfinder and saved-artifact freshness is unknown in this cold worktree.

This is a committed research proposal, not a ratified ADR or release. No runtime code changed. Package tests, publish checks, lock regeneration, and generated ADR-map checks are not proof of this proposal and were not run. The eventual implementation must perform its own current-cutoff and distribution checks.
