import { ValidationError, createBlobRef } from '@ontrails/core';
import {
  blobInfoSchema,
  blobListOptionsSchema,
  blobPutOptionsSchema,
} from '@ontrails/blob';
import type { BlobInfo, BlobStorage } from '@ontrails/blob';
import { z } from 'zod';

import { createBindingCursor } from '../binding-cursor.js';
import {
  invalidBindingResponse,
  invokeBinding,
  parseBindingArgument,
  parseBindingResponse,
} from '../binding-errors.js';
import { bufferBlobStream, wrapBlobReadStream } from './binding-body.js';
import type { CloudflareR2Bucket } from './index.js';

const optionsSchema = z.strictObject({
  maxBufferedBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
/** Explicit accumulated stream payload cap in bytes; no default or RSS/concurrency bound. */
export type CloudflareBlobBindingOptions = z.infer<typeof optionsSchema>;
const keySchema = z.string();
const nativeInfoSchema = z.object({
  httpMetadata: z
    .object({ contentType: blobInfoSchema.shape.mimeType.optional() })
    .optional(),
  key: blobInfoSchema.shape.key,
  size: blobInfoSchema.shape.size,
});
const nativePageSchema = z.object({
  cursor: z.string().optional(),
  objects: z.array(nativeInfoSchema),
  truncated: z.boolean(),
});
const toInfo = (object: z.infer<typeof nativeInfoSchema>): BlobInfo => ({
  key: object.key,
  mimeType: object.httpMetadata?.contentType ?? 'application/octet-stream',
  size: object.size,
});
const infoFor = (value: unknown, operation: string, key: string): BlobInfo => {
  const info = toInfo(
    parseBindingResponse(nativeInfoSchema, value, 'blob', operation)
  );
  if (info.key !== key) {
    throw invalidBindingResponse('blob', operation);
  }
  return info;
};
const isBucket = (value: unknown): value is CloudflareR2Bucket =>
  typeof value === 'object' &&
  value !== null &&
  'get' in value &&
  typeof value.get === 'function' &&
  'head' in value &&
  typeof value.head === 'function' &&
  'put' in value &&
  typeof value.put === 'function' &&
  'delete' in value &&
  typeof value.delete === 'function' &&
  'list' in value &&
  typeof value.list === 'function';

/**
 * Bind portable blob storage to R2 with an explicit bounded stream-write bridge.
 * Byte arrays use native put directly. Reads preserve native size/MIME and key names.
 * The stream cap does not bound RSS, final-copy/native overhead or concurrency.
 *
 * @example
 * ```ts
 * const client = createCloudflareBlobBinding(env['BUCKET'], { maxBufferedBytes: 1_048_576 });
 * await client.put('file', new Uint8Array([1, 2]));
 * ```
 */
export const createCloudflareBlobBinding = (
  bucket: unknown,
  options: CloudflareBlobBindingOptions
): BlobStorage => {
  const { maxBufferedBytes } = parseBindingArgument(optionsSchema, options);
  if (!isBucket(bucket)) {
    throw new ValidationError(
      'Cloudflare blob binding must provide get, head, put, delete and list'
    );
  }
  const cursors = createBindingCursor('blob');
  return {
    delete: async (key) => {
      const validKey = parseBindingArgument(keySchema, key);
      await invokeBinding('blob', 'delete', () => bucket.delete(validKey));
    },
    get: async (key) => {
      const validKey = parseBindingArgument(keySchema, key);
      const object = await invokeBinding('blob', 'get', () =>
        bucket.get(validKey)
      );
      if (object === null) {
        return null;
      }
      const info = infoFor(object, 'get', validKey);
      if (!('body' in object) || !(object.body instanceof ReadableStream)) {
        throw invalidBindingResponse('blob', 'get');
      }
      return createBlobRef({
        data: wrapBlobReadStream(object.body),
        mimeType: info.mimeType,
        name: info.key,
        size: info.size,
      });
    },
    head: async (key) => {
      const validKey = parseBindingArgument(keySchema, key);
      const object = await invokeBinding('blob', 'head', () =>
        bucket.head(validKey)
      );
      return object === null ? null : infoFor(object, 'head', validKey);
    },
    list: async (input = {}) => {
      const {
        cursor,
        limit = 1000,
        prefix = '',
      } = parseBindingArgument(blobListOptionsSchema, input);
      if (limit > 1000) {
        throw new ValidationError(
          'Cloudflare blob list limit must not exceed 1000'
        );
      }
      const nativeCursor = cursors.decode(cursor, prefix);
      const value = await invokeBinding('blob', 'list', () =>
        bucket.list({
          include: ['httpMetadata'],
          limit,
          prefix,
          ...(nativeCursor === undefined ? {} : { cursor: nativeCursor }),
        })
      );
      const page = parseBindingResponse(
        nativePageSchema,
        value,
        'blob',
        'list'
      );
      if (
        page.objects.length > limit ||
        page.objects.some((object) => !object.key.startsWith(prefix))
      ) {
        throw invalidBindingResponse('blob', 'list');
      }
      const objects = page.objects.map(toInfo);
      if (!page.truncated) {
        return { complete: true, objects };
      }
      if (page.cursor === undefined || page.cursor.length === 0) {
        throw invalidBindingResponse('blob', 'list');
      }
      return {
        complete: false,
        cursor: cursors.encode(prefix, page.cursor),
        objects,
      };
    },
    put: async (key, data, input = {}) => {
      const validKey = parseBindingArgument(keySchema, key);
      const { mimeType = 'application/octet-stream' } = parseBindingArgument(
        blobPutOptionsSchema,
        input
      );
      if (!(data instanceof Uint8Array) && !(data instanceof ReadableStream)) {
        throw new ValidationError(
          'Cloudflare blob body must be bytes or a readable byte stream'
        );
      }
      const bytes =
        data instanceof Uint8Array
          ? data
          : await bufferBlobStream(data, maxBufferedBytes);
      const value = await invokeBinding('blob', 'put', () =>
        bucket.put(validKey, bytes, { httpMetadata: { contentType: mimeType } })
      );
      const info = infoFor(value, 'put', validKey);
      if (info.size !== bytes.byteLength || info.mimeType !== mimeType) {
        throw invalidBindingResponse('blob', 'put');
      }
      return info;
    },
  };
};
