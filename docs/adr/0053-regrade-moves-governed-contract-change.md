---
id: 53
slug: regrade-moves-governed-contract-change
title: Regrade Moves Governed Contract Change
status: accepted
created: 2026-07-15
updated: 2026-07-16
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 7, 23, 37]
---

# ADR-0053: Regrade Moves Governed Contract Change

## Context

Trails makes contract definition the source of truth. A trail ID, schema, intent, and error taxonomy fan out into surfaces, documentation, governance, and the resolved graph. The v1 vocabulary reset exposed the missing half of that model: changing an established contract can drift just as easily as defining one unless the change has its own authored intent and derived proof.

A broad replacement script cannot tell which occurrence carries contract meaning. It sees the retired `project` verb and the ordinary `project` noun as the same token. It rewrites rendered outputs that should regenerate from their owner. It also has no durable answer for an ambiguous occurrence beyond changing it, skipping it, or leaving a comment for later.

The first Regrade tracer proved that a plan, occurrence ledger, and report could preserve CLI and MCP behavior through a governed rename. The next three vocabulary families made the boundary sharper. They required AST-aware symbol work, public API review, protected historical evidence, file movement, reference closure, classification by lifecycle stage, and durable proof that a completed migration stayed complete.

The question is not whether Trails needs a general codemod framework. It does not. The question is how Trails changes contract-bearing source without giving up the same alignment guarantees it provides when that source is first authored.

## Decision

**A governed contract change is a Regrade.** Regrade authors transient migration intent, applies the safe slice, routes uncertain occurrences to review, and commits immutable evidence of what was observed. It is Trails using Trails, not a new top-level framework primitive.

### Regrade works because it knows Trails contracts

An operation belongs in Regrade only when contract or graph knowledge makes it safer or smaller than a general source transform.

The test:

> Would this operation work just as well on code that has nothing to do with Trails?

If yes, use a general tool such as an AST rewrite or search utility directly. If no—because the operation needs authored contract identity, topo facts, Warden diagnostics, surface derivation, or Trails lifecycle policy—it belongs in Regrade.

This boundary means Regrade changes authored contracts and the source that establishes them. Derived facts and rendered outputs should regenerate from their owner. Rewriting a rendered output is a warning that Regrade has crossed the authored boundary, unless that artifact is intentionally committed because its diff is itself a governance surface.

A name change can still pass the test. Renaming a trail ID is not only a text edit: the CLI command, MCP tool name, lock key, references, governance facts, and docs may derive from or teach the same authored identity. Regrade changes the owner, verifies the fan-out, and reviews occurrences where the relationship cannot be proved.

### Ownership stays split by lifecycle

No second database owns framework truth.

| Owner | Responsibility |
| --- | --- |
| Trail contracts and the resolved graph | Current framework and application truth. |
| Warden | Durable rules, reusable detection, severity, and structured fix metadata. |
| Regrade plan | Authored, transient migration intent and reviewed scope. |
| Regrade execution | Collection, check, preview, conservative apply, validation, and review routing. |
| Regrade history | Compact immutable run receipts: intent, reproducibility keys, durable judgments, and completion facts. |
| Regrade report and audit | Derived views of detailed occurrence state and current residue. |

Warden governs what must remain true after a migration. Regrade moves the contract toward that truth. Regrade may consume Warden diagnostics selected by structured rule and fix fields, but it does not scrape diagnostic messages to decide what migration to run or whether an edit is safe. Message text may remain human-facing context; it is not the integration protocol.

### The plan authors migration intent

The plan is the one active, reviewable statement of a migration. Minimal `from` and `to` input may derive morphology, casing, namespace census, candidate file moves, live-topo preserves, and review proposals. Every derived field records provenance. Reviewers can then distinguish what a person chose from what the framework proposed.

