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
- `trails compile` writes committed topo artifacts.
- `trails validate` checks committed topo artifacts for drift.
- `trails wayfind overview` and adjacent `trails wayfind ...` commands read
  saved topo artifacts through Wayfinder for local graph navigation.
- `trails warden` runs Trails governance checks for contract and architecture drift.
- `trails guide` shows available trails and examples from a project.

Trails is contract-first: define trails once with typed input, Result output, examples, and meta; the framework derives CLI, MCP, HTTP, and future surfaces from the same contracts.

See the main Trails documentation for the full framework guide:
<https://github.com/outfitter-dev/trails>
