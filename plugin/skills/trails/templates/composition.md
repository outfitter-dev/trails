# Composite Trail Template

Annotated skeleton for composing trails via `cross`. Copy, rename, fill in.

```typescript
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// namespace.compound-verb
// ---------------------------------------------------------------------------

export const myComposite = trail('namespace.compound-verb', {
  // What this trail accomplishes by composing other trails.
  description: 'Create an entity and verify it appears in search',

  // --- Declare downstream trails ---
  // List every trail this trail calls via ctx.cross().
  // The warden verifies these match actual ctx.cross() calls.
  crosses: ['namespace.first', 'namespace.second'],

  // --- Provisions (optional) ---
  // Declare provisions the composite trail needs directly.
  // Crossed trails declare their own provisions independently.
  // provisions: [db],

  // --- Input schema ---
  // The trail's own input — may differ from downstream trails' inputs.
  // The trail maps its input to each downstream trail's expected shape.
  input: z.object({
    name: z.string().describe('Name for the new entity'),
    type: z.string().describe('Entity type'),
    tags: z.array(z.string()).optional().default([]).describe('Tags for categorization'),
  }),

  // --- Output schema ---
  // The trail's own output — typically combines results from downstream trails.
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
  // Compose trails through ctx.cross() — never call .run() directly.
  // Always await, always check isErr() before accessing .value.
  blaze: async (input, ctx) => {
    // Step 1: Cross the first trail
    // Type the generic when you need the return shape.
    const first = await ctx.cross<{
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

    // Step 2: Cross the second trail, using results from the first
    const second = await ctx.cross<{
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

    // Combine results from downstream trails into the output shape.
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
const a = await ctx.cross('step.one', input);
if (a.isErr()) return a;
const b = await ctx.cross('step.two', { id: a.value.id });
```

**Parallel** — independent steps run concurrently:

```typescript
const [a, b] = await Promise.all([
  ctx.cross('step.one', { name }),
  ctx.cross('step.two', { name }),
]);
```

**Graceful degradation** — non-critical steps can fail without failing the trail:

```typescript
const optional = await ctx.cross('step.enrich', data);
const enriched = optional.isOk() ? optional.value : null;
```
