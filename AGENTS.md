# AGENTS.md

Our primary fieldguide for agents working in on the Trails project.

## Commands

Use repo scripts first:

```bash
bun run build
bun run test
bun run lint
bun run typecheck
bun run check
bun run clean
bun run format:check
bun run format:fix
```

Inside a package or app, use the local scripts:

```bash
bun run build
bun test
bun run typecheck
bun run clean
```

For direct local lint and format validation, prefer `bunx ultracite check` and `bunx ultracite fix`.

## Project Overview

Trails is an agent-native, contract-first TypeScript framework. Define a trail once with typed input, `Result` output, examples, and metadata, then trailhead it on CLI, MCP, HTTP, or WebSocket.

The architecture is designed to make consistency easier than drift. Agents building with Trails should naturally produce aligned trailheads. Agents consuming Trails apps should be able to inspect contracts, examples, schemas, and errors at runtime without guessing.

## Project Documentation

1. Contracts are at the core of how Trails works, and the contract for how Trails is worked on is governed by our [Tenets](docs/tenets.md).
2. Decisions that define what Trails is, and what it is not, are defined by our [ADRs](docs/adr/README.md).
   - Future directions for Trails are outlined in speculative or [draft ADRs](docs/adr/drafts/README.md).
3. We keep a log of our working notes, session recaps, learnings, etc. in `.agents/notes/` (gitignored — local only) as a historical record of our journey.

## Vocabulary

Use the project language consistently:

- `trail`, not action or handler
- `implementation`, not handler or impl
- `topo`, not registry or collection
- `cross`, not follow (for composition declaration and runtime invocation)
- `blaze`, not serve or mount
- `trailhead`, not transport terminology
- `provision`, not service or dependency
- `gate`, not layer
`mount` is reserved for cross-app composition. See `docs/vocabulary.md` for the full vocabulary guide.

## Trail Rules

- Implementations return `Result`, never throw.
- Use `Result.ok()` and `Result.err()` to construct outcomes.
- Branch on results with `isOk()`, `isErr()`, or `match()`.
- Keep `TrailContext` and implementations trailhead-agnostic. Do not import `Request`, `Response`, `McpSession`, or similar trailhead types into trail logic.
- Trails with `crosses` compose through `ctx.cross()`, never by calling another trail's `.implementation()` directly.
- Keep `crosses` declarations aligned with actual `ctx.cross()` usage.
- Every trail exposed on MCP or HTTP trailheads must define an `output` schema.
- Use `metadata` for annotations and ownership data.
- Use `detours` for recovery strategies instead of inline retry logic.
- Prefer the most specific `TrailsError` subclass available.
- Keep error taxonomy behavior aligned across trailheads so CLI, HTTP, and JSON-RPC mappings stay coherent.
- Trails that use external dependencies declare them with `provisions: [...]`.
- Access provisions through `db.from(ctx)` or `ctx.provision()`, never by constructing dependencies inline.
- Keep `crosses` declarations for composition and `provisions` declarations for infrastructure — they serve different purposes.
- Every provision should define a `mock` factory so `testAll(app)` works without configuration.

## Shared Conventions

Shared TSDoc and code-shape guidance for packages and apps lives in [`.claude/rules/coding-conventions.md`](.claude/rules/coding-conventions.md). `apps/AGENTS.md` and `packages/AGENTS.md` point there.

## Workflow

Use Graphite for source control operations.

| Instead of               | Use           |
| ------------------------ | ------------- |
| `git checkout -b`        | `gt create`   |
| `git commit --amend`     | `gt modify`   |
| `git push`               | `gt submit`   |
| `git pull` / `git fetch` | `gt sync`     |
| `git checkout`           | `gt checkout` |

- `git status` and `git diff` are the normal read-only exceptions.
- We use Conventional Commits.
- Keep PRs small, isolate mechanical changes when possible, and keep PRs in draft until CI is green.
- When performing fixes across stacked branches, always do so from the top most branch and use `gt absorb -a`

## Subagent Rules

Subagents must not perform `git` or `gt` write operations. Only the main agent handles source control.

- Subagents can write and edit files.
- Subagents can run tests and lint checks.
- Subagents can report results.
- Subagents do not run `gt create`, `gt add`, `gt modify`, or `gt submit`.
- Subagents do not run `git add`, `git commit`, or `git push`.
- Subagents do not create branches, make commits, or push anything.
- The main agent collects subagent work and commits it.

## Releasing

All `@ontrails/*` packages are versioned in lockstep using [Changesets](https://github.com/changesets/changesets) in pre-release (`beta`) mode. We use Changesets only for versioning and changelogs — **not** `changeset publish`. Publishing goes through `bun publish` via our script, which correctly resolves `workspace:^` to real versions (npm publish does not).

```bash
# 1. Add a changeset (or create .changeset/<name>.md manually)
bunx changeset add

# 2. Version
bunx changeset version

# 3. Commit, push, publish
git add -A && git commit -m "chore: version packages to 1.0.0-beta.N"
git push
bun run publish:packages
```

To exit pre-release mode for a stable release: `bunx changeset pre exit`, then version as usual.

## Testing

- `bun:test` is the test runner.
- Follow TDD when the work is substantial: red, green, refactor.
- Trail examples are the happy-path tests. Add focused tests for edge cases, error paths, and integrations when examples are not enough.

## Reference Docs

- `docs/getting-started.md`
- `docs/architecture.md`
- `docs/vocabulary.md`
- `docs/why-trails.md`
- `docs/testing.md`

## Linear

- Team: `TRL`
- Team ID: `97523b42-84f2-4cea-bd70-22b245cc3f59`
- Branch naming: `trl-NNN-<linear-title>` when working from a Linear issue
