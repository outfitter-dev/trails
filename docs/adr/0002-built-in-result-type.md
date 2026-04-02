---
id: 2
slug: built-in-result-type
title: Built-In Result Type
status: accepted
created: 2026-03-29
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
---

# ADR-0002: Built-In Result Type

## Context

### The problem

Trails implementations never throw. That's a hard rule — [ADR-0000](0000-core-premise.md) established it. Input in, `Result` out. The warden enforces it. If an implementation throws, it's a bug.

This means Result isn't optional infrastructure. It's the return type of every trail, the input to every surface renderer, the thing every error flows through. The framework's contract model depends on it completely.

### External options

Several good Result libraries exist in the TypeScript ecosystem — `neverthrow`[^neverthrow], `oxide.ts`[^oxide], `@badrap/result`[^badrap], `true-myth`[^true-myth], among others. I evaluated the main ones before deciding. The tradeoffs:

- **`neverthrow`** is the most popular. It's well-maintained and has a reasonable API. But it carries its own error model, its own combinators, and its own opinions about how errors compose. Trails has a 13-class error taxonomy with deterministic surface mappings. Bridging neverthrow's error model to ours would mean wrapping everything anyway.
- **`oxide.ts`** and **`true-myth`** are Rust-inspired and thorough. They're also larger than what we need and bring opinions about Option types, pattern matching, and other primitives that don't align with Trails' scope.
- **`@badrap/result`** is tiny and close to what we need. But it doesn't handle serialization, and serialization is a first-class concern for us.

The common issue: none of these libraries know about `TrailsError`. None of them know that a `NotFoundError` maps to HTTP 404, CLI exit code 2, and JSON-RPC -32601. None of them can serialize a Result across a process boundary and reconstruct it on the other side. That integration is the reason we need our own.

### Serialization matters

Trails cross process boundaries constantly. A CLI invokes an MCP server. An HTTP response encodes a trail result. A `ctx.follow()` call might cross a network hop in the future. The Result type needs to serialize cleanly — including handling circular references, wrapping parse failures as `ValidationError`, and mapping HTTP status codes back to the right `TrailsError` subclass on the way in.

This isn't something you bolt on after the fact. It's a design constraint that shapes the API.

## Decision

### Result is a discriminated union

`Result<T, E>` is a union of `Ok<T, E>` and `Err<E>`. The `Ok` and `Err` classes are not exported — they're implementation details. Everything goes through `Result.ok()` and `Result.err()` constructors.

```typescript
const success = Result.ok({ name: 'Alpha', type: 'concept' });
const failure = Result.err(new NotFoundError('Trail not found'));
```

### Instance methods

Both `Ok` and `Err` carry the same method signatures. No runtime type checks needed — you call the method and the right branch executes:

- **`isOk()` / `isErr()`** — type guards for narrowing
- **`map(fn)`** — transform the success value, short-circuit on error
- **`flatMap(fn)`** — chain operations that themselves return Result
- **`mapErr(fn)`** — transform the error, short-circuit on success
- **`match({ ok, err })`** — exhaustive branching
- **`unwrap()`** — extract the value or throw (testing only — never in implementations)
- **`unwrapOr(fallback)`** — extract the value or use a default

This is a small, deliberate API. Every method earns its place by being used in the framework itself.

### Static methods

The `Result` namespace carries four static methods:

**`Result.ok(value)` / `Result.err(error)`** — constructors. `Result.ok()` with no argument returns `Result<void, never>`, which is how trails that produce no output signal success.

**`Result.combine(results)`** — takes an array of Results and returns either `Ok` with all values or the first `Err`. Used internally by `testExamples` and anywhere multiple trail results need to be aggregated.

**`Result.toJson(value)`** — serializes to JSON with circular reference handling. Tracks the current ancestor chain (not every object ever seen), so DAGs serialize correctly while true cycles become `[Circular]`. Returns `Result<string, InternalError>`.

**`Result.fromJson(json)`** — parses JSON, wrapping `SyntaxError` as `ValidationError` with the first 200 characters of input as context. Returns `Result<unknown, ValidationError>`.

**`Result.fromFetch(input, init)`** — wraps the standard `fetch` API. Network failures become `NetworkError`. Abort signals become `CancelledError`. HTTP status codes map to the appropriate `TrailsError` subclass:

```typescript
const result = await Result.fromFetch('https://api.example.com/data');
// 401 → AuthError, 404 → NotFoundError, 429 → RateLimitError (with retryAfter), etc.
```

### Error taxonomy integration

The Result type exists in tight partnership with the error taxonomy. Trails defines 13 concrete error classes, each extending `TrailsError` with a `category` and `retryable` flag:

