/**
 * Build framework-agnostic HTTP route definitions from a Trails topo.
 *
 * Each route definition describes the path, method, input source, and an
 * `execute` function that validates input, composes layers, and runs the
 * implementation -- all without referencing any HTTP framework types.
 */

import {
  AuthError,
  Result,
  ValidationError,
  buildActivationProvenanceTraceAttrs,
  collectAttachedTypedLayers,
  createResources,
  createTrailContext,
  deriveSurfaceTrailVersionProjections,
  executeTrail,
  filterSurfaceTrails,
  getActivationWherePredicate,
  getTraceSink,
  LAYER_FIELD_RESERVED_NAMES,
  matchesTrailPattern,
  projectLayerFieldName,
  TRACE_CONTEXT_KEY,
  traceContextFromRecord,
  validateInput,
  validateWebhookSource,
  validateSurfaceTopo,
  verifyWebhookRequest,
  writeActivationTraceRecord,
  withActivationProvenance,
  withSurfaceLayerNames,
  zodToJsonSchema,
} from '@ontrails/core';
import type {
  ActivationEntry,
  ActivationProvenance,
  ActivationSource,
  AttachedTypedLayer,
  BasePermit,
  BaseSurfaceOptions,
  Layer,
  ResourceOverrideMap,
  SurfaceTrailVersionProjection,
  TraceContext,
  Topo,
  Trail,
  TrailVersionReference,
  TrailContextInit,
  WebhookSource,
  WebhookVerifyRequest,
} from '@ontrails/core';

import { deriveHttpInputSource, deriveHttpMethod } from './method.js';
import type { HttpMethod, InputSource } from './method.js';

export type { HttpMethod, InputSource } from './method.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DeriveHttpRoutesOptions extends BaseSurfaceOptions {
  readonly basePath?: string | undefined;
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly resources?: ResourceOverrideMap | undefined;
  readonly resolvePermit?: ResolveHttpPermit | undefined;
}

export type HttpHeaderSource =
  | Headers
  | Readonly<Record<string, string | readonly string[] | undefined>>;

export interface HttpExecutionContext {
  readonly headers?: HttpHeaderSource | undefined;
  readonly version?: TrailVersionReference | undefined;
}

export interface ResolveHttpPermitInput {
  readonly authorization?: string | undefined;
  readonly bearerToken?: string | undefined;
  readonly headers?: HttpHeaderSource | undefined;
  readonly requestId?: string | undefined;
}

export type ResolveHttpPermit = (
  input: ResolveHttpPermitInput
) =>
  | Promise<Result<BasePermit | null | undefined, Error>>
  | Result<BasePermit | null | undefined, Error>;

export interface HttpRouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly trailId: string;
  readonly inputSource: InputSource;
  readonly trail: Trail<unknown, unknown, unknown>;
  readonly versions?: readonly SurfaceTrailVersionProjection[] | undefined;
  /**
   * JSON Schema for the merged request input (trail input + projected layer
   * input fields). Empty/undefined when the trail declares no input and no
   * typed layer is attached. Surface adapters and OpenAPI generators read
   * this to build the published request shape.
   *
   * @see TRL-474.
   */
  readonly inputSchema?: Record<string, unknown> | undefined;
  /**
   * Per-layer projections describing the parameter names the route accepts
   * for typed layers and the routing target back onto each layer's input
   * schema. Empty when the trail has no typed layer attached.
   *
   * Surface adapters use this to partition the parsed request into
   * `{ trailInput, layerInputs }` before invoking `execute`. The `execute`
   * function published below performs the same partitioning for callers
   * that pass the full merged record straight through.
   *
   * @see TRL-474.
   */
  readonly layerInputProjections?: readonly HttpLayerInputProjection[];
  readonly parseWebhookInput?:
    | ((rawPayload: unknown) => Result<unknown, Error>)
    | undefined;
  readonly verifyWebhook?:
    | ((request: WebhookVerifyRequest) => Promise<Result<void, Error>>)
    | undefined;
  readonly recordWebhookInvalid?:
    | ((errorCategory?: string | undefined) => Promise<void>)
    | undefined;
  readonly webhookSource?: WebhookSource | undefined;
  /**
   * Validate input, compose layers, and run the trail implementation.
   *
   * The caller is responsible for parsing raw input from the request and
   * mapping the Result to an HTTP response. This function is framework-agnostic.
   *
   * @param abortSignal - Optional AbortSignal from the HTTP request. When provided,
   *   it takes final precedence over any context factory signal, allowing
   *   client-initiated cancellation to propagate into trail execution.
   * @param context - Optional request context such as headers. When supplied,
   *   HTTP Bearer credentials can be resolved into `ctx.permit`.
   */
  readonly execute: (
    input: unknown,
    requestId?: string | undefined,
    abortSignal?: AbortSignal | undefined,
    context?: HttpExecutionContext | undefined
  ) => Promise<Result<unknown, Error>>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derive HTTP method from trail intent. */
const deriveMethod = (trail: Trail<unknown, unknown, unknown>): HttpMethod =>
  deriveHttpMethod(trail.intent);

