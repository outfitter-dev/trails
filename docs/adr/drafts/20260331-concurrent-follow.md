---
slug: concurrent-follow
title: Concurrent Follow Composition
status: draft
created: 2026-03-31
updated: 2026-04-01
owners: ['[galligan](https://github.com/galligan)']
---

# ADR: Concurrent Follow Composition

## Context

### Sequential composition today

`ctx.follow()` is the composition primitive. One trail follows another by ID, passing input and receiving a Result. The calling trail controls flow with normal TypeScript: branch on errors, pass results forward, compose sequentially. The `follow` declaration is a flat array of trail IDs the trail might call. The warden verifies declarations match code.

```typescript
const user = await ctx.follow('user.create', { name: input.name });
if (user.isErr()) return user;
const welcome = await ctx.follow('notify.welcome', { userId: user.value.id });
```

This is powerful because it's just code. The developer writes exactly what they mean. No DSL, no workflow engine, no graph builder. TypeScript is the orchestration language.

### What sequential composition can't express

Real workflows have independent branches. Three notifications that don't depend on each other. Two data sources that can be fetched concurrently. A fan-out to multiple providers followed by a merge. Today, these are expressed sequentially:

```typescript
// These are independent but run one after another
const email = await ctx.follow('notify.email', { userId });
const sms = await ctx.follow('notify.sms', { userId });
const push = await ctx.follow('notify.push', { userId });
```

This wastes time. If email takes 150ms, sms 180ms, and push 120ms, the sequential total is 450ms. Concurrent execution would take 180ms (the longest branch). For three notifications that's annoying. For twenty parallel API calls it's a real bottleneck.

More importantly, the framework can't see the developer's intent. Survey reports three follows. Crumbs records three sequential spans. Neither knows the developer wanted concurrency. The code doesn't express what the developer means.

### The composition patterns people actually build

Examining real applications reveals a small set of composition shapes:

**Fan-out.** Multiple independent follows, all concurrent. Partial failure may be acceptable. The most common parallel pattern.

**Fan-out/fan-in.** Concurrent follows, then a step that merges their results. The merge depends on all (or some) branches completing.

**Conditional branching.** Follow different trails based on runtime conditions. Only one path executes.

**Optional enrichment.** Follow a trail if it succeeds, continue without it if it fails. The follow is declared but not required.

**Ordered pipeline.** Step A before step B before step C. Each depends on the previous result.

Of these, only fan-out and fan-out/fan-in need a new runtime primitive. Conditional branching is already just `if/else` in TypeScript. Optional enrichment is already just "don't propagate the error." Ordered pipelines are already sequential `await`. The gap is concurrency.

## Decision

### Overload `ctx.follow()` for concurrent composition

`ctx.follow()` gains an array overload. When called with an array of `[trailId, input]` tuples, it executes all branches concurrently and returns a `Result[]` in the same order:

```typescript
// Sequential (unchanged): string + input → single Result
const result = await ctx.follow('notify.email', { userId });

// Concurrent (new): array of tuples → Result[]
const results = await ctx.follow([
  ['notify.email', { userId }],
  ['notify.sms', { userId }],
  ['notify.push', { userId }],
]);
```

One method. The argument shape is the signal. String argument: sequential, one trail, one Result. Array argument: concurrent, multiple trails, Result array. TypeScript discriminates cleanly between the two overloads.

### Why overload instead of a new method

"Follow this trail" and "follow these trails" are the same verb. The plural form is inherently concurrent because if the developer wanted them sequential, they'd write three separate awaits. There's no ambiguity about what the array form means.

The array form reads naturally in every composition pattern:

```typescript
// Sequential dependency, then fan-out
const order = await ctx.follow('order.validate', input);
if (order.isErr()) return order;

const [payment, inventory] = await ctx.follow([
  ['billing.charge', { amount: order.value.total }],
  ['inventory.reserve', { items: order.value.items }],
]);

// Fan-out, then fan-in
const [users, orders] = await ctx.follow([
  ['data.extract-users', { since: input.since }],
  ['data.extract-orders', { since: input.since }],
]);
if (users.isErr() || orders.isErr()) return Result.err(new InternalError('extraction failed'));

const report = await ctx.follow('data.generate-report', {
  users: users.value,
  orders: orders.value,
});
```

