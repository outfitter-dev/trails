/**
 * Signal emission and auto-activation.
 *
 * `createFireFn(topo, producerCtx?, executor, producerTrailId?)` returns a
 * `FireFn` bound to a topo. Calling `fire(signal, payload)` looks up the
 * signal, validates the payload against its schema, finds every trail with
 * the signal in its `on:` array, and invokes each consumer via the supplied
 * executor.
 *
 * The `executor` parameter is an indirection that lets `execute.ts` pass in
 * `executeTrail` without `fire.ts` importing it directly — keeping the two
 * modules dependency-cycle-free.
 *
 * Consumer contexts inherit the producer's full ctx (logger, extensions,
 * resources, abortSignal, requestId, env, workspaceRoot, permit) with
 * `fire` rebound to the same closure so consumers can fan out further.
 * Each consumer gets its own derived context so sibling fan-out branches do
 * not share mutable top-level state. The consumer logger is derived from the
 * producer logger as a child tagged with `signalId` and `consumerId` when
 * `logger.child` exists.
 *
 * Error semantics match the fire-and-forget framing: producer-facing
 * `ctx.fire()` resolves after dispatch is initiated and without a value.
 * Unknown signals, invalid payloads, guard suppression, and consumer errors
 * are logged/diagnosed but do NOT propagate back to the producer. Consumers
 * that need transactional coupling should use `crosses:`.
 */

import type { z } from 'zod';

import type {
  ActivationEntry,
  ActivationWhereSpec,
} from './activation-source.js';
import { getActivationWherePredicate } from './activation-source.js';
import { NotFoundError, TrailsError, ValidationError } from './errors.js';
import { forkCtx } from './internal/fork-ctx.js';
import {
  getTraceContext,
  getTraceSink,
  isTracingDisabled,
  writeSignalTraceRecord,
} from './internal/tracing.js';
import type { SignalTraceRecordName } from './internal/tracing.js';
import { Result } from './result.js';
import type { AnySignal } from './signal.js';
import {
  createSignalFireSuppressedDiagnostic,
  createSignalHandlerFailedDiagnostic,
  createSignalHandlerRejectedDiagnostic,
  createSignalInvalidDiagnostic,
  createSignalPredicateFailedDiagnostic,
  createSignalUnknownDiagnostic,
  recordSignalDiagnostic,
  signalDiagnosticCauseFromUnknown,
  summarizeSignalPayload,
} from './signal-diagnostics.js';
import type {
  SignalDiagnostic,
  SignalDiagnosticSchemaIssue,
  SignalInvalidDiagnostic,
  SignalPayloadSummary,
} from './signal-diagnostics.js';
import type { Topo } from './topo.js';
import type { AnyTrail } from './trail.js';
import type { FireFn, Logger, TrailContextInit } from './types.js';

/** Signature execute.ts passes in to avoid a fire ↔ execute import cycle. */
export type ConsumerExecutor = (
  consumer: AnyTrail,
  input: unknown,
  ctx: Partial<TrailContextInit>
) => Promise<Result<unknown, Error>>;

type MutableConsumerContext = {
  -readonly [K in keyof Partial<TrailContextInit>]: Partial<TrailContextInit>[K];
};

interface ConsumerActivation {
  readonly trail: AnyTrail;
  readonly where?: ActivationWhereSpec | undefined;
}

const FIRE_STACK_KEY = '__trails_fire_stack';
const FIRE_PENDING_DISPATCHES_KEY = '__trails_fire_pending_dispatches';

const frameworkFireFns = new WeakSet<FireFn>();

export const isFrameworkFireFn = (fire: FireFn | undefined): boolean =>
  fire !== undefined && frameworkFireFns.has(fire);

type FireDispatchTracker = Set<Promise<void>>;

const getFireDispatchTracker = (
  ctx: Pick<TrailContextInit, 'extensions'> | undefined
): FireDispatchTracker | undefined => {
  const tracker = ctx?.extensions?.[FIRE_PENDING_DISPATCHES_KEY];
  return tracker instanceof Set ? (tracker as FireDispatchTracker) : undefined;
};

