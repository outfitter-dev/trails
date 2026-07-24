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

### 2026-07-06 Regrade progression history: plans hash, evidence consolidates, transitions never close

**Question (Matt, from the overlays milestone-6 finding):** the committed regrade history record was a no-op that misrepresented a hand-done migration; the record is written by unguarded overwrite (clobber). How should the transition-records machinery (TRL-1132) evolve so re-runs and sliced regrades keep coherent, honest evidence?

**Decision (ratified direction; Layer 1 to build now, Layer 3 shaped by blaze):**

1. **A regrade is a progression, not a one-shot.** Identity levels: **transition** (consolidation key — **the filename stays the key**, transition-name based; plus an internal stable `id` for disambiguation on collisions / complex transitions) → **plan** (stable **id** + **content-hash**: id is identity, hash is version + replay signal) → **run** (stamp `{planContentHash, lockHashAtRun}` appended to the transition ledger). (Filename-as-key ratified by Matt 2026-07-06 over a coordinator-id.)
2. **History consolidates per transition; slices don't matter at write time — the lock record and plan hash do.** One history file per transition, append-only. The lockhash moves from filename → per-run stamp. Idempotency signal (same planHash+lockHash = replay) moves inside the file; richer than the old filename-collision signal. Kills the clobber, bounds file count, makes progression legible.
3. **`adjust`** (verb ratified by Matt 2026-07-06 over reopen/retrace/continue — no `re-` stutter with `regrade`, names the intent): `regrade adjust <transition>` pulls a graduated history back to an active plan MINUS history, **preserving the transition id** so the re-run appends to the same spine. Active plan = authored intent; history = accumulated evidence. Edits → new hash → runs append. Lifecycle cyclic (active ↔ history); a transition is never truly closed (which is why `adjust` fits and `reopen` would contradict the doctrine). Concretizes "enforcement can retire; evidence never should." → TRL-1215.
4. **Phased/stacked execution is a FLAG on the primary tooling, NOT a coordinator subsystem** (re-scoped by Matt 2026-07-06 — no `leg`/`phase`/`slice`/coordinating-file vocabulary). A big regrade split across a PR stack is very likely already served by **existing scope controls** (`PathScope` include/exclude/extensions) + **consolidated history** (each scoped apply ties back via the transition id) + **`adjust`**. Add only the minimal missing flag/named-part on `plan`/`apply` if the existing scope controls don't cover a stacked run. Blaze is the tracer; don't design ahead. → TRL-1216.

**Resolved:** transition-identity key = **filename (transition-name based) + internal `id`** for disambiguation (not a coordinator-id). `--check` verification is per-run (each scoped/stamped run checked at its own lock), not single-lock per-transition. Multi-class filename monstrosity (`export-restructure-cli-aliases-export-restructure-...`) avoided by naming the transition, not concatenating class ids.

**Issues:** TRL-1214 (Layer 1, blocks blaze), TRL-1215 (`adjust`), TRL-1216 (phased-as-flag). All blockedBy/related wired; blaze (TRL-1018) open gates are TRL-1016 + TRL-1214.

