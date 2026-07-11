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
- `packages/core/package.json` owns the Trails framework version targeted by the bundled `trails` skill.
- `.claude-plugin/marketplace.json` and `plugin/skills/trails/SKILL.md` contain derived copies and should be refreshed with `bun run plugin:metadata:sync`.

Run `bun run plugin:metadata:check` before submitting plugin metadata changes.

## Local Skill Drift Check

Use the read-only drift checker before relying on a locally installed `trails` skill:

```bash
bun run plugin:installed-skill:check
```

The checker compares the repo-bundled `plugin/skills/trails` source against standard `$HOME` install locations for shared agent skills, Claude, and Codex. It reports whether each path is a copy, symlink, or missing optional path, then checks file drift, stale vocabulary, and `metadata.trails.version` drift. It does not update installed skill files; refreshing a local install remains an explicit operator action after reviewing the report.

## SessionStart Hook

The Claude plugin installs a read-only `SessionStart` hook that emits guidance only in likely Trails projects. It detects `@ontrails/*` dependencies, `package.json.trails.module`, root `trails.config.*` files, root `.trails/`, and guarded `src/app.ts`/`src/index.ts` topo sources. Outside those signals it stays silent.

When a local or PATH `trails` CLI is discoverable, the hook suggests a non-mutating Warden probe with `--lock cached --no-lock-mutation`; otherwise it asks the operator to use a project-pinned `@ontrails/trails` before running Warden. The hook never syncs global skills or edits project files. Codex hook parity is not claimed here; treat this as Claude `SessionStart` behavior until verified separately.

To ignore the hook for a session, continue without running the suggested probe. To disable it, remove or disable this plugin's `SessionStart` hook in Claude's plugin configuration.

## Release Path

Plugin release and republish steps are tracked in the repo runbook:

- [Plugin Release Runbook](../docs/releases/plugin-release.md)

The runbook keeps plugin version `0.3.4` separate from the bundled skill's Trails framework target version. It also names the stop rules for marketplace, registry, `npx skills`, and global installed-skill mutations. Do not treat a local/global `trails` skill as current until `bun run plugin:installed-skill:check` passes or an operator explicitly chooses to keep it decoupled.

## What's Included

### Skills

| Skill | Purpose |
|-------|---------|
| `trails` | Build with Trails: trail creation, resources, surfaces, testing, debugging, wayfinding, migration, and governance. |
| `trails-warden-advisory` | Classify hardening findings into Warden, repo-local Oxlint, docs, advisory, or no-rule homes. |
| `trails-derive-from-source` | Derive framework facts from owner exports instead of shadow registries or duplicated maps. |
| `trails-dogfood-check` | Review framework code against Trails' own Result, cwd, loading, and host-boundary rules. |
| `trails-error-format` | Review error taxonomy, projection, redaction, retryability, and Result-vs-throw boundaries. |
| `trails-discriminate-union` | Review public/queryable union-like outputs for stable branch discriminants. |
| `trails-primitive-parity` | Compare primitive maturity without forcing trail-equivalent scope or speculative public API. |
| `trails-writing-voice` | Review Trails docs, ADRs, release notes, README content, and agent guidance for stance, audience, and tone. |
| `trails-writing-style` | Review Trails prose for rhythm, clarity, examples, and vocabulary discipline. |
| `trails-writing-docs` | Place and maintain Trails docs in the current repo structure while the docs organization ADR is pending. |
| `trails-editorial` | Run a full Trails editorial review across voice, style, structure, correctness, and readiness. |
| `trails-language-styleguide` | Compatibility pointer to the newer Trails writing skills for older prompts. |

### Agent

| Agent | Purpose |
|-------|---------|
| `trail-engineer` | Build features with Trails — design, implement, test, debug |

### Rules

- **lexicon** — Enforces Trails-branded terms (trail, surface, topo, implementation, compose, resource, signal, layer, tracing)
- **patterns** — Core coding patterns (Result over throw, surface-agnostic implementations)

## License

MIT