### Execution semantics

The array form uses `Promise.all` under the hood. All branches start concurrently. All branches run to completion. The returned `Result[]` is in the same order as the input array, regardless of completion order.

No short-circuit on failure. If the first branch fails, the remaining branches still execute. The caller decides how to handle partial failure after all branches complete. This is the least surprising behavior and matches how `Promise.all` works when each promise catches its own errors (which `executeTrail` always does, since trails return `Result`, not exceptions).

### Concurrency limiting

An optional second argument on the array form controls concurrency:

```typescript
// Fan out to 20 sources, limit to 5 concurrent
const results = await ctx.follow([
  ['source.a', query],
  ['source.b', query],
  // ...18 more...
], { concurrency: 5 });
```

Default is unbounded. When a concurrency limit is set, branches execute in batches: the first N start, and as each completes, the next pending branch starts. The result array preserves input order regardless of execution order.

The single-follow overload never sees the options argument. It doesn't need concurrency control because it's one trail.

### Partial failure handling

The Result model already handles optionality. No new primitive needed:

```typescript
const results = await ctx.follow([
  ['notify.email', { userId }],
  ['notify.sms', { userId }],
  ['notify.push', { userId }],
]);

// All required: any failure fails the trail
if (results.some(r => r.isErr())) {
  return Result.err(new InternalError('notification failed'));
}

// All optional (best effort): count successes
const sent = results.filter(r => r.isOk()).length;
return Result.ok({ sent, total: results.length });

// Mixed: some required, some optional
const [email, sms, push] = results;
if (email.isErr()) return email;  // email required
// sms and push are best-effort, continue regardless
return Result.ok({
  emailed: true,
  smsed: sms.isOk(),
  pushed: push.isOk(),
});
```

The developer expresses optionality by how they handle the Result, the same way they do with sequential follows today. No `optional: true` annotation. No framework concept of "optional follow." The Result model is the optionality primitive.

### The `follow` declaration stays flat

```typescript
follow: ['notify.email', 'notify.sms', 'notify.push', 'user.enrich'],
```

The declaration lists every trail this trail might follow. Whether those follows are sequential, concurrent, optional, or conditional is a runtime decision expressed in the implementation. The declaration is the vocabulary (what trails am I allowed to talk to). The implementation is the grammar (how I compose them).

The warden's job is unchanged: verify that every ID in a `ctx.follow()` call (single or array form) appears in the `follow` declaration. If you call something you didn't declare, error. If you declare something you never call, warning. Whether the follow is sequential or concurrent doesn't affect the governance rule.

### Crumbs records what actually happens

Crumbs doesn't need declaration hints to record composition shape. It observes it:

- Single `ctx.follow()` call → child span under the current trail's span.
- Array `ctx.follow()` call → sibling spans with concurrent timing under the current trail's span. Same parent, overlapping start timestamps.

Crumbs can derive "these three follows ran concurrently in 180ms" vs "these two follows ran sequentially totaling 300ms." The observation is ground truth, more accurate than any declaration would be.

With crumbs data available, survey can report observed composition patterns: "in the last 1000 executions, `notify.email`, `notify.sms`, and `notify.push` always run concurrently." That's observed information, not authored information.

### Scoping for concurrent branches

Each concurrent branch gets an independent service context. Two parallel trails writing to the same transaction is a recipe for race conditions. If branches need shared state, the developer uses the sequential form.

The parent trail's `permit`, `logger`, and `signal` (AbortSignal) propagate to all branches. Cancellation via the signal cancels all running branches.

## Alternatives considered

### `ctx.followAll()` as a separate method

```typescript
const results = await ctx.followAll([
  ['notify.email', { userId }],
  ['notify.sms', { userId }],
]);
```

This was the initial design. A new method specifically for parallel execution. Rejected because it adds vocabulary that isn't needed. "Follow all" is just "follow" with multiple targets. The array overload communicates the same thing without a new name. One method doing one conceptual thing (follow trails) is simpler than two methods for two modes of the same thing.

Adding `followAll` also opens the door to `followAny`, `followRace`, `followFirst`, and other combinators. Each is a new method on context, a new concept to learn, a new thing the warden must understand. The overload approach avoids this proliferation: `ctx.follow()` is the composition primitive, period.