```json
{
  "kind": "regrade-plan",
  "plan": {
    "id": "v1-blaze-implementation",
    "kind": "vocabulary",
    "from": "blaze",
    "to": "implementation",
    "intent": "Move the authored trail behavior field for v1."
  },
  "provenance": {
    "fields": {
      "from": "authored",
      "to": "authored",
      "fileRenames": "derived",
      "preserve": "derived"
    }
  }
}
```

Authored overrides tighten or correct derivation. They do not create a second untracked migration path. If review changes the intended migration, update the active plan and rerun the lifecycle.

### Scope has three tiers

Every governed run separates collection policy from occurrence disposition:

- **Hard excluded** paths are mechanical noise that is not scanned, such as
  dependencies, build output, caches, and local scratch state.
- **Policy-classified** paths are scanned and counted but protected from
  default mutation. Changelogs, accepted ADR history, archived plans, and
  changesets belong here when they preserve historical evidence.
- **In-scope** paths are current source, tests, docs, examples, skills,
  generated guidance, and release guidance. They are scanned normally.

Collection uses the shared `PathScope` fields: `include`, `exclude`, and `extensions`. A plan adds `policyClassified` rules when protected evidence must remain visible and `teachingSurfaces` when current documentation coverage is part of completion. Current docs cannot disappear behind a broad exclusion to make the gate green.

### Completion is occurrence-level and observed

Regrade does not accept a declaration that a migration is done. It observes each occurrence and records one of four verdicts: applied, modified, deferred, or skipped. A separate disposition classifies why that verdict is correct. Preservation is a skipped verdict with an explicit preserve disposition and evidence, not a fifth verdict. The completion report derives its gate from those facts.

This means:

- a preserve in one path does not suppress the same form elsewhere;
- an unknown form remains review inventory rather than becoming an inferred
  replacement;
- zero source matches is meaningful only when the expected scope and teaching
  surfaces were actually scanned; and
- Warden can use committed history to distinguish valid historical evidence,
  a reintroduced retired form, and an unknown permutation.

### Application is conservative and transactional

`check` validates the active plan and its freshness. `preview` shows the run without writes. `apply --dry-run` exercises apply evaluation and preflight, then returns before the mutating branch. Real `apply` writes only the safe slice after preflight.

Ambiguous or unsupported work stays in structured review inventory. It does not become a guessed edit. File moves are authored in the plan, applied before one derived reference-closure pass, and rolled back with earlier writes if a later mutation fails. Historical references remain counted without being silently rewritten.

CLI and MCP render the same five lifecycle trails: plan, list, check, preview, and apply. Surface parity is part of the contract because an agent must see the same plan, gate, report, and history facts regardless of how it reaches the trail.

### Applied plans become compact immutable receipts

The lifecycle is:

```text
active plan -> check -> preview -> apply -> immutable committed history
                                      |
                                      +-> derived report and audit
```

Apply removes the active plan and appends a compact run receipt to its consolidated history artifact. Git owns the changed content; the receipt owns what Git cannot reconstruct: authored intent, reproducibility keys, durable form judgments, counts, changed-file identity, and one completion-facts block. Full occurrence ledgers and rendered reports are derived observations, not committed primary truth.

Each receipt records the authored plan and its canonical content hash, normalized project identity, tool and policy identity, source and lock state hashes, a content address for regenerable detailed evidence, and Git-resolvable before/after blob hashes for changed files. The classified form state is one row per distinct form. A changed form state is embedded; an unchanged state is hash-referenced to an earlier run and resolved by the loader without a cache. Proof runs likewise reference prior intent and classified state, so proving that nothing changed stays small.

`@ontrails/regrade` owns the strict receipt schema, content hashes, reference resolution, and deterministic canonical serializer. Filesystem persistence may remain with an application surface, and Warden may validate a narrow consumer projection, but Warden must not import Regrade while Regrade depends on Warden. Readers always receive resolved form state. Broken references, mismatched transitions, duplicate form identities, stale hashes, malformed receipts, and invalid evidence fail loudly.

