import { Result, ValidationError, resource } from '@ontrails/core';
import type { Resource } from '@ontrails/core';

import { createQueueMock } from './memory.js';
import type { QueueBody } from './schemas.js';
import type { QueueProducer } from './types.js';

/** An ordinary resource with fixed live queue role, distinct from activation. */
export interface QueueProducerResource<
  Body extends QueueBody = QueueBody,
> extends Resource<QueueProducer<Body>> {
  readonly role: 'queue';
}

/** Resource annotations; binding selection belongs to profiles. */
export interface QueueProducerOptions {
  readonly description?: string | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * Declare a queue producer with an isolated test mock. Core queue() remains the
 * consumer activation source; declaring a producer does not wire a consumer.
 * Production creation requires an ordinary resource override.
 *
 * @example
 * ```ts
 * const jobs = queueProducer<{ id: string }>('jobs');
 * // Trails declare resources: [jobs] and use jobs.from(ctx).
 * ```
 */
export const queueProducer = <Body extends QueueBody = QueueBody>(
  id: string,
  options: QueueProducerOptions = {}
): QueueProducerResource<Body> => {
  const definition = resource<QueueProducer<Body>>(id, {
    create: () =>
      Result.err(
        new ValidationError(
          `Queue producer "${id}" has no binding. Supply a provider binding through resource overrides; testAll uses the memory mock automatically.`,
          { context: { resourceId: id } }
        )
      ),
    description: options.description ?? 'Provider-neutral queue producer',
    meta: options.meta,
    mock: () => createQueueMock<Body>(),
  });
  return Object.freeze({ ...definition, role: 'queue' as const });
};
