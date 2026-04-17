# Trail Template

Annotated skeleton. Copy, rename, fill in.

```typescript
import { trail, Result } from '@ontrails/core';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared schemas (optional — define here if reused across trails in this file)
// ---------------------------------------------------------------------------

const outputSchema = z.object({
  // Define the shape of successful results.
  // This schema is required for MCP and HTTP surfaces.
  id: z.string(),
  name: z.string(),
});

// ---------------------------------------------------------------------------
// namespace.verb
// ---------------------------------------------------------------------------

export const myTrail = trail('namespace.verb', {
  // One sentence: what this trail does.
  description: 'What this trail does in one sentence',

  // --- Input schema ---
  // Every field gets .describe() — it becomes --help text and MCP descriptions.
  // Required fields: plain z.string(), z.number(), etc.
  // Optional fields: .optional() — becomes an optional flag/parameter.
  // Defaults: .default(value) — used when the field is omitted.
  input: z.object({
    name: z.string().describe('Human-readable field description'),
    type: z.string().optional().describe('Optional filter or category'),
    verbose: z.boolean().default(false).describe('Show detailed output'),
  }),

  // --- Output schema ---
  // Required for MCP/HTTP. Must match what the implementation returns via Result.ok().
  output: outputSchema,

  // --- Intent and flags ---
  // intent: 'read',       // No side effects — safe for agents to call freely
  // intent: 'destroy',    // Irreversible — CLI auto-adds --dry-run flag
  // idempotent: true,     // Safe to retry — surfaces may auto-retry on failure
  // Omit intent for standard create/update operations.

  // --- Detours (optional) ---
  // Error recovery suggestions — what to try when this trail fails.
  // detours: {
  //   NotFoundError: ['search'],
  // },

  // --- Examples ---
  // Each example is both agent documentation AND a test case.
  // testAll() runs these automatically.
  examples: [
    {
      // Full match: deep-equals the expected output
      name: 'Descriptive name for the happy path',
      description: 'Agent-facing context about when this scenario applies',
      input: { name: 'Example' },
      expected: { id: '1', name: 'Example' },
    },
    {
      // Schema-only: no expected, no error — validates against output schema
      name: 'Schema validation scenario',
      input: { name: 'Another', verbose: true },
    },
    {
      // Error match: asserts the error type by name
      name: 'Error case description',
      input: { name: 'nonexistent' },
      error: 'NotFoundError',
    },
  ],

  // --- Blaze ---
  // Receives validated input and TrailContext.
  // Return Result — never throw.
  // Keep surface-agnostic: no process.exit(), no console.log().
  // --- Resources (optional) ---
  // Declare external dependencies so the framework manages lifecycle and testing.
  // resources: [db],

  blaze: async (input, ctx) => {
    // Your logic here. Input types are guaranteed by the schema.
    // Use ctx for resources, logging, and following other trails.

    // Access a declared resource — typed from the resource's create() return:
    // const conn = db.from(ctx);
    // const record = await conn.findByName(input.name);

    // Success:
    return Result.ok({ id: '1', name: input.name });

    // Error (use the most specific TrailsError subclass):
    // return Result.err(new NotFoundError(`Thing "${input.name}" not found`));
  },
});
```
