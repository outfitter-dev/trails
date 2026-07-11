/**
 * Cloudflare Queues producer resource and Worker consumer materializer.
 *
 * `cloudflareQueue` authors a resource for producer trails that send messages
 * through a Queue binding. `createQueueHandler` materializes first-class core
 * `queue()` activation sources into a Workers `queue(batch, env, ctx)` handler.
 */

import {
  CancelledError,
  InternalError,
  RateLimitError,
  Result,
  TRACE_CONTEXT_KEY,
  ValidationError,
  buildActivationProvenanceTraceAttrs,
  getActivationWherePredicate,
  getTraceSink,
  isTrailsError,
  matchesTrailPattern,
  projectActivationSourceDeclaration,
  resource,
  run,
  traceContextFromRecord,
  validateSurfaceTopo,
  writeActivationTraceRecord,
  withActivationProvenance,
} from '@ontrails/core';
import type {
  ActivationEntry,
  AnyTrail,
  BaseSurfaceOptions,
  Layer,
  QueueSource,
  Resource,
  ResourceOverrideMap,
  Topo,
  TraceContext,
  TrailContextInit,
} from '@ontrails/core';

import { registerEnvBinding } from '../env.js';

// ---------------------------------------------------------------------------
// Producer binding shape
// ---------------------------------------------------------------------------

export type CloudflareQueuesContentType = 'bytes' | 'json' | 'text' | 'v8';

export interface CloudflareQueueMetrics {
  readonly backlogBytes: number;
  readonly backlogCount: number;
  readonly oldestMessageTimestamp: number;
}

export interface CloudflareQueueSendResult {
  readonly metadata: {
    readonly metrics: CloudflareQueueMetrics;
  };
}

export interface CloudflareQueueSendOptions {
  readonly contentType?: CloudflareQueuesContentType | undefined;
  readonly delaySeconds?: number | undefined;
}

export interface CloudflareQueueSendBatchOptions {
  readonly delaySeconds?: number | undefined;
}

export interface CloudflareQueueSendRequest<Body = unknown> {
  readonly body: Body;
  readonly contentType?: CloudflareQueuesContentType | undefined;
  readonly delaySeconds?: number | undefined;
}

/**
 * Structural subset of a Cloudflare Queue producer binding.
 */
export interface CloudflareQueue<Body = unknown> {
  metrics(): Promise<CloudflareQueueMetrics>;
  send(
    body: Body,
    options?: CloudflareQueueSendOptions
  ): Promise<CloudflareQueueSendResult>;
  sendBatch(
    messages: Iterable<CloudflareQueueSendRequest<Body>>,
    options?: CloudflareQueueSendBatchOptions
  ): Promise<CloudflareQueueSendResult>;
}

export interface MemoryQueueMessage<Body = unknown> {
  readonly body: Body;
  readonly options?: CloudflareQueueSendOptions | undefined;
}

export interface MemoryCloudflareQueue<
  Body = unknown,
> extends CloudflareQueue<Body> {
  clear(): void;
  messages(): readonly MemoryQueueMessage<Body>[];
}

const emptyMetrics = (): CloudflareQueueMetrics => ({
  backlogBytes: 0,
  backlogCount: 0,
  oldestMessageTimestamp: 0,
});

const sendResult = (): CloudflareQueueSendResult => ({
  metadata: { metrics: emptyMetrics() },
});

/**
 * Create an in-memory Queue producer binding.
 *
 * This is the mock behind `cloudflareQueue`, exported for tests that want to
 * inspect sent messages without a Workers runtime.
 *
 * @example
 * ```ts
 * import { createMemoryQueue } from '@ontrails/cloudflare/queues';
 *
 * const queue = createMemoryQueue<{ id: string }>();
 * await queue.send({ id: 'job-1' });
 * queue.messages()[0]?.body.id; // 'job-1'
 * ```
 */
export const createMemoryQueue = <
  Body = unknown,
