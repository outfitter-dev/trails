/**
 * Cloudflare R2 blob/object resource for Trails.
 *
 * `cloudflareR2` authors an ordinary resource definition for an R2 bucket
 * binding. Trails can store and fetch object bytes through the standard
 * resource accessor, then return `BlobRef` values when HTTP/MCP surfaces should
 * render the fetched object as binary output.
 */

import {
  InternalError,
  Result,
  ValidationError,
  createBlobRef,
  resource,
} from '@ontrails/core';
import type { BlobRef, Resource } from '@ontrails/core';

import { registerEnvBinding } from '../env.js';

// ---------------------------------------------------------------------------
// Binding shape
// ---------------------------------------------------------------------------

export type CloudflareR2StorageClass = 'Standard' | 'InfrequentAccess';

export type CloudflareR2PutBody =
  | ArrayBuffer
  | ArrayBufferView
  | Blob
  | ReadableStream<Uint8Array>
  | string
  | null;

export interface CloudflareR2HttpMetadata {
  readonly cacheControl?: string | undefined;
  readonly cacheExpiry?: Date | undefined;
  readonly contentDisposition?: string | undefined;
  readonly contentEncoding?: string | undefined;
  readonly contentLanguage?: string | undefined;
  readonly contentType?: string | undefined;
}

export interface CloudflareR2Conditional {
  readonly etagDoesNotMatch?: string | undefined;
  readonly etagMatches?: string | undefined;
  readonly uploadedAfter?: Date | undefined;
  readonly uploadedBefore?: Date | undefined;
}

export type CloudflareR2Range =
  | {
      readonly length?: number | undefined;
      readonly offset: number;
      readonly suffix?: never;
    }
  | {
      readonly length: number;
      readonly offset?: number | undefined;
      readonly suffix?: never;
    }
  | {
      readonly length?: never;
      readonly offset?: never;
      readonly suffix: number;
    };

export interface CloudflareR2GetOptions {
  readonly onlyIf?: CloudflareR2Conditional | Headers | undefined;
  readonly range?: CloudflareR2Range | undefined;
  /** Accepted by the memory mock but enforced only by real R2 bindings. */
  readonly ssecKey?: ArrayBuffer | string | undefined;
}

export interface CloudflareR2PutOptions {
  readonly customMetadata?: Readonly<Record<string, string>> | undefined;
  readonly httpMetadata?: CloudflareR2HttpMetadata | Headers | undefined;
  readonly md5?: ArrayBuffer | string | undefined;
  readonly onlyIf?: CloudflareR2Conditional | Headers | undefined;
  readonly sha1?: ArrayBuffer | string | undefined;
  readonly sha256?: ArrayBuffer | string | undefined;
  readonly sha384?: ArrayBuffer | string | undefined;
  readonly sha512?: ArrayBuffer | string | undefined;
  /** Accepted by the memory mock but enforced only by real R2 bindings. */
  readonly ssecKey?: ArrayBuffer | string | undefined;
  readonly storageClass?: CloudflareR2StorageClass | undefined;
}

export interface CloudflareR2ListOptions {
  readonly cursor?: string | undefined;
  readonly delimiter?: string | undefined;
  readonly include?: readonly ('customMetadata' | 'httpMetadata')[] | undefined;
  readonly limit?: number | undefined;
  readonly prefix?: string | undefined;
  readonly startAfter?: string | undefined;
}

export interface CloudflareR2Object {
  readonly customMetadata: Readonly<Record<string, string>>;
  readonly etag: string;
  readonly httpEtag: string;
  readonly httpMetadata: CloudflareR2HttpMetadata;
  readonly key: string;
  readonly range?: CloudflareR2Range | undefined;
  readonly ssecKeyMd5?: string | undefined;
  readonly size: number;
  readonly storageClass?: CloudflareR2StorageClass | undefined;
  readonly uploaded: Date;
  readonly version: string;
  writeHttpMetadata(headers: Headers): void;
}

export interface CloudflareR2ListedObject extends Omit<
  CloudflareR2Object,
  'customMetadata' | 'httpMetadata'
> {
  readonly customMetadata?: Readonly<Record<string, string>> | undefined;
  readonly httpMetadata?: CloudflareR2HttpMetadata | undefined;
}

export interface CloudflareR2ObjectBody extends CloudflareR2Object {
  readonly body: ReadableStream<Uint8Array>;
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob(): Promise<Blob>;
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
}

export interface CloudflareR2Objects {
  readonly cursor?: string | undefined;
  readonly delimitedPrefixes?: readonly string[] | undefined;
  readonly objects: readonly CloudflareR2ListedObject[];
  readonly truncated: boolean;
}