export const withFireDispatchTracking = <T extends TrailContextInit>(
  ctx: T
): T => {
  if (getFireDispatchTracker(ctx) !== undefined) {
    return ctx;
  }

  return {
    ...ctx,
    extensions: {
      ...ctx.extensions,
      [FIRE_PENDING_DISPATCHES_KEY]: new Set<Promise<void>>(),
    },
  };
};

const trackFireDispatch = (
  ctx: Pick<TrailContextInit, 'extensions'> | undefined,
  dispatch: Promise<void>
): void => {
  const tracker = getFireDispatchTracker(ctx);
  if (tracker === undefined) {
    return;
  }
  tracker.add(dispatch);
  const untrack = async (): Promise<void> => {
    try {
      await dispatch;
    } finally {
      tracker.delete(dispatch);
    }
  };
  void untrack();
};

export const waitForPendingFireDispatches = async (
  ctx: Pick<TrailContextInit, 'extensions'>
): Promise<void> => {
  const tracker = getFireDispatchTracker(ctx);
  if (tracker === undefined) {
    return;
  }

  while (tracker.size > 0) {
    await Promise.allSettled(tracker);
  }
};

/**
 * Maximum depth for signal fan-out chains.
 *
 * Cycle detection catches re-entrant fires of the same signal ID (A→B→A),
 * but a chain of distinct signals (A→B→C→D→...) bypasses it. This limit
 * prevents runaway fan-out in pathological topologies.
 */
const MAX_FIRE_DEPTH = 16;

const getFireStack = (
  ctx: Pick<TrailContextInit, 'extensions'> | undefined
): readonly string[] => {
  const value = ctx?.extensions?.[FIRE_STACK_KEY];
  return Array.isArray(value) ? (value as readonly string[]) : [];
};

/** Binds a per-consumer `fire` onto a mutable consumer context. */
type ConsumerFireBinder = (
  consumerCtx: MutableConsumerContext,
  consumerId: string
) => MutableConsumerContext;

const deriveConsumerLogger = (
  producerCtx: TrailContextInit | undefined,
  signalId: string,
  consumerId: string
): Logger | undefined =>
  producerCtx?.logger?.child?.({ consumerId, signalId }) ?? producerCtx?.logger;

const deriveConsumerEnv = (
  producerCtx: TrailContextInit | undefined
): TrailContextInit['env'] =>
  producerCtx?.env ? { ...producerCtx.env } : undefined;

const deriveConsumerExtensions = (
  producerCtx: TrailContextInit | undefined,
  signalId: string
): TrailContextInit['extensions'] => {
  const { [FIRE_PENDING_DISPATCHES_KEY]: _pending, ...extensions } =
    producerCtx?.extensions ?? {};
  return {
    ...extensions,
    [FIRE_STACK_KEY]: [...getFireStack(producerCtx), signalId],
  };
};

const deriveConsumerCtx = (
  producerCtx: TrailContextInit | undefined,
  signalId: string,
  consumerId: string
): MutableConsumerContext =>
  producerCtx
    ? forkCtx(producerCtx as MutableConsumerContext, {
        env: deriveConsumerEnv(producerCtx),
        extensions: deriveConsumerExtensions(producerCtx, signalId),
        logger: deriveConsumerLogger(producerCtx, signalId, consumerId),
      })
    : {};

interface FireDiagnosticMetadata {
  readonly producerTrailId?: string | undefined;
  readonly runId?: string | undefined;
  readonly traceId?: string | undefined;
}

interface SignalTraceAttrsInput {
  readonly consumerIds?: readonly string[] | undefined;
  readonly errorName?: string | undefined;
  readonly handlerTrailId?: string | undefined;
  readonly payload?: SignalPayloadSummary | undefined;
  readonly producerTrailId?: string | undefined;
  readonly runId?: string | undefined;
  readonly schemaIssues?: readonly SignalDiagnosticSchemaIssue[] | undefined;
  readonly signalId: string;
}