>(): MemoryCloudflareQueue<Body> => {
  const sent: MemoryQueueMessage<Body>[] = [];

  return {
    clear() {
      sent.length = 0;
    },
    messages: () => Object.freeze([...sent]),
    metrics: () =>
      Promise.resolve({
        backlogBytes: 0,
        backlogCount: sent.length,
        oldestMessageTimestamp: 0,
      }),
    send: (body, options) => {
      sent.push(
        options === undefined ? { body } : { body, options: { ...options } }
      );
      return Promise.resolve(sendResult());
    },
    sendBatch: (messages, options) => {
      for (const message of messages) {
        const sendOptions: CloudflareQueueSendOptions = {
          ...(message.contentType === undefined
            ? {}
            : { contentType: message.contentType }),
          ...(message.delaySeconds === undefined
            ? {}
            : { delaySeconds: message.delaySeconds }),
        };
        const mergedOptions =
          options?.delaySeconds === undefined
            ? sendOptions
            : { delaySeconds: options.delaySeconds, ...sendOptions };
        sent.push(
          Object.keys(mergedOptions).length === 0
            ? { body: message.body }
            : { body: message.body, options: mergedOptions }
        );
      }
      return Promise.resolve(sendResult());
    },
  };
};

// ---------------------------------------------------------------------------
// Resource factory
// ---------------------------------------------------------------------------

export interface CloudflareQueueOptions {
  /** The wrangler binding name (a `queues.producers` entry's `binding`). */
  readonly binding: string;
  readonly description?: string | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

const isQueueBinding = (value: unknown): value is CloudflareQueue => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof CloudflareQueue, unknown>>;
  return (
    typeof candidate.send === 'function' &&
    typeof candidate.sendBatch === 'function' &&
    typeof candidate.metrics === 'function'
  );
};

/**
 * Author a Trails resource wrapping a Cloudflare Queue producer binding.
 *
 * The real Queue binding arrives through the Workers env bridge. The resource
 * mock records sent messages in memory so producer trails work in `testAll`.
 *
 * @example
 * ```ts
 * import { Result, trail } from '@ontrails/core';
 * import { cloudflareQueue } from '@ontrails/cloudflare/queues';
 * import { z } from 'zod';
 *
 * const jobs = cloudflareQueue<{ id: string }>('jobs', { binding: 'JOBS' });
 *
 * const enqueueJob = trail('job.enqueue', {
 *   implementation: async (input, ctx) => {
 *     await jobs.from(ctx).send({ id: input.id });
 *     return Result.ok({ queued: true });
 *   },
 *   input: z.object({ id: z.string() }),
 *   output: z.object({ queued: z.boolean() }),
 *   resources: [jobs],
 * });
 * ```
 */
export const cloudflareQueue = <Body = unknown>(
  id: string,
  options: CloudflareQueueOptions
): Resource<CloudflareQueue<Body>> => {
  const definition = resource<CloudflareQueue<Body>>(id, {
    create: () =>
      Result.err(
        new InternalError(
          `Resource "${id}" wraps Cloudflare Queue binding "${options.binding}", which only exists on a Workers env. Serve the topo with createWorkersHandler from @ontrails/cloudflare/workers, or rely on the in-memory mock in tests.`,
          { context: { binding: options.binding, resourceId: id } }
        )
      ),
    description:
      options.description ??
      `Cloudflare Queue producer bound to "${options.binding}"`,
    meta: {
      ...options.meta,
      'cloudflare.binding': options.binding,
      'cloudflare.service': 'queues',
    },
    mock: () => createMemoryQueue<Body>(),
  });
  registerEnvBinding(definition, {
    binding: options.binding,
    fromEnv: (value) =>
      isQueueBinding(value)
        ? Result.ok(value)
        : Result.err(
            new InternalError(
              `Worker env binding "${options.binding}" for resource "${id}" is not a Queue producer. Check the queues.producers entry in your wrangler configuration.`,
              { context: { binding: options.binding, resourceId: id } }
            )
          ),
  });
  return definition;
};

// ---------------------------------------------------------------------------
// Consumer materializer
// ---------------------------------------------------------------------------

export interface CloudflareQueueRetryOptions {
  readonly delaySeconds?: number | undefined;
}

export interface CloudflareQueueMessage<Body = unknown> {
  readonly attempts: number;
  readonly body: Body;
  readonly id: string;
  readonly timestamp: Date;
  ack(): void;
  retry(options?: CloudflareQueueRetryOptions): void;
}

export interface CloudflareQueueBatch<Body = unknown> {
  readonly messages: readonly CloudflareQueueMessage<Body>[];
  readonly queue: string;
  ackAll(): void;
  retryAll(options?: CloudflareQueueRetryOptions): void;
}

export type CloudflareQueueHandler<Body = unknown> = (
  batch: CloudflareQueueBatch<Body>
) => Promise<void>;