/**
 * Structural subset of a Cloudflare R2 bucket binding.
 */
export interface CloudflareR2Bucket {
  delete(key: string | readonly string[]): Promise<void>;
  get(
    key: string,
    options?: CloudflareR2GetOptions
  ): Promise<CloudflareR2ObjectBody | CloudflareR2Object | null>;
  head(key: string): Promise<CloudflareR2Object | null>;
  list(options?: CloudflareR2ListOptions): Promise<CloudflareR2Objects>;
  put(
    key: string,
    value: CloudflareR2PutBody,
    options?: CloudflareR2PutOptions
  ): Promise<CloudflareR2Object | null>;
}

export interface MemoryCloudflareR2Bucket extends CloudflareR2Bucket {
  clear(): void;
}

// ---------------------------------------------------------------------------
// In-memory mock
// ---------------------------------------------------------------------------

interface MemoryR2Entry {
  readonly bytes: Uint8Array;
  readonly customMetadata: Readonly<Record<string, string>>;
  readonly etag: string;
  readonly httpMetadata: CloudflareR2HttpMetadata;
  readonly key: string;
  readonly storageClass?: CloudflareR2StorageClass | undefined;
  readonly uploaded: Date;
  readonly version: string;
}

const DEFAULT_LIST_LIMIT = 1000;
const MAX_LIST_LIMIT = 1000;
const MAX_MULTI_DELETE_KEYS = 1000;
const DEFAULT_BLOB_MIME_TYPE = 'application/octet-stream';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const isBlobValue = (value: unknown): value is Blob =>
  typeof Blob !== 'undefined' && value instanceof Blob;

const isHeadersValue = (value: unknown): value is Headers =>
  typeof Headers !== 'undefined' && value instanceof Headers;

const copyBytes = (bytes: Uint8Array): Uint8Array => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
};

