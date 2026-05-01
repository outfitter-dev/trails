# Trails Plugin for Claude Code

Build with the [Trails](https://github.com/outfitter-dev/trails) framework — contract-first trails, surfaces, testing, and governance for agent-assisted development.

## Installation

```bash
claude plugin marketplace add outfitter-dev/trails
claude plugin install trails@trails
```

## What's Included

### Skills

| Skill | Purpose |
|-------|---------|
| `trails` | Build with Trails: trail creation, resources, surfaces, testing, debugging, migration, and governance. |
| `trails-warden-advisory` | Classify hardening findings into Warden, repo-local Oxlint, docs, advisory, or no-rule homes. |
| `trails-derive-from-source` | Derive framework facts from owner exports instead of shadow registries or duplicated maps. |
| `trails-dogfood-check` | Review framework code against Trails' own Result, cwd, loading, and host-boundary rules. |
| `trails-error-format` | Review error taxonomy, projection, redaction, retryability, and Result-vs-throw boundaries. |
| `trails-discriminate-union` | Review public/queryable union-like outputs for stable branch discriminants. |

### Agent

| Agent | Purpose |
|-------|---------|
| `trail-engineer` | Build features with Trails — design, implement, test, debug |

### Rules

- **lexicon** — Enforces Trails-branded terms (trail, surface, topo, blaze, cross, resource, signal, layer, tracing)
- **patterns** — Core coding patterns (Result over throw, surface-agnostic implementations)

## License

MIT
