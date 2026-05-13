/**
 * HTTP integration test harness.
 *
 * Builds framework-agnostic HTTP routes from a graph and executes them
 * directly, without Hono or a listening server.
 */

import { deriveHttpRoutes } from '@ontrails/http';
import type { HttpMethod, HttpRouteDefinition } from '@ontrails/http';
import type { TrailContext, TrailContextInit } from '@ontrails/core';
import { NotFoundError, projectPublicSurfaceError } from '@ontrails/core';

import { mergeTestContext } from './context.js';
import type {
  HttpHarness,
  HttpHarnessOptions,
  HttpHarnessRequest,
  HttpHarnessRequestOptions,
  HttpHarnessResult,
} from './types.js';

const TEST_ORIGIN = 'http://ontrails.test';

const normalizeMethod = (method: HttpMethod): HttpMethod =>
  method.toUpperCase() as HttpMethod;

const collectQueryParams = (url: URL): Record<string, unknown> => {
  const query: Record<string, unknown> = {};
  const seen = new Set<string>();

  for (const key of url.searchParams.keys()) {
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const values = url.searchParams.getAll(key);
    query[key] = values.length > 1 ? values : values[0];
  }

  return query;
};

const findRoute = (
  routes: readonly HttpRouteDefinition[],
  method: HttpMethod,
  path: string
): HttpRouteDefinition | undefined =>
  routes.find((route) => route.method === method && route.path === path);

const mapError = (error: Error): HttpHarnessResult => {
  const projection = projectPublicSurfaceError('http', error);
  const body = {
    error: {
      category: projection.category,
      code: projection.name,
      message: projection.message,
    },
  };
  return {
    body,
    error: body.error,
    ok: false,
    status: projection.code,
  };
};

const mapSuccess = (data: unknown): HttpHarnessResult => ({
  body: { data },
  data,
  ok: true,
  status: 200,
});

const isWebhookParseResult = (
  input: unknown
): input is {
  readonly error?: Error | undefined;
  isErr(): boolean;
  readonly value?: unknown | undefined;
} =>
  typeof input === 'object' &&
  input !== null &&
  'isErr' in input &&
  typeof input.isErr === 'function';

const mergeContextInit = (
  base: TrailContextInit | undefined,
  ctx: Partial<TrailContext> | undefined
): TrailContextInit => ({
  ...base,
  ...mergeTestContext({ ...base, ...ctx }),
});

const createHarnessContextFactory = (
  options: HttpHarnessOptions
): (() => TrailContextInit | Promise<TrailContextInit>) => {
  const { createContext, ctx } = options;
  return async () => {
    const base = await createContext?.();
    return mergeContextInit(base, ctx);
  };
};

const buildInput = (
  route: HttpRouteDefinition,
  url: URL,
  request: HttpHarnessRequest
): unknown => {
  if (route.inputSource === 'query') {
    return {
      ...collectQueryParams(url),
      ...request.query,
    };
  }
  return request.body ?? {};
};

const executeRouteWithInput = async (
  route: HttpRouteDefinition,
  input: unknown,
  request: HttpHarnessRequest
): Promise<HttpHarnessResult> => {
  const result = await route.execute(
    input,
    request.requestId,
    request.abortSignal,
    { headers: request.headers }
  );

  if (result.isErr()) {
    return mapError(result.error);
  }

  return mapSuccess(result.value);
};

const executeRoute = async (
  route: HttpRouteDefinition,
  url: URL,
  request: HttpHarnessRequest
): Promise<HttpHarnessResult> => {
  const parsedInput = buildInput(route, url, request);
  if (route.inputSource === 'webhook' && route.parseWebhookInput) {
    const parsed = route.parseWebhookInput(parsedInput);
    if (isWebhookParseResult(parsed)) {
      if (parsed.isErr()) {
        return mapError(parsed.error ?? new Error('Invalid webhook input'));
      }
      return await executeRouteWithInput(route, parsed.value, request);
    }
    return await executeRouteWithInput(route, parsed, request);
  }

  return await executeRouteWithInput(route, parsedInput, request);
};

// ---------------------------------------------------------------------------
// createHttpHarness
// ---------------------------------------------------------------------------

/**
 * Create an HTTP harness for integration testing.
 *
 * @example
 * ```ts
 * import { createHttpHarness } from '@ontrails/testing';
 *
 * const http = createHttpHarness({ graph });
 * const result = await http.get('/entity/show', { name: 'Alpha' });
 * expect(result.status).toBe(200);
 * ```
 */
export const createHttpHarness = (
  harnessOptions: HttpHarnessOptions
): HttpHarness => {
  const { ctx: _ctx, graph, ...deriveOptions } = harnessOptions;
  const routesResult = deriveHttpRoutes(graph, {
    ...deriveOptions,
    createContext: createHarnessContextFactory(harnessOptions),
  });
  if (routesResult.isErr()) {
    throw routesResult.error;
  }
  const routes = routesResult.value;

  const request = async (
    rawRequest: HttpHarnessRequest
  ): Promise<HttpHarnessResult> => {
    const method = normalizeMethod(rawRequest.method);
    const url = new URL(rawRequest.path, TEST_ORIGIN);
    const route = findRoute(routes, method, url.pathname);

    if (!route) {
      return mapError(
        new NotFoundError(`No HTTP route found for ${method} ${url.pathname}`)
      );
    }

    return await executeRoute(route, url, { ...rawRequest, method });
  };

  return {
    delete: async (
      path: string,
      body?: unknown,
      requestOptions?: HttpHarnessRequestOptions
    ) =>
      await request({
        ...requestOptions,
        body,
        method: 'DELETE',
        path,
      }),
    get: async (
      path: string,
      query?: Record<string, unknown>,
      requestOptions?: HttpHarnessRequestOptions
    ) =>
      await request({
        ...requestOptions,
        method: 'GET',
        path,
        query: {
          ...requestOptions?.query,
          ...query,
        },
      }),
    patch: async (
      path: string,
      body?: unknown,
      requestOptions?: HttpHarnessRequestOptions
    ) =>
      await request({
        ...requestOptions,
        body,
        method: 'PATCH',
        path,
      }),
    post: async (
      path: string,
      body?: unknown,
      requestOptions?: HttpHarnessRequestOptions
    ) =>
      await request({
        ...requestOptions,
        body,
        method: 'POST',
        path,
      }),
    put: async (
      path: string,
      body?: unknown,
      requestOptions?: HttpHarnessRequestOptions
    ) =>
      await request({
        ...requestOptions,
        body,
        method: 'PUT',
        path,
      }),
    request,
  };
};
