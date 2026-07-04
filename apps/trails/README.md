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
- `trails schema <command...>` shows accepted CLI routes, aliases, flags, and schemas for an operator command or command namespace.
- `trails warden` runs Trails governance checks for contract and architecture drift. Use `--scope-exclude <glob>` or project `warden.scope.exclude` config when local notes, scratch space, or generated state should not be governed by Warden.
- `trails regrade plan <from> <to> --root-dir <path> --json` writes an active Regrade plan, `trails regrade plan --expand` stages wide-net review candidates in that plan, `trails regrade preview` reruns it without writing, and `trails regrade apply` consumes the plan and writes history. Use `plan --expand --dry-run` to inspect staged candidates without writing the active plan, and add `--dry-run` to `apply` to prove the apply path without mutating source. Use `trails regrade plans` and `trails regrade check` when a workspace has active plans that need inspection before apply. MCP exposes the same lifecycle as `trails_plan_regrade`, `trails_list_regrades`, `trails_check_regrade`, `trails_preview_regrade`, and `trails_apply_regrade`.
- `trails guide` remains available for compatibility; prefer `trails wayfind --source live --module <app-module>` or saved-artifact Wayfinder reads for agent navigation.

Trails is contract-first: define trails once with typed input, Result output, examples, and meta; the framework derives CLI, MCP, HTTP, and future surfaces from the same contracts.

See the main Trails documentation for the full framework guide:
<https://github.com/outfitter-dev/trails>
