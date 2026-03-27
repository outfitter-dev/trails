# Stage 08 — apps/trails CLI

> The opinionated CLI app that ties everything together: init, survey, scout, warden, guide.

---

## Overview

The `trails` CLI is the developer-facing entry point to the Trails framework. It scaffolds new projects, introspects the topo, detects drift, and provides runtime guidance. It composes `@ontrails/schema` for surface maps and diffing, `@ontrails/warden` for governance, `@outfitter/tui` for rendering, and `@clack/prompts` for interactive flows.

This is an **app**, not a library. It lives in `apps/trails/` and is published as a standalone CLI binary.

---

## Prerequisites

- **Stages 01-04 complete** -- core, cli, mcp, logging.
- **Stage 06 complete** -- `@ontrails/warden` ships lint rules and the warden check logic.
- **Stage 07 complete** -- `@ontrails/schema` ships `generateSurfaceMap()`, `hashSurfaceMap()`, `diffSurfaceMaps()`, and file I/O.
- `@outfitter/tui` available for rendering (tables, boxes, colors).
- `@clack/prompts` available for interactive flows.
- Commander available as the CLI framework (via `@ontrails/cli/commander`).

---

## Implementation Guide

### Package Structure

```
apps/trails/
  package.json
  tsconfig.json
  bin/
    trails.ts               # Entry point
  src/
    index.ts                # App setup, command registration
    commands/
      init.ts               # trails init
      survey.ts             # trails survey
      scout.ts              # trails scout
      warden.ts             # trails warden (delegates to @ontrails/warden)
      guide.ts         # trails guide (initial stub)
    __tests__/
      init.test.ts
      survey.test.ts
      scout.test.ts
      warden.test.ts
      guide.test.ts
```

**package.json:**

```json
{
  "name": "trails",
  "bin": {
    "trails": "./bin/trails.ts"
  },
  "dependencies": {
    "@ontrails/core": "workspace:*",
    "@ontrails/cli": "workspace:*",
    "@ontrails/schema": "workspace:*",
    "@ontrails/warden": "workspace:*",
    "@ontrails/logging": "workspace:*",
    "@outfitter/tui": "...",
    "@clack/prompts": "...",
    "commander": "..."
  }
}
```

### Entry Point

```typescript
// bin/trails.ts
#!/usr/bin/env bun
import { program } from "../src/index.js";
program.parse();
```

```typescript
// src/index.ts
import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { surveyCommand } from './commands/survey.js';
import { wardenCommand } from './commands/warden.js';
import { guideCommand } from './commands/guide.js';

export const program = new Command('trails')
  .description('Agent-native, contract-first TypeScript framework')
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(surveyCommand);
program.addCommand(scoutCommand);
program.addCommand(wardenCommand);
program.addCommand(guideCommand);
```

### `trails blaze` -- Create Projects & Wire Surfaces

Context-aware: outside a project it scaffolds a new one, inside a project it adds a surface.

**Detection:** looks for a `topo()` call in `src/` or a `.trails/` directory.

#### Create flow (outside a project)

Interactive via `@clack/prompts`:

```bash
trails blaze              # interactive Clack prompts
trails blaze my-app       # create "my-app" directory
```

**Prompt flow:**

1. **Project name** -- `text()`, defaults to directory name or CLI argument.
2. **Description** -- `text()`, optional.
3. **Surfaces** -- `multiselect()`: CLI (default on), MCP, HTTP (coming soon).
4. **Verification** -- `multiselect()`: Testing (default on), Warden (default on). Both on by default -- testing proves the contract, warden prevents drift.
5. **Starter trail** -- `select()`:
   - `hello` -- One trail, one example. The "hello world."
   - `entity` -- 4 trails, 1 route, 1 event, in-memory store. Full demo.
   - `empty` -- Just the structure, no trails.
6. **Extras** -- `multiselect()`: Logging (off by default).

**Non-interactive mode:**

```bash
trails blaze my-app --surfaces cli,mcp --starter entity --include logging
trails blaze my-app                   # defaults: cli, hello, testing + warden
trails blaze my-app --no-verify       # skip testing + warden
```

**What gets generated (base -- always):**

```
my-app/
  package.json              # @ontrails/core, zod
  tsconfig.json             # Strict TypeScript
  .oxlintrc.json            # Extends ultracite core
  .oxfmtrc.jsonc            # Ultracite defaults
  .gitignore                # Includes .trails/_surface.json
  .trails/
    surface.lock            # Generated from starter trails
  src/
    app.ts                  # trailhead() setup
```

Per surface: `src/cli.ts` (+ commander dep, bin entry), `src/mcp.ts` (+ @ontrails/mcp dep).
Per verification: `__tests__/examples.test.ts` (testing), `lefthook.yml` + warden dep (warden).
Per starter: `src/trails/hello.ts` or full entity CRUD set.
Per extra: `src/logger.ts` (logging).

