---
'@ontrails/bun': major
---

Add `@ontrails/bun`, a Bun.serve adapter that projects `HttpRouteDefinition[]`
from `@ontrails/http` directly onto Bun's native routes API. Mirrors the
`createApp` + `surface` exported shape of `@ontrails/hono` but skips the Hono
dependency for Bun-only deployments. v0 covers GET/POST happy paths, the
documented JSON-body error sentinels (413, 400 for malformed Content-Length,
400 for malformed JSON), redacted 500 for non-Trails errors, and a 404 fetch
fallback. Webhook trails (`inputSource: 'webhook'`) are rejected at
`createApp()` time with a `ValidationError` rather than silently 501-ing at
request time; webhook support will land in a follow-up.

The `major` bump keeps the package in lockstep with the rest of the
`@ontrails/*` workspace (matching the precedent set by `wayfinder-shell` and
`api-simplification-beta4`).

Also adds `bun` to the `allowedPackages` list for the
`trails-local/no-console-in-packages` oxlint rule, matching the precedent for
`drizzle`, `hono`, `logging`, and `observe`. The adapter routes generic-error
diagnostics through `console.error` at the same boundary the hono adapter uses.
