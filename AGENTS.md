# AGENTS.md

Our primary fieldguide for agents working in on the Trails project.

## Commands

Use repo scripts first:

```bash
bun run build
bun run test
bun run lint
bun run lint:ast-grep
bun run typecheck
bun run check
bun run clean
bun run format:check
bun run format:fix
```

Inside a package or app, use the local scripts:

```bash
bun run build
bun test
bun run typecheck
bun run clean
```

For direct local lint and format validation, prefer the repo scripts (`bun run lint`, `bun run format:check`, `bun run format:fix`) so the private Oxlint plugin is built before Oxlint or Ultracite loads it. If invoking `bunx ultracite check`, `bunx ultracite fix`, or package-local `oxlint ./src` directly on a fresh checkout, run `bun run oxlint-plugin:build` first. For pinned formatter runs, prefer `bun run format:check`, `bun run format:fix`, or `bunx ultracite ...` over invoking the binary by a direct `node_modules/.bin` path. Bun sets up `node_modules/.bin` on `PATH`, which lets `ultracite` resolve sibling tools like `oxfmt` and `oxlint`.

## Project Overview

Trails is an agent-native, contract-first TypeScript framework. Define a trail once with typed input, `Result` output, examples, and meta, then surface it on CLI, MCP, HTTP, or plain TypeScript library calls today. WebSocket is planned on the same contract-first model.

The architecture is designed to make consistency easier than drift. Agents building with Trails should naturally produce aligned surfaces. Agents consuming Trails apps should be able to inspect contracts, examples, schemas, and errors at runtime without guessing.

## Project Documentation

`AGENTS.md` is the canonical project guidance file. Tool-specific compatibility files such as `CLAUDE.md` should stay as thin pointers here plus any tool-bootstrap-specific notes.

1. Contracts are at the core of how Trails works, and the contract for how Trails is worked on is governed by our [Tenets](docs/tenets.md).
2. Decisions that define what Trails is, and what it is not, are defined by our [ADRs](docs/adr/README.md).
   - Future directions for Trails are outlined in speculative or [draft ADRs](docs/adr/drafts/README.md).
3. Repo contribution guidance lives in [Contributing to Trails](docs/contributing/README.md), including [Language Styleguide](docs/contributing/language-styleguide.md), [Code Standards](docs/contributing/code-standards.md), [Codebase Navigation](docs/contributing/codebase-navigation.md), [Warden Rules](docs/contributing/warden-rules.md), and [Script Graduation](docs/contributing/script-graduation.md) — root scripts never own derivation of durable Trails-contract facts, and new or heavily edited root scripts get the script-graduation review check.
4. We keep a log of our working notes, session recaps, learnings, etc. in `.agents/notes/` (gitignored — local only) as a historical record of our journey.

## Wayfinder First

For Trails graph-navigation questions, use Wayfinder before reconstructing topo facts manually. Start with `trails schema wayfind` or the repo-local `bun apps/trails/bin/trails.ts schema wayfind` to check accepted routes and flags. When saved artifacts exist, run `trails wayfind --overview --root-dir . --json` or the repo-local `bun apps/trails/bin/trails.ts wayfind --overview --root-dir . --json` to check artifact source and drift, then use `trails wayfind <id>`, `trails wayfind <id> --contract`, `trails wayfind <id> --deps`, `trails wayfind <id> --impact`, `trails wayfind pattern "wayfind.*"`, `trails wayfind query "release drift"`, or population flags such as `--trails`, `--resources`, `--surfaces`, and `--errors` for saved graph facts. `trails wayfind --overlay <namespace>` reads a namespaced lock overlay (adapter-contributed facts, e.g. `--overlay cloudflare`) generically and lists the available namespaces on a miss.

`trails wayfind file <file> --outline` is the source-navigation exception inside Wayfinder: it parses the explicit source file live, then cross-references saved graph artifacts when they are available.

Use the shared glob vocabulary precisely. Trail-id selectors use dotted globs (`entity.*`, `entity.**`, `entity.????`). Warden and Regrade scope controls use root-relative path globs through the stable `PathScope` shape: `include`, `exclude`, and `extensions`. Do not reintroduce Regrade `ignore` or Warden `jurisdiction` naming.

