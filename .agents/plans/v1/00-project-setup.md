# Stage 00 -- Project Scaffolding

> Scaffold the Trails monorepo with workspace config, TypeScript, linting, formatting, testing, CI, git hooks, changesets, and agent instructions.

---

## Prerequisites

- Bun installed (pin version in `.bun-version`)
- GitHub repo created (`ontrails` or similar)
- Graphite CLI installed (`gt`)

---

## 1. Repository Root

### 1.1 Directory structure

```
trails/
├── packages/           # @ontrails/* packages
├── apps/               # Runnable applications
├── scripts/
│   └── normalize-exports.ts
├── .claude/
│   └── rules/
├── .changeset/
├── .github/
│   └── workflows/
├── package.json
├── tsconfig.json
├── turbo.json
├── lefthook.yml
├── .oxlintrc.json
├── .oxfmtrc.jsonc
├── .bun-version
├── .gitignore
├── AGENTS.md
├── CLAUDE.md
└── README.md
```

Create the empty directories:

```bash
mkdir -p packages apps scripts .claude/rules .changeset .github/workflows
```

### 1.2 `.bun-version`

Pin to the current stable Bun release:

```
1.2.8
```

### 1.3 `.gitignore`

```gitignore
node_modules/
dist/
.turbo/
*.tsbuildinfo
bun.lock
.DS_Store
```

### 1.4 Root `package.json`

```json
{
  "name": "trails",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "oxlint .",
    "format:check": "ultracite --check",
    "format:fix": "ultracite",
    "typecheck": "turbo run typecheck",
    "check": "bun run lint && bun run format:check && bun run typecheck",
    "clean": "turbo run clean --no-cache && rm -rf node_modules"
  },
  "devDependencies": {
    "@changesets/cli": "^2.27.0",
    "lefthook": "^1.6.0",
    "turbo": "^2.0.0",
    "typescript": "^5.7.0",
    "ultracite": "^4.0.0",
    "oxlint": "^0.16.0"
  },
  "catalog": {
    "zod": "^3.24.0"
  }
}
```

Use Bun workspace catalogs to pin shared dependency versions. Packages reference `"zod": "catalog:"` in their `peerDependencies`.

Run `bun install` to generate `bun.lock`.

---

## 2. TypeScript Configuration

### 2.1 Root `tsconfig.json`

Strict mode with all the safety flags from the Outfitter stack:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
    "verbatimModuleSyntax": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "exclude": ["node_modules", "dist"]
}
```

Every flag listed explicitly. These catch real bugs:

- `noUncheckedIndexedAccess` -- forces handling `undefined` on index access
- `exactOptionalPropertyTypes` -- distinguishes `undefined` from missing
- `noPropertyAccessFromIndexSignature` -- forces bracket notation for index signatures
- `verbatimModuleSyntax` -- requires explicit `type` imports

### 2.2 Per-package `tsconfig.json`

Each package extends root:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

---

## 3. Turbo Configuration

### 3.1 `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "cache": false
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "clean": {
      "cache": false
    },
    "lint": {}
  }
}
```

Build uses `tsc` (not bunup). Evaluate bunup only if tree-shaking becomes a concern. For now, `tsc` with `declaration: true` is sufficient.

Each package needs a `build` script in its `package.json`:

```json
{
  "scripts": {
    "build": "tsc -b",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist *.tsbuildinfo"
  }
}
```

---

## 4. Linting and Formatting

### 4.1 `.oxlintrc.json`

Start with standard rules. Custom Trails rules (warden) come in stage 06.

```json
{
  "$schema": "https://raw.githubusercontent.com/nicolo-ribaudo/oxc/oxlintrc-schema/npm/oxlintrc.schema.json",
  "rules": {
    "no-unused-vars": "warn",
    "no-console": "warn",
    "eqeqeq": "error"
  }
}
```

### 4.2 `.oxfmtrc.jsonc`

```jsonc
{
  // oxfmt configuration
  "experimentalSortImports": true
}
```

### 4.3 Ultracite

Ultracite wraps oxlint + oxfmt. No additional config file needed -- it reads `.oxlintrc.json` and `.oxfmtrc.jsonc`.

The `format:check` and `format:fix` scripts in root `package.json` use `ultracite`.

---

## 5. Lefthook (Git Hooks)

### 5.1 `lefthook.yml`

```yaml
pre-commit:
  commands:
    format:
      glob: "*.{ts,tsx,js,jsx,json,jsonc}"
      run: bunx ultracite --check {staged_files} || bunx ultracite {staged_files}
      stage_fixed: true
    lint:
      glob: "*.{ts,tsx,js,jsx}"
      run: bunx oxlint {staged_files}
      stage_fixed: true

