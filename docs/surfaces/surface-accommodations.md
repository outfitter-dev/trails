# Surface Accommodations

Surface accommodations are projection-level fit adjustments. They let each surface feel natural without changing what a trail means.

The core rule is simple:

> Land the capability in the trail. Accommodate the surface in projection.

A surface accommodation is valid only while the same authored trail contract remains true. If the surface shape would change intent, permits, errors, outputs, lifecycle, side effects, or which trail is actually running, the model has found a trail fork.

## Vocabulary

Use these terms when deciding whether a surface concern belongs on a trail, in a surface projection, or as a new trail.

| Term | Meaning |
| --- | --- |
| `surface entry` | The invocable affordance a surface exposes. A CLI command, MCP tool, HTTP route, and library export are all surface entries. |
| `approach` | A surface-specific way for a caller to reach a surface entry. |
| `path` | The surface-local realization of an approach: a CLI command path, MCP tool name, HTTP path, or library export name. |
| `alias` | An alternate approach to the same surface entry and the same trail contract. |
| `input mapping` | Surface-shaped input that normalizes into the same authored trail input contract. |
| `surface facet` | One grouped surface entry over multiple trails, with member trail identity preserved at invocation and response time. |
| `trail fork` | The point where a proposed accommodation is no longer honest. Author a distinct trail, a composed trail, or a facet that preserves member identity. |

`trail fork` is doctrine language, not a new API primitive. Do not confuse it with lifecycle/version forks in trail versioning.

## The Shape

There are two useful axes.

The **approach axis** is N-to-1. Several approaches can reach the same trail:

- an alias adds another path to the same surface entry;
- an input mapping reshapes surface input before validating the same trail contract.

The **entry axis** is 1-to-N when a surface facet is involved. One grouped surface entry can expose several trails, but it must keep the selected member trail visible.

Those axes are related, but not interchangeable. An alias is not a facet. A facet is not a generic action bag. An input mapping is not alternate behavior.

## Fork Test

Use the fork test before adding an accommodation:

> If a surface adjustment changes intent, permit requirements, error meaning, output meaning, lifecycle, side effects, or hides which trail is actually running, it is no longer an accommodation. Treat it as a trail fork.

When the test fails, use one of these shapes instead:

- a distinct trail for a distinct capability;
- a composing trail when the capability truly coordinates existing trails;
- a surface facet when the surface needs one grouped entry over existing trails and can preserve member identity.

## Examples

A CLI compatibility command such as `wayfind find` for `wayfind.search` is an alias when it reaches the same input, output, intent, permit, errors, and blaze.

A CLI spelling that accepts a different ergonomic shape but normalizes into the same authored input is an input mapping. It must remain inspectable and cannot invent hidden behavior.

An MCP `inspect` tool over several read-only topo inspection trails is a surface facet when the call includes the selected `trail` and the result returns the same selected `trail` with its output.

A command like `manage users --action delete` that hides create, update, and delete behind one action field is usually a trail fork. Prefer separate trails and, if the surface needs grouping, a facet that still exposes the selected member trail.

## Surface-Local Words

Surface-local words stay local:

- CLI has command paths and aliases.
- MCP has tool names and resources.
- HTTP has routes and route groups.
- Library surfaces have export names.

Do not use one surface's local word as the cross-surface umbrella. `route` is the right word for HTTP and an accepted phrase for CLI command-route projection, but it is not the generic family term. The generic family is surface accommodation.
