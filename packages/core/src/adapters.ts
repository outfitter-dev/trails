import type { Result } from './result.js';

// ---------------------------------------------------------------------------
// Shared option types
// ---------------------------------------------------------------------------

/** Options for search queries */
export interface SearchOptions {
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly filters?: Readonly<Record<string, unknown>> | undefined;
}

/** A single search hit */
export interface SearchResult {
  readonly id: string;
  readonly score: number;
  readonly document: Readonly<Record<string, unknown>>;
}

/** Options for storage writes */
export interface StorageOptions {
  /** Time-to-live in milliseconds */
  readonly ttl?: number | undefined;
}

// ---------------------------------------------------------------------------
// Adapter port interfaces
// ---------------------------------------------------------------------------

/** Full-text / vector index adapter */
export interface IndexAdapter {
  index(
    id: string,
    document: Readonly<Record<string, unknown>>
  ): Promise<Result<void, Error>>;

  search(
    query: string,
    options?: SearchOptions
  ): Promise<Result<readonly SearchResult[], Error>>;

  remove(id: string): Promise<Result<void, Error>>;
}

/** Key-value storage adapter */
export interface StorageAdapter {
  get(key: string): Promise<Result<unknown, Error>>;
  set(
    key: string,
    value: unknown,
    options?: StorageOptions
  ): Promise<Result<void, Error>>;
  delete(key: string): Promise<Result<void, Error>>;
  has(key: string): Promise<Result<boolean, Error>>;
}

/** Cache adapter with typed get/set and bulk clear */
export interface CacheAdapter {
  get<T>(key: string): Promise<Result<T | undefined, Error>>;
  set<T>(
    key: string,
    value: T,
    options?: StorageOptions
  ): Promise<Result<void, Error>>;
  delete(key: string): Promise<Result<void, Error>>;
  clear(): Promise<Result<void, Error>>;
}
