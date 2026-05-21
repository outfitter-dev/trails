# TRL-745 Package Coverage Audit

Date: 2026-05-21
Branch: `trl-745-audit-plugin-coverage-for-current-packages-adapters-and`
Scope: current `@ontrails/*` package, adapter, subpath, and key export truth that the Trails plugin/skills refresh must teach.

## Executive Summary

The live workspace has 19 non-private `@ontrails/*` packages at `1.0.0-beta.18`, plus the private repo-local `@ontrails/oxlint-plugin`. The repo plugin already teaches the core mental model, CLI/MCP/Hono surfaces, resources, testing, and Warden, but it is not yet a one-stop package map. The largest refresh gaps are:

- `@ontrails/http/bun` is a real exported subpath and has package README coverage, but the main skill only shows Hono for HTTP.
- `@ontrails/pino` and `@ontrails/wayfinder` are missing from the plugin architecture reference, and `@ontrails/wayfinder` must be taught as shell-only.
- `@ontrails/store` and `@ontrails/drizzle` appear in the plugin dependency graph but not in the package layout tables.
- The testing reference omits the shipped HTTP harness even though `@ontrails/testing` exports it and `testSurfaceParity()` runs CLI/MCP/HTTP semantics.
- Package taxonomy is split across sources: `docs/architecture.md` is the strongest current package map; `README.md` and `plugin/skills/trails/references/architecture.md` are partial.

Recommended owner routing:

- `TRL-746`: refresh the main `trails` skill entrypoint and first-screen package/surface guidance.
- `TRL-747`: refresh package references, templates, examples, HTTP docs, getting-started install guidance, and testing reference coverage.
- `TRL-748`: use only for downstream advisory/agent/rules copy that repeats stale package names or Warden rule labels.
- `TRL-749`: use for metadata/version checks, not package content.
- `TRL-751`: use for hook-time package/version guidance only.

## Evidence Commands

- `jq -r '.name + " " + .version + " private=" + ((.private // false)|tostring)' adapters/*/package.json packages/*/package.json` found every package at `1.0.0-beta.18`; `@ontrails/oxlint-plugin` is the only private package.
- `jq -r 'select(.private != true) | .name as $name | (.exports // {}) | to_entries[] | $name + " " + .key + " -> " + (.value|tostring)' adapters/*/package.json packages/*/package.json` found the public subpaths listed below.
- `bun apps/trails/bin/trails.ts --help` listed current CLI commands: `compile`, `completions`, `create`, `deprecate`, `diff`, `doctor`, `guide`, `revise`, `run`, `survey`, `topo`, `validate`, `warden`, `add`, `dev`, `draft`, and `help`.
- `QMD_FORCE_CPU=1 qmd search "@ontrails/http/bun wayfinder pino vite adapter" --line-numbers -n 8` returned no hits. A prior `qmd query "surface adapter package taxonomy HTTP Bun Hono Wayfinder Pino Trails architecture" --line-numbers --no-rerank -n 8` returned `docs/architecture.md` and `plugin/skills/trails/references/architecture.md`, but exited with a native cleanup warning after printing results. I treated the printed results only as search evidence and re-read the files with `nl -ba`.
- `rg -n "@ontrails/(core|cli|commander|mcp|http|hono|store|drizzle|config|permits|observe|tracing|logtape|pino|testing|topographer|warden|wayfinder|vite)|http/bun|Bun-native" plugin/skills/trails plugin/agents plugin/rules plugin/README.md README.md docs/architecture.md` confirmed plugin references for core/CLI/MCP/Hono/testing/Warden but no plugin hits for `@ontrails/pino`, `@ontrails/wayfinder`, or `@ontrails/http/bun`.

## Package And Subpath Truth Map

### Surface And App Packages

- `@ontrails/cli` - command model and output formatting. Export: `.`.
  Evidence: `docs/architecture.md:149` says it is the "Framework-agnostic command model, flag derivation, output formatting".
  Plugin status: present in `plugin/skills/trails/references/architecture.md:90`, but the main skill teaches the user-facing Commander adapter first.

