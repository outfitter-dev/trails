import type { QueueBody, QueueMessage, QueueSendOptions } from './schemas.js';

/**
 * Producer-only infrastructure client. Success means accepted for enqueueing,
 * not consumer processing, ordering, exactly-once delivery, or business atomicity.
 * Bodies are portable JSON values; bindings may enforce explicit backend limits.
 * Validate and snapshot a complete batch before I/O; an empty batch is a no-op.
 * Provider failure can leave outcome uncertain and does not imply rollback.
 * Failures reject with TrailsError; consuming trails return Result outcomes.
 * No automatic retries, hidden batch chunking, timers, or consumer registration.
 */
export interface QueueProducer<Body extends QueueBody = QueueBody> {
  readonly send: (body: Body, options?: QueueSendOptions) => Promise<void>;
  readonly sendBatch: (
    messages: readonly QueueMessage<Body>[]
  ) => Promise<void>;
}

/** A producer recorder for tests, without broker or consumer delivery behavior. */
export interface QueueMock<
  Body extends QueueBody = QueueBody,
> extends QueueProducer<Body> {
  readonly messages: () => readonly QueueMessage<Body>[];
  readonly clear: () => void;
}
