---
id: 20
slug: flags-for-fields-structured-input-on-the-cli
title: Flags for Fields, Structured Input on the CLI
status: accepted
created: 2026-04-03
updated: 2026-04-03
owners: ['[galligan](https://github.com/galligan)']
depends_on: [8, 19]
---

# ADR-0020: Flags for Fields, Structured Input on the CLI

## Context

The CLI gets its power from derivation. A trail author writes one input schema, and the framework projects flags from it automatically. That works beautifully for scalar fields, booleans, enums, and arrays of primitives.

It breaks down for structured input.

The Stash retro hit the failure in the most obvious place: `gist.create` needs `files: [{ filename, content, language? }]`. The current CLI projection turns that into a flat variadic flag, which cannot faithfully represent the actual input shape.[^retro]

That creates the wrong pressure:

- the CLI looks like it supports the trail, but the derived flags are lossy
- authors are pushed toward CLI-shaped schemas instead of truthful schemas
- the most tactile trailhead stops being trustworthy precisely where the contract gets interesting

Trails should not pretend a tree is flat. But it also should not give up and require CLI-only trail definitions. The right answer is to preserve one schema and offer two honest input channels for it.

## Decision

The CLI supports **projected flags for fields** and **structured channels for full input**.

### Field flags stay the default for faithfully representable fields

The CLI continues to derive flags from the trail input schema for fields whose shape can be represented truthfully as flags.

That includes:

- strings
- numbers
- booleans
- enums
- arrays of primitives
- optional forms of the same

For these fields, the happy path remains:

```bash
trails topo pin --name before-auth
trails tracker query --trail-id gist.create --limit 20
```

### Structured channels handle the full schema

The CLI also exposes explicit structured-input channels for the full input object:

- `--input-json <json>`
- `--input-file <path>`
- `--stdin`

All three feed the same contract. They differ only in where the structured payload comes from.

```bash
trails gist create --input-json '{"owner":"matt","files":[{"filename":"hello.ts","content":"export {}"}]}'

trails gist create --input-file ./fixtures/gist-create.json

cat ./fixtures/gist-create.json | trails gist create --stdin
```

### Lossy flag derivation is not allowed

If a field cannot be represented faithfully as a derived flag, the framework does not invent a misleading one.

This means:

- arrays of objects do not become fake variadic string flags
- nested objects do not become ad hoc flattened flags by default
- the CLI points the user to a structured channel instead

The rule is simple: derive flags only when the projection is truthful.

### Merge once, validate once

The CLI builds one final input object before executing the trail:

1. start with the structured payload, if one is provided
2. merge positional args and derived flags on top
3. validate the final object against the trail's original input schema

Explicit CLI inputs win on conflict because they are the narrowest, most local override.

This keeps the model aligned with the rest of Trails:

- one authored input schema
- one validation pass at the boundary
- one final input object entering the trail

### Overrides remain available for CLI-specific ergonomics

Trail authors may still provide explicit CLI overrides when a command benefits from a more specialized input shape.

The escape hatch is valid when it stays:

- deliberate
- local
- visible in the resolved graph

Examples:

- a custom parser for a domain-specific shorthand
- a purpose-built positional argument
- a richer interactive prompt flow

But the default remains honest derivation plus structured input channels. The framework does not require a CLI-only authoring path just to handle nested input.

## Consequences

### Positive

- **The CLI stays truthful.** Commands either expose real derived flags or point to a structured input channel. They do not pretend a nested schema is flat.
- **One schema remains the source of truth.** MCP, HTTP, tests, and CLI all still validate against the same contract.
- **Complex trails stay usable from the command line.** Arrays of objects and nested input become first-class instead of second-class.
- **Overrides remain ergonomic.** Teams that want a more specialized CLI experience can still add one without abandoning the default projection model.

### Tradeoffs

- **The CLI has more than one input path.** That is extra surface area, even though all paths converge on the same schema.
- **Some commands will show fewer automatic flags than before.** That is intentional. Omitted flags are better than lossy flags.
- **Merge precedence must stay clear.** Structured payloads plus flags are powerful, but the CLI docs and output need to explain which input wins on collision.

### What this does NOT decide

- Interactive editor or form-based CLI authoring for complex payloads
- The exact override API for custom CLI-only parsing
- Whether future trailheads reuse the same `input-file` / `stdin` vocabulary directly

## References

- [ADR-0008: Deterministic Trailhead Derivation](../0008-deterministic-trailhead-derivation.md) — this keeps CLI derivation deterministic while refusing lossy projections
- [ADR-0019: Hierarchical Command Trees from Trail IDs](0019-hierarchical-command-trees-from-trail-ids.md) — the companion decision for nested command paths
- [Trails Design Tenets](../../tenets.md) — especially "schema always exists" and "validate at the boundary, trust internally"

[^retro]: The Stash retro note at `.agents/notes/2026-04-01-stash-retro.md` calls out `gist.create` as the first practical place where flat flag derivation fails for nested input.