const deriveFireDiagnosticMetadata = (
  producerCtx: TrailContextInit | undefined,
  producerTrailId: string | undefined
): FireDiagnosticMetadata => {
  const trace = producerCtx ? getTraceContext(producerCtx) : undefined;
  return {
    producerTrailId,
    runId: trace?.spanId,
    traceId: trace?.traceId,
  };
};

const recordRuntimeSignalDiagnostic = async (
  producerCtx: TrailContextInit | undefined,
  diagnostic: SignalDiagnostic
): Promise<boolean> => {
  const record = await recordSignalDiagnostic(producerCtx, diagnostic);
  if (record.promoted) {
    producerCtx?.logger?.warn('Signal diagnostic promoted by strict mode', {
      code: diagnostic.code,
      producerTrailId: diagnostic.producerTrailId,
      runId: diagnostic.runId,
      signalId: diagnostic.signalId,
      traceId: diagnostic.traceId,
    });
  }
  return record.promoted;
};

const deriveSignalErrorCategory = (error: unknown): string =>
  error instanceof TrailsError ? error.category : 'internal';

const signalIssuePathLabel = (issue: SignalDiagnosticSchemaIssue): string => {
  if (issue.path.length === 0) {
    return '$';
  }
  return issue.path.map(String).join('.');
};

const addPayloadSummaryAttrs = (
  attrs: Record<string, unknown>,
  payload: SignalPayloadSummary
): void => {
  attrs['trails.signal.payload.byte_length'] = payload.byteLength;
  attrs['trails.signal.payload.digest'] = payload.digest;
  attrs['trails.signal.payload.redacted'] = payload.redacted;
  attrs['trails.signal.payload.shape'] = payload.shape;
  if (payload.topLevelEntryCount !== undefined) {
    attrs['trails.signal.payload.top_level_entry_count'] =
      payload.topLevelEntryCount;
  }
};

const buildSignalTraceAttrs = (
  input: SignalTraceAttrsInput
): Readonly<Record<string, unknown>> => {
  const attrs: Record<string, unknown> = {
    'trails.signal.id': input.signalId,
  };

  if (input.producerTrailId !== undefined) {
    attrs['trails.signal.producer_trail.id'] = input.producerTrailId;
  }
  if (input.runId !== undefined) {
    attrs['trails.signal.run.id'] = input.runId;
  }
  if (input.handlerTrailId !== undefined) {
    attrs['trails.signal.handler_trail.id'] = input.handlerTrailId;
  }
  if (input.consumerIds !== undefined) {
    attrs['trails.signal.consumer_count'] = input.consumerIds.length;
    attrs['trails.signal.consumer_ids'] = input.consumerIds
      .toSorted()
      .join(',');
  }
  if (input.errorName !== undefined) {
    attrs['trails.signal.error.name'] = input.errorName;
  }
  if (input.payload !== undefined) {
    addPayloadSummaryAttrs(attrs, input.payload);
  }
  if (input.schemaIssues !== undefined) {
    const issuePaths = input.schemaIssues.map(signalIssuePathLabel);
    attrs['trails.signal.schema_issue_count'] = input.schemaIssues.length;
    attrs['trails.signal.schema_issue_paths'] = issuePaths.join(',');
  }

  return attrs;
};

const recordSignalLifecycleTrace = async (
  producerCtx: TrailContextInit | undefined,
  name: SignalTraceRecordName,
  attrs: Readonly<Record<string, unknown>>,
  status?: Parameters<typeof writeSignalTraceRecord>[3],
  errorCategory?: string | undefined
): Promise<void> => {
  if (producerCtx === undefined) {
    return;
  }
  await writeSignalTraceRecord(producerCtx, name, attrs, status, errorCategory);
};

