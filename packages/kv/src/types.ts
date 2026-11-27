import type { KvListOptions, KvListPage, KvPutOptions } from './schemas.js';

/**
 * Provider-neutral string key-value client.
 *
 * Infrastructure methods reject with typed TrailsError failures, matching the
 * store accessor boundary. Trail implementations catch and convert failures to
 * Result.err(); a failed binding must never masquerade as a missing value.
 * Listing promises neither ordering nor a snapshot across pages. Cursors are
 * opaque and local to a binding and prefix query; limit is a maximum.
 */
export interface Kv {
  /** Missing keys resolve to null. */
  get(key: string): Promise<string | null>;
  /** Replace a value; expiry occurs at now >= the TTL deadline. */
  put(key: string, value: string, options?: KvPutOptions): Promise<void>;
  /** Deleting a missing key succeeds. */
  delete(key: string): Promise<void>;
  /** Continue until complete is true, including across short or empty pages. */
  list(options?: KvListOptions): Promise<KvListPage>;
}
