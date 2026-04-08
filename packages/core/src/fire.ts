/**
 * Signal emission and auto-activation.
 *
 * `createFireFn(topo)` returns a `FireFn` bound to a topo. Calling
 * `fire(signalId, payload)` looks up the signal, validates the payload
 * against its schema, finds every trail with the signal in its `on:` array,
 * and invokes each consumer via `executeTrail`.
 *
 * Error semantics match the fire-and-forget framing: producers get
 * `Result.ok(undefined)` unless the signal id is unknown or the payload
 * fails schema validation. Consumer errors are logged via the context's
 * logger (when available) but do NOT propagate back to the producer.
 * Consumers that need transactional coupling should use `crosses:`.
 */

import { NotFoundError, ValidationError } from './errors.js';
import { executeTrail } from './execute.js';
import { Result } from './result.js';
import type { AnyTrail } from './trail.js';
import type { Topo } from './topo.js';
import type { FireFn, Logger, TrailContextInit } from './types.js';

const fanOutToConsumers = async (
  consumers: readonly AnyTrail[],
  payload: unknown,
  signalId: string,
  fire: FireFn,
  logger: Logger | undefined
): Promise<void> => {
  const consumerCtx: Partial<TrailContextInit> = { fire };
  for (const consumer of consumers) {
    const consumerResult = await executeTrail(consumer, payload, {
      ctx: consumerCtx,
    });
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

/** Build a `FireFn` closure bound to a topo. */
export const createFireFn = (topo: Topo, logger?: Logger): FireFn => {
  const fire: FireFn = async (signalId, payload) => {
    const signal = topo.signals.get(signalId);
    if (signal === undefined) {
      return Result.err(
        new NotFoundError(
          `Signal "${signalId}" not found in topo "${topo.name}"`
        )
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

    const consumers = topo
      .list()
      .filter((trail) => trail.on.includes(signalId));
    await fanOutToConsumers(consumers, parsed.data, signalId, fire, logger);
    return Result.ok();
  };

  return fire;
};