- `@ontrails/commander` - Commander CLI adapter. Export: `.`.
  Evidence: `docs/architecture.md:150` says "Commander adapter, `surface()`"; `plugin/skills/trails/SKILL.md:104-109` shows `import { surface } from '@ontrails/commander'`.
  Plugin status: covered.

- `@ontrails/mcp` - MCP surface. Export: `.`.
  Evidence: `docs/architecture.md:151` and `plugin/skills/trails/SKILL.md:111-116` both identify MCP as a `surface()` package.
  Plugin status: covered.

- `@ontrails/http` - framework-agnostic HTTP surface model. Exports: `.`, `./bun`, `./fetch`.
  Evidence: `packages/http/package.json:13-17` exports `./bun` and `./fetch`; `packages/http/README.md:25-35` shows Bun-native use from `@ontrails/http/bun`; `docs/architecture.md:152` calls out "Bun-native subpath".
  Plugin status: partially covered. The plugin main skill only shows `@ontrails/hono` for HTTP at `plugin/skills/trails/SKILL.md:118-123`, and there is no `plugin/skills/trails/references/http-surface.md`.

- `@ontrails/hono` - Hono HTTP adapter. Export: `.`.
  Evidence: `docs/architecture.md:153` and `packages/http/README.md:7-23` show Hono surface usage.
  Plugin status: covered as the only HTTP example, which makes the `@ontrails/http/bun` gap more visible.

- `@ontrails/vite` - Vite middleware adapter. Export: `.`.
  Evidence: `adapters/vite/package.json:24-28` lists only dev dependencies, while `docs/architecture.md:154` says external dep is "None (node:stream only)".
  Plugin status: stale in the plugin architecture reference. `plugin/skills/trails/references/architecture.md:95` says external dep `vite`.

### Infrastructure And Observability Packages

- `@ontrails/config` - config resolution, profiles, resource config schemas, diagnostics. Export: `.`.
  Evidence: `docs/architecture.md:160`; current workspace has `trails.config.ts:1-13` using `defineConfig`.
  Plugin status: present in `plugin/skills/trails/references/architecture.md:101`, not surfaced in the main skill.

- `@ontrails/permits` - permit model and auth adapters. Exports: `.`, `./jwt`, `./testing`.
  Evidence: command export summary; `docs/architecture.md:161` identifies the package.
  Plugin status: present in the plugin architecture reference, not in the main skill's package orientation.

- `@ontrails/store` - backend-agnostic store definitions. Exports: `.`, `./adapter-support`, `./jsonfile`, `./trails`, `./testing`.
  Evidence: command export summary; `docs/architecture.md:162` identifies store as an infrastructure package.
  Plugin status: missing from the plugin architecture table at `plugin/skills/trails/references/architecture.md:97-105`, even though the dependency graph later mentions it at `plugin/skills/trails/references/architecture.md:126`.

- `@ontrails/drizzle` - Drizzle SQLite store adapter. Export: `.`.
  Evidence: `docs/architecture.md:163`; package command summary shows `@ontrails/drizzle 1.0.0-beta.18`.
  Plugin status: missing from the plugin infrastructure table at `plugin/skills/trails/references/architecture.md:97-105`, even though the dependency graph mentions it at `plugin/skills/trails/references/architecture.md:127`.

- `@ontrails/observe` - production log/trace sink contracts. Export: `.`.
  Evidence: `docs/architecture.md:164`.
  Plugin status: covered in the plugin architecture table at `plugin/skills/trails/references/architecture.md:103`.

- `@ontrails/tracing` - dev-state tracing and OTel support. Exports: `.`, `./otel`.
  Evidence: command export summary; `docs/architecture.md:165`.
  Plugin status: covered in the plugin architecture table but without the `./otel` subpath.

- `@ontrails/logtape` - LogTape sink adapter. Export: `.`.
  Evidence: `docs/architecture.md:166`.
  Plugin status: covered in the plugin architecture table and graph.

