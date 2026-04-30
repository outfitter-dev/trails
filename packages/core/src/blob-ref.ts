/**
 * BlobRef — a frozen reference to binary data for @ontrails/core.
 */

import { z } from 'zod';

/** Metadata key used to recognize BlobRef schemas during JSON Schema projection. */
export const BLOB_REF_SCHEMA_META_KEY = 'ontrails/blob-ref';

/** Immutable reference to a blob of binary data. */
export interface BlobRef {
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly data: Uint8Array | ReadableStream<Uint8Array>;
}

/** Schema-projected metadata for a BlobRef value. */
export interface BlobRefDescriptor {
  readonly kind: 'blob';
  readonly mimeType: string;
  readonly name: string;
  readonly size: number;
  readonly uri: string;
}

/** Public descriptor schema emitted to transport clients instead of raw bytes. */
export const blobRefDescriptorSchema = z.object({
  kind: z.literal('blob'),
  mimeType: z.string(),
  name: z.string(),
  size: z.number(),
  uri: z.string(),
});

/** Canonical JSON Schema for BlobRef descriptors across derived surfaces. */
export const blobRefJsonSchema = Object.freeze({
  properties: Object.freeze({
    kind: Object.freeze({ const: 'blob' }),
    mimeType: Object.freeze({ type: 'string' }),
    name: Object.freeze({ type: 'string' }),
    size: Object.freeze({ type: 'number' }),
    uri: Object.freeze({ type: 'string' }),
  }),
  required: Object.freeze(['kind', 'mimeType', 'name', 'size', 'uri']),
  type: 'object',
});

/** Creates a frozen BlobRef. */
export const createBlobRef = (options: {
  name: string;
  mimeType: string;
  size: number;
  data: Uint8Array | ReadableStream<Uint8Array>;
}): BlobRef =>
  Object.freeze({
    data: options.data,
    mimeType: options.mimeType,
    name: options.name,
    size: options.size,
  });

/** Type guard for BlobRef-shaped values. */
export const isBlobRef = (value: unknown): value is BlobRef => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['name'] === 'string' &&
    typeof obj['mimeType'] === 'string' &&
    typeof obj['size'] === 'number' &&
    (obj['data'] instanceof Uint8Array || obj['data'] instanceof ReadableStream)
  );
};

/** Zod schema for runtime BlobRef values with metadata for descriptor projection. */
export const blobRefSchema = z
  .custom<BlobRef>(isBlobRef, { error: 'Expected BlobRef' })
  .meta({ [BLOB_REF_SCHEMA_META_KEY]: true });

/** Convert a runtime BlobRef into its schema-aware transport descriptor. */
export const toBlobRefDescriptor = (blob: BlobRef): BlobRefDescriptor =>
  Object.freeze({
    kind: 'blob',
    mimeType: blob.mimeType,
    name: blob.name,
    size: blob.size,
    uri: `blob://${blob.name}`,
  });