### Structured `follow` declaration with groups and annotations

```typescript
follow: {
  'billing.charge': { },
  'notify.email': { group: 'notifications' },
  'notify.sms': { group: 'notifications', optional: true },
  'user.enrich': { optional: true },
},
```

This approach would let the declaration express composition shape: which follows are concurrent (grouped), which are optional, which are conditional. The warden could check that grouped follows are actually called concurrently, and that optional follows' errors aren't propagated.

Rejected for several reasons. The declaration becomes a second place where composition logic lives, separate from the implementation. The declaration can say `group: 'notifications'` but the code might call them sequentially. That's a new drift surface. The annotations are governance hints that duplicate information already present in the code's control flow.

The flat array is beautifully simple. It says "here's what I might call." Everything else is in the code, where TypeScript provides the full expressiveness of a real programming language. Adding structure to the declaration is adding a limited DSL that competes with TypeScript for expressing the same things.

If real usage reveals that the warden genuinely needs to know composition shape to provide valuable governance, the structured declaration can be added in a future ADR. But the flat array should be proven insufficient before adding complexity.

### `before`/`after`/`concurrent` annotations on declarations

```typescript
follow: {
  'step.a': { before: 'step.b' },
  'step.b': { after: 'step.a', before: 'step.c' },
  'step.c': { after: 'step.b' },
  'notify.email': { concurrent: 'notify.sms' },
},
```

This would let the declaration express ordering constraints and concurrency relationships. Rejected because `await` already is the ordering primitive. Writing `const a = await ctx.follow('step.a', input)` before `const b = await ctx.follow('step.b', a.value)` already expresses "A before B." The dependency is the data flow. Adding `before`/`after` annotations restates what the code says and can drift from it.

Concurrency relationships are similarly expressed by the array overload: if two follows appear in the same array, they're concurrent. If they're separate awaits, they're sequential. The code structure is the concurrency declaration.

### Workflow DSL or graph builder

```typescript
const workflow = compose(app)
  .start('order.validate')
  .then('billing.charge')
  .parallel('notify.email', 'notify.sms', 'notify.push')
  .when(order => order.total > 100, 'approval.request')
  .end('order.confirm');
```

A builder pattern that constructs a composition graph declaratively. Rejected because it introduces a parallel execution model that competes with the trail's `run` function. The `run` function is the implementation. It's TypeScript. It can do anything a graph builder can do and more: exception handling, local variables, complex conditions, early returns, logging, debugging.

