# Trails Dev Plugin

Contributor guidance for building and maintaining Trails itself.

This source owns portable framework contributor workflows. Skillset 0.27.0
renders a Claude plugin package at `plugin-dev` and a portable Agent Plugins
package at `plugins/trails-dev/agents`.

The Trails repository currently pins Skillset 0.27.0. That release writes
every plugin-owned skill into the repository's provider skill roots, so these
skills remain locally discoverable without a duplicate source tree. Selective
`plugins.internal_use` configuration belongs to a later Skillset release and
must not be added while 0.27.0 rejects that root key.

Project agents and the workflows that require those agents remain rooted in
`.skillset/agents` and `.skillset/skills`. The plugin does not claim those
project-only components.

Run generation and drift checks from the repository root:

```bash
bun run skillset:sync
bun run skillset:check
bun run skillset:ownership
bun run skillset:parity
```

Do not edit generated copies under `.agents`, `.claude`, `plugin`, or
`plugins`.