pre-push:
  commands:
    test:
      run: bun run test
    typecheck:
      run: bun run typecheck
```

Key details:

- **`stage_fixed: true`** on pre-commit -- auto-fix and re-stage. Format issues never block a commit; they get fixed automatically.
- **Pre-push runs full test suite and typecheck** -- catches breaking changes before they reach remote.
- Pre-push is intentionally simpler than Outfitter's orchestrator. No surface.lock checks (stage 07), no block drift (not applicable), no warden (stage 06).

Install hooks after `bun install`:

```bash
bunx lefthook install
```

---

## 6. Changesets

### 6.1 `.changeset/config.json`

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

- `commit: false` -- changesets are committed manually
- `access: "public"` -- packages publish to npm public registry
- `baseBranch: "main"` -- trunk-based development

---

## 7. CI Pipeline

### 7.1 `.github/workflows/ci.yml`

Single workflow, single job. Add shards when the test suite grows.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Read .bun-version
        id: bun-version
        run: echo "version=$(cat .bun-version)" >> "$GITHUB_OUTPUT"

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: ${{ steps.bun-version.version }}

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build
        run: bun run build

      - name: Lint
        run: bun run lint

      - name: Format check
        run: bun run format:check

      - name: Typecheck
        run: bun run typecheck

      - name: Test
        run: bun run test
```

Bun version is read from `.bun-version` for consistency between local and CI.

---

## 8. normalize-exports.ts Script

### 8.1 `scripts/normalize-exports.ts`

Carry from the Outfitter stack. This script:

1. Reads a package's `package.json`
2. Alphabetizes the `exports` map
3. Strips any internal-only exports (prefixed with `./internal`)
4. Auto-adds standard config exports if missing (e.g., `./package.json`)
5. Writes back the normalized `package.json`

Usage:

```bash
bun scripts/normalize-exports.ts packages/core
```

The implementation should:
- Parse `package.json` using `Bun.file()` and `JSON.parse()`
- Sort `exports` keys alphabetically
- Remove entries matching `./internal*`
- Ensure `"./package.json": "./package.json"` exists
- Write back with 2-space indentation and trailing newline
- Exit non-zero if the file was changed (useful for CI checks)

---

## 9. Agent Instructions

### 9.1 `CLAUDE.md`

```markdown
# CLAUDE.md

## Claude-Specific Instruction

- Unless otherwise specified, updates to this file should be made directly in `./AGENTS.md`.

## Agent Instructions

@AGENTS.md
```

### 9.2 `AGENTS.md`

The AGENTS.md should be a comprehensive guide for agents working in the repo. Structure it to cover:

- **Project overview** -- Trails is an agent-native, contract-first TypeScript framework. Define once, surface everywhere. The rest is on Trails.

- **Core principles** -- These must be in AGENTS.md so every agent internalizes them:
  1. The trail is the product, not the surface
  2. Drift is structurally harder than alignment
  3. Surfaces are peers, not primary and secondary
  4. The framework defines ports — everything concrete is an adapter
  5. Implementations are pure functions (input in, Result out)
  6. One schema, every surface
  7. Errors are data, not side effects (Result, not throw)
  8. Validate at the boundary, trust internally
  9. Examples are tests (write for agents, get test coverage free)
  10. Derive the default, override when it's wrong
  11. The contract is readable by machines at runtime
  12. Agent-native for building AND consuming
  13. Core is runtime-agnostic, ecosystem is Bun-first