**Basis (tenets):** author-what's-new/derive-what's-known (plan=authored intent, history=derived evidence — clean separation); evidence-never-retires; checkpoint probabilistic steps through deterministic artifacts (the plan hash makes each step's identity deterministic); don't design for speculative consumers (Layer 3 waits for blaze). **Overlays milestone-6 decision:** no reorder to tool-migrate packlist/stash (hand-migration accepted under cutover ordering; class fixture-proven); the misleading empty record was deleted, not shipped; tool-on-pre-existing-code proof is deferred to blaze where it's load-bearing. **Confidence:** High on Layers 1-2; Layer 3 direction ratified, shape deferred to blaze.

### 2026-07-06 blaze → implementation: field cuts over, the word survives as verb/idiom

**Question:** In the blaze→implementation migration (TRL-1018), does the word `blaze` survive, given the field renames?

**Decision:** The **field/noun → `implementation`** (hard cutover, no peer fields). The **word `blaze` SURVIVES as verb + idiom** — "blaze a trail", "Blaze the trail". Coherent split: you *blaze* the trail (the act) by writing the *implementation* (the noun); the word stops being the field name but stays the metaphor. **RETIRE the adjective "blazed trail"** → plain phrasing ("a runnable trail" / "a trail with an implementation"), since it has no clean single-word successor ("implemented trail" is awkward).

**Basis:** "blaze a trail" is real English central to the *Trails* brand; the release plan already protects idioms (`v1-vocabulary-reset.md:142`) and the registry routes `blazing`/`blazed`/`trailblaze` to review, not safe-rewrite. Rejected alternative: full idiom retirement — guts the brand metaphor for little gain. Default ratified; Matt may still opt for fuller retirement (inverts the preserve rules).

**Execution facts (from 6-scout readiness, TRL-1219):** the field rename is **atomic at the type level** (renaming `blaze:` on `TrailSpec` breaks all consumers at once) — blaze is NOT per-package sliceable; shape is **code-cutover (one atomic PR) → docs-cutover → review-inventory**. **6 rule-logic string-checks (`=== 'blaze'`) are acceptance-critical** — they match the field by string, a symbol rename misses them, and Warden silently stops recognizing the field. Machinery (registry, regrade test corpora, `trailblaze` runtime, the prior `blaze()`→`trailhead` mapping) must be preserved; substring rewrites forbidden. Plan: `.agents/plans/2026-07-06-blaze-to-implementation/`.

**Confidence:** High on the field cutover and the execution shape; the verb/idiom survival is the ratified default.

### 2026-07-07 Introspection consolidation: one door, merged truthful answers, survey/guide/topo retired

**Question (Matt, pre-V1 honing session, Topic 1):** agents have five reach-fors for "what trails exist" and four for drift; live-vs-lock freshness is exported as the caller's problem ("Wayfinder First… but fall back"). How should introspection consolidate?

**Decision (all ratified by Matt 2026-07-07):**

1. **One query front door; freshness is the tool's problem.** "It should just work, but be truthful about the provenance." No caller-side live-vs-lock decision; `--source live|lock` remains as an explicit filter.
2. **Merged default answer — "git status for the graph."** Lock facts first (correctness), live-side changes brought forward in the same answer with per-fact status stamps. **Teach the git analogy in docs; do NOT borrow git's words** (Matt flagged the two-axes collision: a trail can be lock-committed while trails.lock is git-uncommitted). Status vocabulary extends the existing drift family: **`aligned` / `drifted` / `new` / `removed`** (`aligned`/`drifted` already live in wayfinder provenance; git says "untracked"/"deleted", so zero word overlap).
3. **`wayfind` is the sole surviving door** (CLI rendering of the nameless internal query kernel; each surface renders the kernel in its own idiom). `survey`, `guide`, `topo` retire as top-level commands. Passes the brand doctrine test because it is now alone — reach-for determinism achieved by deletion, not naming.
4. **`guide` is deleted outright** — scout-verified vestigial: detail mode duplicates `survey.trail` byte-for-byte, no authored guidance channel exists, own header says "planned for post-v1", zero consumption. **Salvage:** derived invocation rendering (copy-pasteable CLI command, MCP tool-call JSON, HTTP request template from example payloads) joins the front door's per-trail view — pure derivation, no authored burden. Authored guidance channel stays post-v1, evidence-gated.

**Feasibility facts (two scout recons):** ~70% exists — `wayfind --source live|locked` already composes `survey` for live (`wayfind.ts:454-463`); per-fact provenance envelope built (`provenance.ts:98-105`, populated per-response today — wiring change); `deriveTopoGraphDiff` is already a pure in-memory TopoGraph differ (`diff.ts:1067`), zero changes; store post-#893 is a fingerprint-keyed memoized derivation that can serve as the live side when fresh. **Real work:** converge the two derive stacks (`topo-read-support.ts`/`topo-reports.ts` over live `Topo` vs wayfinder queries over `TopoGraph`) — candidate: TopoGraph becomes the single query representation, live mode = `deriveTopoGraph(app)` in memory. **Named correctness requirement, not a follow-up:** close the source-fingerprint soundness hole (walk stays under `rootDir`, misses out-of-root workspace package edits → false "fresh"); candidate fix: fingerprint the resolved import closure the mirror step already computes (`Bun.Transpiler#scanImports`, `load-app.ts:631-632`).

**Explicitly deferred (Matt):** release-gate/migration mechanics (wayfinder-dogfood smoke, MCP tool inventory churn — survey/topo/guide + 9 `wayfind.*` exposed today, `inspect` trailhead bundles the retiring family). Store-as-shadow-truth is NOT a motivation — already fixed by #893; dogfood evidence predated the fix.

**Basis (tenets):** "The contract is queryable" without caching-architecture knowledge; one-write-many-reads (two derive stacks producing the same facts is a standing violation at the framework's own expense); reduce ceremony, not clarity (the AGENTS.md fallback hedge was a confession); evidence-over-recall (guide deletion scout-verified, not asserted). **Session notes:** `.agents/notes/2026-07-07-pre-v1-honing-agenda.md`. **Confidence:** High — all four points explicitly ratified.

### 2026-07-07 Vocabulary restructure: two axes (tier census + journey narrative), three brands, borrowed Result

**Question (Matt, pre-V1 honing session, Topic 2):** the lexicon and tenets carry two conflicting "six" lists (only `trail`+`topo` overlap); measured concept toll ≈50–55 coined terms; Wayfinder (901 code uses) and Regrade (641) absent from the lexicon; ghost terms blessed but unused. How does vocabulary restructure for V1?

**Decision (ratified by Matt 2026-07-07):**

1. **Two axes, not one list.** The two sixes answered different questions in the same costume. **Tier axis** = governance census ("how many words, which earn brands"). **Journey axis** = presentation ("when does each word arrive in the reader's hands"). Both stay; the "six terms you must internalize" double-claim dies.
2. **Tier 1 — the authoring set: six coined words + one borrowed pattern.** `trail`, `topo`, `surface`, `resource`, `signal`, `compose`, plus **Result presented as borrowed** ("Trails uses the Result pattern, as in Rust") — familiarity is a trust signal, not concept toll. Empirically verified: scaffold + getting-started author all seven in hour one (scout: create-scaffold.ts authors `signal('entity.updated')`, `resource('entity.store')`; getting-started authors Result/compose). Tenets keeps its architectural six; the one-word delta (`surface`) gets the bridging sentence ("surface isn't a primitive — it's how primitives reach the world — but you'll type it in your first ten minutes").
3. **Tier 2 — three brands, spelled as typed: Warden, Wayfind, Regrade.** Brand = what you type (`trails warden|wayfind|regrade`); "Wayfinder" retired as prose brand (the -er is a brand one step removed from the thing you touch); package names stay as-is (`@ontrails/wayfinder` etc. — packages are Tier 3 captions). Lexicon ADMITS Wayfind + Regrade (previously absent). Met at governance/navigation/migration time — progressive disclosure.
4. **Tier 3 — plain words at point of use + glossary appendix.** The ~24-term middle (layer, overlay, marker, binding, intent, visibility, entity née contour, trailhead-as-pattern-word, …) stops being lexicon citizenry. **Topographer demoted to package-name caption** — scout-verified never user-met: zero commands, absent from all five committed example locks, never scaffolded/authored, one migration-hint string total.
5. **Topographer PACKAGE kept as-is** (census verdict): three genuine cross-package consumers (warden/wayfinder/apps-trails, ~55 import sites), cohesive derive+store kernel sharing internal projection helpers, and the boundary IS accepted ADR-0042 — dissolving would reverse a settled ADR for zero user-facing gain. Parked seam: `deriveTopoGraph` is in-memory (ADR-0042's literal test reads "core"); if Topic 1's query-kernel work forces a canonical home for graph→facts derivation, that's the seam that pulls.
6. **Reserved bank instead of deletions.** Extend the lexicon's existing Reserved register: `approach` (zero code uses) and prose-`trailhead` banked for possible future use (live trailhead API identifiers persist as call-site spellings). **Reserved ≠ retired:** `facet` stays dead — its meaning-slot was taken by a successor; only empty-slot words are bankable.
7. **Journey axis adopts the explainer deck's act structure as the docs narrative spine.** Found: `trailblazing/explainer/src/content/slides.tsx` (Act I: capability→trail→surfaces→examples→errors→crossings→signals→resources→permits→contours→versions→run→layers→graph; Act II: tools) + `trailblazing/inbox/2026-05-22-docs-narrative-spine-lewis.md` (maps acts onto docs/index.md + getting-started ordering). The acts ARE the tiers, sequenced — signals arrive mid-Act-I, validating "not the same ledge as trail/topo" narratively while staying Tier 1 architecturally. Deck is pre-cutover vocab (crossings/contours/run); rewrite rides the v1 reset docs-cutover.
8. **No new renames.** Reset stays scoped to blaze→implementation, contour→entity, projection→derive+render. `marker`/`forces` stay parked on the evidence bar.

**Net:** front-door concept toll drops from ~50 ambiguous to **10 named things** (6 coined + 1 borrowed + 3 brands), every slot earned on measured exposure. **Basis (tenets):** progressive disclosure applied to our own vocabulary; evidence-over-adjacency for renames; brand test (a themed word must be typed to be owned). **Session notes:** `.agents/notes/2026-07-07-pre-v1-honing-agenda.md`. **Confidence:** High — ratified in full ("Go for it").

### 2026-07-07 Export grammar, core diet, package doctrine, and the consolidation slate

**Question (Matt, pre-V1 honing session, Topic 3 + extensions):** the export grammar is enforced from operator memory only; core carries 263 value exports; and the package set had never been graded against a worthiness test. What gets codified, dieted, and consolidated pre-V1?

**Decisions (ratified by Matt 2026-07-07, iteratively):**

1. **Export grammar gets written + Warden-enforced.** Export Grammar section in contributing docs (canonical prefixes with purity contracts; four-condition escape hatch; scout-blessed additions `assert*/parse*/find*/list*/open*/ensure*/with*/should*/has*/*Of/*Schema/X-to-Y`; drift fixes `matchX`→`matchesX` + data-table casing rule) + repo-local Warden rule over first-party barrel exports. The ratified projection→**derive/render** split is the grammar's spine — and it RESOLVES the census's layering confusion: lock-baked facts (MCP tool names, CLI routes) are derive-side → core/substrate ownership is correct; surface presentation is render-side → surface packages.
2. **Core diet, ZERO new packages** (leaf extractions withdrawn after Matt pushback — cosmetic benefit, ADR-0014/0042-settled placements, real maintenance cost): dead shells deleted; internalization audit of ~45 over-exported helper symbols; root-barrel→subpath moves only where genuinely noisy (subpaths are labeled drawers); projection named as a module boundary inside core. Three census claims RETRACTED on evidence: observability "triplication" is ADR-0041 working as designed; `deriveToolName` is an alias, not a duplicate; `Library*` is the library surface's error projection (category-keyed, typecheck-enforced), correctly homed. Meta-lesson (3rd occurrence today): a surface census reads deliberate architecture as drift when it can't see the ADRs — drift concentrates only where no decision exists.
3. **Package doctrine (goes in contributing docs).** A package must convincingly pass ≥1: (a) **dependency shield** (isolates a third-party runtime dep); (b) **optional capability** (à-la-carte adoption); (c) **independent consumer set** (≥2 first-party consumers not arriving via one parent flow); (d) **doctrinal boundary** (accepted ADR). Plus: **new packages require a dependency justification, never a filing justification** (subpaths are the filing system); **runtime/toolchain is a third axis** (core is the runtime kernel; toolchain — compile/lock/diff/query/governance — never folds into it; this is why topography-into-core was DECLINED); **themed package names are earned by being typed** — everything else gets a plain descriptive caption. Each package README cites which test it passes, one line.
4. **Consolidation slate (18 live publishable → 16, plus 2 dead shells deleted):**
   - `packages/schema/` + `packages/logging/` dead shells: `rm -rf` (confirmed no package.json/src/importers).
   - **tracing → folds into the observability package** (`/dev`, `/otel` subpaths); compat re-export layer dies (zero external users to protect); ~4 mechanical import sites; ADR-0041 amendment required.
   - **observe → renamed `@ontrails/observability`** (only verb-named package in a noun catalog; industry word the reader arrives carrying; Matt proposed rename, Clark pick of observability over observation accepted as default).
   - **pino + logtape → upgraded to REAL adapters** (Matt: "need to be adapters"): they must import their namesake libraries and deliver genuine integration (level mapping, config construction) — audit found neither imports its lib today (structural interfaces, zero deps, zero consumers — they FAIL the dependency shield they were justified by). Real deps make them legitimate standalone adapter packages per the dependency test.
   - **wayfinder → folds into the substrate package**, EXCEPT `outline.ts` (874 LOC) which rises to apps/trails or a warden subpath — it imports `@ontrails/warden/ast` (oxc) and would create a topographer→warden→topographer declared cycle; it is also AGENTS.md's own "source-navigation exception," so the fold splits at exactly the Topic-1 live/saved line. Rest is clean: 9 files/4,654 LOC, zero collisions, no deep imports, 5 mechanical sites in apps/trails. Wayfind BRAND unaffected (brand ≠ package).
   - **topographer → renamed `@ontrails/topography`** (Matt). The `-er` was a persona on substrate — the last brand-shaped name not earned by typing. `topography` is the field, not the character; etymologically native (`topo` = topographic map; the type is literally `TopoGraph`); passes the future-collision test that killed `graph` (Matt: reserved against an eventual GraphQL surface package) and avoids `topo`'s constructor-promise confusion. Post-fold it owns the full arc: **derive → persist → diff → query**.
   - **Held on discipline:** adapter-kit (ADR-0051 names it an owner), config (ownership-map tracked unknown). **Watch-list stands:** library (draft ADR needs promotion or its case weakens), regrade (earns its keep on the diet transitions). Clear stands as doctrine exemplars: store (optional capability), warden (the only true dependency shield: oxc-*), permits (ADR-0012), observability (ADR-0041), cli/mcp/http (peer symmetry), topography (ADR-0042 + 3 consumers).
5. **Topography-into-core DECLINED (Matt's bold question, answered with the runtime/toolchain line):** deployed apps need core at request time; lock IO/store/diff/fingerprint run at compile/CI/governance time. Folding toolchain into runtime recreates the kitchen-sink core the diet just fixed and reverses ADR-0042 hours after citing it. Salvage of the instinct: the four-role story — **author with core, resolve to the topography, render with surfaces, govern with warden** — goes in README/architecture; substrate is first-class in the story, invisible in the toll. Parked with trigger: `deriveTopoGraph` (pure, in-memory) may sink to core IF the Topic-1 kernel work untangles it from store-shared helpers.

**Execution notes:** every move is a Regrade transition (the migration tool proves itself on the framework's own breaking changes pre-V1); beta lockstep + zero external users make renames/folds free now and majors later; staged ~6-8 PRs. **Basis (tenets):** regressions harden the trail (grammar moves from operator memory to lint-time); add with intent (package boundaries exist for dependency reasons); the drift guard applied to our own packaging. **Session notes:** `.agents/notes/2026-07-07-pre-v1-honing-agenda.md`. **Confidence:** High — every point explicitly ratified or Clark-default accepted in discussion.

### 2026-07-07 Scaffold symmetry: the `add` family completes over Tier 1 or doesn't exist

**Question (Matt, pre-V1 honing session, Topic 4):** `add trail`/`add surface`/`add verify` exist; `add resource`/`add signal` don't — the tooling teaches agents to expect scaffolding then withholds it for half the primitives (agents invent nonexistent commands).

**Decision (ratified by Matt 2026-07-07):** the `add` family must be **complete over the Tier 1 authoring set, or not exist**. Build: **`add resource`**, **`add signal`** (every standalone-authorable noun primitive gets a scaffold; compose/Result are in-trail edits, topo belongs to `create`), plus **`add example <trail-id>`** (seeds an example on an existing trail — examples are the most-multiplied artifact and today accrete by hand-copying; scaffolds are the ACTIVE authoring-reinforcement channel, which passive docs guidance loses to). Completion rule goes in the contributing docs. **Out of scope (explicit):** `warden fix` (post-v1, evidence-gated), layer/detour scaffolds, interactive wizards. **Confidence:** High — "the `add` additions are great."

### 2026-07-07 Two V1 gates ratified: Result provenance in Warden, error rendering honesty

**Question (Matt, pre-V1 honing session, Topic 5):** promote two engineering items from backlog to V1 blockers?

**Decision (Matt, 2026-07-07: "Ratified. Gate v1 on both."):**

1. **V1 GATE — Result provenance in Warden (TRL-785 family).** `implementation-returns-result` recognizes only literal `Result.ok/err`; idiomatic code (returning a helper's Result, composing passthroughs) is flagged, and the sanctioned re-wrap `Result.err(result.error)` DESTROYS the specific error type — the rule degrades the taxonomy it protects. Most-recurring drag in the dogfood corpus (Radio hit the "3 drags = next priority" trigger on it; Stash + RC runs independently). It is the first wall a fresh agent hits: correct first-hour code called wrong by governance. Fix direction: type-aware Result recognition or a blessed passthrough idiom the rule understands. V1 does not ship while it stands.
2. **V1 GATE — error rendering honesty.** The taxonomy produces structured, categorized, contextual errors; last-mile renders swallow them ("Topo validation failed with 3 issue(s)" showing zero issues even in JSON; `trails doctor` exiting "Internal server error" — HTTP vocabulary in a CLI; compile failures hiding the real cause sitting in `error.context`). Render-side rule: **no error leaves a surface without its category, message, and context rendered**, plus a sweep of known offenders. The class is the blocker, not the instances (#919 fixed one instance). For a contract-first framework, opaque errors are a thesis contradiction, not a bug class.

**Confidence:** High — explicit ratification. This completes the five-topic pre-V1 honing session (introspection consolidation; vocabulary restructure; grammar/diet/package doctrine; scaffold symmetry; V1 gates). All topics logged above; session note: `.agents/notes/2026-07-07-pre-v1-honing-agenda.md`.

### 2026-07-09 Lock-in: @ontrails/ast extraction, capture-scan verdict, final placements, Linear build

**Question (Matt, honing-session lock-in):** final calls before converting the honing plan to Linear — pino/logtape form, outline.ts home, whether AST tooling's warden residence generalizes, and structure shape.

**Decisions (all ratified by Matt 2026-07-08/09):**

1. **Pino/logtape → REAL adapters, final** (supersedes the Lewis-review spike-default): import the actual libraries, deliver genuine integration, AND serve as canonical reference examples for future logging adapters. Exemplar value + honest dependency-shield pass.
2. **`@ontrails/ast` extraction.** warden/ast confirmed as origin capture: 4 consumers across 3 non-governance jobs (regrade ast-rewrite/export-restructure, wayfinder outline, apps/trails draft-promote + version-lifecycle-support, warden rules). New leaf carries oxc-parser/oxc-walker + the ~90-helper toolkit; **warden keeps resolve.ts/oxc-resolver (zero external consumers, verified)**. Passes dependency-shield + independent-consumer-set — the exact case the new-package rule blesses. Identity map: **ast parses, warden judges, regrade rewrites, wayfind navigates.** Mechanically dissolves the wayfinder-fold cycle blocker.
3. **Capture-scan verdict (full repo): warden/ast was the ONLY captured kernel.** Cleared: warden/resolve, core/trails (primitive consumption), wayfinder→topographer root (reader-of-public-product), regrade→warden root (clean post-extraction), all adapter/testing subpaths. **Watch: `topographer/backend-support`** — identical shape (subpath barrel over `./internal/*`), legitimate today (one app consumer, job matches host); second non-storage consumer tips it. Systemic cause: no neutral kernel home + frictionless subpath reach-in. **The smell becomes a Warden advisory rule** (TRL-1231): package re-exports `./internal/*` via subpath + sibling package imports it for a different job.
4. **outline.ts → apps/trails-local, final.** Reusable primitives go to @ontrails/ast; the remainder is composite view assembly (source⇄graph reconciliation), which lives at the rendering layer; the operator app distributes it to all users anyway. Cycle blocker gone, so this is identity-ruled, not dependency-forced.
5. **Structure: milestones under project "V1 Release Candidate Closure," not new projects** (Matt). Built 2026-07-09: 5 milestones (Wayfind Front Door / Grammar & Export Doctrine / Package Consolidation / Authoring Scaffolds / V1 Gates), 19 issues **TRL-1223..TRL-1246**, 20 blockedBy/related edges per the Lewis-adopted order; TRL-1223 (fingerprint soundness, blocking root) and TRL-1235 (ast extraction) explicitly blockedBy TRL-1018. Gate issues TRL-1245/1246 at Urgent. T2 rides v1 Vocabulary Reset; ADR amendments ride v1 ADR Canon Reset. Doc updated with lock-in addendum: <https://linear.app/outfitter/document/pre-v1-honing-session-decisions-and-execution-plan-2026-07-07-69c67df77458>

**Note:** TRL-785/786/787 verified Done — the V1 Result-provenance gate (TRL-1245) targets the residual post-785 gaps (ternary literal branches 2026-06-12; helper provenance residue 2026-07-04). **Confidence:** High throughout.

### 2026-07-11 Regrade's next class families ratified as post-V1 direction: contract-shape transitions + package-carried distribution

**Question (Matt, post-merge musing after the #930–#945 consolidation):** could Regrade serve as the codemod substrate for (a) trail versioning migrations and (b) the recurring "full internal cutover, no compat, painful manual edits" pattern?

**Decision (direction ratified, explicitly post-V1; captured, not scoped):**

1. **Contract-shape transition classes, DERIVED from trail version entries** (TRL-1258). The version entry already authors the from→to intent (revision/fork, both schemas, `transpose`, deprecation guidance) — per the drift guard, the migration derives from it rather than being hand-authored. **The moat is graph-aware rewriting:** the lock enumerates consumption sites (`ctx.compose` calls, CLI flags, MCP payloads) — no other codemod tool ships with a resolved map of its consumers. Honesty constraints stated up front: transpose functions are arbitrary runtime code, so the derivable subset is renames/moves/additive-with-default; shape changes at call sites are data-flow, so computed keys/spreads route to review under the all-or-review invariant. Candidate Warden hook: "breaking version entry lacks a derived governed transition." **Tracer condition: first shape transition runs when one of our own trails takes its first breaking revision post-V1.**
2. **Package-carried transitions** (TRL-1259): governed transitions ship WITH published packages; consumer apps upgrade via `trails regrade apply` pulling vendor-shipped plans. Design questions parked in the issue: carrier (tarball path vs lock overlay — overlay attractive as the lock's one extension mechanism), plan-hash provenance before consumer-side apply, spine locality (consumer's own history records the runs — why TRL-1257's zero-actionable persistence is a prerequisite), version-window chaining per ADR-0047. Valuable with today's classes alone (wayfinder→topography is exactly what an external consumer needs).
3. **Internal hard cutovers need no new decision** — "every move is a Regrade transition" is the ratified execution frame; TRL-1233's grammar drift renames are the standing proving ground for symbol/code classes.

**Basis (tenets):** this is Regrade returning to its stated charter ("downstream migration checks and safe rewrites" — vocabulary was the tracer, not the mission); evaluation hierarchy = strengthen the existing tool with new classes on the proven class-agnostic substrate, not a new tool; one-write-many-reads (version entry feeds runtime compat AND migration codemod AND guidance); add with intent (evidence-gated tracers, no pre-V1 scope creep). Evidence-completeness prerequisites: TRL-1256/TRL-1257. **Confidence:** High on direction; shape deliberately deferred to the tracers.

### 2026-07-14 Queryable change: agents review classified exceptions, not diffs (post-V1 direction)

**Question (Matt):** sweeping governed changes produce diffs no agent can hold (blaze cutover PR: 453 files / +33k lines) — can git primitives + a consumable/queryable form cut the context load, given the framework's agent-native mandate?

**Decision (direction ratified, post-V1; captured as TRL-1261):**

1. **Inversion:** for governed changes the diff is the DERIVED artifact; plan + per-occurrence ledger are the intent. Don't teach agents to read diffs — teach the ledger to answer diff-shaped questions. Tenet extension: *the contract is queryable — and the change is queryable.*
2. **Three-layer read, context cost O(exceptions):** graph layer (`wayfind diff` — what changed in the system) → ledger layer (why each occurrence changed) → **residue layer**: git hunks ⨝ ledger occurrences ⨝ preserve rules → `explained-by-plan | explained-by-preserve | unexplained`; agents read only the unexplained set. (Mechanizes exactly what Clark's #930–#945 review lanes did by hand.)
3. **Trails-native edge = graph attribution:** changed spans map to graph entities via @ontrails/source + outline + the lock ("this hunk touches entity.create's implementation, whose contract didn't change"). Diff projected onto the topology — impossible without the lock.
4. **Consumers in priority order (Matt):** working agent gut-checking its own mid-change state (⇒ must work over the WORKING TREE, fast/incremental) → follow-up review agents → CI gating explicitly de-prioritized.
5. **Boundaries:** zero storage (pure projection over git + history spines + lock; cache at most); value-add is classification + attribution + exception-ordering or it's a slower git diff; ungoverned changes get graph layer + attribution only (correct, not a gap). Front-door naming deferred to implementation against the one-door doctrine.

**Prerequisite:** TRL-1256 (per-occurrence preserve outcomes) — an unexplained hunk is only meaningful if every explained occurrence is in the record; 1256 gained its second consumer before its first implementation. Siblings: TRL-1257/1258/1259. **Basis (tenets):** one-write-many-reads (the ledger feeds apply, audit, AND review); performance is DX applied to context windows — agent attention is the scarcest runtime we ship against. **Confidence:** High on direction; shape deferred.

### 2026-07-16 Regrade committed history becomes a compact run receipt; Git owns line-level evidence (ratified)

**Question:** The TRL-1019 reopen dogfood (#976) appended 81,907 generated lines for a two-file correction — 99.85% of the PR. Verified: `report`/`completionReport` differ by 77 bytes compact (~1.36 MB each); the zero-actionable proof re-serialized 1,311 unchanged occurrence records; committed runs carry machine-absolute roots. Matt: the plan is the most important history content; Git values should reconstruct what changed where/when; diffstat is meaningless for rename-symmetric work; keep one consolidated history file per transition.

**Decisions (→ TRL-1269, High; ADR-0053 amendment required):**

1. **Receipt shape:** each appended run commits the authored plan (sans derived inventory) + content hash, Git-resolvable evidence keys (per-file before/after blob hashes, source/lock/policy/tool identity), judgment facts (classified form set + verdict/disposition counts + changed-file list), and ONE completion-facts block. Rendered views regenerate from the receipt.
2. **Clark's sharpening of "Git reconstructs everything," accepted:** Git reconstructs what *changed*; it cannot reconstruct what was *judged* — preserves and review dispositions have no diff footprint. Judgment facts stay committed. The classified **form set** stays committed because Warden's permutation-watch matches stems against it; the per-**occurrence** records do not — they are derived observations, reproducible from (source revision, plan hash, policy hash, tool version).
3. **Amends the 2026-07-02 transition-records ruling:** "evidence never retires" stands as principle; its storage shape changes. The occurrence ledger moves from committed-primary to derived-reproducible. Append-only truth does not require append-only duplication.
4. **Metrics are regrade-native** (occurrences rewritten, files changed, forms mapped) — no lines-added/removed. **Roots normalize** to project identity. **Canonical format on write.** **Zero-actionable proofs** append a minimal receipt referencing prior classified state by hash.
5. **Unchanged:** one consolidated file per transition, append-only runs (byte-immutability of prior runs verified in #976 via canonical-JSON hash), stable transition IDs, completion gate, conservative apply.
6. **Hard constraint:** the committed receipt must satisfy Warden's governed-history loader and residue/permutation rules with no cache tier present; consumer audit is the first task on TRL-1269.
7. **Postures:** #976 lands (correction + hardening are valid; merge ≠ approval of the evidence shape). Discretionary reopen cycles hold until TRL-1269 has a disposition. Duplicate report/completionReport is a defect, not a design question. TRL-1267 gates "vocabulary complete" claims; TRL-1268 + TRL-1269 gate Regrade-as-required-path.

**Basis (tenets):** information architecture — derived and rendered state is reproducible, never primary committed truth; ADR-0053's own boundary test ("rendered outputs regenerate from their owner unless the diff is itself a governance surface") — the governance surface justifies committed *facts*, not duplicated rendered inventories; regressions-harden-the-trail — this family already forced history pruning once at 48 MB, and a second occurrence means the schema, not operator discipline, carries the fix. **Confidence:** High on the receipt direction and defect rulings (Matt ratified); Medium on the exact evidence-key set until the Warden consumer audit lands. Retro: `~/.claude/uploads/.../20260716regradereopenprojectionretro.md`; issue: TRL-1269.

### 2026-07-16 Receipt design questions ratified (addendum to the run-receipt ruling)

**Question:** The five open items from the TRL-1269 receipt design, put to Matt one at a time.

**Decisions (all ratified by Matt; doc updated to ratified status):**

1. **Form set: embed on change, hash-reference when unchanged.** Matt's principle — machinery may compress if it reconstructs quickly and unobtrusively — overrode Clark's embed-everywhere lean. Resolution is the loader's job; Warden and rendered views always present the resolved set. The legibility requirement lives on the resolved view, not the bytes.
2. **One file per transition, forever; tool-selected.** Matt's file-clarity concern ratified current reality and **supersedes the `<from>-to-<target>-<lockhash7>.json` naming from the 2026-07-02 entry** — that scheme would have spawned a file per graph state, the exact proliferation he vetoed. `regrade adjust` selects history by transition ID; the operator never picks a file.
3. **Cache tier: regeneration-only for v1** (YAGNI). If TRL-1268's incremental work produces a cache, retrieval may ride it without the receipt contract changing.
4. **Canonical serialization: Regrade-owned deterministic emitter + formatter exclusion** for the generated history path, exclusion shipped via scaffolding. The generator owns its artifact's format; repo formatters own human-authored code.
5. **Path invariant: whole file including embedded plans, loader-enforced.** Warden's governed-history loader rejects absolute-path violations — drift-guard lint-time tier. Root-relative PathScope globs unaffected.
6. **Existing eight histories: one-time governed conversion ratified** (was Clark's lean, now settled). Conditions: lossless derivation (receipt facts ⊂ old snapshots — verified) and pre-conversion file hash recorded in conversion provenance, old bytes reconstructable from Git. Grandfathering rejected: it would leave the path invariant permanently unenforceable on committed reality.

**Basis (tenets):** reduce-ceremony (tool-mediated file selection; scaffolded exclusion); drift guard lint-tier (loader-enforced invariant); YAGNI (no cache tier); one-write-many-reads (emitter as single format owner). **Confidence:** High — every item individually ratified. Implementation sequence on TRL-1269: Warden consumer audit → ADR-0053 amendment → schema + emitter → governed conversion.

### 2026-07-17 Required-path hardening retro accepted; worktree scope edge ruled; two stale audit issues dispositioned

**Context:** #978–#984 merged 2026-07-17, implementing the receipt ruling. Verified on main: eight histories total ~332 KB (from 11.36 MB, 97%); projection receipt 8.3 MB → 170 KB with all three runs and transition ID `f29fac3a4e47` intact; committed shape matches the ratified contract (intent/evidence/classifiedState/completion/project/runKind); `dispositions["explicit-preserve"]: 165` now durable in completion facts. Warden diagnostics byte-identical across conversion per the retro (SHA-256 recorded there).

**Rulings:**

1. **Nested repo/worktree boundaries are derived scope edges** (→ TRL-1270, High). A directory with its own `.git` is a different project *by definition* — the framework derives the boundary at the shared source-collection substrate; every scanner inherits it; boundary skips stay visible in `skippedByReason`. Not a repo-local exclude, not a tool denylist, not vocabulary policy. Resolves the 690-entry audit caveat by derivation (drift-guard step 1).
2. **TRL-1256 closed as Done-by-stronger-contract:** its defect (CLI-transient preserve counts) is fixed by durable disposition counts + per-form judgments (reason + representative occurrence); its mechanism (per-occurrence enumeration in committed history) is superseded by the receipt ruling — per-occurrence facts are regenerable from committed keys.
3. **TRL-1257 stays live, rescoped to v3 proof-run receipts;** convergence proposed: the retro's recommended post-merge integrated dogfood run should BE the `v1-warden-ast-source` backfill census — one run proves the integrated operator experience and creates the missing spine.
4. **TRL-1268 "Done" ratified with narrow reading:** complete as observable-plus-first-proven-reuse-slice (14.8%, 586.9 s → 500.3 s), NOT as "Regrade is fast." Further perf work is evidence-led from profiles of the next two real migrations — new issue when a dominant repeated phase is identified.
5. **Warden's independent receipt parser stands** (dependency direction beats deduplication; do NOT merge Warden/Regrade). Parity moves from maintenance burden to test-time safety: shared fixture corpus both parsers must pass. Revisit a schema-only owner only on repeated demonstrated parity breaks.
6. **Design doc marked historical;** ADR-0053 (amended #978) is canonical. Two runtime identity corrections endorsed: transition ID ≠ filename slug; changed-file evidence carries beforePath + afterPath (a content-preserving rename is not a no-op). Watch item: receipt identity fields and prepared-evaluation reuse identity must remain one vocabulary, not drift into two.

**Held for Matt:** the required-path declaration for remaining v1 families (retro Q7). Clark's recommendation: yes, conditional on (a) the integrated post-merge dogfood/census run coming back clean, (b) manual edits staying explicitly downstream of safe apply + review inventory, (c) TRL-1270 landing or owned so the audit gate is trustworthy. **Confidence:** High on rulings 1–6; the Q7 condition set is deliberate — a required path with an ignorable gate breeds alarm fatigue.

### 2026-07-17 Correction: worktree boundary doctrine — "different project by definition" retracted

**What changed:** Yesterday's ruling 1 (TRL-1270) justified the derived scope edge with "a directory containing its own `.git` is a different project by definition." Matt flagged the discomfort; Lewis reframed; Clark concurs and retracts the justification. A linked worktree's `.git` is a pointer file into the main repository — same object database, same config, same project. The claim was true for `nested-repository` and submodules, false for worktrees.

**Corrected doctrine (ratified):** *A nested Git working tree is a derived source-collection boundary, not necessarily a different project. **One invocation observes exactly one working tree.*** The boundary protects observation coherence (no contradictory versions of the same project in one scan, no cross-agent evidence contamination), not project separation. Three concepts: **project identity** (what receipts commit) / **working-tree identity** (captured by revision + blob hashes, never location) / **collection root** (exactly one per invocation). Skip taxonomy, all derived from Git facts, none authored: `nested-worktree` (.git pointer file — same project), `nested-repository` (.git directory — different project), `submodule-boundary` (.gitmodules — different project, declared relationship). Worktrees are **first-class collection roots when directly targeted** — same project configuration and contracts.

**What survives unchanged:** every operative behavior — derived edge at the shared substrate, no tool-specific denylists, skips visible in `skippedByReason`, receipt path invariant, concurrent-agent isolation. The conclusion was right; the justification was wrong, and the wrong justification would have taught agents a wrong model (worst case: worktree-rooted runs treated as foreign). TRL-1270 body rewritten; correction comment records both versions.

**Basis (tenets):** contracts are teaching surfaces — a doctrine that produces correct behavior from a false model is a latent defect; derive-by-default (taxonomy from Git facts, zero authoring). **Confidence:** High — three-way concurrence (Matt's instinct, Lewis's mechanism, Clark's ratification). **Process note:** this is what the correction loop is for; log entries get corrected by appending, never rewriting.

### 2026-07-19 Trails skill architecture: orientation + routed specialists; `trails-regrade` and `trails-wayfinder` subdivided

**Ruling (Matt directed subdivision; Clark set the shape):** The primary `trails` plugin skill is the orientation layer — quick start, lexicon, package orientation, core authoring — with a **Skill Routing table high in the body** pointing at focused skills. Subdivide only where a subsystem has its own lifecycle vocabulary an agent must load whole: **`trails-regrade`** (governed migration lifecycle, verdicts/dispositions, v3 receipts, boundaries, audit — all commands verified against the live CLI) and **`trails-wayfinder`** (graph reads, pattern-vs-query substring gotcha, overlays, fallback rules). Surfaces/resources/testing stay in the primary skill — reference files already carry their depth; don't over-fragment (add with intent). Repo-local `regrade-loop` remains the repo-internal loop/resume discipline, now pointing at `trails-regrade` as doctrine home; fixed its draft-ADR citation → ADR-0053 and receipt-era staleness. Primary skill fixes: library-surface denial (same P1 class as docs), package orientation completed (library/source/regrade/adapter-kit/cloudflare), migration section split (convert-to-Trails vs Regrade-within-Trails), wayfinding slimmed to pointer. `trails run` nested-`input` gotcha taught in cli-surface reference as interim mitigation for DX-2. Plugin 0.3.4 → 0.4.0. All repo checks green (skillset synced; installed-skill check failure pre-existing on this machine). **Confidence:** high; uncommitted pending Matt's review.

**Addendum 2026-07-19:** Matt renamed the skill `trails-wayfinder` → `trails-wayfind` (matches the command noun). Directory, frontmatter, and primary-skill pointers updated.

### 2026-07-20 Workspace lock model settled end-to-end; Gate 0 ratified; substrate ADR acceptance-ready; log reconciled

**Question:** Close the workspace-lock arc: Matt's three decisions, Clark's Gate 0 ruling, Lewis's ADR draft, and the vocabulary cutover — recorded once, in the ADR's final vocabulary.

**Decisions (all ratified; durable home is `docs/adr/drafts/20260622-project-substrate-names-its-truth.md`, acceptance-ready):**

1. **Model:** a runnable Trails app is the v1 lock-owning unit; a configured workspace statically names a set of apps (`workspace.apps`, canonical topo ID → project-relative root); Topography derives one canonical app-partitioned view; v1 persists app locks; a future aggregate lock is a **reservation** defined as the lossless canonical serialization of that view — parity by construction, never a co-equal authority.
2. **Membership ownership (Matt):** first-class static project section outside `defineConfig.resolve()`, provable-literal data, one shared source-static predicate consumed by loader and Warden; `warden.apps` normalized and retired in the same change. Governance observes membership; it does not own it.
3. **Home-repo posture (Matt):** all seven apps declared by canonical topo ID (trails, demo, junction, lookout, packlist, stash, switchback — names verified against authored `topo()` calls); every app owns a committed deterministic lock; `apps/trails/trails.lock` becomes durable evidence; the stable-cutover runbook stops deleting it. Lock commits follow R1 determinism work.
4. **Gate 0 predicates ratified with amendments (Clark 2026-07-20):** topo-rename coupling is the designed catch (Regrade the vehicle); nested/overlapping workspace declarations fail closed with a typed error naming both roots; `workspaceViewHash` material = view schema version + sorted app IDs + project-relative roots + app graph hashes + collision facts — roots in, observation evidence never material, exactly one hash; scope-invariance evidence retires the Warden invocation-root discrepancy.
5. **Selection contract:** precedence `--root-dir` → `--app` → CWD position → `--module` escape hatch; workspace-root compile requires `--app`, no fan-out in v1; the Trails operator owns the shared project-context resolver, composing facts from config (static identity, root discovery), source (collection boundaries), and topography (locks, graphs, freshness, completeness).
6. **Freshness:** proved, not inferred — no broad source fingerprint in committed locks; unqualified workspace execution proves ownership-contributing apps fresh or re-derives live; saved navigation may render freshness `unknown`; closes the `buildFromTopoLock` no-validation routing gap.
7. **Vocabulary (Clark approved Lewis's cutover):** "app" over "member" throughout — existing live vocabulary for the thing actually declared; `workspace.apps` reads as a lift from the retiring `warden.apps`. Working notes retain "member" as historical language.
8. **ADR dispositions:** substrate draft supersedes ADR-0046's container/layout (principles retained); specializes ADR-0011 (static project identity vs deployment config); annotates 0017/0014/0015 at acceptance; 0042 untouched. Correction applied en route: the `trails run` "must nest under `input`" teaching was wrong — direct fields work (verified live: `wayfind.query '{"selector":"release"}'` succeeds); only reserved names (`rootDir`, `id`, `module`, `app`, `input`) need the envelope; `plugin/skills/trails/references/cli-surface.md` fixed.

**Basis:** ADR-0000 derive-by-default; tenets one-write-many-reads + resolved-lock; ADR-0042 lifecycle boundary; ADR-0053 governed change; Source one-working-tree doctrine. Full evidence: `.agents/notes/2026-07-19-prev1-survey-ratification.md` (ten sections, four adversarial passes). **Confidence:** High throughout; every factual assertion in the ADR verified against live source.

**Log note:** this entry also marks the reconciliation of the divergent decision-log deltas (main checkout 2026-07-06→07-14 entries + bridge worktree 2026-07-16→07-19 entries merged chronologically into one identical file in both checkouts), closing R10's precondition. Committing the log is Matt's call.