/** Derive HTTP path from trail ID: `entity.show` -> `/entity/show`. */
const derivePath = (basePath: string, trailId: string): string => {
  const segments = trailId.replaceAll('.', '/');
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${base}/${segments}`;
};

/** Build per-request context overrides with the HTTP surface marker. */
const withHttpSurface = (
  requestId: string | undefined,
  layers: readonly Layer[]
): Partial<TrailContextInit> =>
  withSurfaceLayerNames(
    'http',
    layers,
    requestId === undefined ? {} : { requestId }
  );

const readHeader = (
  headers: HttpHeaderSource | undefined,
  name: string
): string | undefined => {
  if (headers === undefined) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== needle || value === undefined) {
      continue;
    }
    return typeof value === 'string' ? value : value[0];
  }
  return undefined;
};

const parseBearerAuthorization = (
  authorization: string | undefined
): Result<string | undefined, Error> => {
  if (authorization === undefined || authorization.length === 0) {
    return Result.ok();
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (token === undefined || token.length === 0) {
    return Result.err(
      new AuthError('Malformed Authorization header; expected Bearer token', {
        context: { code: 'invalid_authorization_header' },
      })
    );
  }
  return Result.ok(token);
};

const isBearerAuthorization = (authorization: string | undefined): boolean =>
  authorization !== undefined && /^Bearer(?:\s|$)/i.test(authorization.trim());

const shouldResolveHttpPermit = (
  options: DeriveHttpRoutesOptions,
  authorization: string | undefined,
  requiresPermit: boolean
): boolean =>
  requiresPermit ||
  (options.resolvePermit !== undefined && isBearerAuthorization(authorization));

const resolveHttpPermit = async (
  options: DeriveHttpRoutesOptions,
  request: HttpExecutionContext | undefined,
  requestId: string | undefined,
  requiresPermit: boolean
): Promise<Result<BasePermit | undefined, Error>> => {
  const authorization = readHeader(request?.headers, 'authorization');
  if (!shouldResolveHttpPermit(options, authorization, requiresPermit)) {
    return Result.ok();
  }
  const token = parseBearerAuthorization(authorization);
  if (token.isErr()) {
    return token;
  }
  if (token.value === undefined) {
    return Result.ok();
  }
  if (options.resolvePermit === undefined) {
    return Result.ok();
  }
  const resolved = await options.resolvePermit({
    authorization,
    bearerToken: token.value,
    headers: request?.headers,
    requestId,
  });
  if (resolved.isErr()) {
    return resolved;
  }
  return Result.ok(resolved.value ?? undefined);
};

const createWebhookActivationFireId = (): string => {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return randomUUID.call(globalThis.crypto);
  }
  return `webhook_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
};

const webhookActivationProvenance = (
  source: WebhookSource,
  fireId: string
): ActivationProvenance => ({
  fireId,
  rootFireId: fireId,
  source: {
    id: source.id,
    kind: 'webhook',
    ...(source.meta === undefined ? {} : { meta: source.meta }),
  },
});

const webhookActivationTraceAttrs = (
  source: WebhookSource,
  activation: ActivationProvenance,
  trailId: string
): Readonly<Record<string, unknown>> => ({
  ...buildActivationProvenanceTraceAttrs(activation),
  'trails.activation.target_trail.id': trailId,
  'trails.activation.webhook.method': source.method,
  'trails.activation.webhook.path': source.path,
});

const recordWebhookActivationTrace = async (
  graph: Topo,
  source: WebhookSource,
  activation: ActivationProvenance,
  trailId: string,
  name: 'activation.webhook' | 'activation.webhook.invalid',
  status: 'err' | 'ok',
  errorCategory?: string | undefined
): Promise<TraceContext | undefined> => {
  const record = await writeActivationTraceRecord(
    name,
    webhookActivationTraceAttrs(source, activation, trailId),
    status,
    errorCategory,
    undefined,
    graph.observe?.trace ?? getTraceSink()
  );
  return record === undefined ? undefined : traceContextFromRecord(record);
};

/**
 * Internal recorder signature for webhook invalid traces.
 *
 * Unlike the public `HttpRouteDefinition['recordWebhookInvalid']`, this
 * accepts an `activationFireId` so a single inbound failed request can share
 * one activation fire ID across every consumer fan-out — letting
 * observability correlate sibling consumers' invalid records as one
 * activation root, mirroring the success path.
 */
type WebhookInvalidConsumerRecorder = (
  errorCategory: string | undefined,
  activationFireId: string
) => Promise<void>;

const createWebhookInvalidRecorder =
  (
    graph: Topo,
    source: WebhookSource,
    trailId: string
  ): WebhookInvalidConsumerRecorder =>
  async (errorCategory, activationFireId) => {
    const activation = webhookActivationProvenance(source, activationFireId);
    await recordWebhookActivationTrace(
      graph,
      source,
      activation,
      trailId,
      'activation.webhook.invalid',
      'err',
      errorCategory ?? 'validation'
    );
  };

/**
 * Wrap a single-consumer invalid recorder as the public `recordWebhookInvalid`
 * function. Generates one activation fire ID per inbound failed request,
 * matching the fan-out behavior so single and merged routes share the same
 * observability shape.
 */
const createWebhookInvalidPublicRecorder =
  (
    consumerRecorder: WebhookInvalidConsumerRecorder
  ): NonNullable<HttpRouteDefinition['recordWebhookInvalid']> =>
  async (errorCategory = 'validation') =>
    await consumerRecorder(errorCategory, createWebhookActivationFireId());

const withWebhookActivation = (
  activation: ActivationProvenance,
  requestId: string | undefined,
  traceContext: TraceContext | undefined,
  layers: readonly Layer[]
): Partial<TrailContextInit> => {
  const ctx = withActivationProvenance(
    withHttpSurface(requestId, layers),
    activation
  );
  return traceContext === undefined
    ? ctx
    : {
        ...ctx,
        extensions: {
          ...ctx.extensions,
          [TRACE_CONTEXT_KEY]: traceContext,
        },
      };
};

