# TRL-742 Repo Plugin Doctrine Audit

Date: 2026-05-21
Branch: `trl-742-audit-repo-plugin-and-skills-against-current-trails-doctrine`
Scope: repo-tracked plugin, skill, agent, rule, and hook surfaces against current Trails doctrine, CLI help, Warden manifest, package exports, and generated guidance.

## Executive Summary

The repo plugin is directionally current: the main `trails` skill uses `surface`, `topo`, `cross`, `meta`, and `warden`; generated Warden guidance is present; resource examples prefer `db.from(ctx)`; and the first-screen teaching order is still sound. The audit found no P0 issues.

Severity note: `P3` in this report means style/clarity-only cleanup that should not block the M2/M3 implementation stack.

The refresh work should still treat the repo plugin as stale enough to require a focused M2 update. The highest-impact doctrine gaps are:

- Error taxonomy copies omit `VersionNotSupportedError` even though core exports and registers it.
- Active plugin architecture prose still uses retired `SurfaceMap`/surface-map language where current doctrine says `TopoGraph` and lock metadata.
- Resource guidance omits `ResourceContext.config` and the `unmockable` escape hatch.
- Testing and composition examples trail current `expectedMatch`, HTTP harness, typed trail-object crossing, and batch `ctx.cross()` guidance.
- HTTP package/surface guidance does not cover the `@ontrails/http/fetch` and `@ontrails/http/bun` split.
- The `trail-engineer` agent profile copies stale Warden rule labels.

Owner routing:

- `TRL-746`: main skill first-screen refresh and one-stop package/surface orientation.
- `TRL-747`: references, templates, examples, and deeper package/testing/error/resource docs.
- `TRL-748`: agent, rules, advisory skill, and hook copy refresh.
- `TRL-751`: hook detection and startup guidance behavior.

## Evidence Commands

- `bun apps/trails/bin/trails.ts --help` confirmed current commands include `compile`, `completions`, `create`, `deprecate`, `diff`, `doctor`, `guide`, `revise`, `run`, `survey`, `topo`, `validate`, `warden`, `add`, `dev`, and `draft`.
- `bun apps/trails/bin/trails.ts warden guide --manifest | jq '{ruleCount, firstRuleIds: [.rules[0:20][].id]}'` returned `ruleCount: 56`.
- `bun apps/trails/bin/trails.ts warden guide --manifest | jq -r '.rules[].id' | rg "throw|output|cross|resource|describe|visibility"` returned current rule IDs including `cross-declarations`, `no-throw-in-implementation`, `public-output-schema`, `resource-declarations`, and `resource-exists`.
- `rg -n "trailhead|transport|connector|topo\\.show|metadata|route|handler|impl|registry|middleware|service|dependency|follow|throw-in-implementation|missing-output-schema|cross-mismatch|missing-describe" plugin README.md docs --glob '!plugin/skills/trails/references/warden-guide.md'` found active plugin issues in `plugin/agents/trail-engineer.md`, `plugin/hooks/detect-trails.sh`, and plugin reference docs. Historical/migration docs also match, but those are not automatically current-facing defects.
- `QMD_FORCE_CPU=1 qmd search "@ontrails/http/bun wayfinder pino vite adapter" --line-numbers -n 8` returned no hits, which supports the exact `rg` finding that the plugin has no dedicated `@ontrails/http/bun`, `@ontrails/pino`, or `@ontrails/wayfinder` guidance. A richer `qmd query` printed relevant docs but exited with a native cleanup warning; I used it only as a pointer and re-read source files directly.

## Surface Inventory

