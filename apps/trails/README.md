# Trails CLI

Command-line tools for working with Trails projects.

Use the CLI to scaffold a Trails app, add surfaces, inspect the current topo, run warden checks, manage draft state, and keep local Trails project state tidy.

```bash
bunx @ontrails/trails create
```

Common workflows:

- `trails create` starts a new Trails project with generated trail, topo, surface, and verification files.
- `trails add surface` adds another surface entrypoint to an existing project.
- `trails topo` inspects topo state and manages pins/history.
- `trails compile` writes root `trails.lock`.
- `trails validate` checks root `trails.lock` for drift.
- `trails wayfind`, `trails wayfind --trails --intent read`, `trails wayfind <id> --contract`, `trails wayfind <id> --deps`, `trails wayfind <id> --impact`, `trails wayfind pattern "wayfind.*"`, `trails wayfind query "release drift"`, `trails wayfind file <file> --outline`, and `trails wayfind diff ...` read graph artifacts and source outlines through Wayfinder for local navigation.
- `trails schema <command...>` shows accepted CLI routes, aliases, flags, and schemas for an operator command.
- `trails warden` runs Trails governance checks for contract and architecture drift. Use `--jurisdiction-ignore <glob>` or project `warden.jurisdiction.ignore` config when local notes, scratch space, or generated state should not be governed by Warden.
- `trails regrade --root-dir <path> --json` dry-runs downstream migration checks; add `--apply` only to write safe rewrites. Use `trails regrade <from> <to> --root-dir <path> --json` for occurrence-level vocabulary regrade reports that include the authored plan, observed ledger, completion gate, and scan inventory by file type and top-level path. Add `--ignore <glob>` to keep migration scope away from local notes, scratch space, generated state, or other paths that should not be scanned for that transition; project config can provide `regrade.scope` defaults and explicit plan inputs override them. The same `regrade` trail is exposed through MCP for agent-driven migration checks.
- `trails guide` remains available for compatibility; prefer `trails wayfind --source live --module <app-module>` or saved-artifact Wayfinder reads for agent navigation.

Trails is contract-first: define trails once with typed input, Result output, examples, and meta; the framework derives CLI, MCP, HTTP, and future surfaces from the same contracts.

See the main Trails documentation for the full framework guide:
<https://github.com/outfitter-dev/trails>