- **Vocabulary** -- trail, route, trailhead, blaze, follow, topo, implementation, markers, detours, permit. Reference LANGUAGE.md for full vocabulary.
- **The pattern** -- `trail()` defines, `trailhead()` collects, `blaze()` surfaces.
- **Package structure** -- Core at center, surface adapters on the left (CLI, MCP), infrastructure adapters on the right (logging). Clean DAG, no cycles.
- **Commands** -- build, test, lint, typecheck, check, clean, format:check, format:fix
- **Development principles** -- TDD first, Result types not exceptions, strict TypeScript
- **Code style** -- Strict TypeScript (list the flags), oxfmt formatting, experimental sort imports
- **Git workflow** -- Graphite only (`gt` not `git`), conventional commits with package scopes (`feat(core):`, `fix(cli):`), trunk-based on `main`. Subagents do NOT perform git/gt operations.
- **Testing** -- bun:test, files in `src/__tests__/*.test.ts`, TDD red/green/refactor. Examples on trails ARE tests.
- **Key files** -- ARCHITECTURE.md, LANGUAGE.md, PLAN.md, phase implementation docs
- **Linear team** -- TRL

### 9.3 `.claude/rules/graphite.md`

Carry directly from the Outfitter stack's Graphite rules. Same `gt` workflow, same conventions. The content is already in the user's global rules but having it in-repo ensures consistency for all agents.

### 9.4 `.claude/rules/linear.md`

Carry from Outfitter, but update the team key to **TRL** (Trails). Same Linear workflow, same GraphQL patterns, same gotchas.

### 9.5 `.claude/rules/tsdoc.md`

Carry from Outfitter. Same TSDoc conventions -- types over comments, `@param`/`@returns` on public APIs, `@example` blocks for non-obvious usage.

### 9.6 `.claude/rules/trails-conventions.md`

Trails-specific rules for agents:

```markdown
# Trails Conventions

## Trail Conventions
- Implementations return Result, never throw
- TrailContext must not import surface-specific types (Request, Response, McpSession)
- Routes use ctx.follow(), never direct .implementation() calls
- Every trail on MCP or HTTP surfaces must have an output schema
- follows declarations must match actual ctx.follow() usage
- Use markers for metadata, not ad-hoc properties
- Use detours for error recovery, not inline retry logic

## Vocabulary
- Use "trail" not "action" or "handler"
- Use "implementation" not "handler" or "impl"
- Use "trailhead" not "registry" or "app factory"
- Use "blaze" not "serve" or "mount" (mount is reserved for cross-app)
- Use "follow" not "call" or "invoke" for trail-to-trail composition
- Use "topo" not "registry" or "collection" for the internal trail map
- Use "surface" not "transport" or "adapter" for CLI/MCP/HTTP
- Use "markers" not "metadata" or "annotations"

## Result Types
- All domain logic returns Result<T, Error>
- Use Result.ok() and Result.err() constructors
- Pattern match with result.match() or check result.isOk() / result.isErr()
- Never throw in implementations -- wrap errors with Result.err()
- Surface adapters handle the Result-to-transport mapping

## Error Taxonomy
- 13 error classes, 10 categories
- All extend TrailsError (direct class inheritance)
- Use the most specific error class (NotFoundError, not InternalError)
- Error categories map to exit codes, HTTP status, JSON-RPC codes
```

### 9.7 `.claude/settings.json`

Permissions and tool configuration for Claude Code in the Trails repo:

```json
{
  "permissions": {
    "allow": [
      "Bash(bun *)",
      "Bash(bunx *)",
      "Bash(gt *)",
      "Bash(gh *)",
      "Bash(oxlint *)",
      "Bash(ls *)",
      "Bash(cat *)",
      "Bash(wc *)",
      "Bash(rg *)"
    ]
  }
}
```

Start minimal. Add permissions as workflows emerge. Don't pre-allow destructive commands.

### 9.8 Build workflow (in AGENTS.md)

The following goes directly into AGENTS.md. CLAUDE.md's `@AGENTS.md` directive ensures Claude Code reads it. No need to duplicate into `.claude/rules/` — extract later if AGENTS.md grows too large.

```markdown
## Build Workflow

### Source Control

**Always `gt`, never `git`.** Every source control operation uses Graphite:
- `gt create` not `git checkout -b`
- `gt add .` not `git add .`
- `gt modify` not `git commit --amend`
- `gt submit` not `git push`
- `gt sync` not `git pull`
- `gt checkout` not `git checkout`

The only exception is `git status` and `git diff` for read-only inspection.

## Subagent Rules

**Subagents must NOT perform git/gt operations.** Only the main agent handles source control. Subagents:
- Write and edit files
- Run tests
- Run lint checks
- Report results

They do NOT:
- `gt create` / `gt add` / `gt modify` / `gt submit`
- `git add` / `git commit` / `git push`
- Create branches, make commits, or push anything

The main agent collects subagent work and commits it.

## Stack Structure

Each stage of the build plan is one or more Graphite stacks:

- Stage 00 (scaffolding) → single PR
- Stage 01 (core) → may be multiple stacked PRs by subsystem:
  - `feat/trl-NNN/core-result-errors` (Result + error taxonomy)
  - `feat/trl-NNN/core-trail-definitions` (trail/route/event/trailhead)
  - `feat/trl-NNN/core-patterns` (patterns subpath)
  - `feat/trl-NNN/core-types-validation` (branded types, guards, validation)
- Stage 02 (cli) → 1-2 PRs
- etc.

Keep PRs ~100-250 effective LOC where possible. Split larger stages into logical units.

## Commit Conventions

Conventional commits with package scopes:
```
feat(core): implement Result type with Ok/Err/map/match
feat(core): add error taxonomy with 13 classes
feat(cli): add flag derivation from Zod schemas
test(core): add Result type tests
fix(mcp): handle missing output schema gracefully
chore: add lefthook configuration
```

## Development Flow

1. Create Linear issue (TRL-NNN)
2. `gt create 'feat/trl-NNN/description'`
3. Write failing test (TDD red)
4. Implement until green
5. Refactor while green
6. Stage changes: `gt add <files>` (specific files) or `gt add .` (all). Stage intentionally — don't blindly add everything.
7. `gt modify` to amend staged changes into the branch's latest commit
8. `gt modify -c -m "msg"` to create a NEW commit on the same branch from staged changes
9. `gt modify --into <branch>` to amend staged changes into a downstack branch without switching to it
10. `-a` flag stages all unstaged changes — use it only when you're certain you want everything. Prefer explicit staging to avoid catching unintended files.
11. `gt submit --no-interactive` when ready for review
12. Repeat for next branch in the stack
```

---

### 9.9 Hooks — Auto-format on write

A `PostToolUse` hook that runs formatting and linting on every file write. Catches issues at write-time instead of waiting for pre-commit. Faster feedback loop, fewer fix-formatting cycles.

In `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit",
        "command": "bunx oxfmt --write $CLAUDE_FILE_PATH && bunx oxlint $CLAUDE_FILE_PATH --fix --quiet",
        "timeout": 10000
      }
    ]
  }
}
```

This means every time Claude (or any agent) writes or edits a file:
1. `oxfmt` formats it (import sorting, whitespace, etc.)
2. `oxlint` runs auto-fixable rules

The hook runs silently on success. On failure, Claude sees the lint error immediately and can fix it in the same turn — no waiting for a pre-commit hook to catch it later.

