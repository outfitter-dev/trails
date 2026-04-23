# Why Trails

## The Philosophy

**Author what's new. Derive what's known. Override what's wrong.**

When you define a trail, you author the things only you know: the input schema, the output schema, the implementation, and the examples that specify behavior. Everything else — CLI flags, MCP tool definitions, test assertions, error codes, command names — is derived from what you already wrote. If the derivation is wrong for your case, you override it.

This is DRY applied not just to code, but to information. Frameworks have always been good at eliminating duplicate code. Trails extends that principle to duplicate authorship — across the entire surface area of a project, from the implementation to the CLI to the MCP tools to the tests to the agent documentation.

Trails is Bun-native — the framework uses Bun APIs throughout for I/O, hashing, discovery, and storage. But the shipped surfaces it produces are universally consumable: CLI binaries, MCP servers, and HTTP endpoints work with any runtime on the consuming side. WebSocket is part of the architecture, but still planned.

---

## The Problem

Agents write good code, fast. But they write code that drifts.

An agent that builds `users` routes on Monday and `billing` routes on Thursday produces slightly different patterns — different error formats, different validation approaches, different response envelopes. A human reviewing the PR might catch it. Another agent inheriting the codebase won't — it reads what's there and perpetuates whatever it finds first.

The problem isn't speed. The problem is that every decision is freeform. Parameter names, error shapes, validation placement, response formatting — an agent using Express or Fastify makes all of these choices from scratch, every time, in every file.

Trails eliminates the freeform decisions. An agent writing a trail can't use different parameter names across CLI and MCP — there's one Zod schema. It can't return unstructured errors — `Result<T, Error>` is the only return path. It can't forget input validation — Zod runs at the boundary for every surface, every time.

These aren't lint rules. They're structural constraints. The framework makes inconsistency require more effort than consistency. That's the principle we call: **drift is structurally harder than alignment.**

---

## How It Works

A trail is a typed function with a Zod schema, examples, and metadata:

```typescript
import { trail, Result, NotFoundError } from '@ontrails/core';
import { z } from 'zod';

export const show = trail('entity.show', {
  input: z.object({
    name: z.string().describe('Entity name to look up'),
  }),
  output: EntitySchema,
  intent: 'read',
  examples: [
    { name: 'Found', input: { name: 'Alpha' } },
    {
      name: 'Not found',
      input: { name: 'nonexistent' },
      error: 'NotFoundError',
    },
  ],
  blaze: (input, ctx) => {
    const entity = store.get(input.name);
    if (!entity)
      return Result.err(new NotFoundError(`Entity "${input.name}" not found`));
    return Result.ok(entity);
  },
});
```

Collect trails into an app with `topo()`. Open it on any surface with `surface()`:

```typescript
const graph = topo('myapp', entityModule, searchModule);

// CLI
import { surface } from '@ontrails/cli/commander';
await surface(graph);

// MCP
import { surface as mcpSurface } from '@ontrails/mcp';
await mcpSurface(graph);
```

The same topo can also open on HTTP today via `@ontrails/hono`. WebSocket follows the same peer-surface model, but does not ship yet.

One definition. Every surface. The rest is derived.

Pure trails can return `Result` directly. Trails with `crosses` and I/O-bound trails can stay `async`. Core normalizes both forms to one awaitable runtime shape before surfaces and layers execute them.

---

## The Services Problem

Pure trail functions are great until they need a database. The typical escape hatch — constructing clients inline or importing singletons — couples implementations to concrete infrastructure and makes testing painful.

Trails solves this with `resource()` declarations. A resource defines its factory, a `mock` factory for tests, and an optional `dispose` hook for cleanup. Trails declare their dependencies with `resources: [...]` and access them through `db.from(ctx)`. The framework manages the lifecycle, surfaces can inspect the dependency graph, and `testAll(graph)` resolves mocks automatically.

The result: implementations stay pure (input in, `Result` out), infrastructure is declared rather than imported, and the entire app remains testable without configuration.

---

## The Information Architecture

