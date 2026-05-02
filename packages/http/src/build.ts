/**
 * Build framework-agnostic HTTP route definitions from a Trails topo.
 *
 * Each route definition describes the path, method, input source, and an
 * `execute` function that validates input, composes layers, and runs the
 * implementation -- all without referencing any HTTP framework types.
 */

import {
  Result,
  ValidationError,
  buildActivationProvenanceTraceAttrs,
  executeTrail,
  filterSurfaceTrails,
  getActivationWherePredicate,
  getTraceSink,
  matchesTrailPattern,
  TRACE_CONTEXT_KEY,
  traceContextFromRecord,
  validateInput,
  validateWebhookSource,
  validateSurfaceTopo,
  verifyWebhookRequest,
  writeActivationTraceRecord,
  withActivationProvenance,
  withSurfaceMarker,
} from '@ontrails/core';
import type {
  ActivationEntry,
  ActivationProvenance,
  ActivationSource,
  BaseSurfaceOptions,
  Layer,
  ResourceOverrideMap,
  TraceContext,
  Topo,
  Trail,
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
}

export interface HttpRouteDefinition {
  readonly method: HttpMethod;
  readonly path: string;
  readonly trailId: string;
  readonly inputSource: InputSource;
  readonly trail: Trail<unknown, unknown, unknown>;
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
   * Validate input, compose layers, and execute the trail implementation.
   *
   * The caller is responsible for parsing raw input from the request and
   * mapping the Result to an HTTP response. This function is framework-agnostic.
   *
   * @param abortSignal - Optional AbortSignal from the HTTP request. When provided,
   *   it takes final precedence over any context factory signal, allowing
   *   client-initiated cancellation to propagate into trail execution.
   */
  readonly execute: (
    input: unknown,
    requestId?: string | undefined,
    abortSignal?: AbortSignal | undefined
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

/** Build per-request context overrides with the HTTP trailhead marker. */
const withHttpTrailhead = (
  requestId: string | undefined
): Partial<TrailContextInit> =>
  withSurfaceMarker('http', requestId === undefined ? {} : { requestId });

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
  traceContext: TraceContext | undefined
): Partial<TrailContextInit> => {
  const ctx = withActivationProvenance(
    withHttpTrailhead(requestId),
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
    options: DeriveHttpRoutesOptions
  ): HttpRouteDefinition['execute'] =>
  (input, requestId, abortSignal) =>
    executeTrail(t, input, {
      abortSignal,
      configValues: options.configValues,
      createContext: options.createContext,
      ctx: withHttpTrailhead(requestId),
      layers,
      resources: options.resources,
      topo: graph,
    });

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
  activationFireId: string
) => Promise<Result<unknown, Error>>;

const createWebhookConsumerExecute =
  (
    graph: Topo,
    t: Trail<unknown, unknown, unknown>,
    activationEntry: ActivationEntry,
    source: WebhookSource,
    layers: readonly Layer[],
    options: DeriveHttpRoutesOptions
  ): WebhookConsumerExecute =>
  async (input, requestId, abortSignal, activationFireId) => {
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
    return await executeTrail(t, input, {
      abortSignal,
      configValues: options.configValues,
      createContext: options.createContext,
      ctx: withWebhookActivation(activation, requestId, traceContext),
      layers,
      resources: options.resources,
      topo: graph,
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
  async (input, requestId, abortSignal) =>
    await consumerExecute(
      input,
      requestId,
      abortSignal,
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
  return {
    execute: createExecute(graph, trail, layers, options),
    inputSource: deriveHttpInputSource(method),
    method,
    path,
    trail,
    trailId: trail.id,
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
  const consumerExecute = createWebhookConsumerExecute(
    graph,
    trail,
    activation,
    source.value,
    layers,
    options
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
    inputSource: 'webhook',
    method: source.value.method,
    parseWebhookInput: createWebhookInputParser(source.value),
    path: normalizeSourcePath(basePath, source.value.path),
    recordWebhookInvalid: createWebhookInvalidPublicRecorder(
      consumerInvalidRecorder
    ),
    trail,
    trailId: trail.id,
    verifyWebhook: (request) => verifyWebhookRequest(source.value, request),
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
    ...(recordWebhookInvalidFanOut === undefined
      ? {}
      : { recordWebhookInvalid: recordWebhookInvalidFanOut }),
    async execute(input, requestId, abortSignal) {
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
 */
export const deriveHttpRoutes = (
  graph: Topo,
  options: DeriveHttpRoutesOptions = {}
): Result<HttpRouteDefinition[], Error> => {
  const validated = validateSurfaceTopo(graph, options);
  if (validated.isErr()) {
    return Result.err(validated.error);
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