- `@ontrails/pino` - Pino sink adapter. Export: `.`.
  Evidence: `packages/pino/package.json:1-15` and `packages/pino/README.md:1-12`; `docs/architecture.md:167` calls it a Pino sink adapter with no hard runtime dependency.
  Plugin status: missing from `plugin/skills/trails/references/architecture.md:97-105` and `plugin/skills/trails/references/architecture.md:117-135`.

### Ecosystem Packages

- `@ontrails/core` - Result, errors, primitives, validation, execution pipeline, and adapter ports. Exports: `.`, `./patterns`, `./redaction`, `./store`, `./trails`.
  Evidence: command export summary; `docs/architecture.md:141`.
  Plugin status: covered.

- `@ontrails/testing` - contract tests, examples, harnesses, surface parity. Export: `.`.
  Evidence: `packages/testing/README.md:35-42` lists `testSurfaceParity`, CLI/MCP/HTTP harnesses; `packages/testing/src/index.ts:37-40` exports `createCliHarness`, `createHttpHarness`, and `createMcpHarness`.
  Plugin status: partial. `plugin/skills/trails/SKILL.md:181` mentions only `createCliHarness()` and `createMcpHarness()`, and `plugin/skills/trails/references/testing-patterns.md:214-240` omits the HTTP harness.

- `@ontrails/topographer` - TopoGraphs, semantic diffing, lock manifest, topo-store persistence. Exports: `.`, `./backend-support`.
  Evidence: command export summary; `docs/architecture.md:174`.
  Plugin status: covered at a high level.

- `@ontrails/warden` - rule manifest and governance checks. Exports: `.`, `./ast`, `./resolve`.
  Evidence: command export summary; `bun apps/trails/bin/trails.ts warden guide --manifest` returned `ruleCount: 56`.
  Plugin status: covered, with one advisory-agent rule-label gap captured in `TRL-742`.

- `@ontrails/wayfinder` - shell package for future agent wayfinding trails. Export: `.`.
  Evidence: `packages/wayfinder/package.json:1-4` says "package shell only -- no trails ship yet"; `packages/wayfinder/README.md:9-17` says "**Status: shell only.** No trails ship yet."
  Plugin status: missing. The refresh should mention it, but clearly as a reserved/shell package rather than shipped runtime capability.

## Findings

### P2 - Plugin architecture reference is no longer a complete package map

Evidence:

- Current architecture includes `@ontrails/store`, `@ontrails/drizzle`, `@ontrails/pino`, and Vite with no external runtime dependency at `docs/architecture.md:160-167` and `docs/architecture.md:201-205`.
- Plugin architecture omits `store`, `drizzle`, and `pino` from the infrastructure table at `plugin/skills/trails/references/architecture.md:97-105`.
- Plugin architecture says `@ontrails/vite` external dep is `vite` at `plugin/skills/trails/references/architecture.md:95`, while `docs/architecture.md:154` says "None (node:stream only)".

Recommended owner issue: `TRL-747`.

Prompt to fix with AI:

> Refresh `plugin/skills/trails/references/architecture.md` from `docs/architecture.md` and package export maps. Include store, drizzle, pino, wayfinder shell status, current Vite dependency wording, and the current `@ontrails/http` `./bun` and `./fetch` subpaths without changing implementation code.

### P2 - Main skill under-teaches HTTP by only showing Hono

Evidence:

- `packages/http/package.json:13-17` exports `./bun` and `./fetch`.
- `packages/http/README.md:25-35` documents `@ontrails/http/bun` and says it uses Bun native serving with no third-party runtime dependency.
- `plugin/skills/trails/SKILL.md:118-123` shows HTTP only through `@ontrails/hono`.
- `plugin/skills/trails/SKILL.md:125` says to see "the HTTP surface docs", but `fd . plugin/skills/trails/references -t f` shows no HTTP surface reference file.

Recommended owner issue: `TRL-746` for first-screen skill guidance, `TRL-747` for the missing reference file and examples.

Prompt to fix with AI:

