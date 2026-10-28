import { z } from 'zod';

import { hasPortableJsonStructure } from './json-structure.js';

/**
 * Portable JSON values, cloned without coercion. Cycles, sparse arrays,
 * accessors, symbols, class instances and hidden properties are rejected.
 */
export const queueBodySchema = z
  .custom<QueueBody>((value) => hasPortableJsonStructure(value), {
    error: 'Queue bodies must be plain acyclic JSON values',
  })
  .transform((value) => structuredClone(value));

/** Omitted delay preserves binding defaults; zero explicitly requests no delay. */
export const queueSendOptionsSchema = z.strictObject({
  delaySeconds: z.number().int().nonnegative().optional(),
});

/** Batch delay is per entry; there is no second batch-level precedence rule. */
export const queueMessageSchema = queueSendOptionsSchema.extend({
  body: queueBodySchema,
});

/** Canonical complete-batch validation, before provider I/O begins. */
export const queueBatchSchema = z.array(queueMessageSchema);

/** JSON wire bodies; a producer generic does not assert consumer compatibility. */
export type QueueBody = z.infer<ReturnType<typeof z.json>>;
/** A request for minimum delivery delay, never an exact execution schedule. */
export type QueueSendOptions = z.infer<typeof queueSendOptionsSchema>;
/** One portable submission with per-message delivery options. */
export type QueueMessage<Body extends QueueBody = QueueBody> = Readonly<
  Omit<z.infer<typeof queueMessageSchema>, 'body'> & { readonly body: Body }
>;