Fall back to `rg`, qmd, source reads, or a fresh compile when Wayfinder reports missing or stale artifacts, when the task needs source text that Topographer does not project, or when writing new artifacts would violate the current work authority. When you fall back, say why so the next agent does not silently repeat the same graph reconstruction.

## Lexicon

Use the project language consistently:

- `trail`, not action or handler
- `blaze`, not handler or impl (the authored implementation that establishes how a trail runs)
- `topo`, not registry or collection
- `compose`, not cross or follow (for composition declaration and runtime invocation)
- `surface`, not transport terminology (the API function and user-facing noun)
- `resource`, not service or dependency
- `layer`, not middleware

`mount` is reserved for cross-app composition. See `docs/lexicon.md` for the full lexicon.

> **Vocabulary is mid-cutover toward the v1 reset.** Describe current code with current-live terms; see `docs/lexicon-pending.md` for terms ratified to change, and do not adopt the targets early.

## Trail Rules

- Blazes return `Result`, never throw.
- Use `Result.ok()` and `Result.err()` to construct outcomes.
- Branch on results with `isOk()`, `isErr()`, or `match()`.
- Keep `TrailContext` and blazes surface-agnostic. Do not import `Request`, `Response`, `McpSession`, or similar surface types into trail logic.
- Trails with `composes` compose through `ctx.compose()`, never by calling another trail's `.blaze()` directly.
- Keep `composes` declarations aligned with actual `ctx.compose()` usage.
- Every trail exposed on MCP or HTTP surfaces must define an `output` schema.
- Use `meta` for annotations and ownership data.
- Use `detours` for recovery strategies instead of inline retry logic.
  - **Narrow factory carve-out.** Detours execute at runtime. Factory-built trails such as the store's `reconcile` factory (`packages/store/src/trails/reconcile.ts`) may still keep a tightly-scoped inline recovery bridge when the current detour model cannot yet express the required store-specific behavior. Prefer detours first; treat inline recovery as a local exception, not the default pattern.
- Prefer the most specific `TrailsError` subclass available.
- Keep error taxonomy behavior aligned across surfaces so CLI, HTTP, and JSON-RPC mappings stay coherent.
- Trails that use external dependencies declare them with `resources: [...]`.
- Access resources through `db.from(ctx)` whenever the resource definition is statically in scope. `ctx.resource(id|definition)` is the underlying primitive — reach for it only when the definition isn't in scope (dynamic IDs from config, generic harness/framework code over `AnyResource`, or `TrailContextInit.resource` injection seams). Never construct dependencies inline.
- Keep `composes` declarations for composition and `resources` declarations for infrastructure — they serve different purposes.
- Every resource should define a `mock` factory so `testAll(app)` works without configuration.

## Surface Accommodations

Land the capability in the trail and accommodate the surface in projection. Surface accommodations include aliases, future input mappings, and trailheads. They are valid only while the same authored trail contract remains true.

- Aliases and input mappings live on the approach axis: many approaches may converge on one trail, but they must normalize without lying.
- Trailheads live on the entry axis: one grouped entry may gather several trails, but it must preserve selected member trail identity at invocation and response time.
- Treat a shape as a trail fork when it changes intent, permits, errors, outputs, lifecycle, side effects, or hides which trail is running. Use a distinct trail, a composing trail, or a trailhead that preserves member identity instead.

See [ADR-0050](docs/adr/0050-surface-accommodations-preserve-trail-identity.md) and [Surface Accommodations](docs/surfaces/surface-accommodations.md).

## Warden Rule Guide

<!-- warden-guide:start -->
<!-- GENERATED: run `bun run warden:agents:sync`; check with `bun run warden:agents:check`. -->

This section is generated from the live `@ontrails/warden` rule manifest. Keep the human-authored guidance above as orientation; use this block as the enforceable-rule index.

- Guide input command: `bun apps/trails/bin/trails.ts warden guide --manifest`
- Rule count: 73

### Rule Index

#### Composition

