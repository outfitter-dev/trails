/**
 * Example-driven parity checks across shipped surfaces.
 */

import { describe, expect, test } from 'bun:test';

import { deriveCliPath, filterSurfaceTrails } from '@ontrails/core';
import type {
  ResourceOverrideMap,
  Topo,
  Trail,
  TrailContext,
  TrailExample,
} from '@ontrails/core';
import { deriveHttpInputSource, deriveHttpMethod } from '@ontrails/http';
import type { HttpMethod } from '@ontrails/http';
import { MCP_TOOL_ERROR_META_KEY, deriveToolName } from '@ontrails/mcp';

import type { TestAllEstablishedOptions } from './all-established.js';
import {
  createMockResources,
  defaultCreatePermit,
  mergeResourceOverrides,
  mergeTestContext,
} from './context.js';
import { deriveTrailExamples } from './effective-examples.js';
import { createCliHarness } from './harness-cli.js';
import type { CliHarnessResult } from './harness-cli.js';
import { createHttpHarness } from './harness-http.js';
import type { HttpHarnessResult } from './harness-http.js';
import { createMcpHarness } from './harness-mcp.js';
import type { McpHarnessResult } from './harness-mcp.js';

type ParityTrail = Trail<unknown, unknown, unknown>;

export type SurfaceParitySurface = 'cli' | 'mcp' | 'http';

export interface SurfaceParityExclusion {
  /** Optional example name. Omit to exclude every example for the trail. */
  readonly example?: string | undefined;
  /** Human-readable reason shown in the skipped test name. */
  readonly reason: string;
  /** Trail ID to exclude. */
  readonly trailId: string;
}

export interface SurfaceParityOptions extends TestAllEstablishedOptions {
  readonly createResources?:
    | (() => ResourceOverrideMap | Promise<ResourceOverrideMap>)
    | undefined;
  readonly exclusions?: readonly SurfaceParityExclusion[] | undefined;
}

export type NormalizedSurfaceParityResult =
  | {
      readonly ok: true;
      readonly value: unknown;
    }
  | {
      readonly error: {
        readonly category: string;
        readonly code: string;
      };
      readonly ok: false;
    };

export interface SurfaceParityComparison {
  readonly cli: NormalizedSurfaceParityResult;
  readonly http: NormalizedSurfaceParityResult;
  readonly mcp: NormalizedSurfaceParityResult;
}

const httpPathForTrail = (trailId: string): string =>
  `/${trailId.replaceAll('.', '/')}`;

const escapeWhitespaceForCliToken = (value: string): string =>
  value.replaceAll(/\s/gu, (char) => {
    let escaped = '';

    for (let index = 0; index < char.length; index += 1) {
      const codePoint = char.codePointAt(index);

      if (codePoint !== undefined) {
        escaped += `\\u${codePoint.toString(16).padStart(4, '0')}`;
      }
    }

    return escaped;
  });

