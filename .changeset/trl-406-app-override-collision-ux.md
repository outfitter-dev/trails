---
'@ontrails/trails': minor
---

Wire workspace topo discovery into the `run` trail with collision UX. `run` accepts an optional `app?: string` input that auto-projects as `--app <name>` on the CLI. Resolution flow: `--app` provided → use it; else if the trail ID is unambiguous in the workspace index → use the single owning app; else if colliding → return `Result.err(AmbiguousError)` whose message names the candidates and suggests `--app`. The CLI surface adds a TTY-aware bridge (`tryRecoverFromRunCollision`) that prompts via clack when stdin is a TTY and the trail returned an `AmbiguousError`, then re-executes with the chosen app. Non-TTY contexts surface the error and exit with code 1. Trail logic stays surface-agnostic; TTY detection and prompts live in the CLI bridge.
