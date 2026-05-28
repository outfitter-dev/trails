---
created: 2026-05-17T15:32:45Z
updated: 2026-05-20T03:58:14Z
description: Local review round 1 for HTTP kernel and surface security. Reviewed packages/http/src/fetch.ts, bun.ts, adapters/hono/src/surface.ts, and parity tests. Found and fixed one P2: aborted JSON body reads projected as internal 500 instead of cancelled; fix added CancelledError to fetch.ts and a covering test. No remaining P0/P1/P2 after fix.
impl_status: implemented
linear:
  - TRL-715
references:
  - packages/http/src/fetch.ts
  - packages/http/src/bun.ts
  - adapters/hono/src/surface.ts
  - packages/http/src/__tests__/fetch.test.ts
---

# Local Review Round 1: HTTP Kernel And Surface Security

Date: 2026-05-16
Stack tip reviewed: `trl-718-docs-close-http-and-observability-wording-before-versioning`

## Scope

- `packages/http/src/fetch.ts`
- `packages/http/src/bun.ts`
- `adapters/hono/src/surface.ts`
- HTTP/Bun/Hono parity tests and public HTTP docs

## Findings

### P2 - Fixed: aborted JSON body reads projected as internal 500

The Web Fetch kernel threw a native `Error('Request aborted')` while reading a JSON body from an already-aborted request. That native error flowed through the generic error path and projected as an internal 500 instead of the HTTP taxonomy's `cancelled` response.

Fix landed on lowest owning branch `TRL-715`:

- `packages/http/src/fetch.ts` now throws `CancelledError('Request aborted')`.
- `packages/http/src/__tests__/fetch.test.ts` covers aborted body reads returning HTTP 499 with `category: "cancelled"`.
- Graphite restacked every descendant branch.

## Follow-up Review Result

No remaining P0/P1/P2 findings in this lane after the fix.

## Verification

- `bun run --cwd packages/http test` — pass, 138 tests
- `bun run --cwd adapters/hono test` — pass, 45 tests
- `bun run --cwd packages/http typecheck` — pass
- `bun run --cwd adapters/hono typecheck` — pass
- `bun run --cwd packages/http lint` — pass
- `bun run format:check` — pass
- `git diff --check` — pass
