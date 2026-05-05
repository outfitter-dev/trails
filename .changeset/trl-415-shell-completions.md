---
'@ontrails/trails': minor
---

Add shell completion infrastructure and trail-ID completion. New `apps/trails/src/completions.ts` exposes `renderCompletionScript('bash' | 'zsh' | 'fish', binName)` and `renderTrailIdCompletions(workspaceRoot, prefix)` (reads the workspace topo via `buildWorkspaceTrailIndex`). Two new trails register on the topo: `completions` (returns the completion script for a chosen shell) and `completions.__complete` (the dynamic suggestion endpoint that the static script delegates to at tab-press time). Per-shell logic lives in a `Record<CompletionShell, ScriptRenderer>` lookup; the dynamic dispatch table is keyed by subcommand so TRL-416 (example-name completion) lands as a new entry.