> Update the main `trails` skill HTTP section to teach Hono and Bun-native HTTP as peer materializers over the same `@ontrails/http` route/fetch kernel. Add an HTTP surface reference covering `deriveHttpRoutes`, `deriveOpenApiSpec`, `@ontrails/http/fetch`, `@ontrails/http/bun`, Hono, route derivation, and error projection.

### P2 - Getting-started install guidance does not cover shipped HTTP choices

Evidence:

- `plugin/skills/trails/references/getting-started.md:11-14` installs only core, CLI, Commander, MCP, and testing.
- Current public getting-started docs include "Open an HTTP Surface" at `docs/getting-started.md:148-165`.
- `packages/http/README.md:145-151` says to install `@ontrails/http @ontrails/hono`, or only `@ontrails/http` for Bun-native serving.

Recommended owner issue: `TRL-747`.

Prompt to fix with AI:

> Refresh plugin getting-started install and walkthrough docs so CLI, MCP, Hono HTTP, Bun-native HTTP, and testing are represented as optional packages/surfaces with copy-pasteable imports. Keep the starter minimal but make the shipped HTTP path discoverable.

### P2 - Testing reference omits the HTTP harness and surface parity coverage

Evidence:

- `packages/testing/README.md:35-42` lists `testSurfaceParity`, `createCliHarness`, `createMcpHarness`, and `createHttpHarness`.
- `packages/testing/README.md:96-119` demonstrates CLI, MCP, and HTTP harnesses together.
- `packages/testing/src/harness-http.ts:161-174` documents `createHttpHarness`.
- `plugin/skills/trails/references/testing-patterns.md:214-240` has CLI and MCP harnesses only.
- `plugin/skills/trails/SKILL.md:181` says "Surface integration uses `createCliHarness()` / `createMcpHarness()`."

Recommended owner issue: `TRL-747`.

Prompt to fix with AI:

> Update the plugin testing reference and main skill testing paragraph to include `createHttpHarness()` and `testSurfaceParity()`. Keep examples concise and route deeper API details to the package README/API docs.

### P2 - `@ontrails/wayfinder` needs explicit shell-only treatment

Evidence:

- `packages/wayfinder/package.json:4` describes the package as "shell only -- no trails ship yet".
- `packages/wayfinder/README.md:9-17` says no trails ship yet and lists future trail IDs such as `wayfind.overview`, `wayfind.search`, `wayfind.trail`, and `wayfind.examples`.
- `rg` found no plugin references to `@ontrails/wayfinder`.

Recommended owner issue: `TRL-746` for the main package orientation and `TRL-747` for references.

Prompt to fix with AI:

> Add `@ontrails/wayfinder` to the plugin package map as a reserved shell package, not a shipped runtime feature. Link it to the draft wayfinding ADR and avoid teaching non-existent exported trails.

### P3 - Source package tables disagree on the complete package list

Evidence:

- `README.md:142-155` lists core, CLI, Commander, MCP, HTTP, Hono, store, testing, topographer, observe, tracing, logtape, pino, and warden.
- The same README table omits current packages `@ontrails/config`, `@ontrails/permits`, `@ontrails/drizzle`, `@ontrails/vite`, and `@ontrails/wayfinder`.
- `docs/architecture.md:145-175` is more complete for current package layers.

Recommended owner issue: `TRL-746` for plugin entrypoint source selection. If the implementation pass changes public README package taxonomy, create a separate docs follow-up rather than bundling it into plugin refresh.

Prompt to fix with AI:

> During `TRL-746`, treat `docs/architecture.md` plus package export maps as the package taxonomy source of truth. If public README package coverage should be made complete too, file a small docs follow-up rather than hiding that change in the plugin stack.

## Unable To Verify

- I did not check npm registry state or published package tarballs. The goal forbids registry mutation and the audit only needs local package/export truth.
- I did not run `bun run publish:check`; no package contents are being changed in this M1 report branch.
- The package map above uses local workspace package manifests and source docs after `gt sync`; it should be refreshed before M2 if the package line advances beyond `1.0.0-beta.18`.
