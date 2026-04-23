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
For pinned formatter runs, prefer `bun run format:check`, `bun run format:fix`, or `bunx ultracite ...` over invoking the binary by a direct `node_modules/.bin` path. Bun sets up `node_modules/.bin` on `PATH`, which lets `ultracite` resolve sibling tools like `oxfmt` and `oxlint`.

## Project Overview

Trails is an agent-native, contract-first TypeScript framework. Define a trail once with typed input, `Result` output, examples, and metadata, then surface it on CLI, MCP, HTTP, or WebSocket.

The architecture is designed to make consistency easier than drift. Agents building with Trails should naturally produce aligned surfaces. Agents consuming Trails apps should be able to inspect contracts, examples, schemas, and errors at runtime without guessing.

## Project Documentation

`AGENTS.md` is the canonical project guidance file. Tool-specific compatibility files such as `CLAUDE.md` should stay as thin pointers here plus any tool-bootstrap-specific notes.

1. Contracts are at the core of how Trails works, and the contract for how Trails is worked on is governed by our [Tenets](docs/tenets.md).
2. Decisions that define what Trails is, and what it is not, are defined by our [ADRs](docs/adr/README.md).
   - Future directions for Trails are outlined in speculative or [draft ADRs](docs/adr/drafts/README.md).
3. We keep a log of our working notes, session recaps, learnings, etc. in `.agents/notes/` (gitignored — local only) as a historical record of our journey.

## Lexicon

Use the project language consistently:

- `trail`, not action or handler
- `blaze`, not handler or impl (the implementation field on a trail)
- `topo`, not registry or collection
- `cross`, not follow (for composition declaration and runtime invocation)
- `surface`, not transport terminology (the API function and user-facing noun)
- `resource`, not service or dependency
- `layer`, not middleware

`mount` is reserved for cross-app composition. See `docs/lexicon.md` for the full lexicon.

## Trail Rules

- Implementations return `Result`, never throw.
- Use `Result.ok()` and `Result.err()` to construct outcomes.
- Branch on results with `isOk()`, `isErr()`, or `match()`.
- Keep `TrailContext` and implementations surface-agnostic. Do not import `Request`, `Response`, `McpSession`, or similar surface types into trail logic.
- Trails with `crosses` compose through `ctx.cross()`, never by calling another trail's `.implementation()` directly.
- Keep `crosses` declarations aligned with actual `ctx.cross()` usage.
- Every trail exposed on MCP or HTTP surfaces must define an `output` schema.
- Use `metadata` for annotations and ownership data.
- Use `detours` for recovery strategies instead of inline retry logic.
  - **Narrow factory carve-out.** Detours execute at runtime. Factory-built trails such as the store's `reconcile` factory (`packages/store/src/trails/reconcile.ts`) may still keep a tightly-scoped inline recovery bridge when the current detour model cannot yet express the required store-specific behavior. Prefer detours first; treat inline recovery as a local exception, not the default pattern.
- Prefer the most specific `TrailsError` subclass available.
- Keep error taxonomy behavior aligned across surfaces so CLI, HTTP, and JSON-RPC mappings stay coherent.
- Trails that use external dependencies declare them with `resources: [...]`.
- Access resources through `db.from(ctx)` or `ctx.resource()`, never by constructing dependencies inline.
- Keep `crosses` declarations for composition and `resources` declarations for infrastructure — they serve different purposes.
- Every resource should define a `mock` factory so `testAll(app)` works without configuration.

## Draft State

- `_draft.` is the reserved marker for draft IDs.
- Files whose primary purpose is draft-authored state should use the `_draft.` prefix.
- Otherwise-normal files that contain draft-authored state should use a `.draft.` trailing segment before the extension.
- Draft-authored state is visible debt. It must never leak into established surfaces, topo exports, committed lockfiles, or other established outputs.
- Prefer the built-in promotion workflow when moving draft state into the established graph instead of hand-editing large batches of references.

## Shared Conventions

Shared TSDoc and code-shape guidance for packages and apps lives in [`.claude/rules/coding-conventions.md`](.claude/rules/coding-conventions.md). `apps/AGENTS.md` and `packages/AGENTS.md` should remain thin pointers there plus any small local overrides.

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
- Treat a Greptile error comment (`Greptile encountered an error while reviewing this PR`) as a blocker, not as a completed review.
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

Each package's main `tsconfig.json` excludes test files so build output stays clean. A sibling `tsconfig.tests.json` includes them so editors' LSP can resolve tests (e.g. `Array.prototype.toSorted`). Neither affects the `tsc --noEmit` CI gate, which still uses the main config.

## Reference Docs

- `docs/getting-started.md`
- `docs/architecture.md`
- `docs/lexicon.md`
- `docs/why-trails.md`
- `docs/testing.md`

## Linear

- Team: `TRL`
- Team ID: `97523b42-84f2-4cea-bd70-22b245cc3f59`
- Branch naming: `trl-NNN-<linear-title>` when working from a Linear issue
