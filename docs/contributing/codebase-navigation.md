# Codebase Navigation

This guide orients people and agents inside the Trails repository. Keep durable repo-map material here: important source-of-truth locations, generated artifacts, package layout notes, and tool setup that helps contributors navigate the code without guessing.

For now, the main setup is Wayfinder for graph reads plus symbolic navigation for source reads.

## Default Graph Navigation: Wayfinder

When the question is about saved topo facts, use Wayfinder before rebuilding the graph from source search. It reads Topographer artifacts and returns source plus freshness metadata, so agents can tell whether they are looking at current graph evidence. Locked graph reads require artifacts to exist; source outline reads can still return useful source facts when graph artifacts are missing.

Start by checking the local command shape:

```bash
bun apps/trails/bin/trails.ts schema wayfind
```

When artifacts exist, narrow the graph read with the selected local CLI surface:

```bash
bun apps/trails/bin/trails.ts wayfind overview --root-dir . --json
bun apps/trails/bin/trails.ts wayfind --trails --intent read --root-dir . --json
bun apps/trails/bin/trails.ts wayfind wayfind.search --view contract --root-dir . --json
bun apps/trails/bin/trails.ts wayfind errors --root-dir . --input-json '{"filters":{"kind":"trail","idPrefix":"wayfind."}}' --json
bun apps/trails/bin/trails.ts wayfind --resources --root-dir . --json
bun apps/trails/bin/trails.ts wayfind --around wayfind.search --root-dir . --json
bun apps/trails/bin/trails.ts wayfind --from wayfind.search --view map --root-dir . --json
bun apps/trails/bin/trails.ts wayfind outline apps/trails/src/app.ts --root-dir . --review
bun apps/trails/bin/trails.ts wayfind outline apps/trails/src/app.ts --root-dir . --features source,apps,diagnostics --json
bun apps/trails/bin/trails.ts wayfind --source live --module apps/trails/src/app.ts --json
```

Use `trails schema <command...>` when you need the accepted CLI routes, aliases, flags, and schemas for an operator command before invoking it from a shell.

Use `wayfind outline <file>` before reading a large source file when you need a compact source map. It parses the explicit file path, reports imports, exports, declarations, app declarations, and authored trail IDs, and links those trail IDs to saved graph facts when artifacts exist. In `--review` text mode, matched trails include compact graph facts such as intent, input/output schema presence, and example count when those facts are available.

Missing graph artifacts are hard failures for locked graph reads and warnings for source outline context. Follow the diagnostic's `trails compile --module <app-module> --root-dir <workspace-root> --permit '{"id":"operator","scopes":["topo:write"]}'` shape when you are allowed to refresh artifacts; do not silently fall back to stale graph assumptions. Use source search, qmd, or symbol tools when Wayfinder reports missing or stale artifacts, when the task needs implementation text that Topographer does not project, or when the current authority does not allow generating fresh artifacts. If you compile to refresh artifacts, treat the generated `.trails` files as evidence and clean them up unless the branch intentionally owns them.

## Symbol Navigation

Trails keeps a repository-level Serena project configuration at `.serena/project.yml`. Serena is the default symbolic navigation path for agents because it provides TypeScript LSP-backed tools for symbol search, references, declarations, diagnostics, and rename support without requiring a paid IDE plugin or machine-local absolute paths.

## Default Symbol Tool: Serena

Install the Serena CLI once from the same upstream source path used for local verification:

```bash
uv tool install -p 3.13 --from git+https://github.com/oraios/serena serena
serena init
```

For Codex CLI/App, current Serena docs recommend user-level MCP configuration:

```toml
[mcp_servers.serena]
startup_timeout_sec = 15
command = "serena"
args = ["start-mcp-server", "--project-from-cwd", "--context=codex"]
```

For clients that accept a per-workspace stdio MCP launch command, use the same project-bound server:

```bash
serena start-mcp-server --context=ide --project /absolute/path/to/trails
```

If installing Serena globally is not desirable, `uvx` can run the current source version directly:

```bash
uvx -p 3.13 --from git+https://github.com/oraios/serena serena start-mcp-server --project-from-cwd --context=codex
```

The `uvx` path is useful for one-off setup, but the installed `serena` command is preferred for regular work because a live GitHub source run may resync and slow MCP startup.

## Local Verification

Verified on 2026-05-06 against the upstream Serena docs and local CLI:

```bash
uvx -p 3.13 --from git+https://github.com/oraios/serena serena --help
uvx -p 3.13 --from git+https://github.com/oraios/serena serena start-mcp-server --help
uvx -p 3.13 --from git+https://github.com/oraios/serena serena tools list --all
uvx -p 3.13 --from git+https://github.com/oraios/serena serena project health-check .
```

The health check passed with the LSP backend, started the TypeScript language server, used the workspace TypeScript version, and exercised `get_symbols_overview`, `find_symbol`, `find_referencing_symbols`, and text search. The available tool list includes the expected `find_symbol` and `find_referencing_symbols` tools.

## Fallback: mcp-language-server

Use `mcp-language-server` only when Serena is unavailable or a client needs a smaller tool surface. Current upstream setup requires both the Go MCP server and the TypeScript language server:

```bash
go install github.com/isaacphi/mcp-language-server@latest
npm install -g typescript typescript-language-server
mcp-language-server --workspace /absolute/path/to/trails --lsp typescript-language-server -- --stdio
```

This fallback exposes definition, references, diagnostics, hover, and rename tools, but it does not use `.serena/project.yml`, Serena contexts, or Serena's project workflow. Prefer Serena for the default Trails agent experience.

## Notes

- Do not commit machine-local client config such as `~/.codex/config.toml`.
- Use absolute project paths in client config when the client does not launch
  MCP servers from the repository root.
- Keep `.serena/project.local.yml`, `.serena/cache/`, and `.serena/logs/` local.
- If a client starts in a global context, activate the Trails project before
  relying on symbol tools.
