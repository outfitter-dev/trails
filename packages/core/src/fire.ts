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
import type {
  FireFn,
  Logger,
  TrailContext,
  TrailContextInit,
} from './types.js';

/** Signature execute.ts passes in to avoid a fire ↔ execute import cycle. */
export type ConsumerExecutor = (
  consumer: AnyTrail,
  input: unknown,
  ctx: Partial<TrailContextInit>
) => Promise<Result<unknown, Error>>;

const buildConsumerCtx = (
  producerCtx: TrailContext | undefined,
  fire: FireFn,
  signalId: string
): Partial<TrailContextInit> => {
  if (producerCtx === undefined) {
    return { fire };
  }
  const childLogger: Logger | undefined =
    producerCtx.logger?.child?.({ signalId }) ?? producerCtx.logger;
  return {
    ...producerCtx,
    fire,
    logger: childLogger,
  };
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

/**
 * Build a `FireFn` closure bound to a topo.
 *
 * When `producerCtx` is provided, consumer trails activated via `on:`
 * inherit the producer's logger, extensions, resources, abortSignal,
 * requestId, env, workspaceRoot, and permit. `ctx.fire` on the consumer
 * is rebound to the same closure so consumers can emit downstream
 * signals naturally.
 */
const resolveSignalId = (signalOrId: unknown): string => {
  if (typeof signalOrId === 'string') {
    return signalOrId;
  }
  if (
    typeof signalOrId === 'object' &&
    signalOrId !== null &&
    'id' in signalOrId &&
    typeof (signalOrId as { id: unknown }).id === 'string'
  ) {
    return (signalOrId as { id: string }).id;
  }
  throw new TypeError(
    'ctx.fire() requires a signal id string or a Signal value'
  );
};

const dispatchFire = async (
  topo: Topo,
  producerCtx: TrailContext | undefined,
  executor: ConsumerExecutor,
  self: FireFn,
  signalId: string,
  payload: unknown
): Promise<Result<void, Error>> => {
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
  const consumers = topo.list().filter((trail) => trail.on.includes(signalId));
  const consumerCtx = buildConsumerCtx(producerCtx, self, signalId);
  await fanOutToConsumers(
    consumers,
    parsed.data,
    signalId,
    consumerCtx,
    executor,
    producerCtx?.logger
  );
  return Result.ok();
};

export const createFireFn = (
  topo: Topo,
  producerCtx: TrailContext | undefined,
  executor: ConsumerExecutor
): FireFn => {
  // Holder bag so the closure body can reference the final FireFn without
  // triggering eslint(no-use-before-define). The bag is populated on the
  // line after the closure is built; by the time the closure runs, the
  // bag's `fn` field holds the same FireFn that was returned.
  const holder: { fn: FireFn | undefined } = { fn: undefined };
  const fireImpl = (signalOrId: unknown, payload: unknown) =>
    dispatchFire(
      topo,
      producerCtx,
      executor,
      holder.fn as FireFn,
      resolveSignalId(signalOrId),
      payload
    );
  holder.fn = fireImpl as FireFn;
  return holder.fn;
};