| Surface | Role | Current-good evidence | Drift risk |
| --- | --- | --- | --- |
| `plugin/skills/trails/SKILL.md` | Main Trails skill entrypoint | `plugin/skills/trails/SKILL.md:39-53` uses current lexicon terms including `surface`, `topo`, `cross`, `meta`, and `warden`. | Missing package and deeper doctrine refreshes below. |
| `plugin/skills/trails/references/warden-guide.md` | Generated Warden rule source for skills | `plugin/skills/trails/references/warden-guide.md:5` says it is generated from live `@ontrails/warden` manifest. | Current. Do not hand-edit except through generator. |
| `plugin/skills/trails/references/**` | Deep skill references | CLI/MCP references use `surface()` and package names. | Architecture, error, resource, testing, composition, and HTTP coverage need refresh. |
| `plugin/skills/trails/templates/**` | Copyable skeletons | Templates use `Result` and surface-agnostic trail logic. | Composition template still teaches string-generic crossing and `Promise.all` fan-out. |
| `plugin/skills/trails/examples/**` | Before/after migration examples | Examples use `surface` in repo plugin source. | No HTTP/Bun example; package map does not cover current one-stop shop. |
| `plugin/skills/trails-*/*` | Advisory skills | `trails-error-format`, `trails-language-styleguide`, and Warden advisory are mostly aligned. | Clark calibration and some advisory copy still use stale labels or `metadata`. |
| `plugin/agents/trail-engineer.md` | Claude plugin agent profile | `plugin/agents/trail-engineer.md:38-42` correctly says Result, surface-agnostic blazes, resources, `ctx.cross()`, and logger. | Stale Warden diagnostic names at `plugin/agents/trail-engineer.md:88-91`. |
| `plugin/rules/**` | Rule prompts | `plugin/rules/lexicon.md:7-23` has current term map; `plugin/rules/patterns.md:5-19` has Result/surface/output rules. | Resource context text omits `config`; hook copy issue is elsewhere. |
| `plugin/hooks/**` | Claude SessionStart integration | Hook is simple and read-only. | Detection is narrow and message wording misuses `blaze`. |

## Findings

### P1 - Error taxonomy copies omit `VersionNotSupportedError`

Evidence:

- `plugin/skills/trails/SKILL.md:187` says there are "16 fixed-category error classes".
- `plugin/skills/trails/references/error-taxonomy.md:5-6` repeats "16 fixed-category classes" and "dynamic `RetryExhaustedError` wrapper".
- `plugin/skills/trails/references/error-taxonomy.md:13-16` lists only `NotFoundError` under the `not_found` category.
- Current source exports `VersionNotSupportedError` at `packages/core/src/errors.ts:71` and `packages/core/src/index.ts:11-12`.
- `packages/core/src/errors.ts:274-302` registers `VersionNotSupportedError` in the owner-held error class registry.

Recommended owner issue: `TRL-747`.

Prompt to fix with AI:

> Refresh the Trails plugin error taxonomy from `packages/core/src/errors.ts:errorClasses`. Update count/prose and examples, add `VersionNotSupportedError` under `not_found`, and avoid hand-counted class claims where owner-derived wording is safer.

### P1 - Plugin architecture teaches retired surface-map vocabulary

Evidence:

- `plugin/skills/trails/references/architecture.md:76` says "Surface map entries and hash".
- `plugin/skills/trails/references/architecture.md:78` says "The surface map captures inferred information".
- `plugin/skills/trails/references/architecture.md:111-113` describes Topographer as "Surface maps, semantic diffing, lock files".
- Current lexicon marks `SurfaceMap`, `SurfaceMapEntry`, `_surface.json`, and `surface_map` as retired at `docs/lexicon.md:136-156`.
- Current architecture uses `TopoGraphs`, lock manifest, and `topo.lock` language at `docs/architecture.md:173-175`.

Recommended owner issue: `TRL-747`.

Prompt to fix with AI:

> Replace active plugin references to surface-map vocabulary with `TopoGraph`, `TopoGraphEntry`, lock manifest, and `topo.lock` language from `docs/lexicon.md` and `docs/architecture.md`. Keep historical names only when explicitly marked legacy.

### P1 - Resource guidance omits config and unmockable resources

Evidence:

- `plugin/skills/trails/SKILL.md:142` says the resource factory receives "env, cwd, workspaceRoot only".
- `plugin/rules/patterns.md:53` repeats "env, cwd, workspaceRoot".
- `plugin/skills/trails/references/testing-patterns.md:140` says "Always define `mock`".
- Current source says `ResourceContext` includes validated `config` at `packages/core/src/resource.ts:7-19`.
- Current source includes both `mock` and `unmockable` in `ResourceSpec` at `packages/core/src/resource.ts:47-50`.
- `docs/resources.md:122-134` says resources that cannot honestly provide a mock should declare `unmockable: { reason }`.

