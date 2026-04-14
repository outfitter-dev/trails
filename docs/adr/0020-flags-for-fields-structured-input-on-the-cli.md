---
id: 20
slug: flags-for-fields-structured-input-on-the-cli
title: Flags for Fields, Structured Input on the CLI
status: accepted
created: 2026-04-03
updated: 2026-04-13
owners: ['[galligan](https://github.com/galligan)']
depends_on: [8, 19]
---

# ADR-0020: Flags for Fields, Structured Input on the CLI

## Context

### The derivation model works — until it doesn't

The CLI gets its power from derivation. A trail author writes one input schema, and the framework projects flags from it automatically. That model — one schema, many trailheads, zero divergence — is the core promise of Trails.

It holds for scalar fields, booleans, enums, and arrays of primitives. It breaks for structured input (arrays of objects, nested schemas) and it says nothing about the two other concerns a real CLI needs: positional arguments and their ordering, and global flags that apply to every command.

The Stash dogfood app hit the structured-input failure first: `gist.create` needs `files: [{ filename, content, language? }]`, and flat flag derivation cannot faithfully represent that shape.[^retro] The positional-ordering gap surfaced next: `topo pin <name>` reads naturally, but the framework had no way to express "this field is positional" without leaking CLI concepts into the trail spec. And global flags (`--json`, `--verbose`) were manually wired per-command through a preset mechanism that required explicit opt-in.

These are three faces of the same problem: **how does a trailhead-agnostic trail spec project to the full structure of a CLI command?**

### The layered answer

The answer is a four-layer model where each layer handles a different scope of the problem. The framework derives what it can, the developer declares what it can't, and overrides handle the exceptions:

1. **Framework defaults** — type-driven derivation (schema → flags, booleans → toggles, arrays → comma-separated)
2. **CLI trailhead globals** — flags that apply to every command (`--json`, `--verbose`)
3. **App conventions** — reusable patterns across trails (`deriveTrail`, contours)
4. **Trail-level declarations** — `args` for positional ordering, `fields` for per-field overrides

Each layer refines the previous. The developer only declares what's unique to their level.

## Decision

### Field flags stay the default for faithfully representable fields

The CLI derives flags from the trail input schema for fields whose shape can be represented truthfully. That includes strings, numbers, booleans, enums, and arrays of primitives.

For these fields, the happy path remains:

```bash
myapp topo pin v1.0
myapp tracing query --trail-id gist.create --limit 20
```

Array fields accept comma-separated values by default: `--tags a,b,c` parses to `['a', 'b', 'c']`. Override the separator via `fields` when the default is wrong.

### `args` declares positional arguments on the trail spec

A new optional field on `TrailSpec` controls which input fields are positional and in what order:

```typescript
trail('file.copy', {
  input: z.object({ src: z.string(), dest: z.string(), recursive: z.boolean() }),
  args: ['src', 'dest'],
  intent: 'write',
});
```

```bash
myapp file copy source.txt dest.txt --recursive
```

The `args` array is the source of truth for positional ordering. It's formatter-proof — unlike schema key order, array element order is never rearranged by code formatters. Only string-typed fields can be positional (non-string fields are silently filtered).

Three shapes:

- `args: ['src', 'dest']` — explicit positional fields, in this order
- `args: false` — suppress auto-promotion, all fields stay as flags
- Omitted — heuristic: if exactly one required string field with no default exists, auto-promote it

Positional fields keep their flag alias. `myapp file copy source.txt dest.txt` and `myapp file copy --src source.txt --dest dest.txt` both work. Positional args are registered as optional in the CLI parser because the flag form provides an alternative input path — the trail's Zod schema handles required-field validation after merge.

`args` is a semantic property of the trail's input structure, not a CLI concept. The CLI projects it as positional arg order. A form could project it as field prominence. An agent could use it to prioritize parameters.

### Structured channels handle the full schema

The CLI exposes structured-input channels for input shapes that cannot be faithfully represented as flags:

- `--input-json <json>` — inline JSON payload
- `--input-file <path>` — file path to JSON
- `--stdin` — read JSON from stdin

```bash
myapp gist create --input-json '{"files":[{"filename":"hello.ts","content":"export {}"}]}'
cat payload.json | myapp gist create --stdin
```

