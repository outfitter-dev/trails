# Trails Language Styleguide

This guide defines how Trails uses framework language in docs, ADRs, examples, agent prompts, comments, and contributor guidance. The lexicon names the concepts; this guide explains the grammar around those names.

Start with `implementation` because it is easy to let that plain word swallow the contract. The larger rule applies across the framework: Trails terms should make the architecture easier to think with, not decorate ordinary software nouns.

## Core Model

Use this model when explaining Trails:

> A `trail()` defines the contract. Its `implementation` establishes how that contract runs.
> The runtime runs the trail through the shared pipeline.

Shorter:

> A trail with an implementation is a runnable contract.

Shortest:

> Define the contract. Implement the trail. Run it anywhere.

## Term Roles

| Term | Role |
| --- | --- |
| `trail()` | Defines the contract: input, output, intent, examples, relationships, resources, signals, detours, and metadata. |
| `implementation` | Establishes how the trail is carried out from validated input to `Result` output. |
| `run()` | Runs a trail through the full Trails runtime pipeline. |
| `surface()` | Opens the graph to an outside interface such as CLI, MCP, HTTP, or WebSocket. |
| `topo()` | Assembles trails, signals, resources, entities, and related definitions into a queryable graph. |
| `detour` | Declares recovery paths when a trail cannot proceed normally. |
| `compose` / `composes` | Declares and performs trail-to-trail composition. |

## `implementation`

An `implementation` is the authored behavior that makes a trail runnable.

A trail can be specified before its implementation is complete. Its schemas, examples, intent, resources, compositions, signals, detours, and metadata can all exist as contract. The `implementation` establishes the path through that contract, from validated input to `Result` output.

The Trails runtime runs trails, not bare implementation functions. Once a trail has an implementation, it can be exposed through any surface because that implementation is surface-agnostic: input in, `Result` out.

## Outdoor Meaning

The phrase "blaze a trail" remains useful only as ordinary English. It means establishing a path for use, usually one of two things:

- Cutting or establishing a new path where one did not clearly exist before.
- Marking an existing path so others can recognize and follow it consistently.

Both senses still map cleanly to Trails, but they are no longer framework vocabulary. A `trail()` defines the contract. The `implementation` establishes how that contract is carried out. Once implemented, the trail can be run consistently from CLI, MCP, HTTP, WebSocket, tests, agents, and direct programmatic calls.

The key distinction:

- Implementing is not walking the trail.
- Implementing establishes the trail so it can be run.
- In Trails, `run()` walks the established trail through the execution pipeline.

## Preferred Grammar

Use `implementation` as a noun:

- "The `implementation` establishes how the trail runs."
- "The `implementation` is the authored behavior that makes a trail runnable."
- "The `implementation` establishes the path from validated input to `Result` output."
- "A trail can be specified before it has an `implementation`."

Use `implement` as a verb:

- "Implement the trail by writing the behavior that satisfies the contract."
- "Specify the trail first, then implement it."
- "Once the contract is stable, implement the path through it."
- "Revise when behavior changes but the contract stays stable."

Use runnable/executable state:

- "A trail with an implementation is runnable."
- "Trails without implementations are contracts. Runnable trails are executable contracts."
- "A trail can be mapped before its implementation is complete."
- "Surfaces can expose a runnable trail without owning its implementation."

Avoid these shapes:

- "Run the implementation."
- "Call the implementation."
- "Invoke the implementation."
- "The implementation is runnable."
- "The CLI exposes the implementation."

The trail is runnable. The trail is exposed. The `implementation` establishes how it runs.

## Teaching Sequence

Use this order in introductory docs, agent prompts, and examples:

1. Define the trail contract.
2. Implement the trail with surface-agnostic behavior.
3. Assemble trails into a graph with `topo()`.
4. Run trails directly or expose them through surfaces.

```typescript
const createNote = trail('note.create', {
  input: CreateNote,
  output: Note,
  intent: 'write',
  resources: [notesDb],

  implementation: async (input, ctx) => {
    const notes = notesDb.from(ctx);
    return Result.ok(await notes.create(input));
  },
});
```

Suggested prose:

> `note.create` defines the capability. Its `implementation` establishes the path from
> validated input to `Result` output. `run(graph, 'note.create', input)` runs
> the trail through the full Trails pipeline.

## Development Loop

`implementation` fits the Trails development loop:

- **Specify.** Define the trail contract: schemas, examples, intent, resources,
  compositions, signals, and metadata.
- **Satisfy.** Implement the trail: write the behavior that makes the contract
  real and examples pass.
- **Tighten.** Add output schemas, safety declarations, error examples, detours,
  stronger composition declarations, and governance rules until the warden is
  quiet.

Preferred one-liner:

> Specify the trail. Implement the path. Tighten the contract.

Use "blaze a trail" only as ordinary English, not as an API name or required framework grammar.

## Words Around `implementation`

Prefer these words near `implementation`:

- establish
- runnable
- executable
- path
- contract
- satisfy
- surface-agnostic
- validated input
- `Result` output
- behavior
- implementation
- revise

Use `implementation` as the field name, but keep the trail as the runnable unit.

Preferred:

> The `implementation` is the authored behavior that establishes how the trail
> runs.

Less preferred:

> The CLI calls the implementation.

Avoid these substitutions when they claim the canonical concept slot:

- handler
- callback
- action
- operation
- endpoint
- route
- runner
- executor

They may be useful in contrast or external-system explanations, but they should not replace `trail` when naming the runnable Trails unit.

## Guardrails

### Runtime

Correct:

```typescript
await run(graph, 'note.create', input);
```

Correct prose:

> `run()` runs a trail through the runtime pipeline.

Incorrect prose:

> `run()` runs the trail's implementation.

More precise:

> `run()` runs the trail through validation, permit resolution, resource
> access, layers, tracing, detours, output validation, and error mapping.

### Surfaces

Correct:

> The CLI surface exposes `note.create`.

Incorrect:

> The CLI exposes the implementation.

More precise:

> The CLI surface derives its command shape from the trail contract. When called,
> it runs the trail through the shared execution pipeline.

### Authorship

Schemas, flags, tool names, HTTP routes, and error mappings can be derived or rendered. The `implementation` is authored because it contains behavior only the developer can know.

This distinction matters because Trails separates authored information from derived information. The `implementation` belongs to the authored category: it is the irreducible behavior that makes the contract real.

## Replacement Patterns

| Weak phrasing | Stronger phrasing |
| --- | --- |
| "The implementation is the trail." | "The `implementation` is the authored behavior that establishes how the trail runs." |
| "Write a handler." | "Implement the trail by writing behavior that satisfies the contract." |
| "Run the implementation." | "Run the trail." |
| "The CLI calls the implementation." | "The CLI runs the trail through the shared execution pipeline." |
| "The implementation handles the request." | "The trail receives validated input; its `implementation` returns a `Result`." |
| "A trail is an action." | "A trail is a typed contract for a unit of work." |
| "An implementation is a handler." | "An `implementation` establishes how the trail proceeds from input to `Result`." |

## Broader Trails Language

The same discipline applies to every Trails term:

- Use `trail`, not action, handler, endpoint, or route when naming the unit of
  work.
- Use `surface`, not transport or endpoint when naming the
  user-facing outside boundary.
- Use `topo` for the primitive and `graph` for the local value returned by
  `topo()`.
- Use `compose` for trail-to-trail composition. Avoid cross, call, invoke, pipeline,
  route, or workflow when naming the framework concept.
- Use `resource` for declared infrastructure dependencies. Avoid service or
  provider for that concept.
- Use `layer` for typed execution wrappers. Avoid legacy wrapper vocabulary
  unless comparing to external framework terminology.
- Use `meta`, not metadata, when naming the trail field.

## Versioning Grammar

Use the ADR-0048 source shape when writing current-facing versioning guidance:

- `version: N` for the current trail version.
- `versions: { N: ... }` for explicit historical entries.
- `revision` for a historical entry that uses pure `transpose:` transforms.
- `fork` for a historical entry with its own `implementation:`.
- `status` for lifecycle metadata such as deprecated or archived.
- `marker` for derived content-addressed identities.
- `@N` and `@<marker-prefix>` for version references.
- `(trail, version)` for the runtime contract-resolution pair.

Keep versioning prose aligned with the source shape. A fork entry may own a historical `implementation`, but the runtime still runs the trail through the shared pipeline. Surfaces do not call implementations directly.

Avoid these shapes in current-facing versioning prose:

- `.v*.ts` auto-discovery
- `version.current` or `version.markers`
- `adapt:` for version-entry transforms
- source-authored `kind:`
- source-authored `marker:`
- `trails version`, `trails sunset`, `trails mark`, `trails fork`, or
  `trails archive`
- `handler`, `implementation file`, or `surface route` as the canonical name
  for a versioned trail's behavior

The lexicon remains the source of truth for term definitions. This styleguide is the source of truth for how those terms should sound in prose.

## Agent Review Checklist

When tightening docs, ADRs, examples, comments, or agent prompts, check:

- Does any sentence imply a surface owns or directly implements behavior?
- Does any sentence call `implementation` a handler, callback, action, endpoint, or route?
- Does any sentence say or imply that the runtime runs an implementation rather than a
  trail?
- Does the first definition of `implementation` include the idea of making a trail
  runnable?
- Does the surrounding paragraph distinguish contract, implementation, runtime, and
  surface?
- Does the wording preserve `run` for execution?
- Does the wording connect `implementation` to authored behavior rather than derivation?
- Does the wording support the specify, satisfy, tighten workflow?

## Final Doctrine

> A trail can be specified before its implementation is complete. The
> `implementation` is the authored behavior that establishes how the trail runs.
> Once implemented, the trail can
> be run through the shared pipeline and surfaced anywhere without duplicating
> behavior.
