import {
  InternalError,
  NotFoundError,
  Result,
  projectPublicSurfaceError,
  trail,
} from '@ontrails/core';
import type {
  BaseSurfaceOptions,
  Layer,
  ResourceOverrideMap,
  Topo,
  Trail,
  TrailContextInit,
} from '@ontrails/core';
import { z } from 'zod';

import { deriveHttpRoutes } from './build.js';
import type {
  HttpMethod,
  HttpRouteDefinition,
  ResolveHttpPermit,
} from './build.js';
import { createRouteHandler } from './fetch.js';
import type { CreateRouteHandlerOptions } from './fetch.js';

export interface CreateAppOptions extends BaseSurfaceOptions {
  readonly basePath?: string | undefined;
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly hostname?: string | undefined;
  readonly layers?: readonly Layer[] | undefined;
  /** Maximum JSON request body size in bytes. Defaults to 1 MiB. */
  readonly maxJsonBodyBytes?: number | undefined;
  readonly port?: number | undefined;
  readonly resources?: ResourceOverrideMap | undefined;
  readonly resolvePermit?: ResolveHttpPermit | undefined;
}

export interface SurfaceHttpResult {
  readonly close: () => Promise<void>;
  readonly url: string;
}

type RouteHandler = (request: Request) => Promise<Response>;

type BunRouteMethod = HttpMethod | 'HEAD';
type BunRouteRecord = Record<
  string,
  Partial<Record<BunRouteMethod, RouteHandler>>
>;

export interface BunHttpApp {
  readonly fetch: RouteHandler;
  readonly onError: (error: Error) => Promise<Response>;
  readonly routes: BunRouteRecord;
}

const json = (body: Record<string, unknown>, status: number): Response =>
  Response.json(body, { status });

const mapErrorResponse = (error: Error): Response => {
  const projection = projectPublicSurfaceError('http', error);
  return json(
    {
      error: {
        category: projection.category,
        code: projection.name,
        message: projection.message,
      },
    },
    projection.code
  );
};

const notFoundResponse = (request: Request): Response => {
  const path = new URL(request.url).pathname;
  return mapErrorResponse(new NotFoundError(`HTTP route not found: ${path}`));
};

const methodNotAllowedResponse = (
  request: Request,
  route: Partial<Record<BunRouteMethod, RouteHandler>>
): Response => {
  const path = new URL(request.url).pathname;
  return Response.json(
    {
      error: {
        category: 'validation',
        code: 'MethodNotAllowed',
        message: `HTTP method not allowed: ${request.method.toUpperCase()} ${path}`,
      },
    },
    {
      headers: { Allow: Object.keys(route).toSorted().join(', ') },
      status: 405,
    }
  );
};

const bodylessHeadResponse = (response: Response): Response =>
  new Response(null, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });

const caughtErrors = new Map<string, Error>();
const caughtErrorInput = z.object({ errorId: z.string() });
const caughtErrorTrail = trail('__ontrails.http.bun.error', {
  implementation: () =>
    Result.err(new InternalError('Bun error fallback executed directly')),
  input: caughtErrorInput,
  intent: 'read',
  output: z.object({}),
}) as Trail<unknown, unknown, unknown>;

const caughtErrorRoute: HttpRouteDefinition = {
  execute: async (input) => {
    const parsed = caughtErrorInput.safeParse(input);
    if (!parsed.success) {
      return Result.err(
        new InternalError('Bun error fallback missing error id')
      );
    }
    const error =
      caughtErrors.get(parsed.data.errorId) ??
      new Error('Bun error fallback missing caught error');
    return Result.err(error);
  },
  inputSource: 'query',
  method: 'GET',
  path: '/__ontrails/http/bun/error',
  trail: caughtErrorTrail,
  trailId: '__ontrails.http.bun.error',
};
const caughtErrorHandler = createRouteHandler(caughtErrorRoute);

const materializeCaughtErrorRequest = (errorId: string): Request => {
  const url = new URL('/__ontrails/http/bun/error', 'http://localhost');
  url.searchParams.set('errorId', errorId);
  return new Request(url);
};

const deriveOptions = (options: CreateAppOptions) => ({
  basePath: options.basePath,
  configValues: options.configValues,
  createContext: options.createContext,
  exclude: options.exclude,
  include: options.include,
  intent: options.intent,
  layers: options.layers,
  resolvePermit: options.resolvePermit,
  resources: options.resources,
  validate: options.validate,
});

const routeHandlerOptions = (
  options: CreateAppOptions
): CreateRouteHandlerOptions => ({
  maxJsonBodyBytes: options.maxJsonBodyBytes,
});

const registerRoute = (
  routes: BunRouteRecord,
  route: HttpRouteDefinition,
  options: CreateRouteHandlerOptions
): void => {
  const methods = routes[route.path] ?? {};
  const handler = createRouteHandler(route, options);
  methods[route.method] = handler;
  if (route.method === 'GET') {
    methods.HEAD = async (request) => {
      const response = await handler(request);
      return bodylessHeadResponse(response);
    };
  }
  routes[route.path] = methods;
};

const routeForRequest = (
  routes: BunRouteRecord,
  request: Request
): Partial<Record<BunRouteMethod, RouteHandler>> | undefined => {
  const path = new URL(request.url).pathname;
  return routes[path];
};

/**
 * Build Bun-compatible HTTP route handlers from a topo.
 *
 * @remarks This materializes `deriveHttpRoutes` onto Bun's native `routes`
 * table while preserving `fetch` as the fallback path for unmatched requests.
 */
export const createApp = (
  graph: Topo,
  options: CreateAppOptions = {}
): BunHttpApp => {
  const routesResult = deriveHttpRoutes(graph, deriveOptions(options));

  if (routesResult.isErr()) {
    throw routesResult.error;
  }

  const handlerOptions = routeHandlerOptions(options);
  const routes: BunRouteRecord = {};
  for (const route of routesResult.value) {
    registerRoute(routes, route, handlerOptions);
  }

  return {
    fetch: async (request) => {
      const method = request.method.toUpperCase() as BunRouteMethod;
      const route = routeForRequest(routes, request);
      if (route === undefined) {
        const response = notFoundResponse(request);
        return method === 'HEAD' ? bodylessHeadResponse(response) : response;
      }
      const methodHandler = route[method];
      const response =
        methodHandler === undefined
          ? methodNotAllowedResponse(request, route)
          : await methodHandler(request);
      return method === 'HEAD' ? bodylessHeadResponse(response) : response;
    },
    onError: async (error) => {
      const errorId = crypto.randomUUID();
      caughtErrors.set(errorId, error);
      try {
        return await caughtErrorHandler(materializeCaughtErrorRequest(errorId));
      } finally {
        caughtErrors.delete(errorId);
      }
    },
    routes,
  };
};

const startServer = (
  app: BunHttpApp,
  options: CreateAppOptions
): SurfaceHttpResult => {
  const server = Bun.serve({
    error: app.onError,
    fetch: app.fetch,
    hostname: options.hostname ?? '0.0.0.0',
    port: options.port ?? 3000,
    routes: app.routes,
  });

  return {
    close: async () => {
      await server.stop(true);
    },
    url: String(server.url),
  };
};

/**
 * Build a Bun-native HTTP app from a topo and start serving it.
 */
export const surface = async (
  graph: Topo,
  options: CreateAppOptions = {}
): Promise<SurfaceHttpResult> => {
  // oxlint-disable-next-line require-await -- async ensures createApp() throws become rejected promises, not uncaught exceptions
  const app = createApp(graph, options);
  return startServer(app, options);
};