- `composes-declarations` (error, source/source-static, external): Declared composes stay aligned with ctx.compose() usage.
- `context-no-surface-types` (error, source/source-static, external): Trail logic stays surface-agnostic.
- `dead-internal-trail` (warn, project/project-static, external): Internal trails should be reachable through declared composes.
- `dead-public-trail` (warn, project/project-static, external): Exported public trails are anchored in configured app topos, composition, or activation.
- `intent-propagation` (warn, project/project-static, external): Composite trail intent cannot be safer than composed trails.
- `missing-visibility` (warn, project/project-static, external): Composition-only trails declare internal visibility.
- `no-destructured-compose` (warn, source/source-static, external): Trail blazes compose through ctx.compose() directly instead of destructuring compose from the context.
- `no-direct-implementation-call` (warn, source/source-static, external): Application code composes trails through ctx.compose().
- `no-retired-cross-vocabulary` (error, source/source-static, external): Retired cross composition vocabulary does not remain in downstream source after the beta.19 compose cutover.
- `resolved-import-boundary` (error, project/project-static, external): Cross-package imports resolve through public export maps.
- `version-pinned-compose` (warn, source/source-static, external): Version-pinned ctx.compose() calls stay visible migration debt.
- `webhook-route-collision` (error, topo/topo-aware, external): Webhook routes do not collide with each other or direct HTTP trail routes.

#### General

- `circular-refs` (warn, project/project-static, external): Contour reference graphs must be acyclic.
- `contour-exists` (error, project/project-static, external): Declared contour references resolve to known contours.
- `duplicate-exported-symbol` (warn, project/project-static, repo-local): First-party packages should not define the same exported symbol name in parallel.
- `example-valid` (error, source/source-static, external): Trail examples remain valid against their authored schema.
- `incomplete-accessor-for-standard-op` (error, topo/topo-aware, external): Standard CRUD operations expose the expected accessor shape.
- `incomplete-crud` (warn, project/project-static, external): Versioned CRUD entities expose complete operation coverage.
- `layer-field-name-drift` (error, source/source-static, external): Layer input field reserved names are shared across surface projections.
- `no-legacy-cli-alias-export` (error, source/source-static, external): Legacy app-module CLI alias exports (cliAliases, trailsCliAliases) removed in the TRL-1207 surfaces-overlay cutover do not reappear in committed source.
- `no-legacy-layer-imports` (error, source/source-static, external): Legacy layer exports removed across TRL-475/TRL-476 (authLayer, autoIterateLayer, dateShortcutsLayer) do not reappear in committed source.
- `no-top-level-surface` (warn, source/source-static, external): Topo export modules do not open surfaces at module top level.
- `owner-projection-parity` (error, source/source-static, internal): Framework projections stay aligned with owner exports.
- `prefer-schema-inference` (warn, all/source-static, advisory): Trail schemas should be inferred unless overrides add meaning.
- `public-export-example-coverage` (error, source/source-static, repo-local): Public API barrel exports carry leading @example TSDoc coverage.
- `public-internal-deep-imports` (error, project/project-static, internal): Cross-package imports stay on package-owned public exports.
- `public-union-output-discriminants` (error, topo/topo-aware, external): Public output object unions expose branch discriminants.
- `reference-exists` (error, project/project-static, external): Reference declarations resolve to known contours.
- `unreachable-detour-shadowing` (error, source/source-static, external): Specific detours are not shadowed by earlier broader detours.
- `valid-describe-refs` (warn, all/project-static, advisory): Describe references point at known Trails concepts.
- `warden-export-symmetry` (error, source/source-static, repo-local): The Warden package exports trail wrappers, not raw rules.
- `warden-rules-use-ast` (error, source/source-static, repo-local): Warden source rules use AST helpers instead of ad hoc parsing or raw node-field casts.

#### Lifecycle

- `deprecation-without-guidance` (error, topo/topo-aware, external): Deprecated trail version entries carry successor, migration, or note guidance.
- `draft-file-marking` (error, source/source-static, external): Draft-authored state is visibly marked in filenames.
- `draft-visible-debt` (warn, source/source-static, external): Draft-authored IDs remain visible debt.
- `fork-without-preserved-blaze` (error, source/source-static, external): Fork version entries preserve their historical blaze.
- `governed-symbol-residue` (error, source/source-static, external): Active governed vocabulary symbol renames do not leave retired identifiers in source.
- `marker-schema-unsupported` (error, source/source-static, external): Versioned schemas stay inside the supported marker projection subset.
- `pending-force` (warn, topo/topo-aware, external): Forced topo break audit events do not remain pending indefinitely.
- `scheduled-destroy-intent` (warn, topo/topo-aware, external): Schedule-activated destroy trails make unattended destructive work visible for review.
- `unmaterialized-activation-source` (warn, topo/topo-aware, external): Activation sources have an available runtime materializer before runtime delivery is assumed.
- `version-gap` (error, topo/topo-aware, external): Trail version coverage remains contiguous through the current version.
- `version-without-examples` (warn, topo/topo-aware, external): Live historical version entries include examples.

