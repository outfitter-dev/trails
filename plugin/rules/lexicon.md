# Trails Lexicon

Use Trails-branded terms consistently. These are non-negotiable in code, docs, and conversation.

## Required Terms

| Use this | Not this |
|----------|----------|
| `trail` | handler, action, endpoint, route |
| `compose` | cross, call, invoke, workflow, pipeline, chain, route (for composition) |
| `topo` | registry, collection, manifest |
| `blaze` | handler, impl, action body; do not rename the authored `blaze` field to run/execute |
| `surface` | serve, mount, start, wire up |
| `surface accommodation` | surface workaround, alternate behavior, generic route vocabulary |
| `surface entry` | endpoint, route, action (when cross-surface) |
| `approach` | route, path, facet (when cross-surface) |
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
| `surface facet` | facet primitive, facet API, facet package |
| `MCP resources` | Trails resources, dependencies, services (when referring to MCP protocol resources) |

## When Writing

- The framework is "Trails" (capitalized). The primitive is "trail" (lowercase).
- Lead with code: `trail()` -> `blaze:` -> `topo()` -> `surface()` before explaining.
- Do not overextend the metaphor. "Define a trail" is good. "Blaze a path through the wilderness" is not.
- Use `implementation` to clarify `blaze`, not to replace it as the concept. A blazed trail is a runnable contract.
- Standard terms stay standard: `config`, `Result`, and `Error`.
- `connector` is retired public taxonomy. Use `adapter` for a thin runtime-specific layer.
- `resource` is a branded term: `resource()` defines a typed infrastructure dependency. Use `resources: [...]` on trail specs to declare dependencies. Do not use "resource" for generic helpers or utility classes.
- `facet` is qualified projection vocabulary. Use `surface facet` for surface-side grouped projection and `schema facet` only as descriptive schema-slice prose. Do not invent a core `Facet` primitive, `facet()`, or adapter-kit facet config.
- `surface accommodation` is the cross-surface family for aliases, input mappings, and surface facets. Use the ADR-0050 fork test before suggesting one.
- `surface entry` and `approach` are named concepts, not necessarily authored primitives. Do not turn them into APIs unless the repo has already done so.
- `MCP resources` are MCP protocol resources for cold context. Keep the qualifier when writing about `trails://surface-map` or example resources so they do not collide with Trails `resource()` declarations.