| Error class | Category | HTTP | CLI exit | JSON-RPC | Retryable |
| --- | --- | --- | --- | --- | --- |
| `ValidationError` | `validation` | 400 | 1 | -32602 | no |
| `AmbiguousError` | `validation` | 400 | 1 | -32602 | no |
| `NotFoundError` | `not_found` | 404 | 2 | -32601 | no |
| `ConflictError` | `conflict` | 409 | 3 | -32603 | no |
| `AlreadyExistsError` | `conflict` | 409 | 3 | -32603 | no |
| `PermissionError` | `permission` | 403 | 4 | -32600 | no |
| `TimeoutError` | `timeout` | 504 | 5 | -32603 | yes |
| `RateLimitError` | `rate_limit` | 429 | 6 | -32603 | yes |
| `NetworkError` | `network` | 502 | 7 | -32603 | yes |
| `InternalError` | `internal` | 500 | 8 | -32603 | no |
| `AssertionError` | `internal` | 500 | 8 | -32603 | no |
| `AuthError` | `auth` | 401 | 9 | -32600 | no |
| `CancelledError` | `cancelled` | 499 | 130 | -32603 | no |

The mapping is deterministic and lives in three lookup tables (`statusCodeMap`, `exitCodeMap`, `jsonRpcCodeMap`). The developer returns `Result.err(new NotFoundError('User not found'))`. The framework looks up the category and renders the right status code, exit code, or JSON-RPC code for the current surface. The developer never thinks about surface-specific error codes.

### Retryable is a property of the error, not the caller

`TimeoutError`, `RateLimitError`, and `NetworkError` are retryable. Everything else is not. This is declared on the error class itself (`readonly retryable = true`), not decided by the caller. `RateLimitError` additionally carries an optional `retryAfter` field parsed from HTTP headers.

The `isRetryable(error)` helper checks the category map. Detours (trail-level recovery strategies) use this to decide whether to retry automatically. The caller doesn't implement retry logic — the error taxonomy already encodes whether retrying makes sense.

## Consequences

### Positive

- **Zero dependencies.** The Result type is ~80 effective LOC across `result.ts` and a companion `fetch.ts`. No transitive dependency tree. No version conflicts. No supply chain surface.
- **Serialization is built in.** `toJson`, `fromJson`, and `fromFetch` handle the common boundary-crossing cases. DAG-safe circular reference handling means complex object graphs don't silently fail.
- **Error taxonomy is framework knowledge.** Developers return the right error type. The framework handles the mapping. This eliminates an entire class of inconsistency where the same error produces different status codes on different surfaces.
- **Type narrowing works.** `isOk()` and `isErr()` are proper type guards. After checking, TypeScript knows the shape. No casts, no assertions.

### Tradeoffs

- **We maintain ~80 LOC of core infrastructure.** If the Result implementation has a bug, we fix it ourselves. No upstream community to catch edge cases. In practice, the API surface is small enough that this is manageable — the combinators are individually trivial.
- **No community ecosystem.** Libraries built around `neverthrow` or `oxide.ts` won't compose directly with our Result. This is acceptable because trail implementations are self-contained — they don't pass Results to third-party code.
- **`unwrap()` exists and it throws.** This is intentional for testing (`expectOk` uses it internally) but would be wrong in production trail code. The warden could enforce this in the future.

### What this does NOT decide

- Whether Result will gain additional combinators (e.g., `Result.wrap()` for try/catch conversion, `Result.all()` for parallel results). If the framework needs them, they'll be added. The bar is: the framework uses it internally, not "it might be nice."
- Whether the error taxonomy will grow beyond 13 classes. New categories would need new entries in all three mapping tables, which is a deliberate friction that prevents casual additions.
- How Result serialization evolves for cross-network `follow` calls in the future `trailblaze` runtime.

## References

- [ADR-0000: Core Premise](0000-core-premise.md) — establishes Result as mandatory and implementations as pure
- [ADR-0001: Naming Conventions](0001-naming-conventions.md) — naming rules for `Result.ok()`, `Result.err()`, and the `validate*` family
- [API Reference](../api-reference.md) — the canonical public API surface
- [Architecture](../architecture.md) — system architecture and how Result flows through surfaces

[^neverthrow]: [neverthrow](https://github.com/supermacro/neverthrow) — the most popular TypeScript Result library
[^oxide]: [oxide.ts](https://github.com/neoncitylights/oxide.ts) — Rust-inspired Result and Option types for TypeScript
[^badrap]: [@badrap/result](https://github.com/nicolo-ribaudo/result) — minimal Result type for TypeScript
[^true-myth]: [true-myth](https://github.com/true-myth/true-myth) — idiomatic Maybe and Result for TypeScript