#### Meta

- `cli-command-route-coherence` (error, topo/topo-aware, external): CLI command routes and aliases resolve to one coherent trail contract.
- `duplicate-public-contract` (warn, topo/topo-aware, external): Public surface trails should not expose duplicate normalized contract facts.
- `library-projection-coherence` (error, topo/topo-aware, external): Resolved library projection exports are collision-free and target existing trails.
- `surface-overlay-coherence` (warn, topo/topo-aware, external): Surface overlay bindings resolve to real trails without group overlap or canonical-entry shadowing.
- `surface-trailhead-coherence` (warn, source/source-static, external): Trailhead maps avoid selector overlap, hidden visibility widening, and drift-prone dynamic selectors.
- `trail-fork-coaching` (warn, all/source-static, advisory): Trails avoid hiding distinct capabilities behind branching action or operation inputs.
- `trailhead-override-divergence` (warn, project/project-static, external): Call-site MCP trailhead maps stay aligned with authored surfaces overlay mcp bindings.

#### Permits

- `no-dev-permit-in-source` (error, source/source-static, external): The `--dev-permit` CLI flag string never appears in committed source.
- `permit-governance` (warn, topo/topo-aware, external): Destroy trails declare explicit permit requirements.

#### Resources

- `missing-reconcile` (warn, project/project-static, external): Versioned CRUD store tables provide reconcile coverage.
- `resource-declarations` (error, source/source-static, external): Resource usage is declared on the trail contract.
- `resource-exists` (error, project/project-static, external): Declared resources resolve to known resource definitions.
- `resource-id-grammar` (error, source/source-static, external): Resource identifiers stay out of the scope separator grammar.
- `resource-mock-coverage` (warn, source/source-static, external): Resource definitions declare a mock factory or an explicit unmockable reason.
- `static-resource-accessor-preference` (warn, all/source-static, advisory): Trail logic should prefer static resource helpers over dynamic accessors.

#### Results

- `error-mapping-completeness` (error, source/source-static, extension): Registered surface error mappers cover every error category.
- `implementation-returns-result` (error, source/source-static, external): Blazes return Result values.
- `no-native-error-result` (error, source/source-static, external): Result error boundaries carry specific TrailsError subclasses.
- `no-redundant-result-error-wrap` (warn, source/source-static, external): Result error pass-throughs preserve the original Result boundary.
- `no-sync-result-assumption` (error, source/source-static, external): Result accessors are not used before async results are awaited.
- `no-throw-in-detour-recover` (error, source/source-static, external): Detour recovery returns Result instead of throwing.
- `no-throw-in-implementation` (error, source/source-static, external): Blazes return Result.err() instead of throwing.
- `public-output-schema` (error, topo/topo-aware, external): Public MCP/HTTP surface trails declare output schemas.
- `valid-detour-contract` (error, topo/topo-aware, external): Runtime detour contracts use error constructors and recover functions.

#### Signals

- `activation-orphan` (warn, topo/topo-aware, external): Signal activation consumers reference sources with producer declarations.
- `fires-declarations` (error, source/source-static, external): Declared fires stay aligned with signal firing usage.
- `on-references-exist` (error, project/project-static, external): Trail on: declarations resolve to known signals.
- `orphaned-signal` (warn, project/project-static, external): Derived store signals are consumed by matching trail on: consumers.
- `read-intent-fires` (warn, source/source-static, external): Read trails should not declare signal fires side effects.
- `signal-graph-coaching` (warn, topo/topo-aware, external): Typed signal contracts either declare a producer or participate in reactive consumption.

### Structured Guidance Summaries

