import { InternalError, ValidationError, isTrailsError } from '@ontrails/core';

import { invalidBindingResponse, invokeBinding } from '../binding-errors.js';

/** Buffer authored streams once, rejecting before any native write can start. */
export const bufferBlobStream = async (
  stream: ReadableStream<Uint8Array>,
  limit: number
): Promise<Uint8Array> => {
  if (stream.locked) {
    throw new ValidationError('Cloudflare blob input stream is locked');
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      // The neutral blob mock also classifies opaque source-read failures as NetworkError.
      const chunk = await invokeBinding('blob', 'read input stream', () =>
        reader.read()
      );
      if (chunk.done) {
        break;
      }
      if (!(chunk.value instanceof Uint8Array)) {
        throw new ValidationError(
          'Cloudflare blob stream chunks must be bytes'
        );
      }
      const observedBytes = size + chunk.value.byteLength;
      if (observedBytes > limit) {
        throw new ValidationError(
          'Cloudflare blob stream exceeds maxBufferedBytes',
          { context: { limitBytes: limit, observedBytes } }
        );
      }
      if (chunk.value.byteLength > 0) {
        chunks.push(new Uint8Array(chunk.value));
      }
      size = observedBytes;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    // Cleanup is best effort and must not replace the original typed failure.
    try {
      await reader.cancel(error);
    } catch {
      // Retain the original stream failure if cancellation also fails.
    }
    if (isTrailsError(error)) {
      throw error;
    }
    throw new InternalError('Could not buffer Cloudflare blob input', {
      cause:
        error instanceof Error
          ? error
          : new Error('Blob buffering failed', { cause: error }),
    });
  } finally {
    reader.releaseLock();
  }
};

/** Keep native body failures typed without buffering reads or consuming metadata calls. */
export const wrapBlobReadStream = (
  body: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> => {
  if (body.locked) {
    throw invalidBindingResponse('blob', 'get');
  }
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async cancel(reason) {
      try {
        await invokeBinding('blob', 'cancel body', () => reader.cancel(reason));
      } finally {
        reader.releaseLock();
      }
    },
    async pull(controller) {
      try {
        const chunk = await invokeBinding('blob', 'read body', () =>
          reader.read()
        );
        if (chunk.done) {
          reader.releaseLock();
          controller.close();
          return;
        }
        if (!(chunk.value instanceof Uint8Array)) {
          throw invalidBindingResponse('blob', 'read body');
        }
        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
        try {
          await reader.cancel(error);
        } catch {
          // Retain the original stream failure if cancellation also fails.
        }
        reader.releaseLock();
      }
    },
  });
};
