/**
 * testTrail — custom scenario testing for individual trails.
 *
 * Use this for edge cases, boundary values, and regression tests
 * that don't belong in `examples` (which are agent-facing documentation).
 */

import { describe, expect, test } from 'bun:test';

import type { AnyTrail, Result, TrailContext } from '@ontrails/core';
import { ValidationError, validateInput } from '@ontrails/core';

import {
  assertErrorMatch,
  assertFullMatch,
  assertSchemaMatch,
  expectOk,
} from './assertions.js';
import { mergeTestContext } from './context.js';
import type { TestScenario } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const assertScenarioResult = (
  result: Result<unknown, Error>,
  scenario: TestScenario,
  trailDef: AnyTrail
): void => {
  if (scenario.expectValue !== undefined) {
    assertFullMatch(result, scenario.expectValue);
  } else if (scenario.expectErr !== undefined) {
    assertErrorMatch(result, scenario.expectErr, scenario.expectErrMessage);
  } else if (scenario.expectErrMessage !== undefined) {
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.message).toContain(scenario.expectErrMessage);
    }
  } else if (scenario.expectOk === true) {
    expect(result.isOk()).toBe(true);
    assertSchemaMatch(result, trailDef.output);
  }
};

/**
 * Handle input validation failure for a scenario.
 * Returns true if the error was expected and handled.
 * Throws if the error was unexpected.
 */
const handleValidationError = (
  validated: Result<unknown, Error>,
  scenario: TestScenario
): boolean => {
  if (!validated.isErr()) {
    return false;
  }

  if (scenario.expectErr === ValidationError) {
    expect(validated.error).toBeInstanceOf(ValidationError);
    if (scenario.expectErrMessage !== undefined) {
      expect(validated.error.message).toContain(scenario.expectErrMessage);
    }
    return true;
  }

  throw new Error(
    `Input validation failed unexpectedly: ${validated.error.message}`
  );
};

const runScenario = async (
  trailDef: AnyTrail,
  scenario: TestScenario,
  ctx: Partial<TrailContext> | undefined
): Promise<void> => {
  const testCtx = mergeTestContext(ctx);
  const validated = validateInput(trailDef.input, scenario.input);

  if (handleValidationError(validated, scenario)) {
    return;
  }
  const validatedInput = expectOk(validated);

  const result = await trailDef.run(validatedInput, testCtx);
  assertScenarioResult(result, scenario, trailDef);
};

// ---------------------------------------------------------------------------
// testTrail
// ---------------------------------------------------------------------------

/**
 * Generate a describe block for a trail with one test per scenario.
 *
 * ```ts
 * testTrail(myTrail, [
 *   { description: "valid input", input: { name: "Alpha" }, expectOk: true },
 *   { description: "missing name", input: {}, expectErr: ValidationError },
 * ]);
 * ```
 */
export const testTrail = (
  trailDef: AnyTrail,
  scenarios: readonly TestScenario[],
  ctx?: Partial<TrailContext>
): void => {
  describe(trailDef.id, () => {
    test.each([...scenarios])(
      '$description',
      async (scenario: TestScenario) => {
        await runScenario(trailDef, scenario, ctx);
      }
    );
  });
};
