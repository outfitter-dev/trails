---
name: trails-language-styleguide
description: Use when writing or reviewing Trails docs, ADRs, agent prompts, examples, comments, or contributor guidance for lexicon precision, especially `blaze` language.
---

# Trails Language Styleguide

Use this skill to tighten Trails language across prose and code-adjacent text.
It is for docs, ADRs, README files, plugin prompts, agent instructions, comments,
examples, issue language, and PR descriptions.

Canonical sources:

- `docs/lexicon.md` defines the terms.
- `docs/contributing/language-styleguide.md` defines how those terms should sound in prose.
- ADR-0001 and ADR-0023 explain why the lexicon exists.

## Blaze Doctrine

Use this mental model:

> A `trail()` defines the contract. A `blaze` establishes the path through it.
> The runtime runs the blazed trail.

Short form:

> A blazed trail is a runnable contract.

The `blaze` is the authored implementation that makes a trail runnable. It
establishes the path from validated input to `Result` output. Use
`implementation` as a clarifying word, not as the whole definition.

## Preferred Grammar

Prefer:

- "The `blaze` establishes how the trail runs."
- "A trail can be specified before it is blazed."
- "Blaze the trail by writing the implementation that satisfies the contract."
- "Run the blazed trail."
- "The CLI surface runs the trail through the shared execution pipeline."
- "Surfaces expose trails, not blazes."

Avoid:

- "Run the blaze."
- "Call the blaze."
- "Invoke the blaze."
- "The blaze is runnable."
- "The CLI exposes the blaze."
- "A blaze is a handler."
- "The blaze handles the request."

## Review Checklist

When reviewing a changed file, check:

- Does the first definition of `blaze` include making a trail runnable?
- Does any sentence imply a surface owns or directly implements behavior?
- Does any sentence call `blaze` a handler, callback, action, endpoint, route,
  runner, or executor?
- Does any sentence imply that the runtime runs a blaze rather than a trail?
- Does the paragraph distinguish contract, blaze, runtime, and surface?
- Does the wording preserve `run` for execution?
- Does the wording connect `blaze` to authored behavior rather than projection?
- Does the teaching order follow `trail()` -> `blaze:` -> `topo()` -> `surface()`?

## Replacement Patterns

| Weak phrasing | Stronger phrasing |
| --- | --- |
| "The `blaze` is the implementation." | "The `blaze` is the authored implementation that establishes how the trail runs." |
| "Write the implementation in `blaze`." | "Blaze the trail by writing the implementation that satisfies the contract." |
| "Run the blaze." | "Run the blazed trail." |
| "The CLI calls the blaze." | "The CLI runs the trail through the shared execution pipeline." |
| "The blaze handles the request." | "The trail receives validated input; its `blaze` returns a `Result`." |
| "A trail is an action." | "A trail is a typed contract for a unit of work." |

## Broader Lexicon Rules

- Use `trail`, not action, handler, endpoint, or route for the unit of work.
- Use `surface`, not transport or endpoint for the outside boundary.
- Use `topo` for the primitive and `graph` for the local value returned by
  `topo()`.
- Use `cross` for trail-to-trail composition.
- Use `resource` for declared infrastructure dependencies.
- Use `layer` for typed execution wrappers.
- Use `meta`, not metadata, when naming the trail field.

If the standard word would shrink the concept, use the Trails term. If the
standard word already carries the right meaning, keep it plain.