// ---------------------------------------------------------------------------
// Layer input projection (TRL-474)
// ---------------------------------------------------------------------------

/**
 * Per-layer projection onto an HTTP route's request input.
 *
 * `routing` maps the parameter name a consumer sees on the request (a query
 * key for `intent: 'read'`, a body field for write/destroy) to the authored
 * field name on the layer's input schema. When no rename was required the
 * two are the same; on collision the parameter name carries the layer
 * prefix while the routing target preserves the original field.
 */
export interface HttpLayerInputProjection {
  readonly layerName: string;
  /** parameterName → originalFieldName for this layer. */
  readonly routing: ReadonlyMap<string, string>;
  /** Fragment merged into the route's `inputSchema.properties`. */
  readonly properties: Readonly<Record<string, unknown>>;
  /** Field names appended to the route's `inputSchema.required` list. */
  readonly required: readonly string[];
}

const buildHttpRenameTarget = (
  layerName: string,
  originalName: string
): string => {
  if (originalName.length === 0) {
    return layerName;
  }
  const [head, ...rest] = originalName;
  if (head === undefined) {
    return layerName;
  }
  return `${layerName}${head.toUpperCase()}${rest.join('')}`;
};

const isJsonObjectSchema = (
  value: unknown
): value is { properties?: Record<string, unknown>; required?: string[] } =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readRequiredFields = (value: unknown): readonly string[] => {
  if (!isJsonObjectSchema(value) || !Array.isArray(value.required)) {
    return [];
  }
  return value.required.every((field) => typeof field === 'string')
    ? value.required
    : [];
};

const projectHttpLayerInput = (
  layer: Layer,
  claimedNames: Set<string>
): HttpLayerInputProjection => {
  if (layer.input === undefined) {
    return {
      layerName: layer.name,
      properties: {},
      required: [],
      routing: new Map(),
    };
  }

  const layerSchema = zodToJsonSchema(layer.input);
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const routing = new Map<string, string>();

  if (
    !isJsonObjectSchema(layerSchema) ||
    layerSchema.properties === undefined
  ) {
    return {
      layerName: layer.name,
      properties,
      required,
      routing,
    };
  }

  const requiredSet = new Set<string>(layerSchema.required);
  for (const [fieldName, fieldSchema] of Object.entries(
    layerSchema.properties
  )) {
    const renamed = buildHttpRenameTarget(layer.name, fieldName);
    const projection = projectLayerFieldName(
      layer.name,
      fieldName,
      fieldName,
      renamed,
      claimedNames,
      LAYER_FIELD_RESERVED_NAMES
    );
    properties[projection.claimedName] = fieldSchema;
    if (requiredSet.has(fieldName)) {
      required.push(projection.claimedName);
    }
    routing.set(projection.claimedName, projection.routingTarget);
  }

  return { layerName: layer.name, properties, required, routing };
};

interface HttpInputProjection {
  readonly schema: Record<string, unknown> | undefined;
  readonly projections: readonly HttpLayerInputProjection[];
}

const projectHttpInputSchema = (
  trail: Trail<unknown, unknown, unknown>,
  attachedLayers: readonly AttachedTypedLayer[]
): HttpInputProjection => {
  const baseSchema = zodToJsonSchema(trail.input);
  if (attachedLayers.length === 0) {
    return { projections: [], schema: baseSchema };
  }

  const baseProperties =
    isJsonObjectSchema(baseSchema) && baseSchema.properties !== undefined
      ? baseSchema.properties
      : undefined;
  const baseRequired =
    isJsonObjectSchema(baseSchema) && Array.isArray(baseSchema.required)
      ? baseSchema.required
      : [];

  const claimedNames = new Set<string>(
    baseProperties === undefined ? [] : Object.keys(baseProperties)
  );

  const mergedProperties: Record<string, unknown> = {
    ...baseProperties,
  };
  const mergedRequired = [...baseRequired];
  const projections: HttpLayerInputProjection[] = [];

  for (const { layer } of attachedLayers) {
    const projection = projectHttpLayerInput(layer, claimedNames);
    if (projection.routing.size === 0) {
      continue;
    }
    Object.assign(mergedProperties, projection.properties);
    mergedRequired.push(...projection.required);
    projections.push(projection);
  }

  if (projections.length === 0) {
    return { projections: [], schema: baseSchema };
  }

  const mergedSchema: Record<string, unknown> = isJsonObjectSchema(baseSchema)
    ? { ...baseSchema, properties: mergedProperties, type: 'object' }
    : { properties: mergedProperties, type: 'object' };
  if (mergedRequired.length > 0) {
    mergedSchema['required'] = mergedRequired;
  } else if ('required' in mergedSchema) {
    delete mergedSchema['required'];
  }

  return { projections, schema: mergedSchema };
};

const mergeHttpInputSchemas = (
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  const leftProperties =
    isJsonObjectSchema(left) && left.properties !== undefined
      ? left.properties
      : undefined;
  const rightProperties =
    isJsonObjectSchema(right) && right.properties !== undefined
      ? right.properties
      : undefined;
  const merged: Record<string, unknown> = {
    ...left,
    ...right,
    properties: {
      ...leftProperties,
      ...rightProperties,
    },
    type: 'object',
  };
  const required = [
    ...new Set([...readRequiredFields(left), ...readRequiredFields(right)]),
  ];
  if (required.length > 0) {
    merged['required'] = required;
  } else {
    delete merged['required'];
  }
  return merged;
};

const TRAIL_VERSION_INPUT_FIELD = 'trailVersion';
const TRAILS_VERSION_HEADERS = ['x-trails-version', 'x-trail-version'];