Every piece of information in a Trails app has a clear ownership model. Six categories, from what you write to what the system learns. (See [Architecture](./architecture.md#information-architecture) for the full reference tables.)

- **Authored:** New information only you know — Zod schemas, intent and metadata, examples, the implementation, trail IDs. Everything else flows from these.
- **Projected:** Mechanically derived, guaranteed correct — CLI flags from Zod fields, MCP tool names from trail IDs, exit codes from error classes. Projections can't be wrong because they're computed from the source.
- **Enforced:** Constrained by the type system — output schemas bound the return type, `Result<T, Error>` eliminates throw/catch, `TrailContext` scopes what the implementation can access. The compiler makes non-compliance an error.
- **Inferred:** Detected by static analysis, best-effort — which trails a trail crosses (from `ctx.cross()` calls), error types returned (from `Result.err()` patterns). Warden verifies these. Useful for governance, not guaranteed.
- **Observed:** Learned from runtime (future) — error distributions, latency profiles, resource usage patterns from the tracing system. Observations close the loop between declared intent and actual behavior.
- **Overridden:** When derivation doesn't fit — any derived value can be explicitly set when the default is wrong. Overrides are escape hatches, visible in the surface map. If you're overriding everything, the derivation rules are wrong.

The design heuristic: if the developer has to author information the framework already has, that's a framework bug. Derive it. If it can't be derived, it earns a place on the trail spec. If it can be derived but might be wrong sometimes, derive it with an override.

---

## The Trail as Specification

Most frameworks optimize for flexibility — the handler can do anything, and correctness is maintained through conventions, documentation, and review.

Trails makes a different tradeoff. The trail declaration creates a bounded environment:

- **`output: schema`** constrains the return type. The implementation can't return data the contract doesn't describe.
- **`Result<T, Error>`** eliminates throw/catch. Every code path returns a typed result.
- **`examples`** specify concrete inputs plus expected results or error classes. `testExamples(graph)` runs them as assertions. One authoring act — three purposes: specification for builders, documentation for consumers, test coverage for CI.
- **`intent` / `idempotent`** are behavioral assertions that surfaces honor. `intent: 'read'` means no confirmation prompts on CLI, `readOnlyHint` on MCP, GET on HTTP. These aren't suggestions — they're projections.

The implementation satisfies the specification. The framework enforces the boundaries. An agent building a trail writes the irreducible information — schema, examples, logic — and the framework handles the rest.

This is also a fundamentally better task description for an agent than "write a handler that does X." It's: "here's the input shape, here's the output shape, here are concrete examples, here are the safety properties. Write the code that satisfies all of this." That's a constrained, verifiable, testable task — the kind agents are best at.

---

## Examples Are Tests

This deserves emphasis because it changes how you think about testing.

In most frameworks, tests are a separate authoring activity. You write the handler, then you write tests for the handler. Two artifacts, maintained separately, that can drift from each other.

In Trails, examples on the trail definition ARE the tests:

```typescript
testExamples(graph);
```

One line. Every trail. Every example. Progressive assertion — full match when `expected` is declared, schema validation when it isn't, error type checking when `error` is declared.

Examples serve triple duty:

1. **Specification** for agents building the implementation
2. **Documentation** for agents consuming the trail
3. **Assertions** for CI verifying correctness

One write, three reads. If someone changes the business rule, they change the example, the test fails, and the implementation is updated to match. The examples are the source of truth — not a separate test file that hopes to stay in sync.

---

## Where Trails Fits

Great tools already exist for each surface. tRPC, Hono, and Fastify are excellent for HTTP. Commander and oclif are battle-tested for CLIs. FastMCP and the official SDK make MCP server development straightforward. NestJS spans multiple transports with a mature ecosystem.

Trails doesn't try to replace any of them. It occupies a different layer: the **contract layer** that sits above individual surface implementations. A trail definition captures the schema, examples, error types, intent and metadata, and composition graph in one place. Surface connectors — CLI, MCP, and HTTP today, with WebSocket planned — project that contract into whatever runtime format the surface needs.

The value isn't in being better at any single surface. It's in making the contract the source of truth so that every surface stays consistent with it — not because anyone was careful, but because the framework derives each surface from the same definition.

---

## Where This Came From

Trails wasn't designed from framework theory. It emerged from 18 months of building with agents — paying attention to every time things went wrong.

- Adding MCP to an existing CLI app required restating every schema, duplicating error handling, and maintaining two parallel implementations.
- Agents building routes in different sessions produced working but structurally inconsistent code — different error formats, different validation approaches, different naming conventions.
- Test suites drifted from implementations because they were separate artifacts maintained by separate authoring acts.
- Agent-to-agent communication was fragile because there was no machine-readable contract — just freeform documentation that might be outdated.

Each of these failures traced back to the same root cause: **the same information was being authored in multiple places, and the copies diverged.**

The questions that became Trails:

- How do we make it structurally hard to do anything but the right thing?
- How do we make agents consistent in their work without relying on memory they don't have?
- What if the contract wasn't documentation about the implementation, but the specification that bounds it?

The answers became the principles: author what's new, derive what's known, override what's wrong. Make drift structurally harder than alignment. The trail is the product, not the surface.

---

## What's Next

The v1 implementation delivers the foundation: Result types, error taxonomy, trail, signal, and contour definitions, CLI/MCP/HTTP surfaces, contract-driven testing, schema governance, and the warden. These establish the contract layer and prove the core loop — define once, surface everywhere.

The architecture points toward capabilities that follow naturally — resource capability shaping, derived dependency graphs, cross-app contract negotiation, implementation synthesis from examples. Each follows from the same principle: if the information exists in the system, don't ask the developer to restate it.

See [Horizons](./horizons.md) for the full roadmap of what this architecture unlocks.

---

**Author what's new. Derive what's known. Override what's wrong.**

That's Trails.
