# Writing Samples

Worked craft samples for Trails prose, adapted and expanded from the Outfitter styleguide samples. They cover both framework docs (ADRs, guides, reference, agent guidance, release notes) and trails.dev narrative and launch writing. Use them with `trails-writing-style` -- they illustrate the rules by example; they are not new rules.

> Vocabulary note: examples here use the live v1 Trails terms. Use `derive`
> for contract-owned facts and `render` for surface presentation.

## Opening moves

### Problem framing

> "Every framework promises 'define it once.' Most still make you write it three times -- once for the CLI, once for the HTTP handler, once for the agent tool."

Why it works: it names a real, specific pain the reader has felt, then sets up the resolution without overselling. "Three times" is concrete, not a vibe.

### Earned honesty

> "Trails won't make a bad API good. It makes a good API impossible to expose three inconsistent ways."

Why it works: it states a limit before a benefit. The honesty buys the claim that follows.

## Punch and flow

Setup, pivot, punch, resolution.

> "You define the trail once. Want it on MCP too? There's nothing to port -- the MCP tool and the CLI command read the same contract."

The short sentences carry the decision; the longer one earns its room by naming the payoff. Read it aloud -- it has a beat.

## Earned enthusiasm

> "The CLI and the MCP server came out of the same forty lines. I kept waiting to write the second one."

Why it works: a real reaction to a real result, not a marketing adjective. The specific detail carries the feeling. "Revolutionary" would carry nothing.

## Status: precision and honesty

### High status -- technical precision

> "Input is a Zod schema. The same schema validates CLI flags, MCP tool parameters, and the HTTP body -- one parse, at the boundary, before your code runs."

Names the real tool, then shows the payoff. Credible because it's exact.

### Low status -- builder honesty

> "WebSocket isn't a surface yet. The contract model is built for it; the surface isn't written."

"Yet" signals trajectory without overpromising. Honesty about the edge builds trust in the center.

### The blend

> "Trails is opinionated about authoring and unopinionated about output. That's a real constraint -- you write contracts our way -- and it's the whole reason a CLI and an MCP server can't drift apart."

Vulnerability (a real constraint) wrapped in the reason it's worth it.

## Technical without gatekeeping

> "The topo is the resolved graph of everything -- trails, resources, signals, and how they connect. Think of it as the app's table of contents, except it's queryable and the framework keeps it honest."

Introduces the term, defines it plainly, gives an analogy, then states what's special. No jargon left undefined; nothing dumbed down.

## Show the work

An example should carry the rule before the prose does.

Good -- the contract and the surfaces it produces, side by side:

```typescript
const show = trail('gist.show', {
  input: z.object({ id: z.string() }),
  intent: 'read',
  output: Gist,
  // returns Result.ok(gist)
});
```

```bash
gists show --id abc123     # CLI command, derived from the trail
# the MCP tool `gist.show` exposes the identical contract
```

Why it works: the reader sees the authored contract and both surfaces it produces. The "one contract, many surfaces" claim is demonstrated, not asserted. Don't hide the part that proves the point behind `...`.

## Metaphor: earned vs forced

This is the self-explains test in sample form. A themed word earns its place only if the sentence survives stripping the theme.

Earned:

> "A `trail` is a defined path from typed input to a `Result`."

`trail` carries the concept -- a path -- and the sentence still reads if you swap in "defined unit of work." The word reduces translation effort; it doesn't add it.

Forced:

> "Pack your provisions and implementation a path through the untamed wilderness of your domain logic."

Strip the theme and nothing is lost, which means it was never carrying meaning. Reader eye-roll incoming.

The test: remove the themed word. If the sentence still teaches, the word earned its place. If only the costume is left, cut it.

## Generic vs concrete

Generic -- avoid:

> "Trails is a flexible, powerful framework that lets you build integrations across many platforms with ease."

Concrete -- better:

> "Define a `trail` once; it runs on CLI, MCP, and HTTP from one authored contract, with no per-surface reimplementation."

The generic version gives the reader nothing to act on or verify. The concrete version names the unit, the surfaces, and the guarantee -- each of which is checkable.

## Closing moves

### Invitation

> "If you're wiring agents to your own services, try defining one capability as a trail and surfacing it on MCP. The whole point is that the second surface is free."

Clear audience, low-commitment ask, one concrete payoff -- not a vague promise.

### Door left ajar

> "Most of the interesting questions are still open: activation sources, cross-app composition, more surfaces. The contract model is the bet that those stay additive."

Leaves the reader thinking forward, names real open ground honestly, and ties back to the core claim. Aspirational without being preachy -- and no borrowed quote required.

## Anti-patterns to avoid

### Generic tech-blog opener

> "In today's fast-paced development landscape, building consistent APIs has never been more important. That's why we created Trails -- a revolutionary framework that transforms how you ship."

What's wrong: "fast-paced landscape" is filler, "never been more important" says nothing, "revolutionary" and "transforms" are unearned superlatives. Cut all of it.

### Hedge stack

> "It is generally recommended that you should probably consider adding a Warden rule in most cases."

What's wrong: four hedges around one instruction. Say it: "Add a Warden rule when drift can be caught from authored facts."

## The Coffee Test

Read the sentence aloud. Would you say it to a sharp colleague explaining what you built?

Fails:

> "Trails empowers developers to seamlessly leverage a unified contract abstraction across heterogeneous surfaces."

Passes:

> "You write the capability once, and it shows up on the CLI and as an agent tool without you doing it twice."