const readStream = async (
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const read = await reader.read();
    if (read.done) {
      break;
    }
    chunks.push(read.value);
    size += read.value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const normalizePutBody = async (
  value: CloudflareR2PutBody
): Promise<Uint8Array> => {
  if (value === null) {
    return new Uint8Array();
  }
  if (typeof value === 'string') {
    return encoder.encode(value);
  }
  if (isBlobValue(value)) {
    return new Uint8Array(await value.arrayBuffer());
  }
  if (value instanceof ArrayBuffer) {
    return copyBytes(new Uint8Array(value));
  }
  if (ArrayBuffer.isView(value)) {
    return copyBytes(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    );
  }
  return readStream(value);
};

const normalizeHttpMetadata = (
  metadata: CloudflareR2PutOptions['httpMetadata']
): CloudflareR2HttpMetadata => {
  if (metadata === undefined) {
    return {};
  }
  if (isHeadersValue(metadata)) {
    const normalized: {
      cacheControl?: string;
      cacheExpiry?: Date;
      contentDisposition?: string;
      contentEncoding?: string;
      contentLanguage?: string;
      contentType?: string;
    } = {};
    const cacheControl = metadata.get('cache-control');
    const contentDisposition = metadata.get('content-disposition');
    const contentEncoding = metadata.get('content-encoding');
    const contentLanguage = metadata.get('content-language');
    const contentType = metadata.get('content-type');
    const expires = metadata.get('expires');
    if (cacheControl !== null) {
      normalized.cacheControl = cacheControl;
    }
    if (contentDisposition !== null) {
      normalized.contentDisposition = contentDisposition;
    }
    if (contentEncoding !== null) {
      normalized.contentEncoding = contentEncoding;
    }
    if (contentLanguage !== null) {
      normalized.contentLanguage = contentLanguage;
    }
    if (contentType !== null) {
      normalized.contentType = contentType;
    }
    if (expires !== null) {
      normalized.cacheExpiry = new Date(expires);
    }
    return normalized;
  }
  return { ...metadata };
};

const writeHttpMetadata = (
  headers: Headers,
  metadata: CloudflareR2HttpMetadata
): void => {
  if (metadata.cacheControl !== undefined) {
    headers.set('Cache-Control', metadata.cacheControl);
  }
  if (metadata.cacheExpiry !== undefined) {
    headers.set('Expires', metadata.cacheExpiry.toUTCString());
  }
  if (metadata.contentDisposition !== undefined) {
    headers.set('Content-Disposition', metadata.contentDisposition);
  }
  if (metadata.contentEncoding !== undefined) {
    headers.set('Content-Encoding', metadata.contentEncoding);
  }
  if (metadata.contentLanguage !== undefined) {
    headers.set('Content-Language', metadata.contentLanguage);
  }
  if (metadata.contentType !== undefined) {
    headers.set('Content-Type', metadata.contentType);
  }
};

const createEtag = (bytes: Uint8Array, version: number): string => {
  let checksum = 0;
  for (const [index, byte] of bytes.entries()) {
    checksum = (checksum + byte * (index + 1)) % Number.MAX_SAFE_INTEGER;
  }
  return `${version.toString(16)}-${bytes.byteLength.toString(16)}-${checksum.toString(16)}`;
};

const objectMetadata = (entry: MemoryR2Entry): CloudflareR2Object => ({
  customMetadata: Object.freeze({ ...entry.customMetadata }),
  etag: entry.etag,
  httpEtag: `"${entry.etag}"`,
  httpMetadata: { ...entry.httpMetadata },
  key: entry.key,
  size: entry.bytes.byteLength,
  ...(entry.storageClass === undefined
    ? {}
    : { storageClass: entry.storageClass }),
  uploaded: new Date(entry.uploaded),
  version: entry.version,
  writeHttpMetadata(headers) {
    writeHttpMetadata(headers, entry.httpMetadata);
  },
});

const listedObjectMetadata = (
  entry: MemoryR2Entry,
  include: CloudflareR2ListOptions['include']
): CloudflareR2ListedObject => {
  const includeCustomMetadata = include?.includes('customMetadata') ?? false;
  const includeHttpMetadata = include?.includes('httpMetadata') ?? false;
  return {
    etag: entry.etag,
    httpEtag: `"${entry.etag}"`,
    key: entry.key,
    size: entry.bytes.byteLength,
    ...(entry.storageClass === undefined
      ? {}
      : { storageClass: entry.storageClass }),
    uploaded: new Date(entry.uploaded),
    version: entry.version,
    writeHttpMetadata(headers) {
      if (includeHttpMetadata) {
        writeHttpMetadata(headers, entry.httpMetadata);
      }
    },
    ...(includeCustomMetadata
      ? { customMetadata: Object.freeze({ ...entry.customMetadata }) }
      : {}),
    ...(includeHttpMetadata ? { httpMetadata: { ...entry.httpMetadata } } : {}),
  };
};

const bodyConsumedError = (): TypeError =>
  new TypeError('R2 object body has already been consumed');

const objectBody = (entry: MemoryR2Entry): CloudflareR2ObjectBody => {
  let bodyUsed = false;
  const consume = (): Uint8Array => {
    if (bodyUsed) {
      throw bodyConsumedError();
    }
    bodyUsed = true;
    return copyBytes(entry.bytes);
  };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        try {
          controller.enqueue(consume());
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    },
    { highWaterMark: 0 }
  );
  const arrayBuffer = async (): Promise<ArrayBuffer> => {
    const bytes = consume();
    return bytes.buffer as ArrayBuffer;
  };
  const text = async (): Promise<string> =>
    decoder.decode(new Uint8Array(await arrayBuffer()));
  return {
    ...objectMetadata(entry),
    arrayBuffer,
    blob: async () => {
      const bytes = consume();
      return new Blob([bytes.buffer as ArrayBuffer], {
        type: entry.httpMetadata.contentType ?? DEFAULT_BLOB_MIME_TYPE,
      });
    },
    body,
    get bodyUsed() {
      return bodyUsed;
    },
    json: async <T = unknown>() => JSON.parse(await text()) as T,
    text,
  };
};

type MemoryR2ListItem =
  | { readonly kind: 'object'; readonly key: string }
  | { readonly kind: 'prefix'; readonly key: string };