const activationEntriesForSignal = (
  trail: AnyTrail,
  signalId: string
): readonly ConsumerActivation[] => {
  const activations = new Map<string, ActivationEntry>();
  for (const activation of trail.activationSources ?? []) {
    if (
      activation.source.kind !== 'signal' ||
      activation.source.id !== signalId
    ) {
      continue;
    }
    const key = `${activation.source.kind}:${activation.source.id}`;
    const previous = activations.get(key);
    if (
      previous === undefined ||
      (previous.where === undefined && activation.where !== undefined)
    ) {
      activations.set(key, activation);
    }
  }
  if (activations.size > 0) {
    return [...activations.values()].map((activation) => ({
      trail,
      where: activation.where,
    }));
  }
  return trail.on.includes(signalId) ? [{ trail }] : [];
};

const listConsumerActivations = (
  topo: Topo,
  signalId: string
): readonly ConsumerActivation[] =>
  topo.list().flatMap((trail) => activationEntriesForSignal(trail, signalId));

const consumerTrailsFromActivations = (
  activations: readonly ConsumerActivation[]
): readonly AnyTrail[] => [
  ...new Map(
    activations.map((activation) => [activation.trail.id, activation.trail])
  ).values(),
];

const hasActiveSignalTraceContext = (
  producerCtx: TrailContextInit | undefined
): boolean =>
  producerCtx !== undefined &&
  getTraceContext(producerCtx) !== undefined &&
  !isTracingDisabled(getTraceSink());