Recommended owner issue: `TRL-747`.

Prompt to fix with AI:

> Update plugin resource sections to describe `ResourceContext` as `cwd`, `env`, `workspaceRoot`, plus validated `config`. Keep mock factories as the default, and add the `unmockable: { reason }` escape hatch with testing consequences.

### P2 - `trail-engineer` lists stale Warden diagnostic names

Evidence:

- `plugin/agents/trail-engineer.md:88-91` lists `cross-mismatch`, `missing-output-schema`, `throw-in-implementation`, and `missing-describe`.
- Live manifest output includes `cross-declarations`, `no-throw-in-implementation`, and `public-output-schema`.
- `plugin/skills/trails/references/warden-guide.md` is generated from the live manifest and should be the referenced rule source.

Recommended owner issue: `TRL-748`.

Prompt to fix with AI:

> Replace hand-written common Warden issue IDs in `plugin/agents/trail-engineer.md` with current manifest IDs, or point the agent at `plugin/skills/trails/references/warden-guide.md` instead of copying rule names.

### P2 - Testing guidance omits `expectedMatch` and HTTP harness coverage

Evidence:

- `plugin/skills/trails/SKILL.md:92-97` teaches full match, schema-only, and error match only.
- `plugin/skills/trails/references/testing-patterns.md:214-240` documents CLI and MCP harnesses only.
- `plugin/skills/trails/SKILL.md:181` says surface integration uses `createCliHarness()` and `createMcpHarness()`.
- `docs/testing.md:144-166` defines `expectedMatch`.
- `docs/testing.md:379-390` documents `createHttpHarness`.
- `packages/testing/src/index.ts:37-40` exports CLI, HTTP, and MCP harnesses.

Recommended owner issue: `TRL-747`.

Prompt to fix with AI:

> Refresh the plugin testing sections around progressive assertions and surface harnesses. Add `expectedMatch`, keep schema-only/error/full match, and include `createHttpHarness` and `testSurfaceParity` beside CLI/MCP harnesses.

### P2 - Composition references/templates need typed and batch crossing refresh

Evidence:

- `plugin/skills/trails/references/contract-patterns.md:141-143` teaches `crosses: ['entity.add', 'search']` and `ctx.cross<OutputType>(...)`.
- `plugin/skills/trails/templates/composition.md:57-82` uses string IDs with generics.
- `plugin/skills/trails/templates/composition.md:113-119` teaches `Promise.all([ctx.cross(...)])`.
- Current lexicon says `crosses` accepts trail objects and typed `ctx.cross()` infers input/output at `docs/lexicon.md:247-249`.
- ADR-0028 documents the array overload for concurrent crossing at `docs/adr/0028-concurrent-crossing.md:61-77`.

Recommended owner issue: `TRL-747`.

Prompt to fix with AI:

> Update composition references/templates to prefer trail-object `crosses` and `ctx.cross(trail, input)` when in scope. Keep string IDs as the untyped escape hatch, and replace `Promise.all` fan-out examples with batch `ctx.cross([...])` where appropriate.

### P2 - HTTP surface guidance misses Fetch and Bun-native split

Evidence:

- `plugin/skills/trails/SKILL.md:118-123` shows HTTP only through `@ontrails/hono`.
- `plugin/skills/trails/references/architecture.md:93-95` lists `@ontrails/http`, `@ontrails/hono`, and `@ontrails/vite`, but not `@ontrails/http/bun` or `@ontrails/http/fetch`.
- Current HTTP docs say the package separates route building, Fetch handling, Hono, and Bun-native serving at `docs/surfaces/http.md:1-5`.
- Current HTTP docs distinguish `derive*`, `create*`, and `surface()` at `docs/surfaces/http.md:39-49`.

Recommended owner issue: `TRL-746` for main skill, `TRL-747` for reference docs.

Prompt to fix with AI:

> Refresh HTTP guidance to cover framework-agnostic route derivation, `@ontrails/http/fetch` materializers, Hono `surface()`, and Bun-native `@ontrails/http/bun`.

### P2 - Package layout reference is incomplete against live workspace docs

Evidence:

- `plugin/skills/trails/references/architecture.md:86-114` omits `@ontrails/pino`.
- The same table omits `@ontrails/store` and `@ontrails/drizzle` even though the plugin dependency graph mentions them at `plugin/skills/trails/references/architecture.md:126-127`.
- `docs/architecture.md:160-175` includes `@ontrails/store`, `@ontrails/drizzle`, `@ontrails/pino`, and current Topographer wording.
- Local package export command found `@ontrails/wayfinder` at `1.0.0-beta.18`; `packages/wayfinder/README.md:9-17` says it is shell-only.

Recommended owner issue: `TRL-747`, with main-skill summary owned by `TRL-746`.

Prompt to fix with AI:

> Rebuild the plugin architecture package table from live package manifests plus `docs/architecture.md`, including adapters, store/drizzle, pino, HTTP subpaths, and a deliberate shell-only note for wayfinder.

### P2 - Hook detection and message copy need doctrine refresh

Evidence:

- `plugin/hooks/detect-trails.sh:7-9` only checks root `package.json` for `@ontrails`.
- `plugin/hooks/detect-trails.sh:15` says "blaze: bun add -g @ontrails/trails".
- The current repo has a Trails config at `trails.config.ts:1-13`.
- Project detection helpers already recognize `.trails` and topo source paths at `apps/trails/src/trails/project.ts:59-64` and `packages/topographer/src/workspace-topos.ts:185-217`.
- `docs/contributing/language-styleguide.md:13-14` defines `blaze` as framework grammar, not a synonym for "run this command".

Recommended owner issue: `TRL-751`, with message wording owned by `TRL-748`.

Prompt to fix with AI:

> Refresh `detect-trails.sh` to detect Trails projects through package imports, `trails.config.ts`, `.trails/`, and topo-source signals, and replace the `blaze:` install hint with plain command wording.

### P2 - Clark calibration maps annotations/tags to `metadata`, not current `meta`

Evidence:

- `.claude/skills/clark/references/calibrate.md:28` maps "annotations, tags" to "metadata".
- Current styleguide says "Use `meta`, not metadata" at `docs/contributing/language-styleguide.md:260`.
- Current lexicon says `meta` is annotations for tooling and filtering at `docs/lexicon.md:518-524`.

Recommended owner issue: `TRL-748`.

Prompt to fix with AI:

> Update Clark calibration vocabulary to use `meta` as the current trail field and keep `metadata` only as ordinary English or historical contrast.

### P3 - One getting-started sentence calls the topo a collection

Evidence:

- `plugin/skills/trails/references/getting-started.md:67` says "`topo()` scans module exports for `Trail` shapes and builds the collection."
- Repo guidance says "`topo`, not registry or collection" at `AGENTS.md:55`.

Recommended owner issue: `TRL-747`.

Prompt to fix with AI:

> Change the getting-started sentence to say `topo()` assembles a graph/queryable topo rather than a collection.

## Current-Good Areas To Preserve

- `plugin/skills/trails/SKILL.md:15-37` starts with define trail, collect into topo, open surfaces, run, and test, matching the desired teaching order.
- `plugin/skills/trails/SKILL.md:45-53` uses current lexicon terms.
- `plugin/skills/trails/SKILL.md:151-158` uses `db.from(ctx)`, which matches the static resource accessor preference.
- `plugin/skills/trails/references/warden-guide.md` exists and is generated from the live Warden manifest.
- `plugin/rules/lexicon.md:7-23` accurately names current and retired vocabulary for trail, cross, topo, blaze, surface, resource, signal, layer, tracing, meta, detours, warden, survey, guide, and adapter.
- MCP `handler` wording in `plugin/skills/trails/references/mcp-surface.md:99-106` appears legitimate because the MCP package exposes an `McpToolDefinition.handler` field; do not globally rewrite protocol-local handler identifiers without source confirmation.

## Unable To Verify

- I did not mutate or inspect global installed skill paths for this report; that belongs to `TRL-743`.
- I did not run network-backed package or registry checks.
- Adjacent public docs share some stale wording, for example public README still says Topographer handles "Surface maps" at `README.md:150`.
  Recommended owner issue: `TRL-755`.
- `@ontrails/wayfinder` is present but shell-only; the implementation stack needs a doctrine choice on whether to mention it now or hide it until it ships trails. The package README supports mentioning it as reserved/shell-only.
