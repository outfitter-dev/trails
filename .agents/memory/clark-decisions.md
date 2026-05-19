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
