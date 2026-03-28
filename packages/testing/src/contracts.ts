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

/** Check if a trail requires follow() but the context doesn't provide it. */
const needsFollowContext = (
  t: unknown,
  resolveCtx: () => Partial<TrailContext> | undefined
): boolean => {
  const spec = t as { follow?: readonly string[] };
  if (!spec.follow || spec.follow.length === 0) {
    return false;
  }
  return !resolveCtx()?.follow;
};

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
 * Verify that every trail implementation output matches its declared
 * output schema. Catches implementation-schema drift.
 *
 * Trails without output schemas or examples are skipped.
 */
export const testContracts = (
  app: Topo,
  ctxOrFactory?: Partial<TrailContext> | (() => Partial<TrailContext>)
): void => {
  const resolveCtx =
    typeof ctxOrFactory === 'function' ? ctxOrFactory : () => ctxOrFactory;
  const allEntries = app.list() as Trail<unknown, unknown>[];

  describe('contracts', () => {
    describe.each(allEntries)('$id', (t) => {
      if (t.output === undefined) {
        return;
      }
      if (t.examples === undefined || t.examples.length === 0) {
        return;
      }
      if (needsFollowContext(t, resolveCtx)) {
        return;
      }

      const { examples, output: outputSchema } = t;
      const successExamples = examples.filter((e) => e.error === undefined);

      test.each(successExamples)(
        'contract: $name',
        async (example: TrailExample<unknown, unknown>) => {
          const testCtx = mergeTestContext(resolveCtx());

          const validated = validateInput(t.input, example.input);
          const validatedInput = expectOk(validated);

          const result = await t.run(validatedInput, testCtx);
          const resultValue = expectOk(result);

          validateOutputSchema(outputSchema, resultValue, t.id, example.name);
        }
      );
    });
  });
};
