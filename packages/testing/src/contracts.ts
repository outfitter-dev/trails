/**
 * testContracts — output schema verification.
 *
 * For every trail that has both examples and an output schema,
 * run each example and validate the implementation output against
 * the declared schema.
 */

import { describe, test } from 'bun:test';

import type { Topo, TrailExample, Trail, TrailContext } from '@ontrails/core';
import { executeTrail, formatZodIssues, validateInput } from '@ontrails/core';
import type { z } from 'zod';

import { expectOk } from './assertions.js';
import {
  mergeResourceOverrides,
  mergeTestContext,
  normalizeTestExecutionOptions,
  resolveMockResources,
} from './context.js';
import type { TestExecutionOptions } from './context.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a trail requires cross() but the context doesn't provide it. */
const needsCrossContext = (
  t: unknown,
  resolveCtx: () => Partial<TrailContext> | TestExecutionOptions | undefined
): boolean => {
  const spec = t as { crosses?: readonly string[] };
  if (!spec.crosses || spec.crosses.length === 0) {
    return false;
  }
  return !normalizeTestExecutionOptions(resolveCtx()).ctx?.cross;
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
  ctxOrFactory?:
    | Partial<TrailContext>
    | TestExecutionOptions
    | (() => Partial<TrailContext> | TestExecutionOptions)
): void => {
  const resolveInput =
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
      if (needsCrossContext(t, resolveInput)) {
        return;
      }

      const { examples, output: outputSchema } = t;
      const successExamples = examples.filter((e) => e.error === undefined);

      test.each(successExamples)(
        'contract: $name',
        async (example: TrailExample<unknown, unknown>) => {
          const resolved = normalizeTestExecutionOptions(resolveInput());
          const resources = mergeResourceOverrides(
            await resolveMockResources(app),
            resolved.ctx,
            resolved.resources
          );
          const testCtx = mergeTestContext(resolved.ctx);

          const validated = validateInput(t.input, example.input);
          expectOk(validated);

          const result = await executeTrail(t, example.input, {
            ctx: testCtx,
            resources,
          });
          const resultValue = expectOk(result);

          validateOutputSchema(outputSchema, resultValue, t.id, example.name);
        }
      );
    });
  });
};
