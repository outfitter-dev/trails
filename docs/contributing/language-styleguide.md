# Trails Language Styleguide

This guide defines how Trails uses framework language in docs, ADRs, examples,
agent prompts, comments, and contributor guidance. The lexicon names the
concepts; this guide explains the grammar around those names.

Start with `blaze` because it is easy to flatten into "implementation." That is
accurate but too small. The larger rule applies across the framework: Trails
terms should make the architecture easier to think with, not decorate ordinary
software nouns.

## Core Model

Use this model when explaining Trails:

> A `trail()` defines the contract. A `blaze` establishes the path through it.
> The runtime runs the blazed trail.

Shorter:

> A blazed trail is a runnable contract.

Shortest:

> Define the contract. Blaze the trail. Run it anywhere.

## Term Roles

| Term | Role |
| --- | --- |
| `trail()` | Defines the contract: input, output, intent, examples, relationships, resources, signals, detours, and metadata. |
| `blaze` | Establishes how the trail is carried out from validated input to `Result` output. |
| `run()` | Runs a trail through the full Trails runtime pipeline. |
| `surface()` | Opens the graph to an outside interface such as CLI, MCP, HTTP, or WebSocket. |
| `topo()` | Assembles trails, signals, resources, contours, and related definitions into a queryable graph. |
| `detour` | Declares recovery paths when a trail cannot proceed normally. |
| `cross` / `crosses` | Declares and performs trail-to-trail composition. |

## `blaze`

A `blaze` is the authored implementation that makes a trail runnable.

A trail can be specified before it is blazed. Its schemas, examples, intent,
resources, crossings, signals, detours, and metadata can all exist as contract.
The `blaze` establishes the path through that contract, from validated input to
`Result` output.

The Trails runtime runs trails, not blazes. Once a trail is blazed, it can be
exposed through any surface because its implementation is surface-agnostic:
input in, `Result` out.

## Outdoor Meaning

In outdoor trail language, to blaze a trail means to establish it for use. That
usually means one of two things:

- Cutting or establishing a new route where one did not clearly exist before.
- Marking an existing route so others can recognize and follow it consistently.

Both senses map cleanly to Trails. A `trail()` defines the contract. The `blaze`
establishes how that contract is carried out. Once blazed, the trail can be run
consistently from CLI, MCP, HTTP, WebSocket, tests, agents, and direct
programmatic calls.

The key distinction:

- Blazing is not walking the trail.
- Blazing establishes the trail so it can be walked.
- In Trails, `run()` walks the established trail through the execution pipeline.

## Preferred Grammar

Use `blaze` as a noun:

- "The `blaze` establishes how the trail runs."
- "The `blaze` is the authored implementation that makes a trail runnable."
- "The `blaze` establishes the path from validated input to `Result` output."
- "A trail can be specified before it has a `blaze`."

Use `blaze` as a verb:

- "Blaze the trail by writing the implementation that satisfies the contract."
- "Specify the trail first, then blaze it."
- "Once the contract is stable, blaze the path through it."
- "Reblaze when behavior changes but the contract stays stable."

Use `blazed` as state:

- "A blazed trail is runnable."
- "Trails without blazes are contracts. Blazed trails are executable contracts."
- "A trail can be mapped before it is blazed."
- "Surfaces can expose a blazed trail without owning its implementation."

Avoid these shapes:

- "Run the blaze."
- "Call the blaze."
- "Invoke the blaze."
- "The blaze is runnable."
- "The CLI exposes the blaze."

The trail is runnable. The trail is exposed. The `blaze` establishes how it
runs.

## Teaching Sequence

Use this order in introductory docs, agent prompts, and examples:

1. Define the trail contract.
2. Blaze the trail with surface-agnostic implementation.
3. Assemble trails into a graph with `topo()`.
4. Run trails directly or expose them through surfaces.

```typescript
const createNote = trail('note.create', {
  input: CreateNote,
  output: Note,
  intent: 'write',
  resources: [notesDb],

  blaze: async (input, ctx) => {
    const notes = notesDb.from(ctx);
    return Result.ok(await notes.create(input));
  },
});
```

Suggested prose:

> `note.create` defines the capability. Its `blaze` establishes the path from
> validated input to `Result` output. `run(graph, 'note.create', input)` runs
> the blazed trail through the full Trails pipeline.

## Development Loop

`blaze` fits the Trails development loop:

- **Specify.** Define the trail contract: schemas, examples, intent, resources,
  crossings, signals, and metadata.
- **Satisfy.** Blaze the trail: write the implementation that makes the contract
  real and examples pass.
- **Tighten.** Add output schemas, safety declarations, error examples, detours,
  stronger composition declarations, and governance rules until the warden is
  quiet.

Preferred one-liner:

> Specify the trail. Blaze the path. Tighten the contract.

Use the more literal "Specify the contract. Blaze the trail. Tighten the graph."
only when the surrounding paragraph explains the terms.

## Words Around `blaze`

Prefer these words near `blaze`:

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
- reblaze

Use `implementation` as a clarifying word, not as the whole definition.

Preferred:

> The `blaze` is the authored implementation that establishes how the trail
> runs.

Less preferred:

> The `blaze` is the implementation.

Avoid these substitutions when they claim the canonical concept slot:

- handler
- callback
- action
- operation
- endpoint
- route
- runner
- executor

They may be useful in contrast or external-system explanations, but they should
not replace `blaze` when naming the Trails concept.

## Guardrails

### Runtime

Correct:

```typescript
await run(graph, 'note.create', input);
```

Correct prose:

> `run()` runs a trail through the runtime pipeline.

Incorrect prose:

> `run()` runs the trail's blaze.

More precise:

> `run()` runs the blazed trail through validation, permit resolution, resource
> access, layers, tracing, detours, output validation, and error mapping.

### Surfaces

Correct:

> The CLI surface exposes `note.create`.

Incorrect:

> The CLI exposes the blaze.

More precise:

> The CLI surface derives its command shape from the trail contract. When called,
> it runs the blazed trail through the shared execution pipeline.

### Authorship

Schemas, flags, tool names, HTTP routes, and error mappings can be derived or
projected. The `blaze` is authored because it contains behavior only the
developer can know.

This distinction matters because Trails separates authored information from
projected information. The `blaze` belongs to the authored category: it is the
irreducible behavior that makes the contract real.

## Replacement Patterns

| Weak phrasing | Stronger phrasing |
| --- | --- |
| "The `blaze` is the implementation." | "The `blaze` is the authored implementation that establishes how the trail runs." |
| "Write the implementation in `blaze`." | "Blaze the trail by writing the implementation that satisfies the contract." |
| "Run the blaze." | "Run the blazed trail." |
| "The CLI calls the blaze." | "The CLI runs the trail through the shared execution pipeline." |
| "The blaze handles the request." | "The trail receives validated input; its `blaze` returns a `Result`." |
| "A trail is an action." | "A trail is a typed contract for a unit of work." |
| "A blaze is a handler." | "A `blaze` establishes how the trail proceeds from input to `Result`." |

## Broader Trails Language

The same discipline applies to every Trails term:

- Use `trail`, not action, handler, endpoint, or route when naming the unit of
  work.
- Use `surface`, not transport or endpoint when naming the
  user-facing outside boundary.
- Use `topo` for the primitive and `graph` for the local value returned by
  `topo()`.
- Use `cross` for trail-to-trail composition. Avoid call, invoke, pipeline,
  route, or workflow when naming the framework concept.
- Use `resource` for declared infrastructure dependencies. Avoid service or
  provider for that concept.
- Use `layer` for typed execution wrappers. Avoid legacy wrapper vocabulary
  unless comparing to external framework terminology.
- Use `meta`, not metadata, when naming the trail field.

The lexicon remains the source of truth for term definitions. This styleguide is
the source of truth for how those terms should sound in prose.

## Agent Review Checklist

When tightening docs, ADRs, examples, comments, or agent prompts, check:

- Does any sentence imply a surface owns or directly implements behavior?
- Does any sentence call `blaze` a handler, callback, action, endpoint, or route?
- Does any sentence say or imply that the runtime runs a blaze rather than a
  trail?
- Does the first definition of `blaze` include the idea of making a trail
  runnable?
- Does the surrounding paragraph distinguish contract, blaze, runtime, and
  surface?
- Does the wording preserve `run` for execution?
- Does the wording connect `blaze` to authored behavior rather than derivation?
- Does the wording support the specify, satisfy, tighten workflow?

## Final Doctrine

> A trail can be specified before it is blazed. The `blaze` is the authored
> implementation that establishes how the trail runs. Once blazed, the trail can
> be run through the shared pipeline and surfaced anywhere without duplicating
> behavior.
