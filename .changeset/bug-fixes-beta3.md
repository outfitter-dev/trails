---
"@ontrails/core": minor
"@ontrails/cli": minor
"@ontrails/mcp": minor
"@ontrails/testing": minor
"@ontrails/warden": minor
---

Bug fixes across all trailhead packages found via parallel Codex review.

**core**: Fix Result.toJson false circular detection on DAGs, deserializeError subclass round-trip, topo cross-kind ID collisions, validateTopo multi-node cycle detection, error example input validation bypass, and deriveFields array type collapse.

**cli**: Switch trailhead to parseAsync for proper async error handling, add boolean flag negation (--no-flag), and strict number parsing that rejects partial input.

**mcp**: Align BlobRef with core (including ReadableStream support) and detect tool-name collisions after normalization.

**testing**: Include trails in testContracts validation, with cross-context awareness.

**warden**: Collect trail detour targets, validate detour refs in trail specs, and stop implementation-returns-result from walking into nested function bodies.