- `cli-command-route-coherence`: Keep every CLI command route and alias normalized into one trail contract.
- `dead-public-trail`: Anchor exported public trails in a topo, composition edge, or activation source.
- `duplicate-exported-symbol`: Keep exported symbol ownership from drifting across first-party packages.
- `duplicate-public-contract`: Keep duplicate public contract facts from drifting into separate capabilities.
- `example-valid`: Keep trail examples synchronized with their authored schemas.
- `library-projection-coherence`: Keep resolved library projection exports collision-free and attached to one trail contract.
- `no-throw-in-implementation`: Convert thrown failures in blazes into explicit Result.err() outcomes.
- `no-top-level-surface`: Keep topo entry modules side-effect-free for survey, guide, compile, and lock generation.
- `permit-governance`: Make destructive trail authorization visible on the trail contract.
- `prefer-schema-inference`: Let schemas remain the owner for field metadata unless an override adds new information.
- `public-output-schema`: Make public surface result contracts explicit before MCP/HTTP projection.
- `resource-declarations`: Keep infrastructure dependencies declared on the trail contract.
- `resource-exists`: Make declared resources resolve to authored resource definitions.
- `resource-mock-coverage`: Make each resource declare a test mock or an explicit unmockable reason.
- `static-resource-accessor-preference`: Use statically scoped resource helpers when the resource definition is already available.
- `surface-overlay-coherence`: Keep surface overlay bindings pointed at real trails without shadowing canonical surface entries.
- `surface-trailhead-coherence`: Keep trailhead maps reviewable before they reach MCP projection.
- `trail-fork-coaching`: Keep surface accommodations from hiding several capabilities behind one branching trail input.
- `trailhead-override-divergence`: Keep call-site MCP trailhead overrides aligned with the authored overlay default.

<!-- warden-guide:end -->

## Draft State

- `_draft.` is the reserved marker for draft IDs.
- Files whose primary purpose is draft-authored state should use the `_draft.` prefix.
- Otherwise-normal files that contain draft-authored state should use a `.draft.` trailing segment before the extension.
- Draft-authored state is visible debt. It must never leak into established surfaces, topo exports, committed lockfiles, or other established outputs.
- Prefer the built-in promotion workflow when moving draft state into the established graph instead of hand-editing large batches of references.

## Shared Conventions

Shared TSDoc and code-shape guidance for packages and apps lives in [Code Standards](docs/contributing/code-standards.md). `apps/AGENTS.md` and `packages/AGENTS.md` should remain thin pointers there plus any small local overrides. `.claude/rules/coding-conventions.md` is a compatibility pointer for Claude rule loaders and older prompts.

## Distribution-Ready Done

Feature work is not complete until the surrounding developer experience is complete or explicitly marked not applicable. Treat this as part of the implementation, not a separate cleanup wish.

Before calling an issue done or moving a PR out of draft, check the affected distribution surfaces:

- **Docs and examples:** update the nearest fieldguide, API docs, examples, ADRs, or runbooks that teach the behavior.
- **Agent guidance:** update `AGENTS.md`, repo skills, plugin metadata, or tool-specific guidance when agents need new rules or vocabulary.
- **Governance:** add or update Warden rules, generated Warden guide output, and drift checks when the behavior creates governable contract boundaries.
- **Release path:** satisfy release rules on the owning branch. Add a branch-local changeset for publishable package changes, including public trail additions/removals, visibility transitions, input/output changes, and surface exposure changes, or use the compatibility `release:none` override only when the package-touching change is truly not user-visible and carries a reason.
- **Release-pack coherence:** package version and changelog branches must pack with coherent first-party dependency ranges. The local pre-push guard checks `bun.lock` workspace metadata for generated release branches and package release metadata changes; CI's **Release Pack** check runs the full `bun run publish:check` validation before merge.
- **Wayfinder dogfood:** run `trails release smoke --check wayfinder-dogfood` or the repo wrapper `bun run wayfinder:dogfood` when a branch changes framework surfaces, the Trails operator topo exposure, Topographer artifact export, Wayfinder queries, or fresh app loading. This is the repo's semantic graph-navigation smoke: it checks operator and demo topo facts, resources, signals, errors, relation views, invalid grammar, and artifact provenance after rejected compiles. If it is not applicable, say why in the PR or handoff.
- **Lock round-trip:** every committed `trails.lock` must recompile against a cold store (temp state home) to a byte-identical file with `trails validate` green. `trails release smoke --check lock-roundtrip` (repo wrapper `bun run lock:roundtrip`) enforces this in `bun run check` and CI's Governance job. When it fails, run the `trails compile` command from the failure output and commit the refreshed lock — hand-editing a lock is never the remediation.
- **Migration path:** document commands, compatibility windows, bridge steps, or intentional non-support when existing apps may have committed artifacts or source that need to move.
- **Publication readiness:** run `bun run publish:check` for package-impacting work and record any first-time package, dist-tag, registry, or auth considerations before release.

