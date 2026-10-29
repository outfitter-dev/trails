/**
 * Declare producer resources, distinct from core queue() consumer activation.
 * @example
 * ```ts
 * import { queueProducer } from '@ontrails/queue';
 * const jobs = queueProducer<{ id: string }>('jobs');
 * ```
 */
export { queueProducer } from './resource.js';
/**
 * Producer resource definitions and annotations.
 * @example
 * ```ts
 * import type { QueueProducerResource } from '@ontrails/queue';
 * const roleOf = (definition: QueueProducerResource) => definition.role;
 * ```
 */
export type {
  QueueProducerOptions,
  QueueProducerResource,
} from './resource.js';
/**
 * Isolated producer recorders for tests and explicit local overrides.
 * @example
 * ```ts
 * import { createQueueMock } from '@ontrails/queue';
 * const client = createQueueMock();
 * await client.send(null);
 * ```
 */
export { createQueueMock } from './memory.js';
/**
 * Producer clients and inspectable mock types.
 * @example
 * ```ts
 * import type { QueueProducer } from '@ontrails/queue';
 * const send = (client: QueueProducer) => client.send({ id: 'job-1' });
 * ```
 */
export type { QueueMock, QueueProducer } from './types.js';
/**
 * Canonical JSON domain, delay, entry, and complete-batch validation schemas.
 * @example
 * ```ts
 * import { queueSendOptionsSchema } from '@ontrails/queue';
 * queueSendOptionsSchema.parse({ delaySeconds: 0 });
 * ```
 */
export {
  queueBatchSchema,
  queueBodySchema,
  queueMessageSchema,
  queueSendOptionsSchema,
} from './schemas.js';
/**
 * Schema-owned JSON wire values and portable submission options.
 * @example
 * ```ts
 * import type { QueueMessage } from '@ontrails/queue';
 * const message: QueueMessage = { body: null, delaySeconds: 0 };
 * ```
 */
export type { QueueBody, QueueMessage, QueueSendOptions } from './schemas.js';