Workflow DSLs exist for a reason (they're inspectable, serializable, replayable), but they trade expressiveness for structure. Trails' design philosophy is that the trail contract provides the structure (schemas, examples, governance) and the implementation provides the expressiveness (TypeScript). A workflow DSL would split implementations into two kinds: code implementations and graph implementations. That's the `trail()`/`hike()` split from ADR-003 revisited, and it was rejected for the same reason: a conceptual distinction that doesn't produce a structural difference.

### `ctx.follow.concurrent()` / `ctx.follow.optional()`

```typescript
const results = await ctx.follow.concurrent([
  ['notify.email', { userId }],
  ['notify.sms', { userId }],
]);

const enriched = await ctx.follow.optional('user.enrich', { userId });
```

Method chaining on `follow` with named modes. Rejected because `concurrent` is just the array overload (no new method needed), and `optional` is just "handle the Result without propagating the error" (no new method needed). Adding named modes for things the developer already expresses with normal code patterns adds API surface without adding capability.

The optional pattern in particular is dangerous to codify. What does `follow.optional` return when the follow fails? `null`? `undefined`? A default value? The Result model already answers this question clearly: you get a `Result`, you check it, you decide what to do. Adding `follow.optional` would hide the error handling, which is the opposite of what Result is designed for.

### Weighted or prioritized follows

```typescript
follow: {
  'provider.fast': { weight: 0.8 },
  'provider.slow': { weight: 0.2 },
},
```

Weights for load balancing or priority across concurrent follows. Rejected because this is a scheduling concern, not a composition concern. If a trail needs to route between providers based on load, latency, or preference, that logic belongs in the implementation or in a service that manages provider selection. The `follow` declaration is about what trails can be called, not how often or in what proportion.

### Automatic concurrency detection via static analysis

Instead of an explicit array overload, the framework could detect that three sequential `ctx.follow()` calls are independent (no data dependency between them) and run them concurrently automatically.

Rejected because implicit concurrency is a correctness hazard. Two follows may look independent (no data flow between them) but have hidden dependencies: shared external state, ordering requirements in a third system, rate limit interactions. The developer must opt in to concurrency because only the developer knows whether concurrent execution is safe.

## Consequences

### Positive

- **No new vocabulary.** `ctx.follow()` is still the one composition primitive. The developer learns one method. The array overload is a natural extension of the existing signature.
- **The declaration stays simple.** The `follow` array is still a flat list of trail IDs. No structural annotations, no groups, no ordering constraints. The declaration is the vocabulary. The code is the grammar.
- **Partial failure uses existing patterns.** The Result model handles optionality. The developer checks results and decides what's required vs optional. No new framework concept for optional follows.
- **Crumbs observes composition shape.** Concurrent follows produce sibling spans with overlapping timestamps. Sequential follows produce sequential spans. The observation is ground truth, not declaration.
- **Warden rules are unchanged.** The existing `follow-declarations` rule validates that every ID in a `ctx.follow()` call appears in the `follow` declaration. The rule works identically for single and array forms.
- **Concurrency control is opt-in.** The `{ concurrency: N }` option handles backpressure for large fan-outs without affecting the common case.

### Tradeoffs

- **Overloaded return type.** `ctx.follow()` returns `Result` for the single form and `Result[]` for the array form. TypeScript handles this with union discrimination, but the developer must know which form they used. In practice, the call site makes this unambiguous: if you destructure as an array, you used the array form.
- **No framework-level composition introspection before runtime.** Survey reports a flat follow list. It doesn't know which follows are concurrent, optional, or conditional until crumbs observes actual execution. This is a deliberate tradeoff: runtime observation is more accurate than static declaration. If static introspection of composition shape proves valuable, the structured declaration can be added later.
- **Concurrency limit is per-call, not per-topo.** If two trails both fan out to 20 branches with `{ concurrency: 5 }`, the topo may have 10 concurrent operations total. There's no global concurrency governor. This is acceptable for v1. If it becomes a problem, a topo-level concurrency limit would be a separate concern.

### What this does NOT decide

- Whether the `follow` declaration will gain structural annotations (groups, optional markers, ordering hints) in the future. The flat array is sufficient today. Real usage may reveal governance needs that require structure.
- Whether `ctx.follow()` will gain additional overloads (e.g., streaming results, race semantics). The current two forms (single and array) cover the common patterns. Additional forms would need their own ADR.
- How parallel follows interact with request-scoped services if those are added in the future. The current decision (independent scopes per branch) is correct for singleton services and would need revisiting for shared mutable state.
- Whether the concurrency limit should support more sophisticated strategies (e.g., adaptive concurrency based on error rates). A static limit is sufficient for v1.

## References

- [ADR-0000: Core Premise](../0000-core-premise.md) -- "derive by default"; crumbs observes composition shape rather than requiring it to be declared
- [ADR-0002: Built-In Result Type](../0002-built-in-result-type.md) -- the Result model that handles partial failure in concurrent follows
- [ADR-0003: Unified Trail Primitive](../0003-unified-trail-primitive.md) -- "composition is a property, not a type"; parallel vs sequential is a runtime choice, not a contract distinction. The `follow` declaration stays flat, same as when `hike()` was unified into `trail()`.
- [ADR-0006: Shared Execution Pipeline](../0006-shared-execution-pipeline.md) -- `executeTrail` is called for each concurrent branch; the pipeline is unchanged
- [ADR-0013: Crumbs](../0013-crumbs.md) -- crumbs observes concurrent vs sequential spans to derive composition shape at runtime
- ADR: The Serialized Topo Graph (draft) -- the lockfile captures composition shapes including parallel follow patterns
- ADR: Trail Visibility and Surface Filtering (draft) -- concurrent follows respect visibility; internal trails are followable regardless of concurrency mode
- ADR: Packs as Namespace Boundaries (draft) -- concurrent follows across pack boundaries work identically to sequential follows; pack boundary governance is unchanged