#### Add surface flow (inside a project)

```bash
trails blaze mcp          # add MCP surface
trails blaze cli          # add CLI surface
```

What it does:
1. Finds the topo (scans `src/` for `topo()` import)
2. Creates entry point (`src/mcp.ts` with `blaze(app)`)
3. Adds dependency to `package.json`
4. Regenerates `.trails/surface.lock`

One file, one dep. The trail definitions don't change. The tests don't change.

#### Replaces `trails init`

The `init` command becomes an alias for `trails blaze` (outside a project). The primary command is `blaze` -- it mirrors the code API where `blaze(app)` opens the app on a surface.

### `trails survey` -- Full Topo Introspection

The comprehensive, structured report of everything the app can do.

```bash
# Full topo
trails survey

# Single trail detail
trails survey entity.show

# JSON output for agent consumption
trails survey --output json

# Generate surface map and lock file
trails survey generate

# Diff against a git ref
trails survey --diff main

# Diff with impact analysis
trails survey --diff main --impact

# Only show breaking changes
trails survey --diff v1.0 --breaking-only

# Exit with non-zero on breaking changes (for CI)
trails survey --diff main --exit-code
```

#### `trails survey` (no args)

Lists all trails in the topo with summary info. Uses `@outfitter/tui` tables for rendering.

```
Trails (12 total)

  ID                 Kind    Surfaces   Safety        Examples
  entity.show        trail   cli, mcp   readOnly      3
  entity.add         trail   cli, mcp   -             2
  entity.delete      trail   cli, mcp   destructive   1
  entity.onboard     route   cli, mcp   -             2
  search             trail   cli, mcp   readOnly      4
  ...
```

#### `trails survey <trailId>`

Detailed view of a single trail:

```
Trail: entity.show

  Kind:           trail
  Surfaces:       cli, mcp
  Safety:         readOnly
  Description:    Show an entity by name

  Input Schema:
    name: string (required)
    verbose: boolean (optional, default: false)

  Output Schema:
    id: string
    name: string
    type: string
    createdAt: string (ISO 8601)

  Examples:
    1. Show entity by name
       Input:  { name: "Alpha" }
       Output: { id: "e1", name: "Alpha", type: "concept", createdAt: "..." }

    2. Entity not found
       Input:  { name: "nope" }
       Error:  NotFoundError

  Detours:
    NotFoundError -> search
```

#### `trails survey generate`

Generates the surface map and lock file:

1. Load the app's topo (by importing the app module).
2. Call `generateSurfaceMap(topo)`.
3. Call `writeSurfaceMap(surfaceMap)` -- writes `.trails/_surface.json`.
4. Call `hashSurfaceMap(surfaceMap)` and `writeSurfaceLock(hash)` -- writes `.trails/surface.lock`.
5. Print confirmation with the hash.

#### `trails survey --diff <ref>`

Compare the current topo against a git ref:

1. Read `surface.lock` at the target ref using `git show <ref>:.trails/surface.lock`.
2. Read `_surface.json` at the target ref (if available) or regenerate by checking out the ref in a temporary worktree and running the topo.
3. Generate the current surface map.
4. Call `diffSurfaceMaps(prev, curr)`.
5. Render the diff with severity classification.

**Output format:**

```
Contract changes vs main:

  Breaking (2):
    - entity.show: required input field "type" added
    - entity.lookup: trail removed

  Warnings (1):
    ~ entity.find: deprecated (replaced by entity.show)

  Info (3):
    + docs.search: added (cli, mcp)
    + docs.list: added (cli, mcp)
    ~ entity.show: description updated
```

#### `trails survey --diff <ref> --impact`

After computing the diff, scan the project for downstream references to changed or removed trails:

1. Compute the diff (same as `--diff`).
2. For each removed or renamed trail, search for references in:
   - `.claude/skills/`, `.claude/agents/`, `.claude/commands/`
   - `CLAUDE.md`, `AGENTS.md`
   - `*.md` files (configurable scope)
3. For each modified trail (input schema changed), search for CLI command patterns that are now invalid (missing required flags).
4. Append impact report to the diff output.

```
Downstream impact:
  .claude/skills/entity-ops/SKILL.md:12
    References: "myapp entity lookup" (trail removed)

  AGENTS.md:45
    References: "entity.lookup" (trail removed)
```

### `trails scout` -- Quick Capabilities Check

What an agent does on first contact -- a fast check of what's available.

```bash
trails scout
trails scout --output json
trails scout --surfaces
trails scout --permits
```

**Default output:**

```json
{
  "name": "myapp",
  "version": "1.0.0",
  "contractVersion": "2026-03",
  "features": {
    "outputSchemas": true,
    "examples": true,
    "detours": true,
    "routes": false,
    "events": false
  },
  "surfaces": {
    "cli": true,
    "mcp": { "endpoint": "stdio" }
  },
  "trails": 12,
  "events": 0
}
```

