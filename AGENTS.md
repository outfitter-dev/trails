# AGENTS.md

Primary instruction file for agents working in the Trails monorepo.

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

Trails is an agent-native, contract-first TypeScript framework. Define a trail once with typed input, `Result` output, examples, and metadata, then surface it on CLI, MCP, HTTP, or WebSocket.

The architecture is designed to make consistency easier than drift. Agents building with Trails should naturally produce aligned surfaces. Agents consuming Trails apps should be able to inspect contracts, examples, schemas, and errors at runtime without guessing.

## Core Principles

1. **The trail is the product.** Surfaces are renderings of the trail contract, not separate implementations.
2. **One schema, one Result model, one error taxonomy.** Drift across surfaces should be structurally difficult.
3. **Surfaces are peers.** CLI, MCP, HTTP, and WebSocket are equal adapters over the same topo.
4. **Framework packages define ports.** Concrete UX and runtime libraries belong in apps or dedicated adapter subpaths, not in the base framework packages.
5. **Implementations are pure.** Input in, `Result` out. No `process.exit()`, no `console.log()`, no surface-specific request objects in domain logic.
6. **Validate at the boundary, trust internally.** Zod validates before implementations run.
7. **Derive by default, override deliberately.** Names, flags, and tool definitions should come from the trail contract unless there is a clear reason not to.
8. **Examples are tests.** Trail examples serve both agent guidance and happy-path validation.
9. **The contract is queryable at runtime.** Topo, survey, and guide exist so agents and tooling can inspect the system directly.
10. **Trails is Bun-native.** Use Bun where it improves the developer experience. The surfaces Trails produces remain universally consumable.

## Vocabulary

Use the project language consistently:

- `trail`, not action or handler
- `implementation`, not handler or impl
- `topo`, not registry or collection
- `follow`, not route (for composition declaration and runtime invocation)
- `blaze`, not serve or mount
- `surface`, not transport or adapter
`mount` is reserved for cross-app composition. See `docs/vocabulary.md` for the full vocabulary guide.

## Trail Rules

- Implementations return `Result`, never throw.
- Use `Result.ok()` and `Result.err()` to construct outcomes.
- Branch on results with `isOk()`, `isErr()`, or `match()`.
- Keep `TrailContext` and implementations surface-agnostic. Do not import `Request`, `Response`, `McpSession`, or similar surface types into trail logic.
- Trails with `follow` compose through `ctx.follow()`, never by calling another trail's `.implementation()` directly.
- Keep `follow` declarations aligned with actual `ctx.follow()` usage.
- Every trail exposed on MCP or HTTP surfaces must define an `output` schema.
- Use `metadata` for annotations and ownership data.
- Use `detours` for recovery strategies instead of inline retry logic.
- Prefer the most specific `TrailsError` subclass available.
- Keep error taxonomy behavior aligned across surfaces so CLI, HTTP, and JSON-RPC mappings stay coherent.

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
