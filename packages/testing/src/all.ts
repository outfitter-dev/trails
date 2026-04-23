/**
 * testAll — single-line governance suite for any Topo.
 *
 * Wraps topo validation, example execution, contract checks, and detour
 * contract validation into one describe block.
 */

import { describe, expect, test } from 'bun:test';

import type { Topo, TrailContext } from '@ontrails/core';
import { validateEstablishedTopo, validateTopo } from '@ontrails/core';

import { createCliHarness } from './harness-cli.js';
import { createMcpHarness } from './harness-mcp.js';
import { testContracts } from './contracts.js';
import type { TestExecutionOptions } from './context.js';
import { testDetours } from './detours.js';
import { testExamples } from './examples.js';
import type { TestAllEstablishedOptions } from './types.js';

/**
 * Run the full governance test suite for a Topo.
 *
 * Generates a `governance` describe block containing:
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
type TestAllInput =
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

const registerGovernanceSuite = (
  topo: Topo,
  ctxOrFactory: TestAllInput | undefined,
  validate: (topo: Topo) => ReturnType<typeof validateTopo>
): void => {
  describe('governance', () => {
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
  registerGovernanceSuite(topo, ctxOrFactory, validateTopo);
};

type EstablishedInput =
  | Partial<TrailContext>
  | TestAllEstablishedOptions
  | (() => Partial<TrailContext> | TestAllEstablishedOptions);

const isEstablishedOptions = (
  input: Partial<TrailContext> | TestAllEstablishedOptions | undefined
): input is TestAllEstablishedOptions =>
  input !== undefined &&
  (Object.hasOwn(input, 'cli') ||
    Object.hasOwn(input, 'createPermit') ||
    Object.hasOwn(input, 'ctx') ||
    Object.hasOwn(input, 'mcp') ||
    Object.hasOwn(input, 'resources') ||
    Object.hasOwn(input, 'strictPermits'));

const normalizeEstablishedOptions = (
  input?: Partial<TrailContext> | TestAllEstablishedOptions
): TestAllEstablishedOptions =>
  isEstablishedOptions(input) ? input : { ctx: input };

const toExecutionOptions = (
  options: TestAllEstablishedOptions
): TestExecutionOptions => ({
  ...(options.createPermit === undefined
    ? {}
    : { createPermit: options.createPermit }),
  ...(options.ctx === undefined ? {} : { ctx: options.ctx }),
  ...(options.resources === undefined ? {} : { resources: options.resources }),
  ...(options.strictPermits === undefined
    ? {}
    : { strictPermits: options.strictPermits }),
});

const toCliHarnessOptions = (
  topo: Topo,
  options: TestAllEstablishedOptions
) => {
  const cliOptions = {
    graph: topo,
    ...options.cli,
  };

  if (options.ctx !== undefined) {
    cliOptions.ctx = options.ctx;
  }

  return cliOptions;
};

const toMcpHarnessOptions = (
  topo: Topo,
  options: TestAllEstablishedOptions
) => ({
  graph: topo,
  ...options.mcp,
});

const registerEstablishedSurfaceSuite = (
  topo: Topo,
  resolveInput: () =>
    | Partial<TrailContext>
    | TestAllEstablishedOptions
    | undefined
): void => {
  describe('surfaces', () => {
    test('CLI projection validates established topo', () => {
      const options = normalizeEstablishedOptions(resolveInput());
      expect(() =>
        createCliHarness(toCliHarnessOptions(topo, options))
      ).not.toThrow();
    });

    test('MCP projection validates established topo', () => {
      const options = normalizeEstablishedOptions(resolveInput());
      expect(() =>
        createMcpHarness(toMcpHarnessOptions(topo, options))
      ).not.toThrow();
    });
  });
};

export const testAllEstablished = (
  topo: Topo,
  optionsOrFactory?: EstablishedInput
): void => {
  const resolveInput =
    typeof optionsOrFactory === 'function'
      ? optionsOrFactory
      : () => optionsOrFactory;

  registerGovernanceSuite(
    topo,
    () => toExecutionOptions(normalizeEstablishedOptions(resolveInput())),
    validateEstablishedTopo
  );
  registerEstablishedSurfaceSuite(topo, resolveInput);
};
