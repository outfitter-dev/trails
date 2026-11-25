import { ValidationError } from '@ontrails/core';
import { z } from 'zod';

import { kvListOptionsSchema, kvPutOptionsSchema } from './schemas.js';
import type { Kv } from './types.js';

/** Clock injection belongs to the memory mock, not the portable binding API. */
export interface CreateKvMockOptions {
  /** Current time in milliseconds. Defaults to Date.now. */
  readonly now?: (() => number) | undefined;
}

interface Entry {
  readonly expiresAt: number | undefined;
  readonly value: string;
}

const cursorSchema = z.tuple([z.string(), z.string(), z.string()]);
const keySchema = z.string();

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError('Invalid KV argument', { cause: parsed.error });
  }
  return parsed.data;
};

/**
 * Create an isolated KV mock with lazy TTL expiry and query-scoped cursors.
 * Provider-specific constraints, such as minimum TTLs, belong to bindings.
 *
 * @example
 * ```ts
 * const client = createKvMock();
 * await client.put('color', 'blue', { ttlSeconds: 60 });
 * await client.get('color'); // 'blue'
 * ```
 */
export const createKvMock = (options: CreateKvMockOptions = {}): Kv => {
  const now = options.now ?? Date.now;
  const entries = new Map<string, Entry>();
  const bindingId = crypto.randomUUID();

  const live = (key: string): Entry | undefined => {
    const entry = entries.get(key);
    if (entry?.expiresAt !== undefined && now() >= entry.expiresAt) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  const afterKey = (cursor: string, prefix: string): string => {
    let decoded: unknown;
    try {
      decoded = JSON.parse(decodeURIComponent(cursor));
    } catch {
      throw new ValidationError('Invalid KV cursor');
    }
    const [owner, query, after] = parse(cursorSchema, decoded);
    if (owner !== bindingId || query !== prefix) {
      throw new ValidationError(
        'KV cursor belongs to another binding or prefix query'
      );
    }
    return after;
  };

  return {
    delete: async (key) => {
      entries.delete(parse(keySchema, key));
    },
    get: async (key) => live(parse(keySchema, key))?.value ?? null,
    list: async (input = {}) => {
      const {
        cursor,
        limit = 1000,
        prefix = '',
      } = parse(kvListOptionsSchema, input);
      const after = cursor === undefined ? undefined : afterKey(cursor, prefix);
      const names = [...entries.keys()]
        .filter((key) => live(key) !== undefined && key.startsWith(prefix))
        .toSorted();
      const remaining = names.filter(
        (key) => after === undefined || key > after
      );
      const keys = remaining.slice(0, limit);
      const complete = keys.length === remaining.length;
      return complete
        ? { complete: true as const, keys }
        : {
            complete: false as const,
            cursor: encodeURIComponent(
              JSON.stringify([bindingId, prefix, keys.at(-1)])
            ),
            keys,
          };
    },
    put: async (key, value, input = {}) => {
      const validKey = parse(keySchema, key);
      const validValue = parse(keySchema, value);
      const { ttlSeconds } = parse(kvPutOptionsSchema, input);
      const expiresAt =
        ttlSeconds === undefined ? undefined : now() + ttlSeconds * 1000;
      if (expiresAt !== undefined && !Number.isSafeInteger(expiresAt)) {
        throw new ValidationError('KV TTL exceeds the supported expiry range');
      }
      entries.set(validKey, { expiresAt, value: validValue });
    },
  };
};
