/**
 * BlobRef — a frozen reference to binary data for @ontrails/core.
 */

/** Immutable reference to a blob of binary data. */
export interface BlobRef {
  readonly name: string;
  readonly mimeType: string;
  readonly size: number;
  readonly data: Uint8Array | ReadableStream<Uint8Array>;
}

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
