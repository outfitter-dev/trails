# Composite Trail Template

Annotated skeleton for composing trails via `follow`. Copy, rename, fill in.

```typescript
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// namespace.compound-verb
// ---------------------------------------------------------------------------

export const myComposite = trail('namespace.compound-verb', {
  // What this trail accomplishes by composing other trails.
  description: 'Create an entity and verify it appears in search',

  // --- Declare followed trails ---
  // List every trail this trail calls via ctx.follow().
  // The warden verifies these match actual ctx.follow() calls.
  follow: ['namespace.first', 'namespace.second'],

  // --- Services (optional) ---
  // Declare services the composite trail needs directly.
  // Followed trails declare their own services independently.
  // services: [db],

  // --- Input schema ---
  // The trail's own input — may differ from followed trails' inputs.
  // The trail maps its input to each followed trail's expected shape.
  input: z.object({
    name: z.string().describe('Name for the new entity'),
    type: z.string().describe('Entity type'),
    tags: z.array(z.string()).optional().default([]).describe('Tags for categorization'),
  }),

  // --- Output schema ---
  // The trail's own output — typically combines results from followed trails.
  output: z.object({
    entity: z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
    }),
    verified: z.boolean(),
  }),

  // --- Examples ---
  examples: [
    {
      name: 'Successful composition',
      description: 'Creates entity and verifies it is searchable',
      input: { name: 'Gamma', type: 'pattern', tags: ['workflow'] },
      // Schema-only validation — composite results depend on runtime state
    },
  ],

  // --- Run ---
  // Compose trails through ctx.follow() — never call .run() directly.
  // Always await, always check isErr() before accessing .value.
  run: async (input, ctx) => {
    // Step 1: Follow the first trail
    // Type the generic when you need the return shape.
    const first = await ctx.follow<{
      id: string;
      name: string;
      type: string;
    }>('namespace.first', {
      name: input.name,
      type: input.type,
      tags: input.tags,
    });

    // Propagate errors — don't swallow them.
    if (first.isErr()) return first;

    // Step 2: Follow the second trail, using results from the first
    const second = await ctx.follow<{
      results: { id: string; name: string }[];
      total: number;
    }>('namespace.second', {
      query: first.value.name,
    });

    // Decide how to handle second trail errors.
    // Option A: propagate (hard failure)
    // if (second.isErr()) return second;
    // Option B: degrade gracefully (soft failure)
    const verified = second.isOk() && second.value.total > 0;

    // Combine results from followed trails into the output shape.
    return Result.ok({
      entity: {
        id: first.value.id,
        name: first.value.name,
        type: first.value.type,
      },
      verified,
    });
  },
});
```

## Composition Patterns

**Sequential** — each step depends on the previous:

```typescript
const a = await ctx.follow('step.one', input);
if (a.isErr()) return a;
const b = await ctx.follow('step.two', { id: a.value.id });
```

**Parallel** — independent steps run concurrently:

```typescript
const [a, b] = await Promise.all([
  ctx.follow('step.one', { name }),
  ctx.follow('step.two', { name }),
]);
```

**Graceful degradation** — non-critical steps can fail without failing the trail:

```typescript
const optional = await ctx.follow('step.enrich', data);
const enriched = optional.isOk() ? optional.value : null;
```
