# Trails Plugin for Claude Code

Build with the [Trails](https://github.com/outfitter-dev/trails) framework — contract-first trails, surfaces, testing, and governance for agent-assisted development.

## Installation

```bash
claude plugin marketplace add outfitter-dev/trails
claude plugin install trails@trails
```

## Metadata Policy

The plugin and framework versions are intentionally tracked separately:

- `plugin/.claude-plugin/plugin.json` owns the Claude plugin version.
- `packages/core/package.json` owns the Trails framework version targeted by
  the bundled `trails` skill.
- `.claude-plugin/marketplace.json` and `plugin/skills/trails/SKILL.md`
  contain derived copies and should be refreshed with
  `bun run plugin:metadata:sync`.

Run `bun run plugin:metadata:check` before submitting plugin metadata changes.

## Local Skill Drift Check

Use the read-only drift checker before relying on a locally installed `trails`
skill:

```bash
bun run plugin:installed-skill:check
```

The checker compares the repo-bundled `plugin/skills/trails` source against
standard `$HOME` install locations for shared agent skills, Claude, and Codex.
It reports whether each path is a copy, symlink, or missing optional path, then
checks file drift, stale vocabulary, and `metadata.trails.version` drift. It
does not update installed skill files; refreshing a local install remains an
explicit operator action after reviewing the report.

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
| `trails-primitive-parity` | Compare primitive maturity without forcing trail-equivalent scope or speculative public API. |
| `trails-language-styleguide` | Tighten Trails prose, docs, ADRs, prompts, and examples against the lexicon and `blaze` grammar. |

### Agent

| Agent | Purpose |
|-------|---------|
| `trail-engineer` | Build features with Trails — design, implement, test, debug |

### Rules

- **lexicon** — Enforces Trails-branded terms (trail, surface, topo, blaze, cross, resource, signal, layer, tracing)
- **patterns** — Core coding patterns (Result over throw, surface-agnostic blazes)

## License

MIT