Small internal refactors do not need ceremonial docs. They do need an explicit "not applicable" callout when a reviewer or future agent could reasonably expect docs, skills, changesets, or migration notes. Done means the framework change is usable, teachable, and releasable, not merely implemented.

## Workflow

Use Graphite for source control operations.

| Instead of               | Use           |
| ------------------------ | ------------- |
| `git checkout -b`        | `gt create`   |
| `git commit --amend`     | `gt modify`   |
| `git push`               | `gt submit`   |
| `git pull` / `git fetch` | `gt sync`     |
| `git checkout`           | `gt checkout` |

- `git status` and `git diff` are the normal read-only exceptions.
- We use Conventional Commits.
- Keep PRs small, isolate mechanical changes when possible, and keep PRs in draft until CI is green.
- When referencing Linear issues or GitHub PRs, use Markdown links whose label is only the short identifier, such as `[TRL-1091](...)` or `[#830](...)`, so handoffs stay easy to scan and jump through.
- Treat a Greptile error comment (`Greptile encountered an error while reviewing this PR`) as a blocker, not as a completed review.
- When performing fixes across stacked branches, prefer the owning branch: check it out, make the focused fix there, `gt modify`, restack, and verify upward. Use `gt absorb -a` only when the stack owner explicitly chooses a top-branch absorption workflow.
- During local review, missing branch-local release intent for public trail additions/removals, visibility transitions, input/output changes, or surface exposure changes is a P2 release-quality blocker. Identify the owning branch, add the changeset or explicit no-release reason there, restack, and re-run `bun run changeset:check` or `trails release check --json` upward.
- For Codex/Crew worktree farming, the worker worktree must have a real branch checked out. `gt create` does not work from detached `HEAD`. A zero-diff Graphite-tracked base branch under `main` is acceptable as the worker lane base; workers may create child branches from that lane and hold before submit.

## Subagent Rules

Subagents must not perform `git` or `gt` write operations. Only the main agent handles source control.

- Subagents can write and edit files.
- Subagents can run tests and lint checks.
- Subagents can report results.
- Subagents do not run `gt create`, `gt add`, `gt modify`, or `gt submit`.
- Subagents do not run `git add`, `git commit`, or `git push`.
- Subagents do not create branches, make commits, or push anything.
- The main agent collects subagent work and commits it.

### Brief Discipline

Two principles gate whether a subagent dispatch produces usable findings versus fabricated output. Apply both.

#### Principle 1: Concrete anchors beat semantic descriptions

Briefs should name the artifacts the subagent must read, not just the semantics it should produce. Paraphrasing source code, types, or conventions leaves room for the subagent to invent what those artifacts contain.

##### 1.1 Pin the data shape

When the task involves subtle data structures or framework types, name the canonical declaration and file:line in the brief. Do not rely on prose like "render the trace as a tree" when the exact `TraceRecord` fields matter. Pin the field names, discriminants, and source type before asking for implementation or review.

##### 1.2 Port from a named source and line

When the task ports behavior from existing code, name the source helper and line range. A brief that says "implement partial matching" is weaker than one that says "port the semantics of `assertSubset` and `findObjectMatch` from `packages/testing/src/assertions.ts:<line>`." The named source makes alignment testable instead of aspirational.

##### 1.3 Name the narrowing or type-guard pattern

When the codebase has converged patterns, cite them. Examples include `instanceof TrailsError` for error narrowing, `isPlainObject` from `@ontrails/core` for object guards, or established casts in test fixtures. Without the pattern anchor, subagents tend to produce locally plausible but inconsistent checks.

#### Principle 2: Unknowns demand grounding, not invention

When the subagent cannot verify something, the correct output is an explicit unknown, not a plausible guess.

##### 2.1 Scope-fit

Before dispatching, ask whether the task can be expressed as bounded predicates over known artifacts, where "predicate fails" and "artifact missing" are both legible answers. If the task is "look around and tell me what you find," keep it in the main context or break it into bounded predicates first.

##### 2.2 Anti-fabrication framing

Briefs should say that "unable to verify" is acceptable and invented references are not. A subagent that cannot cite a claim should report that gap and continue or stop, depending on the brief. Inventing file paths, line numbers, branch descriptions, or source content is a hard failure.