const compareR2Keys = (left: string, right: string): number => {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftBytes[index] ?? 0) - (rightBytes[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return leftBytes.length - rightBytes.length;
};

const compareListItemKinds = (
  left: MemoryR2ListItem['kind'],
  right: MemoryR2ListItem['kind']
): number => {
  if (left === right) {
    return 0;
  }
  return left === 'object' ? -1 : 1;
};

const compareListItems = (
  left: MemoryR2ListItem,
  right: MemoryR2ListItem
): number =>
  compareR2Keys(left.key, right.key) ||
  compareListItemKinds(left.kind, right.kind);

const listItems = (
  entries: ReadonlyMap<string, MemoryR2Entry>,
  options: CloudflareR2ListOptions | undefined
): readonly MemoryR2ListItem[] => {
  const prefix = options?.prefix ?? '';
  const delimiter = options?.delimiter;
  const prefixes = new Set<string>();
  const items: MemoryR2ListItem[] = [];
  for (const name of entries.keys()) {
    if (!name.startsWith(prefix)) {
      continue;
    }
    if (delimiter !== undefined && delimiter.length > 0) {
      const remainder = name.slice(prefix.length);
      const delimiterIndex = remainder.indexOf(delimiter);
      if (delimiterIndex !== -1) {
        const delimitedPrefix = name.slice(0, prefix.length + delimiterIndex);
        if (!prefixes.has(delimitedPrefix)) {
          prefixes.add(delimitedPrefix);
          items.push({ key: delimitedPrefix, kind: 'prefix' });
        }
        continue;
      }
    }
    items.push({ key: name, kind: 'object' });
  }
  return items.toSorted(compareListItems);
};

/**
 * Create an in-memory R2 bucket binding.
 *
 * This is the mock behind `cloudflareR2`, exported for tests that want a
 * bucket without a Workers runtime.
 *
 * @example
 * ```ts
 * import { createMemoryR2 } from '@ontrails/cloudflare/r2';
 *
 * const bucket = createMemoryR2();
 * await bucket.put('notes.txt', 'hello', {
 *   httpMetadata: { contentType: 'text/plain' },
 * });
 * await (await bucket.get('notes.txt'))?.text(); // 'hello'
 * ```
 */
export const createMemoryR2 = (): MemoryCloudflareR2Bucket => {
  const entries = new Map<string, MemoryR2Entry>();
  const cursorPositions = new Map<string, MemoryR2ListItem>();
  let version = 0;

  return {
    clear() {
      entries.clear();
      cursorPositions.clear();
    },
    delete: (key) => {
      const keys = Array.isArray(key) ? key : [key];
      if (keys.length > MAX_MULTI_DELETE_KEYS) {
        return Promise.reject(
          new ValidationError(
            `Cloudflare R2 deletes accept at most ${String(MAX_MULTI_DELETE_KEYS)} keys per call; received ${String(keys.length)}. Chunk larger deletes before invoking the bucket.`
          )
        );
      }
      for (const name of keys) {
        entries.delete(name);
      }
      return Promise.resolve();
    },
    get: (key) => {
      const entry = entries.get(key);
      return Promise.resolve(entry === undefined ? null : objectBody(entry));
    },
    head: (key) => {
      const entry = entries.get(key);
      return Promise.resolve(
        entry === undefined ? null : objectMetadata(entry)
      );
    },
    list: (options) => {
      const limit = Math.min(
        MAX_LIST_LIMIT,
        Math.max(1, options?.limit ?? DEFAULT_LIST_LIMIT)
      );
      const items = listItems(entries, options);
      const decodedCursor =
        options?.cursor === undefined
          ? undefined
          : cursorPositions.get(options.cursor);
      const startIndex = items.findIndex((item) => {
        if (decodedCursor !== undefined) {
          return compareListItems(item, decodedCursor) > 0;
        }
        const keyLowerBound = options?.cursor ?? options?.startAfter;
        return (
          keyLowerBound === undefined ||
          compareR2Keys(item.key, keyLowerBound) > 0
        );
      });
      const pageStart = startIndex === -1 ? items.length : startIndex;
      const page = items.slice(pageStart, pageStart + limit);
      const truncated = pageStart + page.length < items.length;
      const lastItem = page.at(-1);
      const cursor =
        truncated && lastItem !== undefined ? crypto.randomUUID() : undefined;
      if (cursor !== undefined && lastItem !== undefined) {
        cursorPositions.set(cursor, lastItem);
      }
      return Promise.resolve({
        ...(cursor === undefined ? {} : { cursor }),
        delimitedPrefixes: page.flatMap((item) =>
          item.kind === 'prefix' ? [item.key] : []
        ),
        objects: page.flatMap((item) => {
          if (item.kind === 'prefix') {
            return [];
          }
          const entry = entries.get(item.key);
          return entry === undefined
            ? []
            : [listedObjectMetadata(entry, options?.include)];
        }),
        truncated,
      });
    },
    put: async (key, value, options) => {
      version += 1;
      const bytes = await normalizePutBody(value);
      const etag = createEtag(bytes, version);
      const entry: MemoryR2Entry = {
        bytes,
        customMetadata: Object.freeze({ ...options?.customMetadata }),
        etag,
        httpMetadata: normalizeHttpMetadata(options?.httpMetadata),
        key,
        ...(options?.storageClass === undefined
          ? {}
          : { storageClass: options.storageClass }),
        uploaded: new Date(),
        version: String(version),
      };
      entries.set(key, entry);
      return objectMetadata(entry);
    },
  };
};

// ---------------------------------------------------------------------------
// BlobRef bridge
// ---------------------------------------------------------------------------

/** Options for {@link r2ObjectToBlobRef}. */
export interface R2ObjectToBlobRefOptions {
  readonly mimeType?: string | undefined;
  readonly name?: string | undefined;
}

const returnedObjectSize = (object: CloudflareR2ObjectBody): number => {
  const { range } = object;
  if (range === undefined) {
    return object.size;
  }
  if (range.length !== undefined) {
    const offset = range.offset ?? 0;
    return Math.min(
      Math.max(0, range.length),
      Math.max(0, object.size - offset)
    );
  }
  if (range.suffix !== undefined) {
    return Math.min(Math.max(0, range.suffix), object.size);
  }
  return Math.max(0, object.size - (range.offset ?? 0));
};

/**
 * Convert a fetched R2 object body into a core BlobRef.
 *
 * @example
 * ```ts
 * import { r2ObjectToBlobRef } from '@ontrails/cloudflare/r2';
 *
 * const object = await bucket.get('report.pdf');
 * if (object !== null && 'body' in object) {
 *   return Result.ok(r2ObjectToBlobRef(object));
 * }
 * ```
 */
export const r2ObjectToBlobRef = (
  object: CloudflareR2ObjectBody,
  options: R2ObjectToBlobRefOptions = {}
): BlobRef =>
  createBlobRef({
    data: object.body,
    mimeType:
      options.mimeType ??
      object.httpMetadata.contentType ??
      DEFAULT_BLOB_MIME_TYPE,
    name: options.name ?? object.key,
    size: returnedObjectSize(object),
  });

// ---------------------------------------------------------------------------
// Resource factory
// ---------------------------------------------------------------------------

/** Options for {@link cloudflareR2}. */
export interface CloudflareR2Options {
  /** The wrangler binding name (an `r2_buckets` entry's `binding`). */
  readonly binding: string;
  readonly description?: string | undefined;
  readonly meta?: Readonly<Record<string, unknown>> | undefined;
}

const isR2BucketBinding = (value: unknown): value is CloudflareR2Bucket => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<Record<keyof CloudflareR2Bucket, unknown>>;
  return (
    typeof candidate.get === 'function' &&
    typeof candidate.put === 'function' &&
    typeof candidate.delete === 'function' &&
    typeof candidate.head === 'function' &&
    typeof candidate.list === 'function'
  );
};

