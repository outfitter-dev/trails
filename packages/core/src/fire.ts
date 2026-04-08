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
 * The consumer logger is derived from the producer logger as a child
 * tagged with `signalId` when `logger.child` exists.
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

const getFireStack = (
  ctx: Pick<TrailContextInit, 'extensions'> | undefined
): readonly string[] => {
  const value = ctx?.extensions?.[FIRE_STACK_KEY];
  return Array.isArray(value) ? (value as readonly string[]) : [];
};

const fanOutToConsumers = async (
  consumers: readonly AnyTrail[],
  payload: unknown,
  signalId: string,
  consumerCtx: Partial<TrailContextInit>,
  executor: ConsumerExecutor,
  logger: Logger | undefined
): Promise<void> => {
  for (const consumer of consumers) {
    const consumerResult = await executor(consumer, payload, consumerCtx);
    if (consumerResult.isErr()) {
      logger?.warn('Signal consumer failed', {
        consumerId: consumer.id,
        error: consumerResult.error.message,
        signalId,
      });
    }
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

const buildConsumerCtx = (
  producerCtx: TrailContextInit | undefined,
  signalId: string
): MutableConsumerContext => {
  const childLogger: Logger | undefined =
    producerCtx?.logger?.child?.({ signalId }) ?? producerCtx?.logger;
  return producerCtx
    ? {
        ...producerCtx,
        extensions: {
          ...producerCtx.extensions,
          [FIRE_STACK_KEY]: [...getFireStack(producerCtx), signalId],
        },
        logger: childLogger,
      }
    : {};
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

export const createFireFn = (
  topo: Topo,
  producerCtx: TrailContextInit | undefined,
  executor: ConsumerExecutor
): FireFn => {
  const dispatchFire = async (
    signalId: string,
    payload: unknown
  ): Promise<Result<void, Error>> => {
    const dispatch = resolveFireDispatch(topo, signalId, payload);
    if (dispatch.isErr()) {
      return Result.err(dispatch.error);
    }
    const consumerCtx = buildConsumerCtx(producerCtx, signalId);
    // Pre-bind fire on the consumer ctx as a safety net for direct
    // executeTrail calls that skip the topo-aware path. In the normal
    // fan-out flow below, bindFireToCtx in execute.ts rebinds fire to
    // the fully-traced ctx before the blaze runs, so this assignment
    // is superseded — but keeping it makes consumerCtx self-sufficient
    // for any caller that inspects it pre-execution.
    consumerCtx.fire = createFireFn(
      topo,
      consumerCtx as TrailContextInit,
      executor
    );
    await fanOutToConsumers(
      dispatch.value.consumers,
      dispatch.value.payload,
      signalId,
      consumerCtx,
      executor,
      producerCtx?.logger
    );
    return Result.ok();
  };

  const fireImpl: FireFn = async (
    signalOrId: unknown,
    payload: unknown
  ): Promise<Result<void, Error>> => {
    const resolved = resolveSignalId(signalOrId);
    if (resolved.isErr()) {
      return Result.err(resolved.error);
    }
    if (getFireStack(producerCtx).includes(resolved.value)) {
      producerCtx?.logger?.warn(
        'Signal cycle detected — skipping re-entrant fire',
        { signalId: resolved.value }
      );
      return Result.ok();
    }
    return await dispatchFire(resolved.value, payload);
  };
  return fireImpl;
};
