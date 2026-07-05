### 2026-04-13 Contour symbol-tagging approach

**Question:** Should `contour()` symbol-tag Zod schemas with `Object.defineProperty`, or use a WeakMap for tracking contour-schema associations?
**Decision:** Symbol-tagging is correct. `configurable: true` is already set. No change to the approach.
**Basis:** Tenets — "reduce ceremony, not clarity" and information architecture (projected data travels with the authored artifact). WeakMap would couple projection to a specific lookup table, requiring it to be passed everywhere.
**Confidence:** High
**Alternatives considered:** WeakMap keyed by schema object — rejected because it breaks the projection-travels-with-schema property.

### 2026-04-13 Cross-contour auto-registration in topo

**Question:** Should `topo()` transitively walk contour field references and auto-register dependencies?
**Decision:** No. Explicit registration with warden enforcement. The warden `contour-exists` rule should cover transitive references from `getContourReferences`.
**Basis:** Drift guard hierarchy — warden-time safety (level 4) is the right level. Auto-registration creates invisible graph expansion that contradicts "the resolved graph is the story."
**Confidence:** High
**Alternatives considered:** Transitive walk — rejected because it imports primitives the developer didn't explicitly declare.

### 2026-04-13 Resource NotFoundError should be InternalError

**Question:** Should `wrapUnexpected` distinguish domain vs infrastructure errors, or should `resource.from(ctx)` throw a different error class?
**Decision:** Fix in `createResourceLookup`: change `NotFoundError` to `InternalError`. Leave `wrapUnexpected` unchanged.
**Basis:** Error taxonomy tenet — `NotFoundError` is domain-level (user asked for something that doesn't exist). Missing resource in context is infrastructure misconfiguration, which is `InternalError`.
**Confidence:** High
**Alternatives considered:** Adding domain/infrastructure distinction to `wrapUnexpected` — rejected because it requires call-site awareness in a context-free function.

### 2026-04-13 ADR-0033 detour warden rule language

**Question:** Should ADR-0033's language about the warden rule be softened, or should the rule be required in the detour runtime PR?
**Decision:** Soften to "planned alongside the runtime; should ship before detours are considered stable." File a P1 Linear issue for the unreachable-detour warden rule.
**Basis:** ADRs are human-readable contracts — a promise of co-shipment that isn't honored is a lie. But blocking the reconcile factory refactor is the wrong tradeoff.
**Confidence:** High
**Alternatives considered:** Requiring the rule in the same PR — rejected because it blocks the primary motivation for the ADR.

### 2026-04-16 `pattern` as metadata, not a callable primitive (TRL-300)

**Question:** Should factory-produced trail shapes introduce a dedicated `pattern` primitive (callable namespace like `pattern.crud(...)`), or keep `pattern` as metadata?
**Decision:** No dedicated primitive. `pattern?: string` is an open-string field on `TrailSpec`. Factories stamp the label; `deriveTrail()` does not. Hand-authorable. Extensible by connectors and community packages without a registry.
**Basis:** Tenets evaluation hierarchy — strengthen existing primitives before introducing new ones. `deriveTrail()` + factories + a real field close the drift guard without adding primitives. The callable-namespace proposal's wins (visible link, warden leverage) are marginal or already satisfied by AST-scans. Its costs — cross-package composition, registry module-load-order, case-of-one rule — are substantial. An open-string field serves the "connectors contribute patterns" vision better than a namespaced registry, which would structurally fight connector extensibility.
**Confidence:** High
**Alternatives considered:**

- Status quo (vocabulary-only, no field) — rejected because the ADR-0032 claim that pattern metadata is set automatically is then permanently untrue.
- Callable primitive namespace `pattern.crud(...)` — rejected on structural grounds (gist §8b/§8c/§8e; cross-package composition complexity; case-of-one rule).
- Inferred pattern (no field; reconstruct from provenance) — rejected because the contract should be queryable directly on the trail, not reconstructed.
**Follow-up:** TRL-301 adds the field and stamps the four shipped factories (`crud`, `sync`, `reconcile`, `ingest`); amends ADR-0032 to correct the two untrue claims and capture the "factory owns the label" / "connector-extensible" framing.

### 2026-04-20 TopoAwareWardenRule — proceed with TRL-268 + TRL-269 as tracer bullet

**Question:** Does landing TRL-301 (`pattern` field now live on `TrailSpec`/`Trail`) change the April 12 deferral ruling that set a "3+ concrete rules blocked" bar before introducing `TopoAwareWardenRule`? Should TRL-268 and TRL-269 ship together now, or should TRL-269 stay runtime-only until a second concrete blocked rule appears?
**Decision:** Proceed with TRL-268 + TRL-269 together. Drop the 3+ rule bar.
**Basis:** Drift guard hierarchy — TRL-269's current defensive runtime check at `derive-trail.ts:546-575` lives at step 5 (runtime diff catches it). Moving it to step 4 (warden catches it) is strictly better per the tenets; the framework already has the data, so requiring developers to discover the accessor mismatch at runtime when a lint rule could catch it earlier is a framework bug. TRL-301 materially changed the inputs: `pattern` is now real authored data on every trail, and the resolved graph carries structured operational intent — the exact surface a topo-aware rule is meant to read. The original 3+ bar was a guard against designing an interface around one speculative consumer only to have the second want a different shape; with TRL-301 landed, the motivation has shifted from speculative to concrete. Tracer bullet (one primitive, one real consumer) beats speculation across two future consumers — learn whether the interface shape holds, then let TRL-271 validate reusability once its own simplification lands.
**Confidence:** High
**Alternatives considered:**

- Hold and keep the 3+ rule bar — rejected because TRL-301 changed the inputs, and leaving TRL-269 runtime-only keeps a framework-bug shape (step-5 detection for a check that belongs at step 4) in place for no architectural gain.
- Ship TRL-268 alone, no consumer — rejected because a primitive without a real consumer is exactly what the original bar was designed to prevent. TRL-269 is the test of the interface shape.
- Design TRL-268 against TRL-269 + TRL-271 + detour coverage simultaneously — rejected because TRL-271's consumer shape is downstream of its own simplification, and detour coverage has no concrete issue. Designing against speculative consumers is the failure mode the April 12 ruling was trying to avoid.
**Follow-up:** TRL-268 lands `TopoAwareWardenRule` interface; TRL-269 converts the runtime defensive check at `derive-trail.ts:546-575` into a topo-aware warden rule and removes the runtime fallback if the rule makes it unreachable. TRL-271's future simplification to use `pattern` field becomes the second consumer once its primary work lands.

### 2026-05-23 OD-4 — reject-and-coach destructured ctx.compose

**Question:** Should Warden accept destructured `ctx.compose` (`const { compose } = ctx; compose(...)`), or reject it with a canonical-pattern coaching diagnostic that steers authors to direct `ctx.compose(...)`?

**Decision:** Reject-and-coach. `ctx.compose(...)` is the single canonical authoring shape for runtime composition. A new Warden rule flags `const { compose } = ctx` (and equivalent destructuring of `compose` off the context binding) in blaze bodies with a teaching diagnostic pointing at direct `ctx.compose(...)`. Do NOT bridge the destructured form into `implementation-returns-result`'s recognition path.

**Basis:** Hierarchy levels 2 + 4 (tenets + lexicon), plus a verified empirical signal.

- Level 2 (tenets): `compose()` / `composes` is a named core primitive and the first-class compositional mechanism. "One write, many reads" requires every consumer (Warden provenance, LSP narrowing of the typed compose overload, future Ranger orientation, error-message copy) to read one authored shape. Two shapes for the same verb is a drift surface the tenets exist to close.
- Level 4 (lexicon/AGENTS.md): `ctx.compose()` is already the prescribed verb ("compose through `ctx.compose()`, never by calling another trail's .blaze() directly"). Steering to it is enforcement of an existing convention, not a new one.
- Empirical (verified this session): `implementation-returns-result` recognizes composition only through the member expression `ctx.compose` (rule source `packages/warden/src/rules/implementation-returns-result.ts:40-42`, `isResultMemberCall` hard-matches objName==="ctx" && propName==="compose"). A destructured `compose(...)` is a bare Identifier callee, misses `isResultMemberCall`, misses `isHelperCall` (compose is not an annotated Result helper), and produces a false-positive re-wrap diagnostic. Radio fieldwork F02 (2026-05-23) cut re-wrap errors 7->2 by converting 3 composing trails to direct `ctx.compose(...)`. The reduction is mechanically explained by the member-expression match.

**Why reject over bridge:** Bridging the destructured form into the AST rule would teach Warden to tolerate a shape that the *other* guidance channels cannot follow. LSP cannot narrow the typed compose overload through a destructured binding; error-message and orientation copy would have to enumerate two shapes forever. Bridging accommodates a shadow pattern; rejecting eliminates it at lint time, which is exactly where the drift guard wants this (step 4: warden catches it). The shadow pattern is the thing to kill, not the thing to support.

**Confidence:** High. Aligned position of both co-architects (Clark + Lewis); load-bearing empirical claim independently verified against live rule source this session. Matt retains veto under the current operating model.

**Alternatives considered:**

- Accept both shapes (bridge destructuring into the rule) — rejected: fragments guidance across two shapes that LSP/orientation/error copy cannot all follow; accommodates the shadow pattern instead of removing it.
- Accept silently, no coaching — rejected: leaves the false-positive re-wrap diagnostic in place for destructured authors and gives no path to the canonical shape.

**Follow-up:** File the Warden TRL framed as this decision (new coaching rule for destructured `compose` in blaze bodies). Sits under the Fieldwork Loop umbrella, Workstream 2 (Warden as Coach) + Shadow Pattern Catalog. The teaching diagnostic should name both costs concretely: breaks LSP narrowing of the typed compose overload, and breaks Warden provenance tracking. Existing memory `reference_warden_result_recognition.md` (TRL-785/786/787) already documents the recognition gap; link the new rule TRL there.

### 2026-05-28 Adapter authoring paved path

**Question:** Should adapter authoring remain a deferred/doc-first idea, or should Trails build the full paved path now, including subpath adapter scaffolding, generated conformance tests, cataloging, and checks?

**Decision:** Build the paved path now. Adapter authoring is a first-class Trails capability, but not a new `adapter()` runtime primitive. Extracted adapters live under `adapters/`; subpath adapters are a first-class carve-out when ADR-0029's dependency-boundary test says a standalone package would add ceremony without buying a real boundary. Owner packages that invite adapters owe adapter authors an authoring bundle: support helpers when needed, conformance cases, fixtures/examples when useful, and the small target metadata derivation cannot know. Adapter tooling may live in a shared kit package, but it consumes owner facts and derived package facts; it does not own adapter truth. `trails adapter check` and Warden adapter checks must share one underlying check engine.

**Basis:** ADR-0000 and tenets ("author what's new, derive what's known, override what's wrong"; one write, many reads; reduce ceremony, not clarity), ADR-0029 (extracted adapters under `adapters/`, subpath carve-outs for built-in/no-boundary materializers), ADR-0035 (surface ladder), ADR-0037 (owner-first authority and future adapter descriptors), and the lexicon definition of `adapter` as a package/subpath category rather than a primitive.

**Confidence:** High on the architecture; medium on exact package name and metadata syntax.

**Alternatives considered:**

- Manual conformance wiring in each adapter - rejected because correctness would live in docs and memory instead of generated scaffolding.
- Central adapter truth in an adapter kit - rejected because HTTP, store, permit, and observe semantics belong to their owner packages.
- Extracted-only adapter model - rejected because ADR-0029 already preserves subpath adapters and built-in materializers.
- Warden-only checks - rejected because Warden is governance, not the focused authoring surface.
- CLI-only checks - rejected because adapter drift belongs in governance and CI.

**Follow-up:** Use `.agents/notes/2026-05-28-adapter-authoring-paved-path.md` as the execution-shape note. Promote into an ADR before implementation. Sequence the stack as ADR -> internal adapter tooling substrate -> one-owner HTTP tracer combining owner conformance plus shared check engine -> Warden and `trails adapter check` surfaces -> `create.adapter` scaffolding -> dogfood existing adapters -> catalog/describe read views and docs. Keep the tooling package internal and not author-facing; if public CLI or Warden packages depend on it, publish it as tooling while enforcing that runtime adapters do not import it. Generated conformance tests stay thin calls into owner-owned dynamic factories.

### 2026-06-09 Script graduation doctrine: derive-vs-consume

**Question:** What rule decides whether repo behavior belongs in root `scripts/` versus a Trails concept (package API, app surface, Warden, Wayfinder, release rules)? Matt was stuck on a three-tier audience model whose middle tier ("contributor confidence") was undecidable.

**Decision:** Replace the audience-tier model with a single binding test. The mental model is a 2x2 matrix on two independent axes — (A) is it a Trails *concept*? and (B) who is it for: Trails users vs. building Trails itself. Axis B does NOT decide the home; it only names trajectory (the "Trails-concept x building-Trails" quadrant is the dogfooding nursery where capabilities like `release.check` are born and graduate). Axis A decides the home, sharpened to one question:

> **Does this own logic that *derives* facts from a Trails concept's contract?**
>
> - Derives → the logic belongs *in the concept*, exposed as a trail/surface/rule. Graduate.
> - Only *consumes* already-derived output to do file/repo work → it may stay a script.

A script may consume Trails concepts; it may not own their derivation. The bug that bloated `scripts/` was letting "we only use it ourselves" (axis B) override axis A. General heuristic underneath, for any repo: `scripts/` = things you run *on* the repo; `src/` = what the repo *is*. Trails is the unusual case where the repo's plumbing IS the product's domain, so "is it plumbing?" stops discriminating and must be replaced by the derive test.

**Applied this session (TRL-942/943):** scaffold-version sync *derives* the `create` scaffold contract → graduate to the create surface (tell: the generated file already lives in-app). public-API example coverage *derives* a public-surface contract fact → graduate to a Warden advisory rule. The warden-guide and error-taxonomy syncs only *render* facts their concept already owns → shrink to thin callers, no new home. publish.ts / registry-preflight derive only npm facts, so they do not belong in *core* — but they fill the release lifecycle's publisher/emitter seam, so they belong as **adapters** (bun-publish, npm-publish, changesets), with our own publish.ts as the dogfood consumer. This revealed a third doctrine home (see refinement below).

**Refinement (the consume side has its own graduation path — adapters):** The original derive-vs-consume test was binary (derive → graduate; consume → stay). Matt's TRL-938 input completes it: a *consumer* that wires an external system into a **declared Trails lifecycle/extension seam** is an **adapter**, not a script. So the test routes to three homes, not two: (1) derives concept facts → into the concept (core trail/surface/rule); (2) consumes facts to fill a declared seam → adapter (extensible; third-party deps → standalone package per ADR-0029, zero-dep → subpath); (3) consumes facts for a repo chore with no seam → stays a script (or shrinks to a caller if it only renders concept output). This aligns release/publish with the established adapter paved-path doctrine (2026-05-28 decision; ADR-0029).

**Watch-item (release rules vs Warden):** `releaseRuleSchema` ({id, enabled, severity, description, facts, intent}) is structurally a governance rule, mirroring Warden without being Warden. ADR draft (release-provenance-as-lifecycle-projection) consciously framed release as a lifecycle *projection* (diff-provenance) distinct from Warden's state-validation axis, and exposed it as a `release.check` trail rather than a new primitive — which is correct and accepted. But two parallel rule-eval vocabularies is the ceiling. **Trigger: if a third "rules" engine appears, unify them under one governance substrate.** Two is coincidence; three is fragmentation (fights "additions strengthen primitives, not fragment them").

**Confidence:** High on the derive-vs-consume test and the accept-with-watch posture on release rules. Medium on exact graduation homes (create.versions trail shape; warden rule severity).

**Basis:** Tenets — evaluation hierarchy (strengthen before introduce), "add with intent not trend," the information-architecture Authored/Projected split (derivation is Projected and belongs to the concept). Builds on memory `feedback_gate_on_unmet_need_not_substrate` and `feedback_evaluation_hierarchy_application`.

**LOCKED MODEL (Clark + Lewis aligned, 2026-06-09) — two questions, in order:**

1. **Whose truth is it?** A *durable Trails-contract fact* (a concept — trail, surface, error taxonomy, topo, scaffold output, warden rule-set — should own it) vs. a *transient repo fact* (this repo's state, history, build health, one-time migration; no concept to own it).
   - Transient → **tooling** (script, or a contributor package if shared/large). Stop here *even if it derives* (e.g. `vocab-cutover-rewrite` derives rename mappings but the truth is transient → stays tooling).
   - Durable → graduates into the concept. Go to Q2.
2. **Relationship + audience?**
   - *Derives* the fact → **concept core.** Audience sets the tier: Trails users → public surface/rule; building Trails → **repo-local** rule/internal command (cf. `warden-export-symmetry`, `warden-rules-use-ast`).
   - *Consumes* the fact to fill a **declared** seam → it's a **binding** (the role: connecting a Trails surface/contract to a concrete runtime, tool, or publisher). The ADR-0029 dependency-boundary test sets the *kind*: **native binding** = Trails-owned built-in path (subpath/same package, ambient runtime, no foreign boundary; `@ontrails/http/fetch`+`/bun`, a built-in release publisher); **adapter binding** = extracted package/integration crossing a third-party/foreign framework/tool/runtime (`@ontrails/hono`, invoking `@changesets/cli`); **reading authored input** (`.changeset/*.md` as intent) = **neither**. Both kinds share the **adapter seam** (paved scaffold + conformance), but a native binding is not called "an adapter" in prose. Three axes: kind (native/adapter), placement (subpath/extracted), why (Trails-owned/foreign-boundary). Guardrails: bindings fill declared seams only; don't promote an adjacent tool to an adapter binding just because it appears in the flow.

     (Vocabulary evolution → LOCKED, Clark+Lewis 2026-06-09. (1) Matt: a "bun-publish adapter" is wrong — Bun is the ambient runtime. (2) Subagent verified `@ontrails/http`: lexicon defines `adapter`="package or subpath" and conformance type is `...Adapter`, so a flat "NOT an adapter" is also wrong; intermediate ruling was materializer-primary. (3) Matt dislikes "materializer" as prose; Lewis proposed **binding** as the genus. Sanity-check confirmed `binding`/"adapter binding" ALREADY in the lexicon (store, L426/443/445) and "Bun-native" already in HTTP docs — so binding-primary STRENGTHENS an existing term, not a new mint (best evaluation-hierarchy outcome). Final: **binding** genus; **native binding** vs **adapter binding** kinds; "materializer" demoted to HTTP implementation/ADR quote only; reject "internal vs external" as primary. Follow-ups: TRL-862 calls `fetch`/`bun` "real adapters" (stale → native bindings); lexicon L426/443/445 treat adapter≈binding (tighten to binding-as-genus). Likely a lexicon entry / ADR note.)
   - *Consumes* to render concept output → thin **caller** (shrink).

The single derive-vs-consume test was insufficient (Matt's correction): derivation over *transient* truth is still tooling. Purpose ("building Trails") sets the public-vs-repo-local *tier*, not whether something graduates.

**Why (the bite):** contract-first. The framework must own derivation of its *durable* facts so no ungoverned shadow contract forms. Transient repo facts have no contract to shadow, so tooling is the honest home.

**Canonical binding definition (Lewis, final 2026-06-09):** "A binding is a concrete realization of an authored Trails declaration or contract against a backend, runtime, tool, surface, or publisher. Bindings should be qualified by role when possible. A native binding is Trails-owned and built in. An adapter binding is extracted and crosses a foreign framework/tool/runtime boundary. The adapter seam is the shared extension/conformance path, not the public noun for every binding."

**Prose guardrail:** `binding` is the lexicon genus, but in prose prefer **qualified** forms — `surface binding`, `native binding`, `adapter binding`, `store binding`, eventually `release binding` — so the bare word does not collide with local-variable/import "binding" noise (Warden/source-analysis land). `@ontrails/http/fetch`+`/bun` = native HTTP/surface bindings; `@ontrails/hono` = adapter binding; reading `.changeset/*.md` = not a binding (consuming authored release intent); invoking `@changesets/cli` = adapter-binding territory.

**Follow-up / operational rulings (Lewis):**

- **Fold the lexicon edits into TRL-933** as explicit acceptance criteria — NOT a separate issue. The vocabulary is part of making TRL-933 executable so agents don't re-open the naming question. (Add `binding` genus + qualified forms + canonical definition to lexicon; reconcile store L426/443/445 from adapter≈binding to binding-as-genus.)
- **Patch TRL-862** (Done) — "real adapters (`fetch`, `bun`)" → "native bindings"; Done issues act as fossilized prompts for agents.
- **TRL-939 stays narrow** — consume-only dogfood scripts (packed-artifacts, wayfinder); must not absorb this doctrine.
- **Move TRL-933 into current sprint/project visibility** — it is now upstream of the release-rules work being clean; do not leave it parked in the "future emitters" milestone.
- TRL-942 = scaffold versions (durable/derive/users → public). TRL-943 = public-API example coverage → repo-local Warden rule. TRL-938 = release publisher/emitter seam; native Bun binding default, adapter bindings for foreign boundaries; npm mechanics never core.
- (2026-06-09: Linear API had a transient 502 outage mid-session; TRL Linear edits for the binding rewrite were queued and applied on recovery.)
- **Drift/shift vocabulary pair + the warden's guard** — `shift` = discrete substrate movement during one observation (voids that run's verdict, passes included); strictly disjoint from `drift` (gradual contract-vs-reality divergence between runs). The *bracket* is the primitive, named `trails warden guard` (wrapper `warden guard -- <cmd>`, guards exactly one command — shell `&&` chains escape the bracket; pair `guard start`+`guard verify` for multi-command hooks); warden generalizes to "the authority on whether a verdict can be trusted" (drift = contract trust, shift = run trust). Wrapper mode owns the child process and can inject guard context (`TRAILS_WARDEN_GUARD=1`); pair mode brackets sibling hook commands but does not mutate their environments after `start` exits, so pair-mode command awareness requires explicit hook-manager env export or shared bracket state. Never use a per-command flag — a flag on warden cannot protect the `bun test` after it. `WorkspaceShiftError` / `shift` category (retryable, 503, exit 10) must be reserved before 1.0 stable cutover — closed-union `ErrorCategory`. Guard as module-export grammar remains a non-decision; family is CLI/concept-level, not a packaging mandate. Draft ADR `verdicts-run-on-stable-ground` (PR 734); prototype `tree-guard.ts` (PR 733) graduates and gets deleted when the built-in lands. Origin: 2026-06-12 shared-checkout incident.

### 2026-06-12 `gate` rejected for the verdict-bracket primitive

**Question:** Is `gate` the right term for the verdict-bracket primitive (`trails gate run/start/verify`), considering future claims on the word (permits, feature gating, release/deploy gates) and whether it stands up for the substrate-stability job?

**Decision:** No. Do not name the primitive `gate`. Reject on three independent grounds, any one disqualifying. The replacement name is left open — it belongs in pathfinding, not a single decision — but the new name must lead from the bracket/verdict (interval-with-outcome) structure, survive the ADR-0001 brand-vs-plain heuristic (likely needs to be *branded* like `blaze`/`compose`/`warden`, not a plain verb), and not shadow `run`/`validate`/`warden`.

**Basis:** Hierarchy levels 3 + 4 (ADR-0001 naming conventions / ADR-0023 lexicon simplification + active lexicon).

1. **`gate` is a retired term, not a free one (decisive).** ADR-0001 records `gate` in the original Cutover 1 Trails-native term set, then **renamed `gate` → `layer` in Cutover 2 (ADR-0023)**. Reusing a deliberately-abandoned word for a *different* concept is the worst move in a versioned vocabulary: the ADR record (the human-readable contract) would carry `gate`=old-name-for-layer in one place and `gate`=verdict-bracket in another — the exact "split the mental model in two" translation tax ADR-0001 exists to kill. Retired words get a Reserved-Terms tombstone (cf. `trailhead`, `connector`), not a second life.
2. **Active collision with governance "gating."** `gate`/`gating` is in live use as the verb for Warden: lexicon says Warden is where "CI gating lives"; `architecture.md` calls `@ontrails/warden` "Lint rules, drift detection, CI gating." A substrate-stability pass/fail primitive named `gate` would mean two different things both legitimately called gating — fragmentation, violating "additions strengthen primitives, not fragment them."
3. **Future-claims worry is real and confirms the reject.** At least three adjacent concepts have a stronger claim on the bare word: permits (auth gate — `executeTrail` enforces scope intrinsically before the blaze, per horizons.md), release (already-active `trails release check`/`smoke`; release gating is the canonical industry meaning), and feature flags (the other dominant industry meaning). `gate` would claim the most-contested generic word for one narrow meaning and block its three better claimants forever.

Merit aside: a *gate* is a point (binary allow/deny on a path); the job is a *bracket* (an opened-and-closed span with a recorded verdict). The word undersells the bracketing that is the actual primitive.

**Confidence:** High on the reject. The retired-term fact (ground 1) is independently verified against ADR-0001 Cutover 1/2 and ADR-0023 this session. The replacement name is explicitly out of scope.

**Alternatives considered:**

- Keep `gate` — rejected on all three grounds above; the retired-term collision alone is disqualifying.
- Decide the replacement name now — declined; candidate set + brand-vs-plain call belong in a `clark-pathfinding` session, not a single ruling.

**Follow-up:** If the primitive proceeds, open pathfinding to land the name against the three-neighbor test (must not read as Warden gating, permit/auth gate, release gate, or feature flag) and the bracket/verdict framing. Add a `gate` tombstone to the lexicon Reserved Terms table ("retired Cutover 2 → layer; do not reuse") if the word keeps resurfacing.

**Resolution (same session):** Matt chose the warden family with a literal subcommand: **`trails warden guard`** (`warden guard -- <cmd>`, `warden guard start`, `warden guard verify`). Warden generalizes to "the authority on whether a verdict can be trusted" — drift rules catch contract-trust failures between runs; the guard catches run-trust failures (shifts) during one. Passes the three-neighbor test trivially. CLI/concept family only — no packaging mandate to move the bracket into `@ontrails/warden`. ADR retitled "Verdicts Run on Stable Ground."

### 2026-06-24 `packageRegistry`, not bare `registry`, for the package-registry resource

**Question:** When modeling the npm-protocol package registry as a `resource()` (release reconciliation work), what is the capability's name?

**Decision:** `packageRegistry` (camelCase resource id; `package-registry` in kebab/doc prose). Never bare `registry` as the capability name. Sibling capability stays `release-publication`. GitHub is **not** a resource; its capabilities split into package-registry targets (npmjs and GitHub Packages = instances of one `packageRegistry` resource), a `release-publication` target (GitHub Releases), and the control plane (workflow dispatch / PR-label / check reads) — never one "GitHub adapter" junk drawer.

**Basis:** Hierarchy level 4 (active lexicon) + ADR-0009 (First-Class Resources) + ADR-0029 (adapter packaging). The lexicon already reserves against bare `registry` ("`topo`, not registry or collection"); a `registry` resource would re-muddy that boundary. `packageRegistry` is an unambiguous industry compound that cannot read as a topo, and stays vendor-neutral where `npmRegistry` would re-vendor the abstraction. Asymmetry with `release-publication` is principled: a registry is a *place*, a release is a *record*.

**Confidence:** High on the reject of bare `registry`. Credit Lewis for the catch.

**Related:** decision below on deferring `reconcile` doctrine. Notes: `.agents/notes/2026-06-24-publication-targets-as-resources.md`, `.agents/notes/2026-06-24-release-registry-reconciliation.md`.

### 2026-06-24 Use `reconcile` now; defer cross-substrate doctrine until a second tenant ships

**Question:** Ratify `reconcile` as a broad cross-substrate convergence verb in the lexicon now (store tables + registry + releases = "one verb, three tenants")?

**Decision:** Not yet. `reconcile` is already a recognized operational shape, so *use* it in the release subsystem immediately (no lexicon expansion needed). Defer the doctrine note ("reconcile is *the* cross-substrate convergence operation") until store + release reconcile have both shipped. Use now; ratify doctrine once the second tenant exists.

**Basis:** Gate-on-demonstrated-need applied to vocabulary; tenets "add with intent" + the evaluation hierarchy (codify after the pattern recurs in shipped code). Lewis's discipline.

**Confidence:** High. Low cost to defer; reversible.

### 2026-06-27 Regrade verdict vocabulary: `modified` / `skipped` / `deferred`

**Question:** What are the regrade verdict words, and do the form (triage) and occurrence (resolution) levels share them?

**Decision:** One verdict triple at **both** levels — verbs `modify` / `skip` / `defer`, stored states **`modified` / `skipped` / `deferred`**. The rollup over everything still `deferred` is **`open`** (retires the generic `review`). `preserve` survives only as an authored plan rule (a `preserve` match makes a use come out `skipped`); `capture` / `ignore` / `uncertain` / `review` retired as verdict words.

**Basis (principles):** (1) name the level by the *record* (form vs occurrence), not the word, so the triple can be shared; (2) full-symmetric or full-distinct, never messy-partial (the old `preserve`-at-both-but-not-the-rest was the bug); (3) verdicts name the thing's resolved *state* (participles), which makes the set uniform and dissolves `pending`'s odd-one-out problem; (4) agent-native — the defer goes to a *judge* (agent first), so "needs judgment," not "needs human"; (5) a defer is an active decision (route to the judge), so `deferred`, not `pending`. Word calls: `modify` over `rename` (too narrow) and `update` (CRUD collision); `skip` over `keep` (fate-framing); `open` over `review` (agent-neutral, parallels the gate).

**Confidence:** High. Full rationale: `.agents/notes/2026-06-27-regrade-verdict-vocabulary.md`; reflected in `.agents/notes/2026-06-26-regrade.md`. PR #831 was amended before merge so the new vocabulary regrade `run` contract uses this verdict set and a per-form triage map; the generic class-mode report keeps its existing `rewrite` / `needs-review` outcomes for compatibility.

### 2026-06-28 Glob + path-scope are first-class core contracts; `scope` not `jurisdiction`

**Question:** Drift audit found the path-glob matcher duplicated across Regrade (`collect.ts`) and Warden (`path-scope.ts`) — identical function names, both landed the same week (#832/#835), already diverged on path normalization — plus `scope` (Regrade) vs `jurisdiction` (Warden) for the same concept, and a separate id-glob sprawl (Wayfinder, surface filter). How do we consolidate?

**Decision:** Make **glob** and **path-scope** first-class, single-owner contracts in `@ontrails/core` — one separator-parameterized glob engine, a `PathScope` grammar `{ include, exclude, extensions }`, and a `trailsIdGlob` (`.`-separated) flavor. Path-globs and id-globs share the engine but stay distinct types. Warden's `jurisdiction` → **`scope`** (it's literally path-scope; the noun was unintentional drift, confirmed by Matt). The current `ignore` denylist fields fold into `exclude` (single denylist; plan/config/CLI are merge sources).

**Basis (tenets):** one-write-many-reads + schema-always-exists applied to a cross-cutting shape (a shared owned contract, **not** a new top-level primitive — evaluation hierarchy: strengthen, don't mint). Reduce ceremony — adopters get a reliable glob/scope shape. "First-class" = owned, schema-backed, reused; the framework had `derive`-the-same-thing-N-times drift the regrade design exists to prevent, applied to itself.

**Confidence:** High. Grammar is `include`/`exclude` (Matt's call — symmetric pair over the asymmetric `include`/`ignore`). Spec: `.agents/notes/2026-06-28-glob-and-path-scope-primitive.md`. Stack: TRL-1074 (parent) → TRL-1075 (core) → TRL-1076/1077/1078 (regrade/warden/wayfinder+surface) → TRL-1079 (adopter exports + docs).

### 2026-06-29 Package ownership doctrine: single owner, natural altitude, import/extend-don't-re-implement

**Question:** The coherence cleanup keeps applying "one canonical owner + extend" case-by-case. Should package ownership be an explicit, governed doctrine — and how do we decide where a given thing lives without building a god-core?

**Decision:** Yes — capture a package-ownership doctrine (ADR, TRL-1111) grounded in a proactive ownership map (TRL-1110). The model: (1) **one canonical owner per concept**; consumers import/extend, never re-implement ("one write, many reads" at package scope); (2) **domain decides the owner, the dependency graph constrains placement**; (3) **decompose a capability to its indivisible parts and place each at its *natural altitude*** — the lowest layer at which it's still coherent AND reusable (a capability is often a stack, e.g. glob: engine → grammar → tool-config; the shareable lower layers sink, the domain composes upward); (4) **speculation guard** — sink a kernel to a shared layer only when it's self-evidently generic OR has ≥2 demonstrated consumers: extract on the second demonstrated consumer; by the third duplicate, it is governance debt; (5) name the bias — **"origin capture"** (the birth package hoards a generic kernel); (6) **enforcement split** — the doctrine is preventive (design-time; you can't lint "should have extracted" at first write), with the C3 `duplicate-exported-symbol`/`shape-clone` + existing import-boundary rules as the backstop.

**Basis (tenets):** the evaluation hierarchy ("can this be a specialization of an existing primitive?") applied at package scope; "one write, many reads." The guard is gate-on-demonstrated-need (avoid speculatively centralizing).

**Confidence:** High on the principle (Matt co-developed + endorsed). ADR/map pending (TRL-1110 → TRL-1111). The whole Coherence Cleanup project is this doctrine applied tactically.

### 2026-06-30 Regrade vocabulary-transition model (from the facet to trailhead dogfood)

**Question:** Lewis's first v1 vocabulary dogfood (`facet` to `trailhead`, prose docs) ended with safe rewrites exhausted plus 38 *classified* review occurrences (gate intentionally open). Five doctrine questions from the RETRO: completion shape, preserve-rule home, code-context handling, `--input-json` precedence, phase-2 readiness.

**Decisions:**

1. **Completion = family/slice + classification, NOT a gate redefinition.** Vocabulary transitions migrate family-by-family. A *slice* is complete when its authorized family's safe rewrites are exhausted AND every remaining occurrence is *classified* (preserve, or a named out-of-family/future slice). The run gate ("green = nothing deferred") is unchanged; open *classified* inventory is the slice handoff; raw *unclassified* deferred still blocks. A classified-out occurrence is `skipped(reason)` / a forward-pointer, not raw `deferred`.
2. **Preserve rules split by provenance; derive the bulk.** Derived (live-API/stable-IDs from the topo; don't hand-list; contract-is-queryable), authored-durable (plan-level idioms the framework can't derive), per-run tactical (operator run input; transient). The hand-maintained list is the parallel-ledger smell: derive it.
3. **Code contexts are out-of-engine for prose regrades (a kind-boundary).** Vocabulary regrades operate on prose only; code/identifier contexts (markdown code, string literals, identifiers) route to inventory and are handled by the AST `symbol` regrade or preserve. The `markdown-code-context` deferral is the general rule.
4. **`--input-json` precedence is a surface/CLI doctrine bug, not Regrade.** Explicit (flag OR structured) beats default; flag-default applies only when neither set the value. Surfaces-are-peers (CLI/MCP parity). Regrade only *exposed* it.
5. **Phase 2 (code/API `facet` to `trailhead`) is gated, not by-hand.** Ready to plan, but must be Regrade-driven on substrate: the AST symbol-regrade class + governed-transition provenance (TRL-1116) + the derived live-API preserve inventory. Don't touch live API by hand (= the C2-stack mistake we corrected).

**Basis (tenets):** regressions-harden-the-trail (the dogfood to substrate loop is the v1 posture); derive-by-default + the-contract-is-queryable (preserve derivation); one-schema / surfaces-are-peers (input precedence); kind-by-coverage (code vs prose engines).

**Confidence:** High. RETRO: `.agents/goals/2026-06-30-regrade-vocab-tracer/RETRO.md`. Follow-ups teed up: CLI precedence, derived-preserve substrate, phase-2 gated slice — all relate to TRL-1116.

### 2026-07-01 Issue-writing fall-down: components captured, seams orphaned (from the TRL-1125 miss)

**Question:** The one-command governed-code invocation (TRL-1125) escaped V0 planning even though every component — engine (1120), registry (1121), classification (1122), derived-preserve (1118) — had an issue and V0 was declared done. It was found only by *running* the engine by hand. Matt: "tells me there's a fall down in how we write issues." Root cause + fix?

**Decision (diagnosis):** We decompose issues by **component (noun/capability)** and define "done" at the **component level** ("this piece compiles and its tests pass"). Nothing forces the parts to *compose* into a usable end-to-end flow, so the **seam** — the verb that wires the nouns into a one-command journey — gets no issue and no owner, and hides inside a per-consumer execution issue. A milestone then reads 100% done while the thing it's for can't be run. Sharpest form: **the substrate had no surface.** We'd never ship a public trail without its surface+docs, but we shipped a substrate without its invocation because internally "compiles + tests" counted as done — i.e. **internal substrate escaped our own distribution-ready-done bar.** Compounded by building **bottom-up/parts-first** with no top-down tracer to force the seams.

**Fix (how to write issues):** (1) A milestone isn't done until there's a **usable end-to-end proof** (a tracer / one-command demo), not just "each component works." (2) Write the **seam/integration issue explicitly, at its shared altitude** — never folded into a per-consumer execution issue. (3) Run a **thin top-down tracer first** to force seams before building parts thick. (4) Apply **distribution-ready-done to substrate** (invocation + docs are part of substrate done), not just public features.

**Other same-class gaps found:** v1-workflow docs/agent-guidance (no issue at all); the `reviewDeclarationTypes` public-API auto-rename-vs-review policy (confirm it's inside TRL-1123's "review gates" or capture it).

**Basis (tenets):** "ship the whole developer experience" / done-means-usable-teachable-releasable — applied to substrate, not just features; natural-altitude (seams live at shared altitude). **Confidence:** High. Fourth run-exposed gap in the loop (structured-preserve, md-code-shield, `--input-json`, now TRL-1125) — the pattern is that *running* finds seams that *reading/planning* cannot.

### 2026-07-02 Package taxonomy rulings (from the 2026-07-01 hot-take note)

**Question:** The package-taxonomy note proposed (a) teaching package families instead of consolidating, (b) "longer term" moving tracing dev-state into `@ontrails/observe/dev`/`observe/otel` subpaths, (c) treating logtape/pino as adapters, (d) a post-reset re-audit of `detour`/`fires`/`transpose`/`survey`.

**Decisions:**

1. **Families: teach, derive, don't consolidate.** Family is authored metadata per package (one write); docs render it (many reads). A hand-maintained docs table is a parallel ledger. → TRL-1127.
2. **Observe-subpath consolidation of tracing dev-state: REJECTED, not deferred.** It would reopen the ADR-0041 boundary closed in #870 the day after closing it, with no new evidence — and it inverts natural altitude (ADR-0051): observe is a low-altitude contracts/sinks package; tracing dev-state is high-altitude tooling (query/status *trails*, SQLite store, OTel bridge). Subpaths hide coupling from the docs page, not from the dependency graph. Re-open only with new evidence.
3. **The line that distinguishes ruling 2 from the logtape/pino fold (TRL-1126):** subpath-on-primitive is for **zero-dep structural bridges shaped entirely around the owner's contracts** (logtape/pino over observe's `LogSink`; precedent `tracing/otel`). It is NOT for dependency-heavy tooling that would raise the owner's altitude. Same word ("subpath"), opposite altitude direction — don't conflate.
4. **logtape/pino violate the adapter dependency test** (verified: zero foreign deps, structural typing, only peer = observe). Recommended fold into `@ontrails/observe/logtape|pino`; explicit alternative move-to-`adapters/` requires a recorded discoverability carve-out to the dependency test. Matt decides in TRL-1126.
5. **Post-reset re-audit is evidence-gated and the bar goes UP** now that governed renames are cheap (deferral is nearly free, so "while we're at it" batching loses its justification). Candidates never enter `lexicon-pending.md` before ratification. → TRL-1128.

**Basis (tenets):** one-write-many-reads (families as authored metadata); natural altitude / ADR-0051 (rulings 2–3); add-with-intent + evidence-over-aesthetics (ruling 5). **Confidence:** High on 1–3 and 5; ruling 4 is a recommendation pending Matt's call.

### 2026-07-02 Regrade scope & file-rename rulings (from the facet tracer #880 review)

**Question:** The facet tracer left three capability gaps: file renames done by hand outside the transition contract; registry path *excludes* that silently unscan everything they match; and docs updates that can fall through via quiet scope holes. Matt: filenames should be in the mix, with recursion to catch references; directories should be lockable off-limits — but some catches should be *flagged into the judgment workflow*, not vanish.

**Decisions:**

1. **File renames become governed transition facts** (TRL-1130): authored `fileRenames` in the typed registry; in-scope *references* to renamed files are **derived** from the declaration (nobody authors the reference list). Recursion is bounded by design: apply all renames first, then ONE reference pass against the final rename map — chains resolve without fixpoint iteration; genuinely recursive residue routes to review.
2. **Scope is three tiers, not one exclude bucket** (TRL-1131). Tier 1 hard-exclude (never scanned): mechanical noise only. Tier 2 policy-classified: historical surfaces (CHANGELOGs, .changeset/, ADR history) are *scanned*, auto-disposed (`historical-by-policy`, extending the TRL-1122 disposition set), **counted in the report**, never rewritten by default, overridable through normal judgment. Tier 3 in-scope — **docs are tier 3 by default** and can only leave via recorded registry policy, never a quiet glob omission. "Off limits" and "caught and flagged" are different tiers, not a contradiction.
3. **Docs-skipping made structural:** the family report carries a docs-coverage line (teaching surfaces touched vs census-expected); a miss is a gate failure, not a post-merge discovery.
4. **Process rule — packet-acceptance diff:** the TRL-1119 teaching doc escaped a *third* time because the goal packet never carried it; the packet is the executor's operative contract and issue→packet transcription is lossy. Every acceptance line is carried into the packet DoD or explicitly waived with a reason, checked before execution starts.

**Basis (tenets):** derive-what's-known (reference closure from rename declarations); the-contract-is-queryable + gate honesty (tier-2 visibility over silent exclusion); ship-the-whole-DX (docs-coverage as gate); regressions-harden-the-trail (three run-exposed substrate fixes landed in-stack in #880 — the loop is working). **Confidence:** High. Note: `.agents/notes/2026-07-02-trl-1119-review-and-regrade-scope-followup.md`.

### 2026-07-02 Regrade transition records — the change carries its own memory (ratified)

**Question:** Matt: we're stacking assumptions (well-authored acceptance criteria → pre-work done → diligent executor → criteria met) — probabilistic outcomes layered on probabilistic outcomes. Adopters won't have our discipline. How does Regrade carry the burden itself, and what artifact survives?

**Decision (Matt + Clark, basis for a future ADR — full note `.agents/notes/2026-07-02-regrade-transition-records.md`):**

1. **Principle: checkpoint probabilistic steps through deterministic artifacts.** Every meaningful run writes a **transition record** (resolved plan snapshot + occurrence ledger with dispositions + gate state + environment incl. topo lock graph hash). The record is the story of the change, as the lock is the story of the system.
2. **Committed, at `.trails/regrade/history/<from>-to-<target>-<lockhash7>.json`** (Matt's naming: kebab transition name + short lock hash; commit-SHA fallback until root trails.lock is universal). Name collision = same transition on same graph state = idempotency signal. Extends `.trails/`'s existing committed-beside-local pattern. → TRL-1132 (Urgent).
3. **The record is load-bearing:** apply consumes a confirmed plan record (Terraform contract; no blind apply; stale lock-hash → re-plan), and `--check` computes the gate as machine acceptance so adopters' vague issues stop mattering for the checkable half. → TRL-1133 (Urgent). Both **block blaze (TRL-1018)**.
4. **Stance reversal ratified:** enforcement can retire when a transition completes; **evidence never should.** History enables Warden reintroduction + unknown-permutation watch (stem-match not in form set/ledger = legible "missed permutation" finding). → TRL-1135.
5. **Seed → derived plan** for the naive path: `from`/`to` is a seed; morphology, filename candidates, census tiers, and topo-derived live-API preserves (ON by default) are derived into a proposed plan; derived candidates start review-routed. → TRL-1134. Posture: **aggressive discovery, conservative application, total visibility.**

**Basis (tenets):** regressions-harden-the-trail's move-left ladder applied to the workflow itself (we built the engine contract-first but left the workflow discipline-first — operator memory must move into the contract); derive-by-default; the-contract-is-queryable. **Confidence:** High. Open questions (record weight, dry-run commit policy, morphology derivation mode, lifecycle home) recorded in the note for the ADR.

### 2026-07-05 Overlay: the lock's one extension noun; alias/trailhead subsumed; layer kept

**Question (Matt's first-principles push, three rounds):** (1) Do cliAliases and trailheads need to exist as framework concepts, or does the new lock-extension mechanism subsume them? (2) What is the unifying noun — section, segment, or overlay? (3) Is `layer` still the right word alongside it?

**Decisions:**

1. **Subsume, fully.** Aliases and trailheads are duals (N→1 / 1→N) of one construct: named bindings from a surface's namespace onto trails. One shared schema: scalar value = transparent synonym, list value = grouped entry, **singleton list stays a group** (the typing rule that keeps it honest — cardinality is NOT the discriminator; value shape is). ADR-0050 protections re-key onto shapes (normalize-without-lying → scalar; identity-preservation → list). Both behaviors become available on all surfaces automatically. `alias`/`trailhead` survive as prose/teaching words only.
2. **The noun is `overlay`** (section → segment → overlay across three rounds, each fixing the last's flaw): section named the storage slot, not the concept; segment implies *partition-of-a-route* (parts the whole depends on) but the mechanism is *additive* — and **the lock is a map, not a route**. Overlay scores perfectly: never alters the base, tolerant reader IS the defining GIS-overlay property (the metaphor self-explains the hardest guarantee), themed/namespaced, provenance-cited. Grammar: `Overlay` type, `trailsOverlays` export (sole channel), lock field `overlays`, `wayfind overlay <ns>`, `surfaceOverlay` helper. Bonus: kills the "trail segments/trails segments" homophone.
3. **`layer` keeps its name.** Middleware-standard, tenets chose it deliberately, no better successor (wrapper flavorless; stage linear-not-wrapping; gate saturated). Contrast pair for the lexicon: **"layers wrap what runs; overlays enrich the map."** Layer↔overlay adjacency goes on TRL-1128's evidence-gated watch list — act on demonstrated confusion only.
4. **Anticipation recorded:** if layer declarations ever need lock visibility, they ride an overlay — never a fourth lift channel.

**Basis (tenets):** natural altitude applied to vocabulary (a concept belongs to the package that acts on it; core knows only the envelope); brand test (overlay self-explains via common map knowledge); evidence-over-adjacency for renames (Regrade makes them cheap, which RAISES the bar for speculative ones). **Sequencing:** rename folds into the unmerged #900–903 restack (free — nothing shipped); TRL-1197 becomes the subsumption ADR. **Confidence:** High; Matt ratified all three explicitly.
