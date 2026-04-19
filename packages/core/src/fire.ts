/**
 * Signal emission and auto-activation.
 *
 * `createFireFn(topo, producerCtx?, executor)` returns a `FireFn` bound to
 * a topo. Calling `fire(signalId, payload)` looks up the signal, validates
 * the payload against its schema, finds every trail with the signal in its
 * `on:` array, and invokes each consumer via the supplied executor.
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
 * Error semantics match the fire-and-forget framing: producers get
 * `Result.ok(undefined)` unless the signal id is unknown or the payload
 * fails schema validation. Consumer errors are logged via the producer's
 * logger but do NOT propagate back to the producer. Consumers that need
 * transactional coupling should use `crosses:`.
 */

import { NotFoundError, ValidationError } from './errors.js';
import { Result } from './result.js';
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

const FIRE_STACK_KEY = '__trails_fire_stack';

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
  consumerCtx: MutableConsumerContext
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
): TrailContextInit['extensions'] => ({
  ...producerCtx?.extensions,
  [FIRE_STACK_KEY]: [...getFireStack(producerCtx), signalId],
});

const deriveConsumerCtx = (
  producerCtx: TrailContextInit | undefined,
  signalId: string,
  consumerId: string
): MutableConsumerContext =>
  producerCtx
    ? {
        ...producerCtx,
        env: deriveConsumerEnv(producerCtx),
        extensions: deriveConsumerExtensions(producerCtx, signalId),
        logger: deriveConsumerLogger(producerCtx, signalId, consumerId),
      }
    : {};

/**
 * Fan out a validated signal payload to its consumer trails.
 *
 * @remarks
 * Consumers fan out in parallel by design. Signal delivery is fire-and-forget
 * notification, not ordered orchestration; if one consumer depends on another,
 * the dependency belongs in `crosses:` instead of sibling signal sequencing.
 *
 * `Promise.allSettled` preserves failure isolation and waits for every branch
 * to settle. Each consumer gets its own derived context so sibling branches do
 * not share mutable top-level state while they overlap. Re-entrant suppression
 * elsewhere in this module is still based on signal-id membership in the
 * current fire stack: it prevents infinite loops, but it can over-suppress
 * legitimate diamond re-fires. Per-path provenance is a documented future
 * direction rather than part of the pre-v1 runtime contract.
 */
const fanOutToConsumers = async (
  consumers: readonly AnyTrail[],
  payload: unknown,
  signalId: string,
  producerCtx: TrailContextInit | undefined,
  bindFire: ConsumerFireBinder,
  executor: ConsumerExecutor,
  logger: Logger | undefined
): Promise<void> => {
  const settled = await Promise.allSettled(
    consumers.map(async (consumer) => {
      const consumerCtx = bindFire(
        deriveConsumerCtx(producerCtx, signalId, consumer.id)
      );
      const consumerResult = await executor(consumer, payload, consumerCtx);
      if (consumerResult.isErr()) {
        (consumerCtx.logger ?? logger)?.warn('Signal consumer failed', {
          consumerId: consumer.id,
          error: consumerResult.error.message,
          signalId,
        });
      }
      return consumer.id;
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
      consumerId: consumers[index]?.id,
      error:
        entry.reason instanceof Error
          ? entry.reason.message
          : String(entry.reason),
      signalId,
    });
  }
};

const resolveFireDispatch = (
  topo: Topo,
  signalId: string,
  payload: unknown
): Result<
  { readonly consumers: readonly AnyTrail[]; readonly payload: unknown },
  Error
> => {
  const signal = topo.signals.get(signalId);
  if (signal === undefined) {
    return Result.err(
      new NotFoundError(`Signal "${signalId}" not found in topo "${topo.name}"`)
    );
  }
  const parsed = signal.payload.safeParse(payload);
  if (!parsed.success) {
    return Result.err(
      new ValidationError(
        `Invalid payload for signal "${signalId}": ${parsed.error.message}`
      )
    );
  }
  return Result.ok({
    consumers: topo.list().filter((trail) => trail.on.includes(signalId)),
    payload: parsed.data,
  });
};

const resolveSignalId = (signalOrId: unknown): Result<string, Error> => {
  if (typeof signalOrId === 'string') {
    return Result.ok(signalOrId);
  }
  if (
    typeof signalOrId === 'object' &&
    signalOrId !== null &&
    'id' in signalOrId &&
    typeof (signalOrId as { id: unknown }).id === 'string'
  ) {
    return Result.ok((signalOrId as { id: string }).id);
  }
  return Result.err(
    new ValidationError(
      'ctx.fire() requires a signal id string or a Signal value'
    )
  );
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
  executor: ConsumerExecutor
): FireFn => {
  const bindConsumerFire: ConsumerFireBinder = (consumerCtx) => ({
    ...consumerCtx,
    // Pre-bind fire on the consumer ctx as a safety net for direct
    // executeTrail calls that skip the topo-aware path. In the normal
    // fan-out flow below, bindFireToCtx in execute.ts rebinds fire to
    // the fully-traced ctx before the blaze runs, so this assignment
    // is superseded — but keeping it makes consumerCtx self-sufficient
    // for any caller that inspects it pre-execution.
    fire: createFireFn(topo, consumerCtx as TrailContextInit, executor),
  });

  const dispatchFire = async (
    signalId: string,
    payload: unknown
  ): Promise<Result<void, Error>> => {
    const dispatch = resolveFireDispatch(topo, signalId, payload);
    if (dispatch.isErr()) {
      return Result.err(dispatch.error);
    }
    await fanOutToConsumers(
      dispatch.value.consumers,
      dispatch.value.payload,
      signalId,
      producerCtx,
      bindConsumerFire,
      executor,
      producerCtx?.logger
    );
    return Result.ok();
  };

  /** Return an early Result if the fire should be suppressed, or null to proceed. */
  const guardFire = (
    signalId: string,
    stack: readonly string[]
  ): Result<void, Error> | null => {
    if (stack.length >= MAX_FIRE_DEPTH) {
      producerCtx?.logger?.warn(
        'Signal fan-out depth limit reached — skipping fire',
        { depth: stack.length, signalId }
      );
      return Result.ok();
    }
    if (stack.includes(signalId)) {
      producerCtx?.logger?.debug('Signal fan-out suppressed due to cycle', {
        fireStack: [...stack],
        signalId,
      });
      producerCtx?.logger?.warn(
        'Signal cycle detected — skipping re-entrant fire',
        { fireStack: [...stack], signalId }
      );
      return Result.ok();
    }
    return null;
  };

  const fireImpl: FireFn = async (
    signalOrId: unknown,
    payload: unknown
  ): Promise<Result<void, Error>> => {
    const resolved = resolveSignalId(signalOrId);
    if (resolved.isErr()) {
      return Result.err(resolved.error);
    }
    const suppressed = guardFire(resolved.value, getFireStack(producerCtx));
    if (suppressed) {
      return suppressed;
    }
    return await dispatchFire(resolved.value, payload);
  };
  return fireImpl;
};
