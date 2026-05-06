# M2 Error Contract Audit

Date: 2026-05-06
Issue: TRL-633
Branch: trl-633-audit-trailserror-taxonomy-and-surface-mappings

## Scope

This audit covers the `@ontrails/core` error taxonomy, serialization,
retryability, CLI/HTTP/Hono/MCP mappings, OpenAPI projection posture, active
docs/ADR posture, and Warden coverage opportunities.

No Trails-related skill was loaded during the audit.

## Taxonomy Matrix

Authority lives in `packages/core/src/errors.ts`, where categories, subclasses,
registry, codes, and retryability are colocated. Surface code projection is
derived from `codesByCategory[error.category]` in
`packages/core/src/transport-error-map.ts`.

| Class | Category | CLI | HTTP | JSON-RPC/MCP | Retryable | Runtime status |
| --- | --- | ---: | ---: | ---: | --- | --- |
| `ValidationError` | `validation` | 1 | 400 | -32602 | no | Heavily used |
| `AmbiguousError` | `validation` | 1 | 400 | -32602 | no | Used |
| `NotFoundError` | `not_found` | 2 | 404 | -32601 | no | Used |
| `AlreadyExistsError` | `conflict` | 3 | 409 | -32603 | no | Used |
| `ConflictError` | `conflict` | 3 | 409 | -32603 | no | Used |
| `PermissionError` | `permission` | 4 | 403 | -32600 | no | Used |
| `PermitError` | `permission` | 4 | 403 | -32600 | no | Used by permit enforcement |
| `AuthError` | `auth` | 9 | 401 | -32600 | no | Used by auth parsing/boundaries |
| `TimeoutError` | `timeout` | 5 | 504 | -32603 | yes | Used |
| `RateLimitError` | `rate_limit` | 6 | 429 | -32603 | yes | Used; preserves `retryAfter` |
| `NetworkError` | `network` | 7 | 502 | -32603 | yes | Used |
| `InternalError` | `internal` | 8 | 500 | -32603 | no | Heavily used |
| `AssertionError` | `internal` | 8 | 500 | -32603 | no | Serialization/test oriented |
| `DerivationError` | `internal` | 8 | 500 | -32603 | no | Used by derivation |
| `RecoverableCompletionError` | `internal` | 8 | 500 | -32603 | no | CLI completion recovery |
| `CancelledError` | `cancelled` | 130 | 499 | -32603 | no | Used |
| `RetryExhaustedError` | dynamic | wrapped | wrapped | wrapped | no | Detour exhaustion wrapper |

## Surface Matrix

| Surface | Verified behavior |
| --- | --- |
| CLI | `toCommander` writes `Error: ${error.message}` and exits through `mapSurfaceError("cli", error)`; unknown failures fall back to exit 8. |
| HTTP route model | `deriveHttpRoutes()` returns `Result<..., Error>` and leaves status projection to adapters. |
| Hono HTTP | `mapErrorResponse()` uses `projectSurfaceError("http", error)` for `TrailsError`; non-`TrailsError` public bodies are generic 500s. |
| Vite | Vite is a pass-through wrapper around a fetch-style app response and does not map taxonomy itself. |
| MCP | Tool-result errors use text content plus `_meta["ontrails/error"]` from `projectSurfaceError("mcp", error)`. |
| JSON-RPC | No standalone JSON-RPC surface was found. MCP reuses the JSON-RPC-family code map, while docs say trail failures are MCP tool-result errors rather than protocol errors. |

## Findings

### M2-1: Specialized error identity does not fully round-trip through serialization

Evidence:

- `packages/core/src/errors.ts` exports `RetryExhaustedError` as a real taxonomy
  class with dynamic category/cause/attempt metadata.
- `packages/core/src/serialization.ts` does not have constructor entries for
  `RetryExhaustedError` or `RecoverableCompletionError`.
- Unknown serialized class names fall back to category reconstruction.

Impact: `RetryExhaustedError<NotFoundError>` can deserialize as the wrapped
category class rather than preserving the wrapper identity, while
`RecoverableCompletionError` can deserialize as `InternalError`.

Recommended follow-up: preserve dynamic and specialized `TrailsError` identity
through serialization, or explicitly document the lossy boundary and adjust
tests to assert it.

### M2-2: Hono does not pass HTTP auth context into route execution

Evidence:

- `packages/http/src/build.ts` supports `resolvePermit` and request headers in
  the HTTP route model.
- `connectors/hono/src/surface.ts` `CreateAppOptions` does not expose
  `resolvePermit`.
- Hono route execution omits the fourth `{ headers }` context when invoking the
  derived route.

Impact: HTTP auth errors are mapped in the framework route model, but the
materialized Hono surface cannot currently exercise the same permit-resolution
path from request headers.

Recommended follow-up: expose `resolvePermit` on the Hono connector, pass
request headers into route execution, and add Hono tests for malformed
authorization and missing scopes.

### M2-3: Error redaction posture is not taxonomy-owned

Evidence:

- `serializeError()` includes raw `message`, `stack`, and `context`.
- Hono hides non-`TrailsError` public messages, but logs the raw error object.
- `TrailsError` public responses expose the projected message directly.

Impact: the repo has useful local safeguards, but no single contract that says
which error fields are public body material, diagnostic material, serialized
process-boundary material, or log-only material.

Recommended follow-up: define and enforce a redaction contract for
`TrailsError` projection across CLI, Hono, MCP, and serialization.

### M2-4: ADR-0002 is stale against the owner registry

Evidence:

- `docs/adr/0002-built-in-result-type.md` still describes "15 fixed-category
  error classes" and omits `RecoverableCompletionError`.
- Current architecture docs, core docs, HTTP docs, and the code owner registry
  have the newer taxonomy shape.

Impact: this is localized doctrine drift, but error taxonomy docs should not
need manual rediscovery before v1.

Recommended follow-up: update ADR-0002 and add a registry-backed check for
public taxonomy docs.

### M2-5: Serialization and surface-mapping tests are hand-maintained

Evidence:

- `packages/core/src/__tests__/serialization.test.ts` labels one table as all
  subclasses but omits `DerivationError`, `RecoverableCompletionError`, and
  `RetryExhaustedError`.
- `packages/core/src/__tests__/transport-error-map.test.ts` covers categories
  but omits direct cases for `PermitError` and `RecoverableCompletionError`.

Impact: the code paths are mostly category-complete today, but hand-maintained
test tables are exactly how taxonomy drift reappears.

Recommended follow-up: generate serialization and mapping tests from
`errorClasses`, with explicit dynamic cases for `RetryExhaustedError`.

## Follow-up Issue Set

The M2 follow-up set should track:

1. (TRL-649) Preserve dynamic and specialized `TrailsError` identity in
   serialization.
2. (TRL-650) Wire HTTP permit resolution through the Hono connector.
3. (TRL-651) Define and enforce `TrailsError` redaction policy across surfaces.
4. (TRL-652) Make taxonomy docs and surface mapping/serialization tests
   owner-registry driven.

## Audit Conclusion

The taxonomy owner model is strong: categories, classes, retryability, and
surface codes live together. The remaining M2 risk is at the edges:
serialization loses specialized identities, Hono does not yet exercise HTTP
auth resolution, redaction is not centralized, and docs/tests can drift because
they are not registry-driven.
