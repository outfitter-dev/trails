/**
 * Derive an OpenAPI 3.1 specification from a Topo.
 *
 * Converts each trail into an HTTP operation, deriving paths, methods,
 * parameters, and response schemas from the trail contract.
 */

import {
  filterSurfaceTrails,
  statusCodeMap,
  validateDraftFreeTopo,
  zodToJsonSchema,
} from '@ontrails/core';
import type { Intent, Topo, Trail } from '@ontrails/core';

import type { JsonSchema } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OpenApiServer {
  readonly url: string;
  readonly description?: string | undefined;
}

export interface OpenApiOptions {
  /** Default: `graph.name` */
  readonly title?: string | undefined;
  /** Default: `'1.0.0'` */
  readonly version?: string | undefined;
  readonly description?: string | undefined;
  readonly servers?: readonly OpenApiServer[] | undefined;
  /** Prefix for all paths. Default: `''` */
  readonly basePath?: string | undefined;
  readonly exclude?: readonly string[] | undefined;
  readonly include?: readonly string[] | undefined;
  readonly intent?: readonly Intent[] | undefined;
}

/** Minimal OpenAPI 3.1 spec shape — intentionally plain objects, no heavy library. */
export interface OpenApiSpec {
  readonly openapi: '3.1.0';
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description?: string | undefined;
  };
  readonly servers?: readonly OpenApiServer[] | undefined;
  readonly paths: Record<string, Record<string, unknown>>;
  readonly components: { readonly schemas: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Error name → category lookup
// ---------------------------------------------------------------------------

const errorNameToCategory: Record<string, keyof typeof statusCodeMap> = {
  AlreadyExistsError: 'conflict',
  AmbiguousError: 'validation',
  AssertionError: 'internal',
  AuthError: 'auth',
  CancelledError: 'cancelled',
  ConflictError: 'conflict',
  InternalError: 'internal',
  NetworkError: 'network',
  NotFoundError: 'not_found',
  PermissionError: 'permission',
  RateLimitError: 'rate_limit',
  TimeoutError: 'timeout',
  ValidationError: 'validation',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const intentToMethod: Record<string, string> = {
  destroy: 'delete',
  read: 'get',
  write: 'post',
};

/** `entity.show` → `/entity/show` */
const trailIdToPath = (id: string, basePath: string): string =>
  `${basePath}/${id.split('.').join('/')}`;

/** First segment of a dotted ID, used as an OpenAPI tag. */
const tagFromId = (id: string): string => id.split('.')[0] ?? id;

/** Convert a Zod schema to JSON Schema via the core helper. */
const toJsonSchema = (schema: unknown): JsonSchema =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  zodToJsonSchema(schema as any) as JsonSchema;

/** Build query parameters from a JSON Schema `properties` object. */
const buildQueryParameters = (
  jsonSchema: JsonSchema
): Record<string, unknown>[] => {
  const properties = jsonSchema['properties'] as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (!properties) {
    return [];
  }

  const required = new Set(
    Array.isArray(jsonSchema['required'])
      ? (jsonSchema['required'] as string[])
      : []
  );

  return Object.entries(properties).map(([name, schema]) => ({
    in: 'query',
    name,
    required: required.has(name),
    schema,
  }));
};

/** Map a single error example to a status code entry, or undefined if not mappable. */
const errorExampleToEntry = (
  errorName: string,
  seen: Set<number>
): [string, { description: string }] | undefined => {
  const category = errorNameToCategory[errorName];
  if (!category) {
    return undefined;
  }
  const code = statusCodeMap[category];
  if (seen.has(code)) {
    return undefined;
  }
  seen.add(code);
  return [String(code), { description: errorName }];
};

/** Extract error status codes from trail examples that have an `error` field. */
const errorResponsesFromExamples = (
  examples: readonly { error?: string | undefined }[]
): Record<string, { description: string }> => {
  const responses: Record<string, { description: string }> = {};
  const seen = new Set<number>();

  for (const ex of examples) {
    if (!ex.error) {
      continue;
    }
    const entry = errorExampleToEntry(ex.error, seen);
    if (entry) {
      const [code, value] = entry;
      responses[code] = value;
    }
  }

  return responses;
};

// ---------------------------------------------------------------------------
// Operation builder — split into focused helpers
// ---------------------------------------------------------------------------

/** True when the body is required — non-object schemas are always required,
 *  object schemas are required only when they have at least one required property. */
const isBodyRequired = (schema: JsonSchema): boolean => {
  if (schema['type'] !== 'object') {
    return true;
  }
  return (
    Array.isArray(schema['required']) &&
    (schema['required'] as unknown[]).length > 0
  );
};

/** Build the input portion of an operation (parameters or requestBody). */
const buildInputSpec = (
  t: Trail<unknown, unknown, unknown>,
  method: string
): Record<string, unknown> => {
  if (!t.input) {
    return {};
  }
  const inputSchema = toJsonSchema(t.input);

  if (method === 'get') {
    const params = buildQueryParameters(inputSchema);
    return params.length > 0 ? { parameters: params } : {};
  }

  const properties = inputSchema['properties'] as
    | Record<string, unknown>
    | undefined;
  if (properties !== undefined && Object.keys(properties).length === 0) {
    return {};
  }

  return {
    requestBody: {
      content: { 'application/json': { schema: inputSchema } },
      required: isBodyRequired(inputSchema),
    },
  };
};

/** Wrap a raw output schema in the `{ data: ... }` envelope the HTTP connector uses. */
const wrapInDataEnvelope = (outputSchema: JsonSchema): JsonSchema => ({
  properties: { data: outputSchema },
  required: ['data'],
  type: 'object',
});

/** Shared error response body schema: `{ error: { message, code, category } }`. */
const errorResponseSchema: JsonSchema = {
  properties: {
    error: {
      properties: {
        category: { type: 'string' },
        code: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['message', 'code', 'category'],
      type: 'object',
    },
  },
  required: ['error'],
  type: 'object',
};

/** Build the 200 response entry. */
const buildSuccessResponse = (
  t: Trail<unknown, unknown, unknown>
): Record<string, unknown> => {
  if (!t.output) {
    return { '200': { description: 'Success' } };
  }
  const outputSchema = toJsonSchema(t.output);
  return {
    '200': {
      content: {
        'application/json': { schema: wrapInDataEnvelope(outputSchema) },
      },
      description: 'Success',
    },
  };
};

/** Build the default 400 validation error response. */
const validationErrorResponse: Record<
  string,
  { content: Record<string, unknown>; description: string }
> = {
  '400': {
    content: { 'application/json': { schema: errorResponseSchema } },
    description: 'Validation error',
  },
};

/** Build all responses (success + error) for a trail. */
const buildResponses = (
  t: Trail<unknown, unknown, unknown>
): Record<string, unknown> => {
  const examples = (t.examples ?? []) as readonly {
    error?: string | undefined;
  }[];
  return {
    ...buildSuccessResponse(t),
    ...validationErrorResponse,
    ...errorResponsesFromExamples(examples),
  };
};

/** Build a complete OpenAPI operation for a trail. */
const buildOperation = (
  t: Trail<unknown, unknown, unknown>,
  method: string
): Record<string, unknown> => ({
  operationId: t.id.replaceAll('.', '_'),
  responses: buildResponses(t),
  tags: [tagFromId(t.id)],
  ...(t.description ? { summary: t.description } : {}),
  ...buildInputSpec(t, method),
});

// ---------------------------------------------------------------------------
// Path collection
// ---------------------------------------------------------------------------

/** Collect all paths from public trails in the graph. */
const collectPaths = (
  graph: Topo,
  basePath: string,
  options?: OpenApiOptions
): Record<string, Record<string, unknown>> => {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const t of filterSurfaceTrails(graph.list(), {
    exclude: options?.exclude,
    include: options?.include,
    intent: options?.intent,
  })) {
    const method = intentToMethod[t.intent] ?? 'post';
    paths[trailIdToPath(t.id, basePath)] = {
      [method]: buildOperation(t, method),
    };
  }

  return paths;
};

/** Build the info object from options and graph name. */
const buildInfo = (
  graphName: string,
  options?: OpenApiOptions
): OpenApiSpec['info'] => ({
  title: options?.title ?? graphName,
  version: options?.version ?? '1.0.0',
  ...(options?.description ? { description: options.description } : {}),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive an OpenAPI 3.1 specification from a Topo.
 *
 * Iterates all trails, skipping signals and internal trails, and produces
 * paths, operations, parameters, and response schemas derived from
 * the trail contract.
 */
export const deriveOpenApiSpec = (
  graph: Topo,
  options?: OpenApiOptions
): OpenApiSpec => {
  const validated = validateDraftFreeTopo(graph);
  if (validated.isErr()) {
    throw validated.error;
  }

  return {
    components: { schemas: {} },
    info: buildInfo(graph.name, options),
    openapi: '3.1.0',
    paths: collectPaths(
      graph,
      (options?.basePath ?? '').replace(/\/+$/, ''),
      options
    ),
    ...(options?.servers && options.servers.length > 0
      ? { servers: options.servers }
      : {}),
  };
};
