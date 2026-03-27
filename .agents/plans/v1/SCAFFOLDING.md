# Trails — Project Scaffolding

## Source Control and Project Management

**Graphite** for stacked PRs. Same workflow as Outfitter — `gt create`, `gt submit --stack`, `gt merge`. Each stage of the build plan is a stack or series of stacks.

**Linear** for issue tracking. Team: **TRL**. Issues map to stages:

- `TRL-*` issues for each stage's deliverables
- Milestone per stage (00-09)
- Labels: `stage:00`, `stage:01`, etc. for filtering

**Branch naming:** `feat/trl-NNN/short-description` or Graphite auto-naming.

**Commits:** Conventional commits with scopes matching package names:

```
feat(core): implement Result type
feat(cli): add flag derivation from Zod schemas
feat(warden): add no-throw-in-implementation rule
fix(mcp): handle missing output schema gracefully
```

---

## Agent Setup

### CLAUDE.md / AGENTS.md

Set up from day one. The Trails repo needs its own agent instructions — not a copy of Outfitter's, but informed by what works there.

**CLAUDE.md** — points to AGENTS.md (same pattern as Outfitter).

**AGENTS.md** should cover:

- Project overview (what Trails is, the vocabulary)
- Package structure and tiers
- Commands (build, test, lint, typecheck)
- The `trail()` / `trailhead()` / `blaze()` pattern
- Architecture (hexagonal, adapters, core)
- Development principles (TDD, Result types, no throw)
- Code style (strict TypeScript, oxfmt)
- Git workflow (Graphite, conventional commits)
- Testing conventions
- Key files and docs

### `.claude/` directory

Evaluate what carries from Outfitter's `.claude/` setup:

| From Outfitter | Carry to Trails? | Notes |
| --- | --- | --- |
| `rules/graphite.md` | Yes | Same Graphite workflow |
| `rules/linear.md` | Yes, update team to TRL | Same Linear workflow |
| `rules/tsdoc.md` | Yes | Same TSDoc conventions |
| `rules/tooling-testing.md` | No | Outfitter-specific |
| `settings.json` permissions | Evaluate | May need different tool permissions |
| Hook configurations | Evaluate | Pre-commit/pre-push hooks will differ |

### Warden rules as `.claude/rules/`

The warden lint rules should also be surfaced as Claude Code rules so agents internalize the patterns before warden enforces them:

```markdown
# .claude/rules/trails-conventions.md

## Trail Conventions

- Implementations return Result, never throw
- TrailContext must not import surface-specific types (Request, Response, McpSession)
- Routes use ctx.follow(), never direct .implementation() calls
- Every trail on MCP or HTTP surfaces must have an output schema
- follows declarations must match actual ctx.follow() usage
- Use markers for metadata, not ad-hoc properties
- Use detours for error recovery, not inline retry logic
```

This way agents learn the conventions before warden catches violations. Prevention over correction.

---

## Runtime: Bun Workspace, Runtime-Agnostic Packages

The Trails repo is a **Bun workspace**. `bun:test`, `bun run`, `bun.lock`, `.bun-version`. This is how Trails is developed, tested, and built.

But published packages (`@ontrails/core`, `@ontrails/cli`, etc.) are **runtime-agnostic**. No `Bun.*` APIs, no `bun:*` imports. They work on Node, Deno, Bun, and edge runtimes. See ARCHITECTURE.md for the full runtime strategy.

Ecosystem packages (`@ontrails/index-sqlite`, the Trails CLI app) CAN use Bun-specific APIs where they provide clear advantages. These explicitly declare their runtime requirement.

---

## What Carries from Outfitter (Proven Infrastructure)

The Outfitter monorepo has 14 runtime packages with extensive custom tooling. Much of it is proven and should carry forward — simplified for fewer packages.

### Carry as-is

