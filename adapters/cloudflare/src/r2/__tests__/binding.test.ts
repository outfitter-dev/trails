import { expect, test } from 'bun:test';
import { InternalError, NetworkError, ValidationError } from '@ontrails/core';

import { createCloudflareBlobBinding, createMemoryR2 } from '../index.js';

const bytes = async (
  data: Uint8Array | ReadableStream<Uint8Array>
): Promise<number[]> =>
  data instanceof Uint8Array
    ? [...data]
    : [...new Uint8Array(await new Response(data).arrayBuffer())];
const stream = (chunks: number[][]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new Uint8Array(chunk));
      }
      controller.close();
    },
  });

test('Blob binding writes bounded streams once with native size/MIME and direct bytes bypass the stream cap', async () => {
  const native = createMemoryR2();
  let attempts = 0;
  const seen: unknown[] = [];
  const client = createCloudflareBlobBinding(
    {
      ...native,
      put: async (...args: Parameters<typeof native.put>) => {
        attempts += 1;
        seen.push(args[1]);
        return native.put(...args);
      },
    },
    { maxBufferedBytes: 3 }
  );
  expect(await client.put('zero', stream([]))).toEqual({
    key: 'zero',
    mimeType: 'application/octet-stream',
    size: 0,
  });
  expect(
    await client.put('exact', stream([[1], [2, 3]]), {
      mimeType: 'application/x-test',
    })
  ).toEqual({ key: 'exact', mimeType: 'application/x-test', size: 3 });
  expect(await client.put('under', stream([[1], [2]]))).toEqual({
    key: 'under',
    mimeType: 'application/octet-stream',
    size: 2,
  });
  const data = new Uint8Array([1, 2, 3, 4]);
  await client.put('direct', data);
  expect(seen[3]).toBe(data);
  expect(attempts).toBe(4);
  const stored = await client.get('exact');
  if (stored === null) {
    throw new Error('Missing stored object');
  }
  expect(stored.name).toBe('exact');
  expect(await bytes(stored.data)).toEqual([1, 2, 3]);
  expect(await client.head('exact')).toEqual({
    key: 'exact',
    mimeType: 'application/x-test',
    size: 3,
  });
});

test('Blob stream rejection cancels/releases before native put and preserves existing data', async () => {
  const native = createMemoryR2();
  await native.put('key', new Uint8Array([9]));
  let attempts = 0;
  const client = createCloudflareBlobBinding(
    {
      ...native,
      put: async (...args: Parameters<typeof native.put>) => {
        attempts += 1;
        return native.put(...args);
      },
    },
    { maxBufferedBytes: 3 }
  );
  let cancelled = 0;
  for (const [index, data] of [
    new ReadableStream<Uint8Array>({
      cancel() {
        cancelled += 1;
      },
      start(c) {
        c.enqueue(new Uint8Array([1, 2, 3, 4]));
      },
    }),
    new ReadableStream<Uint8Array>({
      cancel() {
        cancelled += 1;
      },
      start(c) {
        c.enqueue('bad' as never);
      },
    }),
  ].entries()) {
    const result = client.put('key', data);
    await expect(result).rejects.toBeInstanceOf(ValidationError);
    if (index === 0) {
      await expect(result).rejects.toMatchObject({
        context: { limitBytes: 3, observedBytes: 4 },
      });
    }
    expect(data.locked).toBe(false);
  }
  const failed = new ReadableStream<Uint8Array>({
    start(c) {
      c.error(new Error('source failure'));
    },
  });
  await expect(client.put('key', failed)).rejects.toBeInstanceOf(NetworkError);
  expect(failed.locked).toBe(false);
  expect(cancelled).toBe(2);
  expect(attempts).toBe(0);
  const previous = await client.get('key');
  if (previous === null) {
    throw new Error('Missing previous object');
  }
  expect(await bytes(previous.data)).toEqual([9]);
});

test('Blob config and options validate before I/O, including cursor scope', async () => {
  const native = createMemoryR2();
  for (const maxBufferedBytes of [
    0,
    -1,
    0.5,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    expect(() =>
      createCloudflareBlobBinding(native, { maxBufferedBytes })
    ).toThrow(ValidationError);
  }
  expect(() => createCloudflareBlobBinding(native, undefined as never)).toThrow(
    ValidationError
  );
  const client = createCloudflareBlobBinding(native, { maxBufferedBytes: 10 });
  await client.put('file/a', new Uint8Array([1]));
  await client.put('file/b', new Uint8Array([2]));
  const page = await client.list({ limit: 1, prefix: 'file/' });
  if (page.complete) {
    throw new Error('Expected continuation');
  }
  await expect(
    client.list({ cursor: page.cursor, prefix: 'other/' })
  ).rejects.toBeInstanceOf(ValidationError);
  const other = createCloudflareBlobBinding(createMemoryR2(), {
    maxBufferedBytes: 10,
  });
  await expect(
    other.list({ cursor: page.cursor, prefix: 'file/' })
  ).rejects.toBeInstanceOf(ValidationError);
  await expect(client.list({ limit: 1001 })).rejects.toBeInstanceOf(
    ValidationError
  );
});

test('Blob preserves typed native identity, maps native rejection/read failures, and distinguishes malformed responses', async () => {
  const native = createMemoryR2();
  const typed = new ValidationError('typed native');
  const client = createCloudflareBlobBinding(
    {
      ...native,
      head: async () => {
        throw typed;
      },
    },
    { maxBufferedBytes: 3 }
  );
  await expect(client.head('key')).rejects.toBe(typed);
  const broken = createCloudflareBlobBinding(
    {
      ...native,
      head: async () => {
        throw new Error('native');
      },
    },
    { maxBufferedBytes: 3 }
  );
  await expect(broken.head('key')).rejects.toBeInstanceOf(NetworkError);
  const malformed = createCloudflareBlobBinding(
    { ...native, put: async () => null },
    { maxBufferedBytes: 3 }
  );
  await expect(malformed.put('key', new Uint8Array())).rejects.toBeInstanceOf(
    InternalError
  );
  await native.put('key', new Uint8Array([1]));
  const object = await native.get('key');
  if (object === null || !('body' in object)) {
    throw new Error('Missing body');
  }
  const unreadable = createCloudflareBlobBinding(
    {
      ...native,
      get: async () => ({
        ...object,
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.error(new Error('native read'));
          },
        }),
      }),
    },
    { maxBufferedBytes: 3 }
  );
  const value = await unreadable.get('key');
  if (value === null) {
    throw new Error('Missing result');
  }
  await expect(bytes(value.data)).rejects.toBeInstanceOf(NetworkError);
});
