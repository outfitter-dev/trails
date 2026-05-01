---
name: trails-error-format
description: Use when reviewing Trails error taxonomy, surface error projection, redaction, retryability, or Result-vs-throw boundaries. Helps distinguish runtime failures from intentional construction and host-boundary throws.
---

# Trails Error Format

Use this skill when a change touches error classes, `Result.err`, CLI/HTTP/MCP projection, redaction, retry behavior, or host construction boundaries.

## Workflow

1. Classify the failure boundary:
   - Trail runtime failures return `Result.err(new TrailsErrorSubclass(...))`.
   - Surface presentation maps existing `TrailsError` values to transport-specific output.
   - Construction or programmer errors may throw when the boundary is explicit.
2. Choose the most specific `TrailsError` subclass for runtime failures.
3. Trace projection data back to owner exports such as error categories, retryability, and status or code maps.
4. Check redaction at the boundary that exposes data to agents, users, logs, or transport clients.
5. Verify tests cover both the raw error object and the projected surface shape when both are public behavior.

## Authoritative Sources

- `plugin/skills/trails/references/error-taxonomy.md`
- `docs/rule-design.md`
- `packages/core/src/errors.ts`
- `packages/core/src/transport-error-map.ts`
- Surface packages: CLI, MCP, HTTP, and Hono.

## Advisory Context

- TRL-564 / PR #300 for host-boundary examples.

## Must Not

- Do not collapse all throws into bugs; verify whether the throw is a construction or programmer-error boundary.
- Do not add parallel error-code maps when core owner data already exposes the mapping.
- Do not leak raw native `Error` values through public runtime Results when a specific `TrailsError` exists.
- Do not put surface projection policy inside trail blaze logic.

## Output

Return:

- Runtime, projection, redaction, or host-boundary classification.
- Expected error subclass and category.
- Owner mapping or projection source.
- Surface behavior checked.
- Missing tests or follow-up issue.