export interface CreateQueueHandlerOptions extends BaseSurfaceOptions {
  readonly abortSignal?: AbortSignal | undefined;
  readonly createContext?:
    | (() => TrailContextInit | Promise<TrailContextInit>)
    | undefined;
  readonly layers?: readonly Layer[] | undefined;
  readonly resources?: ResourceOverrideMap | undefined;
}

interface QueueConsumerRegistration {
  readonly activation: ActivationEntry;
  readonly source: QueueSource;
  readonly trailId: string;
}

interface SchemaIssue {
  readonly message: string;
  readonly path?: readonly unknown[] | undefined;
}

type SafeParseResult =
  | { readonly data: unknown; readonly success: true }
  | {
      readonly error: { readonly issues: readonly SchemaIssue[] };
      readonly success: false;
    };

interface SafeParseSchema {
  safeParse(value: unknown): SafeParseResult;
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSafeParseSchema = (value: unknown): value is SafeParseSchema =>
  isObjectRecord(value) && typeof value['safeParse'] === 'function';

const queueSourceFrom = (
  activation: ActivationEntry
): QueueSource | undefined =>
  activation.source.kind === 'queue' &&
  typeof activation.source.queue === 'string' &&
  activation.source.queue.trim().length > 0
    ? {
        ...(activation.source as QueueSource),
        queue: activation.source.queue.trim(),
      }
    : undefined;

const matchesAnyPattern = (
  trailId: string,
  patterns: readonly string[] | undefined
): boolean =>
  patterns !== undefined &&
  patterns.some((pattern) => matchesTrailPattern(trailId, pattern));

const isExplicitInternalInclude = (
  trailId: string,
  include: readonly string[] | undefined
): boolean => include !== undefined && include.includes(trailId);

const isInternalTrail = (trail: AnyTrail): boolean =>
  trail.visibility === 'internal' || trail.meta?.['internal'] === true;

const shouldIncludeQueueTrail = (
  trail: AnyTrail,
  options: CreateQueueHandlerOptions
): boolean => {
  if (
    isInternalTrail(trail) &&
    !isExplicitInternalInclude(trail.id, options.include)
  ) {
    return false;
  }
  if (matchesAnyPattern(trail.id, options.exclude)) {
    return false;
  }
  if (
    options.include !== undefined &&
    options.include.length > 0 &&
    !matchesAnyPattern(trail.id, options.include)
  ) {
    return false;
  }
  return (
    options.intent === undefined ||
    options.intent.length === 0 ||
    options.intent.includes(trail.intent)
  );
};

const collectQueueConsumers = (
  graph: Topo,
  options: CreateQueueHandlerOptions
): readonly QueueConsumerRegistration[] => {
  const registrations: QueueConsumerRegistration[] = [];
  for (const graphTrail of graph.list()) {
    if (!shouldIncludeQueueTrail(graphTrail, options)) {
      continue;
    }
    for (const activation of graphTrail.activationSources) {
      const source = queueSourceFrom(activation);
      if (source !== undefined) {
        registrations.push({
          activation,
          source,
          trailId: graphTrail.id,
        });
      }
    }
  }
  return Object.freeze(registrations);
};

const queueInputContractSignature = (source: QueueSource): string =>
  JSON.stringify(
    projectActivationSourceDeclaration(source)['parseOutputSchema'] ?? null
  );

const assertQueueSourceCompatibility = (
  queueName: string,
  registrations: readonly QueueConsumerRegistration[]
): void => {
  const bySource = new Map<string, QueueConsumerRegistration>();
  for (const registration of registrations) {
    bySource.set(registration.source.id, registration);
  }
  const sources = [...bySource.values()];
  const [expected] = sources;
  if (expected === undefined) {
    return;
  }
  const expectedSignature = queueInputContractSignature(expected.source);
  const incompatible = sources.find(
    (registration) =>
      queueInputContractSignature(registration.source) !== expectedSignature
  );
  if (incompatible !== undefined) {
    throw new ValidationError(
      `Cloudflare queue "${queueName}" is bound to incompatible activation source contracts "${expected.source.id}" and "${incompatible.source.id}". Use one shared queue source contract, or bind distinct contracts to distinct physical queues.`
    );
  }
};

const schemaForSource = (source: QueueSource): SafeParseSchema | undefined => {
  if (isSafeParseSchema(source.parse)) {
    return source.parse;
  }
  if (
    isObjectRecord(source.parse) &&
    isSafeParseSchema(source.parse['output'])
  ) {
    return source.parse['output'];
  }
  return undefined;
};

const issuePathText = (path: readonly unknown[] | undefined): string =>
  path === undefined || path.length === 0 ? '<root>' : path.join('.');

const formatSchemaIssues = (issues: readonly SchemaIssue[]): string =>
  issues
    .map((issue) => `${issuePathText(issue.path)}: ${issue.message}`)
    .join('; ');

const parseQueueMessageBody = (
  registration: QueueConsumerRegistration,
  body: unknown
): Result<unknown, Error> => {
  const schema = schemaForSource(registration.source);
  if (schema === undefined) {
    return Result.err(
      new InternalError(
        `Queue source "${registration.source.id}" does not expose a parse schema.`
      )
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Result.err(
      new ValidationError(
        `Queue source "${registration.source.id}" rejected message "${registration.trailId}": ${formatSchemaIssues(parsed.error.issues)}`
      )
    );
  }
  return Result.ok(parsed.data);
};

const errorFromUnknown = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

const createFireId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const activationFor = (
  registration: QueueConsumerRegistration,
  message: CloudflareQueueMessage
) => {
  const fireId = createFireId();
  return {
    fireId,
    rootFireId: fireId,
    source: {
      id: registration.source.id,
      kind: 'queue' as const,
      ...(registration.source.meta === undefined
        ? {}
        : { meta: registration.source.meta }),
      queue: registration.source.queue,
    },
    trigger: {
      messageAttempts: message.attempts,
      messageId: message.id,
      messageTimestamp: message.timestamp.toISOString(),
    },
  };
};

const activationAttrs = (
  registration: QueueConsumerRegistration,
  message: CloudflareQueueMessage,
  activation: ReturnType<typeof activationFor>
): Readonly<Record<string, unknown>> => ({
  ...buildActivationProvenanceTraceAttrs(activation),
  'trails.activation.queue.message.attempts': message.attempts,
  'trails.activation.queue.message.id': message.id,
  'trails.activation.queue.message.timestamp': message.timestamp.toISOString(),
  'trails.activation.target_trail.id': registration.trailId,
});

const recordQueueActivationTrace = async (
  graph: Topo,
  registration: QueueConsumerRegistration,
  message: CloudflareQueueMessage,
  activation: ReturnType<typeof activationFor>,
  status: 'cancelled' | 'err' | 'ok',
  error?: Error | undefined
): Promise<TraceContext | undefined> => {
  const record = await writeActivationTraceRecord(
    'activation.queue',
    activationAttrs(registration, message, activation),
    status,
    isTrailsError(error) ? error.category : undefined,
    undefined,
    graph.observe?.trace ?? getTraceSink()
  );
  return record === undefined ? undefined : traceContextFromRecord(record);
};

const contextForActivation = (
  activation: ReturnType<typeof activationFor>,
  traceContext: TraceContext | undefined
): Partial<TrailContextInit> =>
  withActivationProvenance(
    {
      extensions:
        traceContext === undefined ? {} : { [TRACE_CONTEXT_KEY]: traceContext },
    },
    activation
  );

const shouldRunRegistration = async (
  registration: QueueConsumerRegistration,
  input: unknown
): Promise<Result<boolean, Error>> => {
  const predicate = getActivationWherePredicate(registration.activation.where);
  if (predicate === undefined) {
    return Result.ok(true);
  }
  try {
    return Result.ok(await predicate(input));
  } catch (error: unknown) {
    const cause = errorFromUnknown(error);
    return Result.err(
      new InternalError(
        `Queue activation predicate failed for source "${registration.source.id}" and trail "${registration.trailId}": ${cause.message}`,
        {
          cause,
          context: {
            sourceId: registration.source.id,
            trailId: registration.trailId,
          },
        }
      )
    );
  }
};

const retryOptionsFor = (
  error: Error
): CloudflareQueueRetryOptions | undefined =>
  error instanceof RateLimitError && error.retryAfter !== undefined
    ? { delaySeconds: Math.max(0, Math.ceil(error.retryAfter)) }
    : undefined;

interface MessageDecision {
  readonly action: 'ack' | 'retry';
  readonly retryOptions?: CloudflareQueueRetryOptions | undefined;
}

const ackDecision = Object.freeze({ action: 'ack' as const });

const retryDecision = (error: Error): MessageDecision => ({
  action: 'retry',
  ...(retryOptionsFor(error) === undefined
    ? {}
    : { retryOptions: retryOptionsFor(error) }),
});

const failureDecision = (error: Error): MessageDecision =>
  isTrailsError(error) && !error.retryable ? ackDecision : retryDecision(error);

const runQueueConsumer = async (
  graph: Topo,
  registration: QueueConsumerRegistration,
  message: CloudflareQueueMessage,
  options: CreateQueueHandlerOptions
): Promise<MessageDecision> => {
  const parsed = parseQueueMessageBody(registration, message.body);
  const activation = activationFor(registration, message);
  if (parsed.isErr()) {
    await recordQueueActivationTrace(
      graph,
      registration,
      message,
      activation,
      'err',
      parsed.error
    );
    return failureDecision(parsed.error);
  }
  const shouldRun = await shouldRunRegistration(registration, parsed.value);
  if (shouldRun.isErr()) {
    await recordQueueActivationTrace(
      graph,
      registration,
      message,
      activation,
      'err',
      shouldRun.error
    );
    return failureDecision(shouldRun.error);
  }
  if (!shouldRun.value) {
    return ackDecision;
  }

  const traceContext = await recordQueueActivationTrace(
    graph,
    registration,
    message,
    activation,
    'ok'
  );
  const result = await run(graph, registration.trailId, parsed.value, {
    ...(options.abortSignal === undefined
      ? {}
      : { abortSignal: options.abortSignal }),
    configValues: options.configValues,
    createContext: options.createContext,
    ctx: contextForActivation(activation, traceContext),
    resources: options.resources,
    surfaceLayers: options.layers,
    topoLayers: graph.layers,
  });
  if (result.isOk()) {
    return ackDecision;
  }
  if (result.error instanceof CancelledError) {
    return ackDecision;
  }
  return failureDecision(result.error);
};

const processMessage = async (
  graph: Topo,
  registrations: readonly QueueConsumerRegistration[],
  message: CloudflareQueueMessage,
  options: CreateQueueHandlerOptions
): Promise<MessageDecision> => {
  for (const registration of registrations) {
    try {
      const decision = await runQueueConsumer(
        graph,
        registration,
        message,
        options
      );
      if (decision.action === 'retry') {
        return decision;
      }
    } catch (error: unknown) {
      return failureDecision(errorFromUnknown(error));
    }
  }
  return ackDecision;
};

/**
 * Build a Cloudflare Queues consumer handler for a topo.
 *
 * The handler dispatches each message to every matching first-class core
 * `queue()` activation source for `batch.queue`. A message is acknowledged
 * after all matching consumer trails succeed, skip, cancel, or fail with a
 * non-retryable Trails error. Only failures explicitly marked retryable enter
 * Cloudflare's configured retry/DLQ policy. `RateLimitError.retryAfter`
 * becomes the queue retry's `delaySeconds`; other retryable errors use the
 * queue's configured default delay.
 *
 * @example
 * ```ts
 * import { createQueueHandler } from '@ontrails/cloudflare/queues';
 *
 * export const queue = createQueueHandler(graph);
 * ```
 */
export const createQueueHandler = (
  graph: Topo,
  options: CreateQueueHandlerOptions = {}
): CloudflareQueueHandler => {
  const validated = validateSurfaceTopo(graph, options);
  if (validated.isErr()) {
    throw validated.error;
  }

  const byQueue = new Map<string, QueueConsumerRegistration[]>();
  for (const registration of collectQueueConsumers(graph, options)) {
    const current = byQueue.get(registration.source.queue) ?? [];
    current.push(registration);
    byQueue.set(registration.source.queue, current);
  }
  for (const [queueName, registrations] of byQueue) {
    assertQueueSourceCompatibility(queueName, registrations);
  }

  return async (batch) => {
    const registrations = byQueue.get(batch.queue) ?? [];
    if (registrations.length === 0) {
      batch.ackAll();
      return;
    }

    for (const message of batch.messages) {
      const decision = await processMessage(
        graph,
        registrations,
        message,
        options
      );
      if (decision.action === 'ack') {
        message.ack();
      } else {
        message.retry(decision.retryOptions);
      }
    }
  };
};