If a field cannot be represented faithfully as a derived flag, the framework does not invent a misleading one. Arrays of objects do not become fake variadic string flags. Nested objects do not become ad hoc flattened flags. The rule is simple: derive flags only when the projection is truthful.

### Merge once, validate once

The CLI builds one final input object before executing the trail:

1. Start with the structured payload, if provided
2. Merge positional args (only defined values — undefined positionals don't clobber)
3. Merge derived flags (only defined values — meta-flags stripped)
4. Validate the final object against the trail's Zod input schema

Explicit CLI inputs win on conflict because they are the narrowest, most local override. This keeps the model aligned with the rest of Trails: one authored input schema, one validation pass at the boundary, one final input object entering the trail.

### Progressive disclosure of complexity

Every concept starts simple and gains precision as the developer invests:

| Developer writes | What happens |
|-----------------|-------------|
| Just `input` | All flags, derived from schema. Single required string auto-promotes to positional. |
| `input` + `args` | Explicit positional args in declared order, remaining fields as flags |
| `input` + `args` + `fields` | Full control over presentation (separators, labels, overrides) |
| Uses `deriveTrail` factory | Pattern handles args/fields, developer only writes the blaze |

The framework does not impose ceremony before it becomes necessary.

## Non-goals

- **CLI trailhead globals.** Built-in global flags (`--json`, `--verbose`, `--no-color`) and the trailhead-level configuration for enabling/disabling them are a separate decision. The current preset mechanism works; formalizing it as a first-class API is deferred.
- **App-level field conventions.** Reusable patterns for field presentation across trails (e.g., "src/dest are always positional in my app") are handled by `deriveTrail` and contour factories, which are covered by their own ADRs.
- **Interactive editor or form-based authoring.** Complex payload authoring via TUI editors or interactive prompts is a future concern.

## Consequences

### Positive

- **The CLI stays truthful.** Commands either expose real derived flags or point to a structured input channel. They do not pretend a nested schema is flat.
- **One schema remains the source of truth.** MCP, HTTP, tests, and CLI all validate against the same contract.
- **Positional ordering is formatter-proof.** The `args` array on the trail spec is the canonical source for positional arg order — no dependence on schema key order or declaration order.
- **Both syntaxes always work.** Positional fields keep their flag alias. `myapp pin v1.0` and `myapp pin --name v1.0` are equivalent. No breaking changes for flag-based scripts.
- **Progressive disclosure.** A trail with no `args` and no `fields` still gets a fully functional CLI with derived flags and auto-promoted positional args. Explicit declarations are optional tightening.

### Tradeoffs

- **The CLI has more than one input path.** Structured channels, positional args, and flags all converge on the same schema, but that's extra surface area to document and explain.
- **Some commands will show fewer automatic flags than before.** That is intentional. Omitted flags are better than lossy flags.
- **`args` adds a field to the trail spec.** One more thing to learn. The justification: without it, the only option is depending on schema key order (fragile) or putting positional config on the trailhead (disconnected from the trail).

## Non-decisions

- **Comma-separated array parsing.** Whether `--tags a,b,c` is the default for all array types or only string arrays. The current implementation handles string arrays; numeric arrays may follow.
- **Value format DSL.** Whether `fields` grows a `format` or `parser` property for custom value parsing (e.g., `3:7` as a range). The current `separator` override is sufficient for now.
- **Multi-positional ordering for non-string types.** `args` currently restricts to string-typed fields. Extending to numbers or enums would require type coercion in the Commander adapter.

## References

- [ADR-0008: Deterministic Trailhead Derivation](0008-deterministic-trailhead-derivation.md) — the deterministic derivation model that `args` extends
- [ADR-0019: Hierarchical Command Trees from Trail IDs](0019-hierarchical-command-trees-from-trail-ids.md) — the companion decision for nested command paths
- [Trails Design Tenets](../tenets.md) — especially "derive by default, declare to tighten, override when wrong" and "schema always exists"
- [ADR-0030: Contours as First-Class Domain Objects](0030-contours-as-first-class-domain-objects.md) — contour-aware `deriveTrail()` that can carry `args` conventions
- [ADR-0032: `deriveTrail()` and Trail Factories](0032-derivetrail-and-trail-factories.md) — reusable patterns that absorb `args` and `fields` declarations

[^retro]: The Stash dogfood retro identified `gist.create` as the first practical place where flat flag derivation fails for nested input.
