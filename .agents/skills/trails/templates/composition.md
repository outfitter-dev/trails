# Composite Trail Template

Annotated skeleton for composing trails via `ctx.compose`. Copy, rename, fill in.

```typescript
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';
import { namespaceFirst, namespaceSecond } from './downstream.js';

// ---------------------------------------------------------------------------
// namespace.compound-verb
// ---------------------------------------------------------------------------

export const myComposite = trail('namespace.compound-verb', {
  // What this trail accomplishes by composing other trails.
  description: 'Create an entity and verify it appears in search',

  // --- Declare downstream trails ---
  // List every trail this trail calls via ctx.compose().
  // The warden verifies these match actual ctx.compose() calls.
  composes: [namespaceFirst, namespaceSecond],

  // --- Resources (optional) ---
  // Declare resources the composite trail needs directly.
  // Composed trails declare their own resources independently.
  // resources: [db],

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
  // Compose trails through ctx.compose() — never call .run() directly.
  // Always await, always check isErr() before accessing .value.
  implementation: async (input, ctx) => {
    // Step 1: Compose the first trail
    // Type the generic when you need the return shape.
    const first = await ctx.compose(namespaceFirst, {
      name: input.name,
      type: input.type,
      tags: input.tags,
    });

    // Propagate errors — don't swallow them.
    if (first.isErr()) return first;

    // Step 2: Compose the second trail, using results from the first
    const second = await ctx.compose(namespaceSecond, {
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
import { stepOne, stepTwo } from './steps.js';

const a = await ctx.compose(stepOne, input);
if (a.isErr()) return a;
const b = await ctx.compose(stepTwo, { id: a.value.id });
```

Use string IDs when the target trail object is not statically in scope; prefer trail objects when it is.

**Parallel** — independent steps run concurrently:

```typescript
import { stepOne, stepTwo } from './steps.js';

const [a, b] = await ctx.compose([
  [stepOne, { name }],
  [stepTwo, { name }],
]);
```

**Graceful degradation** — non-critical steps can fail without failing the trail:

```typescript
import { enrichProfile } from './steps.js';

const optional = await ctx.compose(enrichProfile, data);
const enriched = optional.isOk() ? optional.value : null;
```
