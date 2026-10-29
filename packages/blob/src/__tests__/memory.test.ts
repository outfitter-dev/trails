import { describe, expect, test } from 'bun:test';
import { NetworkError, ValidationError } from '@ontrails/core';

import { createBlobMock } from '../memory.js';
import { blobListPageSchema } from '../schemas.js';

describe('memory body ownership', () => {
  test('snapshots each chunk before the producer can reuse it', async () => {
    const bytes = new Uint8Array([1]);
    let call = 0;
    const data = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          call += 1;
          if (call === 1) {
            controller.enqueue(bytes);
            return;
          }
          bytes[0] = 2;
          controller.close();
        },
      },
      { highWaterMark: 0 }
    );
    const client = createBlobMock();
    await client.put('key', data);
    const stored = await client.get('key');
    expect(stored?.data).toEqual(new Uint8Array([1]));
  });
  test('failed stream preserves previous mock value and releases its reader', async () => {
    const client = createBlobMock();
    await client.put('key', new Uint8Array([1]));
    const data = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('failure'));
      },
    });
    await expect(client.put('key', data)).rejects.toBeInstanceOf(NetworkError);
    expect(data.locked).toBe(false);
    const stored = await client.get('key');
    expect(stored?.data).toEqual(new Uint8Array([1]));
  });
  test('invalid chunks cancel the producer and preserve the original failure if cancellation rejects', async () => {
    for (const rejectCancel of [false, true]) {
      const client = createBlobMock();
      await client.put('key', new Uint8Array([1]));
      let cancelled = 0;
      let cancelReason: unknown;
      let lockedDuringCancel = false;
      const data = new ReadableStream<Uint8Array>({
        cancel(reason: unknown) {
          cancelled += 1;
          cancelReason = reason;
          lockedDuringCancel = data.locked;
          if (rejectCancel) {
            throw new Error('Cancellation cleanup failed');
          }
        },
        start(controller) {
          controller.enqueue('invalid' as never);
        },
      });
      let failure: unknown;
      try {
        await client.put('key', data);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(ValidationError);
      expect(cancelled).toBe(1);
      expect(cancelReason).toBe(failure);
      expect(lockedDuringCancel).toBe(true);
      expect(data.locked).toBe(false);
      const stored = await client.get('key');
      expect(stored?.data).toEqual(new Uint8Array([1]));
    }
  });
  test('locked and non-byte streams reject as typed errors', async () => {
    const client = createBlobMock();
    const locked = new ReadableStream<Uint8Array>();
    const reader = locked.getReader();
    await expect(client.put('key', locked)).rejects.toBeInstanceOf(
      NetworkError
    );
    reader.releaseLock();
    const invalid = new ReadableStream({
      start(controller) {
        controller.enqueue('invalid');
        controller.close();
      },
    });
    await expect(
      client.put('key', invalid as unknown as ReadableStream<Uint8Array>)
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('memory pagination', () => {
  test('cursors bind to their client and prefix', async () => {
    const client = createBlobMock();
    await client.put('p/a', new Uint8Array());
    await client.put('p/b', new Uint8Array());
    const page = await client.list({ limit: 1, prefix: 'p/' });
    expect(page.complete).toBe(false);
    if (page.complete) {
      throw new Error('Expected continuation');
    }
    await expect(
      client.list({ cursor: page.cursor, prefix: 'other' })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createBlobMock().list({ cursor: page.cursor, prefix: 'p/' })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(client.list({ cursor: '%' })).rejects.toBeInstanceOf(
      ValidationError
    );
    expect(await client.list({ cursor: page.cursor, prefix: 'p/' })).toEqual({
      complete: true,
      objects: [{ key: 'p/b', mimeType: 'application/octet-stream', size: 0 }],
    });
  });
  test('head and list metadata mutations do not change stored facts', async () => {
    const client = createBlobMock();
    const info = await client.put('key', new Uint8Array([1]));
    const head = await client.head('key');
    const page = await client.list();
    Object.assign(info, { size: 99 });
    Object.assign(head ?? {}, { mimeType: 'changed' });
    Object.assign(page.objects[0] ?? {}, { key: 'changed' });
    expect(await client.head('key')).toEqual({
      key: 'key',
      mimeType: 'application/octet-stream',
      size: 1,
    });
  });
  test('page schemas require unambiguous completion', () => {
    expect(
      blobListPageSchema.safeParse({ complete: false, objects: [] }).success
    ).toBe(false);
    expect(
      blobListPageSchema.safeParse({
        complete: true,
        cursor: 'stale',
        objects: [],
      }).success
    ).toBe(false);
    expect(
      blobListPageSchema.safeParse({
        complete: false,
        cursor: 'next',
        objects: [],
      }).success
    ).toBe(true);
  });
});
