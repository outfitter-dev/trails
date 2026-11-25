import { ValidationError } from '@ontrails/core';
import { kvListOptionsSchema, kvPutOptionsSchema } from '@ontrails/kv';
import type { Kv } from '@ontrails/kv';
import { z } from 'zod';

import { createBindingCursor } from '../binding-cursor.js';
import {
  invalidBindingResponse,
  invokeBinding,
  parseBindingArgument,
  parseBindingResponse,
} from '../binding-errors.js';
import type { CloudflareKv } from './index.js';

const stringSchema = z.string();
const getSchema = stringSchema.nullable();
const nativePageSchema = z.object({
  cursor: z.string().optional(),
  keys: z.array(z.object({ name: z.string() })),
  list_complete: z.boolean(),
});
const isNamespace = (value: unknown): value is CloudflareKv =>
  typeof value === 'object' &&
  value !== null &&
  'get' in value &&
  typeof value.get === 'function' &&
  'put' in value &&
  typeof value.put === 'function' &&
  'delete' in value &&
  typeof value.delete === 'function' &&
  'list' in value &&
  typeof value.list === 'function';

/**
 * Bind the portable KV contract to a classic Workers KV namespace.
 * Native TTLs below 60 seconds and list limits above 1000 are rejected explicitly.
 * Cursors belong to this client and prefix, not another factory invocation.
 *
 * @example
 * ```ts
 * const client = createCloudflareKvBinding(env['FLAGS']);
 * await client.put('color', 'blue', { ttlSeconds: 60 });
 * ```
 */
export const createCloudflareKvBinding = (namespace: unknown): Kv => {
  if (!isNamespace(namespace)) {
    throw new ValidationError(
      'Cloudflare KV binding must provide get, put, delete and list'
    );
  }
  const cursors = createBindingCursor('kv');
  return {
    delete: async (key) => {
      const validKey = parseBindingArgument(stringSchema, key);
      await invokeBinding('kv', 'delete', () => namespace.delete(validKey));
    },
    get: async (key) => {
      const validKey = parseBindingArgument(stringSchema, key);
      const value = await invokeBinding('kv', 'get', () =>
        namespace.get(validKey)
      );
      return parseBindingResponse(getSchema, value, 'kv', 'get');
    },
    list: async (input = {}) => {
      const {
        cursor,
        limit = 1000,
        prefix = '',
      } = parseBindingArgument(kvListOptionsSchema, input);
      if (limit > 1000) {
        throw new ValidationError(
          'Cloudflare KV list limit must not exceed 1000'
        );
      }
      const nativeCursor = cursors.decode(cursor, prefix);
      const value = await invokeBinding('kv', 'list', () =>
        namespace.list({
          limit,
          prefix,
          ...(nativeCursor === undefined ? {} : { cursor: nativeCursor }),
        })
      );
      const page = parseBindingResponse(nativePageSchema, value, 'kv', 'list');
      if (
        page.keys.length > limit ||
        page.keys.some(({ name }) => !name.startsWith(prefix))
      ) {
        throw invalidBindingResponse('kv', 'list');
      }
      const keys = page.keys.map(({ name }) => name);
      if (page.list_complete) {
        return { complete: true, keys };
      }
      if (page.cursor === undefined || page.cursor.length === 0) {
        throw invalidBindingResponse('kv', 'list');
      }
      return {
        complete: false,
        cursor: cursors.encode(prefix, page.cursor),
        keys,
      };
    },
    put: async (key, value, input = {}) => {
      const validKey = parseBindingArgument(stringSchema, key);
      const validValue = parseBindingArgument(stringSchema, value);
      const { ttlSeconds } = parseBindingArgument(kvPutOptionsSchema, input);
      if (
        ttlSeconds !== undefined &&
        (ttlSeconds < 60 ||
          !Number.isSafeInteger(Date.now() + ttlSeconds * 1000))
      ) {
        throw new ValidationError(
          'Cloudflare KV TTL must be at least 60 seconds within the supported expiry range'
        );
      }
      await invokeBinding('kv', 'put', () =>
        namespace.put(
          validKey,
          validValue,
          ttlSeconds === undefined ? undefined : { expirationTtl: ttlSeconds }
        )
      );
    },
  };
};