**Note:** This complements lefthook, not replaces it. Lefthook catches anything the hook missed (manual edits, non-Claude changes). The hook just tightens the inner loop.

---

### 9.10 Codex configuration (if applicable)

If using OpenAI Codex CLI alongside Claude Code, create a `codex.md` at the repo root or in `.codex/`:

```markdown
# Codex Instructions

This is the Trails framework repo. See AGENTS.md for full context.

Key: implementations return Result, never throw. Use trail() not defineAction().
Use Trails vocabulary: trail, route, trailhead, blaze, follow, topo, markers, detours, permit.
```

### 9.9 Consider for later

These are NOT stage 00 deliverables but worth tracking:

- **`.claude/agents/`** — Custom subagent definitions for Trails-specific workflows (e.g., a "trail builder" agent that scaffolds new trails with tests and examples). Add when patterns emerge from building stages 01-09.
- **`.claude/commands/`** — Custom slash commands for common Trails operations. Add when repetitive workflows are identified.
- **Warden hook** — Once warden ships (stage 06), consider adding a `PostToolUse` hook that runs Trails-specific lint rules (not just formatting) on modified files. `trails/no-throw-in-implementation` catching a `throw` at write-time is faster than catching it at commit-time.
- **Skills from the Outfitter plugin ecosystem** — Evaluate which `fieldguides` and `outfitter` plugin skills should be adapted for the Trails repo. The `tdd-fieldguide`, `bun-fieldguide`, `typescript-fieldguide`, and `claude-craft` skills are likely candidates.

---

## 10. Package Template

When creating packages in subsequent stages, each follows this structure:

```
packages/<name>/
├── src/
│   ├── index.ts              # barrel export
│   ├── *.ts                  # implementation files
│   └── __tests__/
│       └── *.test.ts         # tests alongside code
├── package.json
└── tsconfig.json             # extends root
```

Package `package.json` template:

```json
{
  "name": "@ontrails/<name>",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc -b",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist *.tsbuildinfo"
  }
}
```

During development, exports point to `.ts` source files directly (Bun resolves them). For publishing, a build step compiles to `.js` + `.d.ts` and the exports map changes to `./dist/index.js`.

---

## Testing Requirements

Stage 00 has no application code to test. Verify:

- [ ] `bun install` succeeds
- [ ] `bun run build` succeeds (no packages yet, but Turbo runs clean)
- [ ] `bun run lint` succeeds
- [ ] `bun run format:check` succeeds
- [ ] `bun run typecheck` succeeds
- [ ] `bun run test` succeeds (no tests yet, exits clean)
- [ ] Lefthook hooks install and trigger on commit/push
- [ ] CI workflow runs successfully on push to `main`

---

## Definition of Done

- [ ] Bun workspace with `packages/` and `apps/` directories resolves correctly
- [ ] TypeScript config has all strict flags listed above
- [ ] Turbo orchestrates build/test/typecheck/clean tasks
- [ ] Ultracite (oxlint + oxfmt) runs with `experimentalSortImports`
- [ ] Lefthook pre-commit auto-fixes format + lint with `stage_fixed: true`
- [ ] Lefthook pre-push runs test + typecheck
- [ ] Changesets config exists with `commit: false` and `baseBranch: main`
- [ ] CI pipeline (GitHub Actions) runs build, lint, format check, typecheck, and test
- [ ] `normalize-exports.ts` script exists in `scripts/`
- [ ] `AGENTS.md` covers project overview, architecture, commands, conventions
- [ ] `CLAUDE.md` points to `AGENTS.md`
- [ ] `.claude/rules/` contains graphite.md, linear.md (team TRL), tsdoc.md, trails-conventions.md
- [ ] `.bun-version` pinned
- [ ] `.gitignore` covers node_modules, dist, .turbo, tsbuildinfo
- [ ] All scripts in root `package.json` run without error
- [ ] First commit on `main` with clean CI