/**
 * Author a Trails resource wrapping a Cloudflare R2 bucket binding.
 *
 * The real R2 binding arrives through the Workers env bridge. The resource
 * mock stores object bytes in memory so trails work in `testAll`.
 *
 * @example
 * ```ts
 * import { NotFoundError, Result, blobRefSchema, trail } from '@ontrails/core';
 * import { cloudflareR2, r2ObjectToBlobRef } from '@ontrails/cloudflare/r2';
 * import { z } from 'zod';
 *
 * const assets = cloudflareR2('assets', { binding: 'ASSETS' });
 *
 * const readAsset = trail('asset.read', {
 *   implementation: async (input, ctx) => {
 *     const object = await assets.from(ctx).get(input.key);
 *     if (object === null || !('body' in object)) {
 *       return Result.err(new NotFoundError(`Asset "${input.key}" not found`));
 *     }
 *     return Result.ok(r2ObjectToBlobRef(object));
 *   },
 *   input: z.object({ key: z.string() }),
 *   output: blobRefSchema,
 *   resources: [assets],
 * });
 * ```
 */
export const cloudflareR2 = (
  id: string,
  options: CloudflareR2Options
): Resource<CloudflareR2Bucket> => {
  const definition = resource<CloudflareR2Bucket>(id, {
    create: () =>
      Result.err(
        new InternalError(
          `Resource "${id}" wraps Cloudflare R2 binding "${options.binding}", which only exists on a Workers env. Serve the topo with createWorkersHandler from @ontrails/cloudflare/workers, or rely on the in-memory mock in tests.`,
          { context: { binding: options.binding, resourceId: id } }
        )
      ),
    description:
      options.description ??
      `Cloudflare R2 bucket bound to "${options.binding}"`,
    meta: {
      ...options.meta,
      'cloudflare.binding': options.binding,
      'cloudflare.service': 'r2',
    },
    mock: () => createMemoryR2(),
  });
  registerEnvBinding(definition, {
    binding: options.binding,
    fromEnv: (value) =>
      isR2BucketBinding(value)
        ? Result.ok(value)
        : Result.err(
            new InternalError(
              `Worker env binding "${options.binding}" for resource "${id}" is not an R2 bucket. Check the r2_buckets entry in your wrangler configuration.`,
              { context: { binding: options.binding, resourceId: id } }
            )
          ),
  });
  return definition;
};
