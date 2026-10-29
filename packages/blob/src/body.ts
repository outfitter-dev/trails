import { NetworkError, TrailsError, ValidationError } from '@ontrails/core';
import type { BlobRef } from '@ontrails/core';

/** Memory storage snapshots bytes; provider bindings need not buffer streams. */
export const snapshotBody = async (
  data: BlobRef['data']
): Promise<Uint8Array> => {
  if (data instanceof Uint8Array) {
    return new Uint8Array(data);
  }
  if (!(data instanceof ReadableStream)) {
    throw new ValidationError(
      'Blob body must be bytes or a readable byte stream'
    );
  }
  try {
    const reader = data.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        if (!(chunk.value instanceof Uint8Array)) {
          throw new ValidationError('Blob stream chunks must be bytes');
        }
        chunks.push(new Uint8Array(chunk.value));
        size += chunk.value.byteLength;
      }
    } catch (error) {
      try {
        await reader.cancel(error);
      } catch {
        // Cancellation cleanup must not replace the original read or validation failure.
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    if (error instanceof TrailsError) {
      throw error;
    }
    throw new NetworkError('Could not read blob stream', {
      cause: error instanceof Error ? error : new Error(String(error)),
    });
  }
};
