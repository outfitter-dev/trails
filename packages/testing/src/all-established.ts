/**
 * testAllEstablished - contract suite plus shipped surface projection checks.
 *
 * This helper intentionally lives behind a surface subpath so root
 * `@ontrails/testing` imports do not pull CLI, MCP, or HTTP peers into
 * contract-only consumers.
 */

import { describe, expect, test } from 'bun:test';

import type { Topo, TrailContext } from '@ontrails/core';
import { validateEstablishedTopo } from '@ontrails/core';

import { registerContractSuite } from './all.js';
import type { TestExecutionOptions } from './context.js';
import { createCliHarness } from './harness-cli.js';
import type { CliHarnessOptions } from './harness-cli.js';
import { createHttpHarness } from './harness-http.js';
import type { HttpHarnessOptions } from './harness-http.js';
import { createMcpHarness } from './harness-mcp.js';
import type { McpHarnessOptions } from './harness-mcp.js';

export interface TestAllEstablishedOptions {
  readonly cli?: Omit<CliHarnessOptions, 'graph'> | undefined;
  readonly createPermit?:
    | ((trail: {
        readonly permit?:
          | { readonly scopes: readonly string[] }
          | 'public'
          | undefined;
      }) =>
        | {
            readonly id: string;
            readonly scopes: readonly string[];
          }
        | undefined)
    | undefined;
  readonly ctx?: Partial<TrailContext> | undefined;
  readonly http?: Omit<HttpHarnessOptions, 'graph'> | undefined;
  readonly mcp?: Omit<McpHarnessOptions, 'graph'> | undefined;
  readonly resources?: Record<string, unknown> | undefined;
  readonly strictPermits?: boolean | undefined;
}

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
    Object.hasOwn(input, 'http') ||
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

const toHttpHarnessOptions = (
  topo: Topo,
  options: TestAllEstablishedOptions
) => {
  const httpOptions = {
    graph: topo,
    ...options.http,
  };

  if (options.ctx !== undefined) {
    httpOptions.ctx = options.ctx;
  }

  return httpOptions;
};

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

    test('HTTP projection validates established topo', () => {
      const options = normalizeEstablishedOptions(resolveInput());
      expect(() =>
        createHttpHarness(toHttpHarnessOptions(topo, options))
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

  registerContractSuite(
    topo,
    () => toExecutionOptions(normalizeEstablishedOptions(resolveInput())),
    validateEstablishedTopo
  );
  registerEstablishedSurfaceSuite(topo, resolveInput);
};

export type { TestAllInput } from './all.js';