const summarizeSignalPayloadForTrace = (
  producerCtx: TrailContextInit | undefined,
  payload: unknown
): SignalPayloadSummary | undefined => {
  if (!hasActiveSignalTraceContext(producerCtx)) {
    return undefined;
  }
  try {
    return summarizeSignalPayload(payload);
  } catch (error) {
    producerCtx?.logger?.debug('Signal payload summary skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
};

const recordPredicateTrace = async (
  producerCtx: TrailContextInit | undefined,
  name:
    | 'signal.handler.predicate_failed'
    | 'signal.handler.predicate_matched'
    | 'signal.handler.predicate_skipped',
  input: {
    readonly diagnosticMetadata: FireDiagnosticMetadata;
    readonly errorCategory?: string | undefined;
    readonly errorName?: string | undefined;
    readonly handlerTrailId: string;
    readonly payloadSummary?: SignalPayloadSummary | undefined;
    readonly signalId: string;
    readonly status?: Parameters<typeof recordSignalLifecycleTrace>[3];
  }
): Promise<void> => {
  await recordSignalLifecycleTrace(
    producerCtx,
    name,
    buildSignalTraceAttrs({
      errorName: input.errorName,
      handlerTrailId: input.handlerTrailId,
      payload: input.payloadSummary,
      producerTrailId: input.diagnosticMetadata.producerTrailId,
      runId: input.diagnosticMetadata.runId,
      signalId: input.signalId,
    }),
    input.status,
    input.errorCategory
  );
};

const shouldInvokeConsumer = async (
  activation: ConsumerActivation,
  payload: unknown,
  payloadSummary: SignalPayloadSummary | undefined,
  signalId: string,
  producerCtx: TrailContextInit | undefined,
  diagnosticMetadata: FireDiagnosticMetadata,
  logger: Logger | undefined
): Promise<boolean> => {
  const predicate = getActivationWherePredicate(activation.where);
  if (predicate === undefined) {
    return true;
  }

  try {
    const matched = await predicate(payload);
    await recordPredicateTrace(
      producerCtx,
      matched
        ? 'signal.handler.predicate_matched'
        : 'signal.handler.predicate_skipped',
      {
        diagnosticMetadata,
        handlerTrailId: activation.trail.id,
        payloadSummary,
        signalId,
      }
    );
    return matched;
  } catch (error) {
    const cause = signalDiagnosticCauseFromUnknown(error);
    const diagnostic = createSignalPredicateFailedDiagnostic({
      ...diagnosticMetadata,
      cause: error,
      handlerTrailId: activation.trail.id,
      payload,
      signalId,
    });
    await recordRuntimeSignalDiagnostic(producerCtx, diagnostic);
    await recordPredicateTrace(producerCtx, 'signal.handler.predicate_failed', {
      diagnosticMetadata,
      errorCategory: deriveSignalErrorCategory(error),
      errorName: cause.name,
      handlerTrailId: activation.trail.id,
      payloadSummary,
      signalId,
      status: 'err',
    });
    logger?.warn('Signal activation predicate failed', {
      consumerId: activation.trail.id,
      error: cause.message,
      signalId,
    });
    return false;
  }
};

/**
 * Fan out a validated signal payload to its consumer trails.
 *
 * @remarks
 * Signal delivery is fire-and-forget notification, not ordered orchestration;
 * if one consumer depends on another, the dependency belongs in `crosses:`
 * instead of sibling signal sequencing.
 *
 * `Promise.allSettled` preserves failure isolation for the background
 * completion task. Producer-facing `ctx.fire()` starts this task but does not
 * wait for every consumer to complete before resolving. Each consumer gets its
 * own derived context so sibling fan-out branches do not share mutable
 * top-level state while they overlap. Re-entrant suppression elsewhere in this
 * module is still based on signal-id membership in the current fire stack: it
 * prevents infinite loops, but it can over-suppress legitimate diamond
 * re-fires. Per-path provenance is a documented future direction rather than
 * part of the pre-v1 runtime contract.
 */
const fanOutToConsumers = async (
  activations: readonly ConsumerActivation[],
  payload: unknown,
  signalId: string,
  producerCtx: TrailContextInit | undefined,
  diagnosticMetadata: FireDiagnosticMetadata,
  bindFire: ConsumerFireBinder,
  executor: ConsumerExecutor,
  logger: Logger | undefined
): Promise<void> => {
  const payloadSummary = summarizeSignalPayloadForTrace(producerCtx, payload);
  const settled = await Promise.allSettled(
    activations.map(async (activation) => {
      const consumer = activation.trail;
      const shouldInvoke = await shouldInvokeConsumer(
        activation,
        payload,
        payloadSummary,
        signalId,
        producerCtx,
        diagnosticMetadata,
        logger
      );
      if (!shouldInvoke) {
        return consumer.id;
      }
      const consumerCtx = bindFire(
        deriveConsumerCtx(producerCtx, signalId, consumer.id),
        consumer.id
      );
      await recordSignalLifecycleTrace(
        producerCtx,
        'signal.handler.invoked',
        buildSignalTraceAttrs({
          handlerTrailId: consumer.id,
          payload: payloadSummary,
          producerTrailId: diagnosticMetadata.producerTrailId,
          runId: diagnosticMetadata.runId,
          signalId,
        })
      );
      try {
        const consumerResult = await executor(consumer, payload, consumerCtx);
        if (consumerResult.isErr()) {
          const cause = signalDiagnosticCauseFromUnknown(consumerResult.error);
          const diagnostic = createSignalHandlerFailedDiagnostic({
            ...diagnosticMetadata,
            cause: consumerResult.error,
            handlerTrailId: consumer.id,
            payload,
            signalId,
          });
          await recordRuntimeSignalDiagnostic(producerCtx, diagnostic);
          await recordSignalLifecycleTrace(
            producerCtx,
            'signal.handler.failed',
            buildSignalTraceAttrs({
              errorName: cause.name,
              handlerTrailId: consumer.id,
              payload: payloadSummary,
              producerTrailId: diagnosticMetadata.producerTrailId,
              runId: diagnosticMetadata.runId,
              signalId,
            }),
            'err',
            deriveSignalErrorCategory(consumerResult.error)
          );
          (consumerCtx.logger ?? logger)?.warn('Signal consumer failed', {
            consumerId: consumer.id,
            error: consumerResult.error.message,
            signalId,
          });
          return consumer.id;
        }
        await recordSignalLifecycleTrace(
          producerCtx,
          'signal.handler.completed',
          buildSignalTraceAttrs({
            handlerTrailId: consumer.id,
            payload: payloadSummary,
            producerTrailId: diagnosticMetadata.producerTrailId,
            runId: diagnosticMetadata.runId,
            signalId,
          })
        );
        return consumer.id;
      } catch (error) {
        const cause = signalDiagnosticCauseFromUnknown(error);
        const diagnostic = createSignalHandlerRejectedDiagnostic({
          ...diagnosticMetadata,
          cause: error,
          handlerTrailId: consumer.id,
          payload,
          signalId,
        });
        await recordRuntimeSignalDiagnostic(producerCtx, diagnostic);
        await recordSignalLifecycleTrace(
          producerCtx,
          'signal.handler.failed',
          buildSignalTraceAttrs({
            errorName: cause.name,
            handlerTrailId: consumer.id,
            payload: payloadSummary,
            producerTrailId: diagnosticMetadata.producerTrailId,
            runId: diagnosticMetadata.runId,
            signalId,
          }),
          'err',
          deriveSignalErrorCategory(error)
        );
        throw error;
      }
    })
  );
  for (const [index, entry] of settled.entries()) {
    if (entry.status !== 'rejected') {
      continue;
    }
    // `executeTrail` normalizes throws into `Result.err`, so reaching this
    // branch means the executor (or the warn call above) rejected
    // unexpectedly. Log at debug to preserve provenance without propagating
    // the failure to the producer (fire-and-forget semantics).
    logger?.debug('Signal consumer rejected unexpectedly', {
      consumerId: activations[index]?.trail.id,
      error:
        entry.reason instanceof Error
          ? entry.reason.message
          : String(entry.reason),
      signalId,
    });
  }
};

const recordInvalidSignalDiagnostic = async (
  producerCtx: TrailContextInit | undefined,
  diagnostic: SignalInvalidDiagnostic
): Promise<boolean> =>
  await recordRuntimeSignalDiagnostic(producerCtx, diagnostic);

const createInvalidPayloadError = (
  signalId: string,
  message: string,
  diagnostic: SignalInvalidDiagnostic,
  promoted: boolean
): ValidationError =>
  new ValidationError(`Invalid payload for signal "${signalId}": ${message}`, {
    context: {
      diagnosticCode: diagnostic.code,
      promoted,
      schemaIssues: diagnostic.schemaIssues,
      signalId,
    },
  });

const PAYLOAD_SCHEMA_READ_ERROR_MESSAGE =
  'Payload schema validation could not read the payload safely';

type SignalPayloadParseResult =
  | {
      readonly data: unknown;
      readonly success: true;
    }
  | {
      readonly issues: readonly z.core.$ZodIssue[];
      readonly message: string;
      readonly success: false;
    };

const unreadablePayloadIssue = (): z.core.$ZodIssue =>
  ({
    code: 'custom',
    message: PAYLOAD_SCHEMA_READ_ERROR_MESSAGE,
    path: [],
  }) as z.core.$ZodIssue;

const safeParseSignalPayload = (
  signal: AnySignal,
  payload: unknown
): SignalPayloadParseResult => {
  try {
    const parsed = signal.payload.safeParse(payload);
    if (parsed.success) {
      return { data: parsed.data, success: true };
    }
    return {
      issues: parsed.error.issues,
      message: parsed.error.message,
      success: false,
    };
  } catch {
    return {
      issues: [unreadablePayloadIssue()],
      message: PAYLOAD_SCHEMA_READ_ERROR_MESSAGE,
      success: false,
    };
  }
};

const resolveFireDispatch = async (
  topo: Topo,
  signalId: string,
  payload: unknown,
  producerCtx: TrailContextInit | undefined,
  diagnosticMetadata: FireDiagnosticMetadata
): Promise<
  Result<
    {
      readonly activations: readonly ConsumerActivation[];
      readonly consumers: readonly AnyTrail[];
      readonly payload: unknown;
    },
    Error
  >
> => {
  const signal = topo.signals.get(signalId);
  if (signal === undefined) {
    await recordRuntimeSignalDiagnostic(
      producerCtx,
      createSignalUnknownDiagnostic({
        ...diagnosticMetadata,
        signalId,
      })
    );
    return Result.err(
      new NotFoundError(`Signal "${signalId}" not found in topo "${topo.name}"`)
    );
  }
  const parsed = safeParseSignalPayload(signal, payload);
  if (!parsed.success) {
    const diagnostic = createSignalInvalidDiagnostic({
      ...diagnosticMetadata,
      payload,
      schemaIssues: parsed.issues,
      signalId,
    });
    const promoted = await recordInvalidSignalDiagnostic(
      producerCtx,
      diagnostic
    );
    await recordSignalLifecycleTrace(
      producerCtx,
      'signal.invalid',
      buildSignalTraceAttrs({
        payload: diagnostic.payload,
        producerTrailId: diagnostic.producerTrailId,
        runId: diagnostic.runId,
        schemaIssues: diagnostic.schemaIssues,
        signalId,
      }),
      'err',
      'validation'
    );
    return Result.err(
      createInvalidPayloadError(signalId, parsed.message, diagnostic, promoted)
    );
  }
  const activations = listConsumerActivations(topo, signalId);
  return Result.ok({
    activations,
    consumers: consumerTrailsFromActivations(activations),
    payload: parsed.data,
  });
};

const resolveSignalId = (signalOrId: unknown): Result<string, Error> => {
  if (
    typeof signalOrId === 'object' &&
    signalOrId !== null &&
    'kind' in signalOrId &&
    (signalOrId as { kind: unknown }).kind === 'signal' &&
    'id' in signalOrId &&
    typeof (signalOrId as { id: unknown }).id === 'string'
  ) {
    return Result.ok((signalOrId as AnySignal).id);
  }
  if (typeof signalOrId === 'string') {
    return Result.err(
      new ValidationError(
        'ctx.fire() requires a Signal value; string signal ids are not part of the public fire API'
      )
    );
  }
  return Result.err(new ValidationError('ctx.fire() requires a Signal value'));
};

const logFireError = (
  logger: Logger | undefined,
  signalId: string | undefined,
  error: Error
): void => {
  logger?.warn('Signal fire skipped', {
    error: error.message,
    signalId,
  });
};

/**
 * Build a `FireFn` closure bound to a topo.
 *
 * When `producerCtx` is provided, consumer trails activated via `on:`
 * inherit the producer's logger, extensions, resources, abortSignal,
 * requestId, env, workspaceRoot, and permit. `ctx.fire` on the consumer
 * is rebound to the same closure so consumers can emit downstream
 * signals naturally.
 */
export const createFireFn = (
  topo: Topo,
  producerCtx: TrailContextInit | undefined,
  executor: ConsumerExecutor,
  producerTrailId?: string | undefined
): FireFn => {
  const trackedProducerCtx =
    producerCtx === undefined
      ? undefined
      : withFireDispatchTracking(producerCtx);
  const bindConsumerFire: ConsumerFireBinder = (consumerCtx, consumerId) => ({
    ...consumerCtx,
    // Pre-bind fire on the consumer ctx as a safety net for direct
    // executeTrail calls that skip the topo-aware path. In the normal
    // fan-out flow below, bindFireToCtx in execute.ts rebinds fire to
    // the fully-traced ctx before the blaze runs, so this assignment
    // is superseded — but keeping it makes consumerCtx self-sufficient
    // for any caller that inspects it pre-execution.
    fire: createFireFn(
      topo,
      consumerCtx as TrailContextInit,
      executor,
      consumerId
    ),
  });

  const dispatchFire = async (
    signalId: string,
    payload: unknown
  ): Promise<Result<void, Error>> => {
    const diagnosticMetadata = deriveFireDiagnosticMetadata(
      trackedProducerCtx,
      producerTrailId
    );
    const dispatch = await resolveFireDispatch(
      topo,
      signalId,
      payload,
      trackedProducerCtx,
      diagnosticMetadata
    );
    if (dispatch.isErr()) {
      return Result.err(dispatch.error);
    }
    await recordSignalLifecycleTrace(
      trackedProducerCtx,
      'signal.fired',
      buildSignalTraceAttrs({
        consumerIds: dispatch.value.consumers.map((consumer) => consumer.id),
        payload: summarizeSignalPayloadForTrace(
          trackedProducerCtx,
          dispatch.value.payload
        ),
        producerTrailId: diagnosticMetadata.producerTrailId,
        runId: diagnosticMetadata.runId,
        signalId,
      })
    );
    const completion = (async (): Promise<void> => {
      try {
        await fanOutToConsumers(
          dispatch.value.activations,
          dispatch.value.payload,
          signalId,
          trackedProducerCtx,
          diagnosticMetadata,
          bindConsumerFire,
          executor,
          trackedProducerCtx?.logger
        );
      } catch (error: unknown) {
        trackedProducerCtx?.logger?.debug(
          'Signal dispatch completion failed unexpectedly',
          {
            error: error instanceof Error ? error.message : String(error),
            signalId,
          }
        );
      }
    })();
    trackFireDispatch(trackedProducerCtx, completion);
    return Result.ok();
  };

  /** Return an early Result if the fire should be suppressed, or null to proceed. */
  const guardFire = async (
    signalId: string,
    stack: readonly string[]
  ): Promise<Result<void, Error> | null> => {
    if (stack.length >= MAX_FIRE_DEPTH) {
      trackedProducerCtx?.logger?.warn(
        'Signal fan-out depth limit reached — skipping fire',
        { depth: stack.length, signalId }
      );
      await recordRuntimeSignalDiagnostic(
        trackedProducerCtx,
        createSignalFireSuppressedDiagnostic({
          ...deriveFireDiagnosticMetadata(trackedProducerCtx, producerTrailId),
          fireStack: [...stack],
          limit: MAX_FIRE_DEPTH,
          reason: 'depth',
          signalId,
        })
      );
      return Result.ok();
    }
    if (stack.includes(signalId)) {
      trackedProducerCtx?.logger?.debug(
        'Signal fan-out suppressed due to cycle',
        {
          fireStack: [...stack],
          signalId,
        }
      );
      trackedProducerCtx?.logger?.warn(
        'Signal cycle detected — skipping re-entrant fire',
        { fireStack: [...stack], signalId }
      );
      await recordRuntimeSignalDiagnostic(
        trackedProducerCtx,
        createSignalFireSuppressedDiagnostic({
          ...deriveFireDiagnosticMetadata(trackedProducerCtx, producerTrailId),
          fireStack: [...stack],
          reason: 'cycle',
          signalId,
        })
      );
      return Result.ok();
    }
    return null;
  };

  const fireImpl: FireFn = async (
    signalOrId: unknown,
    payload: unknown
  ): Promise<void> => {
    const resolved = resolveSignalId(signalOrId);
    if (resolved.isErr()) {
      logFireError(
        trackedProducerCtx?.logger,
        typeof signalOrId === 'string' ? signalOrId : undefined,
        resolved.error
      );
      return;
    }
    const suppressed = await guardFire(
      resolved.value,
      getFireStack(trackedProducerCtx)
    );
    if (suppressed) {
      if (suppressed.isErr()) {
        logFireError(
          trackedProducerCtx?.logger,
          resolved.value,
          suppressed.error
        );
      }
      return;
    }
    const dispatched = await dispatchFire(resolved.value, payload);
    if (dispatched.isErr()) {
      logFireError(
        trackedProducerCtx?.logger,
        resolved.value,
        dispatched.error
      );
    }
  };
  frameworkFireFns.add(fireImpl);
  return fireImpl;
};
