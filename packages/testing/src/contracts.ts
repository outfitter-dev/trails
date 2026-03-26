/**
 * testContracts — output schema verification.
 *
 * For every trail that has both examples and an output schema,
 * run each example and validate the implementation output against
 * the declared schema.
 */

import { describe, test } from 'bun:test';

import type { Topo, TrailExample, Trail, TrailContext } from '@ontrails/core';
import { formatZodIssues, validateInput } from '@ontrails/core';
import type { z } from 'zod';

import { expectOk } from './assertions.js';
import { mergeTestContext } from './context.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const validateOutputSchema = (
  outputSchema: z.ZodType,
  value: unknown,
  trailId: string,
  exampleName: string
): void => {
  const parsed = outputSchema.safeParse(value);
  if (!parsed.success) {
    const issues = formatZodIssues(parsed.error.issues);
    throw new Error(
      `Output schema violation for trail "${trailId}", example "${exampleName}":\n${issues.map((i) => `  - ${i}`).join('\n')}\n\nActual output: ${JSON.stringify(value, null, 2)}`
    );
  }
};

// ---------------------------------------------------------------------------
// testContracts
// ---------------------------------------------------------------------------

/**
 * Verify that every trail's implementation output matches its declared
 * output schema. Catches implementation-schema drift.
 *
 * Trails without output schemas or examples are skipped.
 */
export const testContracts = (app: Topo, ctx?: Partial<TrailContext>): void => {
  const trailEntries = [...app.trails];

  describe('contracts', () => {
    describe.each(trailEntries)('%s', (_id, trailDef) => {
      const t = trailDef as Trail<unknown, unknown>;

      if (t.output === undefined) {
        return;
      }
      if (t.examples === undefined || t.examples.length === 0) {
        return;
      }

      const { examples, output: outputSchema } = t;
      const successExamples = examples.filter((e) => e.error === undefined);

      test.each(successExamples)(
        'contract: $name',
        async (example: TrailExample<unknown, unknown>) => {
          const testCtx = mergeTestContext(ctx);

          const validated = validateInput(t.input, example.input);
          const validatedInput = expectOk(validated);

          const result = await t.implementation(validatedInput, testCtx);
          const resultValue = expectOk(result);

          validateOutputSchema(outputSchema, resultValue, t.id, example.name);
        }
      );
    });
  });
};
