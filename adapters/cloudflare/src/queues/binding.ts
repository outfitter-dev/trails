import { ValidationError } from '@ontrails/core';
import {
  queueBatchSchema,
  queueBodySchema,
  queueSendOptionsSchema,
} from '@ontrails/queue';
import type { QueueBody, QueueProducer } from '@ontrails/queue';

import { invokeBinding, parseBindingArgument } from '../binding-errors.js';
import type { CloudflareQueue } from './index.js';

type NativeQueue = Pick<CloudflareQueue<QueueBody>, 'send' | 'sendBatch'>;
const isQueue = (value: unknown): value is NativeQueue =>
  typeof value === 'object' &&
  value !== null &&
  'send' in value &&
  typeof value.send === 'function' &&
  'sendBatch' in value &&
  typeof value.sendBatch === 'function';

const validateDelay = (delaySeconds: number | undefined): void => {
  if (delaySeconds !== undefined && delaySeconds > 86_400) {
    throw new ValidationError(
      'Cloudflare queue delay must not exceed 24 hours'
    );
  }
};

const jsonBytes = (body: QueueBody): number => {
  let json: string;
  try {
    json = JSON.stringify(body);
  } catch (error) {
    throw new ValidationError('Could not encode Cloudflare queue JSON body', {
      cause: error instanceof Error ? error : new Error('JSON encoding failed'),
    });
  }
  const bytes = new TextEncoder().encode(json).byteLength;
  // Provider metadata also counts toward native limits; passing this check is not an acceptance guarantee.
  if (bytes > 128_000) {
    throw new ValidationError('Cloudflare queue JSON body exceeds 128 KB', {
      context: { limitBytes: 128_000, observedBytes: bytes },
    });
  }
  return bytes;
};

/**
 * Bind portable JSON producers to native Cloudflare Queues.
 * Complete batches validate and snapshot before I/O; empty batches do nothing.
 * Native acceptance does not prove delivery, ordering, atomicity or safe retry.
 *
 * @example
 * ```ts
 * const client = createCloudflareQueueBinding(env['JOBS']);
 * await client.send({ id: 'job-1' }, { delaySeconds: 0 });
 * ```
 */
export const createCloudflareQueueBinding = <
  Body extends QueueBody = QueueBody,
>(
  native: unknown
): QueueProducer<Body> => {
  if (!isQueue(native)) {
    throw new ValidationError(
      'Cloudflare queue binding must provide send and sendBatch'
    );
  }
  return {
    send: async (body, input = {}) => {
      const snapshot = parseBindingArgument(queueBodySchema, body);
      const options = parseBindingArgument(queueSendOptionsSchema, input);
      validateDelay(options.delaySeconds);
      jsonBytes(snapshot);
      await invokeBinding('queue', 'send', () =>
        native.send(snapshot, {
          contentType: 'json',
          ...(options.delaySeconds === undefined
            ? {}
            : { delaySeconds: options.delaySeconds }),
        })
      );
    },
    sendBatch: async (input) => {
      const snapshots = parseBindingArgument(queueBatchSchema, input);
      if (snapshots.length > 100) {
        throw new ValidationError(
          'Cloudflare queue batch must not exceed 100 messages'
        );
      }
      let bytes = 0;
      for (const message of snapshots) {
        validateDelay(message.delaySeconds);
        bytes += jsonBytes(message.body);
      }
      if (bytes > 256_000) {
        throw new ValidationError(
          'Cloudflare queue JSON batch exceeds 256 KB',
          { context: { limitBytes: 256_000, observedBytes: bytes } }
        );
      }
      if (snapshots.length === 0) {
        return;
      }
      await invokeBinding('queue', 'sendBatch', () =>
        native.sendBatch(
          snapshots.map((message) => ({
            body: message.body,
            contentType: 'json',
            ...(message.delaySeconds === undefined
              ? {}
              : { delaySeconds: message.delaySeconds }),
          }))
        )
      );
    },
  };
};