const versionInputSchema = (): Record<string, unknown> => ({
  properties: {
    [TRAIL_VERSION_INPUT_FIELD]: {
      description: 'Live trail version number or marker prefix',
      type: 'string',
    },
  },
  type: 'object',
});

const addVersionInputSchema = (
  trail: Trail<unknown, unknown, unknown>,
  schema: Record<string, unknown> | undefined
): Record<string, unknown> | undefined =>
  trail.version === undefined
    ? schema
    : mergeHttpInputSchemas(schema, versionInputSchema());

const readVersionFromHeaders = (
  headers: HttpHeaderSource | undefined
): TrailVersionReference | undefined => {
  for (const name of TRAILS_VERSION_HEADERS) {
    const value = readHeader(headers, name);
    if (value !== undefined && value.length > 0) {
      return value;
    }
  }
  return undefined;
};

const splitHttpSurfaceVersion = (
  input: unknown,
  context: HttpExecutionContext | undefined,
  supportsVersions: boolean
): {
  readonly input: unknown;
  readonly version: TrailVersionReference | undefined;
} => {
  if (!supportsVersions) {
    return { input, version: undefined };
  }

  const headerVersion =
    context?.version ?? readVersionFromHeaders(context?.headers);
  if (!isJsonObjectSchema(input)) {
    return { input, version: headerVersion };
  }

  const record = input as Record<string, unknown>;
  const { [TRAIL_VERSION_INPUT_FIELD]: fieldVersion, ...rest } = record;
  const version =
    headerVersion ??
    (typeof fieldVersion === 'string' || typeof fieldVersion === 'number'
      ? fieldVersion
      : undefined);
  return { input: rest, version };
};

/**
 * Partition a parsed request input into the trail input plus per-layer
 * inputs, using each layer's routing table.
 *
 * Layer-projected parameter names are stripped from the trail input so the
 * trail's schema validation only ever sees its own fields. A layer that
 * received no parameters is omitted from `layerInputs` so consumers can
 * cleanly assert which layers were activated by the request.
 */
const partitionHttpInput = (
  input: unknown,
  projections: readonly HttpLayerInputProjection[]
): {
  readonly trailInput: unknown;
  readonly layerInputs: Record<string, unknown>;
} => {
  if (projections.length === 0 || !isJsonObjectSchema(input)) {
    return { layerInputs: {}, trailInput: input };
  }
  const record = input as Record<string, unknown>;
  const claimedKeys = new Set<string>();
  const layerInputs: Record<string, unknown> = {};
  for (const projection of projections) {
    const layerInput: Record<string, unknown> = {};
    let received = false;
    for (const [paramName, fieldName] of projection.routing) {
      claimedKeys.add(paramName);
      const value = record[paramName];
      if (value === undefined) {
        continue;
      }
      layerInput[fieldName] = value;
      received = true;
    }
    if (received) {
      layerInputs[projection.layerName] = layerInput;
    }
  }
  const trailInput: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (claimedKeys.has(key)) {
      continue;
    }
    trailInput[key] = value;
  }
  return { layerInputs, trailInput };
};

// ---------------------------------------------------------------------------
// Execute factory
// ---------------------------------------------------------------------------

/**
 * Create an `execute` function for a single trail.
 *
 * Delegates to the centralized `executeTrail` pipeline in core.
 * The returned function returns a `Result` and never throws.
 */
const createExecute =
  (
    graph: Topo,
    t: Trail<unknown, unknown, unknown>,
    layers: readonly Layer[],
    options: DeriveHttpRoutesOptions,
    layerProjections: readonly HttpLayerInputProjection[]
  ): HttpRouteDefinition['execute'] =>
  async (input, requestId, abortSignal, request) => {
    const versionedInput = splitHttpSurfaceVersion(
      input,
      request,
      t.version !== undefined
    );
    const { trailInput, layerInputs } = partitionHttpInput(
      versionedInput.input,
      layerProjections
    );
    const permitResolution = await resolveHttpPermit(
      options,
      request,
      requestId,
      t.permit !== undefined
    );
    if (permitResolution.isErr()) {
      return permitResolution;
    }
    const permit = permitResolution.value;
    return await executeTrail(t, trailInput, {
      abortSignal,
      configValues: options.configValues,
      createContext: options.createContext,
      ctx: withHttpSurface(requestId, layers),
      ...(Object.keys(layerInputs).length === 0 ? {} : { layerInputs }),
      ...(permit === undefined ? {} : { permit }),
      resources: options.resources,
      surfaceLayers: layers,
      topo: graph,
      topoLayers: graph.layers,
      ...(versionedInput.version === undefined
        ? {}
        : { version: versionedInput.version }),
    });
  };

/**
 * Internal executor signature used for shared webhook source fan-out.
 *
 * Unlike the public `HttpRouteDefinition['execute']`, this accepts an
 * `activationFireId` so a single inbound request can share one activation
 * fire ID across every consumer fan-out — letting observability correlate
 * sibling consumers as one activation root.
 */
type WebhookConsumerExecute = (
  input: unknown,
  requestId: string | undefined,
  abortSignal: AbortSignal | undefined,
  request: HttpExecutionContext | undefined,
  activationFireId: string
) => Promise<Result<unknown, Error>>;

