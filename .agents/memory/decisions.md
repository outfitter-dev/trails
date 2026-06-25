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
