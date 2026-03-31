# Architecture Decision Records

ADRs document the significant design decisions behind Trails — the choices that, if reversed, would produce a different framework. They capture the context, the decision, the consequences, and the alternatives considered.

## Index

| ADR | Title | Status |
| --- | --- | --- |
| [000](000-core-premise.md) | Core Premise | Accepted |
| [001](001-naming-conventions.md) | Naming Conventions | Accepted |
| [002](002-built-in-result-type.md) | Built-In Result Type | Accepted |
| [003](003-unified-trail-primitive.md) | Unified Trail Primitive | Accepted |
| [004](004-intent-as-first-class-property.md) | Intent as a First-Class Property | Accepted |
| [005](005-framework-agnostic-http-route-model.md) | Framework-Agnostic HTTP Route Model | Accepted |
| [006](006-shared-execution-pipeline.md) | Shared Execution Pipeline | Accepted |
| [007](007-governance-as-trails.md) | Governance as Trails | Accepted |
| [008](008-deterministic-surface-derivation.md) | Deterministic Surface Derivation | Accepted |
| [009](009-services.md) | Services as a First-Class Primitive | Accepted |
| [010](010-infrastructure-services-pattern.md) | Trails-Native Infrastructure Pattern | Accepted |
| [011](011-config-resolution.md) | Config Resolution | Accepted |
| [012](012-permit-model.md) | Permit Model | Accepted |
| [013](013-tracks.md) | Tracks | Accepted |

## Format

Each ADR follows the same structure:

- **Frontmatter** — status, created/updated dates, author
- **Context** — what problem or tension prompted the decision
- **Decision** — what we chose and why, with concrete code examples
- **Consequences** — what this enables, what it constrains, what it leaves open
- **References** — links to related ADRs and docs
