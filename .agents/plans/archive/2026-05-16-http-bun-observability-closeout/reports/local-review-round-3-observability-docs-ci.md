---
created: 2026-05-17T15:32:45Z
updated: 2026-05-20T03:58:14Z
description: Local review round 3 covering observability, docs, ADR/package-boundary wording, and CI hygiene. No P0/P1/P2 findings. Confirms @ontrails/tracing/otel and @ontrails/http/bun remain subpath exports with no standalone forbidden packages, ADR-0029 codifies derive* vs create* distinction, CI optimization adds only a Bun install cache step without weakening gates.
impl_status: implemented
linear:
  - TRL-365
  - TRL-727
references:
  - packages/tracing/src/adapters/otel.ts
  - packages/tracing/package.json
  - docs/adr/0029-connector-extraction-and-the-with-packaging-model.md
  - .github/workflows/ci.yml
  - .github/actions/setup/action.yml
---

# Local Review Round 3: Observability, Docs, And CI Hygiene

- **Date:** 2026-05-16
- **Stack tip reviewed:** `trl-718-docs-close-http-and-observability-wording-before-versioning`

## Scope

- `packages/tracing/src/adapters/otel.ts`
- OTel lineage/status/buffering tests
- OTel and observability package docs
- ADR/package-boundary wording for Bun and OTel materializers
- CI setup action optimization

## Findings

No P0/P1/P2 findings in this lane.

## Review Notes

- `@ontrails/tracing/otel` remains a subpath export on `@ontrails/tracing`; no standalone `@ontrails/otel` package is present.
- `packages/tracing/package.json` has no OpenTelemetry SDK runtime dependency.
- `@ontrails/http/bun` remains a subpath export on `@ontrails/http`; no standalone `@ontrails/bun` package is present.
- ADR-0029 now distinguishes `derive*` projection APIs from `create*` runtime materializers and explicitly keeps platform-built runtime materializers under the owning surface package.
- Forbidden package names and publish commands appear only in explicit "do not create" or "do not use" doctrine.
- The scoped CI optimization only adds an `actions/cache@v4` step for Bun install artifacts before the existing `bun install --frozen-lockfile` step; it does not remove or weaken gates.

## Verification

- `bun run --cwd packages/tracing test` — pass, 135 tests
- `bun run --cwd packages/tracing typecheck` — pass
- `bun run --cwd packages/tracing lint` — pass
- `bun run docs:links` — pass, 114 Markdown files
- `bun run docs:snippets` — pass, 21 README files
- `bunx actionlint -ignore 'SC2129' .github/workflows/ci.yml` — pass
- `ruby -e "require 'yaml'; YAML.load_file('.github/actions/setup/action.yml')"` — pass