const createWebhookConsumerExecute =
  (
    graph: Topo,
    t: Trail<unknown, unknown, unknown>,
    activationEntry: ActivationEntry,
    source: WebhookSource,
    layers: readonly Layer[],
    options: DeriveHttpRoutesOptions,
    layerProjections: readonly HttpLayerInputProjection[]
  ): WebhookConsumerExecute =>
  async (input, requestId, abortSignal, request, activationFireId) => {
    const predicate = getActivationWherePredicate(activationEntry.where);
    if (predicate !== undefined) {
      let shouldRun = false;
      try {
        shouldRun = await predicate(input);
      } catch (error) {
        return Result.err(
          new ValidationError(
            `Webhook source "${source.id}" activation predicate failed`,
            { cause: error instanceof Error ? error : new Error(String(error)) }
          )
        );
      }
      if (!shouldRun) {
        return Result.ok();
      }
    }

    const activation = webhookActivationProvenance(source, activationFireId);
    const traceContext = await recordWebhookActivationTrace(
      graph,
      source,
      activation,
      t.id,
      'activation.webhook',
      'ok'
    );
    const versionedInput = splitHttpSurfaceVersion(
      input,
      request,
      t.version !== undefined
    );
    const { trailInput, layerInputs } = partitionHttpInput(
      versionedInput.input,
      layerProjections
    );
    const permitResolution = await resolveHttpPermit(
      options,
      request,
      requestId,
      t.permit !== undefined
    );
    if (permitResolution.isErr()) {
      return permitResolution;
    }
    const permit = permitResolution.value;
    return await executeTrail(t, trailInput, {
      abortSignal,
      configValues: options.configValues,
      createContext: options.createContext,
      ctx: withWebhookActivation(activation, requestId, traceContext, layers),
      ...(Object.keys(layerInputs).length === 0 ? {} : { layerInputs }),
      ...(permit === undefined ? {} : { permit }),
      resources: options.resources,
      surfaceLayers: layers,
      topo: graph,
      topoLayers: graph.layers,
      ...(versionedInput.version === undefined
        ? {}
        : { version: versionedInput.version }),
    });
  };

/**
 * Wrap a single-consumer webhook executor as the public `execute` function.
 *
 * Generates one activation fire ID per inbound request, matching the fan-out
 * behavior so single and merged routes share the same observability shape.
 */
const createWebhookExecute =
  (consumerExecute: WebhookConsumerExecute): HttpRouteDefinition['execute'] =>
  async (input, requestId, abortSignal, request) =>
    await consumerExecute(
      input,
      requestId,
      abortSignal,
      request,
      createWebhookActivationFireId()
    );

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/** Filter topo items to eligible trails. */
const eligibleTrails = (
  graph: Topo,
  options: DeriveHttpRoutesOptions
): Trail<unknown, unknown, unknown>[] =>
  filterSurfaceTrails(graph.list(), {
    exclude: options.exclude,
    include: options.include,
    intent: options.intent,
  });

const isInternalTrail = (trail: Trail<unknown, unknown, unknown>): boolean =>
  trail.visibility === 'internal' || trail.meta?.['internal'] === true;

const matchesAnyPattern = (
  trailId: string,
  patterns: readonly string[] | undefined
): boolean =>
  patterns !== undefined &&
  patterns.some((pattern) => matchesTrailPattern(trailId, pattern));

const passesIncludeFilter = (
  trailId: string,
  include: readonly string[] | undefined
): boolean =>
  include === undefined ||
  include.length === 0 ||
  matchesAnyPattern(trailId, include);

const eligibleWebhookTrails = (
  graph: Topo,
  options: DeriveHttpRoutesOptions
): Trail<unknown, unknown, unknown>[] =>
  graph.list().filter((trail) => {
    if (isInternalTrail(trail) && !options.include?.includes(trail.id)) {
      return false;
    }
    if (matchesAnyPattern(trail.id, options.exclude)) {
      return false;
    }
    if (!passesIncludeFilter(trail.id, options.include)) {
      return false;
    }
    return (
      options.intent === undefined ||
      options.intent.length === 0 ||
      options.intent.includes(trail.intent)
    );
  });

/** Build a single route definition from a trail. */
const buildRoute = (
  graph: Topo,
  trail: Trail<unknown, unknown, unknown>,
  basePath: string,
  layers: readonly Layer[],
  options: DeriveHttpRoutesOptions
): HttpRouteDefinition => {
  const method = deriveMethod(trail);
  const path = derivePath(basePath, trail.id);
  const attachedLayers = collectAttachedTypedLayers(
    graph,
    trail,
    options.layers
  );
  const inputProjection = projectHttpInputSchema(trail, attachedLayers);
  const inputSchema = addVersionInputSchema(trail, inputProjection.schema);
  const versions = deriveSurfaceTrailVersionProjections(trail);
  return {
    execute: createExecute(
      graph,
      trail,
      layers,
      options,
      inputProjection.projections
    ),
    ...(inputSchema === undefined ? {} : { inputSchema }),
    inputSource: deriveHttpInputSource(method),
    ...(inputProjection.projections.length === 0
      ? {}
      : { layerInputProjections: inputProjection.projections }),
    method,
    path,
    trail,
    trailId: trail.id,
    ...(versions === undefined ? {} : { versions }),
  };
};

