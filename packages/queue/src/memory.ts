import { ValidationError } from '@ontrails/core';
import type { z } from 'zod';

import {
  queueBatchSchema,
  queueBodySchema,
  queueSendOptionsSchema,
} from './schemas.js';
import type { QueueBody, QueueMessage } from './schemas.js';
import type { QueueMock } from './types.js';

const parseArgument = <T>(schema: z.ZodType<T>, value: unknown): T => {
  try {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError('Invalid queue submission', {
        cause: result.error,
      });
    }
    return result.data;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError('Could not inspect queue submission', {
      cause: error instanceof Error ? error : new Error(String(error)),
    });
  }
};

/**
 * Create an isolated producer recorder. JSON bodies and options are snapshotted
 * before recording and again on inspection. Requested delays are recorded only;
 * the mock never sleeps, delivers, retries, acknowledges, or invokes consumers.
 *
 * @example
 * ```ts
 * const client = createQueueMock<{ id: string }>();
 * await client.send({ id: 'job-1' }, { delaySeconds: 0 });
 * client.messages(); // [{ body: { id: 'job-1' }, delaySeconds: 0 }]
 * ```
 */
export const createQueueMock = <
  Body extends QueueBody = QueueBody,
>(): QueueMock<Body> => {
  const sent: QueueMessage<Body>[] = [];
  return {
    clear: () => {
      sent.length = 0;
    },
    messages: () => structuredClone(sent),
    send: async (body, input = {}) => {
      const snapshot = parseArgument(queueBodySchema, body) as Body;
      const options = parseArgument(queueSendOptionsSchema, input);
      sent.push({
        body: snapshot,
        ...(options.delaySeconds === undefined
          ? {}
          : { delaySeconds: options.delaySeconds }),
      });
    },
    sendBatch: async (messages) => {
      const snapshots = parseArgument(
        queueBatchSchema,
        messages
      ) as QueueMessage<Body>[];
      for (const message of snapshots) {
        sent.push(message);
      }
    },
  };
};
