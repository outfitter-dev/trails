---
id: 50
slug: surface-accommodations-preserve-trail-identity
title: Surface Accommodations Preserve Trail Identity
status: accepted
created: 2026-06-14
updated: 2026-06-14
owners: ['[galligan](https://github.com/galligan)']
depends_on: [0, 1, 8, 19, 27, 35, 46]
---

# ADR-0050: Surface Accommodations Preserve Trail Identity

## Context

Trails treats CLI, MCP, HTTP, and library calls as peer surfaces over the same authored trail graph. That equality does not mean each surface wants the same shape. A CLI may need compatibility commands. MCP may need grouped tools to reduce agent context load. HTTP may need stable route names. A library surface may need export names that feel native to TypeScript consumers.

The framework already had the pieces:

- ADR-0008 makes surface derivation deterministic.
- ADR-0019 gives CLI a default command tree from trail IDs, with explicit room for overrides.
- ADR-0035 says surface APIs render the graph instead of owning new domain behavior.
- ADR-0046 makes resolved graph facts inspectable.

Dogfooding exposed the missing doctrine between those decisions. Without a closed vocabulary for surface fit, agents tend to either:

- hide several capabilities behind one branching trail input, such as `{ action: "create" | "delete" }`;
- call every grouped or alternate surface shape a "trailhead";
- overuse surface-local words such as HTTP route as cross-surface categories;
- ask developers to author machinery that Trails can derive.

Naming is the guardrail. An unnamed concept will not stay unnamed. If we do not name the surface-fit family precisely, every implementation lane will invent its own names and bright lines.

## Decision

### Core Rule

Adopt **surface accommodation** as the umbrella for projection-level fit adjustments:

> Land the capability in the trail. Accommodate the surface in projection.

A surface accommodation is valid only while the same authored trail contract remains true. It may make a surface easier to call, scan, or migrate. It must not change what capability is being invoked.

Some surface accommodation concepts are canonically named even when they are not directly authored. A surface entry or approach may be derived from a trail ID, schema, or surface configuration. Naming them does not make them new primitives.

### Vocabulary

Use these terms when deciding whether a surface concern belongs on the trail, in projection metadata, or in a distinct trail:

| Term | Meaning |
| --- | --- |
| `trail` | The authored capability and source of truth. |
| `surface entry` | The invocable affordance a surface exposes: CLI command, MCP tool, HTTP route, or library export. |
| `approach` | A surface-specific way for a caller to reach a surface entry. |
| `path` | Surface-local realization of an approach: command path, tool name, HTTP path, or export name. |
| `alias` | Alternate approach to the same surface entry and same trail contract. |
| `input mapping` | Surface-shaped input that normalizes into the same authored trail input contract. |
| `surface trailhead` | One grouped surface entry over multiple trails, with member identity preserved at invocation and response time. |
| `trail fork` | The point where a proposed accommodation is no longer honest. Author a distinct trail, a composing trail, or a trailhead that preserves member identity. |

`trail fork` is doctrine language, not a new API primitive. Do not confuse it with versioning forks.

The old boundary noun retired by ADR-0035 was considered and rejected for this family. Reusing it for surface entries would reintroduce an old ambiguity.

### Two Axes

Surface accommodations sit on two different axes. The axes are related, but not interchangeable.

The **approach axis** is N-to-1. Several approaches can converge on one trail:

- an alias adds another path to the same surface entry;
- an input mapping reshapes surface input before validating the same trail contract.

The invariant is: converge without lying.

The **entry axis** is 1-to-N when a surface trailhead is involved. One grouped surface entry can expose several trails, but it must keep the selected member trail visible.

The invariant is: gather without merging.

The cardinality shorthand is a teaching aid, not a type system. Aliases and trailheads live on different axes. A trailhead is not a generic action bag. An alias is not a trailhead. An input mapping is not alternate behavior.

### Trail Fork Test

Before adding a surface accommodation, ask whether it clears both boundaries.

**Semantic fork:** the proposed surface shape changes intent, permit requirements, error meaning, output meaning, lifecycle, or side effects.

**Structural fork:** the proposed surface shape merges member contracts, hides member trail identity, or forces callers to infer selected behavior from an action vocabulary instead of an explicit trail identity.

If either boundary fails, the shape is not an accommodation. Use one of these instead:

- a distinct trail for a distinct capability;
- a composing trail when the capability truly coordinates existing trails;
- a surface trailhead when the surface needs one grouped entry over existing trails and can preserve member identity.

### Surface Implications

CLI command routes are CLI-local projection metadata. A CLI alias is an alternate approach to one trail contract. A future CLI input mapping may accept a more convenient command-line shape only if it normalizes into the same input contract without changing behavior. The operational test is:

> Can this route be normalized into the same trail contract without lying?

MCP surface trailheads group and select without merging. The current MCP implementation proves the shape:

- a trailhead tool accepts `{ trail, input }`;
- the selected trail dispatches through the ordinary MCP tool handler;
- a successful response returns `{ trail, output }`;
- trailhead tool metadata records `trailheadId` and `memberTrailIds`;
- intent annotations roll up conservatively: all read stays read, any destroy becomes destroy, otherwise the trailhead is write.

HTTP keeps `route` as HTTP-local vocabulary. CLI may use the phrase "CLI command route" for concrete accepted command paths. Neither phrase becomes the cross-surface family term.

Adapter-kit does not author surface accommodations. It may validate or report resolved projection evidence for an adapter that claims support for grouped entries or alternate approaches.

### Governance

Warden should make surface accommodation drift harder to miss:

- `cli-command-route-coherence` keeps accepted CLI command paths normalized into one trail contract.
- `surface-trailhead-coherence` keeps trailhead maps reviewable before MCP projection.
- `trail-fork-coaching` warns when an authored trail branches on suspicious action or operation fields.

`trail-fork-coaching` remains advisory. It must coach toward the semantic and structural fork test without claiming certainty from field names alone.

Future governance may add per-member intent or permit metadata for intentionally heterogeneous trailheads. The default remains conservative: prefer homogeneous trailheads, or keep high-signal and permission-sensitive operations as direct surface entries.

### Non-Goals

This ADR does not add:

- a core grouped-entry primitive or `facet()` API;
- adapter-kit-owned trailhead configuration;
- generic cross-surface "route" vocabulary;
- conditional command recipes or a second CLI authoring language;
- permission to hide multiple capabilities behind one branching trail.

## Consequences

- Reviewers can classify surface-fit work as alias, input mapping, surface trailhead, or trail fork instead of debating from vibes.
- Surface-specific projection code may stay ergonomic without taking ownership of domain behavior.
- Agent guidance must teach the fork test and the two axes before suggesting implementation shapes.
- Existing surface docs should cite this ADR instead of carrying their own private doctrine.
- Future surface accommodation APIs must expose resolved graph facts so
Wayfinder, Warden, schema inspection, and agents can see the same accepted surface shape as runtime users.

## References

- ADR-0008: Deterministic Surface Derivation
- [ADR-0019: Hierarchical Command Trees from Trail IDs](0019-hierarchical-command-trees-from-trail-ids.md)
- [ADR-0035: Surface APIs Render the Graph](0035-surface-apis-render-the-graph.md)
- [ADR-0046: Lock v3 Artifact Family](0046-lock-v3-artifact-family.md)
- [Surface Accommodations](../surfaces/surface-accommodations.md)
- [Surface Trailheads](../surfaces/surface-trailheads.md)
- [CLI Surface](../surfaces/cli.md)