There is one generator-owned history file per stable transition, selected by transition identity rather than an operator-provided path. Runs append inside that file. The serializer recursively stabilizes object keys and normalizes receipt-owned sets before writing, and repository formatters exclude generated history. A successful apply therefore emits repository-canonical bytes without a formatter rewrite pass.

Every path-bearing receipt field is a normalized root-relative POSIX path or glob. The invariant covers the history path, changed files, representative form locations, file moves, scope controls, and preserve paths inside embedded plans. Loader validation rejects machine-absolute, escaping, or platform-specific paths while leaving authored non-filesystem strings such as HTTP routes untouched.

An adjustment is explicit. It copies a graduated transition back into an active plan without mutating prior runs. A later apply appends a receipt to the same history spine. Immutable history is excluded from later source collection, preventing recursive evidence growth, while remaining available to Warden and audit through their owned readers.

Lifecycle performance does not create a second evidence system. Apply may retain its preflight classification in memory and reuse it only when receipt-aligned plan, policy, scope, lock, and tool identities still match and exact source paths and bytes remain current. Project Warden policy identity includes the resolved project-local module graph for every discoverable rule rather than function serialization, which cannot reveal closure-captured behavior. Prepared evaluations are process-local, fail closed when cloned or stale, and are never serialized or required for receipt regeneration. Mutation ordering may invalidate a prepared lane, so vocabulary symbol preview reruns before mutation and later lanes reevaluate against the changed tree. The independent post-apply completion scan always remains authoritative.

The eight pre-receipt histories convert once through governed tooling. Conversion first validates the old artifact, derives the receipt as a strict subset of the snapshot facts, and records the original whole-file SHA-256 plus conversion tool identity. Old bytes remain reconstructable from Git. The conversion must preserve Warden diagnostics, produce byte-identical canonical regeneration, and leave no permanent mixed-schema reader. This governed exception changes the storage shape, not the historical judgment.

### Four vocabulary families establish the contract

The v1 reset increased judgment density one family at a time.

| Family | What the run proved | Failure that improved Regrade |
| --- | --- | --- |
| `facet` to `trailhead` | The tracer established registry-owned intent, plan/ledger/report flow, CLI/MCP parity, and a hard surface-visible cutover. | The first run exposed missing structured review and downstream-source seams instead of justifying a larger replacement script. |
| `blaze` to `implementation` | A high-blast authored API field could move while English phrases, historical evidence, and public declarations stayed reviewed. Its consolidated history retains two runs. | Broad lexical matching could not decide that “blaze a trail” was ordinary prose; explicit preserves and AST/public-API review became required. |
| `contour` to `entity` | A common domain noun could replace a framework declaration without treating every app-domain entity occurrence as migration work. Its history retains three runs. | Type names, fail-loud legacy guards, and historical ADR references needed distinct evidence instead of one family-wide skip. |
| `projection`/`project` to `derive`/`render` | A classification family split contract-owned fact production from presentation, moved 16 files with reference closure, and preserved ordinary project nouns. The final consolidated run is green with zero open occurrences and the `docs/**` teaching gate satisfied. | A stale plan correctly stopped the first write; 21 residual reviews found a missed presentation verb; a 48 MB recursively scanned history forced history pruning and a dedicated provenance path. |

The families differ deliberately. A single-target rename can derive more safe work. A common noun needs more preserves. A lifecycle split has no safe global replacement and therefore produces more review. Regrade is one contract across those cases because the plan, occurrence ledger, conservative apply, history, and report remain stable while the migration classes vary.

### Durable governance outlives transient orchestration

The active plan is temporary. The rules that reject retired API shapes, validate governed provenance, catch reintroduced forms, and watch unknown permutations remain after the plan graduates. This is the difference between a completed migration and a one-time cleanup: the old contract cannot silently return.

## Consequences

### Positive

- Contract change follows the same one-write-many-reads model as contract
  definition.
- Reviewers can inspect authored intent, derived proposals, occurrence
  outcomes, and immutable applied evidence separately.
- Agents get the same migration lifecycle through CLI and MCP.
- Historical evidence stays visible without being mistaken for current
  residue.
