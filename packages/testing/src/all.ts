/**
 * testAll — single-line governance suite for any Topo.
 *
 * Wraps topo validation, example execution, contract checks, and detour
 * verification into one describe block.
 */

import { describe, expect, test } from 'bun:test';

import type { Topo, TrailContext } from '@ontrails/core';
import { validateTopo } from '@ontrails/core';

import { testContracts } from './contracts.js';
import { testDetours } from './detours.js';
import { testExamples } from './examples.js';

/**
 * Run the full governance test suite for a Topo.
 *
 * Generates a `governance` describe block containing:
 * - Structural validation via `validateTopo`
 * - Example execution via `testExamples`
 * - Output contract checks via `testContracts`
 * - Detour target verification via `testDetours`
 *
 * Accepts either a static context or a factory function that produces a
 * fresh context per test (useful when the context contains mutable state
 * like an in-memory store).
 *
 * @example
 * ```ts
 * import { testAll } from '@ontrails/testing';
 * import { app } from '../src/app.js';
 *
 * testAll(app);
 * ```
 */
export const testAll = (
  topo: Topo,
  ctxOrFactory?: Partial<TrailContext> | (() => Partial<TrailContext>)
): void => {
  describe('governance', () => {
    test('topo validates', () => {
      const result = validateTopo(topo);
      expect(result.isOk()).toBe(true);
    });

    // oxlint-disable-next-line jest/require-hook -- these generate describe/test blocks, not setup code
    testExamples(topo, ctxOrFactory);
    // oxlint-disable-next-line jest/require-hook -- these generate describe/test blocks, not setup code
    testContracts(topo, ctxOrFactory);
    // oxlint-disable-next-line jest/require-hook -- these generate describe/test blocks, not setup code
    testDetours(topo);
  });
};