##### 2.3 Quote, do not paraphrase

Every claim about file contents should include a verbatim quote with file path and line range when the task is evidentiary. If the subagent cannot quote the exact text, it should report "unable to quote" rather than approximate from memory.

#### How the principles compose

Anchor what you can; ground the rest. Principle 1 reduces the unknown surface area before dispatch. Principle 2 handles the residue when an otherwise bounded task hits missing or ambiguous evidence.

#### Operational constraints

Use these constraints alongside the two principles:

- Do not ask subagents to create their own task lists. The main agent owns task tracking.
- Do not let subagents run source-control write commands.
- Specify exact write targets when a subagent is allowed to write findings.
- Name known pre-existing noise upfront so subagents do not rediscover unrelated issues.

## Releasing

All `@ontrails/*` packages are versioned in lockstep using [Changesets](https://github.com/changesets/changesets) in pre-release (`beta`) mode. We use Changesets only for versioning and changelogs — **not** `changeset publish`. Publishing goes through `bun publish` via our script, which correctly resolves `workspace:^` to real versions (npm publish does not).

```bash
# 1. Add a changeset (or create .changeset/<name>.md manually)
bunx changeset add

# 2. Version
bun run version:packages

# 3. Commit, push, publish
git add -A && git commit -m "chore: version packages to 1.0.0-beta.N"
git push
bun run publish:check
bun run publish:packages
```

Every PR that changes publishable `@ontrails/*` package contents must satisfy branch-local release rules. The normal intent source is a `.changeset/*.md` entry for the affected package. The compatibility `release:none` label/flag is allowed only when the branch truly does not ship user-visible package content, and the PR, issue, or handoff explains why. The CI release check reads the GitHub PR file list, so stacked PRs are checked against their immediate PR diff rather than the whole local stack. Public trail additions/removals, visibility transitions, input schema changes, output schema changes, or surface exposure changes are release facts and need the same branch-local intent. Fix missing release intent on the owning Graphite branch; do not paper over lower-branch release gaps with a top-stack cleanup changeset.

To exit pre-release mode for a stable release: `bunx changeset pre exit`, then version as usual. Stable 1.x release doctrine is captured in [ADR-0047](docs/adr/0047-stable-release-line-discipline.md), and the copy-pasteable beta-to-1.0 operator sequence lives in [Stable Cutover Runbook](docs/releases/stable-cutover.md).

`bun run publish:check` auto-discovers every non-private workspace, topo-sorts by `workspace:` dep edges, runs `bun pm pack --dry-run` per package (required because `npm pack` does not resolve `catalog:`), and asserts the packed `package.json` contains no unresolved `workspace:` or `catalog:` ranges. It also verifies first-party `workspace:` ranges pack to the current lockstep package versions, so generated release PRs cannot merge with stale `bun.lock` workspace metadata. `bun run publish:registry-check` performs read-only registry/dist-tag probes before publication; missing packages are reported as first-time package candidates. After publishing, use `bun run publish:registry-check:published` to require every package and expected dist-tag to be present. `bun run publish:packages` uses the same discovery and applies the explicit dist-tag from `.changeset/pre.json` (falling back to `latest` outside prerelease mode). Packages intentionally ship source `.ts` files while their `exports` map points at `src`; test files, `dist`, `.turbo`, and `*.tsbuildinfo` should stay out of the published tarballs.

## Testing

- `bun:test` is the test runner.
- Follow TDD when the work is substantial: red, green, refactor.
- Trail examples are the happy-path tests. Add focused tests for edge cases, error paths, and integrations when examples are not enough.

Each package's main `tsconfig.json` excludes test files so build output stays clean. A sibling `tsconfig.tests.json` includes them so editors' LSP can resolve tests (e.g. `Array.prototype.toSorted`). Neither affects the `tsc --noEmit` CI gate, which still uses the main config.

## Reference Docs

- `docs/getting-started.md`
- `docs/architecture.md`
- `docs/lexicon.md`
- `docs/warden.md`
- `docs/why-trails.md`
- `docs/testing.md`

## Linear

- Team: `TRL`
- Team ID: `97523b42-84f2-4cea-bd70-22b245cc3f59`
- Branch naming: `trl-NNN-<linear-title>` when working from a Linear issue
