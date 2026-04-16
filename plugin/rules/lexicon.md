# Trails Vocabulary

Use Trails-branded terms consistently. These are non-negotiable in code, docs, and conversation.

## Required Terms

| Use this | Not this |
|----------|----------|
| `trail` | handler, action, endpoint, route |
| `cross` | workflow, pipeline, chain, route (for composition) |
| `topo` | registry, collection, manifest |
| `blaze` | implementation function — input to Result |
| `cross` | call, invoke |
| `surface` | serve, mount, start, wire up |
| `resource` | provider, dependency, service |
| `signal` | event, notification, message |
| `layer` | gate, middleware |
| `tracing` | telemetry recorder |
| `metadata` | annotations, tags |
| `detours` | fallbacks, retries, recovery |
| `warden` | linter, checker, validator |
| `survey` | introspect, inspect, describe |
| `guide` | docs, help, manual |
| `connector` | adapter, bridge, transport shim |

## When Writing

- The framework is "Trails" (capitalized). The primitive is "trail" (lowercase).
- Lead with code: `trail()` -> `crosses` -> `resource()` -> `surface()` before explaining.
- Do not overextend the metaphor. "Define a trail" is good. "Blaze a path through the wilderness" is not.
- Standard terms stay standard: `config`, `Result`, `Error`.
- `resource` is a branded term: `resource()` defines a typed infrastructure dependency. Use `resources: [...]` on trail specs to declare dependencies. Do not use "resource" for generic helpers or utility classes.
