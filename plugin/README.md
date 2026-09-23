# Trails Adopter Plugin

Build with the [Trails](https://github.com/outfitter-dev/trails) framework through contract-first trails, surfaces, testing, and governance for agent-assisted development. This bundle is self-contained adopter guidance and does not depend on the Trails checkout or the `trails-dev` contributor plugin.

## Distributions

The plugin is available in two host-specific packages:

- The Claude Code bundle includes the skills, the `trail-engineer` agent, rules, and a read-only `SessionStart` hook.
- The portable Agent Plugins package contains the two adopter skills. Install it with an Agent Plugins-compatible host using that host's plugin instructions.

To install the Claude Code bundle from its marketplace:

```bash
claude plugin marketplace add outfitter-dev/trails
claude plugin install trails@trails
```

## Version Alignment

The plugin package version and the Trails framework version in the bundled `trails` skill are separate compatibility facts. Check both when selecting or updating an installed package.

## SessionStart Hook

The Claude plugin installs a read-only `SessionStart` hook that emits guidance only in likely Trails projects. It detects `@ontrails/*` dependencies, `package.json.trails.module`, root `trails.config.*` files, root `.trails/`, and guarded `src/app.ts`/`src/index.ts` topo sources. Outside those signals it stays silent.

When a local or PATH `trails` CLI is discoverable, the hook suggests a non-mutating Warden probe with `--lock cached --no-lock-mutation`; otherwise it asks the operator to use a project-pinned `@ontrails/trails` before running Warden. The hook never syncs skills or edits project files. Codex hook parity is not claimed here; treat this as Claude `SessionStart` behavior until verified separately.

To ignore the hook for a session, continue without running the suggested probe. To disable it, remove or disable this plugin's `SessionStart` hook in Claude's plugin configuration.

## What's Included

### Skills

| Skill | Purpose |
|-------|---------|
| `trails` | Build with Trails: trail creation, resources, surfaces, testing, debugging, wayfinding, migration, and governance. |
| `trails-error-format` | Apply the public error taxonomy, rendering, redaction, retryability, and Result-vs-throw boundaries. |

### Claude Code Agent

| Agent | Purpose |
|-------|---------|
| `trail-engineer` | Build features with Trails: design, implement, test, and debug. |

### Claude Code Rules

- **lexicon** — Enforces Trails terms such as trail, surface, topo, implementation, compose, resource, signal, layer, and tracing.
- **patterns** — Provides core coding patterns such as Result over throw and surface-agnostic implementations.

## License

MIT
