import type { BlobRef } from '@ontrails/core';

import type {
  BlobInfo,
  BlobListOptions,
  BlobListPage,
  BlobPutOptions,
} from './schemas.js';

/**
 * Provider-neutral object storage. Infrastructure failures reject with a
 * TrailsError; consuming trails convert failures to Result outcomes.
 * Keys are used exactly. Reads use the key as BlobRef.name. Each read owns
 * independent bytes or a fresh stream; head and list never consume bodies.
 * Writes consume streams once and resolve only after completing the write.
 * Failures do not promise rollback or prove that the provider stored nothing.
 * Providers may enforce documented size/key limits without narrowing body types.
 */
export interface BlobStorage {
  readonly get: (key: string) => Promise<BlobRef | null>;
  readonly head: (key: string) => Promise<BlobInfo | null>;
  readonly put: (
    key: string,
    data: BlobRef['data'],
    options?: BlobPutOptions
  ) => Promise<BlobInfo>;
  readonly delete: (key: string) => Promise<void>;
  readonly list: (options?: BlobListOptions) => Promise<BlobListPage>;
}