const normalizeSourcePath = (basePath: string, sourcePath: string): string => {
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${base}${sourcePath}`;
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type ZodSchemaInput = Parameters<typeof validateInput>[0];

const isZodSchema = (value: unknown): value is ZodSchemaInput =>
  isObjectRecord(value) && typeof value['safeParse'] === 'function';

const parseOutputSchema = (
  parse: WebhookSource['parse'] | undefined
): ZodSchemaInput | undefined => {
  if (isZodSchema(parse)) {
    return parse;
  }
  if (isObjectRecord(parse) && isZodSchema(parse['output'])) {
    return parse['output'];
  }
  return undefined;
};

const webhookValidationMessage = (
  source: ActivationSource,
  issues: ReturnType<typeof validateWebhookSource>
): string =>
  `Webhook source "${source.id}" is invalid: ${issues.map((issue) => `${issue.field}: ${issue.message}`).join('; ')}`;

const toWebhookSource = (
  source: ActivationSource
): Result<WebhookSource, Error> => {
  const issues = validateWebhookSource(source);
  if (issues.length > 0) {
    return Result.err(
      new ValidationError(webhookValidationMessage(source, issues), {
        context: { issues },
      })
    );
  }
  const webhookSource = source as WebhookSource;
  const method = (source.method ?? 'POST').trim().toUpperCase();
  const path = source.path?.trim();
  if (method === webhookSource.method && path === webhookSource.path) {
    return Result.ok(webhookSource);
  }
  return Result.ok(
    Object.freeze({
      ...webhookSource,
      method,
      path,
    }) as WebhookSource
  );
};

const createWebhookInputParser =
  (source: WebhookSource): HttpRouteDefinition['parseWebhookInput'] =>
  (rawPayload) => {
    const schema = parseOutputSchema(source.parse);
    if (schema === undefined) {
      return Result.err(
        new ValidationError(
          `Webhook source "${source.id}" does not expose a parse output schema`
        )
      );
    }
    const parsed = validateInput(schema, rawPayload);
    if (parsed.isErr()) {
      return Result.err(
        new ValidationError(
          `Webhook source "${source.id}" payload is invalid: ${parsed.error.message}`,
          {
            cause: parsed.error,
            ...(parsed.error.context === undefined
              ? {}
              : { context: parsed.error.context }),
          }
        )
      );
    }
    return parsed;
  };

const WEBHOOK_CONSUMERS = Symbol('webhookConsumers');
const WEBHOOK_INVALID_RECORDERS = Symbol('webhookInvalidRecorders');

type WebhookInvalidRecorder = NonNullable<
  HttpRouteDefinition['recordWebhookInvalid']
>;

type MergeableWebhookRoute = HttpRouteDefinition & {
  readonly [WEBHOOK_CONSUMERS]?: readonly WebhookConsumerExecute[];
  readonly [WEBHOOK_INVALID_RECORDERS]?: readonly WebhookInvalidConsumerRecorder[];
};

/**
 * Wrap a webhook source's `verify` for the route boundary.
 *
 * Sources that declare `resources` get a resource-capable context: the
 * declared resources are resolved (honoring surface overrides and config
 * values) for the duration of the verification and released afterwards,
 * so signature checks can reach stores holding per-endpoint secrets.
 */
const createWebhookVerifier =
  (
    source: WebhookSource,
    options: DeriveHttpRoutesOptions
  ): ((request: WebhookVerifyRequest) => Promise<Result<void, Error>>) =>
  async (request) => {
    const declared = source.resources ?? [];
    if (source.verify === undefined || declared.length === 0) {
      return await verifyWebhookRequest(source, request);
    }

    const seed = options.createContext
      ? await options.createContext()
      : undefined;
    const scope = await createResources(
      { resources: declared },
      createTrailContext(seed),
      options.resources,
      options.configValues
    );
    if (scope.isErr()) {
      return scope;
    }
    try {
      return await verifyWebhookRequest(source, request, scope.value.ctx);
    } finally {
      scope.value.release();
    }
  };

const buildWebhookRoute = (
  graph: Topo,
  trail: Trail<unknown, unknown, unknown>,
  activation: ActivationEntry,
  basePath: string,
  layers: readonly Layer[],
  options: DeriveHttpRoutesOptions
): Result<HttpRouteDefinition, Error> => {
  const source = toWebhookSource(activation.source);
  if (source.isErr()) {
    return source;
  }
  const attachedLayers = collectAttachedTypedLayers(
    graph,
    trail,
    options.layers
  );
  const inputProjection = projectHttpInputSchema(trail, attachedLayers);
  const inputSchema = addVersionInputSchema(trail, inputProjection.schema);
  const versions = deriveSurfaceTrailVersionProjections(trail);
  const consumerExecute = createWebhookConsumerExecute(
    graph,
    trail,
    activation,
    source.value,
    layers,
    options,
    inputProjection.projections
  );
  const consumerInvalidRecorder = createWebhookInvalidRecorder(
    graph,
    source.value,
    trail.id
  );
  const route: MergeableWebhookRoute = {
    [WEBHOOK_CONSUMERS]: [consumerExecute],
    [WEBHOOK_INVALID_RECORDERS]: [consumerInvalidRecorder],
    execute: createWebhookExecute(consumerExecute),
    ...(inputSchema === undefined ? {} : { inputSchema }),
    inputSource: 'webhook',
    ...(inputProjection.projections.length === 0
      ? {}
      : { layerInputProjections: inputProjection.projections }),
    method: source.value.method,
    parseWebhookInput: createWebhookInputParser(source.value),
    path: normalizeSourcePath(basePath, source.value.path),
    recordWebhookInvalid: createWebhookInvalidPublicRecorder(
      consumerInvalidRecorder
    ),
    trail,
    trailId: trail.id,
    verifyWebhook: createWebhookVerifier(source.value, options),
    ...(versions === undefined ? {} : { versions }),
    webhookSource: source.value,
  };
  return Result.ok(route);
};

// ---------------------------------------------------------------------------
// Collision detection
// ---------------------------------------------------------------------------

/** Derive the lookup key for (method, path) collision detection. */
const routeKey = (route: HttpRouteDefinition): `${string} ${string}` =>
  `${route.method} ${route.path}`;

const isSameWebhookSourceLocation = (
  left: HttpRouteDefinition,
  right: HttpRouteDefinition
): boolean =>
  left.inputSource === 'webhook' &&
  right.inputSource === 'webhook' &&
  left.webhookSource !== undefined &&
  right.webhookSource !== undefined &&
  left.webhookSource.id === right.webhookSource.id &&
  left.webhookSource.method === right.webhookSource.method &&
  left.webhookSource.path === right.webhookSource.path;

/**
 * Two webhook source routes can only merge when they declare the same
 * verifier identity. Reference equality on `verify` matches the projection
 * model used elsewhere — a shared source object always passes, while two
 * separately-declared verifier functions are treated as distinct policies
 * even when their bodies look equivalent.
 */
const hasMatchingWebhookVerifier = (
  left: HttpRouteDefinition,
  right: HttpRouteDefinition
): boolean => left.webhookSource?.verify === right.webhookSource?.verify;

/**
 * Two webhook source routes can only merge when they declare the same parse
 * contract identity. Reference equality on `parse` mirrors the verifier rule:
 * a shared source object always passes, while two separately-declared parse
 * schemas (or handlers) are treated as distinct contracts even when their
 * shapes look equivalent. Without this check the merged route silently keeps
 * whichever parser registered first, so payloads valid for later consumers
 * could be rejected and unintended shapes could be passed downstream.
 */
const hasMatchingWebhookParse = (
  left: HttpRouteDefinition,
  right: HttpRouteDefinition
): boolean => left.webhookSource?.parse === right.webhookSource?.parse;

/**
 * Envelope facts must agree before merging: the merged route delivers one
 * envelope shape, so diverging `rawBody`/`headers` declarations would
 * silently drop a consumer's declared fields.
 */
const hasMatchingWebhookEnvelope = (
  left: HttpRouteDefinition,
  right: HttpRouteDefinition
): boolean =>
  (left.webhookSource?.rawBody === true) ===
    (right.webhookSource?.rawBody === true) &&
  JSON.stringify(left.webhookSource?.headers ?? null) ===
    JSON.stringify(right.webhookSource?.headers ?? null);

const webhookConsumers = (
  route: MergeableWebhookRoute
): readonly WebhookConsumerExecute[] | undefined => route[WEBHOOK_CONSUMERS];

const webhookInvalidRecorders = (
  route: MergeableWebhookRoute
): readonly WebhookInvalidConsumerRecorder[] =>
  route[WEBHOOK_INVALID_RECORDERS] ?? [];

type MergeWebhookOutcome =
  | { readonly kind: 'merged'; readonly route: HttpRouteDefinition }
  | { readonly kind: 'verifier-mismatch'; readonly error: ValidationError }
  | { readonly kind: 'parse-mismatch'; readonly error: ValidationError }
  | { readonly kind: 'not-mergeable' };

const mergeWebhookRoutes = (
  existing: HttpRouteDefinition,
  route: HttpRouteDefinition
): MergeWebhookOutcome => {
  if (!isSameWebhookSourceLocation(existing, route)) {
    return { kind: 'not-mergeable' };
  }
  if (!hasMatchingWebhookVerifier(existing, route)) {
    return {
      error: new ValidationError(
        `HTTP route collision: trails "${existing.trailId}" and "${route.trailId}" share webhook source "${existing.webhookSource?.id}" on ${route.method} ${route.path} but declare a mismatched webhook verifier policy. Reuse the same WebhookSource object so both consumers run under one verifier.`
      ),
      kind: 'verifier-mismatch',
    };
  }
  if (!hasMatchingWebhookParse(existing, route)) {
    return {
      error: new ValidationError(
        `HTTP route collision: trails "${existing.trailId}" and "${route.trailId}" share webhook source "${existing.webhookSource?.id}" on ${route.method} ${route.path} but declare a mismatched webhook parse contract. Reuse the same WebhookSource object so both consumers parse payloads under one contract.`
      ),
      kind: 'parse-mismatch',
    };
  }
  if (!hasMatchingWebhookEnvelope(existing, route)) {
    return {
      error: new ValidationError(
        `HTTP route collision: trails "${existing.trailId}" and "${route.trailId}" share webhook source "${existing.webhookSource?.id}" on ${route.method} ${route.path} but declare mismatched rawBody/headers envelope facts. Reuse the same WebhookSource object so both consumers receive one envelope shape.`
      ),
      kind: 'parse-mismatch',
    };
  }

  const existingConsumers = webhookConsumers(existing as MergeableWebhookRoute);
  const incomingConsumers = webhookConsumers(route as MergeableWebhookRoute);
  if (existingConsumers === undefined || incomingConsumers === undefined) {
    return { kind: 'not-mergeable' };
  }
  const consumers: readonly WebhookConsumerExecute[] = [
    ...existingConsumers,
    ...incomingConsumers,
  ];

  const recorders = [
    ...webhookInvalidRecorders(existing as MergeableWebhookRoute),
    ...webhookInvalidRecorders(route as MergeableWebhookRoute),
  ] as const;

  // Fan-out: every consumer's recorder must fire on parse/verify failures so
  // each trail emits its own activation.webhook.invalid trace record. A
  // single activation fire ID is generated per inbound failed request and
  // shared across all recorders so observability can correlate the sibling
  // invalid records as one activation root, mirroring the success path. A
  // recorder failure must not prevent the remaining recorders from running.
  const recordWebhookInvalidFanOut: WebhookInvalidRecorder | undefined =
    recorders.length === 0
      ? undefined
      : async (errorCategory) => {
          const activationFireId = createWebhookActivationFireId();
          await Promise.all(
            recorders.map(async (record) => {
              try {
                await record(errorCategory, activationFireId);
              } catch {
                // Recorder failures must never short-circuit the fan-out;
                // sink errors are already swallowed inside writeToSink.
              }
            })
          );
        };

  const merged: MergeableWebhookRoute = {
    ...existing,
    [WEBHOOK_CONSUMERS]: consumers,
    [WEBHOOK_INVALID_RECORDERS]: recorders,
    inputSchema: mergeHttpInputSchemas(existing.inputSchema, route.inputSchema),
    layerInputProjections: [
      ...(existing.layerInputProjections ?? []),
      ...(route.layerInputProjections ?? []),
    ],
    ...(recordWebhookInvalidFanOut === undefined
      ? {}
      : { recordWebhookInvalid: recordWebhookInvalidFanOut }),
    async execute(input, requestId, abortSignal, request) {
      // One activation fire ID per inbound webhook request, shared across every
      // fan-out consumer so observability can correlate them as siblings of a
      // single activation root.
      const activationFireId = createWebhookActivationFireId();

      // Fan-out: every consumer must get its attempt even when an earlier
      // consumer fails. Remember the first error, run the rest, and only
      // surface ok when every consumer succeeded.
      const values: unknown[] = [];
      let firstError: Result<unknown, Error> | undefined;
      for (const consumerExecute of consumers) {
        const result = await consumerExecute(
          input,
          requestId,
          abortSignal,
          request,
          activationFireId
        );
        if (result.isErr()) {
          if (firstError === undefined) {
            firstError = result;
          }
          continue;
        }
        values.push(result.value);
      }
      if (firstError !== undefined) {
        return firstError;
      }
      return Result.ok(values);
    },
  };
  return { kind: 'merged', route: merged };
};

/** Register a route, checking for (path, method) collisions. */
const registerRoute = (
  route: HttpRouteDefinition,
  seenRoutes: Map<string, HttpRouteDefinition>,
  routes: HttpRouteDefinition[]
): Result<void, Error> => {
  const key = routeKey(route);
  const existing = seenRoutes.get(key);
  if (existing !== undefined) {
    const outcome = mergeWebhookRoutes(existing, route);
    if (outcome.kind === 'merged') {
      seenRoutes.set(key, outcome.route);
      const routeIndex = routes.indexOf(existing);
      if (routeIndex !== -1) {
        routes[routeIndex] = outcome.route;
      }
      return Result.ok();
    }
    if (
      outcome.kind === 'verifier-mismatch' ||
      outcome.kind === 'parse-mismatch'
    ) {
      return Result.err(outcome.error);
    }
    return Result.err(
      new ValidationError(
        `HTTP route collision: trails "${existing.trailId}" and "${route.trailId}" both derive ${route.method} ${route.path}`
      )
    );
  }
  seenRoutes.set(key, route);
  routes.push(route);
  return Result.ok();
};

/** Accumulate route definitions, returning early on the first collision. */
const accumulateRoutes = (
  graph: Topo,
  trails: Trail<unknown, unknown, unknown>[],
  webhookTrails: Trail<unknown, unknown, unknown>[],
  basePath: string,
  layers: readonly Layer[],
  options: DeriveHttpRoutesOptions
): Result<HttpRouteDefinition[], Error> => {
  const routes: HttpRouteDefinition[] = [];
  const seenRoutes = new Map<string, HttpRouteDefinition>();

  for (const trail of trails) {
    const route = buildRoute(graph, trail, basePath, layers, options);
    const registered = registerRoute(route, seenRoutes, routes);
    if (registered.isErr()) {
      return registered;
    }
  }

  for (const trail of webhookTrails) {
    for (const activation of trail.activationSources) {
      if (activation.source.kind !== 'webhook') {
        continue;
      }
      const route = buildWebhookRoute(
        graph,
        trail,
        activation,
        basePath,
        layers,
        options
      );
      if (route.isErr()) {
        return route;
      }
      const registered = registerRoute(route.value, seenRoutes, routes);
      if (registered.isErr()) {
        return registered;
      }
    }
  }

  return Result.ok(routes);
};

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build HTTP route definitions from a topo.
 *
 * Each trail becomes an HttpRouteDefinition with:
 * - An HTTP method derived from intent (read -> GET, write -> POST, destroy -> DELETE)
 * - A path derived from the trail ID (dots become slashes)
 * - An input source derived from the method (GET -> query, others -> body)
 * - An `execute` function that validates, layers, and runs the implementation
 *
 * Returns `Result.err(ValidationError)` if two trails derive the same
 * (method, path) pair. Returns `Result.ok(routes)` on success.
 *
 * @example
 * ```ts
 * import { deriveHttpRoutes } from '@ontrails/http';
 *
 * const routes = deriveHttpRoutes(graph, { basePath: '/api' });
 * if (routes.isErr()) throw routes.error;
 *
 * for (const route of routes.value) {
 *   console.log(`${route.method} ${route.path}`);
 * }
 * ```
 */
export const deriveHttpRoutes = (
  graph: Topo,
  options: DeriveHttpRoutesOptions = {}
): Result<HttpRouteDefinition[], Error> => {
  const validated = validateSurfaceTopo(graph, options);
  if (validated.isErr()) {
    return validated;
  }

  const basePath = (options.basePath ?? '').replace(/\/+$/, '');
  const layers = options.layers ?? [];
  return accumulateRoutes(
    graph,
    eligibleTrails(graph, options),
    eligibleWebhookTrails(graph, options),
    basePath,
    layers,
    options
  );
};