Scout always outputs JSON (it's primarily for agent consumption). The human-readable format is a formatted summary using `@outfitter/tui` boxes.

**Implementation:**

1. Load the app's topo.
2. Count trails, events, routes.
3. Detect which features are in use (output schemas present, examples present, etc.).
4. Detect which surfaces are blazed.
5. Return the scout report.

### `trails warden` -- Governance

Delegates to `@ontrails/warden`:

```bash
trails warden               # Run all checks
trails warden --exit-code   # CI mode, non-zero on errors
trails warden --lint-only   # Only lint rules
trails warden --drift-only  # Only drift detection
```

This command is a thin wrapper that imports and calls the warden logic from `@ontrails/warden`. See Stage 06 for the full warden spec.

### `trails guide` -- Runtime Guidance (Initial Stub)

The guide is a reserved concept for runtime guidance -- translating trail definitions into actionable understanding. For v1, this is a stub that provides basic trail documentation.

```bash
trails guide                  # List all trails with descriptions
trails guide entity           # Entity-related trails
trails guide entity.show      # Deep dive on one trail
trails guide --output json    # Structured output for agents
```

**v1 stub implementation:** Read the topo and format trail specs as guidance. Include:

- Trail description and input/output schemas.
- Examples (rendered as "how to use this").
- Detours (rendered as "what to do when it fails").
- Related trails (from `follows` declarations on routes).

**Post-v1:** The guide becomes the knowledge interpreter described in `LANGUAGE.md` -- synthesizing markers, relations, and examples into deeper guidance.

### Rendering with `@outfitter/tui`

Use `@outfitter/tui` for all terminal output:

- **Tables** for `survey` trail listings.
- **Boxes** for `scout` capability summaries.
- **Colors** for severity in `survey --diff` (red for breaking, yellow for warnings, green for info).
- **Trees** for route composition visualization.

Respect `--output json` / `--output jsonl` flags for machine-readable output. Human-readable rendering is the default.

---

## Testing Requirements

### `init.test.ts`

- `trails init my-app --no-interactive` generates a valid project structure.
- Generated `package.json` has correct `@ontrails/*` dependencies.
- Generated `src/app.ts` uses `trailhead()`.
- Generated `src/cli.ts` uses `blaze()` from `@ontrails/cli/commander`.
- Generated test file uses `testAllExamples()`.
- `--template minimal` produces a single-trail project.
- `--template full` produces a multi-trail project with examples.
- Generated `.oxlintrc.json` includes the trails plugin.

### `survey.test.ts`

- `trails survey` lists all trails in the topo.
- `trails survey entity.show` shows detail for a single trail.
- `trails survey --output json` produces valid JSON.
- `trails survey generate` writes `_surface.json` and `surface.lock`.
- `trails survey --diff` produces a diff with severity classification.
- `trails survey --diff --exit-code` returns non-zero on breaking changes.
- `trails survey --diff --impact` scans downstream files for broken references.
- `trails survey --diff --breaking-only` filters to breaking changes only.

### `scout.test.ts`

- `trails scout` produces a valid capability report.
- Report includes correct trail count.
- Report detects which features are in use.
- `--output json` produces valid JSON.

### `warden.test.ts`

- `trails warden` runs lint + drift checks.
- `trails warden --exit-code` returns non-zero on errors.
- `trails warden --lint-only` skips drift.
- `trails warden --drift-only` skips lint.

### `guide.test.ts`

- `trails guide` lists trails with descriptions.
- `trails guide entity.show` shows trail detail with examples.
- `trails guide --output json` produces valid JSON.
- Non-existent trail ID produces a clear error.

---

## Definition of Done

- [ ] `trails init` scaffolds a working Trails project with interactive prompts.
- [ ] `trails init --no-interactive` works for agent-driven scaffolding.
- [ ] `trails survey` shows the full topo with trail listings.
- [ ] `trails survey <trailId>` shows detail for a single trail.
- [ ] `trails survey generate` writes `_surface.json` and `surface.lock`.
- [ ] `trails survey --diff <ref>` shows semantic contract changes with severity classification.
- [ ] `trails survey --diff <ref> --impact` scans for downstream broken references.
- [ ] `trails survey --diff <ref> --exit-code` gates CI on breaking changes.
- [ ] `trails scout` produces a capability report suitable for agent bootstrap.
- [ ] `trails warden` delegates to `@ontrails/warden` for lint + drift checks.
- [ ] `trails guide` provides basic trail guidance (stub, expandable post-v1).
- [ ] Rendering uses `@outfitter/tui` for tables, boxes, and colors.
- [ ] Interactive flows use `@clack/prompts`.
- [ ] All commands support `--output json` for machine-readable output.
- [ ] All tests pass.
