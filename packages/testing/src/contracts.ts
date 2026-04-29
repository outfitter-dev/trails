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
  createMockResources,
} from './context.js';
import type { TestExecutionOptions } from './context.js';
import { deriveTrailExamples } from './effective-examples.js';

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
  const allEntries = (app.list() as Trail<unknown, unknown, unknown>[]).map(
    (trailDef) => ({
      ...trailDef,
      examples: deriveTrailExamples(trailDef),
    })
  );

  describe('contracts', () => {
    describe.each(allEntries)('$id', (t) => {
      if (t.output === undefined) {
        return;
      }
      if (t.examples.length === 0) {
        return;
      }
      const { examples, output: outputSchema } = t;
      const successExamples = examples.filter((e) => e.error === undefined);

      test.each(successExamples)(
        'contract: $name',
        async (example: TrailExample<unknown, unknown>) => {
          const resolved = normalizeTestExecutionOptions(resolveInput());
          const resources = mergeResourceOverrides(
            await createMockResources(app),
            resolved.ctx,
            resolved.resources
          );
          const testCtx = mergeTestContext(resolved.ctx);

          const validated = validateInput(t.input, example.input);
          expectOk(validated);

          const result = await executeTrail(t, example.input, {
            ctx: testCtx,
            resources,
            topo: app,
          });
          const resultValue = expectOk(result);

          validateOutputSchema(outputSchema, resultValue, t.id, example.name);
        }
      );
    });
  });
};
