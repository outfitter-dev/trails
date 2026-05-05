---
'@ontrails/trails': minor
---

Add the `run` trail family to `apps/trails` for direct trail invocation by ID. `trails run <id> '<inline-json>'` resolves the trail in the current app's topo and executes it through the shared `run()` pipeline from `@ontrails/core`, returning a typed direct-invocation envelope. `run.examples` lists authored examples and `run.example` executes one named example with an actual-vs-expected comparison. Single-app resolution only on this branch; multi-app workspace resolution plus `--app` override land in TRL-406. Not-found maps to `Result.err(NotFoundError)` and CLI exit code 2 via the existing error taxonomy. Self-hosted: the trail family authors happy-path and not-found examples, exercised by `testExamples(app)`.
