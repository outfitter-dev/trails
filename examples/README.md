# Trails Showcase Suite

Five showcase apps, each with one hero capability, at least two surfaces, and a one-sentence explanation a stranger understands. Together they cover the entire primitive set and serve as public showcases, forkable scaffolding for adopters, and a standing dogfood corpus.

Each app lives in `examples/<name>/` and is built in its own run, confined to its own directory. The workspaces here start as placeholders so `bun.lock` takes the workspace-membership churn once, before the parallel builds begin.

## The lineup

| App | One-liner | Hero |
| --- | --------- | ---- |
| `packlist` | Gear & trip checklists | entities, store, CRUD factory, versioning, store signals |
| `junction` | Self-hosted webhook relay | HTTP at full strength: webhooks, permits/JWT, error taxonomy, OpenAPI |
| `switchback` | Feature flags | the library surface — one contract as import, command, and tool |
| `stash` | Self-hosted Gists (the mega app) | breadth: revisions/forks, permits, search, trailheads, MCP-first |
| `lookout` | Uptime monitor & status page | activation (cron), signals, detours, compose, observe/tracing |

## Shared conventions (every app)

- Lives in-repo under `examples/<name>` as a `private: true` workspace — never published, excluded from publish discovery, lockstep versioning, and changeset requirements.
- `testAll(app)` green with every resource mocked.
- Committed `trails.lock`.
- Warden-clean (0 errors) and Wayfinder-navigable.
- README opens with a "what this showcases" matrix plus a quickstart that actually runs — usable end-to-end is the exit criterion, not "compiles".
- Current-live vocabulary only.
- Each app is roughly 15–25 trails, except `stash` (the deliberate kitchen sink and standing mega-dogfood).

### The showcase-matrix README pattern

Every app README opens with a table mapping framework capabilities to where the app exercises them, so a reader can jump from "I want to see signals" straight to the file that shows them. The quickstart that follows must run as written.

## Hard rule for app builds

An app build run may **not** modify `packages/*`, `adapters/*`, or root config. Framework bugs or gaps found while building are the dogfood payoff — file them as issues (plus fieldwork notes) and work around, or hand the fix to a separate small branch. This keeps app PRs reviewable and framework changes changeset'd.

Because app builds cannot touch framework surfaces, the wayfinder-dogfood smoke (`bun run wayfinder:dogfood`) is normally not applicable to example-only PRs — say so in the PR. A framework fix spun out to its own branch follows the usual rules, including wayfinder-dogfood when it changes framework surfaces.

## CI

Example workspaces run in the normal gates: turbo picks up `build`, `test`, `typecheck`, and `lint` from each example's package scripts, and `bun run check` covers the repo-wide checks. An example app never needs a changeset; the release check only tracks publishable `@ontrails/*` workspaces.
