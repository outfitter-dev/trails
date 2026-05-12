---
id: 45
slug: v1-resolved-graph-error-scope
title: v1 Resolved Graph Error Scope
status: accepted
created: 2026-05-10
updated: 2026-05-11
accepted: 2026-05-10
owners: ['[galligan](https://github.com/galligan)']
depends_on: [2, 15, 17, 26, 33, 42]
---

# ADR-0045: v1 Resolved Graph Error Scope

## Context

Trails' target architecture says the resolved topo should let blind agents
inspect the system without guessing from source. ADR-0017 established that
promise. ADR-0046 refines the v1 container: `.trails/trails.lock` is the compact
manifest, and `.trails/topo.lock` is the serialized `TopoGraph` content
artifact.

The v1 implementation is narrower than future whole-program inference, but the
inspectable graph target is now the TopoGraph artifact family:

- `deriveTopoGraph()`
- `.trails/topo.lock`
- `topo_exports.topo_graph`
- `topo_exports.lock_manifest`, when stored manifest content is still needed

The error contract closed in the TRL-649/TRL-651/TRL-652 stack establishes a
clearer boundary:

- [TRL-649] preserves specialized `TrailsError` identity through serialization,
  including `RecoverableCompletionError` and dynamic `RetryExhaustedError`
  wrappers.
- [TRL-651] defines safe public and diagnostic projection/redaction for
  `TrailsError` and unknown errors across surfaces, serialization, and logs.
- [TRL-652] makes taxonomy docs and tests derive from the core `errorClasses`
  registry, with dynamic `RetryExhaustedError` behavior handled explicitly.

Those decisions make the taxonomy and projection behavior inspectable and
checked. They do not make every trail's possible failures statically known.

## Decision

For v1, resolved graph error scope is:

| Error information | v1 graph scope | Owner |
| --- | --- | --- |
| Taxonomy categories, retryability, and surface codes | Registry-owned, not duplicated per graph entry | `@ontrails/core` `errorClasses`, ADR-0026, TRL-652 |
| Public and diagnostic redaction policy | Runtime projection contract, not graph payload | `@ontrails/core` projection helpers, ADR-0026, TRL-651 |
| Serialized error identity | Runtime serialization contract, not graph payload | `serializeError()` / `deserializeError()`, TRL-649 |
| Trail error examples | Authored example cases in TopoGraph entries and topo-store examples | `trail.examples` |
| Trail detours | Authored recovery declarations: matched error class name and capped max attempts | `trail.detours`, ADR-0033 |
| Exhaustive per-trail emitted errors | Deferred | Future authored or inferred error contract work |
| Observed runtime failures | Deferred | Future trace or telemetry graph merge work |

The v1 graph may expose error class names that the developer authored in
examples and detours. These names are references into the taxonomy registry.
They are not a copied taxonomy table, not a redaction policy snapshot, and not
a proof that the listed classes are exhaustive for the trail.

### Authored scope

The graph records authored error-related facts that are already part of trail
contracts:

- Error examples keep their `error` class name in structured examples.
- Detours keep the declared `on` error class name and effective capped
  `maxAttempts`.

These fields answer "what did the developer explicitly declare for examples
or recovery?" They do not answer "what errors can this trail ever return?"

### Derived scope

The graph does not embed a taxonomy matrix on every trail. Agents derive class
category, retryability, HTTP status, CLI exit code, and JSON-RPC code from the
registry-backed taxonomy docs and core projection helpers.

Dynamic classes stay dynamic. `RetryExhaustedError` inherits category and
surface codes from the wrapped `TrailsError`, so a graph entry that only names
`RetryExhaustedError` is insufficient to determine a fixed category. Agents
must inspect serialized runtime errors or the wrapped cause when dynamic
identity matters.

### Inferred scope

v1 does not infer emitted error contracts from blaze source, `ctx.cross()`
propagation, resource factories, layers, or detour recovery functions. Whole
program error inference is out of scope because it would require static
analysis that Trails has not made a contract yet.

Warden still validates local rules that are checkable today: implementations
return `Result`, native throws are rejected, detour contracts are shaped
correctly, and surface mappers cover taxonomy categories. Those checks support
the error contract, but they do not create an inferred per-trail error graph.

### Observed scope

v1 does not merge runtime observations into the resolved graph. Traces, logs,
serialized error payloads, and adapter responses may contain actual error
identity after execution. They are evidence about a run, not stable resolved
graph state.

## Consequences

- No new v1 graph field is added for exhaustive per-trail errors in this ADR.
  Adding such a field would imply a contract Trails cannot yet keep.
- Docs and agents should describe `.trails/trails.lock` as a compact manifest
  and `.trails/topo.lock` as the serialized `TopoGraph` content artifact. Use
  `topo.lock`, `deriveTopoGraph()`, and typed topo-store query views when full
  JSON fidelity matters.
- TopoGraph entries and topo-store detail records can continue to expose
  `examples` and `detours` as authored contract facts.
- Public error bodies remain governed by the redaction/projection policy from
  TRL-651, not by resolved graph artifacts.
- Future error graph work should pick an explicit source of authority before
  adding fields: authored declarations, registry-derived summaries, static
  inference, observed runtime evidence, or a versioned combination.

## Deferred Work

- Add an authored per-trail error contract if Trails decides developers should
  explicitly declare possible failures beyond examples and detours.
- Add static inference only after the framework can explain and test propagation
  through `Result.err`, `ctx.cross()`, resources, layers, and detour recovery.
- Add typed topo-store accessors for error examples and detour projections if
  agents need ergonomic error-specific queries instead of reading trail detail
  records or `TopoGraph` JSON.

## References

- [ADR-0002: Built-In Result Type](0002-built-in-result-type.md)
- [ADR-0015: Topo Store](0015-topo-store.md)
- [ADR-0017: The Serialized Topo Graph](0017-serialized-topo-graph.md)
- [ADR-0026: Error Taxonomy as Transport-Independent Behavior Contract](0026-error-taxonomy-as-transport-independent-behavior-contract.md)
- [ADR-0033: Detour Execution for Recovery](0033-detour-execution-for-recovery.md)
- [ADR-0042: Core/Topographer Boundary Doctrine](0042-core-topographer-boundary-doctrine.md)
- [ADR-0046: Lock v3 Artifact Family](0046-lock-v3-artifact-family.md)

[TRL-649]: https://linear.app/outfitter/issue/TRL-649
[TRL-651]: https://linear.app/outfitter/issue/TRL-651
[TRL-652]: https://linear.app/outfitter/issue/TRL-652
