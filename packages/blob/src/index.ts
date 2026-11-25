/**
 * Declare provider-neutral blob resources with default test mocks.
 * @example
 * ```ts
 * import { blob } from '@ontrails/blob';
 * const uploads = blob('uploads');
 * ```
 */
export { blob } from './resource.js';
/**
 * Resource definitions and annotations for portable blob storage.
 * @example
 * ```ts
 * import type { BlobResource } from '@ontrails/blob';
 * const roleOf = (definition: BlobResource) => definition.role;
 * ```
 */
export type { BlobResource, BlobResourceOptions } from './resource.js';
/**
 * Isolated in-memory bindings for tests and explicit local overrides.
 * @example
 * ```ts
 * import { createBlobMock } from '@ontrails/blob';
 * const client = createBlobMock();
 * ```
 */
export { createBlobMock } from './memory.js';
/**
 * Promise-returning infrastructure client; trail outcomes remain Result values.
 * @example
 * ```ts
 * import type { BlobStorage } from '@ontrails/blob';
 * const read = (client: BlobStorage) => client.get('key');
 * ```
 */
export type { BlobStorage } from './types.js';
/**
 * Canonical schemas for stored metadata, write options, and list pages.
 * @example
 * ```ts
 * import { blobInfoSchema } from '@ontrails/blob';
 * blobInfoSchema.parse({ key: 'empty', size: 0, mimeType: 'text/plain' });
 * ```
 */
export {
  blobInfoSchema,
  blobListOptionsSchema,
  blobListPageSchema,
  blobPutOptionsSchema,
} from './schemas.js';
/**
 * Schema-inferred portable metadata and options.
 * @example
 * ```ts
 * import type { BlobInfo } from '@ontrails/blob';
 * const info: BlobInfo = { key: 'empty', size: 0, mimeType: 'text/plain' };
 * ```
 */
export type {
  BlobInfo,
  BlobListOptions,
  BlobListPage,
  BlobPutOptions,
} from './schemas.js';
