/**
 * testAll — single-line contract suite for any Topo.
 *
 * Wraps topo validation, example execution, contract checks, and detour
 * contract validation into one describe block.
 */

import { describe, expect, test } from 'bun:test';

import type { Topo, TrailContext } from '@ontrails/core';
import { validateTopo } from '@ontrails/core';

import { testContracts } from './contracts.js';
import type { TestExecutionOptions } from './context.js';
import { testDetours } from './detours.js';
import { testExamples } from './examples.js';

/**
 * Run the full contract test suite for a Topo.
 *
 * Generates a `contract` describe block containing:
 * - Structural validation via `validateTopo`
 * - Example execution via `testExamples`
 * - Output contract checks via `testContracts`
 * - Detour contract validation via `testDetours`
 *
 * Accepts either a static context or a factory function that produces a
 * fresh context per test (useful when the context contains mutable state
 * like an in-memory store).
 *
 * @example
 * ```ts
 * import { testAll } from '@ontrails/testing';
 * import { graph } from '../src/app.js';
 *
 * testAll(graph);
 * ```
 */
export type TestAllInput =
  | Partial<TrailContext>
  | TestExecutionOptions
  | (() => Partial<TrailContext> | TestExecutionOptions);

const formatValidationFailure = (error: Error): string => {
  const issues = (
    error as {
      context?: { issues?: readonly Record<string, unknown>[] };
    }
  ).context?.issues;

  if (issues === undefined || issues.length === 0) {
    return error.message;
  }

  const details = issues.map((issue) => {
    const id = typeof issue['id'] === 'string' ? issue['id'] : undefined;
    const message =
      typeof issue['message'] === 'string' ? issue['message'] : undefined;
    const rule = typeof issue['rule'] === 'string' ? issue['rule'] : undefined;

    return [rule, id, message].filter(Boolean).join(': ');
  });

  return [error.message, ...details].join('\n');
};

const assertValidTopo = (result: ReturnType<typeof validateTopo>): void => {
  if (result.isErr()) {
    throw new Error(formatValidationFailure(result.error));
  }
};

export const registerContractSuite = (
  topo: Topo,
  ctxOrFactory: TestAllInput | undefined,
  validate: (topo: Topo) => ReturnType<typeof validateTopo>
): void => {
  describe('contract', () => {
    test('topo validates', () => {
      expect(() => assertValidTopo(validate(topo))).not.toThrow();
    });

    // oxlint-disable-next-line jest/require-hook -- these generate describe/test blocks, not setup code
    testExamples(topo, ctxOrFactory);
    // oxlint-disable-next-line jest/require-hook -- these generate describe/test blocks, not setup code
    testContracts(topo, ctxOrFactory);
    // oxlint-disable-next-line jest/require-hook -- these generate describe/test blocks, not setup code
    testDetours(topo);
  });
};

export const testAll = (topo: Topo, ctxOrFactory?: TestAllInput): void => {
  registerContractSuite(topo, ctxOrFactory, validateTopo);
};
