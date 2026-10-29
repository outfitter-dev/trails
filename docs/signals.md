# Signals

A signal names a typed payload. Producers declare which signals they fire, and reactive consumers declare which signals activate them. Signal dispatch is local and in-process; it is not durable delivery.

## Scaffold a declaration

```bash
trails add signal entity.updated --description 'Entity update event' --permit '{"id":"local-scaffold","scopes":["project:write"]}'
```

This writes `src/signals/entity-updated.ts` and `__tests__/entity-updated.test.ts`, exporting `entity_updatedSignal`. The editable payload matches the app starter: `entityId` and `updatedAt` are strings. The scaffold does not impose a timestamp format or invent producer provenance.

Scaffold IDs use lowercase dotted segments with an optional `_draft.` prefix. This is a file/export naming subset, not a new Core signal-ID grammar. Existing targets, blocked directories, and symbolic-link parents are rejected; creation uses exclusive files and bounded, best-effort cleanup. Scaffolding does not edit your topo or wire trails automatically.

## Wire the signal explicitly

1. Import the generated signal into the intended topo.
2. Add it to a real producer's `fires` declaration and call `await ctx.fire(signal, payload)` from that implementation. Handle an unavailable firing context with an explicit `Result.err()` if the context type permits absence.
3. Declare `on: [signal]` on a reactive consumer when that consumer should run for the event.
4. Add actual producer trail IDs to the optional `from` metadata once those relationships are authored. `from` describes provenance; it does not replace `fires` or emit a signal.

A declaration alone is intentionally unwired. Warden's signal graph coaching can warn about missing producers or consumers; do not silence that warning by inventing edges. The scaffold's generated code and tests compile independently, and a correctly wired producer/signal/consumer topo is the Warden-clean integration.

`testAll(app)` can check producer examples with `signals` assertions. A firing assertion observes emission; awaiting `ctx.fire()` is not a completion barrier for every consumer. See [Typed Signal Emission](./adr/0038-typed-signal-emission.md) and [Reactive Trail Activation](./adr/0039-reactive-trail-activation.md).