const cliCommandForExample = (
  trail: ParityTrail,
  example: TrailExample<unknown, unknown>
): string => {
  const path = deriveCliPath(trail.id).join(' ');
  const inputJson = escapeWhitespaceForCliToken(
    JSON.stringify(example.input ?? {})
  );
  return `${path} --input-json ${inputJson} --output json`;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const readTextContent = (content: unknown): string | undefined => {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const firstText = content.find(
    (item): item is { readonly text: string; readonly type: string } =>
      isObjectRecord(item) &&
      item['type'] === 'text' &&
      typeof item['text'] === 'string'
  );
  return firstText?.text;
};

const parseJsonText = (text: string | undefined): unknown => {
  if (text === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const structuredContentValue = (
  structuredContent: Record<string, unknown> | undefined
): unknown => {
  if (structuredContent === undefined) {
    return undefined;
  }
  const keys = Object.keys(structuredContent);
  return keys.length === 1 && keys[0] === 'data'
    ? structuredContent['data']
    : structuredContent;
};

const normalizeCliResult = (
  result: CliHarnessResult
): NormalizedSurfaceParityResult =>
  result.exitCode === 0
    ? { ok: true, value: result.json }
    : {
        error: {
          category: result.error?.category ?? 'internal',
          code: result.error?.code ?? 'InternalError',
        },
        ok: false,
      };

const normalizeHttpResult = (
  result: HttpHarnessResult
): NormalizedSurfaceParityResult =>
  result.ok
    ? { ok: true, value: result.data }
    : {
        error: {
          category: result.error?.category ?? 'internal',
          code: result.error?.code ?? 'InternalError',
        },
        ok: false,
      };

const readMcpError = (
  result: McpHarnessResult
): { readonly category: string; readonly code: string } => {
  const errorMeta = result.meta?.[MCP_TOOL_ERROR_META_KEY];
  if (isObjectRecord(errorMeta)) {
    return {
      category:
        typeof errorMeta['category'] === 'string'
          ? errorMeta['category']
          : 'internal',
      code:
        typeof errorMeta['name'] === 'string'
          ? errorMeta['name']
          : 'InternalError',
    };
  }
  return { category: 'internal', code: 'InternalError' };
};

const normalizeMcpResult = (
  result: McpHarnessResult
): NormalizedSurfaceParityResult =>
  result.isError
    ? { error: readMcpError(result), ok: false }
    : {
        ok: true,
        value:
          result.structuredContent === undefined
            ? parseJsonText(readTextContent(result.content))
            : structuredContentValue(result.structuredContent),
      };

const applyAutoPermit = (
  ctx: TrailContext,
  trail: ParityTrail,
  options: SurfaceParityOptions
): TrailContext => {
  if (options.strictPermits || ctx.permit !== undefined) {
    return ctx;
  }
  const permit = (options.createPermit ?? defaultCreatePermit)(trail);
  return permit === undefined ? ctx : { ...ctx, permit };
};

const createInvocationContext = async (
  app: Topo,
  trail: ParityTrail,
  options: SurfaceParityOptions
) => {
  const autoResources =
    options.createResources === undefined
      ? await createMockResources(app)
      : await options.createResources();
  const resources = mergeResourceOverrides(
    autoResources,
    options.ctx,
    options.resources
  );
  const ctx = applyAutoPermit(mergeTestContext(options.ctx), trail, options);
  return { ctx, resources };
};

const mergeSurfaceContext = (
  ctx: TrailContext,
  surfaceCtx: Partial<TrailContext> | undefined
): TrailContext =>
  surfaceCtx === undefined ? ctx : mergeTestContext({ ...ctx, ...surfaceCtx });

const runCliExample = async (
  app: Topo,
  trail: ParityTrail,
  example: TrailExample<unknown, unknown>,
  options: SurfaceParityOptions
): Promise<NormalizedSurfaceParityResult> => {
  const { ctx, resources } = await createInvocationContext(app, trail, options);
  const cliOptions = options.cli;
  const harness = createCliHarness({
    graph: app,
    ...cliOptions,
    ctx: mergeSurfaceContext(ctx, cliOptions?.ctx),
    resources,
  });
  return normalizeCliResult(
    await harness.run(cliCommandForExample(trail, example))
  );
};

const runMcpExample = async (
  app: Topo,
  trail: ParityTrail,
  example: TrailExample<unknown, unknown>,
  options: SurfaceParityOptions
): Promise<NormalizedSurfaceParityResult> => {
  const { ctx, resources } = await createInvocationContext(app, trail, options);
  const mcpOptions = options.mcp;
  const harness = createMcpHarness({
    graph: app,
    ...mcpOptions,
    createContext: async () =>
      mergeSurfaceContext(ctx, await mcpOptions?.createContext?.()),
    resources,
  });
  const toolName = deriveToolName(app.name, trail.id);
  return normalizeMcpResult(
    await harness.callTool(
      toolName,
      isObjectRecord(example.input) ? example.input : {}
    )
  );
};

const httpRequestForExample = (
  method: HttpMethod,
  trailId: string,
  example: TrailExample<unknown, unknown>
) => {
  const input = isObjectRecord(example.input) ? example.input : {};
  return deriveHttpInputSource(method) === 'query'
    ? { method, path: httpPathForTrail(trailId), query: input }
    : { body: input, method, path: httpPathForTrail(trailId) };
};

const runHttpExample = async (
  app: Topo,
  trail: ParityTrail,
  example: TrailExample<unknown, unknown>,
  options: SurfaceParityOptions
): Promise<NormalizedSurfaceParityResult> => {
  const { ctx, resources } = await createInvocationContext(app, trail, options);
  const httpOptions = options.http;
  const harness = createHttpHarness({
    graph: app,
    ...httpOptions,
    ctx: mergeSurfaceContext(ctx, httpOptions?.ctx),
    resources,
  });
  const method = deriveHttpMethod(trail.intent);
  return normalizeHttpResult(
    await harness.request(httpRequestForExample(method, trail.id, example))
  );
};

export const runSurfaceParityExample = async (
  app: Topo,
  trail: ParityTrail,
  example: TrailExample<unknown, unknown>,
  options: SurfaceParityOptions = {}
): Promise<SurfaceParityComparison> => {
  // CLI harness output capture is process-scoped, so keep surface execution
  // ordered even though MCP and HTTP do not share that constraint.
  const cli = await runCliExample(app, trail, example, options);
  const mcp = await runMcpExample(app, trail, example, options);
  const http = await runHttpExample(app, trail, example, options);
  return { cli, http, mcp };
};

const findExclusion = (
  exclusions: readonly SurfaceParityExclusion[] | undefined,
  trail: ParityTrail,
  example: TrailExample<unknown, unknown>
): SurfaceParityExclusion | undefined =>
  exclusions?.find(
    (exclusion) =>
      exclusion.trailId === trail.id &&
      (exclusion.example === undefined || exclusion.example === example.name)
  );

const parityTrails = (app: Topo): readonly ParityTrail[] =>
  filterSurfaceTrails(app.list()).filter(
    (trail) => deriveTrailExamples(trail).length > 0
  );

/**
 * Register example-driven parity tests for CLI, MCP, and HTTP.
 *
 * @example
 * ```ts
 * import { testSurfaceParity } from '@ontrails/testing/surface-parity';
 * import { graph } from '../src/app.js';
 *
 * testSurfaceParity(graph);
 * ```
 */
export const testSurfaceParity = (
  app: Topo,
  optionsOrFactory?:
    | SurfaceParityOptions
    | (() => SurfaceParityOptions | undefined)
): void => {
  const resolveOptions =
    typeof optionsOrFactory === 'function'
      ? optionsOrFactory
      : () => optionsOrFactory;

  describe('surface parity', () => {
    for (const trail of parityTrails(app)) {
      describe(trail.id, () => {
        for (const example of deriveTrailExamples(trail)) {
          const options = resolveOptions() ?? {};
          const exclusion = findExclusion(options.exclusions, trail, example);
          const testName = `example: ${example.name}`;
          if (exclusion !== undefined) {
            test.skip(`${testName} (excluded: ${exclusion.reason})`, () => {
              throw new Error('Skipped parity exclusion should not execute');
            });
            continue;
          }

          test(testName, async () => {
            const comparison = await runSurfaceParityExample(
              app,
              trail,
              example,
              resolveOptions() ?? {}
            );
            expect(comparison.mcp).toEqual(comparison.cli);
            expect(comparison.http).toEqual(comparison.cli);
          });
        }
      });
    }
  });
};
