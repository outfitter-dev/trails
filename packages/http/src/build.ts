/**
 * Build HTTP route definitions from a Trails topo.
 *
 * Iterates the topo, generates HttpRouteDefinition[] with handlers that
 * validate input, compose layers, execute the implementation, and map
 * Results to HTTP responses.
 */

import {
  composeLayers,
  createTrailContext,
  isTrailsError,
  statusCodeMap,
  validateInput,
} from '@ontrails/core';
import type { Layer, Topo, Trail, TrailContext } from '@ontrails/core';
import type { Context as HonoContext } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BuildHttpRoutesOptions {
  readonly basePath?: string | undefined;
  readonly createContext?:
    | (() => TrailContext | Promise<TrailContext>)
    | undefined;
  readonly layers?: readonly Layer[] | undefined;
}

export type HttpMethod = 'GET' | 'POST' | 'DELETE';

export interface HttpRouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly handler: (c: HonoContext) => Promise<Response>;
  readonly trailId: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derive HTTP method from trail intent. */
const deriveMethod = (trail: Trail<unknown, unknown>): HttpMethod => {
  const intentToMethod: Record<string, HttpMethod> = {
    destroy: 'DELETE',
    read: 'GET',
  };
  return intentToMethod[trail.intent] ?? 'POST';
};

/** Derive HTTP path from trail ID: `entity.show` -> `/entity/show`. */
const derivePath = (basePath: string, trailId: string): string => {
  const segments = trailId.replaceAll('.', '/');
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${base}/${segments}`;
};

/** Parse query params into a plain object, coercing simple types. */
const parseQueryParams = (c: HonoContext): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  const entries = new URL(c.req.url).searchParams.entries();
  for (const [key, value] of entries) {
    // Attempt numeric coercion
    if (value !== '' && !Number.isNaN(Number(value))) {
      result[key] = Number(value);
    } else if (value === 'true') {
      result[key] = true;
    } else if (value === 'false') {
      result[key] = false;
    } else {
      result[key] = value;
    }
  }
  return result;
};

/** Read input from request based on HTTP method. */
const readInput = async (
  c: HonoContext,
  method: HttpMethod
): Promise<unknown> => {
  if (method === 'GET') {
    return parseQueryParams(c);
  }
  try {
    return await c.req.json();
  } catch {
    return {};
  }
};

/** Check if a trail should be included (skip internal trails). */
const shouldInclude = (trail: Trail<unknown, unknown>): boolean =>
  trail.metadata?.['internal'] !== true;

/** Build a TrailContext from options and the Hono request context. */
const buildTrailContext = async (
  options: BuildHttpRoutesOptions,
  c: HonoContext
): Promise<TrailContext> => {
  const baseContext =
    options.createContext !== undefined && options.createContext !== null
      ? await options.createContext()
      : createTrailContext();

  const requestId = c.req.header('X-Request-ID') ?? baseContext.requestId;

  return {
    ...baseContext,
    requestId,
  };
};

/** Map a TrailsError or generic Error to an HTTP error response. */
const mapErrorResponse = (
  error: Error
): { body: Record<string, unknown>; status: ContentfulStatusCode } => {
  if (isTrailsError(error)) {
    return {
      body: {
        error: {
          category: error.category,
          code: error.name,
          message: error.message,
        },
      },
      status: statusCodeMap[error.category] as ContentfulStatusCode,
    };
  }
  return {
    body: {
      error: {
        category: 'internal',
        code: 'InternalError',
        message: error.message,
      },
    },
    status: 500,
  };
};

/** Convert a caught unknown value to an error response. */
const handleCaughtError = (error: unknown, c: HonoContext): Response => {
  const err = error instanceof Error ? error : new Error(String(error));
  const { body, status } = mapErrorResponse(err);
  return c.json(body, status);
};

/** Map a Result to an HTTP response. */
const mapResultResponse = (
  result: { isOk(): boolean; value?: unknown; error?: Error },
  c: HonoContext
): Response => {
  if (result.isOk()) {
    return c.json({ data: result.value }, 200);
  }
  const { body, status } = mapErrorResponse(
    result.error ?? new Error('Unknown error')
  );
  return c.json(body, status);
};

/** Execute the trail implementation and return an HTTP response. */
const executeTrail = async (
  trail: Trail<unknown, unknown>,
  validatedInput: unknown,
  layers: readonly Layer[],
  options: BuildHttpRoutesOptions,
  c: HonoContext
): Promise<Response> => {
  const ctx = await buildTrailContext(options, c);
  const impl = composeLayers([...layers], trail, trail.run);

  try {
    const result = await impl(validatedInput, ctx);
    return mapResultResponse(result, c);
  } catch (error: unknown) {
    return handleCaughtError(error, c);
  }
};

/** Create a route handler for a single trail. */
const createHandler =
  (
    trail: Trail<unknown, unknown>,
    method: HttpMethod,
    layers: readonly Layer[],
    options: BuildHttpRoutesOptions
  ): ((c: HonoContext) => Promise<Response>) =>
  async (c: HonoContext): Promise<Response> => {
    const rawInput = await readInput(c, method);
    const validated = validateInput(trail.input, rawInput);

    if (validated.isErr()) {
      const { body, status } = mapErrorResponse(validated.error);
      return c.json(body, status);
    }

    return executeTrail(trail, validated.value, layers, options, c);
  };

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/** Filter topo items to eligible trails. */
const eligibleTrails = (app: Topo): Trail<unknown, unknown>[] =>
  app
    .list()
    .filter(
      (item): item is Trail<unknown, unknown> =>
        item.kind === 'trail' && shouldInclude(item)
    );

/** Build a single route definition from a trail. */
const buildRoute = (
  trail: Trail<unknown, unknown>,
  basePath: string,
  layers: readonly Layer[],
  options: BuildHttpRoutesOptions
): HttpRouteDefinition => {
  const method = deriveMethod(trail);
  const path = derivePath(basePath, trail.id);
  return {
    handler: createHandler(trail, method, layers, options),
    method,
    path,
    trailId: trail.id,
  };
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build HTTP route definitions from a topo.
 *
 * Each trail becomes an HttpRouteDefinition with:
 * - An HTTP method derived from intent (read -> GET, destroy -> DELETE, default -> POST)
 * - A path derived from the trail ID (dots become slashes)
 * - A handler that validates input, composes layers, executes, and maps results
 */
export const buildHttpRoutes = (
  app: Topo,
  options: BuildHttpRoutesOptions = {}
): HttpRouteDefinition[] => {
  const basePath = options.basePath ?? '';
  const layers = options.layers ?? [];

  return eligibleTrails(app).map((trail) =>
    buildRoute(trail, basePath, layers, options)
  );
};
