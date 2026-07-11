# Trails Lexicon

Use Trails-branded terms consistently. These are non-negotiable in code, docs, and conversation.

## Required Terms

| Use this | Not this |
|----------|----------|
| `trail` | handler, action, endpoint, route |
| `compose` | cross, call, invoke, workflow, pipeline, chain, route (for composition) |
| `topo` | registry, collection, manifest |
| `implementation` | handler, impl, action body; use the authored `implementation` field |
| `surface` | serve, mount, start, wire up |
| `surface accommodation` | surface workaround, alternate behavior, generic route vocabulary |
| `surface entry` | endpoint, route, action (when cross-surface) |
| `approach` | route, path, trailhead (when cross-surface) |
| `resource` | provider, dependency, service |
| `signal` | event, notification, message |
| `layer` | gate, middleware |
| `tracing` | telemetry recorder |
| `meta` | metadata, annotations, tags |
| `detours` | fallbacks, retries, recovery |
| `warden` | linter, checker, validator |
| `survey` | introspect, inspect, describe |
| `guide` | docs, help, manual |
| `adapter` | connector, bridge, transport shim |
| `trailhead` | `facet` primitive, `facet` API, `facet` package |
| `MCP resources` | Trails resources, dependencies, services (when referring to MCP protocol resources) |

## When Writing

- The framework is "Trails" (capitalized). The primitive is "trail" (lowercase).
- Lead with code: `trail()` -> `implementation:` -> `topo()` -> `surface()` before explaining.
- Do not overextend the metaphor. "Define a trail" is good. Decorative outdoor prose is not.
- A trail with an `implementation` is a runnable contract. The runtime runs the trail through its shared execution pipeline.
- Standard terms stay standard: `config`, `Result`, and `Error`.
- `connector` is retired public taxonomy. Use `adapter` for a thin runtime-specific layer.
- `resource` is a branded term: `resource()` defines a typed infrastructure dependency. Use `resources: [...]` on trail specs to declare dependencies. Do not use "resource" for generic helpers or utility classes.
- Use `trailhead` for surface-side grouped projection. Use `schema facet` only as descriptive schema-slice prose. Do not invent a core `Facet` primitive, `facet()`, or adapter-kit `facet` config.
- `surface accommodation` is the cross-surface family for aliases, input mappings, and trailheads. Use the ADR-0050 fork test before suggesting one.
- `surface entry` and `approach` are named concepts, not necessarily authored primitives. Do not turn them into APIs unless the repo has already done so.
- `MCP resources` are MCP protocol resources for cold context. Keep the qualifier when writing about `trails://surface-map` or example resources so they do not collide with Trails `resource()` declarations.
