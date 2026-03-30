# Trails Vocabulary

Use Trails-branded terms consistently. These are non-negotiable in code, docs, and conversation.

## Required Terms

| Use this | Not this |
|----------|----------|
| `trail` | handler, action, endpoint, route |
| `follow` | workflow, pipeline, chain, route (for composition) |
| `topo` | registry, collection, manifest |
| `blaze` | serve, mount, start, wire up |
| `follow` | call, invoke, dispatch |
| `surface` | transport, adapter, interface |
| `run` | handler, impl, fn, implementation |
| `metadata` | annotations, tags |
| `detours` | fallbacks, retries, recovery |
| `warden` | linter, checker, validator |
| `survey` | introspect, inspect, describe |
| `guide` | docs, help, manual |
| `service` | provider, dependency, adapter (for declared infra) |

## When Writing

- The framework is "Trails" (capitalized). The primitive is "trail" (lowercase).
- Lead with code: `trail()` -> `topo()` -> `blaze()` before explaining.
- Do not overextend the metaphor. "Define a trail" is good. "Blaze a path through the wilderness" is not.
- Standard terms stay standard: `config`, `Result`, `Layer`, `Error`.
- `service` is a branded term: `service()` defines a typed infrastructure dependency. Use `services: [...]` on trail specs to declare dependencies. Do not use "service" for generic helpers or utility classes.
