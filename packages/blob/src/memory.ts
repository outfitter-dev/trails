import { ValidationError, createBlobRef } from '@ontrails/core';
import { z } from 'zod';

import { snapshotBody } from './body.js';
import { blobListOptionsSchema, blobPutOptionsSchema } from './schemas.js';
import type { BlobInfo } from './schemas.js';
import type { BlobStorage } from './types.js';

interface Entry {
  readonly bytes: Uint8Array;
  readonly info: BlobInfo;
}

const keySchema = z.string();
const cursorSchema = z.tuple([z.string(), z.string(), z.string()]);
const parseArgument = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Invalid blob argument', { cause: parsed.error });
  }
  return parsed.data;
};

/**
 * Create isolated in-memory blob storage. Writes snapshot all bytes in memory;
 * this mock has no provider size limits and is unsuitable for unbounded bodies.
 * Stream failure leaves the previous mock value intact, a local mock property
 * rather than a portable rollback guarantee.
 *
 * @example
 * ```ts
 * const client = createBlobMock();
 * await client.put('note', new TextEncoder().encode('hello'));
 * await client.head('note'); // size: 5
 * ```
 */
export const createBlobMock = (): BlobStorage => {
  const entries = new Map<string, Entry>();
  const bindingId = crypto.randomUUID();
  const afterKey = (cursor: string, prefix: string): string => {
    let decoded: unknown;
    try {
      decoded = JSON.parse(decodeURIComponent(cursor));
    } catch {
      throw new ValidationError('Invalid blob cursor');
    }
    const [owner, query, after] = parseArgument(cursorSchema, decoded);
    if (owner !== bindingId || query !== prefix) {
      throw new ValidationError(
        'Blob cursor belongs to another binding or prefix query'
      );
    }
    return after;
  };
  return {
    delete: async (key) => {
      entries.delete(parseArgument(keySchema, key));
    },
    get: async (key) => {
      const entry = entries.get(parseArgument(keySchema, key));
      return entry === undefined
        ? null
        : createBlobRef({
            data: new Uint8Array(entry.bytes),
            mimeType: entry.info.mimeType,
            name: entry.info.key,
            size: entry.info.size,
          });
    },
    head: async (key) => {
      const entry = entries.get(parseArgument(keySchema, key));
      return entry === undefined ? null : { ...entry.info };
    },
    list: async (input = {}) => {
      const {
        cursor,
        limit = 1000,
        prefix = '',
      } = parseArgument(blobListOptionsSchema, input);
      const after = cursor === undefined ? undefined : afterKey(cursor, prefix);
      const names = [...entries.keys()]
        .filter(
          (key) =>
            key.startsWith(prefix) && (after === undefined || key > after)
        )
        .toSorted();
      const keys = names.slice(0, limit);
      const objects = keys.flatMap((key) => {
        const entry = entries.get(key);
        return entry === undefined ? [] : [{ ...entry.info }];
      });
      return keys.length === names.length
        ? { complete: true as const, objects }
        : {
            complete: false as const,
            cursor: encodeURIComponent(
              JSON.stringify([bindingId, prefix, keys.at(-1)])
            ),
            objects,
          };
    },
    put: async (key, data, input = {}) => {
      const validKey = parseArgument(keySchema, key);
      const { mimeType = 'application/octet-stream' } = parseArgument(
        blobPutOptionsSchema,
        input
      );
      const bytes = await snapshotBody(data);
      const info = { key: validKey, mimeType, size: bytes.byteLength };
      entries.set(validKey, { bytes, info });
      return { ...info };
    },
  };
};
