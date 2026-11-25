import { expect } from 'bun:test';
import { TrailsError } from '@ontrails/core';
import type { BlobRef } from '@ontrails/core';

import type { BlobInfo } from './schemas.js';
import type { BlobStorage } from './types.js';

/** One isolated binding; cleanup runs even when a conformance assertion fails. */
export interface BlobContractSubject {
  readonly client: BlobStorage;
  readonly dispose?: (() => void | Promise<void>) | undefined;
}

/** Provider fixtures supply isolated storage; no account is provisioned. */
export interface BlobContractOptions {
  readonly createSubject: () =>
    | BlobContractSubject
    | Promise<BlobContractSubject>;
}

/** A shared case for the caller's test runner and timeout policy. */
export interface BlobContractCase {
  readonly name: string;
  readonly check: () => Promise<void>;
}

const bodyBytes = async (data: BlobRef['data']): Promise<Uint8Array> =>
  data instanceof Uint8Array
    ? data
    : new Uint8Array(await new Response(data).arrayBuffer());

const checkRead = async (
  client: BlobStorage,
  info: BlobInfo,
  bytes: number[]
): Promise<void> => {
  expect(await client.head(info.key)).toEqual(info);
  const value = await client.get(info.key);
  expect(value).not.toBeNull();
  if (value === null) {
    throw new Error('Expected stored blob');
  }
  expect(value.name).toBe(info.key);
  expect(value.mimeType).toBe(info.mimeType);
  expect(value.size).toBe(info.size);
  expect([...(await bodyBytes(value.data))]).toEqual(bytes);
};

const collectObjects = async (client: BlobStorage): Promise<BlobInfo[]> => {
  const objects: BlobInfo[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await client.list({
      limit: 1,
      prefix: 'file/',
      ...(cursor === undefined ? {} : { cursor }),
    });
    expect(page.objects.length).toBeLessThanOrEqual(1);
    objects.push(...page.objects);
    if (page.complete) {
      expect(page).not.toHaveProperty('cursor');
      return objects;
    }
    expect(page.cursor.length).toBeGreaterThan(0);
    expect(cursors.has(page.cursor)).toBe(false);
    cursors.add(page.cursor);
    ({ cursor } = page);
  }
};

/**
 * Shared cases for the memory mock and real provider bindings. Stream writes use
 * ordinary authored multi-chunk streams, not only provider-origin bodies.
 *
 * @example
 * ```ts
 * for (const example of createBlobContractCases({ createSubject })) {
 *   test(example.name, example.check);
 * }
 * ```
 */
export const createBlobContractCases = (
  options: BlobContractOptions
): readonly BlobContractCase[] => {
  const using = (
    name: string,
    check: (subject: BlobContractSubject) => Promise<void>
  ): BlobContractCase => ({
    check: async () => {
      const subject = await options.createSubject();
      try {
        await check(subject);
      } finally {
        await subject.dispose?.();
      }
    },
    name,
  });
  return [
    using(
      'Blob missing, overwrite, and idempotent delete',
      async ({ client }) => {
        expect(await client.get('missing')).toBeNull();
        expect(await client.head('missing')).toBeNull();
        await client.delete('missing');
        await client.put('key', new Uint8Array([1]), {
          mimeType: 'text/plain',
        });
        const info = await client.put('key', new Uint8Array([2, 3]));
        expect(info).toEqual({
          key: 'key',
          mimeType: 'application/octet-stream',
          size: 2,
        });
        await checkRead(client, info, [2, 3]);
        await client.delete('key');
        expect(await client.get('key')).toBeNull();
        expect(await client.head('key')).toBeNull();
      }
    ),
    using('Blob zero bytes and MIME metadata', async ({ client }) => {
      const info = await client.put('empty', new Uint8Array(), {
        mimeType: 'text/plain; charset=utf-8',
      });
      expect(info).toEqual({
        key: 'empty',
        mimeType: 'text/plain; charset=utf-8',
        size: 0,
      });
      await checkRead(client, info, []);
    }),
    using(
      'Blob consumes ordinary multi-chunk streams and reports actual size',
      async ({ client }) => {
        const data = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([0, 1]));
            controller.enqueue(new Uint8Array());
            controller.enqueue(new Uint8Array([2, 255, 3]));
            controller.close();
          },
        });
        const info = await client.put('stream', data, {
          mimeType: 'application/example',
        });
        expect(info).toEqual({
          key: 'stream',
          mimeType: 'application/example',
          size: 5,
        });
        await checkRead(client, info, [0, 1, 2, 255, 3]);
        await checkRead(client, info, [0, 1, 2, 255, 3]);
      }
    ),
    using('Blob input and read bytes are independent', async ({ client }) => {
      const input = new Uint8Array([7, 8]);
      const info = await client.put('isolated', input);
      input.fill(0);
      const first = await client.get('isolated');
      expect(first).not.toBeNull();
      if (first === null) {
        throw new Error('Expected stored blob');
      }
      const bytes = await bodyBytes(first.data);
      bytes.fill(0);
      await checkRead(client, info, [7, 8]);
    }),
    using(
      'Blob listing preserves metadata and follows explicit completion',
      async ({ client }) => {
        const a = await client.put('file/a', new Uint8Array([1]), {
          mimeType: 'text/plain',
        });
        const b = await client.put('file/b', new Uint8Array([2, 3]), {
          mimeType: 'image/example',
        });
        await client.put('other', new Uint8Array());
        const objects = await collectObjects(client);
        expect(
          objects.toSorted((left, right) => left.key.localeCompare(right.key))
        ).toEqual([a, b]);
        await checkRead(client, a, [1]);
        await checkRead(client, b, [2, 3]);
      }
    ),
    using(
      'Blob cursors reject another prefix or binding',
      async ({ client }) => {
        const other = await options.createSubject();
        try {
          await client.put('cursor/a', new Uint8Array([1]));
          await client.put('cursor/b', new Uint8Array([2]));
          const page = await client.list({ limit: 1, prefix: 'cursor/' });
          expect(page.complete).toBe(false);
          if (page.complete) {
            throw new Error('Expected a continuation cursor');
          }
          await expect(
            client.list({ cursor: page.cursor, prefix: 'other/' })
          ).rejects.toBeInstanceOf(TrailsError);
          await expect(
            other.client.list({ cursor: page.cursor, prefix: 'cursor/' })
          ).rejects.toBeInstanceOf(TrailsError);
        } finally {
          await other.dispose?.();
        }
      }
    ),
    using(
      'Blob stream failure cannot report write success',
      async ({ client }) => {
        const data = new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(new Error('source failed'));
          },
        });
        await expect(client.put('failed', data)).rejects.toBeInstanceOf(
          TrailsError
        );
      }
    ),
    using(
      'Blob invalid options reject with typed failures',
      async ({ client }) => {
        await expect(client.list({ limit: 0 })).rejects.toBeInstanceOf(
          TrailsError
        );
        await expect(client.list({ cursor: '' })).rejects.toBeInstanceOf(
          TrailsError
        );
      }
    ),
  ];
};
