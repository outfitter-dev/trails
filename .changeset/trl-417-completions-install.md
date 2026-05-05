---
'@ontrails/trails': minor
---

Add `trails completions install [--shell bash|zsh|fish]` for installing the completion script to the standard per-shell location. This is a CLI bridge command, not a topo trail: it uses `renderCompletionScript`, auto-detects `$SHELL` when `--shell` is omitted, creates parent directories as needed, and writes to:

- bash → `~/.local/share/bash-completion/completions/trails`
- zsh → `~/.local/share/zsh/site-functions/_trails` (user must add to `$fpath` if not already)
- fish → `~/.config/fish/completions/trails.fish`

Output reports `{ shell, path, created, message }`. Idempotent — second run reports `created: false` and overwrites with the freshest script. Detection failure (missing/unsupported `$SHELL`) returns `Result.err(ValidationError)` with a message naming the supported shells. Test seam allows injecting `homeDir` and `shellEnv` so the trail never mutates global state.