- Warden and Regrade keep distinct owners, preventing parallel governance and
  migration databases.
- Conservative application makes ambiguity explicit instead of hiding it
  behind a successful command.

### Tradeoffs

- A governed migration requires plan review, scope classification, and
  evidence maintenance beyond the source edit itself.
- Conservative runs leave more work for human or agent review than a broad
  replacement would.
- Detailed ledgers require regeneration when an operator needs occurrence-level
  forensic evidence. Receipts record the source revision, plan hash, policy
  hash, tool version, and detail-evidence hash needed to state that capability
  honestly; no receipt depends on a local cache.
- Regrade classes and Warden fix metadata carry compatibility obligations once
  adopters depend on them.

### Risks

- **Generic-tool creep.** Regrade could become a bag of codemods. Mitigation:
  apply the “works because of Trails” membership test during API and issue
  review.
- **Message-string coupling.** A consumer could infer migration semantics from
  diagnostic prose. Mitigation: route on structured rule, class, safety, edit,
  span, and provenance fields; treat prose only as explanation.
- **False completion.** Broad exclusions or transition-wide preserves could
  hide residue. Mitigation: occurrence-level dispositions, three-tier scope,
  expected teaching surfaces, current-source audit, and Warden history checks.
- **Evidence recursion or duplication.** History could scan itself or rendered
  inventories could become primary truth again. Mitigation: source collection
  prunes immutable history; receipts retain compact facts only; Warden and audit
  load validated projections through dedicated readers.

## Non-goals

- Building a general codemod framework for arbitrary repositories.
- Settling speculative migration classes that the v1 runs did not prove.
- Promising that every breaking change already has an adopter-ready Regrade.
- Making every Warden finding automatically fixable.
- Treating review-required occurrences as safe edits.
- Rewriting historical ADRs, changelogs, release notes, or issue references to
  erase the vocabulary that existed when they were written.

## Non-decisions

- The final public stability level of adopter-authored Regrade classes.
- Which future contract changes require first-party migration classes.
- Whether package-distributed migrations need an additional discovery or
  compatibility protocol.
- Whether explicitly forensic migrations should attach optional compressed
  detailed evidence beyond the regeneration-only v1 receipt contract.
- Any new vocabulary family after the v1 reset.

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — defines authored,
  derived, enforced, observed, and overridden information and the drift guard.
- [ADR-0007: Governance as Trails](0007-governance-as-trails.md) — makes
  Warden the trail-shaped owner of durable governance.
- [ADR-0023: Simplifying the Trails Lexicon](0023-simplifying-the-trails-lexicon.md)
  — establishes the vocabulary discipline applied by the v1 reset.
- [ADR-0037: Owner-First Authority](0037-owner-first-authority.md) — keeps
  migration facts with their natural owner and consumers on derived views.
- [v1 Vocabulary Reset](../releases/v1-vocabulary-reset.md) — execution
  order, family-specific evidence, compatibility posture, and cleanup record.
- [v1 Vocabulary Transition Workflow](../releases/v1-vocabulary-transition-workflow.md)
  — the supported plan/check/preview/apply workflow derived from dogfood.
- [`blaze` to `implementation` history](../../.trails/regrade/history/blaze-to-implementation.json)
  — two-run consolidated evidence for the authored behavior-field cutover.
- [`contour` to `entity` history](../../.trails/regrade/history/contour-to-entity.json)
  — three-run consolidated evidence for the domain-object vocabulary cutover.
- [`projection` to `derive`/`render` history](../../.trails/regrade/history/v1-projection-derive-render.json)
  — final governed provenance, scope, file moves, occurrence ledger, and
  completion report for the classification family.
- [#880](https://github.com/outfitter-dev/trails/pull/880) — merged tracer run
  for `facet` to `trailhead`.
- [TRL-829](https://linear.app/outfitter/issue/TRL-829/) — issue acceptance and
  final evidence boundary for this decision.
