/**
 * Provider-neutral KV resource declarations and their live role identity.
 * @example
 * ```ts
 * import { kv } from '@ontrails/kv';
 * const flags = kv('flags');
 * ```
 */
export { kv } from './resource.js';

/**
 * Types for a KV resource and its annotations.
 * @example
 * ```ts
 * import type { KvResource } from '@ontrails/kv';
 * const roleOf = (definition: KvResource) => definition.role;
 * ```
 */
export type { KvResource, KvResourceOptions } from './resource.js';

/**
 * An isolated memory binding for tests and explicit local overrides.
 * @example
 * ```ts
 * import { createKvMock } from '@ontrails/kv';
 * const client = createKvMock();
 * await client.put('key', 'value');
 * ```
 */
export { createKvMock } from './memory.js';

/**
 * Memory clock injection and the portable client contract.
 * @example
 * ```ts
 * import type { CreateKvMockOptions, Kv } from '@ontrails/kv';
 * const options: CreateKvMockOptions = { now: () => 0 };
 * const read = (client: Kv) => client.get('key');
 * ```
 */
export type { CreateKvMockOptions } from './memory.js';
/**
 * Promise-returning infrastructure client; trail outcomes remain Result values.
 * @example
 * ```ts
 * import type { Kv } from '@ontrails/kv';
 * const read = (client: Kv) => client.get('key');
 * ```
 */
export type { Kv } from './types.js';

/**
 * Canonical schemas for portable arguments and discriminated list pages.
 * @example
 * ```ts
 * import { kvPutOptionsSchema } from '@ontrails/kv';
 * kvPutOptionsSchema.parse({ ttlSeconds: 60 });
 * ```
 */
export {
  kvListOptionsSchema,
  kvListPageSchema,
  kvPutOptionsSchema,
} from './schemas.js';

/**
 * Schema-inferred options and page facts.
 * @example
 * ```ts
 * import type { KvListPage } from '@ontrails/kv';
 * const page: KvListPage = { complete: true, keys: [] };
 * ```
 */
export type { KvListOptions, KvListPage, KvPutOptions } from './schemas.js';