| Infrastructure | What | Why |
| --- | --- | --- |
| **TypeScript strict config** | `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `verbatimModuleSyntax` | These flags catch real bugs. Same flags, day one. |
| **Ultracite** (oxlint + oxfmt) | Same versions, same formatter config | Proven linting and formatting. `experimentalSortImports` works well. |
| **Lefthook** | Pre-commit: format + lint with `stage_fixed: true`. Pre-push: test + typecheck | The two-hook pattern is solid. Auto-fix on commit, verify on push. |
| **Changesets** | Standard config, `commit: false`, `baseBranch: main` | Immediate value, minimal setup. |
| **Turbo** | Build orchestration with parallel execution | Scales from 6 to 50+ packages. Use from day one. |
| **Export normalization** | `normalize-exports.ts` — alphabetizes exports, strips internals, auto-adds config exports | Recently merged in Outfitter. Reduces manual maintenance. Worth adopting early. |
| **Graphite workflow** | `gt` everywhere, no raw `git` | Same workflow, same rules. |

### Carry simplified

| Infrastructure | Outfitter | Trails v1 |
| --- | --- | --- |
| **Build** | Turbo + bunup across 14 packages with registry system | Turbo + `tsc` with `declaration: true`. Bunup only if tree-shaking becomes a concern. |
| **CI** | 8 jobs, 4 test shards, OOM retry, remote cache with signatures | Single build + single test job + lint-typecheck. Add shards when test suite grows. |
| **Oxlint rules** | 15 custom rules in `packages/oxlint-plugin` | Global `.oxlintrc.json` with standard rules. Warden ships custom rules in stage 06. |
| **Surface.lock** | Schema drift detection in pre-push | Defer until CLI/MCP surface shapes stabilize. Add when schema package ships (stage 07). |
| **Pre-push verification** | Custom `outfitter check --pre-push` orchestrator | Simpler: `bun run test && bun run typecheck && bun run lint`. Warden checks added in stage 06. |

### Don't carry

| Infrastructure | Why not |
| --- | --- |
| **bunup registry system** | Outfitter-specific complexity for managing 14 package builds |
| **Test shard configuration** | 10 packages don't need shard distribution |
| **Custom pre-push orchestrator** | Overkill for fewer packages |
| **Block drift detection** | Outfitter-specific file copying pattern |
| **Canary publishing workflow** | Add when Trails has real consumers |
| **CI self-healing** (auto-regenerate surface.lock) | Defer to after surface.lock ships |

---

## Monorepo Structure

```
trails/
├── packages/
│   ├── core/                # @ontrails/core
│   ├── cli/                 # @ontrails/cli + /commander subpath
│   ├── mcp/                 # @ontrails/mcp
│   ├── logging/             # @ontrails/logging + /logtape subpath
│   ├── testing/             # @ontrails/testing
│   ├── warden/              # @ontrails/warden (oxlint plugin + governance CLI)
│   └── schema/              # @ontrails/schema
├── apps/
│   ├── trails/              # trails CLI
│   └── trails-demo/         # example app
├── scripts/
│   └── normalize-exports.ts # Export normalization (carry from Outfitter)
├── .claude/
│   ├── rules/
│   │   ├── graphite.md      # Graphite workflow rules
│   │   ├── linear.md        # Linear workflow (team: TRL)
│   │   ├── tsdoc.md         # TSDoc conventions
│   │   └── trails-conventions.md  # Trails-specific conventions
│   └── settings.json
├── .changeset/
│   └── config.json          # Changesets config
├── .oxlintrc.json           # Global oxlint config
├── .oxfmtrc.jsonc           # oxfmt formatting config
├── lefthook.yml             # Git hooks
├── turbo.json               # Turbo build config
├── tsconfig.json            # Shared strict TypeScript config
├── package.json             # Workspace root
├── bun.lock
├── .bun-version
├── AGENTS.md
├── CLAUDE.md
└── README.md
```

### Package template

Each package follows the same structure:

```
packages/core/
├── src/
│   ├── index.ts             # barrel export
│   ├── *.ts                 # implementation files
│   └── __tests__/
│       └── *.test.ts        # tests alongside code
├── package.json
└── tsconfig.json            # extends root
```

### Workspace config

```json
{
  "name": "trails",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "tsc -b packages/*/tsconfig.json",
    "test": "bun test",
    "lint": "oxlint .",
    "typecheck": "tsc --noEmit",
    "check": "bun run lint && bun run typecheck"
  }
}
```

### Package.json per package

```json
{
  "name": "@ontrails/core",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./patterns": "./src/patterns/index.ts",
    "./redaction": "./src/redaction/index.ts"
  },
  "peerDependencies": {
    "zod": "^3.23.0"
  }
}
```

**Note:** During development, exports point to `.ts` source files directly (Bun resolves them). For publishing, a build step compiles to `.js` + `.d.ts` and the exports map changes to `./dist/index.js`.

---

## Versioning

All packages start at `0.1.0`. Changesets for coordinated versioning. Canary releases from `main`. Stable releases via manual workflow.

---

## What We Carry From Outfitter

| Concern | What we take | What we leave |
| --- | --- | --- |
| TypeScript config | Strict flags (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.) | Custom path aliases |
| Testing | bun:test, snapshot conventions | Shard-based distribution |
| Linting | oxlint with standard rules | Custom oxlint plugin (comes later) |
| Formatting | oxfmt | — |
| Git hooks | Lefthook (pre-commit: format+lint, pre-push: test+typecheck) | Complex pre-push orchestration |
| Changesets | Standard changeset workflow | CI self-healing, canary publishing (add later) |
| Source control | Graphite for stacked PRs | — |
